/* Conviction Play logos: one current logo per convicted token, kept on our own disk and served versioned.

   The pure pieces (which Dexscreener address counts as the token's logo, at what size) are pulled out of
   server.js and driven directly. The route and the pins API are driven through a real server, with the
   cached logo written straight into the throwaway data directory: the test never depends on Dexscreener
   having any particular artwork. Every row and file made here is removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, DATA_DIR, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const SRC = readFileSync(SERVER_JS, 'utf8');
const LOGO_DIR = path.join(DATA_DIR, 'logos');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const tag = randomBytes(3).toString('hex');
const made = { users: [], toks: [], files: [] };

// ---- the pure pieces, as server.js has them ----
const grab = (re, what) => { const m = SRC.match(re); if (!m) { console.error('could not extract ' + what); process.exit(1); } return m[0]; };
const pure = new Function(
  grab(/function dexCdnImg\(u\) \{[\s\S]*?\n\}/, 'dexCdnImg') + '\n' +
  'const LOGO_PX = ' + (SRC.match(/const LOGO_PX = (\d+);/) || [])[1] + ';\n' +
  grab(/function logoVariant\(u\) \{[\s\S]*?\n\}/, 'logoVariant') + '\n' +
  grab(/function dexLogoFrom\(pairs, tok\) \{[\s\S]*?\n\}/, 'dexLogoFrom') + '\n' +
  grab(/function safeHttpUrl\(u\) \{[\s\S]*?\n\}/, 'safeHttpUrl') + '\n' +
  grab(/function brandLinks\(arr\) \{[\s\S]*?\n\}/, 'brandLinks') + '\n' +
  grab(/const SOCIAL_TYPES = new Set\([^\n]*\n/, 'SOCIAL_TYPES') +
  grab(/function brandSocials\(arr\) \{[\s\S]*?\n\}/, 'brandSocials') + '\n' +
  grab(/function brandFromDex\(dex\) \{[\s\S]*?\n\}/, 'brandFromDex') + '\n' +
  grab(/function dexBrandFrom\(pairs, tok\) \{[\s\S]*?\n\}/, 'dexBrandFrom') + '\n' +
  'return { logoVariant, dexLogoFrom, dexBrandFrom };')();
const { logoVariant, dexLogoFrom, dexBrandFrom } = pure;

const CMS = 'https://cdn.dexscreener.com/cms/images/';
check('a Dexscreener logo is asked for at 128 px, whatever size the answer named', logoVariant(CMS + 'sEfAWRHDNXBrtZLY?width=800&height=800&quality=95&format=auto') === CMS + 'sEfAWRHDNXBrtZLY?width=128&height=128', logoVariant(CMS + 'sEfAWRHDNXBrtZLY?width=800&height=800&quality=95&format=auto'));
check('  ...so the same artwork at another size is the same logo, and a new id is a new one', logoVariant(CMS + 'abc?width=64') === logoVariant(CMS + 'abc') && logoVariant(CMS + 'abc') !== logoVariant(CMS + 'abd'));
check('  ...a #fragment cannot smuggle the full-size picture past that', logoVariant(CMS + 'abc?width=1500&height=1500#x') === CMS + 'abc?width=128&height=128', logoVariant(CMS + 'abc?width=1500&height=1500#x'));
check('  ...another Dexscreener address shape is kept as it is (its key changes with the artwork)', logoVariant('https://dd.dexscreener.com/ds-data/tokens/robinhood/0xabc.png?key=1') === 'https://dd.dexscreener.com/ds-data/tokens/robinhood/0xabc.png?key=1');
check('  ...and nothing off Dexscreener\'s CDN is ever a logo', [null, '', 'javascript:alert(1)', 'https://evil.example/x.png', 'http://cdn.dexscreener.com/cms/images/a', 'https://cdn.dexscreener.com/cms/images/a"onerror=x'].every((u) => logoVariant(u) === null));
const T = '0x' + 'ab'.repeat(20), O = '0x' + 'cd'.repeat(20);
const pairs = [
  { baseToken: { address: T.toUpperCase().replace('0X', '0x') }, liquidity: { usd: 50 }, info: { imageUrl: CMS + 'shallow' } },
  { baseToken: { address: T }, liquidity: { usd: 9000 }, info: { imageUrl: CMS + 'deep?width=800' } },
  { baseToken: { address: T }, liquidity: { usd: 99999 }, info: {} },
  { baseToken: { address: O }, liquidity: { usd: 1e9 }, info: { imageUrl: CMS + 'other' } },
];
check('the logo is read from the deepest pool of THAT token that carries one', dexLogoFrom(pairs, T) === CMS + 'deep?width=128&height=128', dexLogoFrom(pairs, T));
check('  ...no pool with artwork means no logo (null), never another token\'s', dexLogoFrom([pairs[2], pairs[3]], T) === null && dexLogoFrom(null, T) === null);

const withInfo = [
  { baseToken: { address: T }, liquidity: { usd: 10 }, info: { imageUrl: CMS + 'small', header: CMS + 'smallhead' } },
  { baseToken: { address: T }, liquidity: { usd: 5000 }, info: { imageUrl: CMS + 'big?width=800', header: CMS + 'bighead?width=1500', websites: [{ url: 'https://example.org', label: 'Site' }], socials: [{ type: 'twitter', url: 'https://x.com/example' }] } },
];
const bb = dexBrandFrom(withInfo, T);
check('a community\'s branding is read from the deepest pool of its token that carries any, at full size', bb && bb.imageUrl === CMS + 'big?width=800' && bb.header === CMS + 'bighead?width=1500' && bb.websites.length === 1 && bb.socials.length === 1, JSON.stringify(bb));
check('  ...an answer with no artwork gives nothing, so a community\'s stored banner is never blanked', dexBrandFrom([{ baseToken: { address: T }, liquidity: { usd: 9 }, info: { websites: [{ url: 'https://example.org' }] } }], T) === null && dexBrandFrom([], T) === null && dexBrandFrom(withInfo, O) === null);

// ---- the server ----
const get = async (p, headers = {}, method = 'GET', body) => { const r = await fetch(BASE + p, { method, headers, body }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, h: (k) => r.headers.get(k) || '', buf, json: () => JSON.parse(buf.toString('utf8')) }; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('seo-logo-test-2')]);   // still starts with the PNG signature: a "new" picture
const etagOf = (b) => createHash('sha1').update(b).digest('hex').slice(0, 16);
function putLogo(tok, buf, url) {
  mkdirSync(LOGO_DIR, { recursive: true });
  const etag = etagOf(buf), file = tok + '-' + etag + '.png';
  writeFileSync(path.join(LOGO_DIR, file), buf); made.files.push(file);
  db.prepare(`INSERT INTO token_logos (token_addr, latest_url, src_url, file, type, bytes, etag, source, seen_at, changed_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(token_addr) DO UPDATE SET latest_url = excluded.latest_url, src_url = excluded.src_url, file = excluded.file, type = excluded.type,
      bytes = excluded.bytes, etag = excluded.etag, source = excluded.source, seen_at = excluded.seen_at, changed_at = excluded.changed_at`)
    .run(tok, url, url, file, 'image/png', buf.length, etag, 'dexscreener', Date.now(), Date.now());
  return etag;
}

try {
  const name = 'PinLogo_' + tag;
  const uid = Number(db.prepare('INSERT INTO users (username, created_at, avatar, bio, auto_named) VALUES (?,?,?,?,0)').run(name, Date.now(), '🧪', '').lastInsertRowid);
  made.users.push(uid);
  const tokA = '0x' + randomBytes(20).toString('hex'), tokB = '0x' + randomBytes(20).toString('hex');
  made.toks.push(tokA, tokB);
  const oldUrl = CMS + 'zzPinLogoNoSuchImage' + tag + '?width=800&height=800&quality=95&format=auto';
  const pin = db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, pair_addr, symbol, name, brand, added_at) VALUES (?,?,?,?,?,?,?)');
  pin.run(uid, tokA, null, 'AAA', 'Token A', JSON.stringify({ imageUrl: oldUrl }), Date.now() - 2000);
  pin.run(uid, tokB, null, 'BBB', 'Token B', null, Date.now() - 1000);

  // 1. before any logo is on disk: the pin's own address, at the chip size, and only ever through our proxy
  const e1 = putLogo(tokB, PNG, CMS + 'bbb?width=128&height=128');
  let r = await get('/api/pins?user=' + name);
  let pins = r.status === 200 ? r.json().pins : [];
  const pa = pins.find((x) => x.token === tokA), pb = pins.find((x) => x.token === tokB);
  check('a pin with no logo on disk yet shows its own address at 128 px, through /api/img', pa && pa.brand && pa.brand.imageUrl === '/api/img?u=' + encodeURIComponent(CMS + 'zzPinLogoNoSuchImage' + tag + '?width=128&height=128'), pa && JSON.stringify(pa.brand));
  check('a pin whose token has a logo on disk shows our copy, versioned', pb && pb.brand && pb.brand.imageUrl === '/api/logo/' + tokB + '?v=' + e1, pb && JSON.stringify(pb.brand));
  check('  ...even though the pin itself stored no logo when it was made', pb && pb.brand);

  // 2. the route
  r = await get('/api/logo/' + tokB + '?v=' + e1);
  check('/api/logo serves the cached bytes as the type they really are', r.status === 200 && r.h('content-type') === 'image/png' && r.buf.equals(PNG), r.status + ' ' + r.h('content-type'));
  check('  ...the exact version is cached for good', /immutable/.test(r.h('cache-control')) && /max-age=31536000/.test(r.h('cache-control')), r.h('cache-control'));
  check('  ...and served like the image proxy: nosniff, a sandboxing CSP, same-origin only, noindex', r.h('x-content-type-options') === 'nosniff' && /sandbox/.test(r.h('content-security-policy')) && r.h('cross-origin-resource-policy') === 'same-origin' && /noindex/.test(r.h('x-robots-tag')));
  const r2 = await get('/api/logo/' + tokB);
  check('without the version it is only cached for minutes, so a changed logo reaches everyone', r2.status === 200 && /max-age=300\b/.test(r2.h('cache-control')) && !/immutable/.test(r2.h('cache-control')), r2.h('cache-control'));
  const r3 = await get('/api/logo/' + tokB, { 'If-None-Match': '"' + e1 + '"' }), r4 = await get('/api/logo/' + tokB, { 'If-None-Match': 'W/"' + e1 + '"' });
  check('a repeat with its ETag is a 304 (the weak form too)', r3.status === 304 && r4.status === 304 && r3.buf.length === 0, r3.status + ' ' + r4.status);
  const rh = await get('/api/logo/' + tokB, {}, 'HEAD');
  check('HEAD answers without a body', rh.status === 200 && rh.buf.length === 0);
  const rU = await get('/api/logo/' + tokB.toUpperCase().replace('0X', '0x'));
  check('the address is matched in any capitals', rU.status === 200 && rU.buf.equals(PNG), rU.status);
  const rN = await get('/api/logo/0x' + randomBytes(20).toString('hex'));
  check('a token with no cached logo is a 404', rN.status === 404, rN.status);

  // 3. the artwork changes: every pin of the token moves to the new version, and the old one is only revalidated
  const e2 = putLogo(tokB, PNG2, CMS + 'bbb2?width=128&height=128');
  r = await get('/api/pins?user=' + name);
  pins = r.status === 200 ? r.json().pins : [];
  const pb2 = pins.find((x) => x.token === tokB);
  check('a new logo moves the pin to the new version', e2 !== e1 && pb2 && pb2.brand && pb2.brand.imageUrl === '/api/logo/' + tokB + '?v=' + e2, pb2 && JSON.stringify(pb2.brand));
  const rOld = await get('/api/logo/' + tokB + '?v=' + e1);
  check('  ...a request for the old version gets the new picture, and is not cached for good', rOld.status === 200 && rOld.buf.equals(PNG2) && !/immutable/.test(rOld.h('cache-control')), rOld.h('cache-control'));

  // 4. a file that went missing is forgotten, not served broken (a version the memory cache has never held)
  db.prepare("UPDATE token_logos SET file = ?, etag = ? WHERE token_addr = ?").run(tokB + '-' + '0'.repeat(16) + '.png', '0'.repeat(16), tokB);
  const rM = await get('/api/logo/' + tokB + '?v=' + '0'.repeat(16));
  const after = db.prepare('SELECT file, etag FROM token_logos WHERE token_addr = ?').get(tokB);
  check('a logo whose file is gone is a 404, and the row lets go of it so it is fetched again', rM.status === 404 && after && after.file === null && after.etag === null, rM.status + ' ' + JSON.stringify(after));

  // 5. a pin's own address is never shared: another member's pin of the same token does not show it
  const uid2 = Number(db.prepare('INSERT INTO users (username, created_at, avatar, bio, auto_named) VALUES (?,?,?,?,0)').run('PinLogo2_' + tag, Date.now(), '🧪', '').lastInsertRowid);
  made.users.push(uid2);
  pin.run(uid2, tokA, null, 'AAA', 'Token A', null, Date.now());
  await get('/api/pins?user=' + name);                                  // the first member's wall: its own address, and a fallback attempt
  await sleep(2500);
  const rowA = db.prepare('SELECT file, source FROM token_logos WHERE token_addr = ?').get(tokA);
  check('a pin\'s stored address never becomes the token\'s shared logo', !rowA || (!rowA.file && rowA.source !== 'pin'), JSON.stringify(rowA));
  r = await get('/api/pins?user=PinLogo2_' + tag);
  const p2 = r.status === 200 ? r.json().pins.find((x) => x.token === tokA) : null;
  check('  ...so another member\'s pin of that token does not show it', p2 && !p2.brand, p2 && JSON.stringify(p2.brand));

  // 6. unpinning a token's last conviction drops its cached logo at once
  const tokC = '0x' + randomBytes(20).toString('hex'); made.toks.push(tokC);
  pin.run(uid, tokC, null, 'CCC', 'Token C', null, Date.now());
  const eC = putLogo(tokC, PNG, CMS + 'ccc?width=128&height=128');
  const raw = 'tok_pinlogo_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), uid, Date.now(), Date.now() + 864e5);
  made.sessions = [createHash('sha256').update(raw).digest('hex')];
  const del = await get('/api/pins', { 'Content-Type': 'application/json', Origin: BASE, Cookie: 'sid=' + raw + '; jsi_age=18' }, 'DELETE', JSON.stringify({ token: tokC }));
  const rowC = db.prepare('SELECT 1 FROM token_logos WHERE token_addr = ?').get(tokC);
  check('unpinning a token nobody else holds a conviction on removes its logo row and its file', del.status === 200 && !rowC && !existsSync(path.join(LOGO_DIR, tokC + '-' + eC + '.png')), del.status + ' ' + del.buf.toString().slice(0, 120) + ' ' + JSON.stringify(rowC));
  const rC = await get('/api/logo/' + tokC);
  check('  ...and /api/logo no longer serves it', rC.status === 404, rC.status);

  // 7. communities: the same one logo per token, on the card, the page, and a pin of the same token
  const mkComm = (tok, o) => Number(db.prepare('INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, demo, official, created_at, went_live_at, brand) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid, tok, tok, o.symbol, o.name, 'live', o.demo ? 1 : 0, 0, Date.now(), Date.now(), JSON.stringify(o.brand || null)).lastInsertRowid);
  made.comms = [];
  const tokD = '0x' + randomBytes(20).toString('hex'), tokE = '0x' + randomBytes(20).toString('hex'); made.toks.push(tokD, tokE);
  const cD = mkComm(tokD, { symbol: 'DDD', name: 'Token D', brand: { imageUrl: CMS + 'zzOldD' + tag + '?width=800&height=800', header: CMS + 'zzHeadD' + tag + '?width=1500&height=500' } });
  const cE = mkComm(tokE, { symbol: 'EEE', name: 'Token E', brand: { imageUrl: CMS + 'zzOldE' + tag + '?width=800&height=800' } });
  made.comms.push(cD, cE);
  const eD = putLogo(tokD, PNG, CMS + 'ddd?width=128&height=128');
  r = await get('/api/communities/' + cD);
  const cd = r.status === 200 ? r.json().community : null;
  check('a community\'s page shows its token\'s cached logo, versioned', cd && cd.image === '/api/logo/' + tokD + '?v=' + eD, r.status + ' ' + (cd && cd.image));
  check('  ...and its banner still comes from its stored branding, through the proxy', cd && cd.banner === '/api/img?u=' + encodeURIComponent(CMS + 'zzHeadD' + tag + '?width=1500&height=500'), cd && cd.banner);
  r = await get('/api/communities?status=live&sort=new');
  const listD = r.status === 200 ? (r.json().communities || []).find((x) => x.id === cD) : null;
  check('  ...and so does its card in the list', listD && listD.image === '/api/logo/' + tokD + '?v=' + eD, listD && listD.image);
  r = await get('/api/communities/' + cE);
  const ce = r.status === 200 ? r.json().community : null;
  check('a community with nothing cached yet shows its stored logo at 128 px, through /api/img', ce && ce.image === '/api/img?u=' + encodeURIComponent(CMS + 'zzOldE' + tag + '?width=128&height=128'), ce && ce.image);
  const demo = db.prepare('SELECT id FROM communities WHERE demo = 1 LIMIT 1').get();
  if (demo) {
    r = await get('/api/communities/' + demo.id);
    const cs = r.status === 200 ? r.json().community : null;
    check('the sandbox never shows a token logo (it has no token)', cs && !/^\/api\/logo\//.test(cs.image || ''), cs && cs.image);
  }
  // a pin of a community's token: unpinning it keeps the logo, because the community still tracks the token
  pin.run(uid, tokD, null, 'DDD', 'Token D', null, Date.now());
  const delD = await get('/api/pins', { 'Content-Type': 'application/json', Origin: BASE, Cookie: 'sid=' + raw + '; jsi_age=18' }, 'DELETE', JSON.stringify({ token: tokD }));
  const rowD = db.prepare('SELECT etag FROM token_logos WHERE token_addr = ?').get(tokD);
  check('unpinning a token that has a community keeps its logo', delD.status === 200 && rowD && rowD.etag === eD && existsSync(path.join(LOGO_DIR, tokD + '-' + eD + '.png')), delD.status + ' ' + JSON.stringify(rowD));

  // 8. the rules that live in the code
  check('the pins API reads the shared logo, not the address the pin stored', /const logo = logoUrlFor\(r\.token_addr, r\.brand\);/.test(SRC));
  check('the squad\'s conviction view reads the same logo', /if \(!t\.image\) t\.image = logoUrlFor\(r\.token_addr, r\.brand\);/.test(SRC));
  check('the market batch the pins already fetch keeps each tracked token\'s logo in step', /if \(Array\.isArray\(arr\)\) for \(const k of batch\) noteDexAnswer\(k, arr\);\n/.test(SRC));
  check('  ...and so does the communities\' market refresh', /if \(Array\.isArray\(arr\)\) for \(const k of batch\) noteDexAnswer\(k, arr\);   \/\/ the same answer keeps each token's logo and banner current/.test(SRC));
  check('every place a community logo is drawn reads the shared logo: cards and page, post badges, the weekly board', (SRC.match(/image: communityLogo\(c\)/g) || []).length === 3);
  check('a community\'s stored branding keeps its Dextools status when Dexscreener updates it', /JSON\.stringify\(\{ \.\.\.b, dextools: cur\.dextools \|\| null \}\)/.test(SRC));
  check('a token with a community (not the sandbox) is tracked, and so never loses its logo in the sweep', /FROM communities WHERE token_addr = \? COLLATE NOCASE AND demo = 0 LIMIT 1/.test(SRC) && /AND NOT EXISTS \(SELECT 1 FROM communities c WHERE c\.token_addr = l\.token_addr COLLATE NOCASE AND c\.demo = 0\)/.test(SRC));
  check('an answer with no logo never blanks one we hold (latest_url is only ever replaced, never nulled)', /latest_url = COALESCE\(excluded\.latest_url, token_logos\.latest_url\)/.test(SRC) && /else if \(!url && !row\.file\) logoFallback\(tok\);/.test(SRC));
  check('the fallback is the community\'s branding only, never a pin\'s stored address', /function logoFallback\(tok\) \{\n  let u = null;\n  try \{ const c = db\.prepare\('SELECT brand FROM communities/.test(SRC) && !/function logoFallback[\s\S]{0,600}pinned_tokens/.test(SRC));
  check('a new pin reads Dexscreener live, never the lookup\'s cached brand', /try \{ logoOnPin\(token\); \} catch \{\}/.test(SRC) && /jgetR\('https:\/\/api\.dexscreener\.com\/tokens\/v1\/robinhood\/' \+ tok\)/.test(SRC));
  check('a logo download is capped well below the banner ceiling', /const LOGO_MAX_BYTES = 3 \* 1024 \* 1024;/.test(SRC) && (SRC.match(/> LOGO_MAX_BYTES\) throw/g) || []).length === 2);
  check('the site\'s own copy never replaces Dexscreener\'s, and an older address never replaces the newest', /if \(source !== 'dexscreener' && old && old\.file && old\.source === 'dexscreener'\) return drop\(\);/.test(SRC) && /if \(source === 'dexscreener' && old && old\.latest_url && old\.latest_url !== url\) return drop\(\);/.test(SRC));
  check('downloads refuse redirects and are typed from the bytes', /redirect: 'error' \}\);\n        if \(!res\.ok\) throw new Error\('http ' \+ res\.status\);/.test(SRC) && /const type = imageTypeOf\(buf\);\s+\/\/ the bytes decide/.test(SRC));
  check('a token nobody is convicted on any more loses its logo in the sweep', /WHERE NOT EXISTS \(SELECT 1 FROM pinned_tokens p WHERE p\.token_addr = l\.token_addr\)/.test(SRC));
} catch (e) {
  check('the suite ran to the end', false, e && e.stack);
} finally {
  for (const id of made.comms || []) { try { db.prepare('DELETE FROM communities WHERE id = ?').run(id); } catch {} }
  for (const t of made.toks) { try { db.prepare('DELETE FROM pinned_tokens WHERE token_addr = ?').run(t); db.prepare('DELETE FROM token_logos WHERE token_addr = ?').run(t); } catch {} }
  for (const h of made.sessions || []) { try { db.prepare('DELETE FROM sessions WHERE token = ?').run(h); } catch {} }
  for (const id of made.users) { try { db.prepare('DELETE FROM pinned_tokens WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {} }
  for (const f of made.files) { const p = path.join(LOGO_DIR, f); try { if (existsSync(p)) rmSync(p); } catch {} }
  db.close();
}

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
