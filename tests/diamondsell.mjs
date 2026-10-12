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
const FWD2 = '0x' + '2'.repeat(39) + '1', FWD3 = '0x' + '2'.repeat(39) + '3', R3 = '0x' + '2'.repeat(39) + '4', U3 = '0x' + '2'.repeat(39) + '5', FWD4 = '0x' + '2'.repeat(39) + '6', U4 = '0x' + '2'.repeat(39) + '7';
const FWD5 = '0x' + '2'.repeat(39) + '8', R5 = '0x' + '2'.repeat(39) + '9', FRIEND = '0x' + '3'.repeat(39) + '1', FLAKY = '0x' + '3'.repeat(39) + '2';
const R1 = '0x' + '1'.repeat(39) + '2', R2 = '0x' + '1'.repeat(39) + '3', VAULT = '0x' + '1'.repeat(39) + '4', FEE = '0x' + '1'.repeat(39) + '5', X4 = '0x' + '1'.repeat(39) + '6', SAFE2 = '0x' + '1'.repeat(39) + '7';

try {
  /* ═══ 1. the streak rules (dhStreakNext) ═══ */
  const streakSrc = grab(/function dhStreakNext\(prev, cur, sales, t\) \{[\s\S]*?\n\}\n/, 'dhStreakNext');
  const daysSrc = grab(/function holdDaysOf\(h\) [^\n]+\n/, 'holdDaysOf') + grab(/function gwcDaysOf\(h\) [^\n]+\n/, 'gwcDaysOf');
  const T0 = 1_800_000_000_000; let NOW = T0;
  const S = new Function('now', streakSrc + daysSrc + '\nreturn { dhStreakNext, holdDaysOf, gwcDaysOf };')(() => NOW);
  const F = 100;   // the floor, in dollars
  // the row refreshHolder writes after a read
  const row = (n, c) => ({ streak_start: n.streakStart, base_bp: n.baseBp, paused_at: n.pausedAt, paused_ms: n.pausedMs, gwc_streak_start: n.gwcStreak, gwc_base_bp: n.gwcBase, gwc_paused_at: n.gwcPausedAt, gwc_paused_ms: n.gwcPausedMs,
    send_tok: c.sendTok, gwc_tok: c.gwcTok, send_qual: c.sendQual, gwc_qual: c.gwcQual });
  // a read as refreshHolder makes it: tokens held and today's prices (null: unreadable — the last verdict stands) → the qualifying basis points
  const read = (sendTok, gwcTok, sendPx, gwcPx, prevQual, o = {}) => {
    const q = (tok, px, before) => px == null ? (before == null ? null : before) : (tok * px >= F ? 1 : 0);
    const sendQual = q(sendTok, sendPx, prevQual && prevQual.s), gwcQual = q(gwcTok, gwcPx, prevQual && prevQual.g);
    const sendBp = o.sendBp != null ? o.sendBp : sendTok, gwcBp = o.gwcBp != null ? o.gwcBp : gwcTok;
    return { scoreBp: (sendQual === 1 ? sendBp : 0) + (gwcQual === 1 ? gwcBp : 0), qGwcBp: gwcQual === 1 ? gwcBp : 0, sendTok, gwcTok, sendQual, gwcQual };
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
  // the price: not a sale either (owner's rule — only a sale resets)
  prev = row(st, c);
  c = read(1000, 500, 0.09, 0.15); st = S.dhStreakNext(prev, c, [], NOW);
  check('under the floor because the PRICE fell: paused too — only a sale resets a streak', st.streakStart === T0 && st.pausedAt === NOW && st.gwcStreak === T0 && st.gwcPausedAt === NOW && !st.resets.length, JSON.stringify(st));
  prev = row(st, c);
  c = read(1000, 500, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], NOW + 5 * DAY);
  check('  ...and the price coming back resumes it, the 5 paused days not counted', st.streakStart === T0 && !st.pausedAt && st.pausedMs === 45 * DAY, JSON.stringify(st));
  // reads with no price, dust
  c = read(1000, 0, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  c = read(200, 0, null, 0.5, { s: 1, g: 0 }); st = S.dhStreakNext(prev, c, [], T0 + DAY);
  check('a read with no price keeps the last verdict: the streak runs on', st.streakStart === T0 && !st.pausedAt, JSON.stringify(st));
  c = read(4, 0, null, 0.5, { s: 1, g: 0 }, { sendBp: 0 }); st = S.dhStreakNext(row(st, c), c, [], T0 + 2 * DAY);
  check('  ...but dust adds nothing, price or not: paused (never ended)', st.streakStart === T0 && st.pausedAt === T0 + 2 * DAY, JSON.stringify(st));
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
  c = read(0, 0, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + DAY); prev = row(st, c);
  const pausedRow = prev;
  st = S.dhStreakNext(prev, read(0, 0, 0.2, 0.5), [{ token: 'SEND', sale_at: T0 + 2 * DAY }], T0 + 3 * DAY);
  check('a sale from where the coins went, while paused, resets the paused streak (to nothing, since nothing qualifies)', st.streakStart === null && st.resets.length === 1);
  st = S.dhStreakNext(pausedRow, read(0, 0, 0.2, 0.5), [{ token: 'SEND', sale_at: T0 - DAY }], T0 + 3 * DAY);
  check('  ...but a sale from before the streak began (settled late) leaves the paused streak alone', st.streakStart === T0 && st.pausedAt === T0 + DAY && !st.resets.length, JSON.stringify(st));
  // both clocks paused, then a $SEND sale: the combined clock is reset, the $GWC one stays paused (its coins were not sold)
  c = read(1000, 500, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  c = read(0, 0, 0.2, 0.5); st = S.dhStreakNext(prev, c, [], T0 + 60 * DAY); prev = row(st, c);
  st = S.dhStreakNext(prev, c, [{ token: 'SEND', sale_at: T0 + 61 * DAY }], T0 + 61 * DAY);
  check('both clocks paused, then a $SEND sale: the combined clock resets, the $GWC clock stays paused at its 60 days', st.streakStart === null && st.gwcStreak === T0 && st.gwcPausedAt === T0 + 60 * DAY, JSON.stringify(st));
  // no wallet linked: the zero read pauses; a sale from a followed wallet still resets
  c = read(1000, 0, 0.2, 0.5); st = S.dhStreakNext(null, c, [], T0); prev = row(st, c);
  st = S.dhStreakNext(prev, { scoreBp: 0, qGwcBp: 0 }, [], T0 + DAY);
  check('no wallet linked: paused, the days kept', st.streakStart === T0 && st.pausedAt === T0 + DAY, JSON.stringify(st));
  // a row from before this rule: under the floor it pauses like any other
  st = S.dhStreakNext({ streak_start: T0, base_bp: 1000, send_tok: 1000, send_qual: 1 }, read(0, 0, 0.2, 0.5), [], T0 + DAY);
  check('a streak from before this rule pauses under the floor like any other', st.streakStart === T0 && st.pausedAt === T0 + DAY);

  /* ═══ 2. the ledger's eye (dhLedgerHook) and the receipt check (dhResolveRun) ═══ */
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE identities (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, identifier TEXT, identifier_enc TEXT)");
  db.exec("CREATE TABLE holder_index (token_addr TEXT PRIMARY KEY, last_block INTEGER)");
  db.exec("CREATE TABLE holder_balances (token_addr TEXT, wallet TEXT, balance TEXT, positive INTEGER, PRIMARY KEY (token_addr, wallet))");
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_follow \([\s\S]*?\n\);/, 'dh_follow table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_moves \([\s\S]*?\n\);/, 'dh_moves table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  const enc = (s) => s == null ? null : 'E:' + s, dec = (s) => s && String(s).startsWith('E:') ? String(s).slice(2) : null, bidx = (s) => 'I:' + s;
  const link = (uid, w) => db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc) VALUES (?, 'wallet', ?, ?)").run(uid, bidx(w), enc(w));
  link(1, W); link(1, W2); link(2, OTHER);
  const helpers = ['dhInfo', 'dhFollowGet', 'dhFollowPut', 'dhFollowDrop', 'dhFollowUse', 'dhFollowAdd', 'dhLetGo'].map((n) => n === 'dhInfo' || n === 'dhFollowDrop'
    ? grab(new RegExp('const ' + n + ' = [^\\n]+'), n) : grab(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n'), n)).join('\n');
  const hookSrc = grab(/function dhLedgerHook\(tok, logs, only\) \{[\s\S]*?\n\}\n/, 'dhLedgerHook') + grab(/function ledgerBalances\(tok, wallets\) \{[\s\S]*?\n\}\n/, 'ledgerBalances')
;
  const resolveSrc = grab(/async function dhResolveRun\(\) \{[\s\S]*?\n\}\n/, 'dhResolveRun') + grab(/const dhPassedOn = [^\n]+/, 'dhPassedOn') + '\n'
    + grab(/const _poolishCache = [^\n]+\n/, '_poolishCache') + grab(/async function dhIsPoolish\(x\) \{[\s\S]*?\n\}\n/, 'dhIsPoolish') + grab(/async function dhIsPoolishRead\(x\) \{[\s\S]*?\n\}\n/, 'dhIsPoolishRead') + grab(/async function dhCatchUp\([^)]*\) \{[\s\S]*?\n\}\n/, 'dhCatchUp')
    + grab(/async function dhSaleTime\(m, info\) \{[\s\S]*?\n\}\n/, 'dhSaleTime') + grab(/async function dhForwarded\([^)]*\) \{[\s\S]*?\n\}\n/, 'dhForwarded');
  const legsSrc = grab(/function receiptLegs\(rc\) \{[\s\S]*?\n\}\n/, 'receiptLegs') + grab(/const sentBy = \(e, w\) => [^\n]+/, 'sentBy') + '\n' + grab(/function tradeLegs\(entry, w, a\) \{[\s\S]*?\n\}\n/, 'tradeLegs');
  const receipts = new Map(); let nodeDown = false, logReads = 0;
  const CODE = new Set([SAFE, SAFE2, Q, ROUTER, POOL2, VAULT, R1.replace(/2$/, '0'), FWD2, FWD3, R3, FWD4, FWD5, FLAKY]), VAULTS = new Set([VAULT]);
  const FAILTX = new Set(), BADBLOCK = new Set();
  // a stand-in for the node: code, token0()/asset() (a vault answers, everything else reverts), and Transfer logs from the receipts
  const rpc = async (method, params) => {
    if (nodeDown) throw new Error('node down');
    if (method === 'eth_getCode') return CODE.has(params[0]) ? '0x6080' : '0x';
    if (method === 'eth_call') { if (params[0].to === FLAKY) throw new Error('rpc budget spent — try again shortly'); if (VAULTS.has(params[0].to) && params[0].data === '0x38d52e0f') return '0x' + '0'.repeat(24) + SEND.slice(2); throw new Error('execution reverted'); }
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
    DH_COINS: { [SEND]: 'SEND', [GWC]: 'GWC' }, DH_FOLLOW_MAX: 200, DH_GIVE_UP_MS: 7 * DAY, DH_FWD_MAX: 50, pruneCache: (m, max) => { while (m.size > max) m.delete(m.keys().next().value); },
    chainBlockTime: async (b) => { if (BADBLOCK.has(b)) throw new Error('block time unreadable'); return b * 1000; }, chainTransient: (e) => /node down/.test(e.message) || !!e.transient,
    rpc, rpcRetry: (fn) => fn(), addrHasCode: async (x) => (await rpc('eth_getCode', [x])) !== '0x',
  });
  vm.runInContext(legsSrc + '\n' + helpers + '\n' + hookSrc + '\n' + resolveSrc + `
    async function dhTxEntry(h) {
      if (NODE.down || FAILTX.has(h)) throw new Error('node down');
      const rc = RECEIPTS.get(h); if (!rc) throw new Error('the receipt is not available yet');
      const raw = rc.logs.map((l) => [l.address, '0x' + l.topics[1].slice(-40), '0x' + l.topics[2].slice(-40), BigInt(l.data)]);
      return { entry: receiptLegs(rc), raw };
    }
    this.dhLedgerHook = dhLedgerHook; this.dhResolveRun = dhResolveRun; this.dhFollowAdd = dhFollowAdd; this.receiptLegs = receiptLegs; this.tradeLegs = tradeLegs;`, Object.assign(ctx, { FAILTX, RECEIPTS: receipts, NODE: { get down() { return nodeDown; } } }));
  const pad = (x) => '0x' + '0'.repeat(24) + x.slice(2);
  const hex = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  let blk = 1000, li = 0;
  const tlog = (token, f, t, v, tx, block) => ({ address: token, topics: [TOPIC, pad(f), pad(t)], data: hex(v), transactionHash: tx, blockNumber: '0x' + block.toString(16), logIndex: '0x' + (li++).toString(16) });
  const send = (from, legs) => { const tx = '0x' + (++blk).toString(16).padStart(64, '0'); const logs = legs.map(([tok, f, t, v]) => tlog(tok, f, t, v, tx, blk)); receipts.set(tx, { from, logs }); return logs; };
  // the ledger reads a batch: the hook sees it, and the ledger's height moves to its last block
  const ledger = (coinAddr, logs) => {
    const mine = logs.filter((l) => l.address === coinAddr);
    const get = db.prepare('SELECT balance FROM holder_balances WHERE token_addr = ? AND wallet = ?'), put = db.prepare('INSERT INTO holder_balances (token_addr, wallet, balance, positive) VALUES (?,?,?,1) ON CONFLICT(token_addr, wallet) DO UPDATE SET balance = excluded.balance');
    for (const l of mine) for (const [x, d] of [['0x' + l.topics[1].slice(-40), -BigInt(l.data)], ['0x' + l.topics[2].slice(-40), BigInt(l.data)]]) put.run(coinAddr, x, (BigInt((get.get(coinAddr, x) || { balance: '0' }).balance) + d).toString());
    ctx.dhLedgerHook(coinAddr, mine);   // after the balances, as ledgerApply runs it
    db.prepare('INSERT INTO holder_index (token_addr, last_block) VALUES (?, ?) ON CONFLICT(token_addr) DO UPDATE SET last_block = MAX(last_block, excluded.last_block)').run(coinAddr, blk);
  };
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
  check('  ...and what it can still hold of theirs is at most its balance: 402 (the 990 it got, less the 594 sold and the 6 fee, plus 12 a pool paid it earlier)', follow(1, X).budget === '402', follow(1, X).budget);
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
  // a batch sender's recipients are probed like any recipient: a vault, or a router passing them on again, is not followed
  ledger(SEND, send(W, [[SEND, W, FWD2, 60], [SEND, FWD2, VAULT, 60]]));
  await ctx.dhResolveRun();
  check('a contract that forwards the coins into a vault: neither is followed (the review\'s round-3 case — strangers withdrawing are not the member selling)', !follow(1, FWD2) && !follow(1, VAULT) && last().status === 'ignored', JSON.stringify(last()));
  ledger(SEND, send(W, [[SEND, W, FWD3, 60], [SEND, FWD3, R3, 60], [SEND, R3, U3, 60]]));
  await ctx.dhResolveRun();
  check('  ...nor a second contract that passes them on again in the same transaction (a router)', !follow(1, FWD3) && !follow(1, R3), JSON.stringify(follow(1, R3)));
  ledger(SEND, send(W, [[SEND, W, FWD4, 50], [SEND, W2, FWD4, 50], [SEND, FWD4, U4, 100]]));
  await ctx.dhResolveRun();
  check('two of the member\'s wallets paying one batch send: its recipient is followed for the 100 it got, not twice that', follow(1, U4) && follow(1, U4).budget === '100' && follow(1, U4).state === 1, JSON.stringify(follow(1, U4)));
  ctx.DH_FWD_MAX = 2;   // (2 for this check)
  const B1 = '0x' + '4'.repeat(39) + '1', B2 = '0x' + '4'.repeat(39) + '2', B3 = '0x' + '4'.repeat(39) + '3';
  ledger(SEND, send(W, [[SEND, W, FWD4, 60], [SEND, FWD4, B1, 10], [SEND, FWD4, B2, 30], [SEND, FWD4, B3, 20]]));
  await ctx.dhResolveRun();
  ctx.DH_FWD_MAX = 50;
  check('a batch send to more wallets than are probed: the ones that got the most are followed (and the log says the rest were not)', follow(1, B2) && follow(1, B3) && !follow(1, B1), JSON.stringify([follow(1, B1), follow(1, B2), follow(1, B3)]));
  // a batch recipient the member also sent coins to directly, later — the blocks in between are read back too
  const fwd5 = send(W, [[SEND, W, FWD5, 200], [SEND, FWD5, R5, 200]]), b5 = blk;
  ledger(SEND, fwd5);
  blk += 2; ledger(SEND, send(R5, [[SEND, R5, POOL.SEND, 120], [WETH, POOL.SEND, R5, 2]]));   // R5 sells — nobody watches it yet
  blk += 2; ledger(SEND, send(W, [[SEND, W, R5, 10]]));                                        // then the member sends it 10 directly (watched from here on)
  await ctx.dhResolveRun(); await ctx.dhResolveRun();
  check('a batch recipient that was also sent coins directly later: its sale in between is found and counted (the review\'s round-3 case)', moves().some((m) => m.status === 'sale' && m.src === 'followed' && m.quick === 'pool' && m.id > 0) && follow(1, R5) && follow(1, R5).since === b5, JSON.stringify(follow(1, R5)));
  // a real share of the coins sent to a wallet in a sale's own transaction keeps that wallet followed
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 400], [SEND, W, FRIEND, 100], [WETH, POOL.SEND, W, 8]]));
  await ctx.dhResolveRun();
  check('a sale that also sends a fifth of the coins to a wallet: a SALE, and that wallet stays followed (a fee-sized cut would not)', last().status === 'sale' && follow(1, FRIEND) && follow(1, FRIEND).state === 1, JSON.stringify(follow(1, FRIEND)));
  // failures: asked again later, one move never holds up the rest, and a sale's time is never guessed
  const failLogs = send(W, [[SEND, W, POOL.SEND, 3], [WETH, POOL.SEND, W, 1]]);
  FAILTX.add(failLogs[0].transactionHash); ledger(SEND, failLogs);
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 4], [WETH, POOL.SEND, W, 1]]));
  await ctx.dhResolveRun();
  const failed = db.prepare('SELECT status, tries, next_try_at FROM dh_moves WHERE id = (SELECT MAX(id) - 1 FROM dh_moves)').get();
  check('a move whose receipt the node keeps failing: pending, asked again after a pause (the round stops there)', failed.status === 'pending' && failed.tries === 1 && failed.next_try_at > NOW && last().status === 'pending', JSON.stringify(failed));
  await ctx.dhResolveRun();
  check('  ...and the next round goes past it: the move behind it is settled (one move can never hold up the rest — the review\'s round-3 case)', last().status === 'sale' && db.prepare('SELECT status FROM dh_moves WHERE id = (SELECT MAX(id) - 1 FROM dh_moves)').get().status === 'pending');
  FAILTX.clear(); NOW += 10 * 60e3; await ctx.dhResolveRun();
  check('  ...and once the node answers, it is settled too', db.prepare('SELECT status FROM dh_moves WHERE id = (SELECT MAX(id) - 1 FROM dh_moves)').get().status === 'sale');
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 5], [WETH, POOL.SEND, W, 1]])); BADBLOCK.add(blk);
  await ctx.dhResolveRun();
  check('a sale whose block time cannot be read waits — it is never stamped with the time the ledger noted it (the review\'s round-3 case)', last().status === 'pending' && last().sale_at == null, JSON.stringify(last()));
  BADBLOCK.clear(); NOW += 10 * 60e3; await ctx.dhResolveRun();
  check('  ...and is settled with its own block\'s time once that can be read', last().status === 'sale' && last().sale_at === blk * 1000, JSON.stringify(last()));
  ledger(SEND, send(W, [[SEND, W, FLAKY, 30]]));
  await ctx.dhResolveRun();
  const fl = db.prepare('SELECT status, tries FROM dh_moves ORDER BY id DESC LIMIT 1').get();
  check('a recipient whose probe fails for a reason other than a revert is asked about again — never taken for a wallet (or a pool) on a guess', fl.status === 'pending' && fl.tries === 1 && follow(1, FLAKY) && follow(1, FLAKY).state === 0, JSON.stringify(fl));
  // the real $SEND sale that also ran the token's auto-liquidity (tx 0xa15e9630…, block 0x4e5581a): the pool's liquidity turn
  // (coins + WETH in, LP minted) ends at the mint, so the seller's swap after it is a sale (it was read as a router before)
  const REAL = { from: '0xdd11158b5d8c0af08834f2c58cdb7593311a1590', legs: [
    [SEND, '0xdd11158b5d8c0af08834f2c58cdb7593311a1590', SEND, '79950000000000000000000'], [SEND, SEND, POOL.SEND, '77490963698509411373483'],
    [WETH, POOL.SEND, '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '4410843780708231'], [WETH, '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', Z, '4410843780708231'],
    [SEND, SEND, POOL.SEND, '77404620387823030122490'], [WETH, Z, '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', '4410843780708231'],
    [WETH, '0x89e5db8b5aa49aa85ac63f691524311aeb649eba', POOL.SEND, '4410843780708231'], [POOL.SEND, Z, '0x2ac03e14cfe755426daaee0a4994184ce81482f8', '136099203676765037'],
    [POOL.SEND, Z, DEAD, '18169487442527501697'], [SEND, '0xdd11158b5d8c0af08834f2c58cdb7593311a1590', POOL.SEND, '7915050000000000000000000'],
    [WETH, POOL.SEND, '0x204faca1764b154221e35c0d20abb3c525710498', '377283388418713703'], [WETH, '0x204faca1764b154221e35c0d20abb3c525710498', Z, '377283388418713703']] };
  const realRc = { from: REAL.from, logs: REAL.legs.map(([tok, f, t, v]) => ({ address: tok, topics: [TOPIC, pad(f), pad(t)], data: hex(v) })) };
  const realT = ctx.tradeLegs(ctx.receiptLegs(realRc), REAL.from, SEND);
  check('a real $SEND sale that also ran the token\'s auto-liquidity is a SALE, for the 0.377 WETH the pool paid (the review\'s round-3 high finding)', realT && realT[3] === 1 && realT[4] === '377283388418713703', JSON.stringify(realT));
  // a followed wallet with coins of its own: moving some of them keeps the member's coins in it, and it stays followed
  const W3 = '0x' + '5'.repeat(39) + '1', F23 = '0x' + '5'.repeat(39) + '2', D3 = '0x' + '5'.repeat(39) + '3', U3b = '0x' + '5'.repeat(39) + '6';
  link(3, W3);
  ledger(SEND, send(W3, [[SEND, POOL.SEND, W3, 5000], [WETH, W3, POOL.SEND, 1]]));   // a buy: W3 holds 5,000
  ledger(SEND, send(F23, [[SEND, POOL.SEND, F23, 5000], [WETH, F23, POOL.SEND, 1]]));   // a friend's own 5,000
  ledger(SEND, send(W3, [[SEND, W3, F23, 1000]]));
  await ctx.dhResolveRun();
  ledger(SEND, send(F23, [[SEND, F23, D3, 1000]]));   // the friend moves 1,000 of its own (6,000 → 5,000)
  await ctx.dhResolveRun();
  check('a wallet the member sent 1,000 to moves 1,000 of its own: it still holds the member\'s 1,000 and stays followed (the review\'s round-5 case)', follow(3, F23) && follow(3, F23).budget === '1000', JSON.stringify(follow(3, F23)));
  ledger(SEND, send(F23, [[SEND, F23, POOL.SEND, 3000], [WETH, POOL.SEND, F23, 5]]));
  await ctx.dhResolveRun();
  check('  ...so its later sale is the member\'s sale', last().status === 'sale' && last().user_id === 3 && last().src === 'followed', JSON.stringify(last()));
  ledger(SEND, send(F23, [[SEND, F23, D3, 1990]]));   // 2,000 → 10: now it cannot hold more than 10 of the member's
  await ctx.dhResolveRun();
  check('  ...and once it holds 2% or less of what it got, it is let go', !follow(3, F23), JSON.stringify(follow(3, F23)));
  // a wallet unlinked before the ledger saw it filled is still followed
  ctx.DH_FOLLOW_MAX = 0;   // (and even past the cap)
  ctx.dhFollowAdd(3, 'SEND', bidx(U3b), U3b, blk + 1, 0n, 'unlink');
  ctx.DH_FOLLOW_MAX = 200;
  check('a wallet unlinked while the ledger shows it empty is still followed — its sales are the member\'s (the review\'s round-5 case)', follow(3, U3b) && follow(3, U3b).via === 'unlink', JSON.stringify(follow(3, U3b)));
  blk += 2;
  ledger(SEND, send(U3b, [[SEND, POOL.SEND, U3b, 800], [WETH, U3b, POOL.SEND, 1]]));
  ledger(SEND, send(U3b, [[SEND, U3b, POOL.SEND, 800], [WETH, POOL.SEND, U3b, 2]]));
  await ctx.dhResolveRun();
  check('  ...its sale resets the member', last().status === 'sale' && last().user_id === 3 && last().src === 'unlinked', JSON.stringify(last()));
  // a sale's transaction with a fee-sized cut to a wallet, and a plain transfer to it in the same ledger batch
  const FR2 = '0x' + '5'.repeat(39) + '4';
  const saleCut = send(W, [[SEND, W, POOL.SEND, 96000], [SEND, W, FR2, 4000], [WETH, POOL.SEND, W, 9]]), plain = send(W, [[SEND, W, FR2, 50000]]);
  ledger(SEND, [...saleCut, ...plain]);
  await ctx.dhResolveRun(); await ctx.dhResolveRun();
  check('a 4% cut paid in a sale and a plain 50,000 sent to the same wallet in one ledger batch: the wallet stays followed for the 50,000 (the review\'s round-4 high finding)', follow(1, FR2) && follow(1, FR2).state === 1 && follow(1, FR2).budget === '50000', JSON.stringify(follow(1, FR2)));
  // a batch send inside a sale's own transaction
  const F3 = '0x' + '6'.repeat(39) + '1', R31 = '0x' + '6'.repeat(39) + '2', R32 = '0x' + '6'.repeat(39) + '3';
  CODE.add(F3);
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 1000], [WETH, POOL.SEND, W, 2], [SEND, W, F3, 5000], [SEND, F3, R31, 2500], [SEND, F3, R32, 2500]]));
  await ctx.dhResolveRun();
  check('a sale that also batch-sends coins in the same transaction: a SALE, and the batch\'s wallets are followed', last().status === 'sale' && follow(1, R31) && follow(1, R31).budget === '2500' && follow(1, R32) && !follow(1, F3), JSON.stringify([follow(1, R31), follow(1, F3)]));
  // the node down for longer than DH_GIVE_UP_MS: the move is never given up (its receipt will still prove it)
  const outage = send(W, [[SEND, W, POOL.SEND, 6], [WETH, POOL.SEND, W, 1]]);
  FAILTX.add(outage[0].transactionHash); ledger(SEND, outage);
  for (let d = 0; d < 9; d++) { NOW += DAY; await ctx.dhResolveRun(); }
  check('the node down for nine days: the move waits — never set aside (the review\'s round-4 case)', last().status === 'pending', JSON.stringify(last()));
  FAILTX.clear(); NOW += 2 * 3600e3; await ctx.dhResolveRun();
  check('  ...and the first round with the node back settles it as the SALE it was', last().status === 'sale');
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
  // dust cannot fill the slots: past the cap (5 for this check, member 2) the smallest is let go for a real one
  ctx.DH_FOLLOW_MAX = 5;
  for (let i = 0; i < 6; i++) ledger(SEND, send(OTHER, [[SEND, OTHER, a('e').slice(0, 41) + String(i), 1]]));
  ledger(SEND, send(OTHER, [[SEND, OTHER, a('f'), 5000]]));
  ctx.DH_FOLLOW_MAX = 200;
  check('followed wallets have a cap, and dust sends cannot fill it: the smallest is let go for a real one', !!follow(2, a('f')) && db.prepare("SELECT COUNT(*) n FROM dh_follow WHERE user_id = 2 AND token = 'SEND'").get().n <= 5);
  await ctx.dhResolveRun();
  // a wallet the member unlinked is still theirs: followed for good, and its own transfers are followed on
  db.prepare("DELETE FROM identities WHERE identifier = ?").run(bidx(W2));
  ctx.dhFollowAdd(1, 'SEND', bidx(W2), W2, blk + 1, 777n, 'unlink');
  ledger(SEND, send(W2, [[SEND, W2, a('b'), 700]]));
  await ctx.dhResolveRun();
  check('a wallet they unlinked is still theirs: its transfer is followed on like a linked wallet\'s', last().src === 'unlinked' && last().status === 'transfer' && follow(1, a('b')) && follow(1, a('b')).state === 1, JSON.stringify(last()));
  // the node down: nothing settled, nothing charged
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 1], [WETH, POOL.SEND, W, 1]]));
  nodeDown = true; await ctx.dhResolveRun(); nodeDown = false;
  const nd = db.prepare('SELECT status, tries FROM dh_moves ORDER BY id DESC LIMIT 1').get();
  check('the node refusing settles nothing (the move waits a short pause for a later round — never taken for a sale)', nd.status === 'pending' && nd.tries === 1, JSON.stringify(nd));
  NOW += 10 * 60e3; await ctx.dhResolveRun();
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
  check('with no wallet left, the streak pauses, and a sale from a followed wallet (or one they unlinked) still resets it then',
    /dhPauseHolder\(userId\); db\.prepare\('UPDATE holder_state SET last_check = \? WHERE user_id = \?'\)\.run\(now\(\), userId\);/.test(SRC) && /const nx0 = dhStreakNext\(latest, \{ scoreBp: 0, qGwcBp: 0 \}, sales, now\(\)\);/.test(SRC) && /if \(nx0\.resets\.length\) dhResetNotice\(userId, nx0\.resets\);/.test(SRC));
  check('a read whose wallets changed while it waited on the chain is not written (it reads again, at most twice)',
    /if \(walletAddresses\(userId\)\.slice\(0, MAX_LINKED_WALLETS\)\.join\(\) !== addrs\.join\(\)\) \{ db\.exec\('ROLLBACK'\);/.test(SRC) && /nx = dhStreakNext\(latest, \{ scoreBp, qGwcBp \}, sales, now\(\)\);/.test(SRC));
  check('a paused streak keeps its public Diamond badge — the $GWC one alone too — and the holder sweep keeps reading it', /if \(!h \|\| !\(\(h\.streak_start && \(h\.score_bp > 0 \|\| h\.paused_at\)\) \|\| \(h\.gwc_streak_start && h\.gwc_paused_at\)\)\) return null;/.test(SRC) && /h\.score_bp > 0 OR h\.streak_start IS NOT NULL OR h\.gwc_streak_start IS NOT NULL/.test(SRC) && /gwcStreakStart: h\.gwc_streak_start/.test(SRC));
  check('deleting an account deletes its follows and moves', /'holder_state', 'dh_follow', 'dh_moves',/.test(SRC));
  {
    // the paused dashboard, rendered by gamify.js's own boostEngine (a paused streak always reads a qualifying score of 0)
    const GJ = readFileSync(path.join(ROOT, 'public', 'gamify.js'), 'utf8');
    const gj = (re, name) => { const m = re.exec(GJ); if (!m) throw new Error('could not find ' + name + ' in gamify.js'); return m[0]; };
    const src = gj(/  function esc\(s\) [^\n]+\n/, 'esc') + gj(/  const DIA_TIERS = \[[\s\S]*?\n  \];\n/, 'DIA_TIERS') + gj(/  const diaNext = [^\n]+\n/, 'diaNext') + gj(/  const diaNextLabel = [^\n]+\n/, 'diaNextLabel')
      + gj(/  const nf = [^\n]+\n/, 'nf') + gj(/  const GWC_W = [^\n]+\n/, 'GWC_W') + gj(/  function qualPct\([^\n]+\n/, 'qualPct') + gj(/  function supplyTermOf\([^\n]+\n/, 'supplyTermOf')
      + gj(/  const pausedHold = [^\n]+\n/, 'pausedHold') + gj(/  const pausedDays = [^\n]+\n/, 'pausedDays') + gj(/  const pausedCoin = [^\n]+\n/, 'pausedCoin') + gj(/  function objectiveBar\(g\) \{[\s\S]*?\n  \}\n/, 'objectiveBar')
      + gj(/  function holdForge\(h\) \{[\s\S]*?\n  \}\n/, 'holdForge') + gj(/  function diamondRelic\(h\) \{[\s\S]*?\n  \}\n/, 'diamondRelic') + gj(/  function boostEngine\(g\) \{[\s\S]*?\n  \}\n/, 'boostEngine');
    const ui = vm.createContext({ AUTH: { user: { wallets: ['0x1'] } }, Math, Date, String, Number });
    vm.runInContext(src + '\nthis.boostEngine = boostEngine; this.objectiveBar = objectiveBar;', ui);
    const paused = { streakStart: T0, streakPaused: true, scorePct: 0, holdDays: 12, minHoldUsd: 100, diamond: { level: 2, maxLevel: 10, name: 'Firm Hands', emoji: '🤝', days: 12, nextDays: 14, progress: 0.7, factor: 1.4 } };
    const html = ui.boostEngine({ holder: paused, rules: { holdFloorUsd: 100 } });
    check('the dashboard shows a paused streak as paused — its days and Diamond level kept, "moving coins is not selling" — not as "Holder Boost locked, buy to unlock" (the review\'s round-3 case)',
      /Moving coins is not selling/.test(html) && /12/.test(html) && /Firm Hands/.test(html) && !/Holder Boost locked/.test(html) && !/Buy &amp; hold/.test(html), html.slice(0, 300));
    const locked = ui.boostEngine({ holder: { ...paused, streakPaused: false, streakStart: null }, rules: {} });
    check('  ...while a member with no streak still sees the locked panel', /Holder Boost locked/.test(locked));
    const ob = ui.objectiveBar({ holder: { ...paused, fresh: false }, level: 3, nextLevelXp: 100, intoLevel: 10, spanLevel: 50 });
    check('the objective bar at the top says the streak is paused — not "N days of holding to the next tier, just don\'t sell" or "verify to keep it" (the review\'s round-4 case)',
      /12-day<\/b> Diamond streak is paused/.test(ob) && !/just don.t sell/.test(ob) && !/Don.t break/.test(ob) && !/re-verify/.test(ob) && /data-tip=/.test(ob), ob.slice(0, 300));
    const gwcOnly = { streakStart: null, gwcStreakStart: T0, gwcStreakPaused: true, scorePct: 0, holdDays: 0, gwcDays: 60, minHoldUsd: 100, diamond: { level: 6, maxLevel: 10, name: 'Flawless Diamond', emoji: '💎', days: 120, nextDays: 240, progress: 0, factor: 2 } };
    const gh = ui.boostEngine({ holder: gwcOnly, rules: {} });
    check('a $GWC streak paused on its own (a $SEND sale ended the combined one) shows as paused at its 60 days — not as "Holder Boost locked"', /60/.test(gh) && /Moving coins is not selling/.test(gh) && !/Holder Boost locked/.test(gh), gh.slice(0, 300));
    const gob = ui.objectiveBar({ holder: gwcOnly, level: 3, nextLevelXp: 100, intoLevel: 10, spanLevel: 50 });
    check('  ...and says it is $GWC that picks it up again (a $SEND buy starts a new clock — the review\'s round-5 case)', /of \$GWC right now/.test(gh) && /60-day<\/b> Diamond streak is paused/.test(gob) && /of \$GWC right now/.test(gob) && !/\$SEND or \$GWC/.test(gob), gob.slice(0, 300));
  }
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
