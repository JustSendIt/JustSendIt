/* 💎 Diamond Hands: a SALE resets the streak, a TRANSFER never does (owner's rule, 2026-10-12: "only sells from that
   wallet or from the wallet that they transferred the token to counts as a sell").
   The real code is lifted out of server.js as it is — the streak rules (dhStreakNext, holdDaysOf), the ledger's eye on
   the members' wallets (dhLedgerHook) and the receipt check (dhResolveRun with receiptLegs + tradeLegs) — and run on
   hand-built Transfer logs and receipts in an in-memory database. No server, no chain. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { SERVER_JS, ROOT } from './_paths.mjs';
import path from 'node:path';

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
const W = a('1'), W2 = a('9'), X = a('2'), Y = a('5'), ROUTER = a('3'), CONTRACT = a('4'), OTHER = a('6');

try {
  /* ═══ 1. the streak rules (dhStreakNext) ═══ */
  const streakSrc = grab(/function dhStreakNext\(prev, cur, sales, t\) \{[\s\S]*?\n\}\n/, 'dhStreakNext');
  const daysSrc = grab(/function holdDaysOf\(h\) [^\n]+\n/, 'holdDaysOf') + grab(/function gwcDaysOf\(h\) [^\n]+\n/, 'gwcDaysOf');
  let T0 = 1_800_000_000_000, NOW = T0;
  const S = new Function('now', streakSrc + daysSrc + '\nreturn { dhStreakNext, holdDaysOf, gwcDaysOf };')(() => NOW);
  const row = (n) => ({ streak_start: n.streakStart, base_bp: n.baseBp, paused_at: n.pausedAt, paused_ms: n.pausedMs, gwc_streak_start: n.gwcStreak, gwc_base_bp: n.gwcBase, gwc_paused_at: n.gwcPausedAt, gwc_paused_ms: n.gwcPausedMs });
  const held = { scoreBp: 300, qGwcBp: 100, sendTok: 1000, gwcTok: 500 };
  let st = S.dhStreakNext(null, held, [], T0);
  check('a streak starts when the linked wallets first hold $100 of a coin', st.streakStart === T0 && st.gwcStreak === T0);
  let prev = { ...row(st), send_tok: 1000, gwc_tok: 500 };
  // a transfer out that still leaves the floor met: nothing happens
  st = S.dhStreakNext(prev, { ...held, scoreBp: 150, sendTok: 400 }, [], T0 + 10 * DAY);
  check('a transfer out that leaves the floor met changes nothing (it is not a sale)', st.streakStart === T0 && !st.pausedAt && !st.resets.length);
  // the old rule would have reset here (more than 2% below the peak); the new one does not
  check('  ...where the old "2% below the peak" rule reset the streak, the new one keeps it', /scoreBp < baseBp \* 0\.98/.test(SRC) === false);
  // a transfer that takes everything out: paused, days frozen
  prev = { ...row(st), send_tok: 400, gwc_tok: 500 };
  st = S.dhStreakNext(prev, { scoreBp: 0, qGwcBp: 0, sendTok: 0, gwcTok: 0 }, [], T0 + 20 * DAY);
  check('moving every coin out of the linked wallets PAUSES both streaks (not a sale)', st.streakStart === T0 && st.pausedAt === T0 + 20 * DAY && st.gwcStreak === T0 && st.gwcPausedAt === T0 + 20 * DAY && !st.resets.length);
  NOW = T0 + 50 * DAY;
  let h = { ...row(st), last_check: NOW };
  check('  ...the days stop at the pause (20, not 50)', Math.floor(S.holdDaysOf(h)) === 20 && Math.floor(S.gwcDaysOf(h)) === 20, S.holdDaysOf(h));
  prev = { ...row(st), send_tok: 0, gwc_tok: 0 };
  st = S.dhStreakNext(prev, { scoreBp: 0, qGwcBp: 0, sendTok: 0, gwcTok: 0 }, [], NOW);
  check('  ...and stay paused while nothing is back', st.pausedAt === T0 + 20 * DAY && st.streakStart === T0);
  // back over the floor 30 days later: resume, the gap not counted
  prev = { ...row(st), send_tok: 0, gwc_tok: 0 };
  st = S.dhStreakNext(prev, held, [], NOW);
  NOW = T0 + 60 * DAY; h = { ...row(st), last_check: NOW };
  check('back over the floor: the streak resumes where it left off, the 30 paused days never count (60 − 30 = 30)', st.streakStart === T0 && !st.pausedAt && st.pausedMs === 30 * DAY && Math.floor(S.holdDaysOf(h)) === 30, S.holdDaysOf(h));
  // a SALE resets to zero
  prev = { ...row(st), send_tok: 1000, gwc_tok: 500 };
  st = S.dhStreakNext(prev, held, [{ token: 'SEND', sale_at: T0 + 59 * DAY }], NOW);
  check('a $SEND SALE restarts the combined streak at the sale (and leaves the $GWC-only streak alone)', st.streakStart === T0 + 59 * DAY && st.pausedMs === 0 && st.gwcStreak === T0 && st.resets.length === 1 && st.resets[0].clock === 'all');
  st = S.dhStreakNext({ ...row(st), send_tok: 1000, gwc_tok: 500 }, held, [{ token: 'GWC', sale_at: T0 + 59.5 * DAY }], NOW);
  check('  ...a $GWC sale restarts both clocks', st.streakStart === T0 + 59.5 * DAY && st.gwcStreak === T0 + 59.5 * DAY && st.resets.length === 2);
  const before = st.streakStart;
  st = S.dhStreakNext({ ...row(st), send_tok: 1000, gwc_tok: 500 }, held, [{ token: 'SEND', sale_at: before - DAY }], NOW);
  check('  ...a sale from before the streak began changes nothing', st.streakStart === before && !st.resets.length);
  st = S.dhStreakNext({ ...row(st), send_tok: 1000, gwc_tok: 500 }, { scoreBp: 0, qGwcBp: 0, sendTok: 0, gwcTok: 0 }, [{ token: 'GWC', sale_at: NOW - 1000 }], NOW);
  check('  ...and a sale that left nothing that qualifies ends the streak (no pause)', st.streakStart === null && st.gwcStreak === null && st.pausedAt === null);
  // the price, not a move: ends as before
  st = S.dhStreakNext(null, held, [], T0);
  st = S.dhStreakNext({ ...row(st), send_tok: 1000, gwc_tok: 500 }, { scoreBp: 0, qGwcBp: 0, sendTok: 1000, gwcTok: 500 }, [], T0 + DAY);
  check('below the floor because the PRICE fell (no coins moved): the streak ends, as it always has', st.streakStart === null && st.gwcStreak === null);
  // a sale while paused
  st = S.dhStreakNext(null, held, [], T0);
  st = S.dhStreakNext({ ...row(st), send_tok: 1000, gwc_tok: 500 }, { scoreBp: 0, qGwcBp: 0, sendTok: 0, gwcTok: 0 }, [], T0 + DAY);
  st = S.dhStreakNext({ ...row(st), send_tok: 0, gwc_tok: 0 }, { scoreBp: 0, qGwcBp: 0, sendTok: 0, gwcTok: 0 }, [{ token: 'SEND', sale_at: T0 + 2 * DAY }], T0 + 3 * DAY);
  check('a sale from where the coins went, while paused, ends the paused streak', st.streakStart === null && st.resets.length === 1);

  /* ═══ 2. the ledger's eye (dhLedgerHook) and the receipt check (dhResolveRun) ═══ */
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE identities (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, identifier TEXT, identifier_enc TEXT)");
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_follow \([\s\S]*?\n\);/, 'dh_follow table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  db.exec(grab(/CREATE TABLE IF NOT EXISTS dh_moves \([\s\S]*?\n\);/, 'dh_moves table').replace(/REFERENCES users\(id\) ON DELETE CASCADE/g, ''));
  const enc = (s) => s == null ? null : 'E:' + s, dec = (s) => s && String(s).startsWith('E:') ? String(s).slice(2) : null, bidx = (s) => 'I:' + s;
  const link = (uid, w) => db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc) VALUES (?, 'wallet', ?, ?)").run(uid, bidx(w), enc(w));
  link(1, W); link(1, W2); link(2, OTHER);
  const hookSrc = grab(/function dhLedgerHook\(tok, logs\) \{[\s\S]*?\n\}\n/, 'dhLedgerHook');
  const resolveSrc = grab(/async function dhResolveRun\(\) \{[\s\S]*?\n\}\n/, 'dhResolveRun');
  const legsSrc = grab(/function receiptLegs\(rc\) \{[\s\S]*?\n\}\n/, 'receiptLegs') + grab(/const sentBy = \(e, w\) => [^\n]+/, 'sentBy') + '\n' + grab(/function tradeLegs\(entry, w, a\) \{[\s\S]*?\n\}\n/, 'tradeLegs');
  const receipts = new Map(), contracts = new Set([ROUTER, CONTRACT]);
  const ctx = vm.createContext({ BigInt, Math, Map, Set, Infinity, JSON, String, Number, parseInt, Error, console: { warn() {}, log() {} },
    db, bidx, encField: enc, decField: dec, now: () => NOW,
    TOK: { SEND, GWC }, OG_PAIR: POOL, ZERO_ADDR: Z, DEAD_ADDR: DEAD, WETH_ADDR: WETH, USDG_ADDR: USDG, TRANSFER_TOPIC: TOPIC, ENTRY_POINTS: new Set(), USEROP_TOPIC: '0x0',
    DH_COINS: { [SEND]: 'SEND', [GWC]: 'GWC' }, DH_FOLLOW_MAX: 200, DH_TRIES_MAX: 40,
    chainBlockTime: async (b) => b * 1000, addrHasCode: async (x) => contracts.has(x), isThrottle: () => false,
  });
  vm.runInContext(legsSrc + '\n' + hookSrc + '\n' + resolveSrc + `
    async function dhTxEntry(h) { const rc = RECEIPTS.get(h); if (!rc) throw new Error('no receipt'); return receiptLegs(rc); }
    this.dhLedgerHook = dhLedgerHook; this.dhResolveRun = dhResolveRun;`, Object.assign(ctx, { RECEIPTS: receipts }));
  const pad = (x) => '0x' + '0'.repeat(24) + x.slice(2);
  const hex = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
  let blk = 1000, li = 0;
  const tlog = (token, f, t, v, tx, block) => ({ address: token, topics: [TOPIC, pad(f), pad(t)], data: hex(v), transactionHash: tx, blockNumber: '0x' + block.toString(16), logIndex: '0x' + (li++).toString(16) });
  // a transaction: its Transfer logs (any token), its sender; the ledger sees only the coin's own logs
  const send = (from, legs) => { const tx = '0x' + (++blk).toString(16).padStart(64, '0'); const logs = legs.map(([tok, f, t, v]) => tlog(tok, f, t, v, tx, blk)); receipts.set(tx, { from, logs }); return logs; };
  const ledger = (coinAddr, logs) => ctx.dhLedgerHook(coinAddr, logs.filter((l) => l.address === coinAddr));
  const moves = () => db.prepare('SELECT id, user_id, token, src, quick, status, sale_at, amount FROM dh_moves ORDER BY id').all();
  const follow = (uid, w, coin = 'SEND') => db.prepare('SELECT budget, state, since_block FROM dh_follow WHERE user_id = ? AND token = ? AND addr_idx = ?').get(uid, coin, bidx(w));
  const last = () => moves().at(-1);

  // a direct sale into the pool
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 500], [WETH, POOL.SEND, W, 9]]));
  await ctx.dhResolveRun();
  check('a sale straight into the pool from a linked wallet is a SALE', last().status === 'sale' && last().quick === 'pool' && last().src === 'linked' && last().sale_at === blk * 1000, JSON.stringify(last()));
  // a routed sale (wallet → router → pool, the proceeds back through the router)
  ledger(SEND, send(W, [[SEND, W, ROUTER, 400], [SEND, ROUTER, POOL.SEND, 400], [WETH, POOL.SEND, ROUTER, 8], [WETH, ROUTER, W, 8]]));
  await ctx.dhResolveRun();
  check('a sale through a router is a SALE (and the router is not followed)', last().status === 'sale' && last().quick === 'routed' && !follow(1, ROUTER), JSON.stringify(last()));
  // adding liquidity: coins into the pool, no payout
  ledger(SEND, send(W, [[SEND, W, POOL.SEND, 300], [WETH, W, POOL.SEND, 6], [POOL.SEND, Z, W, 50]]));
  await ctx.dhResolveRun();
  check('adding liquidity (coins into the pool, nothing paid out) is NOT a sale', last().status === 'ignored' && last().quick === 'pool', JSON.stringify(last()));
  // a plain transfer to an ordinary wallet
  ledger(SEND, send(W, [[SEND, W, X, 1000]]));
  check('a transfer to another wallet starts following it at once', follow(1, X) && follow(1, X).state === 0 && follow(1, X).budget === '1000');
  await ctx.dhResolveRun();
  check('  ...it is a TRANSFER, not a sale, and the wallet stays followed (an ordinary wallet)', last().status === 'transfer' && follow(1, X).state === 1, JSON.stringify(last()));
  const salesBefore = moves().filter((m) => m.status === 'sale').length;
  // the token's own swap-back of its tax inside someone's plain transfer is nobody's sale
  ledger(SEND, send(W, [[SEND, W, Y, 200], [SEND, SEND, POOL.SEND, 40], [WETH, POOL.SEND, SEND, 1]]));
  await ctx.dhResolveRun();
  check('  ...a plain transfer during which the token swaps its own collected tax is still a transfer', last().status === 'transfer' && last().quick === 'transfer', JSON.stringify(last()));
  // into the member's own other wallet: not even a move
  const n0 = moves().length;
  ledger(SEND, send(W, [[SEND, W, W2, 100]]));
  check('moving coins between the member\'s own linked wallets is not a move at all', moves().length === n0);
  // the followed wallet sells
  ledger(SEND, send(X, [[SEND, X, POOL.SEND, 600], [WETH, POOL.SEND, X, 11]]));
  await ctx.dhResolveRun();
  check('a sale by the wallet they sent the coins to IS a sale for the member', last().status === 'sale' && last().src === 'followed' && last().user_id === 1, JSON.stringify(last()));
  check('  ...and it uses up that much of what the wallet got from them (1000 − 600 = 400 left)', follow(1, X).budget === '400');
  // it passes the rest on: not followed further (one hop), and that is not a sale
  ledger(SEND, send(X, [[SEND, X, OTHER, 100]]));
  await ctx.dhResolveRun();
  check('  ...its onward transfer is neither a sale nor a new follow (one hop, as the rule says)', last().status === 'ignored' && !follow(1, OTHER), JSON.stringify(last()));
  // it gives the rest back to the member
  ledger(SEND, send(X, [[SEND, X, W, 400]]));
  check('  ...and once it has given back what it got, it is let go', !follow(1, X));
  // a transfer to a contract that takes the coins without a sale (a vault, a bridge): not followed
  ledger(SEND, send(W, [[SEND, W, CONTRACT, 250]]));
  ledger(SEND, send(CONTRACT, [[SEND, CONTRACT, POOL.SEND, 250], [WETH, POOL.SEND, OTHER, 5]]));   // someone else's sale through it, before it is checked
  await ctx.dhResolveRun();
  const vm2 = moves().slice(-2);
  check('a contract that took the coins without a sale is not followed, and what passes through it later is not the member\'s sale', !follow(1, CONTRACT) && vm2[0].status === 'transfer' && vm2[1].status === 'ignored', JSON.stringify(vm2));
  // a wallet that sold BEFORE it got the member's coins: those sales are not counted
  ledger(SEND, send(Y, [[SEND, Y, POOL.SEND, 10], [WETH, POOL.SEND, Y, 1]]));
  await ctx.dhResolveRun();
  check('  ...and a followed wallet\'s sales count only from when it got the coins (Y got them earlier: this one counts)', last().status === 'sale' && last().src === 'followed');
  const yb = follow(1, Y);
  check('  ...a follow starts at the block of the transfer', yb && yb.since_block > 1000);
  // another member's linked wallet is watched for that member, not this one
  ledger(SEND, send(OTHER, [[SEND, OTHER, POOL.SEND, 70], [WETH, POOL.SEND, OTHER, 2]]));
  await ctx.dhResolveRun();
  check('a sale by another member\'s wallet is that member\'s sale only', last().user_id === 2 && last().status === 'sale');
  // $GWC is its own coin: a $SEND follow does not watch $GWC
  ledger(SEND, send(W, [[SEND, W, Y, 5]]));
  const gn = moves().length;
  ledger(GWC, send(Y, [[GWC, Y, POOL.GWC, 5], [WETH, POOL.GWC, Y, 1]]));
  check('following is per coin: a wallet sent $SEND is not watched for $GWC', moves().length === gn);
  // a receipt that cannot be read is never a sale
  ledger(SEND, (() => { const logs = send(W, [[SEND, W, POOL.SEND, 1], [WETH, POOL.SEND, W, 1]]); receipts.delete(logs[0].transactionHash); return logs; })());
  await ctx.dhResolveRun();
  check('a move whose receipt cannot be read waits (pending), it is never taken for a sale', last().status === 'pending');

  /* ═══ 3. wiring ═══ */
  check('the hook runs inside the ledger, for $SEND and $GWC only, and only once that ledger is built', /if \(watch\) dhLedgerHook\(tok, logs\);/.test(SRC) && /const watch = !!\(row && row\.status === 'ok' && row\.last_block\);/.test(SRC) && /ledgerApply\(tok, out, to, firstBlock, watch\)/.test(SRC) && /const coin = DH_COINS\[tok\]; if \(!coin\) return;/.test(SRC));
  check('refreshHolder applies confirmed sales and nothing else resets the streak', /const nx = dhStreakNext\(prev, \{ scoreBp, qGwcBp, sendTok, gwcTok \}, sales, now\(\)\);/.test(SRC) && !/streakStart = now\(\); baseBp = scoreBp; \}  \/\/ sold/.test(SRC));
  check('  ...and tells the member which coin and when, in words that say a transfer never resets it', /reset your Diamond Hands streak to zero/.test(SRC) && /Moving coins never does/.test(SRC));
  check('unlinking a wallet follows it for what it holds (unlinking is not a way to sell without it counting)', /VALUES \(\?,\?,\?,\?,\?,\?,1,'unlink',\?\)/.test(SRC));
  check('the dashboard says when a streak is paused', /streakPaused: !!h\.paused_at/.test(SRC) && /h\.streakPaused/.test(readFileSync(path.join(ROOT, 'public', 'gamify.js'), 'utf8')));
  const KEYS = readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8');
  check('the followed wallets and moves are encrypted + indexed like every wallet link, and key rotation carries them', /\['dh_follow', 'addr_enc'\]/.test(KEYS) && /\{ t: 'dh_follow', c: 'addr_idx' \}/.test(KEYS) && /\{ t: 'dh_moves', c: 'from_idx' \}/.test(KEYS) && /\['dh_moves', 'tx_enc'\]/.test(KEYS));
  const ABOUT = readFileSync(path.join(ROOT, 'public', 'about.html'), 'utf8'), WP = readFileSync(path.join(ROOT, 'public', 'whitepaper.html'), 'utf8');
  check('the About page and the White Paper state the rule (a transfer is not a sale) and no longer the 2% one', /Moving coins to another wallet is not a sale/.test(ABOUT) && !/more than 2% below its own peak/.test(ABOUT) && /Moving coins between wallets is not a sale/.test(WP));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
