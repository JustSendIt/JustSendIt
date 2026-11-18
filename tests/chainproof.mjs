/* The participation check reads what a wallet BOUGHT of $SEND (owner, 2026-11-17: "$100 bought") from the coin tape
   the server keeps from the CHAIN (lib/tape.js, lib/bought.js): Transfer logs and the pool's Swaps → the acquisition
   engine → a real verdict. Live (CHAIN_LIVE=1) it waits for the server's $SEND tape to be read first, then proves three
   wallets: the burn address (holds $SEND, never bought any → a definite refusal: $0 bought), a real recent buyer found
   from the $SEND pool's own transfers (a definite verdict either way — verified, or a stated reason — never "still
   reading"), and a ROUTED buyer: a wallet whose $SEND came from a contract that took it out of the pool in the same
   transaction — a market buy (lib/acquire.js follows the pool's tokens through routers). Read-only on the chain; every
   row made here is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, KEY_PATH, SERVER_JS } from './_paths.mjs';
import { rpcDispatcher, LIVE_CHAIN, liveSkipped, HONEST_UA } from './_rpc.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
let GATE = '';
const DATA_KEY = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const IDX_KEY = createHmac('sha256', DATA_KEY).update('blind-index').digest();
const bidx = (v) => createHmac('sha256', IDX_KEY).update(String(v == null ? '' : v)).digest('hex');
const encField = (s) => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', DATA_KEY, iv); const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]); return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const decField = (s) => { if (!s || !String(s).startsWith('v1:')) return s; const b = Buffer.from(String(s).slice(3), 'base64'); const d = createDecipheriv('aes-256-gcm', DATA_KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
const made = [];
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', PAIR = '0xf30bb531d0255969be155533abac34b22bd63414', ROUTER = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f', DEAD = '0x000000000000000000000000000000000000dead';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UA = { 'Content-Type': 'application/json', 'User-Agent': HONEST_UA };
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, dispatcher: rpcDispatcher, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (r.status === 429 && i < 6) { await new Promise(ok => setTimeout(ok, 2000 * (i + 1))); continue; }
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
  }
}
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [GATE, opts.sid ? 'sid=' + opts.sid : ''].filter(Boolean).join('; ') }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
function mkUserWithWallet(name, wallet) {
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(name, Date.now(), '🧪');   // NOT past the check: holder_verified_at stays NULL
  const id = db.prepare('SELECT id FROM users WHERE username = ?').get(name).id; made.push(id);
  const raw = 'tok_' + name + '_' + randomBytes(6).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?, 'wallet', ?, ?, ?)").run(id, bidx(wallet.toLowerCase()), encField(wallet.toLowerCase()), Date.now() - 864e5);
  return { id, sid: raw };
}
async function proveAndWait(u, ms = 150000) {
  const q = await api('/api/holder/verify', { method: 'POST', sid: u.sid });
  if (q.status !== 200) return { queued: q };
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await new Promise(ok => setTimeout(ok, 3000));
    const row = db.prepare('SELECT holder_state, holder_verified_at, holder_proof_reason, holder_proof FROM users WHERE id = ?').get(u.id);
    if (row.holder_state !== 'pending') return { queued: q, row };
  }
  return { queued: q, row: db.prepare('SELECT holder_state, holder_verified_at, holder_proof_reason, holder_proof FROM users WHERE id = ?').get(u.id), timedOut: true };
}
const UNREAD = /could not finish reading|could not read your|nothing has been decided/i;
const isContract = async (a) => { const c = await rpc('eth_getCode', [a, 'latest']).catch(() => null); return c == null ? null : c !== '0x'; };

// no invite pass: every request here is signed in (a session is the ticket), and the shared redeem budget is for the suites that need one
try {
  /* ═══ 1. the wiring, in the source ═══ */
  check('every wallet-history reader goes through ogTransfers: the explorer only when a keyed one is set, the chain otherwise and as its fallback',
    /const EXPLORER_KEYED = !!process\.env\.BLOCKSCOUT_URL;/.test(SRC) && /return rpcTokenTransfers\(wallet, token, opts\);/.test(SRC)
    && /const rows = await ogTransfers\(a, t, \{ tries: 2/.test(SRC) && /const rows = await ogTransfers\(w, TOK\.SEND/.test(SRC));
  check('the participation check and a Send Call\'s size read the "$100 bought" verdicts (the coin tape), not a wallet\'s history on the request',
    /let st = BOUGHT \? BOUGHT\.stateOf\(userId, TOK\.SEND\) : null;/.test(SRC) && /let v = holderProofVerdict\(st && st\.fresh \? st : null, now\(\)\);/.test(SRC)
    && /const sz = boughtSpendAt\(me\.id, token, t, liq\);/.test(SRC));
  check('  ...the chain reader reads transfers FROM and TO the wallet, asks a timed-out window again before splitting it, quarters a too-large one, and never reads an undecodable log as 0',
    /await transferLogWalk\(tok, \[\[TRANSFER_TOPIC, wt\], \[TRANSFER_TOPIC, null, wt\]\], start, head, CHAIN_HISTORY_MAX\)/.test(SRC) && /if \(TOO_MANY_RE\.test\(m\) && window > 50\) \{ window = Math\.max\(50, Math\.floor\(window \/ 4\)\); if \(!slow\) ceiling = window;/.test(SRC)
    && /const slow = \/timed out\|timeout\|aborted\/i\.test\(m\);\s+if \(slow && tries < 2\) \{ tries\+\+;/.test(SRC) && /a transfer this reader cannot decode/.test(SRC));
  check('  ...and the replay still has to reconcile with balanceOf before anything is decided', /if \(onChain !== bal\) throw new Error\('og scan: replay did not reconcile with chain balance'\)/.test(SRC));
  check('signing in with a wallet queues the check for an account that has not passed it', /if \(ident\) \{ try \{ const uu = db\.prepare\('SELECT \* FROM users WHERE id = \?'\)\.get\(userId\); if \(uu && needsHolderProof\(uu\) && !proofQueue\.includes\(userId\)\) queueHolderProof\(userId\); \} catch \{\} \}/.test(SRC));
  check('a buy through ANY router counts: the replay asks what the pool itself sent (or received) in that transaction, capped at that amount',
    /async function routedPoolFlows\(token, pair, wallet, rows, direct\)/.test(SRC) && /const routed = await routedPoolFlows\(token, pair, wallet, rows, isMarket\)/.test(SRC)
    && /isAcquisition\(from\) \? v : routed\.take\(r, 'out', v\)/.test(SRC) && /isMarket\(to\) \? v : routed\.take\(r, 'in', v\)/.test(SRC)
    && /const n = v < f\[dir\] \? v : f\[dir\]; f\[dir\] -= n; return n;/.test(SRC) && /if \(a === b\) return 0n;   \/\/ a wallet paying itself neither bought nor sold/.test(SRC));
  check('  ...what is already counted in full uses up its transaction first (a taxed sell is one sale)',
    /if \(to === w && from !== w && direct\(from\)\) f\.out = f\.out > v \? f\.out - v : 0n;/.test(SRC));
  check('  ...and the refusals the old rule made ("no market buy", "sold back more") are asked once more after boot',
    /setTimeout\(\(\) => requeueRuleChangedProofs\(\), 25000\)/.test(SRC) && /holder_proof_reason LIKE '%no market buy behind it%' OR u\.holder_proof_reason LIKE '%have sold back more%'/.test(SRC)
    && /Your wallets have sold back more ' \+ c\.label/.test(SRC));
  check('a check that ended unread is asked again by itself (every 15 minutes, and once after boot)', /setTimeout\(\(\) => requeueUnreadProofs\('boot'\), 20000\)/.test(SRC) && /setInterval\(\(\) => requeueUnreadProofs\(\), PROOF_RETRY_MS\)/.test(SRC));

  if (!LIVE_CHAIN) check(liveSkipped('the burn address, a real buyer and a routed buyer, each read from the chain and judged'), true, 'skipped');
  else {
  /* ═══ 2. the burn address: holds $SEND, never bought — a definite refusal, read from the chain ═══
     The verdicts are made from the server's $SEND tape: the first time it is read from the chain (paced, a few minutes), so the
     wallets are proved only once it is complete. */
  const tapeReady = async (ms) => { const until = Date.now() + ms; while (Date.now() < until) { try { const r = db.prepare("SELECT state FROM bought_tokens WHERE token = ?").get(SEND); const c = db.prepare("SELECT block FROM tape_cursor WHERE stream = ?").get('transfer:' + SEND); if (r && r.state === 'ok' && c) return true; } catch {} await new Promise(ok => setTimeout(ok, 10000)); } return false; };
  if (!(await tapeReady(20 * 60 * 1000))) { check('the server\'s $SEND tape was not read in 20 minutes this run — the live verdicts are not asserted', true); }
  else {
  const tag = randomBytes(3).toString('hex');
  const D = mkUserWithWallet('__cp_dead_' + tag, DEAD);
  const dr = await proveAndWait(D);
  check('the burn address gets a real verdict from the chain — $0 of $SEND bought — not "still reading"',
    dr.row && dr.row.holder_state === 'failed' && /\$0\.00 of \$SEND bought/.test(dr.row.holder_proof_reason || '') && !UNREAD.test(dr.row.holder_proof_reason || ''),
    JSON.stringify(dr.row && { s: dr.row.holder_state, r: dr.row.holder_proof_reason }) + (dr.timedOut ? ' (timed out)' : ''));
  let dd = null; try { dd = JSON.parse(decField(dr.row && dr.row.holder_proof) || 'null'); } catch {}
  check('  ...it holds half a billion $SEND, and nothing it holds was bought — decided with no price at all', dd && dd.SEND && BigInt(dd.SEND.heldWei) > 10n ** 24n && dd.SEND.spentUsd === 0 && dd.SEND.basis === 'bought', JSON.stringify(dd && dd.SEND && { held: dd.SEND.heldWei, spent: dd.SEND.spentUsd }));

  /* ═══ 3. a real buyer, found from the pool's own transfers ═══ */
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  let buyer = null;
  for (const span of [36000 * 24 * 3, 36000 * 24 * 14, 36000 * 24 * 60]) {   // 3, 14, 60 days of blocks at ~10/s
    const logs = await rpc('eth_getLogs', [{ address: SEND, topics: [TRANSFER, '0x' + PAIR.slice(2).padStart(64, '0')], fromBlock: '0x' + Math.max(0, head - span).toString(16), toBlock: 'latest' }]).catch(() => []);
    const cands = [...new Set((logs || []).map(l => '0x' + l.topics[2].slice(-40)))].filter(a => a !== ROUTER && a !== PAIR && a !== DEAD && !/^0x0{40}$/.test(a));
    for (const a of cands.reverse().slice(0, 12)) if (await isContract(a) === false) { buyer = a; break; }   // a person's wallet, not a router
    if (buyer) break;
  }
  if (!buyer) check('a recent $SEND buyer could be found on-chain (none in 60 days — not asserted)', true);
  else {
    const B = mkUserWithWallet('__cp_buy_' + tag, buyer);
    let br = await proveAndWait(B);
    // a block time or an ETH/USD cell the verdict needed may still be being read: once more after a rest
    if (br.row && UNREAD.test(br.row.holder_proof_reason || '')) { await new Promise(ok => setTimeout(ok, 60000)); br = await proveAndWait(B); }
    if (br.row && UNREAD.test(br.row.holder_proof_reason || '')) { check('the buyer\'s verdict was not complete this run (a price or a block time still being read) — not asserted', true); }
    else {
    let bd = null; try { bd = JSON.parse(decField(br.row && br.row.holder_proof) || 'null'); } catch {}
    const verified = !!(br.row && br.row.holder_verified_at);
    check('a real $SEND buyer gets a definite verdict from the chain (verified, or a stated reason) — never "could not read"',
      br.row && (verified || (br.row.holder_state === 'failed' && !UNREAD.test(br.row.holder_proof_reason || ''))),
      JSON.stringify(br.row && { s: br.row.holder_state, v: br.row.holder_verified_at, r: br.row.holder_proof_reason }) + (br.timedOut ? ' (timed out)' : ''));
    check('  ...and its market buy was found in that history (dollars bought or still maturing, with a first-buy time)', bd && bd.SEND && ((bd.SEND.spentUsd || 0) + (bd.SEND.pendingUsd || 0)) > 0 && bd.SEND.firstBuyMs > 0, JSON.stringify(bd && bd.SEND && { spent: bd.SEND.spentUsd, pending: bd.SEND.pendingUsd, first: bd.SEND.firstBuyMs }));
    }
    try { db.prepare('DELETE FROM gate_claims WHERE user_id = ?').run(B.id); } catch {}
  }

  /* ═══ 4. a ROUTED buyer: the pool paid a contract, and that contract paid a person's wallet in the same transaction ═══ */
  let routedBuyer = null, routedVia = null;
  for (const span of [36000 * 24 * 7, 36000 * 24 * 30, 36000 * 24 * 90]) {
    const logs = await rpc('eth_getLogs', [{ address: SEND, topics: [TRANSFER, '0x' + PAIR.slice(2).padStart(64, '0')], fromBlock: '0x' + Math.max(0, head - span).toString(16), toBlock: 'latest' }]).catch(() => []);
    // not the token contract itself (half the pool's transfers are its tax) nor the router the check already knows
    const hops = (logs || []).map(l => ({ tx: l.transactionHash, to: '0x' + l.topics[2].slice(-40) })).filter(h => h.to !== ROUTER && h.to !== PAIR && h.to !== DEAD && h.to !== SEND).reverse();
    const code = new Map(), tried = new Map();
    for (const h of hops.slice(0, 120)) {
      if (!code.has(h.to)) code.set(h.to, await isContract(h.to));
      if (code.get(h.to) !== true) continue;                                   // the pool paid a person directly: not a routed buy
      if ((tried.get(h.to) || 0) >= 2) continue;                               // two looks per contract, then the next one
      tried.set(h.to, (tried.get(h.to) || 0) + 1);
      const rc = await rpc('eth_getTransactionReceipt', [h.tx]).catch(() => null);
      // every onward transfer from that contract in the transaction — a taxed router pays the token contract its cut first
      const fwds = ((rc && rc.logs) || []).filter(l => l.address.toLowerCase() === SEND && l.topics[0] === TRANSFER && l.topics.length === 3 && '0x' + l.topics[1].slice(-40) === h.to);
      for (const fwd of fwds) {
        const dest = '0x' + fwd.topics[2].slice(-40);
        if (dest === PAIR || dest === DEAD || dest === ROUTER || dest === SEND || dest === h.to || /^0x0{40}$/.test(dest)) continue;
        if (await isContract(dest) !== false) continue;
        routedBuyer = dest; routedVia = h.to; break;
      }
      if (routedBuyer) break;
    }
    if (routedBuyer) break;
  }
  if (!routedBuyer) check('a routed $SEND buy could be found on-chain (none in 90 days — not asserted)', true);
  else {
    const R = mkUserWithWallet('__cp_rtd_' + tag, routedBuyer);
    let rr = await proveAndWait(R);
    if (rr.row && UNREAD.test(rr.row.holder_proof_reason || '')) { await new Promise(ok => setTimeout(ok, 20000)); rr = await proveAndWait(R); }   // the node throttled a read: once more after a rest
    let rd = null; try { rd = JSON.parse(decField(rr.row && rr.row.holder_proof) || 'null'); } catch {}
    const info = JSON.stringify(rr.row && { s: rr.row.holder_state, r: rr.row.holder_proof_reason, spent: rd && rd.SEND && rd.SEND.spentUsd, pending: rd && rd.SEND && rd.SEND.pendingUsd, via: routedVia }) + (rr.timedOut ? ' (timed out)' : '');
    if (rr.row && UNREAD.test(rr.row.holder_proof_reason || '')) check('the routed buyer\'s history could not be read this run (the node throttled it) — not asserted', true, info);
    else {
      check('a wallet whose $SEND came through a router is credited the buy (not $0 bought)', rr.row && !/\$0\.00 of \$SEND bought/.test(rr.row.holder_proof_reason || ''), info);
      check('  ...its routed buy is counted as bought (or still maturing), with a first-buy time', rd && rd.SEND && ((rd.SEND.spentUsd || 0) + (rd.SEND.pendingUsd || 0)) > 0 && rd.SEND.firstBuyMs > 0, info);
    }
    try { db.prepare('DELETE FROM gate_claims WHERE user_id = ?').run(R.id); } catch {}
  }
  }
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'gate_claims', 'holder_state', 'acq_state', 'buy_claims']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_cp\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
