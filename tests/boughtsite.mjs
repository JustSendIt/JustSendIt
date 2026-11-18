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
import { createRequire } from 'node:module';
import path from 'node:path';
import { DB_PATH, KEY_PATH, SERVER_JS, ROOT } from './_paths.mjs';

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

  /* ═══ 4. the switch (owner: "Switch on at once"): logged, counted, and every member who loses a status told why ═══ */
  {
    const NAMES = ['holdLog', 'boughtLossText', 'boughtOnVerdict'];
    const missing = NAMES.filter((n) => !fnSrc(n));
    check('holdLog, boughtLossText and boughtOnVerdict can be lifted out of server.js', !missing.length, missing.join(', '));
    const mem = new DatabaseSync(':memory:');
    mem.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, og_tier INTEGER NOT NULL DEFAULT 0, og_rule_v2_at INTEGER);
      CREATE TABLE holder_state (user_id INTEGER PRIMARY KEY, send_qual INTEGER, gwc_qual INTEGER);
      CREATE TABLE size_topups (id INTEGER PRIMARY KEY, user_id INTEGER, token TEXT, done_at INTEGER);
      CREATE TABLE hold_migration_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, feature TEXT NOT NULL, was TEXT, became TEXT, reason TEXT, at INTEGER NOT NULL,
        rule_v INTEGER, noted INTEGER NOT NULL DEFAULT 0, UNIQUE (user_id, feature));`);
    const SEND = '0xsend', GWC = '0xgwc', notes = [], STATES = new Map();
    let raiseTo = null;
    const E = {
      db: mem, now: () => 1800000000000, MIN_HOLD_USD: 100, BOUGHT_LIB: { LIMITS: { HELD_MIN_USD: 10 }, RULE_V: 2 }, TOK: { SEND, GWC }, DH_COINS: { [SEND]: 'SEND', [GWC]: 'GWC' },
      notify: (uid, icon, text) => notes.push({ uid, text }), sizeTopupApply: () => 0,
      BOUGHT: { stateOf: (uid, t) => STATES.get(uid + ':' + t) || null },
      checkOg: async (uid) => { if (raiseTo != null) mem.prepare('UPDATE users SET og_tier = ? WHERE id = ?').run(raiseTo, uid); return 0; },
    };
    const K = new Function(...Object.keys(E), NAMES.map(fnSrc).join('\n') + '\nreturn { holdLog, boughtLossText, boughtOnVerdict };')(...Object.values(E));
    const fresh = (o) => ({ fresh: true, complete: true, floor: false, reason: 'short-spent', spentUsd: 63.2, heldCostUsd: 63.2, pendingUsd: 0, ...o });
    mem.prepare('INSERT INTO users (id, og_tier) VALUES (1, 2)').run(); mem.prepare('INSERT INTO holder_state (user_id, send_qual, gwc_qual) VALUES (1, 1, 0)').run();
    const lost = fresh();
    STATES.set('1:' + SEND, lost);
    K.boughtOnVerdict(1, SEND, null, lost, {});
    const row = mem.prepare("SELECT * FROM hold_migration_log WHERE user_id = 1 AND feature = 'holder:SEND'").get();
    const note = (notes.find((n) => n.uid === 1) || {}).text || '';
    check('a member whose $SEND qualified under the old rule and not under "$100 bought": logged (was 1, became 0, its reason) — no wallet, no figure', row && row.was === '1' && row.became === '0' && row.reason === 'short-spent', JSON.stringify(row));
    check('  ...and told, with their own figure and what is missing', /Your \$SEND boost now needs \$100 of \$SEND bought \(a buy counts once held 24 h\), \$10 of it still held at cost\. Your wallets show \$63\.20 bought: \$36\.80 short\. The streak pauses; it does not reset\.$/.test(note), note);
    check('  ...within a notification\'s 240 characters, and never "buy"', note.length <= 240 && !/\b(buy (more|now|back|in)|go buy|you should buy|buy at least)\b/i.test(note), note.length);
    K.boughtOnVerdict(1, SEND, lost, fresh({ spentUsd: 70 }), {});
    check('  ...once: a later verdict is the ordinary rule, not the switch', notes.filter((n) => n.uid === 1).length === 1 && mem.prepare("SELECT COUNT(*) n FROM hold_migration_log WHERE user_id = 1").get().n === 1);
    const gain = fresh({ floor: true, reason: 'ok', spentUsd: 400, heldCostUsd: 400 });
    STATES.set('1:' + GWC, gain);
    raiseTo = 3;
    K.boughtOnVerdict(1, GWC, null, gain, {});
    await new Promise((ok) => setTimeout(ok, 20));
    const g = mem.prepare("SELECT * FROM hold_migration_log WHERE user_id = 1 AND feature = 'holder:GWC'").get();
    check('a gain is logged and applies at once, with no note', g && g.was === '0' && g.became === '1' && notes.filter((n) => n.uid === 1).length === 1, JSON.stringify(g));
    const og = mem.prepare("SELECT * FROM hold_migration_log WHERE user_id = 1 AND feature = 'og'").get();
    check('OG, once both coins have a verdict: logged raised (Silver → Gold), and marked decided under the new rule (og_rule_v2_at)', og && og.was === '2' && og.became === '3' && og.reason === 'raised' && mem.prepare('SELECT og_rule_v2_at FROM users WHERE id = 1').get().og_rule_v2_at > 0, JSON.stringify(og));
    /* The first switch-on (rule 1, 2026-11-18) decided from a half-read tape and told five members their wallets held none; the old
       code then put their statuses back from their balances. Its rows stay in the log, marked rule 1 (rule_v NULL) and told
       (noted). Rule 2's first decision replaces each such row — and tells nobody a second time. Member 2's status was lowered by
       rule 1 and not put back yet (send_qual 0): the row keeps the status from before the switch. */
    const r1 = (uid, was, became, reason, noted) => mem.prepare('INSERT INTO hold_migration_log (user_id, feature, was, became, reason, at, rule_v, noted) VALUES (?,?,?,?,?,?,NULL,?)').run(uid, 'holder:SEND', was, became, reason, 1, noted);
    for (const [uid, q] of [[2, 0], [3, 1], [4, 1]]) { mem.prepare('INSERT INTO users (id, og_tier) VALUES (?, 0)').run(uid); mem.prepare('INSERT INTO holder_state (user_id, send_qual, gwc_qual) VALUES (?,?,0)').run(uid, q); }
    r1(2, '1', '0', 'none-held', 1); r1(3, '1', '0', 'none-held', 1); r1(4, '1', '1', 'ok', 0);
    const told = (uid) => notes.filter((n) => n.uid === uid).length;
    K.boughtOnVerdict(2, SEND, null, fresh({ spentUsd: 40, heldCostUsd: 40 }), {});
    const row2 = mem.prepare("SELECT * FROM hold_migration_log WHERE user_id = 2 AND feature = 'holder:SEND'").get();
    check('a member rule 1 told "holds none", whose rule-2 verdict is a no too: the row is rule 2\'s now (its reason, the status before the switch kept) — and no second note',
      row2.rule_v === 2 && row2.was === '1' && row2.became === '0' && row2.reason === 'short-spent' && row2.noted === 1 && told(2) === 0, JSON.stringify({ row2, n: told(2) }));
    K.boughtOnVerdict(3, SEND, null, fresh({ floor: true, reason: 'ok', spentUsd: 400, heldCostUsd: 400 }), {});
    const row3 = mem.prepare("SELECT * FROM hold_migration_log WHERE user_id = 3 AND feature = 'holder:SEND'").get();
    check('  ...one whose rule-2 verdict is a yes: logged kept (became 1), no note', row3.rule_v === 2 && row3.became === '1' && told(3) === 0, JSON.stringify(row3));
    K.boughtOnVerdict(4, SEND, null, fresh(), {});
    check('  ...one rule 1 kept and rule 2 refuses: told now, once — it is their first loss', told(4) === 1 && mem.prepare("SELECT noted, became FROM hold_migration_log WHERE user_id = 4").get().noted === 1);
    K.boughtOnVerdict(2, SEND, null, fresh({ reason: 'short-held', spentUsd: 150, heldCostUsd: 4 }), {}); K.boughtOnVerdict(4, SEND, null, fresh({ spentUsd: 20 }), {});
    check('  ...and a later rule-2 verdict is the ordinary rule: nothing logged again, nobody told again', told(2) === 0 && told(4) === 1 && mem.prepare("SELECT reason FROM hold_migration_log WHERE user_id = 2").get().reason === 'short-spent');
    // the log itself, on the first boot of rule 2: its rows get the rule column (NULL: rule 1) and "told" for every loss told then,
    // and rule 1's verdicts go (their figures came from the half-read tape)
    const BL = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'bought.js'));
    const old = new DatabaseSync(':memory:');
    old.exec(`CREATE TABLE hold_migration_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, feature TEXT NOT NULL, was TEXT, became TEXT, reason TEXT, at INTEGER NOT NULL, UNIQUE (user_id, feature));
      CREATE TABLE acq_state (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, token TEXT NOT NULL, wallets_sig TEXT NOT NULL, rule_v INTEGER NOT NULL, block INTEGER, verdict INTEGER, spent_bucket INTEGER, why TEXT, reason_code TEXT,
        complete INTEGER NOT NULL DEFAULT 0, due_at INTEGER, dirty INTEGER NOT NULL DEFAULT 0, conflicts INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0, lots_enc TEXT, cursors_enc TEXT, dates_enc TEXT, wei_enc TEXT, at INTEGER NOT NULL, UNIQUE (user_id, token));`);
    for (const [u, f, w, b] of [[1, 'holder:SEND', '1', '0'], [2, 'holder:GWC', '1', '1'], [3, 'community:7', '1', '0'], [4, 'gate', 'failed', 'failed'], [5, 'og', '1', '0']]) old.prepare('INSERT INTO hold_migration_log (user_id, feature, was, became, reason, at) VALUES (?,?,?,?,?,1)').run(u, f, w, b, 'x');
    for (let u = 1; u <= 3; u++) old.prepare("INSERT INTO acq_state (user_id, token, wallets_sig, rule_v, verdict, reason_code, complete, at) VALUES (?, '0xsend', '1', 1, 0, 'none-held', 1, 1)").run(u);
    const m1 = BL.migrate(old), m2 = BL.migrate(old);
    const noted = old.prepare('SELECT user_id FROM hold_migration_log WHERE noted = 1 ORDER BY user_id').all().map((r) => r.user_id);
    check('the first boot of rule 2: the log gets its rule column (rule 1\'s rows NULL) and marks the losses rule 1 told (holder and community slots) — said once, so the server resets what rule 1 marked',
      m1.logUpgraded === true && m2.logUpgraded === false && JSON.stringify(noted) === '[1,3]' && old.prepare('SELECT COUNT(*) n FROM hold_migration_log WHERE rule_v IS NULL').get().n === 5, JSON.stringify({ m1, m2, noted }));
    check('  ...and rule 1\'s verdicts are dropped (no answer, and their figures came from the half-read tape)', m1.dropped === 3 && old.prepare('SELECT COUNT(*) n FROM acq_state').get().n === 0);
    check('  ...the server, on that boot only, clears OG\'s "decided under the new rule" and the door\'s reason codes rule 1 wrote (each decided again under rule 2)',
      /if \(m && m\.logUpgraded\) \{\n\s+try \{ db\.prepare\('UPDATE users SET og_rule_v2_at = NULL WHERE og_rule_v2_at IS NOT NULL'\)\.run\(\); \} catch \{\}\n\s+try \{ db\.prepare\('UPDATE users SET holder_reason_code = NULL WHERE holder_reason_code IS NOT NULL'\)\.run\(\); \} catch \{\}/.test(SRC));
    check('  ...every caller sends a loss note only on holdLog\'s say-so (once ever), never on its own reading of was/became',
      (SRC.match(/lg && lg\.note/g) || []).length === 2 && /firstUnderBought && firstUnderBought\.note/.test(SRC) && !/holdLog\([^\n]*\) && was === 1 && became === 0/.test(SRC));
    const held = K.boughtLossText('$ZQB', fresh({ reason: 'short-held', spentUsd: 250, heldCostUsd: 4 }), 'community');
    check('a community slot lost on the $10-held rule says so, with the figures, within 240 characters', /Your \$ZQB community slot now needs/.test(held) && /\$250\.00 bought, \$4\.00 still held: \$6\.00 short\. The slot is paused\.$/.test(held) && held.length <= 240, held);
    check('the community sweep and the go-live re-check log a slot\'s first decision and tell a loser', (SRC.match(/boughtLossText\('\$' \+ (r|c)\.symbol, st, 'community'\)/g) || []).length === 2);
    check('old refusals are re-asked under the new rule once $SEND\'s tape is read, leaving twenty places for members pressing the button (who go first)',
      /function requeueBoughtRuleProofs\(\) \{/.test(SRC) && /const room = PROOF_QUEUE_MAX - 20 - proofQueue\.length;/.test(SRC) && /AND u\.holder_reason_code IS NULL/.test(SRC)
      && /if \(front\) proofQueue\.unshift\(userId\); else proofQueue\.push\(userId\);/.test(SRC) && /if \(!queueHolderProof\(me\.id, true\)\) return send\(res, 503, \{ error: 'busy/.test(SRC));
    // the overview, through the API (the throwaway server names 987654 its admin: run.mjs ADMIN_USER_IDS)
    db.prepare('DELETE FROM users WHERE id = ?').run(987654);
    db.prepare('INSERT INTO users (id, username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?,?)').run(987654, '__bs_admin__', Date.now(), '🧪', Date.now(), 'ok');
    made.users.push(987654);
    const raw = 'tok___bs_admin__' + randomBytes(6).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), 987654, Date.now(), Date.now() + 864e5);
    const ov = await api('/api/admin/overview', { sid: raw });
    const b = ov.j && ov.j.bought;
    check('/admin counts it: each coin\'s tape, the switch per feature, unknowns, claims and conflicts, the sizes to settle', ov.status === 200 && b && Array.isArray(b.coins) && b.coins.some((c) => c.label === '$SEND' && c.core) && b.coins.some((c) => c.label === '$GWC')
      && b.migration && Array.isArray(b.unknown) && Number.isFinite(b.claims) && Number.isFinite(b.conflicts) && b.sizeTopups, JSON.stringify(b).slice(0, 300));
    check('  ...naming nobody and no address', !/0x[0-9a-f]{40}/i.test(JSON.stringify(b)) && !/user_?id|username/i.test(JSON.stringify(b)));
    check('  ...and the admin page shows it (boughtPanel)', /boughtPanel\(o\.bought\)/.test(readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8')));
    check('the switch\'s log, the verdicts and the sizes still to settle go with a deleted account (claims stay)', /'uploads', 'acq_state', 'hold_migration_log', 'size_topups', 'tracker_cache', 'wallet_hist', 'burn_proofs'\]\)/.test(SRC) && !/DELETE FROM buy_claims/.test(SRC));
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
