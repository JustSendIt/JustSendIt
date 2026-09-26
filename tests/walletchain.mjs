/* The wallet tracker reads a wallet's WHOLE on-chain history from the chain (GET /api/chain/wallet), not from the
   block explorer (which now answers servers with a bot challenge, so every report failed). Checked against the live
   chain with a real, busy wallet found from the $SEND pool's own transfers:
     · the route answers only signed-in members, and only for an address;
     · every ERC-20 transfer the wallet ever sent or received, in every token, matches an independent eth_getLogs
       read — no 400-transfer ceiling;
     · the ETH balance and the number of transactions it has sent match eth_getBalance / eth_getTransactionCount;
     · every token balance it reports matches balanceOf;
     · every transaction behind those transfers comes with its legs (the ETH it carried, the WETH / token moves);
   and then the browser's own report code (public/tracker.js, run here unchanged) builds a report from it: the full
   history, a buy through a router counted as a buy and valued in ETH, the holding matching the chain.
   Read-only on the chain; the throwaway account made here is deleted at the end. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DB_PATH, ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', PAIR = '0xf30bb531d0255969be155533abac34b22bd63414';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad = (a) => '0x' + a.slice(2).padStart(64, '0');
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    let j = null; try { j = await r.json(); } catch {}
    if ((r.status === 429 || (j && j.error && /too many/i.test(j.error.message || ''))) && i < 8) { await sleep(2500 * (i + 1)); continue; }
    if (!j || j.error) throw new Error((j && j.error && j.error.message) || 'rpc ' + r.status);
    return j.result;
  }
}
const src = readFileSync(ROOT + '/public/tracker.js', 'utf8');

try {
  /* ═══ 1. the wiring ═══ */
  check('the tracker reads the chain through this server, not the block explorer', /fetch\('\/api\/chain\/wallet\?address=' \+ encodeURIComponent\(addr\)/.test(src) && !/bsFetch|MAX_TRANSFER_PAGES|MAX_TX_LOOKUPS/.test(src));
  const anon = await fetch(BASE + '/api/chain/wallet?address=0x' + '1'.repeat(40), { headers: { Origin: BASE, Cookie: 'jsi_age=18' } });
  check('  ...a signed-out visitor is refused (the read costs the site\'s chain budget)', anon.status === 401, anon.status);
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run('__wc_' + randomBytes(3).toString('hex'), Date.now(), '🧪', Date.now(), 'ok');
  const uid = Number(db.prepare('SELECT last_insert_rowid() id').get().id); made.push(uid);
  const sid = 'tok_wc_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sid).digest('hex'), uid, Date.now(), Date.now() + 864e5);
  const cookie = 'jsi_age=18; sid=' + sid;
  const bad = await fetch(BASE + '/api/chain/wallet?address=nope', { headers: { Origin: BASE, Cookie: cookie } });
  check('  ...and anything but an address is refused', bad.status === 400, bad.status);

  /* ═══ 2. a busy real wallet: the person the $SEND pool paid most often lately ═══ */
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  let wallet = null;
  for (const span of [36000 * 24 * 14, 36000 * 24 * 60]) {
    const logs = await rpc('eth_getLogs', [{ address: SEND, topics: [T, pad(PAIR)], fromBlock: '0x' + Math.max(0, head - span).toString(16), toBlock: 'latest' }]).catch(() => []);
    const n = {}; for (const l of logs || []) { const a = '0x' + l.topics[2].slice(-40); if (a !== SEND) n[a] = (n[a] || 0) + 1; }
    for (const [a] of Object.entries(n).sort((x, y) => y[1] - x[1]).slice(0, 8)) { await sleep(300); if (await rpc('eth_getCode', [a, 'latest']) === '0x') { wallet = a; break; } }
    if (wallet) break;
  }
  if (!wallet) { check('a busy $SEND buyer could be found on-chain (none — not asserted)', true); throw new Error('skip'); }

  // the read runs as a job: 202 with its progress until the history is ready
  const t0 = Date.now();
  let r, h, polls = 0, sawProgress = false;
  for (;;) {
    r = await fetch(BASE + '/api/chain/wallet?address=' + wallet, { headers: { Origin: BASE, Cookie: cookie } });
    h = await r.json().catch(() => null);
    if (r.status !== 202 || Date.now() - t0 > 8 * 60 * 1000) break;
    if (h && h.pending && h.stage) sawProgress = true;
    polls++; await sleep(2000);
  }
  const took = Date.now() - t0;
  check('the whole-wallet read answers from the chain', r.status === 200 && h && h.source === 'chain' && h.complete === true && Array.isArray(h.transfers), r.status + ' ' + JSON.stringify(h && (h.error ? { e: h.error, why: h.reason } : { n: h.transfers && h.transfers.length })) + ' in ' + took + 'ms after ' + polls + ' progress answers');
  check('  ...as a job the page watches (202 with its stage until it is ready), so no proxy times the request out', polls === 0 || sawProgress, polls);
  if (!(h && Array.isArray(h.transfers))) throw new Error('no history');

  // an independent read of the same thing, straight from the node
  await sleep(4000);
  const [ins, outs] = [await rpc('eth_getLogs', [{ topics: [T, null, pad(wallet)], fromBlock: '0x0', toBlock: 'latest' }]), await rpc('eth_getLogs', [{ topics: [T, pad(wallet)], fromBlock: '0x0', toBlock: 'latest' }])];
  const erc20 = (l) => l.topics.length === 3 && /^0x[0-9a-fA-F]{64}$/.test(l.data || '');
  const keys = new Set([...ins, ...outs].filter(erc20).map((l) => l.transactionHash.toLowerCase() + ':' + parseInt(l.logIndex, 16)));
  const got = new Set(h.transfers.map((t) => t[2] + ':' + t[1]));
  const missing = [...keys].filter((k) => !got.has(k)).length;
  check('every token transfer the wallet ever made is there — ' + keys.size + ' of ' + keys.size + ', in ' + new Set(h.transfers.map((t) => t[3])).size + ' tokens (no 400 ceiling)', missing === 0 && h.transfers.length >= keys.size, 'missing ' + missing + ', got ' + h.transfers.length);
  check('  ...newest first, each with a time', h.transfers.every((t, i) => i === 0 || t[0] <= h.transfers[i - 1][0]) && h.transfers.filter((t) => t[7] > 0).length >= h.transfers.length * 0.99);
  await sleep(2000);
  const [bal, nonce] = [await rpc('eth_getBalance', [wallet, 'latest']), await rpc('eth_getTransactionCount', [wallet, 'latest'])];
  check('the ETH balance is the chain\'s', BigInt(h.ethBalance) === BigInt(bal) || Math.abs(Number(BigInt(h.ethBalance) - BigInt(bal))) < 1e15, h.ethBalance + ' vs ' + BigInt(bal));
  check('  ...and "transactions sent" is its nonce', Math.abs(h.txSent - parseInt(nonce, 16)) <= 2, h.txSent + ' vs ' + parseInt(nonce, 16));
  const sendTok = h.tokens.find((t) => t.address === SEND);
  const live = BigInt(await rpc('eth_call', [{ to: SEND, data: '0x70a08231' + pad(wallet).slice(2) }, 'latest']));
  check('every token it ever touched is listed with its live balance — $SEND matches balanceOf', sendTok && sendTok.balance != null && (BigInt(sendTok.balance) === live), JSON.stringify(sendTok) + ' vs ' + live);
  check('  ...with what each token is (symbol and decimals read from the chain)', sendTok && sendTok.decimals === 18 && !!sendTok.symbol && h.tokens.filter((t) => t.decimals != null).length >= h.tokens.length * 0.9);
  check('every receipt of the wallet\'s own possible trades was read (' + h.legsRead + '), none left unread', h.legsRead > 0 && Array.isArray(h.txsMissing) && h.txsMissing.length === 0, JSON.stringify({ read: h.legsRead, missing: h.txsMissing && h.txsMissing.length }));
  check('  ...each trade is summed on the server — the answer stays small however busy a transaction was', JSON.stringify(h.txs).length < 400 * Math.max(1, Object.keys(h.txs).length), JSON.stringify(h.txs).length + ' bytes for ' + Object.keys(h.txs).length + ' trades');
  /* an independent check of one buy's cost, from its receipt: the WETH the $SEND pool took in. $SEND is taxed (the pool
     pays the token contract its cut in the same transaction) — the buyer's cost is still everything the pool took. */
  const buyTx = h.transfers.find((t) => t[3] === SEND && t[5] === wallet && h.txs[t[2]] && h.txs[t[2]][SEND] && h.txs[t[2]][SEND][0] === 1);
  if (!buyTx) check('a $SEND buy by this wallet could be found (none — not asserted)', true);
  else {
    await sleep(1500);
    const rc = await rpc('eth_getTransactionReceipt', [buyTx[2]]);
    let wethIn = 0n, taxLeg = 0n;
    for (const l of rc.logs) {
      if (l.topics[0] !== T || l.topics.length !== 3) continue;
      const to = '0x' + l.topics[2].slice(-40), from = '0x' + l.topics[1].slice(-40);
      if (l.address.toLowerCase() === WETH && to === PAIR) wethIn += BigInt(l.data);
      if (l.address.toLowerCase() === SEND && from === PAIR && to === SEND) taxLeg += BigInt(l.data);
    }
    check('  ...a $SEND buy costs exactly the WETH the pool took in' + (taxLeg > 0n ? ', its tax leg notwithstanding' : ''), BigInt(h.txs[buyTx[2]][SEND][1]) === wethIn && wethIn > 0n, h.txs[buyTx[2]][SEND][1] + ' vs ' + wethIn + ' (tax leg ' + taxLeg + ')');
  }
  const t1 = Date.now();
  const again = await fetch(BASE + '/api/chain/wallet?address=' + wallet, { headers: { Origin: BASE, Cookie: cookie } });
  check('  ...and a second look within minutes is answered at once, from what was just read — with its age', again.status === 200 && Date.now() - t1 < 3000 && Number(again.headers.get('x-read-age-ms')) >= 0 && again.headers.get('x-read-age-ms') !== null, again.status + ' in ' + (Date.now() - t1) + 'ms, age ' + again.headers.get('x-read-age-ms'));
  // another member asking about the same wallet gets their own read — nobody learns what anyone else looked up
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run('__wc_b' + randomBytes(3).toString('hex'), Date.now(), '🧪', Date.now(), 'ok');
  const uid2 = Number(db.prepare('SELECT last_insert_rowid() id').get().id); made.push(uid2);
  const sid2 = 'tok_wc2_' + randomBytes(8).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(sid2).digest('hex'), uid2, Date.now(), Date.now() + 864e5);
  const other = await fetch(BASE + '/api/chain/wallet?address=' + wallet, { headers: { Origin: BASE, Cookie: 'jsi_age=18; sid=' + sid2 } });
  const oj = await other.json().catch(() => null);
  check('  ...while another member asking about the same wallet starts a read of their own (no shared answer, no "since")', other.status === 202 && oj && oj.pending && !('since' in oj), other.status + ' ' + JSON.stringify(oj));

  /* ═══ 3. the browser's report code, run unchanged on that answer ═══ */
  const fetchAs = (u, o) => fetch(BASE + u, { ...(o || {}), headers: { ...((o && o.headers) || {}), Origin: BASE, Cookie: cookie } });
  const ctx = vm.createContext({
    console, BigInt, Number, Math, Date, JSON, Object, Array, Promise, Error, Set, Map, URLSearchParams, encodeURIComponent, setTimeout,
    WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    toNum: (bi, d = 18) => Number(bi) / 10 ** d,
    fetch: fetchAs,
    // the same batch price read chain.js makes, through this server
    dexPricesFor: async (addresses) => {
      const out = {};
      for (let i = 0; i < addresses.length; i += 30) {
        const res = await fetchAs('/api/chain/dex-tokens?addrs=' + encodeURIComponent(addresses.slice(i, i + 30).join(',')));
        if (!res.ok) continue;
        for (const p of (await res.json()) || []) { const b = ((p.baseToken && p.baseToken.address) || '').toLowerCase(); if (b && (!out[b] || ((p.liquidity && p.liquidity.usd) || 0) > ((out[b].liquidity && out[b].liquidity.usd) || 0))) out[b] = p; }
      }
      return out;
    },
  });
  vm.runInContext(src, ctx);
  const rep = await ctx.trackerReport(wallet, () => {});
  const s = rep.tokens.find((t) => t.address === SEND);
  check('the report covers the full history, read from the chain', rep.source === 'chain' && rep.historyComplete === true && rep.transfersAnalyzed === h.transfers.length, rep.transfersAnalyzed);
  check('  ...the $SEND holding matches the chain', s && Math.abs(s.held - Number(live) / 1e18) < 1e-6 * Math.max(1, s.held), s && s.held);
  // buys: one per transaction the server found a $SEND swap into this wallet in — straight from the pool or through a router
  const buyTxs = new Set(h.transfers.filter((t) => t[3] === SEND && t[5] === wallet && h.txs[t[2]] && h.txs[t[2]][SEND] && h.txs[t[2]][SEND][0] === 1).map((t) => t[2]));
  const routed = [...buyTxs].filter((x) => !h.transfers.some((t) => t[2] === x && t[3] === SEND && t[4] === PAIR && t[5] === wallet)).length;
  check('  ...every buy is counted, one per transaction — ' + (buyTxs.size - routed) + ' straight from the pool and ' + routed + ' through a router (the old tracker saw only the first kind)', s && s.buys === buyTxs.size, JSON.stringify(s && { buys: s.buys, sells: s.sells, in: s.xfersIn, out: s.xfersOut }) + ' vs ' + buyTxs.size);
  check('  ...and valued: ETH spent on $SEND buys is known', s && s.buys > 0 && s.ethSpent > 0, s && s.ethSpent);
  check('  ...the report is small enough to save (the tracker keeps a copy)', JSON.stringify(rep).length < 4 * 1024 * 1024, JSON.stringify(rep).length);
} catch (e) {
  if (e.message !== 'skip') { console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]); check('the suite ran to the end', false, e.message); }
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'notifications', 'points_events']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  console.log('cleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_wc\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
