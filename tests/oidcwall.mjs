/* Posting to a member's Send Wall from an app (lib/oidc.js POST /oauth/wall + server.js appPost; owner, 2026-11-25: a
   sendy.gg player's screenshot or clip, posted "to a users SendRH.com Connected profile"). Drives the real HTTP API on the
   runner's throwaway server as an app's server would: the send.post scope offered only to a reviewed server app, the
   client authentication, the member by their private id, the answer on file (revoke, restriction and an unticked box all
   answer the same not_allowed), the $100 check, the media and caption limits, the member's own posting limit, and the post
   itself: on their wall, marked with the app's name, no Send Power, deletable by them. Everything it creates it deletes. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, DB_PATH, DATA_DIR } from './_paths.mjs';
import { sendNoOf } from './_sendno.mjs';

const require = createRequire(import.meta.url);
const OL = require(path.join(ROOT, 'lib', 'oidc.js'));
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const made = [], apps = [], posts = [];
// this suite's own addresses (the throwaway server trusts X-Forwarded-For from loopback), so no other suite's budget is spent
const NET = '198.51.' + (150 + Math.floor(Math.random() * 50)) + '.';
let ipTick = 0;
const nextIp = () => NET + (10 + (ipTick++ % 200));

function mkUser(name, o = {}) {
  db.prepare('DELETE FROM users WHERE username = ?').run(name);
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  made.push(id);
  db.prepare('UPDATE users SET points = ?, holder_state = ?, holder_verified_at = ? WHERE id = ?').run(o.points || 0, o.proved ? 'ok' : 'none', o.proved ? Date.now() : null, id);
  sendNoOf(db, id);
  const raw = 'tok_ow_' + crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed, sudo_until, sudo_since) VALUES (?,?,?,?,1,?,?)')
    .run(sha(raw), id, Date.now() - 5000, Date.now() + 864e5, Date.now() + 36e5, Date.now() - 5000);
  return { id, name, cookie: 'sid=' + raw };
}
function mkApp(o = {}) {
  const clientId = 'sapp_' + crypto.randomBytes(12).toString('hex'), secret = crypto.randomBytes(32).toString('hex');
  const t = Date.now();
  db.prepare('INSERT INTO oauth_clients (client_id, owner_id, name, description, homepage, redirect_uris, kind, secret_hash, secret_at, created_at, updated_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(clientId, null, o.name || 'Wall Test Game', '', 'https://wall-test.example', JSON.stringify(['https://wall-test.example/cb']), o.kind || 'confidential',
      o.kind === 'public' ? null : sha(secret), t, t, t, o.reviewed === false ? null : t);
  apps.push(clientId);
  return { clientId, secret, redirect: 'https://wall-test.example/cb', basic: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64') };
}
// the member let the app in: their private id in it, and their answer on file
function letIn(u, app, scopes) {
  const sub = OL.b64url(crypto.randomBytes(32));
  db.prepare('INSERT OR REPLACE INTO oauth_subjects (user_id, client_id, sub) VALUES (?,?,?)').run(u.id, app.clientId, sub);
  db.prepare('INSERT OR REPLACE INTO oauth_consents (user_id, client_id, scopes, asked, granted_at, updated_at) VALUES (?,?,?,?,?,?)').run(u.id, app.clientId, scopes.join(' '), scopes.join(' '), Date.now(), Date.now());
  return sub;
}

// a real 4×4 PNG (the scrubber reads its chunks) and the WebM shape MediaRecorder writes (an EBML header, a Segment and a
// Cluster of unknown size: tests/voicememo.mjs)
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 4 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(12, 0x80)])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const webm = () => {
  const head = Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.from([0x87]), Buffer.from('4282847765626d', 'hex'),
    Buffer.from('18538067', 'hex'), Buffer.from('01ffffffffffffff', 'hex'), Buffer.from('1f43b675', 'hex'), Buffer.from('01ffffffffffffff', 'hex')]);
  return Buffer.concat([head, Buffer.alloc(4096 - head.length)]);
};
const dataUrl = (type, buf) => 'data:' + type + ';base64,' + buf.toString('base64');

async function wall(app, body, o = {}) {
  const headers = { 'X-Forwarded-For': o.ip || nextIp(), 'Content-Type': o.type || 'application/json', ...(app && app !== 'none' ? { Authorization: o.auth || app.basic } : {}) };
  const r = await fetch(BASE + '/oauth/wall', { method: o.method || 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, h: r.headers };
}
async function get(p, cookie) {
  const r = await fetch(BASE + p, { headers: { 'X-Forwarded-For': nextIp(), ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}

try {
  check('the suite runs against the throwaway server (run.mjs: a data directory of its own)', /jsi-test-/.test(DB_PATH) || process.env.JSI_DATA_DIR, DB_PATH);
  const sp = OL.SCOPES.find((s) => s.scope === 'send.post');
  check('send.post is a scope with no claims, for server apps only, in OPTIONAL before offline_access, and its words say it posts only what the member picks, never reads or deletes, and is marked with the app',
    sp && sp.claims.length === 0 && sp.serverOnly === true && OL.OPTIONAL.indexOf('send.post') === OL.OPTIONAL.indexOf('offline_access') - 1
    && /press Post/.test(sp.plain) && /cannot read, change or delete your posts/.test(sp.plain) && /marked with the app/.test(sp.plain), JSON.stringify(sp));

  const good = mkApp(), unreviewed = mkApp({ reviewed: false }), browser = mkApp({ kind: 'public' });
  const member = mkUser('__ow_member__', { proved: true, points: 500 }), fresh = mkUser('__ow_fresh__'), plain = mkUser('__ow_plain__', { proved: true });

  /* 1. the consent page: the box for a reviewed server app only */
  const pk = OL.b64url(crypto.createHash('sha256').update(crypto.randomBytes(32)).digest());
  const authz = (app) => '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: app.clientId, redirect_uri: app.redirect, scope: 'openid send.handle send.post', state: 'st1', code_challenge: pk, code_challenge_method: 'S256' });
  const pages = await Promise.all([good, unreviewed, browser].map((a) => get(authz(a), plain.cookie)));
  check('the consent page offers "Post pictures and clips you choose to your Send Wall" to a reviewed server app, unticked',
    pages[0].status === 200 && /<input type="checkbox" name="scope" value="send\.post">/.test(pages[0].text) && /Post pictures and clips you choose to your Send Wall/.test(pages[0].text), pages[0].status);
  check('  ...and leaves it out for an unreviewed server app and for a browser app (their other boxes stay)',
    pages[1].status === 200 && pages[2].status === 200 && ![1, 2].some((i) => /value="send\.post"/.test(pages[i].text)) && /value="send\.handle"/.test(pages[1].text) && /value="send\.handle"/.test(pages[2].text));
  const disc = (await get('/.well-known/openid-configuration')).j || {};
  check('discovery lists send.post among the scopes', (disc.scopes_supported || []).includes('send.post'), JSON.stringify(disc.scopes_supported));

  /* 2. who may call it */
  const sub = letIn(member, good, ['send.handle', 'send.post']);
  const pic = dataUrl('image/png', png());
  const r0 = await wall('none', { sub, media: pic });
  check('no client authentication: 401 invalid_client with a Basic challenge', r0.status === 401 && r0.j && r0.j.error === 'invalid_client' && /^Basic /.test(r0.h.get('www-authenticate') || ''), r0.status + ' ' + r0.text);
  const r1 = await wall(good, { sub, media: pic }, { auth: 'Basic ' + Buffer.from(good.clientId + ':' + 'f'.repeat(64)).toString('base64') });
  check('a wrong secret: 401 invalid_client', r1.status === 401 && r1.j.error === 'invalid_client', r1.status);
  const ur = letIn(member, unreviewed, ['send.post']);
  const r2 = await wall(unreviewed, { sub: ur, media: pic });
  check('an unreviewed server app: 403 unauthorized_client, even with the box ticked on file', r2.status === 403 && r2.j.error === 'unauthorized_client', r2.status + ' ' + r2.text);
  const r3 = await wall(good, 'sub=' + sub, { type: 'application/x-www-form-urlencoded' });
  check('a body that is not JSON: 415', r3.status === 415 && r3.j.error === 'invalid_request', r3.status);
  const r3b = await fetch(BASE + '/oauth/wall', { headers: { Authorization: good.basic, 'X-Forwarded-For': nextIp() } });
  check('GET is 405', r3b.status === 405, r3b.status);

  /* 3. the member and their answer on file: one answer for every "no" */
  const no = [await wall(good, { sub: OL.b64url(crypto.randomBytes(32)), media: pic })];
  const sub2 = letIn(plain, good, ['send.handle']);   // never ticked send.post
  no.push(await wall(good, { sub: sub2, media: pic }));
  check('an unknown sub and a member who never ticked the box get the same 403 not_allowed, word for word',
    no.every((r) => r.status === 403 && r.j.error === 'not_allowed') && no[0].text === no[1].text, no.map((r) => r.status + ' ' + r.text).join(' | '));
  check('a sub that is not one: 400', (await wall(good, { sub: 'x', media: pic })).status === 400);

  /* 4. the media and the caption */
  const m1 = await wall(good, { sub, media: dataUrl('image/gif', Buffer.from('GIF89a')) });
  const m2 = await wall(good, { sub, media: 'data:text/html;base64,' + Buffer.from('<b>x</b>').toString('base64') });
  check('a GIF or anything but JPEG, PNG, WebP, MP4 and WebM: 415 invalid_media', m1.status === 415 && m2.status === 415 && m1.j.error === 'invalid_media', m1.status + ' ' + m2.status);
  const m3 = await wall(good, { sub, media: dataUrl('image/png', crypto.randomBytes(256)) });
  check('bytes that are not what the type says: 400 invalid_media (saveMedia reads them)', m3.status === 400 && m3.j.error === 'invalid_media', m3.status + ' ' + m3.text);
  const m4 = await wall(good, { sub, media: 'data:video/webm;base64,' + 'A'.repeat(Math.ceil(16.2 * 1048576 * 4 / 3)) });
  check('a clip over 16 MB: 413', m4.status === 413, m4.status + ' ' + m4.text.slice(0, 120));
  const m5 = await wall(good, { sub, media: pic, text: 'x'.repeat(281) });
  check('a caption over 280 characters: 400', m5.status === 400 && /280/.test(m5.j.error_description), m5.status);

  /* 5. the $100 check, as for a picture posted on the site */
  const subFresh = letIn(fresh, good, ['send.post']);
  const pr = await wall(good, { sub: subFresh, media: pic });
  check('a member before the $100 check: 403 needs_proof, and nothing posted',
    pr.status === 403 && pr.j.error === 'needs_proof' && /\$100/.test(pr.j.error_description) && !db.prepare('SELECT 1 FROM posts WHERE user_id = ?').get(fresh.id), pr.status + ' ' + pr.text);

  /* 6. the post */
  const before = db.prepare('SELECT points FROM users WHERE id = ?').get(member.id).points;
  const ok = await wall(good, { sub, text: '  Sunset over Send Island 🌅 ', media: pic });
  const row = ok.j && ok.j.post ? db.prepare('SELECT * FROM posts WHERE id = ?').get(ok.j.post.id) : null;
  if (row) posts.push(row.id);
  check('a picture goes on the member\'s own wall: 200 { post: { id, url } }, the url their Wall at that post',
    ok.status === 200 && row && row.user_id === member.id && ok.j.post.url === BASE + '/u/' + member.name + '#p' + row.id, ok.status + ' ' + ok.text);
  check('  ...with the caption trimmed, the app\'s client_id in via_app, the file stored under /uploads and counted to the member\'s quota',
    row && row.text === 'Sunset over Send Island 🌅' && row.via_app === good.clientId && /^[0-9a-f]{24}\.png$/.test(row.image) && existsSync(path.join(DATA_DIR, 'uploads', row.image))
    && db.prepare('SELECT upload_bytes FROM users WHERE id = ?').get(member.id).upload_bytes > 0, JSON.stringify(row));
  check('  ...and it earns no Send Power', db.prepare('SELECT points FROM users WHERE id = ?').get(member.id).points === before && !db.prepare("SELECT 1 FROM points_events WHERE user_id = ? AND kind IN ('post','first_post')").get(member.id));
  const view = row ? await get('/api/posts/' + row.id) : null;
  check('the post says where it came from: via = the app\'s name, on the single post and in the member\'s feed',
    view && view.status === 200 && view.j.post.via === 'Wall Test Game', view && view.text.slice(0, 200));
  const W = readFileSync(path.join(ROOT, 'public', 'wall.js'), 'utf8'), U = readFileSync(path.join(ROOT, 'public', 'upage.js'), 'utf8');
  check('  ...and the wall and profile pages show "📸 via <app>" with the name escaped', [W, U].every((s) => /p\.via \? ' · <span class="post-via"[^\n]*📸 via ' \+ esc\(p\.via\)/.test(s)));
  const clip = await wall(good, { sub, media: dataUrl('video/webm', webm()) });
  if (clip.j && clip.j.post) posts.push(clip.j.post.id);
  const crow = clip.j && clip.j.post ? db.prepare('SELECT image FROM posts WHERE id = ?').get(clip.j.post.id) : null;
  check('a WebM clip goes up too, as a video, with no caption', clip.status === 200 && crow && /\.webm$/.test(crow.image), clip.status + ' ' + clip.text);
  const del = row ? await fetch(BASE + '/api/posts/' + row.id, { method: 'DELETE', headers: { Cookie: member.cookie, Origin: BASE, 'X-Forwarded-For': nextIp() } }) : null;
  check('the member can delete it like any post of theirs, and its file goes', del && del.status === 200 && !db.prepare('SELECT 1 FROM posts WHERE id = ?').get(row.id) && !existsSync(path.join(DATA_DIR, 'uploads', row.image)), del && del.status);

  /* 7. the member's own posting limit counts app posts (12 in 10 minutes on the site) */
  const busy = mkUser('__ow_busy__', { proved: true }), subBusy = letIn(busy, good, ['send.post']);
  const codes = [];
  for (let i = 0; i < 13; i++) { const r = await wall(good, { sub: subBusy, media: pic }); codes.push(r.status); if (r.j && r.j.post) posts.push(r.j.post.id); }
  check('the member\'s own posting limit holds for an app: the 13th post in ten minutes is 429 slow_down', codes.slice(0, 12).every((c) => c === 200) && codes[12] === 429, codes.join(','));

  /* 8. taking it back */
  const rv = await fetch(BASE + '/api/oauth/grants/' + good.clientId, { method: 'DELETE', headers: { Cookie: member.cookie, Origin: BASE, 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() } });
  const after = await wall(good, { sub, media: pic });
  check('after the member revokes the app in Settings: not_allowed, the same answer as for an unknown sub', rv.status === 200 && after.status === 403 && after.text === no[0].text, rv.status + ' ' + after.status);
  const subR = letIn(plain, good, ['send.post']);
  db.prepare('UPDATE users SET restricted_until = ?, restrict_level = 1 WHERE id = ?').run(Date.now() + 36e5, plain.id);
  const rr = await wall(good, { sub: subR, media: pic });
  check('a member in read-only mode: the same not_allowed (no app learns a moderation), and their consent to the app is ended',
    rr.status === 403 && rr.text === no[0].text && !db.prepare('SELECT 1 FROM oauth_consents WHERE user_id = ? AND client_id = ?').get(plain.id, good.clientId), rr.status + ' ' + rr.text);
  db.prepare('UPDATE oauth_clients SET disabled_at = ? WHERE client_id = ?').run(Date.now(), good.clientId);
  const off = await wall(good, { sub: subBusy, media: pic });
  check('an app the admin switched off: 401 invalid_client', off.status === 401 && off.j.error === 'invalid_client', off.status);

  /* 9. the words */
  const DEV = readFileSync(path.join(ROOT, 'public', 'developers.html'), 'utf8'), PRIV = readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
  check('/developers documents POST /oauth/wall (client_secret_basic, the body, the limits, not_allowed and needs_proof) and the privacy page says what an app that posts for you can and cannot do',
    /POST \/oauth\/wall<\/code> with <code>client_secret_basic<\/code>/.test(DEV) && /needs_proof/.test(DEV) && /not_allowed/.test(DEV) && /up to 16 MB/.test(DEV)
    && /Apps that post for you/.test(PRIV) && /cannot read, change or delete your posts/.test(PRIV) && /earns no Send Power/.test(PRIV));
} catch (e) {
  check('the suite ran without throwing', false, e && e.stack);
} finally {
  for (const id of posts) { try { const r = db.prepare('SELECT image FROM posts WHERE id = ?').get(id); db.prepare('DELETE FROM posts WHERE id = ?').run(id); } catch {} }
  for (const id of made) { try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {} }
  for (const c of apps) { try { db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(c); db.prepare('DELETE FROM oauth_subjects WHERE client_id = ?').run(c); db.prepare('DELETE FROM oauth_consents WHERE client_id = ?').run(c); } catch {} }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
