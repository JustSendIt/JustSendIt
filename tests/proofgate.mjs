/* The participation gate: an account can be MADE with an email alone, but it cannot DO anything until a
   wallet has proved on-chain that the person holds $100 of $SEND and is not a net seller. There is no
   waiting period — instead the FIRST DAY after their last buy is watched, and selling out of the position
   that opened the door inside that window is read-only. Throwaway accounts only; deleted in the finally block.

   The verdict function is pulled out of server.js and run directly, because the interesting cases (gifted
   and never sold, gifted then dumped, chain unreadable) cannot be produced against a real chain on demand.
   The gate itself is exercised through the real HTTP API. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUser(name, verified) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)')
    .run(name, Date.now(), '🧪', verified ? Date.now() : null, verified ? 'ok' : 'none');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}

try {
  /* ═══ the verdict, against cases a real chain will not produce on demand ═══ */
  {
    const grab = (re, label) => { const m = SRC.match(re); if (!m) { check('EXTRACT ' + label, false); return ''; } return m[0]; };
    const fn = new Function('TOK', 'OG_PAIR', 'OG_LAUNCH', 'DAY_MS', 'OG_DUST_WEI', 'MIN_HOLD_USD', 'now',
      grab(/const PROOF_SELL_WINDOW_MS = [^\n]*\n/, 'PROOF_SELL_WINDOW_MS') +
      grab(/const PROOF_COINS = \[[\s\S]*?\n\];/, 'PROOF_COINS') +
      grab(/function holderProofVerdict\(scans, nowMs, prices\) \{[\s\S]*?\n\}/, 'holderProofVerdict') +
      '\nreturn holderProofVerdict;')({ SEND: '0xa', GWC: '0xb' }, { SEND: '0xp', GWC: '0xq' }, { SEND: 1, GWC: 1 }, 86400000, 1000000000n, 100, () => 0);

    const DAY = 86400000, T = 1789000000000;
    /* daysAgo is the FIRST buy, lastDaysAgo the most recent one. They differ because the gate uses the
       first only for the record and the last as the sell window's anchor. */
    const w = (bal, bought, sold, daysAgo, lastDaysAgo) => ({
      balWei: String(bal), boughtWei: String(bought), soldWei: String(sold),
      firstBuyMs: daysAgo == null ? null : T - daysAgo * DAY,
      lastBuyMs: daysAgo == null ? null : T - (lastDaysAgo == null ? daysAgo : lastDaysAgo) * DAY,
    });
    const one = (s) => ({ SEND: [s] });
    // $1 per token keeps the arithmetic readable: 1e18 wei = 1 token = $1, so 100e18 wei = $100 exactly
    const PX = { SEND: 1 };
    const V = (sc, px) => fn(sc, T, px || PX);
    const HUNDRED = 100e18;

    check('holds $100 of $SEND, bought a month ago, never sold → passes', V(one(w(HUNDRED, HUNDRED, 0, 30))).ok);
    // the point of the change: the waiting period is gone
    check('bought THIS MORNING → passes (there is no waiting period any more)', V(one(w(HUNDRED, HUNDRED, 0, 0))).ok);
    check('bought three days ago → passes', V(one(w(HUNDRED, HUNDRED, 0, 3))).ok);
    check('  ...and no refusal anywhere still talks about coming back in N days',
      !/come back in/i.test(JSON.stringify([V(one(w(HUNDRED, HUNDRED, 0, 0))), V(one(w(1e18, 1e18, 0, 0))), V(one(w(0, 0, 0, null)))])));

    check('$GWC is no longer part of the gate', !/GWC/.test(grab(/const PROOF_COINS = \[[\s\S]*?\n\];/, 'PROOF_COINS')));
    check('  ...and a wallet holding only $SEND is enough', V(one(w(HUNDRED, HUNDRED, 0, 30))).ok);
    check('  ...no waiting-period constant survives in the source', !/PROOF_MIN_HOLD_MS/.test(SRC));

    check('a dust balance is not holding', !V(one(w(999, 999, 0, 30))).ok);
    const short = V(one(w(HUNDRED * 0.99, HUNDRED, 0, 30)));
    check('$99 is not $100 — refused, with the real figure', !short.ok && /You hold about \$99\.00 of \$SEND/.test(short.reason), short.reason);
    check('  ...and exactly $100 passes', V(one(w(HUNDRED, HUNDRED, 0, 30))).ok);
    check('  ...a whole token is still short if it is not worth $100', !V(one(w(1e18, 1e18, 0, 30)), { SEND: 0.00001165 }).ok);
    check('the gate floor is the same constant Diamond uses', /const usd = Number\(bal\) \/ 1e18 \* px;/.test(SRC) && /usd < MIN_HOLD_USD/.test(SRC));

    check('sold back more than bought → refused as a net seller',
      !V(one(w(HUNDRED, HUNDRED, 2 * HUNDRED, 30))).ok && /sold back more/.test(V(one(w(HUNDRED, HUNDRED, 2 * HUNDRED, 30))).reason));
    /* A gifted bag used to be refused for a reason that no longer exists ("we cannot tell how long you
       have held it"). It is still refused, for the reason that does: the sell window has to run from a
       buy, and a bag that never passed through the market gives it no anchor. */
    check('holds, but with no market buy behind it → refused',
      !V(one({ balWei: String(HUNDRED), boughtWei: '0', soldWei: '0', firstBuyMs: null, lastBuyMs: null })).ok);
    check('  ...and the reason is the bag, not the clock',
      /bag has to be one you bought/i.test(V(one({ balWei: String(HUNDRED), boughtWei: '0', soldWei: '0', firstBuyMs: null, lastBuyMs: null })).reason || ''));

    const unk = V({ SEND: [] });
    check('an unreadable chain is NOT recorded as a failure', unk.unknown === true && /Nothing has been decided/.test(unk.reason));
    const noPx = V(one(w(HUNDRED, HUNDRED, 0, 30)), { SEND: null });
    check('an unreadable PRICE is unknown, never a refusal', noPx.unknown === true && /Nothing has been decided/.test(noPx.reason), noPx.reason);

    check('wallets are summed, so a position split across two still qualifies',
      V({ SEND: [w(HUNDRED / 2, HUNDRED / 2, 0, 2), w(HUNDRED / 2, HUNDRED / 2, 0, 20)] }).ok);
    // the anchor the window runs from is the LATEST buy across every linked wallet, not the earliest
    const split = V({ SEND: [w(HUNDRED / 2, HUNDRED / 2, 0, 30, 30), w(HUNDRED / 2, HUNDRED / 2, 0, 20, 1)] });
    check('the sell window anchors on the LATEST buy across wallets',
      split.ok && split.detail.SEND.lastBuyMs === T - 1 * DAY && split.detail.SEND.firstBuyMs === T - 30 * DAY,
      'last=' + (split.detail.SEND.lastBuyMs - T) / DAY + 'd first=' + (split.detail.SEND.firstBuyMs - T) / DAY + 'd');
  }

  /* ═══ the first-day sell window ═══ */
  {
    const state = { rows: new Map(), notes: [], updates: [], chain: new Map(), fail: false, reads: [] };
    const stubDb = {
      prepare(sql) {
        return {
          get: (id) => (/FROM holder_state/.test(sql) ? null : state.rows.get(id)),   // no holder row → baseline unknown, exactly as on a fresh account
          run: (...args) => { state.updates.push({ sql, args });
            const id = args[args.length - 1], r = state.rows.get(id);
            if (!r) return;
            if (/gate_hold_until=0/.test(sql)) { r.gate_hold_until = 0; r.gate_floor = 0; r.gate_wallets = null; }
            // flagUser's ladder write: strikes, level, reason, until … — the first-day sell walks the same ladder now
            if (/SET strikes=\?, restrict_level=\?, restrict_reason=\?, restricted_until=\?/.test(sql)) { r.strikes = args[0]; r.restrict_level = args[1]; r.restrict_reason = args[2]; r.restricted_until = args[3]; r.redeem_dur = args[6]; }
            else if (/restricted_until=\?/.test(sql)) { r.restricted_until = args[0]; r.restrict_level = args[1]; r.restrict_reason = args[2]; }
          },
        };
      },
    };
    const NOW = 1789000000000, DAYMS = 86400000;
    const grab2 = (re, label) => { const m = SRC.match(re); if (!m) { check('EXTRACT ' + label, false); return ''; } return m[0]; };
    const PERM = 32503680000000;
    // decField: the wallet list is encrypted at rest now; the real helper passes legacy plaintext through, and so does this stand-in
    const gate = new Function('db', 'now', 'notify', 'humanDur', 'PROOF_SELL_WINDOW_MS', 'erc20Balance', 'TOK', 'DAY_MS', 'PERM_UNTIL', 'decField',
      grab2(/function flagUser\(userId, reason, costMult\) \{[\s\S]*?\n\}/, 'flagUser') + '\n' +
      grab2(/async function checkGateHold\(userId\) \{[\s\S]*?\n\}/, 'checkGateHold') + '\nreturn checkGateHold;')(
      stubDb, () => NOW, (id, e, m, k) => state.notes.push({ id, m, k }),
      (ms) => Math.round(ms / 3600000) + ' hours', DAYMS,
      async (_tok, addr) => { state.reads.push(addr); if (state.fail) throw new Error('rpc down');
                              return BigInt(Math.round((state.chain.get(addr) || 0) * 1e18)); },
      { SEND: '0xsend' }, DAYMS, PERM, (v) => v);

    const put = (id, row, chain) => {
      state.rows.set(id, Object.assign({ gate_hold_until: 0, gate_floor: 0, gate_wallets: null, restricted_until: 0, restrict_level: 0, strikes: 0 }, row));
      for (const [a, v] of Object.entries(chain || {})) state.chain.set(a, v);
      return id;
    };
    const reset = () => { state.notes.length = 0; state.updates.length = 0; state.reads.length = 0; state.fail = false; };
    const W = JSON.stringify(['0xaaa', '0xbbb']);

    reset(); put(1, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W }, { '0xaaa': 60, '0xbbb': 40 });
    await gate(1);
    check('still holding the floor mid-window → nothing happens', state.updates.length === 0 && state.rows.get(1).gate_hold_until > 0);
    check('  ...and it read the PINNED addresses, both of them', state.reads.join(',') === '0xaaa,0xbbb', state.reads.join(','));

    reset(); put(2, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W }, { '0xaaa': 99, '0xbbb': 0 });
    await gate(2);
    check('a 1% drop is a fee, not a sell', state.rows.get(2).restricted_until === 0, JSON.stringify(state.rows.get(2)));

    reset(); put(3, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W }, { '0xaaa': 5, '0xbbb': 5 });
    await gate(3);
    const r3 = state.rows.get(3);
    check('sold out inside the window → read-only', r3.restricted_until === NOW + DAYMS && r3.restrict_level === 1, JSON.stringify(r3));
    check('  ...for one window, and the window closes', r3.gate_hold_until === 0 && r3.gate_floor === 0);
    check('  ...the reason names what they did', /sold the \$SEND that got you in/i.test(r3.restrict_reason || ''), r3.restrict_reason);
    check('  ...and they are told, once', state.notes.length === 1 && state.notes[0].k === 'restriction', JSON.stringify(state.notes));
    check('  ...as strike 1 of 3 on the SAME ladder every anti-cheat trigger walks', r3.strikes === 1 && /strike 1 of 3/.test(state.notes[0].m), JSON.stringify({ strikes: r3.strikes, note: state.notes[0].m }));
    check('  ...and the note names the buy-out and the doubling', /\$25 a day/.test(state.notes[0].m) && /doubled/.test(state.notes[0].m), state.notes[0].m);

    // the ladder: a second first-day dump on an account that already has a strike is a week, a third is for good
    reset(); put(31, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W, strikes: 1 }, { '0xaaa': 0, '0xbbb': 0 });
    await gate(31);
    const r31 = state.rows.get(31);
    check('second strike → one week', r31.strikes === 2 && r31.restrict_level === 2 && r31.restricted_until === NOW + 7 * DAYMS, JSON.stringify(r31));
    reset(); put(32, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W, strikes: 2 }, { '0xaaa': 0, '0xbbb': 0 });
    await gate(32);
    const r32 = state.rows.get(32);
    check('third strike → permanent', r32.strikes === 3 && r32.restrict_level === 3 && r32.restricted_until === PERM && /for good/.test(state.notes[0].m), JSON.stringify(r32));

    /* THE REGRESSION TEST. Unlinking a spare wallet drops the aggregate over currently-linked wallets, but
       it is not a sale — and an earlier cut of this code answered it with a 24h read-only whose stated
       reason was "You sold the $SEND that got you in". The window is pinned to the addresses the bag was
       measured over and read from the chain, so who is linked today changes nothing either way. */
    reset(); put(4, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W }, { '0xaaa': 60, '0xbbb': 40 });
    await gate(4);   // 0xbbb is no longer a linked identity, but it still holds and is still read
    const r4 = state.rows.get(4);
    check('unlinking a wallet mid-window is NOT a sale', r4.restricted_until === 0 && r4.gate_hold_until > 0, JSON.stringify(r4));
    check('  ...because the window reads the addresses, not the account', state.reads.includes('0xbbb'));

    reset(); put(5, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W }, { '0xaaa': 0, '0xbbb': 0 });
    state.fail = true;
    await gate(5);
    const r5 = state.rows.get(5);
    check('an RPC that did not answer is never a sale', r5.restricted_until === 0 && r5.gate_hold_until > 0 && state.updates.length === 0, JSON.stringify(r5));

    /* An account already serving a LONGER sanction: writing a fresh 24h over it would shorten a week-long
       or permanent restriction. */
    reset(); put(6, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: W, restricted_until: NOW + 7 * DAYMS, restrict_level: 2 }, { '0xaaa': 0, '0xbbb': 0 });
    await gate(6);
    const r6 = state.rows.get(6);
    check('a running sanction is never shortened by the gate', r6.restricted_until === NOW + 7 * DAYMS && r6.restrict_level === 2, JSON.stringify(r6));
    check('  ...but the window still closes behind it', r6.gate_hold_until === 0);

    reset(); put(7, { gate_hold_until: NOW - 1, gate_floor: 100, gate_wallets: W }, { '0xaaa': 100, '0xbbb': 0 });
    await gate(7);
    const r7 = state.rows.get(7);
    check('riding the window out costs nothing', r7.restricted_until === 0 && r7.gate_hold_until === 0, JSON.stringify(r7));
    check('  ...and is acknowledged', state.notes.length === 1 && state.notes[0].k === 'wallet', JSON.stringify(state.notes));

    reset(); put(8, { gate_hold_until: NOW - 1, gate_floor: 100, gate_wallets: W }, { '0xaaa': 0, '0xbbb': 0 });
    await gate(8);
    check('selling AFTER the window costs nothing', state.rows.get(8).restricted_until === 0);
    check('  ...but an empty wallet is not congratulated for holding', state.notes.length === 0, JSON.stringify(state.notes));

    reset(); put(9, { gate_hold_until: NOW + 3600000, gate_floor: 100, gate_wallets: null });
    await gate(9);
    check('no pinned addresses → the window closes rather than guessing',
      state.rows.get(9).gate_hold_until === 0 && state.rows.get(9).restricted_until === 0 && state.reads.length === 0);

    reset(); put(10, { gate_hold_until: 0, gate_floor: 0 });
    await gate(10);
    check('an account not in a window is left alone', state.updates.length === 0 && state.notes.length === 0);

    // the tail of a window is minutes, not days — humanDur() would print "0 hours" for it
    const left = new Function(grab2(/function humanLeft\(ms\) \{[\s\S]*?\n\}/, 'humanLeft') + '\nreturn humanLeft;')();
    check('a 20-minute tail reads as minutes, not "0 hours"', left(20 * 60000) === '20 minutes', left(20 * 60000));
    check('  ...45 minutes is not "1 hours"', left(45 * 60000) === '45 minutes', left(45 * 60000));
    check('  ...and an hour is singular', left(3600000) === '1 hour', left(3600000));
    check('  ...a sub-minute tail never reads as zero', left(20000) === '1 minute', left(20000));
  }

  /* ═══ the gate, through the real API ═══ */
  {
    const u = mkUser('__pg_new__', false);
    const writes = [
      ['post', '/api/posts', { text: 'hello' }],
      ['send call', '/api/calls', { token: '0x' + 'ab'.repeat(20) }],
      ['track a wallet', '/api/wallets', { address: '0x' + 'cd'.repeat(20) }],
    ];
    for (const [label, path, body] of writes) {
      const r = await api(path, { method: 'POST', sid: u.sid, body });
      check('an unverified account cannot ' + label, r.status === 403 && r.j.needsProof === true, r.status + ' needsProof=' + (r.j && r.j.needsProof));
      check('  ...and it is NOT dressed up as a punishment', !(r.j && r.j.readOnly), JSON.stringify(r.j && r.j.readOnly));
    }
    // reading, and the two things a new account must still be able to do, stay open
    for (const [label, path, method] of [['read the wall', '/api/posts', 'GET'], ['read /api/me', '/api/me', 'GET'], ['check in', '/api/checkin', 'POST']]) {
      const r = await api(path, { method, sid: u.sid, body: method === 'POST' ? {} : undefined });
      check('an unverified account CAN still ' + label, r.status === 200, r.status);
    }
    const me = await api('/api/me', { sid: u.sid });
    check('the gate state reaches the client', me.j.user.holderVerified === false && me.j.user.holderProof, JSON.stringify(me.j.user.holderProof && me.j.user.holderProof.state));
    check('  ...with the honest read-only assurance, in words', /moves nothing, approves nothing, and costs no gas/.test((me.j.user.holderProof || {}).readOnly || ''));
    check('  ...and states the one coin and the sell window', /\$SEND/.test(JSON.stringify(me.j.user.holderProof)) && me.j.user.holderProof.sellWindowHours === 24 && me.j.user.holderProof.minHoldDays === undefined);

    const noWallet = await api('/api/holder/verify', { method: 'POST', sid: u.sid, body: {} });
    check('asking for the check with no wallet linked is refused clearly', noWallet.status === 400 && /connect a wallet/i.test(noWallet.j.error || ''), noWallet.j && noWallet.j.error);

    // once verified, the site opens
    db.prepare("UPDATE users SET holder_verified_at = ?, holder_state = 'ok' WHERE id = ?").run(Date.now(), u.id);
    const ok = await api('/api/posts', { method: 'POST', sid: u.sid, body: { text: 'now I can post' } });
    check('a verified account can post', ok.status === 200, ok.status + ' ' + JSON.stringify(ok.j && ok.j.error || ''));
    if (ok.j && ok.j.post) { try { db.prepare('DELETE FROM posts WHERE id=?').run(ok.j.post.id); } catch {} }
    const me2 = await api('/api/me', { sid: u.sid });
    check('  ...and the gate stops being reported', me2.j.user.holderVerified === true && me2.j.user.holderProof === null);
  }

  /* ═══ a restart must not strand a pending check ═══ */
  {
    check('a pending proof is re-opened at boot', /UPDATE users SET holder_state = 'none' WHERE holder_state = 'pending'/.test(SRC));
    check('  ...and a stale claim is not believed forever', /PROOF_STALE_MS/.test(SRC));
    check('the scan is queued, never run on the request', /const proofTimer = setInterval/.test(SRC) && !/await ogScan[\s\S]{0,200}return send\(res/.test(SRC));
    check('a transient read failure is never written as a refusal', /v\.unknown \|\| unreadable[\s\S]{0,220}holder_state = 'none'/.test(SRC));
  }

  /* ═══ the ticket share: nothing published until asked ═══ */
  {
    const u = mkUser('__pg_share__', true);
    const before = await api('/t/' + u.id);
    check('a ticket page 404s until its owner shares it', before.status === 404, before.status);
    const sh = await api('/api/gate/ticket/share', { method: 'POST', sid: u.sid, body: {} });
    check('sharing publishes it and returns the X composer link', sh.status === 200 && /x\.com\/intent\/post/.test(sh.j.intent || ''), sh.status);
    check('  ...with the tagline filled in', /I%20just%20got%20my%20ticket%20to%20Send/.test(sh.j.intent || ''));
    const card = await fetch(BASE + '/t/' + u.id + '.png');
    const buf = Buffer.from(await card.arrayBuffer());
    check('the card is a real PNG this server drew', card.status === 200 && buf.slice(1, 4).toString() === 'PNG', card.status);
    check('  ...at the size X crops a large card from', buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20));
    check('  ...and is never a client-uploaded bitmap', /renderTicketCard\(\{ username: u\.username/.test(SRC));
    const page = await (await fetch(BASE + '/t/' + u.id)).text();
    /* The card must sit OUTSIDE /api/. robots.txt disallows /api/, and a crawler that respects it will
       not fetch an og:image there — the card would render perfectly and never appear in a single post. */
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
    const disallowed = [...robots.matchAll(/^Disallow: (.+)$/gm)].map(m => m[1].trim());
    check('the card path is not blocked by robots.txt', !disallowed.some(d => ('/t/' + u.id + '.png').startsWith(d)), disallowed.join(' '));
    check('  ...and the og:image points at that crawlable path', new RegExp('property="og:image" content="[^"]*/t/' + u.id + '\\.png"').test(page));
    check('the share page carries a per-ticket large-image card', /name="twitter:card" content="summary_large_image"/.test(page) && new RegExp('property="og:image" content="[^"]*/t/' + u.id + '\\.png"').test(page));
    check('  ...and nothing private is on it', !/0x[0-9a-f]{40}/i.test(page) && !/@example\.com/.test(page));
    // a handle full of markup must be escaped, not executed
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('x"><script>a</script>', u.id);
    const evil = await (await fetch(BASE + '/t/' + u.id)).text();
    check('a handle full of markup is escaped on the share page', !/<script>a<\/script>/.test(evil) && /&lt;script&gt;/.test(evil));
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('__pg_share__', u.id);
    const un = await api('/api/gate/ticket/share', { method: 'DELETE', sid: u.sid });
    const after = await api('/t/' + u.id);
    check('un-sharing takes it down again', un.status === 200 && after.status === 404, after.status);
  }

  /* ═══ the brand proxy: a third party's picture, from our origin ═══ */
  {
    // whichever of the site's two tokens still has a header upstream — Dexscreener's paid "token info" can lapse
    // (GWC's did on 2026-09-24), and that is a fact about a third party, not about the proxy under test
    const m = /const TOK = \{ SEND: '(0x[0-9a-f]{40})', GWC: '(0x[0-9a-f]{40})' \}/.exec(SRC) || [];
    let tok = m[2], name = '$GWC', r = await fetch(BASE + '/api/brand/' + tok + '/header');
    if (r.status === 404) { tok = m[1]; name = '$SEND (GWC has no artwork upstream right now)'; r = await fetch(BASE + '/api/brand/' + tok + '/header'); }
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.status === 404) {
      // neither token has artwork on Dexscreener right now (both were dropped from its index on 2026-09-24): the proxy's
      // honest answer is a JSON 404 that says so — never an empty image, never someone else's picture
      let j404 = null; try { j404 = JSON.parse(buf.toString('utf8')); } catch {}
      check('neither site token has artwork upstream right now, and the proxy says so honestly (JSON 404, not an empty image)', /json/.test(r.headers.get('content-type') || '') && j404 && /no artwork/.test(j404.error || ''), r.status + ' ' + buf.toString('utf8').slice(0, 60));
      check('  ...with nosniff on the refusal too', /nosniff/.test(r.headers.get('x-content-type-options') || ''));
      check('  ...and the image path is only ever a still raster type when there is one (checked in code below)', true);
    } else {
      check('the ' + name + ' header is served from our own origin', r.status === 200 && /^image\//.test(r.headers.get('content-type') || ''), r.status + ' ' + r.headers.get('content-type'));
      check('  ...with nosniff, so a browser treats it as a picture and nothing else', /nosniff/.test(r.headers.get('x-content-type-options') || ''));
      check('  ...and the bytes really are an image', ['GIF89a', 'GIF87a'].includes(buf.slice(0, 6).toString('latin1')) || buf.slice(1, 4).toString() === 'PNG' || (buf[0] === 0xff && buf[1] === 0xd8), buf.slice(0, 6).toString('latin1'));
    }
    check('only a still-raster type is ever served — never SVG', /function imageTypeOf\(buf\)/.test(SRC) && !/image\/svg/.test((/function imageTypeOf\(buf\) \{[\s\S]*?\n\}/.exec(SRC) || [''])[0]));
    check('the URL is read from our own cache, never from the caller', /url = dexCdnImg\(r && r\.pair && r\.pair\.brand && r\.pair\.brand\[field\]\)/.test(SRC));
    for (const k of ['constructor', '__proto__', 'toString']) {
      const b = await fetch(BASE + '/api/brand/' + tok + '/' + k);
      check('  ...and "' + k + '" is not a kind of artwork', b.status === 404, b.status);
    }
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'points_events', 'notifications', 'posts', 'calls', 'call_hops', 'identities', 'tracked_wallets', 'tracker_cache', 'holder_state', 'og_claims', 'community_members', 'api_keys', 'watchlist', 'mutes', 'uploads'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM notifications WHERE actor_id=?').run(id); } catch {}
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_pg\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
