/* "$100 bought" across the site (owner, 2026-11-17: "make it $100 of value bought in the token not the current token value, and
   change that rule across the platform"): what server.js does with the verdicts lib/bought.js keeps.
     · A Send Call's size (Q5: "spent under the Q1 rule, capped at pool liquidity"): the caller's counted buys that reached
       their wallets before the call, capped at the pool's liquidity — and a buy still inside its 24 hours, or a verdict not
       made yet, paid later (size_topups), once, through the same award.
     · A community join, or a start, on a coin whose trades are not read yet: "checking" — never a "no".
     · The door's rules say what the floor is: dollars bought.
   The pure parts are lifted out of server.js and run on an in-memory database; the rest goes through the real HTTP API with
   throwaway rows, deleted at the end. Wallets and tokens here are made up. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, createHmac, createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, KEY_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [], comms: [] };
const DATA_KEY = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const IDX_KEY = createHmac('sha256', DATA_KEY).update('blind-index').digest();
const bidx = (v) => createHmac('sha256', IDX_KEY).update(String(v == null ? '' : v)).digest('hex');
const encField = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', DATA_KEY, iv); const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUser(name, wallet) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id; made.users.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  if (wallet) db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?, 'wallet', ?, ?, ?)").run(id, bidx(wallet), encField(wallet), Date.now() - 864e5);
  return { id, sid: raw };
}
const fnSrc = (name) => { const m = new RegExp('\\n(function ' + name + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\})\\n').exec(SRC); return m ? m[1] : null; };

try {
  /* ═══ 1. a Send Call's size, and the size paid later ═══ */
  {
    const NAMES = ['boughtSpendAt', 'sizeTopupApply'];
    const missing = NAMES.filter((n) => !fnSrc(n));
    check('boughtSpendAt and sizeTopupApply can be lifted out of server.js', !missing.length, missing.join(', '));
    const mem = new DatabaseSync(':memory:');
    mem.exec(`CREATE TABLE calls (id INTEGER PRIMARY KEY, user_id INTEGER, squad_id INTEGER, points_paid REAL NOT NULL DEFAULT 0, entry_spend_usd REAL NOT NULL DEFAULT 0);
      CREATE TABLE call_hops (call_id INTEGER, user_id INTEGER, points_paid REAL NOT NULL DEFAULT 0, spend_usd REAL NOT NULL DEFAULT 0);
      CREATE TABLE size_topups (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, call_id INTEGER NOT NULL, user_id INTEGER NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL,
        liq REAL, paid_spend REAL NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, done_at INTEGER, UNIQUE (kind, call_id, user_id));`);
    let clock = 1800000000000;
    const STATES = new Map(), wants = [], awards = [];
    const BOUGHT = { stateOf: (uid, t) => STATES.get(uid + ':' + t) || null, want: (uid, t, o) => wants.push({ uid, t, o }) };
    const E = {
      db: mem, now: () => clock, BOUGHT, PTS: { send_call: 120, hop_on: 30 },
      sizeMult: (s) => Math.min(100, Math.max(1, (s || 0) / 100)), addBonus: (...f) => 1 + f.reduce((a, x) => a + Math.max(0, (Number(x) || 1) - 1), 0),
      callHeadroom: (paid, cap) => Math.max(0, cap - (paid || 0)), CALL_POINTS_CAP: 737627, HOP_POINTS_CAP: 184407, OPEN_STACK_MAX: 10, TOPUP_GIVE_UP_MS: 3 * 864e5,
      awardPoints: (uid, kind, base, ref) => { if (awards.some((a) => a.ref === ref)) return 0; awards.push({ uid, kind, base, ref }); return base; },
      awardSquadXp: (sid, uid, amount, ref) => { awards.push({ sid, uid, base: amount, ref }); return amount; },
    };
    const K = new Function(...Object.keys(E), NAMES.map(fnSrc).join('\n') + '\nreturn { boughtSpendAt, sizeTopupApply };')(...Object.values(E));
    const T = '0x' + '7'.repeat(40), H = 3600e3;
    const st = (o) => ({ fresh: true, complete: true, counted: [], pendingLots: [], ...o });
    STATES.set('1:' + T, st({ counted: [[clock - 10 * H, 150], [clock - 5 * H, 100], [clock + H, 999]] }));
    const a = K.boughtSpendAt(1, T, clock, null);
    check('a call\'s size counts the counted buys that reached the wallets BEFORE it (a later buy adds nothing), and is final', a.spendUsd === 250 && a.final === true && a.known === true, JSON.stringify(a));
    check('  ...capped at the pool\'s liquidity at the call', K.boughtSpendAt(1, T, clock, 120).spendUsd === 120);
    STATES.set('2:' + T, st({ counted: [[clock - 10 * H, 50]], pendingLots: [[clock - H, 80]] }));
    const b = K.boughtSpendAt(2, T, clock, null);
    check('  ...a buy from before the call still inside its 24 hours: what counts now, and not final (it is paid when it counts)', b.spendUsd === 50 && b.final === false, JSON.stringify(b));
    const c = K.boughtSpendAt(3, T, clock, null);
    check('  ...no verdict yet: $0 for now, not final, and the worker is asked for one', c.spendUsd === 0 && c.final === false && c.known === false && wants.some((w) => w.uid === 3 && w.t === T), JSON.stringify(c));
    STATES.set('4:' + T, { ...st({ counted: [[clock - H, 500]] }), fresh: false });
    check('  ...a verdict for another wallet set is no answer', K.boughtSpendAt(4, T, clock, null).known === false);
    // a call made on a buy still maturing: paid 1× now, its size once the buy counts — once
    mem.prepare('INSERT INTO calls (id, user_id, points_paid, entry_spend_usd) VALUES (10, 2, 120, 50)').run();
    mem.prepare("INSERT INTO size_topups (kind, call_id, user_id, token, at, liq, paid_spend, due_at) VALUES ('call', 10, 2, ?, ?, NULL, 50, ?)").run(T, clock, clock);
    const r0 = mem.prepare('SELECT * FROM size_topups WHERE call_id = 10').get();
    check('  ...still maturing: nothing paid, asked again later', K.sizeTopupApply(r0) === 0 && mem.prepare('SELECT done_at, tries FROM size_topups WHERE call_id = 10').get().done_at === null);
    STATES.set('2:' + T, st({ counted: [[clock - 10 * H, 50], [clock - H, 80]] }));   // the buy turned 24 hours old
    const paid = K.sizeTopupApply(mem.prepare('SELECT * FROM size_topups WHERE call_id = 10').get());
    const call = mem.prepare('SELECT * FROM calls WHERE id = 10').get();
    check('  ...once it counts: the size it earns less the size already paid ($130 → 1.3×: 156 − 120 = 36 base), the size written, settled',
      paid === 36 && call.entry_spend_usd === 130 && call.points_paid === 156 && awards.filter((x) => x.ref === 'callsize:10').length === 1 && mem.prepare('SELECT done_at FROM size_topups WHERE call_id = 10').get().done_at === clock, JSON.stringify({ paid, call, awards }));
    check('  ...and never twice', K.sizeTopupApply(mem.prepare('SELECT * FROM size_topups WHERE call_id = 10').get()) === 0 && awards.filter((x) => x.ref === 'callsize:10').length === 1);
    // a Send on nothing counted yet: paid nothing then, its own award (the same ref it would have had) when the buy counts
    mem.prepare('INSERT INTO calls (id, user_id) VALUES (20, 9)').run(); mem.prepare('INSERT INTO call_hops (call_id, user_id) VALUES (20, 5)').run();
    mem.prepare("INSERT INTO size_topups (kind, call_id, user_id, token, at, liq, paid_spend, due_at) VALUES ('hop', 20, 5, ?, ?, NULL, 0, ?)").run(T, clock, clock);
    STATES.set('5:' + T, st({ counted: [[clock - H, 200]] }));
    const hp = K.sizeTopupApply(mem.prepare("SELECT * FROM size_topups WHERE kind = 'hop'").get());
    check('a Send It made before its buy counted is paid when it does — under the Send\'s own award (hop:<member>:<call>), sized by the buy', hp === Math.round(30 * 2) && awards.some((x) => x.ref === 'hop:5:20' && x.kind === 'hop_on') && mem.prepare('SELECT spend_usd FROM call_hops WHERE call_id = 20').get().spend_usd === 200, JSON.stringify(awards.slice(-1)));
    // no verdict for three days: settled on what was paid
    mem.prepare('INSERT INTO calls (id, user_id) VALUES (30, 6)').run();
    mem.prepare("INSERT INTO size_topups (kind, call_id, user_id, token, at, liq, paid_spend, due_at) VALUES ('call', 30, 6, ?, ?, NULL, 0, ?)").run(T, clock, clock);
    clock += 4 * 864e5;
    K.sizeTopupApply(mem.prepare('SELECT * FROM size_topups WHERE call_id = 30').get());
    check('  ...a size whose verdict never came is settled after three days on what was paid (nothing made up)', mem.prepare('SELECT done_at FROM size_topups WHERE call_id = 30').get().done_at === clock && !awards.some((x) => x.ref === 'callsize:30'));
    check('the call route sizes from the verdict and queues the rest; the old explorer walk is gone', /const sz = boughtSpendAt\(me\.id, token, t, liq\);/.test(SRC) && /if \(!sz\.final\) db\.prepare\('INSERT OR IGNORE INTO size_topups/.test(SRC) && !/callSpendUsd\(/.test(SRC));
    check('  ...a verdict written settles the sizes waiting on it, and a sweep settles the rest', /for \(const r of db\.prepare\('SELECT \* FROM size_topups WHERE done_at IS NULL AND user_id = \? AND token = \?'\)\.all\(uid, token\)\) sizeTopupApply\(r\);/.test(SRC)
      && /const sizeTopupTimer = setInterval\(/.test(SRC));
  }

  /* ═══ 2. a coin whose trades are not read yet: "checking", never a "no" ═══ */
  {
    const tag = randomBytes(3).toString('hex');
    const w = '0x' + randomBytes(20).toString('hex');
    const u = mkUser('__bs_' + tag, w);
    const tok = '0x' + randomBytes(20).toString('hex');
    db.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, created_at) VALUES (?,?,?,?,?,?,?)").run(u.id, tok, tok, 'ZQB', 'ZQB Coin', 'pending', Date.now());
    const cid = db.prepare('SELECT id FROM communities WHERE token_addr = ?').get(tok).id; made.comms.push(cid);
    const j = await api('/api/communities/' + cid + '/join', { method: 'POST', sid: u.sid });
    check('joining a community whose coin\'s trades are not read yet: 503 "checking" — nothing decided, never a refusal', j.status === 503 && j.j && j.j.code === 'checking' && /Nothing has been decided/.test(j.j.error || ''), JSON.stringify(j));
    check('  ...and asking put the coin on the tape\'s list (bought_tokens)', !!db.prepare('SELECT 1 FROM bought_tokens WHERE token = ?').get(tok));
    const n = mkUser('__bsn_' + tag, null);
    const jn = await api('/api/communities/' + cid + '/join', { method: 'POST', sid: n.sid });
    check('  ...a member with no wallet linked gets a definite answer (bought nothing here), saying what the floor is', jn.status === 403 && /bought from the market across your linked wallets/.test(jn.j && jn.j.error || '') && /No wallet is linked/.test(jn.j && jn.j.error || ''), JSON.stringify(jn));
    try { db.prepare('DELETE FROM bought_tokens WHERE token = ?').run(tok); } catch {}
  }

  /* ═══ 3. the door's rules: dollars bought ═══ */
  {
    const g = await api('/api/gate/state');
    const r = g.j && g.j.rules;
    check('/api/gate/state says the floor is $100 BOUGHT, $10 of it still held, a buy counting after 24 hours', r && r.holdMinUsd === 100 && r.basis === 'bought' && r.heldMinUsd === 10 && r.buyCountsAfterHours === 24, JSON.stringify(r));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made.comms) { try { db.prepare('DELETE FROM community_members WHERE community_id = ?').run(id); db.prepare('DELETE FROM communities WHERE id = ?').run(id); } catch {} }
  for (const id of made.users) {
    for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'acq_state', 'buy_claims', 'community_members']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
