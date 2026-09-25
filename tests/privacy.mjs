/* Personal data: what the API, the pages, third parties and the disk can and cannot see.

   The site stores IP addresses only as keyed hashes and encrypts emails, wallet links and secrets. This
   suite checks the places that promise can still fail: an API response that carries someone else's data, a
   browser request that hands a third party a visitor's IP next to their wallets, an upload that keeps its
   GPS tag, a deletion that silently rolls back, a figure precise enough to name a wallet. Throwaway rows
   only; all removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, DATA_DIR, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [], communities: [], files: [] };
const SRC = readFileSync(SERVER_JS, 'utf8');
const PUB = path.join(ROOT, 'public');
const UPLOADS = path.join(DATA_DIR, 'uploads');

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET', redirect: 'manual',
    headers: { 'Content-Type': opts.type || 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.raw !== undefined ? opts.raw : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, headers: r.headers };
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(str) { let bits = 0, val = 0; const out = []; for (const c of str) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const hex = (n) => randomBytes(n).toString('hex');
function mkUser(name, extra = {}) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, extra.createdAt || Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + hex(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
// a real, minimal JPEG: SOI, JFIF, EXIF (orientation 6 + a fake GPS note), SOF0 (dims), SOS, data, EOI
const SECRET = 'GPS 51.5007N 0.1246W Pixel 9 serial 8XK2';
const seg = (m, body) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = m; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
function jpegWithGps() {
  const tiff = Buffer.alloc(26); tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(6, 18);
  const sof = Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0]);   // 8-bit, 16x16, one component
  return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, Buffer.from(SECRET)])), seg(0xfe, Buffer.from(SECRET)),
    seg(0xc0, sof), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9])]);
}
const box = (t, ...kids) => { const d = Buffer.concat(kids); const h = Buffer.alloc(8); h.writeUInt32BE(d.length + 8); h.write(t, 4, 'latin1'); return Buffer.concat([h, d]); };
const mp4WithGps = () => Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomiso2')),
  box('moov', box('mvhd', Buffer.alloc(100, 3)), box('udta', box('\xa9xyz', Buffer.from(SECRET))), box('meta', Buffer.from(SECRET))),
  box('mdat', Buffer.alloc(256, 9))]);

try {
  /* ═══ 1. deleting an account actually deletes it — including an account with two-factor on ═══ */
  {
    const secret = 'JBSWY3DPEHPK3PXP';   // stored as legacy plaintext, which the server's decField passes through
    const u = mkUser('__pv_leaver__');
    const wallet = '0x' + hex(20);
    const files = ['avatar', 'header', 'bg', 'upload'].map((k) => hex(12) + '.jpg');
    for (const f of files) { writeFileSync(path.join(UPLOADS, f), jpegWithGps()); made.files.push(f); }
    db.prepare(`UPDATE users SET twofa_method='totp', twofa_secret=?, twofa_enabled_at=?, twitter_handle='leaver_x', ig_handle='leaver_ig',
      avatar_img=?, header_img=?, bg_img=?, signup_ip=?, last_ip=?, age_at=?, accent='#123456', wall_bg='x' WHERE id=?`)
      .run(secret, Date.now(), files[0], files[1], files[2], hex(32), hex(32), Date.now(), u.id);
    db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?,?,?,?,?)").run(u.id, 'wallet', hex(32), wallet, Date.now());
    db.prepare('INSERT INTO uploads (name, user_id, bytes, kind, created_at, claimed) VALUES (?,?,?,?,?,1)').run(files[3], u.id, 100, 'image', Date.now());
    db.prepare('INSERT INTO notifications (user_id, kind, icon, text, created_at) VALUES (?,?,?,?,?)').run(u.id, 'alert', '🔗', 'hello', Date.now());
    const cid = Number(db.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, created_at, creator_ip) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(u.id, '0x' + hex(20), '0x' + hex(20), 'PVT', 'Privacy Test', '{}', 'pending', Date.now(), hex(32)).lastInsertRowid);
    made.communities.push(cid);
    db.prepare("INSERT INTO proposals (community_id, author_id, title, body, status, created_at, author_ip) VALUES (?,?,?,?,?,?,?)").run(cid, u.id, 'draft idea', 'secret draft', 'draft', Date.now(), hex(32));
    db.prepare("INSERT INTO proposals (community_id, author_id, title, body, status, created_at, author_ip) VALUES (?,?,?,?,?,?,?)").run(cid, u.id, 'open idea', 'public words', 'open', Date.now(), hex(32));

    const del = await api('/api/account/delete', { method: 'POST', sid: u.sid, body: { confirm: 'DELETE', current: { code: totp(secret) } } });
    check('an account with an authenticator can delete itself (the factor arrives nested, as the page sends it)', del.status === 200 && del.j && del.j.ok, del.status + ' ' + (del.j && del.j.error));
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
    check('  ...the row is anonymised', row && row.deleted_at && row.username === 'deleted-' + u.id);
    check('  ...no handles, pictures, IP indexes, age record or 2FA left on it',
      row && row.twitter_handle == null && row.ig_handle == null && row.avatar_img == null && row.header_img == null && row.bg_img == null &&
      row.signup_ip == null && row.last_ip == null && row.age_at == null && row.twofa_secret == null && row.accent === '' && row.wall_bg === '',
      JSON.stringify(row && { t: row.twitter_handle, s: row.signup_ip, a: row.age_at }));
    for (const t of ['identities', 'sessions', 'notifications', 'uploads']) {
      check('  ...' + t + ' are gone', db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE user_id=?`).get(u.id).n === 0);
    }
    check('  ...the files behind the profile pictures are removed from disk', files.every((f) => !existsSync(path.join(UPLOADS, f))), files.filter((f) => existsSync(path.join(UPLOADS, f))).join(','));
    check('  ...a draft proposal is gone, an opened one keeps its tally but not its words or network',
      db.prepare("SELECT COUNT(*) n FROM proposals WHERE author_id=? AND status='draft'").get(u.id).n === 0 &&
      db.prepare("SELECT COUNT(*) n FROM proposals WHERE author_id=? AND status='open' AND title='[deleted]' AND body='' AND author_ip IS NULL").get(u.id).n === 1);
    check('  ...and the community forgets the network it was started from', db.prepare('SELECT creator_ip FROM communities WHERE id=?').get(cid).creator_ip == null);
    const pub = await api('/api/users/deleted-' + u.id);
    check('  ...and the public profile carries nothing that identifies them', pub.status !== 200 || (!/leaver_x|leaver_ig/.test(pub.text) && !files.some((f) => pub.text.includes(f))), pub.status);
  }

  /* ═══ 2. no endpoint hands one person's private data to anybody else ═══ */
  {
    const a = mkUser('__pv_alice__'), b = mkUser('__pv_bob__');
    const email = 'pv.alice.' + hex(3) + '@example.com', wallet = '0x' + hex(20), tracked = '0x' + hex(20);
    const sigIdx = hex(32), emailIdx = hex(32), walletIdx = hex(32), trackedIdx = hex(32);
    db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, secret, linked_at) VALUES (?,?,?,?,?,?)").run(a.id, 'email', emailIdx, email, 'scrypt$' + hex(16), Date.now());
    db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?,?,?,?,?)").run(a.id, 'wallet', walletIdx, wallet, Date.now());
    db.prepare('INSERT INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(a.id, trackedIdx, tracked, 'pv-secret-stash', Date.now());
    db.prepare('UPDATE users SET signup_ip=? WHERE id=?').run(sigIdx, a.id);
    const aSessionHash = createHash('sha256').update(a.sid).digest('hex');
    const secrets = { email, wallet: wallet.slice(2), tracked: tracked.slice(2), label: 'pv-secret-stash', signupIp: sigIdx, emailIdx, walletIdx, trackedIdx, session: a.sid, sessionHash: aSessionHash };
    const routes = ['/api/users/__pv_alice__', '/api/users/' + a.id, '/u/__pv_alice__', '/api/posts', '/api/posts?sort=new', '/api/calls', '/api/calls/live', '/api/leaderboard',
      '/api/calls/leaderboard', '/api/search?q=__pv', '/api/presence', '/api/gate/state', '/api/communities', '/api/pins?user=__pv_alice__', '/api/competition', '/api/beta',
      '/api/me', '/api/wallets', '/api/notifications', '/api/auth/sessions', '/api/alerts', '/api/tracker/cache', '/api/gamify/me', '/api/mutes', '/api/admin/reports', '/api/admin/outbound'];
    const leaks = [];
    for (const [who, sid] of [['anonymous', null], ['another member', b.sid]]) {
      for (const r of routes) {
        const res = await api(r, { sid });
        for (const [k, v] of Object.entries(secrets)) if (res.text.toLowerCase().includes(String(v).toLowerCase())) leaks.push(who + ' ' + r + ' → ' + k);
      }
    }
    check('no route shows an account\'s email, wallets, tracked wallets, IP index or session to anyone else', leaks.length === 0, leaks.slice(0, 6).join(' | '));
  }

  /* ═══ 3. money on a Send Call is exact only for the caller ═══ */
  {
    const c = mkUser('__pv_caller__');
    const callId = Number(db.prepare(`INSERT INTO calls (user_id, token_addr, pair_addr, symbol, name, entry_price, entry_mc, peak_price, cur_price, entry_spend_usd, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(c.id, '0x' + hex(20), '0x' + hex(20), 'PVC', 'Probe Call', 0.00123, 1000000, 0.00123, 0.00123, 1234.5678, Date.now()).lastInsertRowid);
    const anon = await api('/api/calls/' + callId);
    check('a Send Call shows everyone else a rounded stake', anon.j && anon.j.call && anon.j.call.callerSpend === 1200, anon.j && anon.j.call && anon.j.call.callerSpend);
    check('  ...so position size ÷ entry price no longer returns the exact token amount', anon.j && anon.j.call && Math.abs(anon.j.call.sizeMult - 12) < 1e-9, anon.j && anon.j.call && anon.j.call.sizeMult);
    const own = await api('/api/calls/' + callId, { sid: c.sid });
    check('  ...and the caller their own exact figure', own.j && own.j.call && own.j.call.callerSpend === 1234.5678, own.j && own.j.call && own.j.call.callerSpend);
    check('the Send-It notification rounds the follower\'s stake too', /about \$' \+ senderUsdPublic\(spendUsd\)/.test(SRC));
    db.prepare('DELETE FROM calls WHERE id=?').run(callId);
  }

  /* ═══ 4. the browser talks only to this site ═══ */
  {
    const home = await api('/');
    const csp = home.headers.get('content-security-policy') || '';
    check('the page policy allows no Google Fonts, Dexscreener or Blockscout', !/googleapis|gstatic|dexscreener|blockscout/.test(csp), csp);
    check('  ...fonts come from this site', /font-src 'self'/.test(csp) && /img-src 'self' data: blob:(;|$)/.test(csp));
    const pages = readdirSync(PUB).filter((f) => f.endsWith('.html'));
    const google = pages.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(path.join(PUB, f), 'utf8').replace(/<p>[\s\S]*?<\/p>/g, '')));
    check('no page loads Google Fonts', google.length === 0, google.join(','));
    const fontCss = readFileSync(path.join(PUB, 'fonts', 'fonts.css'), 'utf8') + readFileSync(path.join(PUB, 'fonts', 'fonts-whitepaper.css'), 'utf8');
    const refs = [...fontCss.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
    check('  ...every self-hosted font file is there', refs.length >= 8 && refs.every((f) => existsSync(path.join(PUB, 'fonts', f))), refs.filter((f) => !existsSync(path.join(PUB, 'fonts', f))).join(','));
    check('  ...with its licence beside it', existsSync(path.join(PUB, 'fonts', 'LICENSES.md')) && ['luckiest-guy', 'rubik', 'newsreader', 'ibm-plex-mono', 'ibm-plex-sans'].every((n) => existsSync(path.join(PUB, 'fonts', n + '-LICENSE.txt'))));
    const woff = await fetch(BASE + '/fonts/' + refs[0]);
    check('  ...served as a font', woff.status === 200 && (woff.headers.get('content-type') || '').startsWith('font/woff2'), woff.status + ' ' + woff.headers.get('content-type'));
    const CHAIN = readFileSync(path.join(PUB, 'chain.js'), 'utf8');
    check('the price feed, wallet history and token prices are read through this site', /fetch\('\/api\/chain\/pairs'/.test(CHAIN) && /fetch\('\/api\/chain\/explorer\?path='/.test(CHAIN) && /fetch\('\/api\/chain\/dex-tokens\?addrs='/.test(CHAIN) && !/api\.dexscreener\.com/.test(CHAIN));
    const anonX = await api('/api/chain/explorer?path=' + encodeURIComponent('/api/v2/addresses/0x' + '1'.repeat(40)));
    check('  ...wallet history is for signed-in members only', anonX.status === 401, anonX.status);
    const m = mkUser('__pv_chain__');
    const badX = await api('/api/chain/explorer?path=' + encodeURIComponent('/api/v2/smart-contracts/0x' + '1'.repeat(40)), { sid: m.sid });
    check('  ...and only the reads the tracker makes', badX.status === 400, badX.status);
    const anonD = await api('/api/chain/dex-tokens?addrs=0x' + '1'.repeat(40));
    check('  ...token prices too', anonD.status === 401, anonD.status);
    const pairs = await api('/api/chain/pairs');
    check('  ...while the homepage price feed is open, from our cache', pairs.status === 200 || pairs.status === 502, pairs.status);

    // artwork URLs are rewritten to our proxy at the JSON boundary
    const cdn = 'https://cdn.dexscreener.com/cms/images/pv-probe-' + hex(4) + '.png';
    const cid = Number(db.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(m.id, '0x' + hex(20), '0x' + hex(20), 'PVI', 'Probe Img', JSON.stringify({ imageUrl: cdn }), 'live', Date.now()).lastInsertRowid);
    made.communities.push(cid);
    const list = await api('/api/communities/' + cid);
    check('token artwork reaches the browser as our own /api/img path', list.text.includes('/api/img?u=' + encodeURIComponent(cdn)) && !list.text.includes(cdn), list.status);
    check('  ...except on the Data API, whose callers are programs', /res\._rawImg = true;/.test(SRC));
    const imgBad = await api('/api/img?u=' + encodeURIComponent('https://example.com/x.png'));
    check('the image proxy only fetches from the token CDN', imgBad.status === 400, imgBad.status);
    check('  ...and serves only raster bytes, typed from the bytes, sandboxed', /const ct = imageTypeOf\(buf\);/.test(SRC) && /'Content-Security-Policy': "default-src 'none'; sandbox"/.test(SRC));
  }

  /* ═══ 5. uploads lose their location and device data ═══ */
  {
    const up = mkUser('__pv_uploader__');
    const jr = await api('/api/upload', { method: 'POST', sid: up.sid, type: 'image/jpeg', raw: jpegWithGps() });
    check('a JPEG upload is accepted', jr.status === 200 && jr.j && jr.j.url, jr.status + ' ' + (jr.j && jr.j.error));
    if (jr.j && jr.j.url) {
      made.files.push(jr.j.url.split('/').pop());
      const got = Buffer.from(await (await fetch(BASE + jr.j.url)).arrayBuffer());
      check('  ...and served without its GPS / device text', !got.includes(Buffer.from(SECRET)), got.length);
      const app1 = got.indexOf(Buffer.from([0xff, 0xe1]));
      check('  ...but still with its orientation, so it is not turned on its side', app1 > 0 && got.includes(Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06])), app1);
    }
    const vr = await api('/api/upload', { method: 'POST', sid: up.sid, type: 'video/mp4', raw: mp4WithGps() });
    check('an MP4 upload is accepted', vr.status === 200 && vr.j && vr.j.url, vr.status + ' ' + (vr.j && vr.j.error));
    if (vr.j && vr.j.url) {
      made.files.push(vr.j.url.split('/').pop());
      const got = Buffer.from(await (await fetch(BASE + vr.j.url)).arrayBuffer());
      check('  ...served without its location atom', !got.includes(Buffer.from(SECRET)));
      check('  ...and not a byte moved (the sample data is exactly where it was)', got.length === mp4WithGps().length && got.subarray(got.length - 256).equals(Buffer.alloc(256, 9)));
    }
    const junk = await api('/api/upload', { method: 'POST', sid: up.sid, type: 'image/jpeg', raw: Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.alloc(200, 1)]) });
    check('a file whose structure cannot be read is refused rather than published as-is', junk.status !== 200, junk.status);
    check('the data-URI save paths strip the same way', /const clean = scrubMediaBuffer\(buf, 'image\/' \+ m\[1\]\);/.test(SRC) && /scrubMediaFile\(file, mime\)/.test(SRC));
  }

  /* ═══ 6. at rest: private files, no plaintext wallet links, IP indexes kept only as long as they are used ═══ */
  {
    const mode = (p) => statSync(p).mode & 0o777;
    check('the database is readable by the site\'s own account only', (mode(DB_PATH) & 0o077) === 0, mode(DB_PATH).toString(8));
    check('  ...and so is the data folder', (mode(DATA_DIR) & 0o077) === 0, mode(DATA_DIR).toString(8));
    check('  ...because the server sets a private umask before it creates anything', /process\.umask\(0o077\);/.test(SRC) && SRC.indexOf('process.umask(0o077)') < SRC.indexOf("new DatabaseSync(path.join(DATA_DIR, 'app.db'))"));
    check('the first-day wallet list is encrypted', /gate_wallets = \?[\s\S]{0,400}encField\(JSON\.stringify\(addrs/.test(SRC) && /JSON\.parse\(decField\(u\.gate_wallets\)/.test(SRC));
    check('the swap ledger keeps a blind index, not the tx hash', /'swaptx:' \+ bidx\(hash\)/.test(SRC) && !/'swaptx:' \+ hash\b/.test(SRC));
    check('older ledger rows with addresses or hashes are migrated', /ref GLOB 'swaptx:0x\*' OR ref GLOB 'connect:0x\*' OR ref GLOB 'track:\*:0x\*'/.test(SRC));
    check('notifications never quote a wallet', !/'ending in ' \+ (addr|address)\.slice/.test(SRC) && !/next\.slice\(0, 6\) \+ '…'/.test(SRC));
    check('calls made before wallet sharing was opt-in stop publishing one', /UPDATE calls SET wallet = NULL WHERE wallet IS NOT NULL AND created_at < \?'\)\.run\(1789146557000\)/.test(SRC));
    check('last sign-in, vote and proposal IP indexes are no longer written', !/UPDATE users SET last_ip = \? WHERE id = \?/.test(SRC) && /vote_ip\) VALUES \(\?,\?,\?,\?,\?,NULL\)/.test(SRC) && /author_ip\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,NULL\)/.test(SRC));
    check('a Send Call\'s IP index goes a day after the ring window, a signup\'s after 90 days', /UPDATE calls SET ip = NULL WHERE ip IS NOT NULL AND created_at < \?'\)\.run\(t - SYBIL_WINDOW_MS - DAY_MS\)/.test(SRC) && /const SIGNUP_IP_KEEP_MS = 90 \* DAY_MS;/.test(SRC));
    check('a proxy header with fewer hops than configured never keys everyone on the proxy', /parts\.length >= TRUST_PROXY_HOPS \? parts\[parts\.length - TRUST_PROXY_HOPS\] : parts\[0\]/.test(SRC));
  }

  /* ═══ 7. nothing on the site tells one member about another's network or bag ═══ */
  {
    check('the community anti-sybil message names neither rule', !/already opted in from your network/.test(SRC) && !/starter’s own network/.test(SRC));
    check('  ...and is decided at join, not re-tested against the network the page is read from', /blockReason: !m\.qualified \? \(m\.block_reason \|\| null\) : null/.test(SRC));
    check('the alerts cap does not count the neighbours', !/people on this connection already have alerts/.test(SRC));
    check('the Convicted-In hover gives other people bands, not a balance and a date', /coarse: true,[\s\S]{0,120}floor10\(h\.amountTok\)/.test(SRC) && /heldFor/.test(SRC));
    const inviter = mkUser('__pv_inviter__'), invitee = mkUser('__pv_invitee__');
    db.prepare('UPDATE users SET invited_by=?, ticket_public=1 WHERE id=?').run(inviter.id, invitee.id);
    const page = await api('/t/' + invitee.id);
    check('a shared ticket does not name who invited them', page.status === 200 && !page.text.includes('__pv_inviter__'), page.status);
    check('  ...nor does its card, nor the downloaded picture', /'INVITED SENDER'/.test(SRC) && /t\.invitedBy \? 'INVITED SENDER'/.test(readFileSync(path.join(PUB, 'invite.js'), 'utf8')));
    check('sign-up never answers "is this email a member": the invite comes first, and a taken email makes the account without it',
      /const regGate = signupRefusal\(req\);[\s\S]{0,700}const made = await createAccount\(req, \{ username, email, password \}\);/.test(SRC)
      && !/findIdentity\('email', email\)\) return bad\(res, 'we could not create an account/.test(SRC)
      && /if \(pwHash\) \{ if \(emailFree\) insertIdentity\(userId, 'email', f\.email, pwHash\); else \{ insertPasswordOnly\(userId, pwHash\); emailMiss\(missKeys\); \} \}/.test(SRC));
  }

  /* ═══ 8. a Data API key needs the owner, and a security change stops the old secret ═══ */
  {
    const k = mkUser('__pv_keyholder__');
    db.prepare("UPDATE users SET twofa_method='totp', twofa_secret='JBSWY3DPEHPK3PXP' WHERE id=?").run(k.id);
    const mint = await api('/api/data/key', { method: 'POST', sid: k.sid, body: {} });
    check('minting a data key with only a session cookie is refused', mint.status === 401 && /to mint a data key/.test((mint.j && mint.j.error) || ''), mint.status + ' ' + (mint.j && mint.j.error));
    const rot = await api('/api/data/key/rotate', { method: 'POST', sid: k.sid, body: {} });
    check('  ...and so is rotating one', rot.status === 401, rot.status);
    check('a password change, "end other sessions" and turning 2FA off reset the key\'s secret',
      (SRC.match(/resetDataKeySecret\(me\.id, /g) || []).length === 3 && /function resetDataKeySecret\(userId, why\)/.test(SRC));
    check('the Data page asks for the proof', /proofBody\('A Data API key can read your private data\.'\)/.test(readFileSync(path.join(PUB, 'data.js'), 'utf8')));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made.users) {
    for (const t of ['sessions', 'identities', 'tracked_wallets', 'notifications', 'points_events', 'uploads', 'calls', 'community_members', 'api_keys', 'alerts'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM proposals WHERE author_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  for (const c of made.communities) { try { db.prepare('DELETE FROM proposals WHERE community_id=?').run(c); db.prepare('DELETE FROM communities WHERE id=?').run(c); } catch {} }
  for (const f of made.files) { try { unlinkSync(path.join(UPLOADS, f)); } catch {} }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_pv\\_%' ESCAPE '\\' OR username LIKE 'deleted-%'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
