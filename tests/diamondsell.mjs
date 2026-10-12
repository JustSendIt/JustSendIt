/* 💎 Diamond Hands: a SALE resets the streak, a TRANSFER never does (owner's rule, 2026-10-12: "only sells from that
   wallet or from the wallet that they transferred the token to counts as a sell").
   The real code is lifted out of server.js as it is — the streak rules (dhStreakNext, holdDaysOf), the ledger's eye on
   the members' wallets (dhLedgerHook and the follow helpers) and the receipt check (dhResolveRun with receiptLegs +
   tradeLegs) — and run on hand-built Transfer logs and receipts in an in-memory database. No server, no chain. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { SERVER_JS, ROOT } from './_paths.mjs';

const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const grab = (re, name) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + name + ' in server.js'); return m[0]; };

const DAY = 864e5;
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const Z = '0x' + '0'.repeat(40), DEAD = '0x000000000000000000000000000000000000dead';
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', GWC = '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22';
const POOL = { SEND: '0xf30bb531d0255969be155533abac34b22bd63414', GWC: '0x22df73eef683a93680dff3b51fdf3ee91e7352d9' };
const a = (c) => '0x' + c.repeat(40);
const W = a('1'), W2 = a('9'), X = a('2'), Y = a('5'), ROUTER = a('3'), SAFE = a('4'), OTHER = a('6'), POOL2 = a('7'), Q = a('8'), U = a('c'), V = a('a');
const R1 = '0x' + '1'.repeat(39) + '2', R2 = '0x' + '1'.repeat(39) + '3', VAULT = '0x' + '1'.repeat(39) + '4', FEE = '0x' + '1'.repeat(39) + '5', X4 = '0x' + '1'.repeat(39) + '6', SAFE2 = '0x' + '1'.repeat(39) + '7';

try {
  /* ═══ 1. the streak rules (dhStreakNext) ═══ */
  const streakSrc = grab(/function dhStreakNext\(prev, cur, sales, t\) \{[\s\S]*?\n\}\n/, 'dhStreakNext');
  const daysSrc = grab(/function holdDaysOf\(h\) [^\n]+\n/, 'holdDaysOf') + grab(/function gwcDaysOf\(h\) [^\n]+\n/, 'gwcDaysOf');
  const T0 = 1_800_000_000_000; let NOW = T0;
  const S = new Function('now', streakSrc + daysSrc + '\nreturn { dhStreakNext, holdDaysOf, gwcDaysOf };')(() => NOW);
  const F = 100;   // the floor, in dollars
  const row = (n, c) => ({ streak_start: n.streakStart, base_bp: n.baseBp, paused_at: n.pausedAt, paused_ms: n.pausedMs, gwc_streak_start: n.gwcStreak, gwc_base_bp: n.gwcBase, gwc_paused_at: n.gwcPausedAt, gwc_paused_ms: n.gwcPausedMs,
    send_ref: n.sendRef, gwc_ref: n.gwcRef, send_away: n.sendAway, gwc_away: n.gwcAway, send_tok: c.sendTok, gwc_tok: c.gwcTok, send_qual: c.sendQual, gwc_qual: c.gwcQual });
  // a read: tokens held and today's prices → qualifying bp, verdicts (as refreshHolder computes them)
  const read = (sendTok, gwcTok, sendPx, gwcPx, prevQual) => {
    const q = (tok, px, before) => px == null ? (before == null ? null : before) : (tok * px >= F ? 1 : 0);
    const sendQual = q(sendTok, sendPx, prevQual && prevQual.s), gwcQual = q(gwcTok, gwcPx, prevQual && prevQual.g);
    return { scoreBp: (sendQual === 1 ? sendTok : 0) + (gwcQual === 1 ? gwcTok : 0), qGwcBp: gwcQual === 1 ? gwcTok : 0, sendTok, gwcTok, sendQual, gwcQual, sendPx, gwcPx, floorUsd: F };
  };
  let c = read(1000, 500, 0.101, 0.5), st = S.dhStreakNext(null, c, [], T0), prev = row(st, c);
  check('a streak starts when the linked wallets first hold $100 of a coin', st.streakStart === T0 && st.gwcStreak === T0);
  // the review's case: $101 of $SEND, a 1.5% transfer tips it under $100 — a transfer, so it pauses (the old 2% tolerance ended it)
  c = read(985, 0, 0.101, 0.5); st = S.dhStreakNext(prev, c, [], T0 + 10 * DAY);
  check('a small transfer that tips a coin under the floor PAUSES the streak (no 2% slack decides it any more)', st.streakStart === T0 && st.pausedAt === T0 + 10 * DAY && !st.resets.length, JSON.stringify(st));
  check('  ...the $GWC that moved out pauses the $GWC streak too', st.gwcStreak === T0 && st.gwcPausedAt === T0 + 10 * DAY);
  NOW = T0 + 50 * DAY;
  let h = { ...row(st, c), last_check: NOW };
  check('  ...the days stop at the pause (10, not 50)', Math.floor(S.holdDaysOf(h)) === 10 && Math.floor(S.gwcDaysOf(h)) === 10, S.holdDaysOf(h));
  prev = row(st, c);
  c = read(1000, 500, 0.101, 0.5); st = S.dhStreakNext(prev, c, [], NOW);
  NOW = T0 + 60 * DAY; h = { ...row(st, c), last_check: NOW };
  check('back over the floor: it resumes where it left off, the 40 paused days never count (60 − 40 = 20)', st.streakStart === T0 && !st.pausedAt && st.pausedMs === 40 * DAY && Math.floor(S.holdDaysOf(h)) === 20, S.holdDaysOf(h));
  // the price, not a move
  prev = row(st, c);
  c = read(1000, 500, 0.09, 0.15); st = S.dhStreakNext(prev, c, [], NOW);
  check('under the floor because the PRICE fell (the same coins are worth less): the streak ends, as it always has', st.streakStart === null && st.gwcStreak === null);
  // a read with no price decides nothing and does not move the reference
  c = read(1000, 500, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  c = read(200, 500, null, 0.5, { s: 1, g: 1 }); st = S.dhStreakNext(prev, c, [], T0 + DAY);
  check('a read with no $SEND price keeps the verdict and leaves the reference where the last priced read put it', st.streakStart === T0 && !st.pausedAt && st.sendRef === 1000, st.sendRef);
  prev = row(st, c);
  c = read(200, 0, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + 2 * DAY);
  check('  ...so when the price comes back, coins that left during the blind read still read as a move: paused, not ended (the review\'s case B)', st.streakStart === T0 && st.pausedAt === T0 + 2 * DAY, JSON.stringify(st));
  // sales
  c = read(1000, 500, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  st = S.dhStreakNext(prev, c, [{ token: 'SEND', sale_at: T0 + 5 * DAY }], T0 + 6 * DAY);
  check('a $SEND SALE restarts the combined streak at the sale and leaves the $GWC-only streak alone', st.streakStart === T0 + 5 * DAY && st.gwcStreak === T0 && st.resets.length === 1 && st.resets[0].clock === 'all');
  prev = row(st, c);
  st = S.dhStreakNext(prev, c, [{ token: 'GWC', sale_at: T0 + 5.5 * DAY }], T0 + 6 * DAY);
  check('  ...a $GWC sale restarts both clocks', st.streakStart === T0 + 5.5 * DAY && st.gwcStreak === T0 + 5.5 * DAY && st.resets.length === 2);
  prev = row(st, c);
  st = S.dhStreakNext(prev, c, [{ token: 'SEND', sale_at: T0 }], T0 + 6 * DAY);
  check('  ...a sale from before the streak began changes nothing', st.streakStart === T0 + 5.5 * DAY && !st.resets.length);
  st = S.dhStreakNext(prev, read(0, 0, 0.2, 0.5), [{ token: 'GWC', sale_at: T0 + 6 * DAY - 1 }], T0 + 6 * DAY);
  check('  ...and a sale that left nothing that qualifies ends the streak (no pause)', st.streakStart === null && st.gwcStreak === null && st.pausedAt === null);
  c = read(1000, 0, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  st = S.dhStreakNext(prev, read(0, 0, 0.2, 0.5), [], T0 + DAY); prev = row(st, read(0, 0, 0.2, 0.5));
  st = S.dhStreakNext(prev, read(0, 0, 0.2, 0.5), [{ token: 'SEND', sale_at: T0 + 2 * DAY }], T0 + 3 * DAY);
  check('a sale from where the coins went, while paused, ends the paused streak', st.streakStart === null && st.resets.length === 1);
  check('  ...and that coin is no longer "away" (it was sold)', st.sendAway === 0);
  // every coin moved out during a read with no price: nothing is decided until a price says what they were worth
  c = read(1000, 0, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  c = read(0, 0, null, 0.5, { s: 1, g: 0 }); st = S.dhStreakNext(prev, c, [], T0 + DAY);
  check('all the coins moving out during a read with no price neither ends nor pauses the streak (the review\'s case B)', st.streakStart === T0 && !st.pausedAt && st.sendRef === 1000, JSON.stringify(st));
  prev = row(st, c); c = read(0, 0, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + 2 * DAY);
  check('  ...the next priced read finds they were worth $200: a move, so it pauses', st.streakStart === T0 && st.pausedAt === T0 + 2 * DAY && st.sendAway === 1, JSON.stringify(st));
  // the combined clock: $SEND moved away earlier, later $GWC's price falls under the floor
  c = read(1000, 500, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  c = read(0, 500, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + DAY); prev = row(st, c);
  check('$SEND moved out while $GWC still qualifies: the combined streak runs on, $SEND is marked away at its count', st.streakStart === T0 && !st.pausedAt && st.sendAway === 1 && st.sendRef === 1000, JSON.stringify(st));
  c = read(0, 500, 0.2, 0.1); st = S.dhStreakNext(prev, c, [], T0 + 2 * DAY); prev = row(st, c);
  check('  ...then $GWC\'s price falls under the floor: the combined streak PAUSES (the $SEND that moved is still worth $200), the $GWC streak ends', st.streakStart === T0 && st.pausedAt === T0 + 2 * DAY && st.gwcStreak === null, JSON.stringify(st));
  c = read(0, 500, 0.05, 0.1); st = S.dhStreakNext(prev, c, [], T0 + 3 * DAY);
  check('  ...and if $SEND\'s price falls so the coins that moved would be worth $50, the paused streak ends — as it would have, held', st.streakStart === null, JSON.stringify(st));
  c = read(1000, 0, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + 3 * DAY);
  check('  ...while the coins coming back resumes it, no longer away', st.streakStart === T0 && !st.pausedAt && st.sendAway === 0 && st.pausedMs === DAY, JSON.stringify(st));

  /* ═══ 2. the ledger's eye (dhLedgerHook) and the receipt check (dhResolveRun) ═══ */
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE identities (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, identifier TEXT, identifier_enc TEXT)");
  db.exec("CREATE TABLE holder_index (token_addr TEXT PRIMARY KEY, last_block INTEGER)");
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_follow \([\s\S]*?\n\);/, 'dh_follow table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_moves \([\s\S]*?\n\);/, 'dh_moves table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  const enc = (s) => s == null ? null : 'E:' + s, dec = (s) => s && String(s).startsWith('E:') ? String(s).slice(2) : null, bidx = (s) => 'I:' + s;
  const link = (uid, w) => db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc) VALUES (?, 'wallet', ?, ?)").run(uid, bidx(w), enc(w));
  link(1, W); link(1, W2); link(2, OTHER);
  const helpers = ['dhInfo', 'dhFollowGet', 'dhFollowPut', 'dhFollowDrop', 'dhFollowUse', 'dhFollowAdd', 'dhLetGo'].map((n) => n === 'dhInfo' || n === 'dhFollowDrop'
    ? grab(new RegExp('const ' + n + ' = [^\\n]+'), n) : grab(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n'), n)).join('\n');
  const hookSrc = grab(/function dhLedgerHook\(tok, logs, only\) \{[\s\S]*?\n\}\n/, 'dhLedgerHook');
  const resolveSrc = grab(/async function dhResolveRun\(\) \{[\s\S]*?\n\}\n/, 'dhResolveRun') + grab(/const dhPassedOn = [^\n]+/, 'dhPassedOn') + '\n'
    + grab(/async function dhIsPoolish\(x\) \{[\s\S]*?\n\}\n/, 'dhIsPoolish') + grab(/async function dhCatchUp\([^)]*\) \{[\s\S]*?\n\}\n/, 'dhCatchUp');
  const legsSrc = grab(/function receiptLegs\(rc\) \{[\s\S]*?\n\}\n/, 'receiptLegs') + grab(/const sentBy = \(e, w\) => [^\n]+/, 'sentBy') + '\n' + grab(/function tradeLegs\(entry, w, a\) \{[\s\S]*?\n\}\n/, 'tradeLegs');
  const receipts = new Map(); let nodeDown = false, logReads = 0;
  const CODE = new Set([SAFE, SAFE2, Q, ROUTER, POOL2, VAULT, R1.replace(/2$/, '0')]), VAULTS = new Set([VAULT]);
  // a stand-in for the node: code, token0()/asset() (a vault answers, everything else reverts), and Transfer logs from the receipts
  const rpc = async (method, params) => {
    if (nodeDown) throw new Error('node down');
    if (method === 'eth_getCode') return CODE.has(params[0]) ? '0x6080' : '0x';
    if (method === 'eth_call') { if (VAULTS.has(params[0].to) && params[0].data === '0x38d52e0f') return '0x' + '0'.repeat(24) + SEND.slice(2); throw new Error('execution reverted'); }
    if (method === 'eth_getLogs') {
      logReads++;
      const q = params[0], lo = parseInt(q.fromBlock, 16), hi = parseInt(q.toBlock, 16), from = new Set(q.topics[1]);
      return [...receipts.values()].flatMap((r) => r.logs).filter((l) => l.address === q.address && from.has(l.topics[1]) && parseInt(l.blockNumber, 16) >= lo && parseInt(l.blockNumber, 16) <= hi);
    }
    throw new Error('unexpected ' + method);
  };
  const ctx = vm.createContext({ BigInt, Math, Map, Set, Infinity, JSON, String, Number, parseInt, Error, Object, console: { warn() {}, log() {} },
    db, bidx, encField: enc, decField: dec, now: () => NOW,
    TOK: { SEND, GWC }, OG_PAIR: POOL, ZERO_ADDR: Z, DEAD_ADDR: DEAD, WETH_ADDR: WETH, USDG_ADDR: USDG, TRANSFER_TOPIC: TOPIC, ENTRY_POINTS: new Set(), USEROP_TOPIC: '0x0',
    DH_COINS: { [SEND]: 'SEND', [GWC]: 'GWC' }, DH_FOLLOW_MAX: 5, DH_GIVE_UP_MS: 7 * DAY,
    chainBlockTime: async (b) => b * 1000, chainTransient: (e) => /node down/.test(e.message) || !!e.transient,
    rpc, rpcRetry: (fn) => fn(), addrHasCode: async (x) => (await rpc('eth_getCode', [x])) !== '0x',
  });
  vm.runInContext(legsSrc + '\n' + helpers + '\n' + hookSrc + '\n' + resolveSrc + `
    async function dhTxEntry(h) {
      if (NODE.down) throw new Error('node down');
      const rc = RECEIPTS.get(h); if (!rc) throw new Error('the receipt is not available yet');
      const raw = rc.logs.map((l) => [l.address, '0x' + l.topics[1].slice(-40), '0x' + l.topics[2].slice(-40), BigInt(l.data)]);
      return { entry: receiptLegs(rc), raw };
    }
    this.dhLedgerHook = dhLedgerHook; this.dhResolveRun = dhResolveRun; this.dhFollowAdd = dhFollowAdd;`, Object.assign(ctx, { RECEIPTS: receipts, NODE: { get down() { return nodeDown; } } }));
  const pad = (x) => '0x' + '0'.repeat(24) + x.slice(2);
  const hex = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  let blk = 1000, li = 0;
  const tlog = (token, f, t, v, tx, block) => ({ address: token, topics: [TOPIC, pad(f), pad(t)], data: hex(v), transactionHash: tx, blockNumber: '0x' + block.toString(16), logIndex: '0x' + (li++).toString(16) });
  const send = (from, legs) => { const tx = '0x' + (++blk).toString(16).padStart(64, '0'); const logs = legs.map(([tok, f, t, v]) => tlog(tok, f, t, v, tx, blk)); receipts.set(tx, { from, logs }); return logs; };
  // the ledger reads a batch: the hook sees it, and the ledger's height moves to its last block
  const ledger = (coinAddr, logs) => { ctx.dhLedgerHook(coinAddr, logs.filter((l) => l.address === coinAddr)); db.prepare('INSERT INTO holder_index (token_addr, last_block) VALUES (?, ?) ON CONFLICT(token_addr) DO UPDATE SET last_block = MAX(last_block, excluded.last_block)').run(coinAddr, blk); };
  const moves = () => db.prepare('SELECT id, user_id, token, src, quick, status, sale_at FROM dh_moves ORDER BY id').all();
  const follow = (uid, w, coin = 'SEND') => { const r = db.prepare('SELECT info_enc, state, via FROM dh_follow WHERE user_id = ? AND token = ? AND addr_idx = ?').get(uid, coin, bidx(w)); if (!r) return null; const x = JSON.parse(dec(r.info_enc)); return { ...x, state: r.state, via: r.via }; };
  const last = () => moves().at(-1);
  const fee = (f, v) => [SEND, f, SEND, Math.floor(v / 100)];   // $SEND's 1% on every transfer, to the token contract

  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 500], [WETH, POOL.SEND, W, 9]]));
  await ctx.dhResolveRun();
  check('a sale straight into the pool from a linked wallet is a SALE', last().status === 'sale' && last().quick === 'pool' && last().src === 'linked' && last().sale_at === blk * 1000, JSON.stringify(last()));
  ledger(SEND, send(W, [[SEND, W, ROUTER, 400], [SEND, ROUTER, POOL.SEND, 400], [WETH, POOL.SEND, ROUTER, 8], [WETH, ROUTER, W, 8]]));
  await ctx.dhResolveRun();
  check('a sale through a router is a SALE, and the router is not followed', last().status === 'sale' && last().quick === 'routed' && !follow(1, ROUTER), JSON.stringify(last()));
  // the review's critical case: a sale into a pool the ledger does not know (quick 'transfer') must not jam the queue
  ledger(SEND, send(W, [[SEND, W, POOL2, 300], [USDG, POOL2, W, 7]]));
  for (let i = 0; i < 70; i++) ledger(SEND, send(POOL2, [[SEND, POOL2, a(String((i % 6) + 1).replace('1', 'd')), 1]]));   // the unknown pool keeps paying out to buyers in the same batch
  await ctx.dhResolveRun(); await ctx.dhResolveRun();
  const pend = moves().filter((m) => m.status === 'pending').length;
  check('a sale into a pool the ledger does not know is a SALE, the pool is let go, and nothing is left waiting behind it (no stuck queue)', moves().some((m) => m.status === 'sale' && m.quick === 'transfer') && !follow(1, POOL2) && pend === 0, 'pending ' + pend);
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 300], [WETH, W, POOL.SEND, 6], [POOL.SEND, Z, W, 50]]));
  await ctx.dhResolveRun();
  check('adding liquidity (coins into the pool, nothing paid out) is NOT a sale', last().status === 'ignored' && last().quick === 'pool', JSON.stringify(last()));
  // a plain transfer with $SEND's fee
  ledger(SEND, send(W, [[SEND, W, X, 990], fee(W, 1000)]));
  check('a transfer to another wallet starts following it at once, for what it got', follow(1, X) && follow(1, X).state === 0 && follow(1, X).budget === '990' && follow(1, X).since === blk);
  await ctx.dhResolveRun();
  check('  ...it is a TRANSFER, not a sale, and the wallet stays followed', last().status === 'transfer' && follow(1, X).state === 1, JSON.stringify(last()));
  ledger(SEND, send(W, [[SEND, W, Y, 200], fee(W, 200), [SEND, SEND, POOL.SEND, 40], [WETH, POOL.SEND, SEND, 1]]));
  await ctx.dhResolveRun();
  check('  ...a transfer during which the token swaps its own collected fee is still a transfer', last().status === 'transfer');
  const n0 = moves().length;
  ledger(SEND, send(W, [[SEND, W, W2, 100], fee(W, 100)]));
  check('moving coins between the member\'s own linked wallets is not a move at all', moves().length === n0);
  ledger(SEND, send(X, [[SEND, X, POOL.SEND, 594], fee(X, 600), [WETH, POOL.SEND, X, 11]]));
  await ctx.dhResolveRun();
  check('a sale by the wallet they sent the coins to IS a sale for the member', last().status === 'sale' && last().src === 'followed' && last().user_id === 1, JSON.stringify(last()));
  check('  ...and it uses up what the wallet got from them, fee included (990 − 594 − 6 = 390 left)', follow(1, X).budget === '390', follow(1, X).budget);
  ledger(SEND, send(X, [[SEND, X, OTHER, 100], fee(X, 100)]));
  await ctx.dhResolveRun();
  check('  ...its onward transfer is neither a sale nor a new follow (one hop, as the rule says)', last().status === 'ignored' && !follow(1, OTHER), JSON.stringify(last()));
  ledger(SEND, send(X, [[SEND, X, W, 287], fee(X, 290)]));
  check('  ...and when it has given back what it got (after $SEND\'s fee), it is let go', !follow(1, X), JSON.stringify(follow(1, X)));
  // a wallet that is a contract (a Safe): followed like any wallet; a router: not
  ledger(SEND, send(W, [[SEND, W, SAFE, 250]]));
  await ctx.dhResolveRun();
  check('coins sent to a smart-contract wallet (it did nothing else in that transaction) are followed', follow(1, SAFE) && follow(1, SAFE).state === 1);
  ledger(SEND, send(OTHER, [[SEND, SAFE, POOL.SEND, 250], [WETH, POOL.SEND, SAFE, 5]]));   // an owner of the Safe sends its sale
  await ctx.dhResolveRun();
  check('  ...and its sale counts, though its owner (not the Safe) sent the transaction', last().status === 'sale' && last().src === 'followed');
  ledger(SEND, send(W, [[SEND, W, Q, 50], [SEND, Q, U, 50]]));
  await ctx.dhResolveRun();
  check('a contract that passes the coins straight on to a wallet (a batch send) is let go, and that wallet is followed instead (the review\'s case E)', !follow(1, Q) && last().status === 'ignored' && follow(1, U) && follow(1, U).state === 1 && follow(1, U).budget === '50', JSON.stringify(follow(1, U)));
  // a batch send whose recipient sells before the receipt is even read: the sale is found by reading back what it did since
  const bsend = send(W, [[SEND, W, R1.replace(/2$/, '0'), 300], [SEND, R1.replace(/2$/, '0'), R1, 200], [SEND, R1.replace(/2$/, '0'), R2, 100]]);
  const bblk = blk;
  ledger(SEND, bsend);
  ledger(SEND, send(R1, [[SEND, R1, POOL.SEND, 150], [WETH, POOL.SEND, R1, 3]]));   // the ledger passes R1's sale while R1 is not followed yet
  check('  (until the receipt is read, nobody but the batch sender is followed, so R1\'s sale was not noted by the ledger)', !follow(1, R1) && !moves().some((m) => m.status === 'pending' && m.src === 'followed' && m.quick === 'pool'));
  const lr0 = logReads;
  await ctx.dhResolveRun();
  check('  ...the receipt shows a batch send: both recipients are followed from its block, and their Transfers since are read back (one read)', follow(1, R1) && follow(1, R1).state === 1 && follow(1, R1).since === bblk && follow(1, R2) && follow(1, R2).budget === '100' && logReads === lr0 + 1, logReads - lr0);
  check('  ...R1\'s sale is now noted', moves().some((m) => m.status === 'pending' && m.src === 'followed' && m.quick === 'pool'), JSON.stringify(moves().slice(-2)));
  await ctx.dhResolveRun();
  check('  ...and the next round settles it as the member\'s SALE, and what it sold comes off what R1 got (200 − 150)', last().status === 'sale' && last().src === 'followed' && last().user_id === 1 && follow(1, R1).budget === '50', JSON.stringify(last()) + JSON.stringify(follow(1, R1)));
  // a contract that took the coins and is a vault or a pool (a deposit, single-sided liquidity): not followed
  ledger(SEND, send(W, [[SEND, W, VAULT, 80]]));
  await ctx.dhResolveRun();
  check('coins deposited into a vault (it answers asset()) are not followed — strangers withdrawing are not the member selling (the review\'s case D)', !follow(1, VAULT) && last().status === 'ignored', JSON.stringify(last()));
  // a sale that also pays a trading app's fee in the coin: the fee collector is not followed
  ledger(SEND, send(W, [[SEND, W, FEE, 5], [SEND, W, POOL.SEND, 495], [WETH, POOL.SEND, W, 9]]));
  await ctx.dhResolveRun();
  check('a sale that also pays a trading app\'s fee in the coin is a SALE, and the fee collector is not followed (it sells all day — not the member\'s sales)', last().status === 'sale' && !follow(1, FEE));
  // a little WETH sent to a wallet alongside the coins does not make it a router
  ledger(SEND, send(W, [[SEND, W, X4, 100], [WETH, OTHER, X4, 1]]));
  await ctx.dhResolveRun();
  check('a wallet that also received a little WETH in that transaction is still a wallet: followed (the review\'s case H)', follow(1, X4) && follow(1, X4).state === 1 && last().status === 'transfer', JSON.stringify(last()));
  // more coins to a wallet already followed, which sells in that same transaction: that sale is not skipped
  ledger(SEND, send(W, [[SEND, W, SAFE2, 400]]));
  await ctx.dhResolveRun();
  ledger(SEND, send(W, [[SEND, W, SAFE2, 10], [SEND, SAFE2, POOL.SEND, 300], [WETH, POOL.SEND, SAFE2, 6]]));
  await ctx.dhResolveRun(); await ctx.dhResolveRun();
  check('more coins sent to a wallet already followed, which sells in that same transaction: its sale counts (the review\'s case G)', moves().some((m) => m.status === 'sale' && m.src === 'followed' && m.quick === 'pool' && m.id > 0) && follow(1, SAFE2) && follow(1, SAFE2).state === 1, JSON.stringify(moves().slice(-2)));
  // since: a followed wallet's sales count only from the block it got the coins
  ctx.dhFollowAdd(1, 'SEND', bidx(V), V, blk + 5, 1000n, 'transfer');
  db.prepare("UPDATE dh_follow SET state = 1 WHERE addr_idx = ?").run(bidx(V));
  const nU = moves().length;
  ledger(SEND, send(V, [[SEND, V, POOL.SEND, 10], [WETH, POOL.SEND, V, 1]]));
  check('a followed wallet\'s sale from BEFORE it got the coins is not noted', moves().length === nU);
  blk += 10;
  ledger(SEND, send(V, [[SEND, V, POOL.SEND, 10], [WETH, POOL.SEND, V, 1]]));
  check('  ...and one from after is', moves().length === nU + 1);
  // another member, another coin
  ledger(SEND, send(OTHER, [[SEND, OTHER, POOL.SEND, 70], [WETH, POOL.SEND, OTHER, 2]]));
  await ctx.dhResolveRun();
  check('a sale by another member\'s wallet is that member\'s sale only', last().user_id === 2 && last().status === 'sale');
  const gn = moves().length;
  ledger(GWC, send(SAFE, [[GWC, SAFE, POOL.GWC, 5], [WETH, POOL.GWC, SAFE, 1]]));
  check('following is per coin: a wallet sent $SEND is not watched for $GWC', moves().length === gn);
  // dust cannot fill the slots: past the cap (5 here) the smallest is let go for a real one
  for (let i = 0; i < 6; i++) ledger(SEND, send(W, [[SEND, W, a('e').slice(0, 41) + String(i), 1]]));
  ledger(SEND, send(W, [[SEND, W, a('f'), 5000]]));
  check('followed wallets have a cap, and dust sends cannot fill it: the smallest is let go for a real one', !!follow(1, a('f')) && db.prepare("SELECT COUNT(*) n FROM dh_follow WHERE user_id = 1 AND token = 'SEND'").get().n <= 5);
  await ctx.dhResolveRun();
  // a wallet the member unlinked is still theirs: followed for good, and its own transfers are followed on
  db.prepare("DELETE FROM identities WHERE identifier = ?").run(bidx(W2));
  ctx.dhFollowAdd(1, 'SEND', bidx(W2), W2, blk + 1, 777n, 'unlink');
  ledger(SEND, send(W2, [[SEND, W2, a('b'), 700]]));
  await ctx.dhResolveRun();
  check('a wallet they unlinked is still theirs: its transfer is followed on like a linked wallet\'s', last().src === 'linked' && last().status === 'transfer' && follow(1, a('b')) && follow(1, a('b')).state === 1, JSON.stringify(last()));
  // the node down: nothing settled, nothing charged
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 1], [WETH, POOL.SEND, W, 1]]));
  nodeDown = true; await ctx.dhResolveRun(); nodeDown = false;
  const nd = db.prepare('SELECT status, tries FROM dh_moves ORDER BY id DESC LIMIT 1').get();
  check('the node refusing settles nothing and charges nothing (the move waits, its tries untouched)', nd.status === 'pending' && nd.tries === 0, JSON.stringify(nd));
  await ctx.dhResolveRun();
  check('  ...and the next round settles it', last().status === 'sale');
  // a receipt that is not there: tried again with a pause, never taken for a sale
  ledger(SEND, (() => { const logs = send(W, [[SEND, W, POOL.SEND, 1], [WETH, POOL.SEND, W, 1]]); receipts.delete(logs[0].transactionHash); return logs; })());
  await ctx.dhResolveRun();
  const nr = db.prepare('SELECT status, tries, next_try_at FROM dh_moves ORDER BY id DESC LIMIT 1').get();
  check('a receipt that cannot be found is tried again later — never taken for a sale', nr.status === 'pending' && nr.tries === 1 && nr.next_try_at > NOW, JSON.stringify(nr));
  // privacy: no plaintext block, position or amount
  const cols = db.prepare('PRAGMA table_info(dh_moves)').all().map((r) => r.name).concat(db.prepare('PRAGMA table_info(dh_follow)').all().map((r) => r.name));
  check('the moves and follows keep no block, position or amount in the clear (they would name the transfer)', !cols.some((n) => /^(block|log_index|amount|budget|since_block)$/.test(n)));

  /* ═══ 3. wiring ═══ */
  check('the hook runs inside the ledger under a savepoint, for $SEND and $GWC only, once that ledger is built', /if \(watch\) \{ db\.exec\('SAVEPOINT dh_hook'\); try \{ dhLedgerHook\(tok, logs\);/.test(SRC) && /const watch = !!\(row && row\.status === 'ok' && row\.last_block\);/.test(SRC) && /ledgerApply\(tok, out, to, firstBlock, watch\)/.test(SRC) && /const coin = DH_COINS\[tok\]; if \(!coin\) return;/.test(SRC));
  check('refreshHolder reads the row again and decides inside one transaction (two reads at once cannot undo a reset)', /const latest = db\.prepare\('SELECT \* FROM holder_state WHERE user_id = \?'\)\.get\(userId\);\n\s+const sales = /.test(SRC) && /nx = dhStreakNext\(latest, /.test(SRC));
  check('  ...and tells the member which coin and when, in words that say moving coins never resets it', /reset your Diamond Hands streak to zero/.test(SRC) && /Moving coins never does/.test(SRC));
  check('unlinking (even the last wallet) and disconnecting pause the streak and follow the wallets — they never wipe it', /dhFollowLeaving\(me\.id, addr\);/.test(SRC) && /for \(const w of wallets\) dhFollowLeaving\(me\.id, w\);/.test(SRC) && (SRC.match(/dhPauseHolder\(me\.id\);/g) || []).length === 2 && !/DELETE FROM holder_state WHERE user_id = \?'\)\.run\(me\.id\)/.test(SRC));
  check('with no wallet left, the streak pauses with the coins marked away, and a sale from a followed wallet still ends it then', /send_away = CASE WHEN send_qual = 1 OR send_away = 1 THEN 1 ELSE 0 END/.test(SRC) && /const nx0 = dhStreakNext\(latest, \{ scoreBp: 0,/.test(SRC) && /if \(nx0\.resets\.length\) dhResetNotice\(userId, nx0\.resets\);/.test(SRC));
  check('a newly confirmed sale is read again at once whoever started the resolver (refreshHolder or the timer), without starting it again', /dhResolving\.then\(\(uids\) => setImmediate\(async \(\) => \{ for \(const u of uids \|\| \[\]\) \{ try \{ await refreshHolder\(u, \{ skipResolve: true \}\);/.test(SRC) && /if \(!opts\.skipResolve\) await Promise\.race\(\[dhResolve\(\)/.test(SRC));
  check('a paused streak keeps its public Diamond badge', /if \(!h \|\| !h\.streak_start \|\| \(h\.score_bp <= 0 && !h\.paused_at\)\) return null;/.test(SRC));
  check('deleting an account deletes its follows and moves', /'holder_state', 'dh_follow', 'dh_moves',/.test(SRC));
  check('the dashboard says when a streak is paused', /streakPaused: !!h\.paused_at/.test(SRC) && /h\.streakPaused/.test(readFileSync(path.join(ROOT, 'public', 'gamify.js'), 'utf8')));
  const KEYS = readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8');
  check('the followed wallets and moves are encrypted + indexed like every wallet link, and key rotation carries them', ['dh_follow\', \'addr_enc', 'dh_follow\', \'info_enc', 'dh_moves\', \'info_enc', 'dh_moves\', \'tx_enc'].every((x) => KEYS.includes(x)) && /\{ t: 'dh_moves', c: 'move_idx' \}/.test(KEYS) && /\{ t: 'dh_follow', c: 'addr_idx' \}/.test(KEYS));
  const ABOUT = readFileSync(path.join(ROOT, 'public', 'about.html'), 'utf8'), WP = readFileSync(path.join(ROOT, 'public', 'whitepaper.html'), 'utf8'), README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  check('the About page, White Paper and README state the rule (a transfer is not a sale) and no longer the 2% one', /Moving coins to another wallet is not a sale/.test(ABOUT) && !/2% below/.test(ABOUT) && /Moving coins between wallets is not a sale/.test(WP) && /A transfer is not a sale/.test(README) && !/dropping more than 2% below that peak/.test(README));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
