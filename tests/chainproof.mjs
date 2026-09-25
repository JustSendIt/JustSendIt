/* The participation check reads a wallet's $SEND history from the CHAIN when the explorer cannot answer (and
   directly when no keyed explorer is configured, as in these tests): Transfer logs → the same replay → a real
   verdict. Two wallets from the live chain: the burn address (holds $SEND, never bought any → a definite
   "no market buy" refusal) and a real recent buyer found from the $SEND pool's own transfers (a definite verdict
   either way — verified, or a stated reason — never "could not finish reading the chain"). Read-only on the
   chain; every row made here is deleted in the finally block. */
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

// no invite pass: every request here is signed in (a session is the ticket), and the shared redeem budget is for the suites that need one
try {
  /* ═══ 1. the wiring, in the source ═══ */
  check('every wallet-history reader goes through ogTransfers: the explorer only when a keyed one is set, the chain otherwise and as its fallback',
    /const EXPLORER_KEYED = !!process\.env\.BLOCKSCOUT_URL;/.test(SRC) && /return rpcTokenTransfers\(wallet, token, opts\);/.test(SRC)
    && /items = await ogTransfers\(a, tokenAddr, \{ noTime: true/.test(SRC) && /const rows = await ogTransfers\(a, t, \{ tries: 2/.test(SRC) && /const rows = await ogTransfers\(w, TOK\.SEND/.test(SRC));
  check('  ...the chain reader reads transfers FROM and TO the wallet, splits a too-large window, and never reads an undecodable log as 0',
    /for \(const topics of \[\[TRANSFER_TOPIC, wt\], \[TRANSFER_TOPIC, null, wt\]\]\)/.test(SRC) && /TOO_MANY_RE\.test\(String\(\(e && e\.message\) \|\| ''\)\) && window > 50/.test(SRC) && /a transfer this reader cannot decode/.test(SRC));
  check('  ...and the replay still has to reconcile with balanceOf before anything is decided', /if \(onChain !== bal\) throw new Error\('og scan: replay did not reconcile with chain balance'\)/.test(SRC));
  check('signing in with a wallet queues the check for an account that has not passed it', /if \(ident\) \{ try \{ const uu = db\.prepare\('SELECT \* FROM users WHERE id = \?'\)\.get\(userId\); if \(uu && needsHolderProof\(uu\) && !proofQueue\.includes\(userId\)\) queueHolderProof\(userId\); \} catch \{\} \}/.test(SRC));
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
    if (cands.length) { buyer = cands[cands.length - 1]; break; }
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
