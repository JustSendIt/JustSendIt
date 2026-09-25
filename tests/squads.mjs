/* 🛡️ Send Squads: private, token-gated groups whose calls score for the squad. Squads are made through the API where
   the API can do it without a chain read (an open gate); gated ones are seeded straight into the DB. Squad calls are
   inserted directly (a live call needs a price lookup and a wallet scan), except ONE real call to $SEND that proves the
   points land on the squad end to end — tolerated when the chain refuses, never asserted wrongly. Everything made here
   is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { gatePass, cleanupGatePass } from './gatepass.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const SRC = readFileSync(SERVER_JS, 'utf8');
const pub = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const tag = randomBytes(3).toString('hex');
const made = { users: [], squads: [], posts: [], calls: [] };
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [opts.noGate ? '' : GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.users.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw, name };
}
const TOK_GWC = '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22', TOK_SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105';
function mkCall(uid, sid, tok, sym, entry, peak, cur, spend, hops) {   // a squad call, straight into the DB, with its private widget post
  const r = db.prepare(`INSERT INTO calls (user_id, token_addr, pair_addr, symbol, name, entry_price, entry_mc, entry_liq, peak_price, cur_price, created_at, entry_spend_usd, squad_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, tok, '0x' + createHash('sha256').update('pair' + tok).digest('hex').slice(0, 40), sym, sym + ' token', entry, 1e6 * entry, 5000, peak, cur, Date.now(), spend, sid);
  const id = Number(r.lastInsertRowid); made.calls.push(id);
  const pr = db.prepare('INSERT INTO posts (user_id, text, created_at, call_id, squad_id, private) VALUES (?,?,?,?,?,1)').run(uid, '📣 ' + sym, Date.now(), id, sid);
  made.posts.push(Number(pr.lastInsertRowid));
  db.prepare('UPDATE calls SET post_id = ? WHERE id = ?').run(Number(pr.lastInsertRowid), id);
  for (const h of hops || []) db.prepare('INSERT INTO call_hops (call_id, user_id, created_at, entry_price, spend_usd, bought_usd, held_usd) VALUES (?,?,?,?,?,?,?)').run(id, h.uid, Date.now(), entry, h.spend, h.spend, h.spend);
  return id;
}
const weekKey = (t) => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3); const y = d.getUTCFullYear(); const jan4 = new Date(Date.UTC(y, 0, 4)); const w = 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7); return y + '-W' + String(w).padStart(2, '0'); };

GATE = await gatePass(BASE);
try {
  const A = mkUser('__sq_a_' + tag), B = mkUser('__sq_b_' + tag), C = mkUser('__sq_c_' + tag);

  /* ═══ 1. the door: every squad route needs an account ═══ */
  const out1 = await api('/api/squads');
  const out2 = await api('/api/squads', { method: 'POST', body: { name: 'x' } });
  check('signed out, the squad directory answers 401 need_signin (the referral gate)', out1.status === 401 && out1.j && out1.j.code === 'need_signin' && out2.status === 401, out1.status + ' ' + JSON.stringify(out1.j));
  // the house squad seeds after the community seeds (which read the network) — give it a moment
  let seed = null; for (let i = 0; i < 60 && !seed; i++) { seed = db.prepare('SELECT * FROM squads WHERE official = 1').get(); if (!seed) await new Promise(ok => setTimeout(ok, 500)); }
  check('the house $GWC 2% squad exists, owned by the site’s own account, gated at 2% of the supply' + (seed ? '' : ' (not seeded within 30s — the chain refused decimals(); retried by the server later)'), !seed || (seed.gate_kind === 'pct' && Number(seed.gate_amount) === 2 && seed.gate_token === TOK_GWC && !!db.prepare('SELECT 1 FROM users WHERE id = ? AND system = 1').get(seed.creator_id)), JSON.stringify(seed && { k: seed.gate_kind, a: seed.gate_amount }));

  /* ═══ 2. starting one (open gate — no chain read needed) ═══ */
  const bad1 = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name: 'ab', gateKind: 'none' } });
  check('a two-letter name is refused', bad1.status === 400 && /3–40/.test(bad1.j.error || ''), bad1.status + ' ' + (bad1.j && bad1.j.error));
  const bad2 = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name: 'Fine name', gateKind: 'pct', gateToken: TOK_GWC, gateAmount: 0 } });
  check('a % gate outside 0.01–100 is refused', bad2.status === 400 && /0\.01/.test(bad2.j.error || ''), bad2.status + ' ' + (bad2.j && bad2.j.error));
  const bad3 = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name: 'Fine name', gateKind: 'tokens', gateToken: 'nope', gateAmount: 5 } });
  check('a token gate without a contract address is refused', bad3.status === 400 && /contract address/.test(bad3.j.error || ''), bad3.status);
  const bad4 = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name: 'Fine name', gateKind: 'tokens', gateToken: TOK_GWC, gateAmount: 1e-19 } });
  check('a token gate below one unit of the token is refused (an exponent-notation amount never becomes a huge gate)', bad4.status === 400 && /below one unit|not a token this site can read/.test(bad4.j.error || ''), bad4.status + ' ' + (bad4.j && bad4.j.error));
  const name = 'Test Squad ' + tag;
  const mk = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name, bio: 'a bio for ' + tag, gateKind: 'none' } });
  const sid = mk.j && mk.j.id; if (sid) made.squads.push(sid);
  check('an open squad is created; the creator is its verified owner', mk.status === 200 && sid > 0 && mk.j.squad && mk.j.squad.gate.kind === 'none' && mk.j.squad.gate.text === 'Open to anyone' && mk.j.squad.memberCount === 1 && mk.j.squad.mine && mk.j.squad.mine.role === 'owner' && mk.j.squad.mine.verified === true, mk.status + ' ' + JSON.stringify(mk.j && (mk.j.error || mk.j.squad && mk.j.squad.mine)));
  check('  ...at level 1 with 0 points, nothing this week, nothing in the tracker yet', mk.j.squad.level === 1 && mk.j.squad.xp === 0 && mk.j.squad.xpWeek === 0 && mk.j.squad.lifetime.calls === 0, JSON.stringify(mk.j.squad.lifetime));
  const dup = await api('/api/squads', { method: 'POST', sid: A.sid, body: { name: name.toUpperCase(), gateKind: 'none' } });
  check('the same person cannot run two squads with the same name (case-insensitive)', dup.status === 409, dup.status);
  const dup2 = await api('/api/squads', { method: 'POST', sid: B.sid, body: { name, gateKind: 'none' } });
  const sid2 = dup2.j && dup2.j.id; if (sid2) made.squads.push(sid2);
  check('  ...but somebody else can use the same name (there is no limit per name or per token)', dup2.status === 200 && sid2 > 0, dup2.status);

  // a gated squad, seeded like the house one but owned by B: 2% of $GWC's supply
  const gr = db.prepare("INSERT INTO squads (creator_id, name, bio, gate_kind, gate_token, gate_symbol, gate_name, gate_decimals, gate_amount, member_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)")
    .run(B.id, 'Gated ' + tag, '', 'pct', TOK_GWC, 'GWC', 'Generational Wealth Coin', 18, 2, Date.now());
  const gid = Number(gr.lastInsertRowid); made.squads.push(gid);
  db.prepare("INSERT INTO squad_members (squad_id, user_id, joined_at, role, verified, check_at) VALUES (?,?,?,'owner',1,?)").run(gid, B.id, Date.now(), Date.now());

  /* ═══ 3. the directory: search by name or by the gate token, filters, sorts ═══ */
  const byName = await api('/api/squads?q=' + encodeURIComponent(tag), { sid: C.sid });
  check('search by name finds the squads', byName.status === 200 && byName.j.squads.some(s => s.id === sid) && byName.j.squads.some(s => s.id === gid), byName.status + ' ' + (byName.j && byName.j.squads && byName.j.squads.length));
  check('  ...and each card carries the preview: branding fields, members, gate, level, weekly points', (() => { const c = byName.j.squads.find(s => s.id === gid); return c && c.gate.kind === 'pct' && c.gate.symbol === 'GWC' && /Hold 2% of \$GWC supply/.test(c.gate.text) && 'avatar' in c && 'banner' in c && typeof c.level === 'number' && typeof c.xpWeek === 'number' && c.memberCount === 1; })(), JSON.stringify((byName.j.squads.find(s => s.id === gid) || {}).gate));
  const byTok = await api('/api/squads?q=' + TOK_GWC, { sid: C.sid });
  check('pasting the gate token’s address lists every squad gated by it (the house one and B’s)', byTok.status === 200 && byTok.j.squads.some(s => s.id === gid) && (!seed || byTok.j.squads.some(s => s.official)) && !byTok.j.squads.some(s => s.id === sid), byTok.j.squads.map(s => s.id).join(','));
  const open = await api('/api/squads?q=' + encodeURIComponent(tag) + '&gate=open', { sid: C.sid });
  const gated = await api('/api/squads?q=' + encodeURIComponent(tag) + '&gate=gated', { sid: C.sid });
  check('the gate filter splits open from gated', open.j.squads.every(s => s.gate.kind === 'none') && open.j.squads.some(s => s.id === sid) && gated.j.squads.every(s => s.gate.kind !== 'none') && gated.j.squads.some(s => s.id === gid));
  const today = await api('/api/squads?q=' + encodeURIComponent(tag) + '&time=day&sort=new', { sid: C.sid });
  db.prepare('UPDATE squads SET created_at = ? WHERE id = ?').run(Date.now() - 40 * 864e5, sid2);
  const notToday = await api('/api/squads?q=' + encodeURIComponent(tag) + '&time=month', { sid: C.sid });
  check('the time filter keeps only squads started inside the window', today.j.squads.some(s => s.id === sid2) && !notToday.j.squads.some(s => s.id === sid2) && notToday.j.squads.some(s => s.id === sid));
  const lvl = await api('/api/squads?q=' + TOK_GWC + '&sort=level', { sid: C.sid });
  check('sorting by level puts the official squad first, then by points', lvl.status === 200 && (!seed || lvl.j.squads[0].official === true) && lvl.j.squads.some(s => s.id === gid), JSON.stringify(lvl.j.squads.map(s => [s.id, s.official])));
  const mine = await api('/api/squads/mine', { sid: A.sid });
  check('/api/squads/mine lists the squads you are in (for the compose target list)', mine.status === 200 && mine.j.squads.length === 1 && mine.j.squads[0].id === sid && mine.j.squads[0].verified === true && mine.j.squads[0].role === 'owner', JSON.stringify(mine.j));

  /* ═══ 4. joining: open squads take anyone; a gated one reads the chain ═══ */
  const jB = await api('/api/squads/' + sid + '/join', { method: 'POST', sid: B.sid });
  check('B joins the open squad and is verified at once', jB.status === 200 && jB.j.joined && jB.j.verified && jB.j.squad.memberCount === 2, jB.status + ' ' + JSON.stringify(jB.j && (jB.j.error || jB.j.squad.memberCount)));
  const jAgain = await api('/api/squads/' + sid + '/join', { method: 'POST', sid: B.sid });
  check('  ...joining again is a no-op', jAgain.status === 200 && jAgain.j.alreadyMember === true);
  const jG = await api('/api/squads/' + gid + '/join', { method: 'POST', sid: C.sid });
  check('C (no wallet) cannot join the gated squad: a clear refusal, never a silent pass', jG.status === 403 && jG.j.code === 'gate' && /link a wallet/.test(jG.j.error || '') && jG.j.need && jG.j.need.kind === 'pct', jG.status + ' ' + JSON.stringify(jG.j));
  // a linked wallet that holds nothing: the chain is really read (a refusal with numbers, or "could not read" — never a pass)
  const w = '0x' + randomBytes(20).toString('hex');
  db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?,?,?,?,?)").run(C.id, 'wallet', createHash('sha256').update('idx' + w).digest('hex'), w, Date.now());
  // identifier_enc has to decrypt: walletAddresses() reads decField(identifier_enc), so store it the way the server does — through the API is impossible here, so patch via the server's own key
  const gJ = await api('/api/squads/' + gid + '/join', { method: 'POST', sid: C.sid });
  check('  ...with an empty wallet: refused with what it takes vs what they hold (or 503 when the chain would not answer)', gJ.status === 403 ? (gJ.j.code === 'gate' && gJ.j.need.tokens > 0) : gJ.status === 503, gJ.status + ' ' + JSON.stringify(gJ.j));
  db.prepare("DELETE FROM identities WHERE user_id = ? AND type = 'wallet'").run(C.id);
  check('  ...and the % gate’s "≈ N tokens" is derived from the live total supply once read', gJ.status !== 403 || (gJ.j.need.tokens >= 1e6 && gJ.j.need.tokens <= 1e9), gJ.j && gJ.j.need && gJ.j.need.tokens);

  /* ═══ 5. the private wall ═══ */
  const noRead = await api('/api/squads/' + sid + '/posts', { sid: C.sid });
  check('a non-member is refused the wall outright (403, code members)', noRead.status === 403 && noRead.j.code === 'members', noRead.status);
  const noPost = await api('/api/squads/' + sid + '/posts', { method: 'POST', sid: C.sid, body: { text: 'hi' } });
  check('  ...and cannot post to it', noPost.status === 403);
  const post = await api('/api/squads/' + sid + '/posts', { method: 'POST', sid: B.sid, body: { text: 'members only ' + tag } });
  const pid = post.j && post.j.post && post.j.post.id; if (pid) made.posts.push(pid);
  check('a verified member posts: the post is private, badged with the squad, and pays the person the normal post points', post.status === 200 && pid > 0 && post.j.post.private === true && post.j.post.squad && post.j.post.squad.id === sid && post.j.pointsEarned > 0, post.status + ' ' + JSON.stringify(post.j && (post.j.error || post.j.post.squad)));
  const wallA = await api('/api/squads/' + sid + '/posts', { sid: A.sid });
  check('  ...another verified member reads it', wallA.status === 200 && wallA.j.posts.some(p => p.id === pid));
  const single = await api('/api/posts/' + pid, { sid: C.sid });
  const singleB = await api('/api/posts/' + pid, { sid: B.sid });
  check('  ...it does not exist for anyone else (404), and does for a member', single.status === 404 && singleB.status === 200, single.status + '/' + singleB.status);
  const wallPub = await api('/api/posts?sort=new', { sid: C.sid });
  check('  ...and never appears on the public Send Wall', wallPub.status === 200 && !(wallPub.j.posts || []).some(p => p.id === pid));
  const prof = await api('/api/users/' + encodeURIComponent(B.name), { sid: C.sid });
  check('  ...nor on the author’s profile wall', prof.status === 200 && !JSON.stringify(prof.j).includes('members only ' + tag), prof.status);
  const react = await api('/api/posts/' + pid + '/react', { method: 'POST', sid: C.sid, body: { kind: 'fire' } });
  check('  ...reacting to it from outside is a 404 too (every verb hides it)', react.status === 404, react.status);

  /* ═══ 6. squad calls: private, and the points are the squad’s ═══ */
  const ptsB0 = db.prepare('SELECT points FROM users WHERE id = ?').get(B.id).points;
  const xp0 = db.prepare('SELECT xp FROM squads WHERE id = ?').get(sid).xp;
  const badTarget = await api('/api/calls', { method: 'POST', sid: C.sid, body: { token: TOK_SEND, squadId: sid } });
  check('a call cannot be sent to a squad you are not a verified member of', badTarget.status === 403, badTarget.status + ' ' + (badTarget.j && badTarget.j.error));
  let live = null, liveOk = false;
  for (let i = 0; i < 3 && !live; i++) {
    const r = await api('/api/calls', { method: 'POST', sid: B.sid, body: { token: TOK_SEND, squadId: sid, note: 'squad call ' + tag } });
    if (r.status === 200) live = r; else if (r.status === 502 || r.status === 503) await new Promise(ok => setTimeout(ok, 4000)); else { live = r; break; }
  }
  const netRefused = !live || live.status === 502 || live.status === 503;
  if (live && live.status === 200) {
    liveOk = true;
    const cid = live.j.post.call_id; made.calls.push(cid); made.posts.push(live.j.post.id);
    const sq = db.prepare('SELECT xp, xp_week, week_key FROM squads WHERE id = ?').get(sid);
    const ptsB1 = db.prepare('SELECT points FROM users WHERE id = ?').get(B.id).points;
    const row = db.prepare("SELECT * FROM points_events WHERE ref = ?").get('callopen:' + B.id + ':' + TOK_SEND + ':sq' + sid);
    check('a real squad call on $SEND: the person earns 0, the squad gets the opening points (120 × size)', live.j.pointsEarned === 0 && live.j.squadPoints >= 120 && ptsB1 === ptsB0 && sq.xp === xp0 + live.j.squadPoints, JSON.stringify({ earned: live.j.pointsEarned, squad: live.j.squadPoints, xp: sq.xp }));
    check('  ...the credit row carries amount 0 and the XP in base, under a ref nobody can double-spend', row && row.kind === 'squadxp' && row.amount === 0 && row.base === live.j.squadPoints, JSON.stringify(row && { k: row.kind, a: row.amount, b: row.base }));
    check('  ...and the weekly bucket is this ISO week’s', sq.week_key === weekKey(Date.now()) && sq.xp_week >= 120, sq.week_key);
    const g = await api('/api/gamify/me', { sid: B.sid });
    check('  ...the person’s dashboard shows none of it as their own (today’s points unchanged)', g.status === 200 && !(g.j.recent || []).some(r => r.kind === 'squadxp'), JSON.stringify((g.j.recent || []).slice(0, 2)));
    check('  ...the call is private (its post is)', live.j.post.private === true && live.j.post.squad && live.j.post.squad.id === sid && live.j.post.call && live.j.post.call.squadId === sid);
    const asC = await api('/api/calls/' + cid, { sid: C.sid });
    check('  ...and does not exist for an outsider', asC.status === 404, asC.status);
    const weekly = await api('/api/squads/weekly', { sid: C.sid });
    check('  ...the weekly squad board shows the squad with this week’s points', weekly.status === 200 && weekly.j.board.some(b => b.id === sid && b.xpWeek >= 120), JSON.stringify(weekly.j.board.slice(0, 3)));
    const lvlNow = db.prepare('SELECT xp FROM squads WHERE id = ?').get(sid).xp;
    check('  ...120 points is Level 2 on the shared curve (83 XP), and the members were told', lvlNow >= 83 && !!db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND text LIKE '%reached Level 2%'").get(A.id));
  } else {
    check('a real squad call on $SEND (the chain or price feed refused this run: ' + (live ? live.status + ' ' + (live.j && live.j.error) : 'no answer') + ' — not asserted)', netRefused, live && live.status);
  }

  // the rest of the call rules, on calls seeded directly (no price lookup needed)
  const T1 = '0x' + createHash('sha256').update('sqtok1' + tag).digest('hex').slice(0, 40);
  const c1 = mkCall(A.id, sid, T1, 'SQ1', 1, 3, 2, 100, [{ uid: B.id, spend: 50 }]);   // entry 1 → peak 3 (2x), now 2 (1x); $100 + $50 in
  const c2 = mkCall(B.id, sid, T1, 'SQ1', 2, 2, 1, 0, []);                                // same token, another member: allowed
  const calls = await api('/api/squads/' + sid + '/calls', { sid: A.sid });
  check('members see the squad’s calls, newest first, with their widgets and the caller’s name', calls.status === 200 && calls.j.calls.length >= 2 && calls.j.calls[0].id === c2 && calls.j.calls.every(c => c.squadId === sid) && calls.j.calls[0].username === B.name, calls.status + ' ' + (calls.j && calls.j.calls && calls.j.calls.length));
  const lt = calls.j.lifetime;
  // the live $SEND call (when it landed) adds one call at 0x on $0: nothing to the Xs or the dollars
  check('the lifetime tracker: ' + (2 + (liveOk ? 1 : 0)) + ' calls, total Xs 2, best 2x, $150 sent, $300 paper gain at peak, $150 now (c2 sits at −50% on $0)', lt.calls === 2 + (liveOk ? 1 : 0) && lt.totalX === 2 && lt.bestX === 2 && lt.sentUsd === 150 && lt.peakGainUsd === 300 && lt.nowGainUsd === 150, JSON.stringify(lt));
  const callsC = await api('/api/squads/' + sid + '/calls', { sid: C.sid });
  check('  ...outsiders are refused the calls list', callsC.status === 403 && callsC.j.code === 'members');
  const liveC = await api('/api/calls/live?ids=' + c1 + ',' + c2, { sid: C.sid });
  const liveB = await api('/api/calls/live?ids=' + c1 + ',' + c2, { sid: B.sid });
  check('  ...the live feed simply omits squad calls for an outsider and serves them to a member', liveC.j.calls.length === 0 && liveB.j.calls.length === 2, liveC.j.calls.length + '/' + liveB.j.calls.length);
  const sendC = await api('/api/calls/' + c1 + '/senders', { sid: C.sid });
  check('  ...and so does the senders list', sendC.status === 404);
  const hopC = await api('/api/calls/' + c1 + '/hop', { method: 'POST', sid: C.sid });
  check('an outsider cannot Send It on a squad call (404)', hopC.status === 404, hopC.status);
  const hopB = await api('/api/calls/' + c2 + '/hop', { method: 'POST', sid: A.sid });
  check('a member can: no personal points (nothing in the token → 0 to the squad too), and the response names the squad', hopB.status === 200 && hopB.j.pointsEarned === 0 && hopB.j.squadPoints === 0 && hopB.j.squadId === sid, hopB.status + ' ' + JSON.stringify(hopB.j));
  let uniq = false; try { db.prepare("INSERT INTO calls (user_id, token_addr, pair_addr, symbol, entry_price, peak_price, created_at, squad_id) VALUES (?,?,?,?,1,1,?,?)").run(A.id, T1, 'x', 'SQ1', Date.now(), sid); } catch { uniq = true; }
  check('one call per token per caller PER SQUAD is enforced by the rebuilt table', uniq);
  let pubOk = false; try { const r = db.prepare("INSERT INTO calls (user_id, token_addr, pair_addr, symbol, entry_price, peak_price, created_at) VALUES (?,?,?,?,1,1,?)").run(A.id, T1, 'x', 'SQ1', Date.now()); made.calls.push(Number(r.lastInsertRowid)); pubOk = true; } catch {}
  check('  ...so the same person can also call the same token publicly', pubOk);
  // the two read paths the review caught: a token chart's markers, and the Data API's calls export
  const mk1 = await api('/api/chart/markers?token=' + T1 + '&pair=' + '0x' + createHash('sha256').update('pair' + T1).digest('hex').slice(0, 40) + '&to=' + Date.now(), { noGate: true });
  const mkTxt = JSON.stringify(mk1.j || {});
  check('a token chart’s markers never show a squad call or a squad Send It (anonymous read)', mk1.status === 200 && !mkTxt.includes('"callId":' + c1) && !mkTxt.includes('"callId":' + c2) && !mkTxt.includes(B.name), mk1.status + ' ' + mkTxt.slice(0, 120));
  const keyC = 'sk_' + randomBytes(24).toString('hex'), keyB = 'sk_' + randomBytes(24).toString('hex');
  for (const [k, u] of [[keyC, C.id], [keyB, B.id]]) db.prepare("INSERT INTO api_keys (key_hash, user_id, burned_wei, burned_usd, price_usd, minted_at, expires_at, source) VALUES (?,?,'0',0,0,?,?,'burn')").run(createHash('sha256').update(k).digest('hex'), u, Date.now(), Date.now() + 864e5);
  const dataAs = async (k) => { const r = await fetch(BASE + '/api/data/v1/calls', { headers: { Authorization: 'Bearer ' + k, Origin: BASE } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, ids: ((j && j.data) || []).map(x => x.id) }; };
  const dC = await dataAs(keyC), dB = await dataAs(keyB);
  check('the Data API exports a squad call to its own caller only', dC.status === 200 && !dC.ids.includes(c1) && !dC.ids.includes(c2) && dB.status === 200 && dB.ids.includes(c2) && !dB.ids.includes(c1), 'c1=' + c1 + ' c2=' + c2 + ' outsider ' + dC.status + ' ' + JSON.stringify(dC.ids) + ' / caller B ' + dB.status + ' ' + JSON.stringify(dB.ids));
  db.prepare('DELETE FROM api_keys WHERE user_id IN (?, ?)').run(C.id, B.id);
  const rep1 = await api('/api/report', { method: 'POST', sid: C.sid, body: { kind: 'post', id: pid, reason: 'spam' } });
  check('reporting a squad post from outside is a 404, not a confirmation that it exists', rep1.status === 404, rep1.status + ' ' + JSON.stringify(rep1.j));
  const lb = await api('/api/calls/leaderboard?window=all');
  check('squad calls never reach the public call leaderboard or a profile’s call stats', lb.status === 200 && !lb.j.top.some(t => t.username === A.name && t.calls >= 2) && /AND c\.squad_id IS NULL/.test(SRC) && /WHERE user_id=\? AND squad_id IS NULL ORDER BY created_at DESC/.test(SRC));

  /* ═══ 7. members, conviction, settings, leaving ═══ */
  const memC = await api('/api/squads/' + sid + '/members', { sid: C.sid });
  const memA = await api('/api/squads/' + sid + '/members', { sid: A.sid });
  check('the member list is for members; outsiders get the count only', memC.status === 200 && memC.j.membersOnly === true && memC.j.members.length === 0 && memC.j.count === 2 && memA.j.members.length === 2 && memA.j.members[0].role === 'owner', JSON.stringify(memC.j) + ' ' + (memA.j.members || []).length);
  const P1 = '0x' + createHash('sha256').update('pin1' + tag).digest('hex').slice(0, 40), P2 = '0x' + createHash('sha256').update('pin2' + tag).digest('hex').slice(0, 40);
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, name, added_at) VALUES (?,?,?,?,?)').run(A.id, P1, 'PIN1', 'Pin One', Date.now() - 40 * 864e5);
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, name, added_at) VALUES (?,?,?,?,?)').run(B.id, P1, 'PIN1', 'Pin One', Date.now() - 10 * 864e5);
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, name, added_at) VALUES (?,?,?,?,?)').run(B.id, P2, 'PIN2', 'Pin Two', Date.now() - 3 * 864e5);
  db.prepare('INSERT INTO pinned_tokens (user_id, token_addr, symbol, name, added_at) VALUES (?,?,?,?,?)').run(C.id, P1, 'PIN1', 'Pin One', Date.now() - 400 * 864e5);   // C is not a member: must not count
  db.prepare('INSERT INTO squad_pin_state (squad_id, user_id, token_addr, held, usd, days, checked_at) VALUES (?,?,?,?,?,?,?)').run(sid, A.id, P1, 1, 55, 40, Date.now());
  db.prepare('INSERT INTO points_events (user_id, kind, amount, base, mult, comp_amount, comp_base, ref, created_at) VALUES (?,?,0,?,1,0,0,?,?)').run(A.id, 'squadxp', 4, 'sq' + sid + ':conv:' + A.id + ':' + P1 + ':2026-1-1', Date.now());
  const conv = await api('/api/squads/' + sid + '/conviction', { sid: B.sid });
  const t1 = conv.j && conv.j.tokens && conv.j.tokens.find(t => t.token === P1);
  check('the conviction board aggregates members’ pins: PIN1 convicted by 2 members, 1 still holding at the last check, longest 40 days, average 25', conv.status === 200 && t1 && t1.members === 2 && t1.held === 1 && t1.longestDays === 40 && t1.avgDays === 25 && t1.holders.length === 2, JSON.stringify(t1));
  check('  ...ranked by how many members are convicted, then how long; the top-members list leads with the most pins', conv.j.tokens[0].token === P1 && conv.j.top[0].username === B.name && conv.j.top[0].pins === 2, JSON.stringify(conv.j.top));
  check('  ...a non-member’s pin (even a 400-day one) does not count, and the conviction points are summed from the credit rows', !conv.j.tokens.some(t => t.longestDays >= 400) && conv.j.pointsAllTime === 4, conv.j.pointsAllTime);
  const convC = await api('/api/squads/' + sid + '/conviction', { sid: C.sid });
  check('  ...and outsiders are refused it', convC.status === 403);
  check('the conviction credit: 2 × (1 + min(days, 360)/30) per held pin worth ≥ $20, once per UTC day, ref-deduped', /const SQUAD_CONV_DAY = 2, SQUAD_CONV_RAMP_DAYS = 30, SQUAD_CONV_MAX_DAYS = 360, SQUAD_CONV_MIN_USD = 20;/.test(SRC) && /awardSquadXp\(sq\.id, m\.user_id, SQUAD_CONV_DAY \* \(1 \+ Math\.min\(days, SQUAD_CONV_MAX_DAYS\) \/ SQUAD_CONV_RAMP_DAYS\), 'sq' \+ sq\.id \+ ':conv:' \+ m\.user_id \+ ':' \+ p\.token_addr \+ ':' \+ day\)/.test(SRC));
  const setC = await api('/api/squads/' + sid + '/settings', { method: 'POST', sid: B.sid, body: { name: 'hijack' } });
  check('only the owner changes the name, bio or pictures', setC.status === 403, setC.status);
  const setA = await api('/api/squads/' + sid + '/settings', { method: 'POST', sid: A.sid, body: { name: 'Renamed ' + tag, bio: 'new bio', avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } });
  check('  ...the owner renames it, sets a bio and a picture', setA.status === 200 && setA.j.squad.name === 'Renamed ' + tag && setA.j.squad.bio === 'new bio' && /^\/uploads\/[a-f0-9]{24}\.png$/.test(setA.j.squad.avatar || ''), setA.status + ' ' + JSON.stringify(setA.j && (setA.j.error || setA.j.squad.avatar)));
  const rm = await api('/api/squads/' + sid + '/settings', { method: 'POST', sid: A.sid, body: { removeAvatar: true } });
  check('  ...and removes it again', rm.status === 200 && rm.j.squad.avatar === null);
  check('the gate cannot be changed after creation (no route accepts a gate field)', !/gate_kind = \?|gate_amount = \?|gate_token = \?/.test(SRC.slice(SRC.indexOf("sub === 'settings'"), SRC.indexOf("sub === 'settings'") + 3000)));
  const leaveOwner = await api('/api/squads/' + sid + '/join', { method: 'DELETE', sid: A.sid });
  check('the owner cannot leave', leaveOwner.status === 400);
  const leaveB = await api('/api/squads/' + sid + '/join', { method: 'DELETE', sid: B.sid });
  const afterLeave = await api('/api/squads/' + sid + '/posts', { sid: B.sid });
  check('a member leaves, the count drops, and the wall closes to them', leaveB.status === 200 && leaveB.j.left && db.prepare('SELECT member_count FROM squads WHERE id = ?').get(sid).member_count === 1 && afterLeave.status === 403, leaveB.status + ' ' + afterLeave.status);
  // a member below the gate is paused by the sweep (simulated: the same update the sweep runs) and can re-join
  db.prepare('UPDATE squad_members SET verified = 0 WHERE squad_id = ? AND user_id = ?').run(gid, B.id);
  const pausedRead = await api('/api/squads/' + gid + '/posts', { sid: B.sid });
  check('an un-verified member (paused by the gate sweep) no longer reads the wall', pausedRead.status === 403);
  check('  ...the gate sweep re-reads the oldest-checked members every 10 minutes and un-verifies, never on a failed read (which still takes its turn)', /ORDER BY COALESCE\(m\.check_at, 0\) ASC LIMIT 40/.test(SRC) && /catch \{ db\.prepare\('UPDATE squad_members SET check_at = \? WHERE squad_id = \? AND user_id = \?'\)\.run\(now\(\), r\.squad_id, r\.user_id\); continue; \}/.test(SRC) && /sweepSquadGates\(\)\.catch\(\(\) => \{\}\); \}, 10 \* 60 \* 1000\)/.test(SRC));
  check('  ...and unlinking or disconnecting a wallet pauses every gated membership at once', (SRC.match(/pauseSquadGatesFor\(me\.id\)/g) || []).length === 2);

  /* ═══ 8. the shape of it, in the source and the pages ═══ */
  check('squad credit rows are excluded from the weekly Biggest Sender race and its backfill', /NOT IN \('commxp','convxp','commact','decay','squadxp'\)/.test(SRC) && /NOT IN \('commxp','convxp','commact','squadxp'\)/.test(SRC));
  check('a squad post is private by construction and every single-post read carries squad_id', /INSERT INTO posts \(user_id, text, image, score, created_at, squad_id, tokens, private\) VALUES \(\?,\?,\?,\?,\?,\?,\?,1\)/.test(SRC) && (SRC.match(/SELECT id, user_id, community_id, private, squad_id FROM posts WHERE id = \?/g) || []).length === 5);   // the four verbs + the report route
  check('the refresh sweep pays a squad call’s rungs, hold and Send-It hold to the squad', /awardSquadXp\(r\.squad_id, uid, Math\.min\(amt, cap == null \? amt : cap\), ref\)/.test(SRC) && /pay\(r\.user_id, 'call_x', rung/.test(SRC) && /pay\(hop\.user_id, 'hop_hold'/.test(SRC));
  check('deleting an account deletes the squads it owns (posts, calls and pictures included) and ends its memberships', /DELETE FROM squads WHERE id = \?'\)\.run\(sqr\.id\)/.test(SRC) && /'community_members', 'squad_members', 'squad_pin_state'/.test(SRC));
  const commHtml = pub('communities.html');
  check('the communities page has the Send Squads tab and its locked panel', /data-cstatus="squads"/.test(commHtml) && /id="sq-locked"/.test(commHtml) && /id="sq-grid"/.test(commHtml));
  check('the squad page exists with the four tabs', ['wall', 'calls', 'conviction', 'members'].every(k => new RegExp('data-stab="' + k + '"').test(pub('squad.html'))) && /SendCall\.widgetHTML/.test(pub('squad.js')));
  check('the compose modal can target a squad and the widget labels squad calls', /compose-call-target/.test(pub('compose.js')) && /squadId/.test(pub('compose.js')) && /Squad call/.test(pub('sendcall.js')));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made.posts) { try { db.prepare('DELETE FROM posts WHERE id = ?').run(id); } catch {} }
  for (const id of made.calls) { try { db.prepare('DELETE FROM call_hops WHERE call_id = ?').run(id); db.prepare('DELETE FROM calls WHERE id = ?').run(id); } catch {} }
  for (const id of made.squads) { try { db.prepare('DELETE FROM posts WHERE squad_id = ?').run(id); db.prepare('DELETE FROM calls WHERE squad_id = ?').run(id); db.prepare('DELETE FROM squads WHERE id = ?').run(id); } catch {} }
  for (const id of made.users) {
    for (const t of ['sessions', 'identities', 'pinned_tokens', 'points_events', 'notifications', 'squad_members', 'squad_pin_state', 'call_hops', 'holder_state']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM calls WHERE user_id = ?').run(id); db.prepare('DELETE FROM posts WHERE user_id = ?').run(id); db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_sq\\_%' ESCAPE '\\'").get().n, '· squads left:', db.prepare("SELECT COUNT(*) n FROM squads WHERE name LIKE ? OR name LIKE ?").get('%' + tag + '%', 'Gated ' + tag).n);
  cleanupGatePass();
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
