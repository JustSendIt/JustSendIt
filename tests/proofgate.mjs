/* The participation gate: an account can be MADE with an email alone, but it cannot DO anything until a
   wallet has proved on-chain that the person holds $SEND and $GWC, has held them over a week, and is not
   a net seller. Throwaway accounts only; deleted in the finally block.

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
      grab(/const PROOF_MIN_HOLD_MS = [^\n]*\n/, 'PROOF_MIN_HOLD_MS') +
      grab(/const PROOF_COINS = \[[\s\S]*?\n\];/, 'PROOF_COINS') +
      grab(/function holderProofVerdict\(scans, nowMs, prices\) \{[\s\S]*?\n\}/, 'holderProofVerdict') +
      '\nreturn holderProofVerdict;')({ SEND: '0xa', GWC: '0xb' }, { SEND: '0xp', GWC: '0xq' }, { SEND: 1, GWC: 1 }, 86400000, 1000000000n, 100, () => 0);

    const DAY = 86400000, T = 1789000000000;
    const w = (bal, bought, sold, daysAgo) => ({ balWei: String(bal), boughtWei: String(bought), soldWei: String(sold), firstBuyMs: daysAgo == null ? null : T - daysAgo * DAY });
    const both = (s, g) => ({ SEND: [s], GWC: [g] });
    // $1 per token keeps the arithmetic readable: 1e18 wei = 1 token = $1, so 100e18 wei = $100 exactly
    const PX = { SEND: 1, GWC: 1 };
    const V = (sc, px) => fn(sc, T, px || PX);
    const HUNDRED = 100e18;

    check('holds both, a month, never sold → passes', V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED, HUNDRED, 0, 30))).ok);
    check('bought this week → refused, and told how long is left',
      !V(both(w(HUNDRED, HUNDRED, 0, 3), w(HUNDRED, HUNDRED, 0, 30))).ok && /come back in 4 days/.test(V(both(w(HUNDRED, HUNDRED, 0, 3), w(HUNDRED, HUNDRED, 0, 30))).reason));
    check('exactly seven days → passes (the bar is "over a week", inclusive at the day boundary)',
      V(both(w(HUNDRED, HUNDRED, 0, 7), w(HUNDRED, HUNDRED, 0, 8))).ok);
    check('one coin missing → refused, and names which', !V(both(w(HUNDRED, HUNDRED, 0, 30), w(0, 0, 0, null))).ok && /\$GWC/.test(V(both(w(HUNDRED, HUNDRED, 0, 30), w(0, 0, 0, null))).reason));
    check('a dust balance is not holding', !V(both(w(HUNDRED, HUNDRED, 0, 30), w(999, 999, 0, 30))).ok);
    // the floor the user set, with the arithmetic in hand: $100 of each coin, priced live
    const short = V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED * 0.99, HUNDRED, 0, 30)));
    check('$99 of a coin is not $100 — refused, with the real figure', !short.ok && /You hold about \$99\.00 of \$GWC/.test(short.reason), short.reason);
    check('  ...and exactly $100 passes', V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED, HUNDRED, 0, 30))).ok);
    check('  ...a whole token of a cheap coin is still dust if it is not worth $100',
      !V(both(w(HUNDRED, HUNDRED, 0, 30), w(1e18, 1e18, 0, 30)), { SEND: 1, GWC: 0.00001165 }).ok);
    const noPx = V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED, HUNDRED, 0, 30)), { SEND: 1, GWC: null });
    check('an unreadable PRICE is unknown, never a refusal', noPx.unknown === true && /Nothing has been decided/.test(noPx.reason), noPx.reason);
    check('the gate floor is the same constant Diamond uses', /const usd = Number\(bal\) \/ 1e18 \* px;/.test(SRC) && /usd < MIN_HOLD_USD/.test(SRC));
    check('sold back more than bought → refused as a net seller',
      !V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED, HUNDRED, 2 * HUNDRED, 30))).ok && /sold back more/.test(V(both(w(HUNDRED, HUNDRED, 0, 30), w(HUNDRED, HUNDRED, 2 * HUNDRED, 30))).reason));
    // the two cases that prove the rule is about the MARKET side, not the balance
    check('gifted and never sold → passes (bought 0, sold 0 — they have never net-sold)',
      V(both(w(HUNDRED, HUNDRED, 0, 30), { balWei: String(HUNDRED), boughtWei: '0', soldWei: '0', firstBuyMs: T - 30 * DAY })).ok);
    check('gifted then dumped most of it → refused (sold 90, bought 0)',
      !V(both(w(HUNDRED, HUNDRED, 0, 30), { balWei: String(HUNDRED), boughtWei: '0', soldWei: String(90 * HUNDRED), firstBuyMs: T - 30 * DAY })).ok);
    check('holds but with no market buy behind it → refused, honestly ("we cannot tell how long")',
      /cannot tell how long/.test(V(both(w(HUNDRED, HUNDRED, 0, 30), { balWei: String(HUNDRED), boughtWei: '0', soldWei: '0', firstBuyMs: null })).reason || ''));
    // the one that matters most: an unreadable chain is NOT a refusal
    const unk = V({ SEND: [w(HUNDRED, HUNDRED, 0, 30)], GWC: [] });
    check('an unreadable chain is NOT recorded as a failure', unk.unknown === true && /Nothing has been decided/.test(unk.reason));
    check('wallets are summed, so a position split across two still qualifies',
      V({ SEND: [w(HUNDRED, HUNDRED, 0, 30)], GWC: [w(HUNDRED / 2, HUNDRED / 2, 0, 2), w(HUNDRED / 2, HUNDRED / 2, 0, 20)] }).ok);
    check('the floor is one week', /const PROOF_MIN_HOLD_MS = 7 \* DAY_MS;/.test(SRC));
    check('both coins are required, by name', /PROOF_COINS[\s\S]{0,300}\$SEND[\s\S]{0,200}\$GWC/.test(SRC));
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
    check('  ...and says both coins and the week', /\$SEND/.test(JSON.stringify(me.j.user.holderProof)) && me.j.user.holderProof.minHoldDays === 7);

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
    const tok = (/const TOK = \{ SEND: '(0x[0-9a-f]{40})', GWC: '(0x[0-9a-f]{40})' \}/.exec(SRC) || [])[2];
    const r = await fetch(BASE + '/api/brand/' + tok + '/header');
    const buf = Buffer.from(await r.arrayBuffer());
    check('the $GWC header is served from our own origin', r.status === 200 && /^image\//.test(r.headers.get('content-type') || ''), r.status + ' ' + r.headers.get('content-type'));
    check('  ...with nosniff, so a browser treats it as a picture and nothing else', /nosniff/.test(r.headers.get('x-content-type-options') || ''));
    check('  ...and the bytes really are an image', ['GIF89a', 'GIF87a'].includes(buf.slice(0, 6).toString('latin1')) || buf.slice(1, 4).toString() === 'PNG' || (buf[0] === 0xff && buf[1] === 0xd8), buf.slice(0, 6).toString('latin1'));
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
