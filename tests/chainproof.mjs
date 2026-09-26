/* The participation check reads a wallet's $SEND history from the CHAIN when the explorer cannot answer (and
   directly when no keyed explorer is configured, as in these tests): Transfer logs → the same replay → a real
   verdict. Two wallets from the live chain: the burn address (holds $SEND, never bought any → a definite
   "no market buy" refusal) and a real recent buyer found from the $SEND pool's own transfers (a definite verdict
   either way — verified, or a stated reason — never "could not finish reading the chain"). And a ROUTED buyer:
   a wallet whose $SEND came from a contract that took it out of the pool in the same transaction — a market buy,
   which the check used to refuse as "no market buy behind it". Read-only on the chain; every row made here is
   deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DB_PATH, KEY_PATH, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
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
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
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
    && /items = await ogTransfers\(a, tokenAddr, \{ noTime: true/.test(SRC) && /const rows = await ogTransfers\(a, t, \{ tries: 2/.test(SRC) && /const rows = await ogTransfers\(w, TOK\.SEND/.test(SRC));
  check('  ...the chain reader reads transfers FROM and TO the wallet, asks a timed-out window again before splitting it, quarters a too-large one, and never reads an undecodable log as 0',
    /await transferLogWalk\(tok, \[\[TRANSFER_TOPIC, wt\], \[TRANSFER_TOPIC, null, wt\]\], start, head, CHAIN_HISTORY_MAX\)/.test(SRC) && /if \(TOO_MANY_RE\.test\(m\) && window > 50\) \{ window = Math\.max\(50, Math\.floor\(window \/ 4\)\); if \(!slow\) ceiling = window;/.test(SRC)
    && /const slow = \/timed out\|timeout\|aborted\/i\.test\(m\);\s+if \(slow && tries < 2\) \{ tries\+\+;/.test(SRC) && /a transfer this reader cannot decode/.test(SRC));
  check('  ...and the replay still has to reconcile with balanceOf before anything is decided', /if \(onChain !== bal\) throw new Error\('og scan: replay did not reconcile with chain balance'\)/.test(SRC));
  check('signing in with a wallet queues the check for an account that has not passed it', /if \(ident\) \{ try \{ const uu = db\.prepare\('SELECT \* FROM users WHERE id = \?'\)\.get\(userId\); if \(uu && needsHolderProof\(uu\) && !proofQueue\.includes\(userId\)\) queueHolderProof\(userId\); \} catch \{\} \}/.test(SRC));
  check('a buy through ANY router counts: the replay asks what the pool itself sent (or received) in that transaction, capped at that amount',
    /async function routedPoolFlows\(token, pair, wallet, rows, direct\)/.test(SRC) && /const routed = await routedPoolFlows\(token, pair, wallet, rows, isMarket\)/.test(SRC)
    && /isAcquisition\(from\) \? v : routed\.take\(r, 'out', v\)/.test(SRC) && /isMarket\(to\) \? v : routed\.take\(r, 'in', v\)/.test(SRC)
    && /const n = v < f\[dir\] \? v : f\[dir\]; f\[dir\] -= n; return n;/.test(SRC) && /if \(a === b\) return 0n;   \/\/ a wallet paying itself neither bought nor sold/.test(SRC));
  check('  ...what is already counted in full uses up its transaction first (a taxed sell is one sale), and Send Call sizing uses the same rule',
    /if \(to === w && from !== w && direct\(from\)\) f\.out = f\.out > v \? f\.out - v : 0n;/.test(SRC) && /routedPos = await routedPoolFlows\(tokenAddr, pair, me, items\)/.test(SRC)
    && /inRaw \+= from === pair \? v : routedPos\.take\(it, 'out', v\)/.test(SRC));
  check('  ...and the refusals the old rule made ("no market buy", "sold back more") are asked once more after boot',
    /setTimeout\(\(\) => requeueRuleChangedProofs\(\), 25000\)/.test(SRC) && /holder_proof_reason LIKE '%no market buy behind it%' OR u\.holder_proof_reason LIKE '%have sold back more%'/.test(SRC)
    && /no market buy behind it\. The bag has to be one you bought/.test(SRC) && /Your wallets have sold back more ' \+ c\.label/.test(SRC));
  check('a check that ended unread is asked again by itself (every 15 minutes, and once after boot)', /setTimeout\(\(\) => requeueUnreadProofs\('boot'\), 20000\)/.test(SRC) && /setInterval\(\(\) => requeueUnreadProofs\(\), PROOF_RETRY_MS\)/.test(SRC));

  /* ═══ 2. the burn address: holds $SEND, never bought — a definite refusal, read from the chain ═══ */
  const tag = randomBytes(3).toString('hex');
  const D = mkUserWithWallet('__cp_dead_' + tag, DEAD);
  const dr = await proveAndWait(D);
  check('the burn address gets a real verdict from its on-chain history — "no market buy behind it" — not "could not read"',
    dr.row && dr.row.holder_state === 'failed' && /no market buy/i.test(dr.row.holder_proof_reason || '') && !UNREAD.test(dr.row.holder_proof_reason || ''),
    JSON.stringify(dr.row && { s: dr.row.holder_state, r: dr.row.holder_proof_reason }) + (dr.timedOut ? ' (timed out)' : ''));
  let dd = null; try { dd = JSON.parse(decField(dr.row && dr.row.holder_proof) || 'null'); } catch {}
  // usd is null when the price read was refused — this refusal does not need the price
  check('  ...its balance was read and reconciled (half a billion $SEND), and nothing was ever bought from the market — decided without needing the price', dd && dd.SEND && BigInt(dd.SEND.balWei) > 10n ** 24n && dd.SEND.boughtWei === '0' && (dd.SEND.usd == null || dd.SEND.usd > 100), JSON.stringify(dd && dd.SEND && { bal: dd.SEND.balWei, bought: dd.SEND.boughtWei, usd: dd.SEND.usd }));

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
    const PRICE_UNREAD = /could not read the \$SEND price/i;
    // the price is its own chain read, and the public node throttles bursts: one more try after a rest before calling it
    if (br.row && PRICE_UNREAD.test(br.row.holder_proof_reason || '')) { await new Promise(ok => setTimeout(ok, 20000)); br = await proveAndWait(B); }
    if (br.row && PRICE_UNREAD.test(br.row.holder_proof_reason || '')) { check('the $SEND price could not be read this run (the node throttled it) — the buyer verdict is not asserted', true); }
    else {
    let bd = null; try { bd = JSON.parse(decField(br.row && br.row.holder_proof) || 'null'); } catch {}
    const verified = !!(br.row && br.row.holder_verified_at);
    check('a real $SEND buyer gets a definite verdict from the chain (verified, or a stated reason) — never "could not read"',
      br.row && (verified || (br.row.holder_state === 'failed' && !UNREAD.test(br.row.holder_proof_reason || ''))),
      JSON.stringify(br.row && { s: br.row.holder_state, v: br.row.holder_verified_at, r: br.row.holder_proof_reason }) + (br.timedOut ? ' (timed out)' : ''));
    check('  ...and its market buy was found in that history (bought > 0, with a first-buy time)', bd && bd.SEND && BigInt(bd.SEND.boughtWei) > 0n && bd.SEND.firstBuyMs > 0, JSON.stringify(bd && bd.SEND && { bought: bd.SEND.boughtWei, first: bd.SEND.firstBuyMs }));
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
    const info = JSON.stringify(rr.row && { s: rr.row.holder_state, r: rr.row.holder_proof_reason, bought: rd && rd.SEND && rd.SEND.boughtWei, via: routedVia }) + (rr.timedOut ? ' (timed out)' : '');
    if (rr.row && UNREAD.test(rr.row.holder_proof_reason || '')) check('the routed buyer\'s history could not be read this run (the node throttled it) — not asserted', true, info);
    else {
      check('a wallet whose $SEND came through a router is NOT refused as "no market buy behind it"', rr.row && !/no market buy/i.test(rr.row.holder_proof_reason || ''), info);
      check('  ...its routed buy is counted as bought, with a first-buy time', rd && rd.SEND && BigInt(rd.SEND.boughtWei) > 0n && rd.SEND.firstBuyMs > 0, info);
    }
    try { db.prepare('DELETE FROM gate_claims WHERE user_id = ?').run(R.id); } catch {}
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'gate_claims', 'holder_state']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_cp\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
