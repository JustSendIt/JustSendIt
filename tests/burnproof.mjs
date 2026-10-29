/* Proving a wallet by a burn (owner, 2026-10-20): "If a wallet can not sign or a user does not want to sign, a user can do
   a proof of ownership by sending a small amount of $Send to the burn address … no minimum on the amount, can just be dust.
   Then the site can go look on chain to confirm the transaction was actually made by the wallet … Allow a one hour time
   limit … otherwise the process restarts. Enable this for all wallets across the site … If a user does use this option
   also have them setup an email an a password" — and "add the GmGn wallet and divert people to this new option … if
   someone's wallet is not on the site list of wallets".

   1. The shape of it, in the source: the rules the watcher applies, the wallets it never lets sign for the account, the
      places a burn proof is kept and scrubbed, the picker's GMGN and "not listed" rows, and that nothing on the client
      builds or sends the burn.
   2. A real server of its own, against a FAKE chain node this suite runs (so it can mine burns, refuse reads and stamp
      blocks), with the hour shortened to four seconds: what links a wallet (a burn of ANY amount — owner, 2026-10-22:
      "users can burn as much or as little as they want" — dust, a big one, under a transfer tax), and every burn that must
      not — nothing sent, sent by someone else's allowance or a relayer, from another wallet, to another address, another
      coin, before the window (a lagging node included), after it, while another account's window was open on the same
      wallet, or for a wallet already on another account — plus a smart account's UserOperation, a chain that will not
      answer past the deadline (never "no burn"), a flood of other wallets' burns, the email-and-password rule, "confirm
      it's you", ended sessions, one window per account, the daily cap, the Data API total and account deletion. Then ETH
      (owner, 2026-10-21: "send with a dust amount of $Send or Ethereum"): any amount, found by the wallet's transaction
      count and the blocks read whole, and every ETH send that must not count — another wallet's, to another address, one
      that failed, a bridge deposit — a contract wallet offered $SEND alone, an EIP-7702 account offered both, and a burn
      landed while the chain could not be read, a thousand blocks back, that still links once it can. Everything lives
      in a temporary directory, deleted. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT, SERVER_JS } from './_paths.mjs';
const KEYLIB = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'keys.js'));

const SRC = fs.readFileSync(SERVER_JS, 'utf8');
const KEYS = fs.readFileSync(path.join(ROOT, 'lib', 'keys.js'), 'utf8');
const PUB = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══ 1. the shape of it ═══ */
{
  const BP = PUB('burnproof.js'), WAL = PUB('wallet.js'), AUTH = PUB('auth.js'), CSS = PUB('styles.css'), INV = PUB('invite.js'), PROF = PUB('profile.js'), PROFH = PUB('profile.html');
  const code = strip(BP) + strip(WAL) + strip(AUTH);
  check('nothing on the client builds or sends the burn: no eth_sendTransaction, no prefilled ethereum: transfer link', !/eth_sendTransaction|ethereum:/.test(code));
  check('the watcher takes a transfer of more than nothing, of $SEND, sent by the wallet itself, in a later block, stamped inside the window',
    /if \(!\(v > 0n\)\) return;/.test(SRC) && /String\(l\.address \|\| ''\)\.toLowerCase\(\) !== TOK\.SEND/.test(SRC) && /if \(!sentBy\(entry, from\)\) \{[\s\S]{0,500}?return;\n  \}/.test(SRC)
    && /status = 'open' AND addr_idx = \? AND from_block < \?/.test(SRC) && /&& ms <= r\.deadline \+ BURN_PROOF_SKEW_MS\);/.test(SRC));
  check('  ...of ANY amount (owner, 2026-10-22: "users can burn as much or as little as they want"): no amount is picked, asked for or compared',
    !/burnProofPick|burnProofScale|want\(r\)/.test(SRC) && /await burnProofSettle\(inWin, from, String\(l\.transactionHash\)\.toLowerCase\(\)\);/.test(SRC));
  check('  ...one burn proves one account: with windows from more than one account open on the wallet, it links none of them, and tells them', /async function burnProofSettle\(rows, from, tx\) \{\n  if \(new Set\(rows\.map\(\(r\) => r\.user_id\)\)\.size > 1\) \{/.test(SRC)
    && /landed while another account was proving the same wallet, so it linked neither/.test(SRC));
  check('  ...an hour still open when the server starts is read again from its start (the rule it is read by may have changed)', /UPDATE burn_proofs SET scanned_to = from_block, amount_seen_enc = NULL WHERE status = 'open' AND scanned_to > from_block/.test(SRC));
  check('  ...a lagging head cannot let an earlier burn in: at the opening only a block stamp\'s rounding is forgiven, not the deadline\'s two minutes',
    /const BURN_PROOF_OPEN_SKEW_MS = Math\.min\(BURN_PROOF_SKEW_MS, 2000\);/.test(SRC) && /ms >= Math\.floor\(r\.opened_at \/ 1000\) \* 1000 - BURN_PROOF_OPEN_SKEW_MS/.test(SRC));
  check('  ...each wallet is read on its own, filtered on both ends, so nobody else\'s burns can stall a window', /transferLogWalk\(TOK\.SEND, \[\[TRANSFER_TOPIC, addrTopic\(addr\), addrTopic\(DEAD_ADDR\)\]\]/.test(SRC));
  check('  ...a window cancelled while its burn was being read links nothing', /const cur = db\.prepare\('SELECT status FROM burn_proofs WHERE id = \?'\)\.get\(r\.id\);\n  if \(!cur \|\| cur\.status !== 'open'\) return;/.test(SRC) && /if \(!burnProofEnd\(r, 'linked', null, tx\)\) return;\n  await linkWalletTo\(u, address, 'burn'\);/.test(SRC));
  check('  ...ending the other sessions, or changing the password, calls off the windows those sessions opened', (SRC.match(/burnProofsOff\(me, '/g) || []).length === 2 && /opened_by IS NULL OR opened_by <> \?/.test(SRC));
  check('  ...a wallet linked by its signature while its burn proof ran ends that hour as linked, not "expired"', /reason = 'linked by its signature instead'/.test(SRC));
  check('  ...a wallet whose burns are too many to read ends its own windows, saying so, instead of holding everyone\'s status', /history longer than the chain read budget\|history too dense/.test(SRC) && /burnProofReads\.set\(addr, \{ okAt: now\(\), failing: false \}\)/.test(SRC));
  check('  ...and the "prove it by a burn" hint only follows a refusal where a burn can stand in', /explain\(e, opts\)/.test(PUB('wallet.js')) && (strip(PUB('auth.js')).match(/WALLET\.sign\(provider, address, message, \{ burn: true \}\)/g) || []).length === 2);
  check('  ...and a window ends unproved only once the chain has been read past its deadline', /status = 'open' AND scanned_to >= \? AND \(eth_block IS NULL OR eth_none IS NOT NULL OR eth_block >= \?\) AND deadline < \?/.test(SRC) && /if \(!\(headMs > r\.deadline \+ BURN_PROOF_SKEW_MS\)\) continue;/.test(SRC) && /burnProofEnd\(r, 'expired', r\.foreign_seen/.test(SRC));
  check('a wallet linked either way goes through the one link helper (signature and burn)', (SRC.match(/await linkWalletTo\(/g) || []).length === 2 && /await linkWalletTo\(me, address, 'signature'\)/.test(SRC) && /await linkWalletTo\(u, address, 'burn'\)/.test(SRC));
  check('a burn-proved wallet is marked, never vouches for the account, and is never offered as the two-factor key',
    /ALTER TABLE identities ADD COLUMN proof TEXT/.test(SRC) && /AND \(proof IS NULL OR proof <> 'burn'\)/.test(SRC.slice(SRC.indexOf('function vouchingWallets'), SRC.indexOf('function onlyProofIsSignIn')))
    && /byBurn: r\.proof === 'burn'/.test(SRC) && /const canPick = me\.twofa === 'wallet' && !key && !w\.byBurn;/.test(PROF) && /🔥 Proved by burn/.test(PROF));
  check('starting a window: email + password first, then "confirm it\'s you", before the address is looked up',
    (() => { const r = SRC.slice(SRC.indexOf("p === '/api/wallet/burnproof/start'"), SRC.indexOf("p === '/api/wallet/burnproof/cancel'"));
      const a = r.indexOf('hasEmailAndPassword(me.id)'), b = r.indexOf('ownershipRefusal(me,'), c = r.indexOf("findIdentity('wallet', address)");
      return a > 0 && b > a && c > b; })());
  check('a burn proof is kept encrypted and indexed under the key registry, scrubbed from every backup, and deleted with the account',
    /\['burn_proofs', 'addr_enc'\], \['burn_proofs', 'tx_enc'\]/.test(KEYS) && /\{ t: 'burn_proofs', c: 'addr_idx' \}/.test(KEYS)
    && SRC.slice(SRC.indexOf('const BACKUP_SCRUB = ['), SRC.indexOf('function scrubBackup(')).includes("'DELETE FROM burn_proofs'") && /'wallet_hist', 'burn_proofs'\]\)/.test(SRC));   // anywhere in the scrub list: later entries may follow it
  check('the picker offers GMGN and "my wallet isn\'t listed" — only where a wallet is being proved (and the home "Get a wallet" guide never offers GMGN)',
    /\{ key: 'gmgn', name: 'GMGN', [^}]*burn: true/.test(WAL) && /if \(pickOpts\.burn\) \{/.test(WAL) && /My wallet isn’t listed, or can’t sign/.test(WAL)
    && /!detected\.has\(k\.key\) && \(!k\.burn \|\| pickOpts\.burn\)/.test(WAL));
  check('  ...the sign-in and link doors ask for it; "confirm it\'s you" and two-factor (a particular wallet\'s signature) do not',
    (strip(AUTH).match(/WALLET\.connect\(\{ burn: true \}\)/g) || []).length === 2 && (strip(AUTH).match(/WALLET\.connect\(\{ choose: true \}\)/g) || []).length === 2);
  check('the burn proof is offered in the sign-in panel, Settings → Security, the connected-wallet card and the participation check',
    /id="btn-burn-alt"/.test(AUTH) && /id="burn-wallet-btn"/.test(PROFH) && /id="cw-burn"/.test(PROF) && /id="inv-proof-burn"/.test(INV) && /AUTH\.openBurnProof\(\{ from: 'proof' \}\)/.test(INV));
  const z = (sel) => { const m = new RegExp(sel.replace(/[.#]/g, (c) => '\\' + c) + ' \\{[^}]*z-index: (\\d+)').exec(CSS); return m ? +m[1] : NaN; };
  check('the panel sits above the wallet picker and below the toasts and "confirm it\'s you" (which opens over it when the server asks)', z('.wc-overlay') < z('.bp-overlay') && z('.bp-overlay') < z('#toast-zone') && z('.bp-overlay') < 9500, z('.wc-overlay') + ' / ' + z('.bp-overlay') + ' / ' + z('#toast-zone'));
  check('the panel never signs anyone in: an account without an email and a password is sent to make one first', /A burn can’t sign you in/.test(BP) && /data-form="emailpw"/.test(BP) && /'\/api\/account\/email'/.test(BP));
  check('  ...and it says the burn is destroyed for good, costs gas, is made by the member, and goes only to the burn address',
    /destroyed for good/.test(BP) && /costs a little ETH for gas/.test(BP) && /You make the transaction yourself/.test(BP) && /Only ever to the burn address shown here\.<\/b> Any amount counts/.test(BP)
    && /Send <b>any amount<\/b> of \$SEND/.test(BP) && !/exact amount/.test(BP));
  check('  ...and never tells anyone to buy', !/\bbuy (some|more|\$SEND)|purchase/i.test(BP));
  check('the terms and the privacy policy say what it is, and their versions moved', /\(g\) Proving a wallet by a burn\./.test(PUB('terms.html')) && /Version 2026-10-23 ·/.test(PUB('terms.html'))
    && /A wallet that cannot sign can be linked instead by a burn/.test(PUB('privacy.html')) && /Version 2026-10-29 ·/.test(PUB('privacy.html')));
  check('  ...and both say ETH counts too: straight from the wallet\'s own address, a contract wallet offered $SEND only, the transaction count kept',
    /you send any amount of \$SEND — or, for a wallet that sends its own transactions, of ETH — from that wallet/.test(PUB('terms.html')) && /Any amount above nothing counts, as much or as little as you choose/.test(PUB('terms.html'))
    && /if windows from more than one account are open on the same wallet when its burn lands, the burn cannot show whose it is, so it links none of them/.test(PUB('terms.html')) && !/exact (dust )?amount/.test(PUB('terms.html')) && /a wallet with contract code on Robinhood Chain \(other than an EIP-7702 delegation, which still sends its own transactions\) is offered \$SEND only, as is a wallet that sent more than ten transactions/.test(PUB('terms.html'))
    && /burning \$SEND or ETH to prove a wallet are not payments to us/.test(PUB('terms.html')) && !/exact amounts it asked for/.test(PUB('privacy.html'))
    && /an ETH proof burn counts toward neither/.test(PUB('terms.html')) && /An ETH send leaves no log, so to find one we read the wallet's public transaction count/.test(PUB('privacy.html')));
  check('ETH (owner, 2026-10-21): a successful send of any amount the wallet itself made straight to 0x…dEaD, in a later block stamped inside the window',
    /if \(String\(t\.from \|\| ''\)\.toLowerCase\(\) !== addr\) continue;/.test(SRC) && /if \(String\(t\.to \|\| ''\)\.toLowerCase\(\) !== DEAD_ADDR \|\| !\(v > 0n\)\) continue;/.test(SRC)
    && /if \(rc\.status === '0x1'\) await burnProofMatchEth\(addr, t\.hash, v, nums\[i\], ms\);/.test(SRC) && /AND addr_idx = \? AND from_block < \? AND eth_block IS NOT NULL AND eth_none IS NULL/.test(SRC)
    && /await burnProofSettle\(inWin, from, String\(hash\)\.toLowerCase\(\)\);/.test(SRC));
  check('  ...found by the wallet\'s transaction count at the head; when it moved, the blocks holding its sends are found by the count in between and read whole (only transactions it signed counted), a bounded stretch a pass',
    /rpc\('eth_getTransactionCount', \[addr, burnHex\(head\)\]\)/.test(SRC) && /const end = Math\.min\(top, b0 \+ BURN_ETH_SCAN_STEP\);/.test(SRC) && /if \(nHead === n0\) return move\(head, nHead\);/.test(SRC)
    && /const nums = known \? await burnEthSendBlocks\(addr, b0, n0, end, nEnd\) : burnRange\(b0, end\);/.test(SRC) && /\['eth_getBlockByNumber', \[burnHex\(b\), true\]\]/.test(SRC)
    && /const k = Math\.min\(24, hi - lo - 1\)/.test(SRC) && /if \(!\(ty >= 0 && ty <= 4\)\) continue;/.test(SRC));
  check('  ...a window ends unproved only once its ETH side has been read through the head too', /AND scanned_to >= \? AND \(eth_block IS NULL OR eth_none IS NOT NULL OR eth_block >= \?\) AND deadline < \?/.test(SRC));
  check('  ...and that read never goes past the last block stamped inside the hour, never waits out a refusal past a minute, and a busy wallet is not offered ETH',
    /const top = \(await chainBlockTime\(head\)\) > limitMs \? await burnLastBlockBy\(b0, head, limitMs\) : head;/.test(SRC) && /if \(end === top && top < head\) return move\(head, nHead\);/.test(SRC)
    && /const burnPaced = \(calls\) => pacedBatchAll\(calls, null, requestThrottleGuard\);/.test(SRC) && !/pacedBatchAll\(/.test(SRC.slice(SRC.indexOf('async function burnEthSendBlocks'), SRC.indexOf('async function burnProofTick')))
    && /nonce0 - parseInt\(nonceAgo, 16\) > BURN_ETH_BUSY \? 'busy' : null;/.test(SRC) && /p\.ethNone === 'busy'/.test(BP));
  check('  ...the wallet\'s transaction count where its ETH sends were last read is kept encrypted', /\['burn_proofs', 'eth_amount_enc'\], \['burn_proofs', 'eth_nonce_enc'\]/.test(KEYS));
  check('  ...a wallet with code is offered $SEND only (its ETH moves through the contract), an EIP-7702 account both, and the panel says which and why',
    /const ethNone = !\(code === '0x' \|\| \/\^0xef0100\[0-9a-f\]\{40\}\$\/i\.test\(code\)\) \? 'contract'/.test(SRC) && /\|\| code == null\) return bad\(res, 'the chain isn’t answering right now/.test(SRC)
    && /p\.ethNone === 'contract'/.test(BP) && /a Safe or multisig transaction that an owner key executes doesn’t count/.test(BP) && /This hour started before ETH could be used/.test(BP)
    && /ETH counts only when it goes straight from the wallet to the burn address/.test(BP));
}

/* ═══ 2. a real server, a fake chain ═══ */
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', GWC = '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USEROP = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f', ENTRY = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const DEAD = '0x000000000000000000000000000000000000dead';
const topic = (a) => '0x' + '0'.repeat(24) + a.toLowerCase().slice(2);
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const wallet = () => '0x' + randomBytes(20).toString('hex');
const hx = (n) => '0x' + n.toString(16);
const nowSec = () => Math.floor(Date.now() / 1000);

const chain = { head: 5000, lag: 0, ts: new Map([[5000, nowSec()]]), logs: [], receipts: new Map(), down: false, li: 0, asked: 0, txs: new Map(), code: new Map(), stateDepth: Infinity, fullReads: [], codeFails: false };
// every transaction in a block, as eth_getBlockByNumber(…, true) gives it: what a wallet's transaction count counts
function addTx(b, t) { if (!chain.txs.has(b)) chain.txs.set(b, []); chain.txs.get(b).push(t); }
const nonceAt = (a, n) => { let c = 0; for (const [b, ts] of chain.txs) if (b <= n) for (const t of ts) if (t.from === a && t.type !== '0x64') c++; return c; };   // a deposit (0x64) spends no count
/* ETH sent by `from` to `to` in a new block (or `block`): a plain transaction, no log. `ok: false` is one that reverted. */
function ethSend({ from, to = DEAD, value = 1n, block, ok = true, type = '0x2' }) {
  const b = block || mine(), hash = '0x' + randomBytes(32).toString('hex');
  addTx(b, { hash, type, from: from.toLowerCase(), to: to.toLowerCase(), value: hx(value), blockNumber: hx(b) });
  chain.receipts.set(hash, { transactionHash: hash, from: from.toLowerCase(), to: to.toLowerCase(), status: ok ? '0x1' : '0x0', blockNumber: hx(b), logs: [] });
  return hash;
}
function mine() { chain.head++; chain.ts.set(chain.head, nowSec()); return chain.head; }
/* A transfer of `token` from `from` to `to`, in a new block. `sender` is who sent the TRANSACTION (receipt.from) — the
   wallet itself unless an allowance spender or a bundler did; `op` adds a successful ERC-4337 UserOperation for that sender. */
function transfer({ from, to = DEAD, value = 1n, token = SEND, sender, op, block, fee }) {
  const b = block || mine(), tx = '0x' + randomBytes(32).toString('hex');
  const log = { address: token, topics: [TRANSFER, topic(from), topic(to)], data: '0x' + word(value), blockNumber: hx(b), transactionHash: tx, logIndex: hx(chain.li++), removed: false };
  const logs = [];
  // a transfer tax: its cut to the token contract comes first, the rest reaches 0x…dEaD
  if (fee) { const f = { address: token, topics: [TRANSFER, topic(from), topic(token)], data: '0x' + word(fee), blockNumber: hx(b), transactionHash: tx, logIndex: hx(chain.li++), removed: false }; chain.logs.push(f); logs.push(f); }
  chain.logs.push(log);
  logs.push(log);
  if (op) logs.push({ address: ENTRY, topics: [USEROP, '0x' + '11'.repeat(32), topic(op), topic('0x' + '00'.repeat(20))], data: '0x' + word(7) + word(1) + word(0) + word(0), blockNumber: hx(b), transactionHash: tx, logIndex: hx(chain.li++), removed: false });
  chain.receipts.set(tx, { transactionHash: tx, from: String(sender || from).toLowerCase(), to: token, status: '0x1', blockNumber: hx(b), logs });
  addTx(b, { hash: tx, from: String(sender || from).toLowerCase(), to: op ? ENTRY : token, value: '0x0', blockNumber: hx(b) });   // the transaction itself: its sender's count goes up
  return tx;
}
function answer(m, p) {
  if (m === 'eth_blockNumber') return hx(chain.head - chain.lag);   // a node behind the chain answers an older head
  if (m === 'eth_chainId') return '0x1237';
  if (m === 'eth_getBlockByNumber') {
    const n = p[0] === 'latest' ? chain.head : parseInt(p[0], 16);
    if (!(n <= chain.head)) return null;
    const txs = chain.txs.get(n) || [];
    if (p[1]) chain.fullReads.push(n);
    return { number: hx(n), timestamp: hx(chain.ts.get(n) || nowSec()), transactions: p[1] ? txs : txs.map((t) => t.hash) };
  }
  if (m === 'eth_getTransactionCount') {
    const n = p[1] === 'latest' || p[1] == null ? chain.head : parseInt(p[1], 16);
    if (!(n <= chain.head)) throw new Error('header not found');
    if (chain.head - n > chain.stateDepth) throw new Error('historical state ' + randomBytes(32).toString('hex') + ' is not available');   // the node keeps recent state only
    return hx(nonceAt(String(p[0]).toLowerCase(), n));
  }
  if (m === 'eth_getLogs') {
    const q = p[0] || {}, from = parseInt(q.fromBlock, 16), to = q.toBlock === 'latest' || q.toBlock == null ? chain.head : parseInt(q.toBlock, 16);
    const addr = q.address ? [].concat(q.address).map((a) => a.toLowerCase()) : null, tp = q.topics || [];
    return chain.logs.filter((l) => {
      const b = parseInt(l.blockNumber, 16);
      if (b < from || b > to || (addr && !addr.includes(l.address))) return false;
      for (let i = 0; i < tp.length; i++) { if (tp[i] == null) continue; if (![].concat(tp[i]).map((x) => x.toLowerCase()).includes(String(l.topics[i] || '').toLowerCase())) return false; }
      return true;
    });
  }
  if (m === 'eth_getTransactionReceipt') return chain.receipts.get(p[0]) || null;
  if (m === 'eth_call') { if (String((p[0] && p[0].data) || '').startsWith('0x70a08231')) return '0x' + word(0); throw new Error('execution reverted'); }
  if (m === 'eth_getCode') { if (chain.codeFails) throw new Error('internal error'); return chain.code.get(String(p[0]).toLowerCase()) || '0x'; }
  throw new Error('the method ' + m + ' does not exist');
}
const node = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  if (chain.down) { res.writeHead(500); res.end('the node is down'); return; }
  let j; try { j = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
  const one = (q) => { chain.asked++; try { return { jsonrpc: '2.0', id: q.id, result: answer(q.method, q.params || []) }; } catch (e) { return { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: e.message } }; } };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
});
await new Promise((ok) => node.listen(0, '127.0.0.1', ok));
const miner = setInterval(mine, 200);   // the head moves on its own, like a real chain

async function freePort() {
  for (;;) {
    const p = await new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, () => { const port = s.address().port; s.close(() => res(port)); }); });
    if (p !== 8642) return p;
  }
}
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-burn-'));
const DATA = path.join(T, 'data');
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true, mode: 0o700 });
const DATA_KEY = randomBytes(32);
fs.writeFileSync(path.join(DATA, '.data_key'), DATA_KEY.toString('hex'), { mode: 0o600 });
const KK = KEYLIB.Keys.legacy(DATA_KEY);   // the same key the suite's server reads: rows this suite plants are ones it can open
const PORT = await freePort(), BASE = 'http://localhost:' + PORT, HOUR = 4000, SKEW = 1500;
const ENV = { ...process.env, PORT: String(PORT), JSI_DATA_DIR: DATA, DATA_DIR: DATA, BASE_URL: BASE, NODE_ENV: 'test', SEED_INVITE_CODE: '12345', TOS_GATE: '1',
  TRUST_PROXY: '1', TRUST_PROXY_FROM: 'loopback', SEED_CODES_OPEN: '1', ADMIN_USER_IDS: '', RPC_URL: 'http://127.0.0.1:' + node.address().port + '/',
  DATA_KEY: '', DATA_KEY_FILE: '', BACKUP_DIR: path.join(T, 'backups'), KEY_ROTATE_EXTRA_DBS: '',
  CHART_SRC_DS_URL: 'http://127.0.0.1:9/', CHART_SRC_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_GT_URL: 'http://127.0.0.1:9/', TOKSEARCH_DS_URL: 'http://127.0.0.1:9/',
  BURN_PROOF_MS: String(HOUR), BURN_PROOF_SKEW_MS: String(SKEW), BURN_PROOF_TICK_MS: '250' };
let proc = null, log = '';
async function start() {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER_JS], { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  proc.done = new Promise((res) => proc.on('exit', res));
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    if (proc.exitCode != null) throw new Error('the server exited: ' + log.slice(-600));
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('the server did not come up: ' + log.slice(-600));
}
const openDb = () => { const d = new DatabaseSync(path.join(DATA, 'app.db')); d.exec('PRAGMA busy_timeout = 5000'); return d; };
const TOS_VERSION = (/const TOS_VERSION = '([^']+)'/.exec(SRC) || [])[1];
function freshPass() {
  const d = openDb(), c = 'BPTEST' + randomBytes(4).toString('hex').toUpperCase(), tok = randomBytes(24).toString('hex');
  d.prepare('INSERT INTO invite_codes (code, owner_id, created_at, used_at, pass, tos_at, tos_version) VALUES (?,NULL,?,?,?,?,?)').run(c, Date.now(), Date.now(), createHash('sha256').update(tok).digest('hex'), Date.now(), TOS_VERSION);
  d.close();
  return 'jsi_pass=' + tok + '; jsi_age=18';
}
let ipN = 0;
async function api(p, { method = 'GET', body, sid, pass, ip } = {}) {
  const headers = { Origin: BASE, 'X-Forwarded-For': ip || '10.77.0.' + (1 + (ipN++ % 200)) };
  if (body) headers['Content-Type'] = 'application/json';
  const ck = [sid ? 'sid=' + sid : '', pass || ''].filter(Boolean).join('; '); if (ck) headers.Cookie = ck;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  const m = /sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  return { status: r.status, j, sid: m ? m[1] : null };
}
let acct = 0;
async function account(opts = {}) {
  const n = 'bp' + (++acct) + randomBytes(2).toString('hex'), email = opts.email || n + '@example.com', password = 'burn-pass-' + n;
  const r = await api('/api/auth/register', { method: 'POST', pass: freshPass(), ip: '10.88.' + acct + '.1', body: { username: n, email, password } });
  if (r.status !== 200 || !r.sid) throw new Error('could not make an account: ' + r.status + ' ' + JSON.stringify(r.j));
  return { name: n, email, password, sid: r.sid, j: r.j };
}
const state = (a) => api('/api/wallet/burnproof', { sid: a.sid });
const open = (a, address) => api('/api/wallet/burnproof/start', { method: 'POST', sid: a.sid, body: { address } });
async function until(fn, ms = 6000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(150); } }
const statusOf = async (a) => ((await state(a)).j.proof || {}).status;
const linkedTo = () => { const d = openDb(); try { const rows = d.prepare("SELECT user_id, proof, identifier_enc FROM identities WHERE type = 'wallet'").all(); return rows; } finally { d.close(); } };

try {
  await start();
  const ANY = (n) => BigInt(n) * 10n ** 15n;   // whatever a test likes to burn: any amount counts (owner, 2026-10-22)
  const nLinked = () => linkedTo().length;

  check('signed out, there is nothing to read', (await api('/api/wallet/burnproof')).status === 401);
  const A = await account();
  const s0 = await state(A);
  check('an account with an email and a password may start one; the page is told the burn address, the coin and the chain',
    s0.status === 200 && s0.j.needEmail === false && s0.j.proof === null && s0.j.burnAddress === '0x000000000000000000000000000000000000dEaD' && s0.j.token === SEND && s0.j.chainId === 4663, JSON.stringify(s0.j));
  for (const [bad, label] of [['0x123', 'a malformed address'], [DEAD, 'the burn address itself'], [SEND, 'the $SEND contract']]) {
    const r = await open(A, bad);
    check('  ...and is refused for ' + label, r.status === 400 && !(r.j && r.j.proof), r.status + ' ' + (r.j && r.j.error));
  }

  // the email-and-password rule: an account whose email was already taken at sign-up has a password and no email
  const P = await account({ email: A.email });
  const pr = await open(P, wallet());
  const ps = await state(P);
  check('an account with a password but no email is sent to add one first (a burn signs nobody in)', pr.status === 400 && pr.j.code === 'need_email' && ps.j.needEmail === true && ps.j.passwordOnly === true, pr.status + ' ' + JSON.stringify(pr.j));
  const pe = await api('/api/account/email/change', { method: 'POST', sid: P.sid, body: { email: P.name + '.real@example.com' } });
  check('  ...and once it has one, it may start', pe.status === 200 && (await state(P)).j.needEmail === false && (await open(P, wallet())).status === 200, pe.status + ' ' + JSON.stringify(pe.j));

  // "confirm it's you": a fresh sign-in is not unlocked
  const li = await api('/api/auth/login', { method: 'POST', body: { email: A.email, password: A.password } });
  const A2 = { ...A, sid: li.sid };
  const lr = await open(A2, wallet());
  check('a session that has not confirmed it\'s you is asked to, before anything is looked up', li.status === 200 && lr.status === 401 && lr.j.code === 'need_verify', li.status + ' / ' + lr.status + ' ' + JSON.stringify(lr.j));
  const vf = await api('/api/auth/verify', { method: 'POST', sid: A2.sid, body: { password: A.password } });
  check('  ...and once it has, the window opens', vf.status === 200 && (await open(A2, wallet())).status === 200, vf.status);

  // the burns that must not prove a wallet, then one of any amount that does
  const X = wallet(), Y = wallet(), Z = wallet();
  const o = await open(A, X);
  const a = o.j.proof || {};
  check('starting a window answers with it open, for this wallet and its time left — and no amount to match: any amount counts, $SEND or ETH',
    o.status === 200 && a.status === 'open' && a.address === X && a.leftMs > 0 && a.leftMs <= HOUR && !('amount' in a) && a.eth === true && a.ethNone === null, JSON.stringify(a));
  check('  ...and the window opened before it (another wallet) was ended: one open window per account', (() => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id = (SELECT id FROM users WHERE username = ?) AND status = 'open'").get(A.name).n; const c = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id = (SELECT id FROM users WHERE username = ?) AND status = 'cancelled' AND reason = 'a new window was started'").get(A.name).n; d.close(); return n === 1 && c >= 1; })());
  check('  ...the wallet is kept encrypted, not as an address the chain could be searched for', (() => { const d = openDb(); const r = d.prepare("SELECT addr_enc FROM burn_proofs WHERE status = 'open' AND user_id = (SELECT id FROM users WHERE username = ?)").get(A.name); d.close(); return r && !r.addr_enc.includes(X.slice(2)); })());
  transfer({ from: X, value: 0n });                     // nothing moved: any contract can log that for anybody
  transfer({ from: X, value: ANY(7), sender: Y });      // moved by an app holding an allowance — not sent by the wallet
  transfer({ from: Z, value: ANY(7) });                 // another wallet's burn
  transfer({ from: X, to: wallet(), value: ANY(7) });   // the wallet's own transfer, not to the burn address
  transfer({ from: X, token: GWC, value: ANY(7) });     // the wallet's own burn, of another coin
  await sleep(1300);
  const sx = await state(A);
  check('none of these proves the wallet: nothing sent, an allowance\'s move, another wallet\'s, to another address, another coin',
    sx.j.proof.status === 'open' && !nLinked(), JSON.stringify(sx.j.proof));
  check('  ...the allowance\'s move is said in the window, so the owner knows why it did not count', sx.j.proof.foreignSeen === true, JSON.stringify(sx.j.proof));
  const tx = transfer({ from: X, value: 1n });          // one wei of $SEND: as little as anybody likes
  const got = await until(async () => (await statusOf(A)) === 'linked', 4000);
  const sA = await state(A);
  check('a burn of any amount — one wei of $SEND here — sent by the wallet itself inside the hour links it', got && sA.j.proof.tx === tx, JSON.stringify(sA.j.proof));
  const me = await api('/api/me', { sid: A.sid });
  const wl = (me.j.user && me.j.user.walletList) || [];
  check('  ...as a wallet of the account, marked as proved by a burn', wl.length === 1 && wl[0].address === X && wl[0].byBurn === true, JSON.stringify(wl));
  check('  ...and the owner is told, in words, how it was linked (and was told when the hour started)', (() => { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(A.name).id; const n = d.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND text LIKE '%by a burn sent from it%'").get(uid).n; const m = d.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND text LIKE '%burn proof was started%'").get(uid).n; d.close(); return n === 1 && m >= 1; })());
  // the link changed the account's wallets, so every session's "confirm it's you" closed (the watcher has no session to spare)
  const again = await open(A, X);
  check('  ...which closes every session\'s "confirm it\'s you" window, as any change to the wallets does', again.status === 401 && again.j.code === 'need_verify', again.status + ' ' + JSON.stringify(again.j));
  await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: A.password } });
  check('  ...and a wallet already on this account is refused a second window', (await open(A, X)).status === 409);

  // as much as anybody likes: a big burn proves it just the same
  const BG = await account(), WBG = wallet(), n1 = nLinked();
  await open(BG, WBG);
  transfer({ from: WBG, value: 5000000n * 10n ** 18n });
  check('  ...and as much as anybody likes: a burn of five million $SEND links it just the same', await until(async () => (await statusOf(BG)) === 'linked', 4000) && nLinked() === n1 + 1);

  // a transfer tax: the coin keeps a cut on the way — still the wallet's own burn
  const TX_ = await account(), WT = wallet();
  await open(TX_, WT);
  transfer({ from: WT, value: ANY(9), fee: ANY(1) });
  check('a burn a transfer tax took a cut of on the way still proves the wallet', await until(async () => (await statusOf(TX_)) === 'linked', 4000));

  // a burn made BEFORE the window opened never counts, and an hour with no burn ends — once the chain says the hour is over
  const B = await account(), V = wallet();
  transfer({ from: V, value: 10n ** 17n });
  await sleep(300);
  await open(B, V);
  await sleep(HOUR - 1200);
  check('a burn made before the window opened does not count', (await statusOf(B)) === 'open');
  const ended = await until(async () => (await statusOf(B)) === 'expired', HOUR + SKEW + 3000);
  const sB = await state(B);
  check('  ...and the hour ends without a link, saying why', ended && /no burn sent by that wallet itself reached the burn address within the hour/.test(sB.j.proof.reason || ''), JSON.stringify(sB.j.proof));

  // the chain will not answer: a window waits rather than ending "no burn" — and a burn inside the hour still counts once it is read
  const C = await account(), W1 = wallet();
  await open(C, W1);
  chain.down = true;
  await sleep(400);
  transfer({ from: W1, value: ANY(3) });             // mined inside the hour, while the site cannot read the chain
  await sleep(HOUR + SKEW + 1200);
  const sC = await state(C);
  check('a chain that will not answer leaves the window open past its deadline — never "no burn arrived"', sC.j.proof.status === 'open' && sC.j.chain.failing === true, JSON.stringify(sC.j));
  check('  ...and a new window can\'t start while the chain is unreadable', (await open(await account(), wallet())).status === 503);
  chain.down = false;
  check('  ...and once it answers, the burn that landed inside the hour links the wallet', await until(async () => (await statusOf(C)) === 'linked', 5000));

  // a burn stamped after the hour, read late, does not count
  const D = await account(), W2 = wallet(), n2 = nLinked();
  await open(D, W2);
  chain.down = true;
  await sleep(HOUR + SKEW + 1200);
  transfer({ from: W2, value: ANY(3) });             // after the deadline
  chain.down = false;
  const lateEnd = await until(async () => (await statusOf(D)) === 'expired', 5000);
  check('a burn stamped after the hour does not count, even read with the hour\'s window still open', lateEnd && nLinked() === n2, (await statusOf(D)) + ' / ' + nLinked());

  // two accounts on one wallet: the burn cannot say whose it is, so it links neither, and both are told
  const S1 = await account(), OWN = await account(), U = wallet(), n3 = nLinked();
  await open(S1, U); await open(OWN, U);
  transfer({ from: U, value: ANY(2) });
  const both = await until(async () => (await statusOf(S1)) === 'refused' && (await statusOf(OWN)) === 'refused', 4000);
  check('with two accounts\' windows open on one wallet, its burn links neither — nobody takes a wallet by watching it while its owner proves it — and both are told',
    both && /another account was proving this same wallet/.test(((await state(OWN)).j.proof || {}).reason || '') && nLinked() === n3
    && (() => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM notifications WHERE text LIKE '%linked neither%'").get().n; d.close(); return n === 2; })());
  // ...and the risk the owner accepted with "any amount" (said in the terms): a window held alone takes any burn the wallet makes in its hour
  const S2 = await account(), U2 = wallet();
  await open(S2, U2);
  transfer({ from: U2, value: ANY(40) });            // the wallet burns for a reason of its own
  check('  ...while a window held alone takes any burn the wallet itself makes in its hour (the risk "any amount" carries, said in the terms)', await until(async () => (await statusOf(S2)) === 'linked', 4000));

  // a wallet already on another account: the window opens (nothing about another account is said before a burn), the burn is refused
  const G = await account(), n4 = nLinked();
  const go = await open(G, X);
  transfer({ from: X, value: ANY(4) });
  const gEnd = await until(async () => (await statusOf(G)) === 'refused', 4000);
  check('a window for a wallet on another account opens like any other (nothing about another account is said before a burn)', go.status === 200, go.status);
  check('  ...and its burn is refused: the wallet stays where it was', gEnd && /already linked to another account/.test(((await state(G)).j.proof || {}).reason || '') && nLinked() === n4);
  // everything X sent to 0x…dEaD counts toward the Data API, like a signed wallet's: an allowance's move, the proof, and G's
  const el = await api('/api/data/eligibility?fresh=1', { sid: A.sid });
  const xBurns = chain.logs.filter((l) => l.address === SEND && l.topics[1] === topic(X) && l.topics[2] === topic(DEAD)).reduce((t, l) => t + BigInt(l.data), 0n);
  check('a wallet proved by a burn counts toward the Data API exactly like a signed one: every burn it sent', el.status === 200 && el.j.burn && el.j.burn.wei === xBurns.toString(), el.status + ' ' + JSON.stringify(el.j && (el.j.burn || el.j.error)) + ' want ' + xBurns);

  // a smart account: its UserOperation, carried by a bundler, is the wallet's own act
  const H = await account(), S = wallet(), BUNDLER = wallet();
  await open(H, S);
  transfer({ from: S, value: ANY(5), sender: BUNDLER, op: S });
  check('a smart account\'s burn, sent as its own ERC-4337 UserOperation by a bundler, proves it', await until(async () => (await statusOf(H)) === 'linked', 4000));

  // a node whose head lags: the window opens below a burn stamped seconds before it opened
  const L = await account(), WL = wallet(), n5 = nLinked();
  await sleep(3500);
  chain.lag = 40;
  const lo = await open(L, WL);
  chain.lag = 0;
  { // a block inside the lag, stamped well before the window opened, carries a burn from the wallet
    let b = 0; for (const [n, t] of chain.ts) if (n > chain.head - 38 && t * 1000 < Date.now() - 4500) b = Math.max(b, n);
    if (b) transfer({ from: WL, value: ANY(2), block: b });
    check('  (the planted burn sits in a block the lagging head let the window open below)', b > 0, b);
  }
  await sleep(1600);
  check('a burn made before the window opened does not count, even when the node\'s head lags behind it', lo.status === 200 && (await statusOf(L)) === 'open' && nLinked() === n5, (await statusOf(L)) + ' / ' + nLinked());
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: L.sid, body: {} });

  // a burn the wallet did not send itself (a Safe's owner key, a relayer): it does not count, and the window says so
  const FA = await account(), WF = wallet(), n6 = nLinked();
  await open(FA, WF);
  transfer({ from: WF, value: ANY(6), sender: wallet() });
  await sleep(1200);
  check('a burn from the wallet, sent by another address, is flagged while the window is open', ((await state(FA)).j.proof || {}).foreignSeen === true);
  const fEnd = await until(async () => (await statusOf(FA)) === 'expired', HOUR + SKEW + 3000);
  check('  ...and the window ends saying what happened, not "no burn arrived"', fEnd && /sent by another address/.test(((await state(FA)).j.proof || {}).reason || '') && nLinked() === n6);

  // the other sessions ended: a window one of them opened goes with them; the caller's own stays
  const R = await account(), WR = wallet(), WR2 = wallet();
  const rl = await api('/api/auth/login', { method: 'POST', body: { email: R.email, password: R.password } });
  await api('/api/auth/verify', { method: 'POST', sid: rl.sid, body: { password: R.password } });
  await open({ ...R, sid: rl.sid }, WR);
  await api('/api/auth/sessions', { method: 'DELETE', sid: R.sid });
  const sR = await state(R);
  check('ending the other sessions calls off a window one of them opened', sR.j.proof.status === 'cancelled' && /ended your other sessions/.test(sR.j.proof.reason || ''), JSON.stringify(sR.j.proof));
  await open(R, WR2);
  await api('/api/auth/sessions', { method: 'DELETE', sid: R.sid });
  check('  ...but not a window this session opened itself', (await statusOf(R)) === 'open');
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: R.sid, body: {} });

  // calling it off
  const I = await account(), Q = wallet(), n7 = nLinked();
  await open(I, Q);
  const cx = await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: I.sid, body: {} });
  transfer({ from: Q, value: ANY(1) });
  await sleep(1000);
  check('a cancelled window ends, and a burn after it links nothing', cx.status === 200 && cx.j.proof.status === 'cancelled' && (await statusOf(I)) === 'cancelled' && nLinked() === n7, nLinked());

  // more burns to 0x…dEaD from other wallets than one read may hold: they never reach a window's read
  const K = await account(), WK = wallet();
  await open(K, WK);
  { const b = mine(); for (let i = 0; i < 21000; i++) chain.logs.push({ address: SEND, topics: [TRANSFER, topic(wallet()), topic(DEAD)], data: '0x' + word(1), blockNumber: hx(b), transactionHash: '0x' + randomBytes(32).toString('hex'), logIndex: hx(i), removed: false }); }
  transfer({ from: WK, value: ANY(1) });
  check('21,000 other wallets\' burns in the hour do not stall the window: its own burn still links it', await until(async () => (await statusOf(K)) === 'linked', 5000));
  chain.logs = chain.logs.filter((l) => chain.receipts.has(l.transactionHash));   // the flood is not wanted by anything after

  // a window left by an earlier build (with an exact amount, or none): any burn proves it now
  const NA = wallet(), NAU = await account();
  { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(NAU.name).id; d.prepare("INSERT INTO burn_proofs (user_id, addr_idx, addr_enc, from_block, scanned_to, opened_at, deadline, status, amount_enc) VALUES (?,?,?,?,?,?,?,'open',?)").run(uid, KK.bidx(NA), KK.encField(NA), chain.head, chain.head, Date.now(), Date.now() + HOUR, KK.encField('4821' + '0'.repeat(14))); d.close(); }
  transfer({ from: NA, value: ANY(8) });             // not the amount that window once asked for
  const sna = await until(async () => (await statusOf(NAU)) === 'linked', 4000);
  check('a window an earlier build opened (with an exact amount asked) is proved by a burn of any amount now, and reads as ETH-less ("earlier")', sna && (await state(NAU)).j.proof.ethNone === 'earlier', JSON.stringify((await state(NAU)).j.proof));

  /* ═══ ETH (owner, 2026-10-21: "send with a dust amount of $Send or Ethereum to the dead address") ═══ */
  const EA = await account(), WEA = wallet(), n8 = nLinked();
  const oe = await open(EA, WEA);
  check('a window on a wallet that sends its own transactions watches ETH as well', oe.status === 200 && oe.j.proof.eth === true && oe.j.proof.ethNone === null, JSON.stringify(oe.j.proof));
  ethSend({ from: wallet(), value: ANY(3) });             // another wallet's ETH burn
  ethSend({ from: WEA, to: wallet(), value: ANY(3) });    // the wallet's own send, not to the burn address
  ethSend({ from: WEA, value: ANY(3), ok: false });       // the wallet's own send to 0x…dEaD that reverted
  ethSend({ from: WEA, value: ANY(3), type: '0x64' });    // a bridge deposit naming the wallet as its sender: not a transaction it signed here
  transfer({ from: WEA, to: wallet(), value: 5n });       // ...and an ordinary $SEND transfer in between: its count moves for that too
  await sleep(1300);
  const se = await state(EA);
  check('none of these proves the wallet by ETH: another wallet\'s, to another address, one that reverted, a bridge deposit', se.j.proof.status === 'open' && nLinked() === n8, JSON.stringify(se.j.proof));
  const etx = ethSend({ from: WEA, value: 1n });           // one wei of ETH: as little as anybody likes
  check('an ETH send of any amount — one wei here — from the wallet itself straight to 0x…dEaD inside the hour links it', await until(async () => (await statusOf(EA)) === 'linked', 4000) && (await state(EA)).j.proof.tx === etx && nLinked() === n8 + 1, JSON.stringify((await state(EA)).j.proof));
  const wle = ((await api('/api/me', { sid: EA.sid })).j.user || {}).walletList || [];
  check('  ...as a wallet of the account, marked as proved by a burn', wle.length === 1 && wle[0].address === WEA && wle[0].byBurn === true, JSON.stringify(wle));

  // a contract wallet: ETH is not watched (its ETH moves through its code, which is not traced), and the panel is told why; a 7702 account is a key
  const CA = await account(), CW = wallet(), SW = wallet();
  chain.code.set(CW, '0x6080604052348015600f57600080fd5b50');
  chain.code.set(SW, '0xef0100' + wallet().slice(2));
  const oc2 = await open(CA, CW);
  check('a wallet with code on the chain is offered $SEND only, and the window says why', oc2.status === 200 && oc2.j.proof.eth === false && oc2.j.proof.ethNone === 'contract', JSON.stringify(oc2.j.proof));
  const o7 = await open(CA, SW);
  check('  ...while an EIP-7702 account (its code only a pointer: still a key that sends its own) is offered ETH as well', o7.status === 200 && o7.j.proof.eth === true && o7.j.proof.ethNone === null, JSON.stringify(o7.j.proof));
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: CA.sid, body: {} });

  // a wallet busy when the hour starts (more than ten sends in the last thousand blocks) is offered $SEND alone
  const BA = await account(), WB = wallet();
  for (let i = 0; i < 12; i++) ethSend({ from: WB, to: wallet(), value: 1n });
  const ob = await open(BA, WB);
  check('a wallet that sent more than ten transactions in the last thousand blocks is offered $SEND only, and told why', ob.status === 200 && ob.j.proof.eth === false && ob.j.proof.ethNone === 'busy', JSON.stringify(ob.j.proof));
  // a code the node would not give: no hour on a guess (it could be a contract offered ETH it cannot use)
  chain.codeFails = true;
  const cf = await open(BA, wallet());
  chain.codeFails = false;
  check('  ...and when the node will not say whether the wallet has code, the hour does not start', cf.status === 503, cf.status + ' ' + JSON.stringify(cf.j));
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: BA.sid, body: {} });

  // the chain will not answer while the ETH burn lands, a thousand blocks after the window opened: it still links once read — and the hour waits for it
  const ED = await account(), WED = wallet();
  await open(ED, WED);
  chain.down = true;
  await sleep(400);
  for (let i = 0; i < 1000; i++) mine();
  ethSend({ from: WED, value: ANY(3) });
  await sleep(HOUR + SKEW + 1200);
  check('an ETH burn made while the chain could not be read leaves the window waiting past its deadline — never "no burn arrived"', (await statusOf(ED)) === 'open');
  chain.down = false;
  check('  ...and once it answers, the blocks are read in steps, the burn found and the wallet linked (not expired while the ETH side catches up)', await until(async () => (await statusOf(ED)) === 'linked', 8000), await statusOf(ED));

  // the node keeps only the newest counts: the blocks in between are read whole instead, and the burn is still found
  const EF = await account(), WEF = wallet();
  await open(EF, WEF);
  chain.down = true;
  await sleep(300);
  for (let i = 0; i < 25; i++) mine();
  ethSend({ from: WEF, value: ANY(4) });
  for (let i = 0; i < 25; i++) mine();
  chain.stateDepth = 10;
  chain.down = false;
  check('with the counts in between no longer kept by the node, the blocks are read whole and the ETH burn still links the wallet', await until(async () => (await statusOf(EF)) === 'linked', 15000), await statusOf(EF));
  chain.stateDepth = Infinity;

  // however long the chain was away, the ETH read stops at the hour: no block stamped after the deadline (and the slack) is read whole
  const ETH_ = await account(), WTH = wallet();
  const oet = await open(ETH_, WTH), dlT = oet.j.proof.deadline;
  chain.down = true;
  ethSend({ from: WTH, to: wallet(), value: 2n });                      // inside the hour: its count moves
  await sleep(HOUR + SKEW + 1500);
  for (let i = 0; i < 40; i++) { const b = mine(); if (i % 2 === 0) ethSend({ from: WTH, to: wallet(), value: 2n, block: b }); }   // and keeps moving after it
  chain.stateDepth = 5; chain.fullReads = [];
  chain.down = false;
  const etEnd = await until(async () => (await statusOf(ETH_)) === 'expired', 15000);
  const lateReads = chain.fullReads.filter((b) => (chain.ts.get(b) || 0) * 1000 > dlT + SKEW);
  check('however long the chain was away, the ETH read stops at the last block inside the hour — none after it is read — and the hour then ends', etEnd && chain.fullReads.length > 0 && lateReads.length === 0, (await statusOf(ETH_)) + ' reads ' + chain.fullReads.length + ' late ' + lateReads.length);
  chain.stateDepth = Infinity;

  // an hour with no burn of either coin ends, once the chain has been read past it for both
  const EN = await account(), WEN = wallet(), n9 = nLinked();
  await open(EN, WEN);
  ethSend({ from: WEN, to: wallet(), value: 3n });     // the wallet is busy elsewhere: its count moves, nothing goes to 0x…dEaD
  const enEnd = await until(async () => (await statusOf(EN)) === 'expired', HOUR + SKEW + 4000);
  check('an hour with neither burn ends without a link, saying so', enEnd && /no burn sent by that wallet itself reached the burn address/.test(((await state(EN)).j.proof || {}).reason || '') && nLinked() === n9);

  // twelve starts at once from one account: the daily cap, one open window per account and the amounts all still hold
  const PAR = await account();
  const rs = await Promise.all(Array.from({ length: 12 }, () => open(PAR, wallet())));
  const pc = (() => { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(PAR.name).id; const all = d.prepare('SELECT COUNT(*) n FROM burn_proofs WHERE user_id = ?').get(uid).n; const op = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id = ? AND status = 'open'").get(uid).n; d.close(); return { all, op }; })();
  check('twelve starts at once from one account: no more than eight windows a day, and exactly one open', pc.all <= 8 && pc.op === 1 && rs.filter((r) => r.status === 200).length === pc.all, JSON.stringify(pc) + ' ' + rs.map((r) => r.status).join(','));
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: PAR.sid, body: {} });

  // eight windows a day
  const J = await account();
  { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(J.name).id; for (let i = 0; i < 8; i++) d.prepare("INSERT INTO burn_proofs (user_id, addr_idx, addr_enc, from_block, scanned_to, opened_at, deadline, status, done_at) VALUES (?,?,?,1,1,?,?,'cancelled',?)").run(uid, 'x' + i, 'x', Date.now(), Date.now() + HOUR, Date.now()); d.close(); }
  check('an account may start eight windows in 24 hours, not a ninth', (await open(J, wallet())).status === 429);

  // the account goes, its windows with it
  const del = await api('/api/account/delete', { method: 'POST', sid: I.sid, body: { confirm: 'DELETE' } });
  check('deleting the account deletes its burn proofs', del.status === 200 && (() => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id NOT IN (SELECT id FROM users WHERE deleted_at IS NULL)").get().n; d.close(); return n === 0; })(), del.status + ' ' + JSON.stringify(del.j));

  check('the watcher read the chain from this suite\'s node (and nothing else stood in for it)', chain.asked > 0);
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  clearInterval(miner);
  if (proc && proc.exitCode == null) { proc.kill('SIGTERM'); await Promise.race([proc.done, sleep(15000)]); }
  node.close();
  try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
}
let pass = 0;
for (const [n, ok, extra] of results) { if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); }
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
