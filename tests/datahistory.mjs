/* Data history and Conviction Plays that stay (owner, 2026-10-17): "make sure people's conviction calls stay and do not
   mess up at any point, it stays forever unless the users says to delete the conviction play" and "make sure all data is
   always cached so errors like this never happen and we can restore user's data if we need to from the admin page."
   It came after a member's Conviction Play was taken off by one stray tap and its date and price were gone for good.
   Drives the real HTTP API on the runner's throwaway server (admin = user 987654) and the real page code. Everything it
   creates it deletes, its kept history included. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { ROOT, DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const PUB = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const KEYLIB = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'keys.js'));
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const ADMIN_ID = 987654, made = [], hex = (n) => randomBytes(n).toString('hex'), startId = (db.prepare('SELECT MAX(id) m FROM data_history').get() || {}).m || 0;
const sha = (t) => createHash('sha256').update(String(t)).digest('hex');
function mkUser(name, id) {
  db.prepare('DELETE FROM users WHERE username=?').run(name);
  if (id) db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(id, name, Date.now(), '🧪', Date.now(), 'ok');
  else db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const uid = db.prepare('SELECT id FROM users WHERE username=?').get(name).id; made.push(uid);
  const raw = 'tok_' + name + '_' + hex(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(sha(raw), uid, Date.now(), Date.now() + 864e5);
  return { id: uid, name, sid: raw, cookie: 'sid=' + raw };
}
async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'manual' });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, cc: r.headers.get('cache-control') || '' };
}
const raw = (method, p, cookie) => new Promise((resolve) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path: p, headers: cookie ? { Cookie: cookie } : {} }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b, cc: res.headers['cache-control'] || '' })); });
  r.on('error', () => resolve({ status: 0, text: '', cc: '' })); r.end();
});
const hist = (where, ...a) => db.prepare('SELECT * FROM data_history WHERE id > ? AND ' + where + ' ORDER BY id').all(startId, ...a);
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret) {
  let bits = 0, val = 0; const k = []; for (const c of secret) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { k.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', Buffer.from(k)).update(msg).digest(); const o = h[h.length - 1] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const TOK = '0x' + 'ab'.repeat(20), TOK2 = '0x' + 'cd'.repeat(20);

try {
  const admin = mkUser('__dh_admin__', ADMIN_ID), m = mkUser('__dh_member__'), other = mkUser('__dh_other__');

  /* ═══ 1. the history is there for every table it promises, and never holds what it must not ═══ */
  const trig = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'hist_%'").all().map((r) => r.name));
  const want = ['pinned_tokens', 'posts', 'comments', 'hop_comments', 'calls', 'community_members', 'squad_members', 'watchlist', 'follows', 'alerts'];
  check('every kind of member data it promises is kept: a trigger on each deletion, and on changes that matter (Conviction Plays, posts, comments, Send Calls, profile, Diamond Hands streak)',
    want.every((t) => trig.has('hist_' + t + '_del')) && ['pinned_tokens', 'posts', 'comments', 'hop_comments', 'calls', 'users', 'holder_state'].every((t) => trig.has('hist_' + t + '_upd')) && !trig.has('hist_users_del') && !trig.has('hist_holder_state_del'), [...trig].sort().join(' '));
  const never = new Set([...KEYLIB.ENC_FIELDS, ...KEYLIB.ENC_BLOBS].map(([t, c]) => t + '.' + c).concat(KEYLIB.IDX_COLUMNS.map((x) => x.t + '.' + x.c)));
  const trigSql = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'hist_%'").all();
  const leaks = [];
  for (const { name, sql } of trigSql) {
    const t = name.replace(/^hist_|_(del|upd)$/g, '');
    for (const mm of sql.matchAll(/OLD\."([a-z_0-9]+)"/g)) if (never.has(t + '.' + mm[1]) || /^(ip|wallet|join_ip|twofa_secret|twofa_pending|site_prefs|tracker_prefs|signup_ip|last_ip|holder_proof|gate_wallets)$/.test(mm[1])) leaks.push(t + '.' + mm[1]);
  }
  check('  ...and never copies a password, a sign-in secret, an IP or wallet hash, a wallet, or anything a key protects (lib/keys.js registry): key rotation and the IP erasure sweeps would never reach a copy',
    trigSql.length >= 15 && leaks.length === 0, leaks.join(', ') || trigSql.length + ' triggers');
  const users0 = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'hist_users_upd'").get();
  check('  ...a key rotation or a preference change writes no history (only the columns that matter set it off)',
    !!users0 && !/OLD\."(site_prefs|tracker_prefs|twofa_secret|points)"/.test(users0.sql) && /AFTER UPDATE OF "username", "avatar", "bio"/.test(users0.sql));

  /* ═══ 2. a Conviction Play stays until its owner removes it, deliberately ═══ */
  const T0 = Date.now() - 20 * 864e5;
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, pair_addr, symbol, name, brand, added_at, pin_price, pin_mc) VALUES (?,?,?,?,?,?,?,?,?)').run(m.id, TOK, TOK2, 'DHT', 'History Token', null, T0, 0.00008007, 760732);
  const noWord = await api('/api/pins', { method: 'DELETE', cookie: m.cookie, body: { token: TOK } });
  const still = db.prepare('SELECT added_at, pin_price FROM pinned_tokens WHERE user_id = ? AND token_addr = ?').get(m.id, TOK);
  check('a Conviction Play is not taken off by a request that does not say so in words (confirm: REMOVE) — the one a stray tap used to send',
    noWord.status === 400 && /removed only from your own profile/.test(noWord.j && noWord.j.error) && still && still.added_at === T0, noWord.status + ' ' + JSON.stringify(noWord.j));
  const NP = PUB('newpairs.js');
  const handler = NP.slice(NP.indexOf("  document.addEventListener('click', async (e) => {\n    const btn = e.target.closest('[data-pin]');"), NP.indexOf('  /* ---------- formatting ---------- */'));
  function pinRig(serverHas) {
    const sent = [], toasts = [], set = new Set([TOK]);   // the page believes it is pinned
    const docStub = { addEventListener: (t, f) => { docStub.f = f; }, querySelectorAll: () => [], dispatchEvent() {} };
    new Function('document', 'window', 'fetch', 'isPinned', 'pinnedTokens', 'loadPinnedIds', 'paintPins', 'sendToast', 'SFX', 'AUTH', 'CustomEvent', handler)(
      docStub, { AUTH: { user: { username: 'x' } }, sendToast: (t) => toasts.push(t), SFX: { play() {} } },
      (u, o) => { sent.push((o && o.method) || 'GET'); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
      (a) => set.has(String(a).toLowerCase()), set, async () => { set.clear(); if (serverHas) set.add(TOK); }, () => {}, (t) => toasts.push(t), { play() {} }, { user: { username: 'x' } }, function () {});
    return { sent, toasts, tap: () => docStub.f({ target: { closest: () => ({ dataset: { pin: TOK, sym: 'DHT' }, disabled: false }) }, preventDefault() {}, stopPropagation() {} }) };
  }
  const still1 = pinRig(true); await still1.tap();
  const stale = pinRig(false); await stale.tap();
  check('  ...every pin button around the site only ever adds: on a token still pinned it sends nothing and says it stays until removed from the profile; one removed in another tab is checked with the server and added again, not reported as still there',
    still1.sent.length === 0 && /is one of your Conviction Plays — it stays until you remove it from your profile/.test(still1.toasts.join(' ')) && !/method: 'DELETE'/.test(handler) && !/takes it off|tap to remove/.test(NP)
    && stale.sent.join() === 'POST' && !/is one of your Conviction Plays/.test(stale.toasts.join(' ')), JSON.stringify({ still: still1.sent, stale: stale.sent }));
  check('  ...a pinned token\'s button is not a toggle (no pressed state) and its tip says how removal works; a removal anywhere on the page repaints them',
    !/aria-pressed="' \+ on/.test(NP) && /b\.removeAttribute\('aria-pressed'\)/.test(NP) && /const PIN_TIP_ON = 'Already one of your Conviction Plays — to take it off, use Remove on your own profile';/.test(NP)
    && /document\.addEventListener\('pins:changed', async \(e\) => \{ const t = e\.detail && e\.detail\.token; await loadPinnedIds\(\); if \(t\) paintPins/.test(NP));
  // the profile's Remove, run: removeTap/removeDisarm from upage.js with a clock and a server the test controls
  const UP = PUB('upage.js');
  const rmSrc = UP.slice(UP.indexOf("const RM_TIP = "), UP.indexOf('function renderPins(u) {'));
  function rmRig(ok, refuse) {
    const T = { now: 1e6 }, sent = [], timers = [];
    const R = new Function('Date', 'fetch', 'setTimeout', 'clearTimeout', 'window', 'document', 'CustomEvent', 'renderPins', 'sendToast', 'SFX', rmSrc + '\nreturn { removeTap, removeDisarm };')(
      { now: () => T.now }, (u, o) => { sent.push(o && JSON.parse(o.body)); return ok ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }) : refuse ? Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'sign in first' }) }) : Promise.reject(new Error('net')); },
      (f, ms) => { timers.push({ f, ms }); return timers.length; }, (n) => { if (timers[n - 1]) timers[n - 1].done = true; }, {}, { dispatchEvent() {} }, function () {}, () => {}, () => {}, { play() {} });
    const cls = new Set(), attrs = {};
    const rm = { dataset: { pinRm: TOK, sym: 'DHT' }, textContent: '✕', disabled: false, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) }, setAttribute: (k, v) => { attrs[k] = v; } };
    return { T, R, rm, sent, timers, cls };
  }
  const q = rmRig(true);
  const r1 = await q.R.removeTap(q.rm, { detail: 1 }, null); const asks = q.rm.textContent === 'Remove $DHT?' && q.sent.length === 0;
  q.T.now += 120; const r2 = await q.R.removeTap(q.rm, { detail: 2 }, null);
  q.T.now += 100; const r3 = await q.R.removeTap(q.rm, { detail: 1 }, null);
  q.T.now += 700; const r4 = await q.R.removeTap(q.rm, { detail: 1 }, null);
  check('  ...the profile\'s Remove: the first tap asks ("Remove $X?"); a double-click or a tap within 600 ms is not an answer; a later tap sends confirm: REMOVE',
    r1 === 'armed' && asks && r2 === 'too-soon' && r3 === 'too-soon' && r4 === 'removed' && q.sent.length === 1 && q.sent[0].confirm === 'REMOVE' && q.sent[0].token === TOK, [r1, r2, r3, r4].join(','));
  const f = rmRig(false);
  await f.R.removeTap(f.rm, { detail: 1 }, null); f.T.now += 700; const fr = await f.R.removeTap(f.rm, { detail: 1 }, null);
  const disarmed = fr === 'failed' && !f.rm.dataset.armed && f.rm.textContent === '✕' && !f.cls.has('is-armed');
  f.T.now += 60000; const later = await f.R.removeTap(f.rm, { detail: 1 }, null);
  const ref = rmRig(false, true); await ref.R.removeTap(ref.rm, { detail: 1 }, null); ref.T.now += 700; const refR = await ref.R.removeTap(ref.rm, { detail: 1 }, null);
  ref.T.now += 60000; const refLater = await ref.R.removeTap(ref.rm, { detail: 1 }, null);
  const lapse = rmRig(true); await lapse.R.removeTap(lapse.rm, { detail: 1 }, null); lapse.timers.filter((x) => x.ms === 5000).forEach((x) => x.f());
  check('  ...a failed removal (the connection dropped, or the server refused) puts it back to ✕, so a later single tap only asks again (never removes); an unanswered question lapses after five seconds',
    disarmed && later === 'armed' && f.sent.length === 1 && refR === 'failed' && refLater === 'armed' && ref.sent.length === 1 && lapse.rm.textContent === '✕' && !lapse.rm.dataset.armed, JSON.stringify({ fr, later, refR, refLater }));
  check('  ...armed, it grows into a pill instead of spilling over the tag beside it (where a tap would land on it)',
    /html \.pin-chip-rm\.is-armed \{ width: auto; height: auto; padding: 2px 0\.6rem;/.test(PUB('responsive.css')) && PUB('responsive.css').indexOf('html .pin-chip-rm.is-armed') > PUB('responsive.css').indexOf('html .pin-chip-rm {'));
  const gone = await api('/api/pins', { method: 'DELETE', cookie: m.cookie, body: { token: TOK, confirm: 'REMOVE' } });
  const kept = hist("tbl = 'pinned_tokens' AND user_id = ? AND op = 'delete'", m.id);
  const keptOld = kept.length ? JSON.parse(kept[kept.length - 1].old_json) : {};
  check('  ...removed that way it goes — and its date and price are kept in the history', gone.status === 200 && !db.prepare('SELECT 1 FROM pinned_tokens WHERE user_id = ? AND token_addr = ?').get(m.id, TOK)
    && keptOld.added_at === T0 && keptOld.pin_price === 0.00008007 && keptOld.pin_mc === 760732, JSON.stringify(keptOld));
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, pair_addr, symbol, name, brand, added_at, pin_price, pin_mc) VALUES (?,?,?,?,?,?,?,?,?)').run(m.id, TOK, TOK2, 'DHT', 'History Token', null, Date.now(), 0.0001878, 1784256);   // pinned again: a new baseline

  /* ═══ 3. the admin can see it, and put it back ═══ */
  const variants = [['GET', '/adminrestore.js'], ['HEAD', '/adminrestore.js'], ['POST', '/adminrestore.js'], ['GET', '/AdminRestore.js'], ['GET', '/.//adminrestore.js'], ['GET', '/x/..//adminrestore.js'], ['GET', '/%2e//adminrestore.js']];
  const leaked = [];
  for (const [who, cookie] of [['visitor', null], ['member', m.cookie]]) {
    for (const [mt, pth] of variants) { const r = await raw(mt, pth, cookie); if (r.status !== 404 || /api\/admin\/history/.test(r.text)) leaked.push(who + ' ' + mt + ' ' + pth + ' → ' + r.status); }
    const g = await api('/api/admin/history?user=' + m.name, { cookie }), po = await api('/api/admin/history/restore', { method: 'POST', cookie, body: { id: 1, confirm: 'RESTORE' } });
    if (g.status !== 404 || po.status !== 404) leaked.push(who + ' routes → ' + g.status + '/' + po.status);
  }
  const js = await raw('GET', '/adminrestore.js', admin.cookie);
  check('the restore page script and its routes are the admin\'s alone: a visitor and a member get 404 for every spelling and method; the admin gets it, kept by nobody',
    leaked.length === 0 && js.status === 200 && /\/api\/admin\/history/.test(js.text) && /private/.test(js.cc) && /no-store/.test(js.cc), leaked.join(' | ') || js.status + ' ' + js.cc);
  const list = await api('/api/admin/history?user=' + m.name.toUpperCase(), { cookie: admin.cookie });
  const pinEntry = list.j && list.j.entries.find((e) => e.tbl === 'pinned_tokens' && e.op === 'delete');
  check('  ...the admin looks a member up (any capitals) and sees what is kept, newest first: what it was, and what is there now',
    list.status === 200 && list.j.user.username === m.name && pinEntry && pinEntry.old.added_at === T0 && pinEntry.now && pinEntry.now.pin_price === 0.0001878 && pinEntry.restorable && list.j.entries.every((e, i, a) => !i || a[i - 1].id > e.id) && /no-store/.test(list.cc),
    JSON.stringify(pinEntry));
  const noSudo = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: pinEntry.id, confirm: 'RESTORE' } });
  db.prepare('UPDATE sessions SET sudo_until = ? WHERE token = ?').run(Date.now() + 5 * 6e4, sha(admin.sid));
  const noWord2 = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: pinEntry.id } });
  const back = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: pinEntry.id, confirm: 'RESTORE' } });
  const nowPin = db.prepare('SELECT added_at, pin_price, pin_mc FROM pinned_tokens WHERE user_id = ? AND token_addr = ?').get(m.id, TOK);
  const replaced = hist("tbl = 'pinned_tokens' AND user_id = ? AND op = 'update'", m.id).map((r) => JSON.parse(r.old_json));
  check('  ...putting it back needs "confirm it\'s you" and the word RESTORE; then the Conviction Play has its original date and price again',
    noSudo.status === 401 && noSudo.j.code === 'need_verify' && noWord2.status === 400 && back.status === 200 && nowPin && nowPin.added_at === T0 && nowPin.pin_price === 0.00008007 && nowPin.pin_mc === 760732,
    [noSudo.status, noWord2.status, back.status, JSON.stringify(nowPin)].join(' '));
  check('  ...and the version it replaced is kept in its turn, so the restore can itself be undone; the entry says when it was put back',
    replaced.some((o) => o.pin_price === 0.0001878) && db.prepare('SELECT restored_at, restored_by FROM data_history WHERE id = ?').get(pinEntry.id).restored_by === ADMIN_ID, JSON.stringify(replaced));

  /* ═══ 4. the other kinds: a post, a profile, a streak, a membership, a Send Call ═══ */
  const pid = Number(db.prepare('INSERT INTO posts (user_id, text, created_at) VALUES (?,?,?)').run(m.id, 'first words', Date.now()).lastInsertRowid);
  db.prepare('UPDATE posts SET text = ? WHERE id = ?').run('second words', pid);
  const pdel = await api('/api/posts/' + pid, { method: 'DELETE', cookie: m.cookie });
  const pe = hist("tbl = 'posts' AND row_key = ?", String(pid));
  const pRestore = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: pe.find((e) => e.op === 'delete').id, confirm: 'RESTORE' } });
  const pBack = db.prepare('SELECT user_id, text FROM posts WHERE id = ?').get(pid);
  check('a post: an edit and a deletion are both kept; put back, it returns under its own number, with the words it last had',
    pdel.status === 200 && pe.map((e) => e.op).join() === 'update,delete' && JSON.parse(pe[0].old_json).text === 'first words' && pRestore.status === 200 && pBack && pBack.text === 'second words' && pBack.user_id === m.id, JSON.stringify({ pe: pe.map((e) => e.op), pBack }));
  db.prepare("UPDATE users SET bio = 'old bio', twitter_handle = 'old_x' WHERE id = ?").run(m.id);
  db.prepare("UPDATE users SET bio = 'new bio', site_prefs = '{\"z\":1}' WHERE id = ?").run(m.id);
  const ue = hist("tbl = 'users' AND user_id = ?", m.id);
  const lastU = ue.length ? JSON.parse(ue[ue.length - 1].old_json) : {};
  const uRestore = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: ue[ue.length - 1].id, confirm: 'RESTORE' } });
  check('a profile: a change of name, picture, bio or handles is kept — never its secrets or preferences — and can be set back',
    lastU.bio === 'old bio' && !('site_prefs' in lastU) && !('twofa_secret' in lastU) && !('signup_ip' in lastU) && uRestore.status === 200 && db.prepare('SELECT bio FROM users WHERE id = ?').get(m.id).bio === 'old bio', JSON.stringify(lastU));
  db.prepare('INSERT OR REPLACE INTO holder_state (user_id, score_bp, streak_start, base_bp, paused_ms, updated_at) VALUES (?,?,?,?,?,?)').run(m.id, 100, T0, 100, 30 * 864e5, Date.now());
  db.prepare('UPDATE holder_state SET streak_start = ?, base_bp = 0, paused_ms = 0, send_tok = 5 WHERE user_id = ?').run(Date.now(), m.id);   // a sale resets it
  const he = hist("tbl = 'holder_state' AND user_id = ?", m.id);
  const hRestore = he.length ? await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: he[he.length - 1].id, confirm: 'RESTORE' } }) : { status: 0 };
  const hNow = db.prepare('SELECT streak_start, base_bp, paused_ms FROM holder_state WHERE user_id = ?').get(m.id);
  check('a Diamond Hands streak that is reset is kept and set back whole — its start, its base and its paused time together (paused days are never counted as held)',
    he.length === 1 && JSON.parse(he[0].old_json).streak_start === T0 && !('send_tok' in JSON.parse(he[0].old_json)) && hRestore.status === 200 && hNow.streak_start === T0 && hNow.base_bp === 100 && hNow.paused_ms === 30 * 864e5, JSON.stringify(hNow));
  const cid = Number(db.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, brand, status, created_at) VALUES (?,?,?,?,?,?,?,?)").run(other.id, TOK2, TOK, 'DHC', 'History Community', '{}', 'pending', Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO community_members (community_id, user_id, joined_at, conviction_xp, qualified, join_ip) VALUES (?,?,?,?,?,?)').run(cid, m.id, T0, 40, 1, hex(32));
  db.prepare('DELETE FROM community_members WHERE community_id = ? AND user_id = ?').run(cid, m.id);
  const ce = hist("tbl = 'community_members' AND user_id = ?", m.id);
  const ceOld = ce.length ? JSON.parse(ce[0].old_json) : {};
  const ceList = (await api('/api/admin/history?user=' + m.name, { cookie: admin.cookie })).j.entries.find((e) => e.tbl === 'community_members');
  db.prepare('INSERT INTO community_members (community_id, user_id, joined_at, conviction_xp, qualified) VALUES (?,?,?,?,?)').run(cid, m.id, Date.now(), 900, 1);   // rejoined since, with more XP
  const cRestore = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: ce[0].id, confirm: 'RESTORE' } });
  const rejoinKept = hist("tbl = 'community_members' AND user_id = ? AND op = 'update'", m.id).some((r) => JSON.parse(r.old_json).conviction_xp === 900);
  const cBack = db.prepare('SELECT conviction_xp, joined_at, join_ip FROM community_members WHERE community_id = ? AND user_id = ?').get(cid, m.id), counts = db.prepare('SELECT member_count, qual_count FROM communities WHERE id = ?').get(cid);
  check('a community membership: kept without its network hash, named in the list, and put back with its level and the community\'s counts recounted — over a rejoined one, which is kept in its turn (a table with no change trigger too)',
    !('join_ip' in ceOld) && ceOld.conviction_xp === 40 && ceList && ceList.ctx === '$DHC community' && cRestore.status === 200 && cBack && cBack.conviction_xp === 40 && cBack.joined_at === T0 && cBack.join_ip == null && counts.member_count === 1 && counts.qual_count === 1
    && rejoinKept, JSON.stringify({ ceOld, cBack, counts, rejoinKept }));
  const callId = Number(db.prepare('INSERT INTO calls (user_id, token_addr, pair_addr, symbol, entry_price, entry_mc, peak_price, created_at, ip, wallet) VALUES (?,?,?,?,?,?,?,?,?,?)').run(m.id, TOK, TOK2, 'DHT', 0.0002034, 1932920, 0.0002034, T0, hex(32), '0x' + hex(20)).lastInsertRowid);
  db.prepare('UPDATE calls SET cur_price = 1, peak_price = 2, last_check = ?, snapshot = ? WHERE id = ?').run(Date.now(), 'x'.repeat(30000), callId);
  db.prepare('UPDATE calls SET post_id = ? WHERE id = ?').run(pid, callId);   // what POST /api/calls does a moment after making every call
  const sweeps = hist("tbl = 'calls' AND row_key = ?", String(callId)).length;
  db.prepare('UPDATE calls SET entry_price = 9 WHERE id = ?').run(callId);
  const callE = hist("tbl = 'calls' AND row_key = ?", String(callId));
  check('a Send Call: the price sweeps that run all day, and linking a new call to its post, write nothing; a change to how it was made is kept (never its wallet, network or 40 KB snapshot), and can be set back',
    sweeps === 0 && callE.length === 1 && JSON.parse(callE[0].old_json).entry_price === 0.0002034 && !('ip' in JSON.parse(callE[0].old_json)) && !('wallet' in JSON.parse(callE[0].old_json)) && !('snapshot' in JSON.parse(callE[0].old_json)) && callE[0].old_json.length < 2000
    && (await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: callE[0].id, confirm: 'RESTORE' } })).status === 200 && db.prepare('SELECT entry_price FROM calls WHERE id = ?').get(callId).entry_price === 0.0002034, sweeps + ' / ' + callE.length);
  db.prepare('DELETE FROM calls WHERE id = ?').run(callId);
  // a value that cannot be JSON never makes the member's own action fail
  const bid = Number(db.prepare('INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)').run(pid, m.id, Buffer.from([1, 2, 3]), Date.now()).lastInsertRowid);
  let blobOk = true; try { db.prepare('DELETE FROM comments WHERE id = ?').run(bid); } catch { blobOk = false; }
  const be = hist("tbl = 'comments' AND row_key = ?", String(bid));
  check('a value the history cannot hold as JSON never makes the member\'s own action fail (it is kept as empty)', blobOk && be.length === 1 && JSON.parse(be[0].old_json).text === null);

  /* ═══ 4b. what is not kept, and what cannot be put back ═══ */
  const tpid = Number(db.prepare('INSERT INTO posts (user_id, text, created_at) VALUES (?,?,?)').run(m.id, 'abusive words', Date.now()).lastInsertRowid);
  db.prepare('INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)').run(tpid, other.id, 'a reply', Date.now());
  const td = await api('/api/admin/takedown', { method: 'POST', cookie: admin.cookie, body: { kind: 'post', id: tpid, note: 'test' } });
  const tdKept = hist("(tbl = 'posts' AND row_key = ?) OR (tbl = 'comments' AND json_extract(old_json, '$.post_id') = ?)", String(tpid), tpid);
  const cpost = Number(db.prepare('INSERT INTO posts (user_id, text, created_at) VALUES (?,?,?)').run(other.id, 'fine post', Date.now()).lastInsertRowid);
  const ccid = Number(db.prepare('INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)').run(cpost, m.id, 'abusive reply', Date.now()).lastInsertRowid);
  const tdc = await api('/api/admin/takedown', { method: 'POST', cookie: admin.cookie, body: { kind: 'comment', id: ccid } });
  const tdcKept = hist("tbl = 'comments' AND row_key = ?", String(ccid)).length;
  check('what a moderator takes down is not kept: a post and the comments that went with it, or a comment on its own, leave no earlier version to bring back', td.status === 200 && !db.prepare('SELECT 1 FROM posts WHERE id = ?').get(tpid) && tdKept.length === 0 && tdc.status === 200 && tdcKept === 0, td.status + ' · ' + tdKept.length + ' · ' + tdc.status + ' · ' + tdcKept);
  const gone2 = mkUser('__dh_gone__');
  db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(m.id, gone2.id, Date.now());
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(m.id, gone2.id);   // unfollowed
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(Date.now(), gone2.id);              // and that account was deleted since
  const fe = (await api('/api/admin/history?user=' + m.name + '&kind=follows', { cookie: admin.cookie })).j;
  const fEntry = fe.entries[0];
  const fTry = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: fEntry.id, confirm: 'RESTORE' } });
  check('an entry that cannot be put back says why (a follow of an account deleted since) and is refused — the list filters by kind, and says it neutrally',
    fe.entries.length === 1 && fEntry.tbl === 'follows' && fEntry.restorable === false && /deleted/.test(fEntry.blocked) && fTry.status === 409 && !db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(m.id, gone2.id)
    && fe.kinds.some((k) => k.kind === 'pinned_tokens'), JSON.stringify(fEntry));
  // the Conviction Play limit holds for a restore too
  const pm = mkUser('__dh_pinmax__');
  for (let i = 0; i < 12; i++) db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, added_at) VALUES (?,?,?,?)').run(pm.id, '0x' + String(i).padStart(40, '0'), 'P' + i, Date.now());
  db.prepare('DELETE FROM pinned_tokens WHERE user_id = ? AND token_addr = ?').run(pm.id, '0x' + '0'.repeat(40));
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, added_at) VALUES (?,?,?,?)').run(pm.id, TOK2, 'NEW', Date.now());
  const pmE = hist("tbl = 'pinned_tokens' AND user_id = ? AND op = 'delete'", pm.id);
  const pmTry = await api('/api/admin/history/restore', { method: 'POST', cookie: admin.cookie, body: { id: pmE[0].id, confirm: 'RESTORE' } });
  check('  ...a removed Conviction Play is not put back over the 12-play limit (one has to go first)', pmTry.status === 409 && /12 Conviction Plays/.test(pmTry.j.error), pmTry.status + ' ' + (pmTry.j && pmTry.j.error));
  // paging: older entries are reachable
  for (let i = 0; i < 210; i++) { db.prepare('INSERT INTO watchlist (user_id, pair_addr, token_addr, added_at) VALUES (?,?,?,?)').run(m.id, '0xf' + String(i).padStart(39, '0'), TOK, Date.now()); }
  db.prepare('DELETE FROM watchlist WHERE user_id = ?').run(m.id);
  const p1 = (await api('/api/admin/history?user=' + m.name, { cookie: admin.cookie })).j;
  const p2 = (await api('/api/admin/history?user=' + m.name + '&before=' + p1.more, { cookie: admin.cookie })).j;
  check('  ...a member with more history than one page: the page says how many, and "older" reaches the rest (a Conviction Play removed long ago is still findable)',
    p1.entries.length === 200 && !!p1.more && p2.entries.length > 0 && p2.entries[0].id < p1.entries[199].id && p2.entries.some((e) => e.tbl === 'pinned_tokens') && /id="adm-hist-older"/.test(PUB('admin.html')), p1.entries.length + ' + ' + p2.entries.length);
  // the triggers keep exactly today's columns (a column a later migration added is kept too)
  const never2 = new Set([...KEYLIB.ENC_FIELDS, ...KEYLIB.ENC_BLOBS].map(([t, c]) => t + '.' + c).concat(KEYLIB.IDX_COLUMNS.map((x) => x.t + '.' + x.c)));
  const drift = [];
  for (const t of ['pinned_tokens', 'posts', 'comments', 'community_members', 'squad_members', 'watchlist', 'follows', 'alerts']) {
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map((x) => x.name).filter((c) => !never2.has(t + '.' + c));
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get('hist_' + t + '_del') || {}).sql || '';
    const got = new Set([...sql.matchAll(/'([a-z_0-9]+)', CASE/g)].map((x) => x[1]));
    const miss = cols.filter((c) => !got.has(c)); if (miss.length) drift.push(t + ': ' + miss.join(','));
  }
  check('  ...the triggers keep every column the tables have now (rebuilt at each boot, so a column added later is kept)', drift.length === 0, drift.join(' | '));
  // backups: which stay, and what they never hold
  const SRCb = SRC.slice(SRC.indexOf('function backupKeepSet(all, days, months) {'), SRC.indexOf('function snapshotDb() {'));
  const keepSet = new Function(SRCb + '\nreturn backupKeepSet;')();
  const names = []; for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2027, 3, 1)); d = new Date(d.getTime() + 864e5)) names.push('app-' + d.toISOString().slice(0, 10) + '.db');
  const keptB = [...keepSet(names, 30, 12)].sort();
  const monthly = keptB.filter((n) => n.slice(12, 14) === '01'), daily = names.slice(-30);
  check('backups keep the newest 30 days and the first copy of each of the last 12 months (run on fifteen months of names)',
    daily.every((n) => keptB.includes(n)) && monthly.length === 12 && monthly[0] === 'app-2026-04-01.db' && monthly[11] === 'app-2027-03-01.db' && keptB.length === 30 + 12 && !keptB.includes('app-2026-03-01.db') && keptB.includes('app-2027-03-01.db'), keptB.length + ' kept');
  const scrubSrc = SRC.slice(SRC.indexOf('const BACKUP_SCRUB = ['), SRC.indexOf('function scrubBackups() {'));
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(path.join(tmpdir(), 'dh-scrub-')), bf = path.join(dir, 'app-2026-10-01.db');
  const bdb = new DatabaseSync(bf);
  bdb.exec("CREATE TABLE calls (id INTEGER PRIMARY KEY, ip TEXT, entry_price REAL); INSERT INTO calls VALUES (1, 'iphash', 2);" +
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, signup_ip TEXT, last_ip TEXT); INSERT INTO users VALUES (1, 'ann', 'a', 'b');" +
    "CREATE TABLE sessions (token TEXT); INSERT INTO sessions VALUES ('t'); CREATE TABLE visit_seen (day TEXT, v TEXT); INSERT INTO visit_seen VALUES ('d', 'v');" +
    "CREATE TABLE arcade_guest_rounds (id INTEGER, ip TEXT, net TEXT, user_id INTEGER); INSERT INTO arcade_guest_rounds VALUES (1, 'x', 'y', NULL), (2, 'x', 'y', 5);" +
    "CREATE TABLE dh_moves (id INTEGER); INSERT INTO dh_moves VALUES (1);");
  bdb.close();
  const fsm = await import('node:fs'), OLD = new Date('2026-10-01T12:00:00Z');
  fsm.utimesSync(bf, OLD, OLD);
  const scrub = new Function('DatabaseSync', 'path', 'fs', 'console', scrubSrc + '\nreturn scrubBackup;')(DatabaseSync, path, fsm, { error() {} });
  const first = scrub(bf), again = scrub(bf);
  const chk = new DatabaseSync(bf);
  const left = { ip: chk.prepare('SELECT ip FROM calls').get().ip, price: chk.prepare('SELECT entry_price FROM calls').get().entry_price, signup: chk.prepare('SELECT signup_ip, last_ip, username FROM users').get(),
    sessions: chk.prepare('SELECT COUNT(*) n FROM sessions').get().n, seen: chk.prepare('SELECT COUNT(*) n FROM visit_seen').get().n, guests: chk.prepare('SELECT id, ip FROM arcade_guest_rounds').all(), moves: chk.prepare('SELECT COUNT(*) n FROM dh_moves').get().n };
  chk.close(); left.mtime = fsm.statSync(bf).mtimeMs; rmSync(dir, { recursive: true, force: true });
  check('  ...and every backup is written without what the live site erases on a schedule — IP hashes, sessions, visitor keys, guest flights, Diamond Hands moves — and keeps the rest and its date; once, marked (run on a real file)',
    first === true && again === false && left.ip === null && left.price === 2 && left.signup.signup_ip === null && left.signup.last_ip === null && left.signup.username === 'ann' && left.sessions === 0 && left.seen === 0
    && left.guests.length === 1 && left.guests[0].id === 2 && left.guests[0].ip === null && left.moves === 0 && left.mtime === OLD.getTime() && /if \(!scrubBackup\(tmp\)\) throw new Error/.test(SRC), JSON.stringify(left));
  check('  ...and the full copy made before an index flip is scrubbed the same way (keyFlipAtBoot cannot: BACKUP_SCRUB is declared after it)',
    /function scrubBackups\(\) \{\n[^\n]*\/\^pre-idx-e\\d\+-\.\*\\\.db\$\/\.test\(n\)\) scrubBackup\(/.test(SRC) && SRC.indexOf('function keyFlipAtBoot') < SRC.indexOf('const BACKUP_SCRUB = [')
    && !/scrubBackups?\(/.test(SRC.slice(SRC.indexOf('function keyFlipAtBoot'), SRC.indexOf('if (KEY_RING_FILE && !KEY_OWNER) console.warn'))));

  /* ═══ 5. deleting the account erases its history, with everything else ═══ */
  const secret = 'JBSWY3DPEHPK3PXP';
  const leaver = mkUser('__dh_leaver__');
  db.prepare("UPDATE users SET twofa_method = 'totp', twofa_secret = ?, twofa_enabled_at = ?, bio = 'something' WHERE id = ?").run(secret, Date.now(), leaver.id);
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, pair_addr, symbol, name, brand, added_at, pin_price, pin_mc) VALUES (?,?,?,?,?,?,?,?,?)').run(leaver.id, TOK, TOK2, 'DHT', 'History Token', null, T0, 1, 1);
  db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(other.id, leaver.id, Date.now());
  const before = hist('user_id = ?', leaver.id).length;
  const del = await api('/api/account/delete', { method: 'POST', cookie: leaver.cookie, body: { confirm: 'DELETE', current: { code: totp(secret) } } });
  const after = db.prepare('SELECT COUNT(*) n FROM data_history WHERE user_id = ?').get(leaver.id).n
    + db.prepare("SELECT COUNT(*) n FROM data_history WHERE tbl = 'follows' AND json_extract(old_json, '$.followee_id') = ?").get(leaver.id).n;
  check('deleting an account erases every earlier version kept of it — the ones its own deletion just wrote included, and other members\' records of following it',
    before >= 1 && del.status === 200 && after === 0 && /db\.prepare\('DELETE FROM data_history WHERE user_id = \?'\)\.run\(uid\);   \/\/ last/.test(SRC)
    && /DELETE FROM data_history WHERE user_id IN \(SELECT id FROM users WHERE deleted_at IS NOT NULL\)/.test(SRC), before + ' → ' + after + ' · ' + del.status + ' ' + (del.j && del.j.error));

  /* ═══ 6. the page, and what people are told ═══ */
  const RJ = PUB('adminrestore.js'), AH = PUB('admin.html');
  const desc = RJ.slice(RJ.indexOf('  function describe(e) {'), RJ.indexOf('  function row(e) {'));
  const esc = new Function('return ' + (/  const esc = (\(v\) => [^\n]+);\n/.exec(RJ) || [])[1])();
  const clipFn = new Function('return ' + (/  const clip = (\(t, n\) => [^\n]+);\n/.exec(RJ) || [])[1])();
  const D = new Function('esc', 'day', 'usd', 'clip', desc + '\nreturn describe;')(esc, () => '28 Sep 2026', (n) => '$' + n, clipFn);
  const dPin = D({ tbl: 'pinned_tokens', op: 'delete', what: 'Conviction Play', old: { symbol: 'SEND', added_at: 1, pin_price: 0.00008007, pin_mc: 760732 }, now: null });
  const dPost = D({ tbl: 'posts', op: 'delete', what: 'post', old: { id: 7, text: '<img src=x onerror=1> ' + 'word '.repeat(60) } });
  check('the restore page says what each entry was in words (a removed Conviction Play with its date and price), escapes what people wrote, and shortens long text at a word, never through one',
    /Conviction Play \$SEND removed — it ran from <b>28 Sep 2026<\/b> at \$0\.00008007 \(market cap \$760732\)/.test(dPin) && !/<img/.test(dPost) && /&lt;img/.test(dPost) && /word …”/.test(dPost) && !/wor…|wo…/.test(dPost), dPin);
  check('  ...a restore takes two taps and "confirm it\'s you"; the section sits on the admin page with a tip on every control',
    /if \(armed !== b\) \{/.test(RJ) && /confirm: 'RESTORE'/.test(RJ) && /<section class="card adm-ov adm-hist" id="adm-hist" hidden/.test(AH) && AH.indexOf('src="adminrestore.js"') > AH.indexOf('src="auth.js"')
    && [...AH.slice(AH.indexOf('id="adm-hist"'), AH.indexOf('id="adm-tools"')).matchAll(/<button[^>]*>/g)].every((x) => /data-tip="/.test(x[0])));
  const PRIV = PUB('privacy.html');
  check('the Privacy Policy says earlier versions are kept, what of, who can see them, that they never hold secrets, wallets or IP hashes, and that deleting the account erases them; and how long backups last',
    /Earlier versions, so a mistake can be undone\./.test(PRIV) && /Only the site's admin can see these versions/.test(PRIV) && /never include passwords, sign-in secrets, wallet addresses, IP hashes/.test(PRIV)
    && /deleting your account erases them/.test(PRIV) && /What a moderator takes down is not kept\./.test(PRIV) && /the last 30 days, and the first of each month for the last 12 months/.test(PRIV)
    && /Every backup is written without IP hashes, sign-in sessions and challenges, the visitor-counting keys, guest Rocket Run flights, the Diamond Hands record of moves, burn proofs and tried-email records/.test(PRIV) && /Version 2026-10-28 · \$Send \/ JustSendIt/.test(PRIV));
  check('backups: 30 dailies and 12 monthlies on the separate volume only (3 on the same one), each pass of the pruning keeping that set',
    /const BACKUP_KEEP = BACKUP_OFF_VOLUME \? 30 : 3;/.test(SRC) && /const BACKUP_KEEP_MONTHS = BACKUP_OFF_VOLUME \? 12 : 0;/.test(SRC) && /const keep = backupKeepSet\(all, BACKUP_KEEP, BACKUP_KEEP_MONTHS\);/.test(SRC));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'pinned_tokens', 'posts', 'comments', 'calls', 'community_members', 'holder_state', 'notifications', 'points_events', 'identities']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM communities WHERE creator_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  db.prepare('DELETE FROM data_history WHERE id > ? AND (user_id IN (' + (made.join(',') || '0') + ') OR user_id IS NULL)').run(startId);   // what this run wrote, its own cleanup included
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_dh\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — users left:', left, '| history rows left from this run:', db.prepare('SELECT COUNT(*) n FROM data_history WHERE id > ?').get(startId).n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
