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
      blocks), with the hour shortened to four seconds: what links a wallet (its window's exact dust amount, as received
      or as the wallet's gross send under a transfer tax), and every burn that must not — nothing sent, the wrong amount,
      sent by someone else's allowance or a relayer, from another wallet, to another address, another coin, before the
      window (a lagging node included), after it, made for another reason while a squatter's window was open, or for a
      wallet already on another account — plus a smart account's UserOperation, a chain that will not answer past the
      deadline (never "no burn"), a flood of other wallets' burns, the email-and-password rule, "confirm it's you", ended
      sessions, one window per account, the daily cap, the Data API total and account deletion. Everything lives in a
      temporary directory, deleted. */
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
  check('the watcher takes only a transfer of more than nothing, of $SEND, sent by the wallet itself, in a later block, stamped inside the window',
    /if \(!\(v > 0n\)\) return;/.test(SRC) && /String\(l\.address \|\| ''\)\.toLowerCase\(\) !== TOK\.SEND/.test(SRC) && /const own = sentBy\(entry, from\);/.test(SRC) && /if \(!own\) \{[\s\S]{0,500}?return;\n  \}/.test(SRC)
    && /status = 'open' AND addr_idx = \? AND from_block < \?/.test(SRC) && /&& ms <= r\.deadline \+ BURN_PROOF_SKEW_MS\);/.test(SRC));
  check('  ...and only the window\'s own exact amount, as it reached 0x…dEaD or as the wallet sent it in all (a transfer tax\'s cut included)',
    /const hit = inWin\.filter\(\(r\) => want\(r\) > 0n && \(want\(r\) === v \|\| want\(r\) === gross\)\);/.test(SRC) && /tok === TOK\.SEND && f === from \? t \+ val : t/.test(SRC));
  check('  ...an amount the server picks: four significant figures, about two cents at most, never shared by two open windows on one wallet, kept encrypted',
    /Math\.floor\(Math\.log10\(0\.02 \/ \(9999 \* px\)\)\)/.test(SRC) && /if \(!used\.has\(wei\)\) return wei;/.test(SRC) && /\['burn_proofs', 'amount_enc'\], \['burn_proofs', 'amount_seen_enc'\]/.test(KEYS));
  check('  ...one burn proves one account: if a burn ever matched two windows, it would link neither', /if \(new Set\(hit\.map\(\(r\) => r\.user_id\)\)\.size > 1\)/.test(SRC));
  check('  ...a lagging head cannot let an earlier burn in: at the opening only a block stamp\'s rounding is forgiven, not the deadline\'s two minutes',
    /const BURN_PROOF_OPEN_SKEW_MS = Math\.min\(BURN_PROOF_SKEW_MS, 2000\);/.test(SRC) && /ms >= Math\.floor\(r\.opened_at \/ 1000\) \* 1000 - BURN_PROOF_OPEN_SKEW_MS/.test(SRC));
  check('  ...each wallet is read on its own, filtered on both ends, so nobody else\'s burns can stall a window', /transferLogWalk\(TOK\.SEND, \[\[TRANSFER_TOPIC, addrTopic\(addr\), addrTopic\(DEAD_ADDR\)\]\]/.test(SRC));
  check('  ...a window cancelled while its burn was being read links nothing', /const cur = db\.prepare\('SELECT status FROM burn_proofs WHERE id = \?'\)\.get\(r\.id\);\n  if \(!cur \|\| cur\.status !== 'open'\) return;/.test(SRC) && /if \(!burnProofEnd\(r, 'linked', null, tx\)\) return;\n  await linkWalletTo\(u, address, 'burn'\);/.test(SRC));
  check('  ...ending the other sessions, or changing the password, calls off the windows those sessions opened', (SRC.match(/burnProofsOff\(me, '/g) || []).length === 2 && /opened_by IS NULL OR opened_by <> \?/.test(SRC));
  check('  ...a wallet linked by its signature while its burn proof ran ends that hour as linked, not "expired"', /reason = 'linked by its signature instead'/.test(SRC));
  check('  ...a wallet whose burns are too many to read ends its own windows, saying so, instead of holding everyone\'s status', /history longer than the chain read budget\|history too dense/.test(SRC) && /burnProofReads\.set\(addr, \{ okAt: now\(\), failing: false \}\)/.test(SRC));
  check('  ...and the "prove it by a burn" hint only follows a refusal where a burn can stand in', /explain\(e, opts\)/.test(PUB('wallet.js')) && (strip(PUB('auth.js')).match(/WALLET\.sign\(provider, address, message, \{ burn: true \}\)/g) || []).length === 2);
  check('  ...and a window ends unproved only once the chain has been read past its deadline', /status = 'open' AND scanned_to >= \? AND deadline < \?/.test(SRC) && /if \(!\(headMs > r\.deadline \+ BURN_PROOF_SKEW_MS\)\) continue;/.test(SRC) && /burnProofEnd\(r, 'expired', r\.foreign_seen/.test(SRC));
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
    && /'DELETE FROM burn_proofs',\n\];/.test(SRC) && /'wallet_hist', 'burn_proofs'\]\)/.test(SRC));
  check('the picker offers GMGN and "my wallet isn\'t listed" — only where a wallet is being proved',
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
    /destroyed for good/.test(BP) && /costs a little ETH for gas/.test(BP) && /You make the transaction yourself/.test(BP) && /Only ever to the burn address shown here, and only the amount on your own screen/.test(BP) && /The exact amount/.test(BP));
  check('  ...and never tells anyone to buy', !/\bbuy (some|more|\$SEND)|purchase/i.test(BP));
  check('the terms and the privacy policy say what it is, and their versions moved', /\(g\) Proving a wallet by a burn\./.test(PUB('terms.html')) && /Version 2026-10-20 ·/.test(PUB('terms.html'))
    && /A wallet that cannot sign can be linked instead by a burn/.test(PUB('privacy.html')) && /Version 2026-10-20 ·/.test(PUB('privacy.html')));
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

const chain = { head: 5000, lag: 0, ts: new Map([[5000, nowSec()]]), logs: [], receipts: new Map(), down: false, li: 0, asked: 0 };
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
  return tx;
}
function answer(m, p) {
  if (m === 'eth_blockNumber') return hx(chain.head - chain.lag);   // a node behind the chain answers an older head
  if (m === 'eth_chainId') return '0x1237';
  if (m === 'eth_getBlockByNumber') {
    const n = p[0] === 'latest' ? chain.head : parseInt(p[0], 16);
    if (!(n <= chain.head)) return null;
    return { number: hx(n), timestamp: hx(chain.ts.get(n) || nowSec()), transactions: [] };
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
  if (m === 'eth_getCode') return '0x';
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
  const amt = (o) => BigInt((o && o.j && o.j.proof && o.j.proof.amount) || '0');

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

  // the burns that must not prove a wallet, then the one that does
  const X = wallet(), Y = wallet(), Z = wallet();
  const o = await open(A, X), AX = amt(o);
  const a = o.j.proof || {};
  check('starting a window answers with it open, for this wallet, its time left, and the one exact dust amount it asks for',
    o.status === 200 && a.status === 'open' && a.address === X && a.leftMs > 0 && a.leftMs <= HOUR && AX > 0n && /^\d+(\.\d+)?$/.test(a.amountText || '')
    && (a.amountText.replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length <= 4), JSON.stringify(a));
  check('  ...a figure that is dust whatever the price: four significant figures, under one $SEND here (no price to scale by)', AX < 10n ** 18n && AX >= 10n ** 17n, String(AX));
  check('  ...and the window opened before it (another wallet) was ended: one open window per account', (() => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id = (SELECT id FROM users WHERE username = ?) AND status = 'open'").get(A.name).n; const c = d.prepare("SELECT COUNT(*) n FROM burn_proofs WHERE user_id = (SELECT id FROM users WHERE username = ?) AND status = 'cancelled' AND reason = 'a new window was started'").get(A.name).n; d.close(); return n === 1 && c >= 1; })());
  check('  ...the amount and the wallet are kept encrypted, not as figures the chain could be searched for', (() => { const d = openDb(); const r = d.prepare("SELECT addr_enc, amount_enc FROM burn_proofs WHERE status = 'open' AND user_id = (SELECT id FROM users WHERE username = ?)").get(A.name); d.close(); return r && !r.amount_enc.includes(AX.toString()) && !r.addr_enc.includes(X.slice(2)); })());
  transfer({ from: X, value: 0n });                 // nothing moved: any contract can log that for anybody
  transfer({ from: X, value: AX, sender: Y });      // the amount, moved by an app holding an allowance — not sent by the wallet
  transfer({ from: Z, value: AX });                 // another wallet's burn of the amount
  transfer({ from: X, to: wallet(), value: AX });   // the wallet's own transfer of the amount, not to the burn address
  transfer({ from: X, token: GWC, value: AX });     // the wallet's own burn of the amount, of another coin
  transfer({ from: X, value: AX + 1n });            // the wallet's own burn, one wei off: not the amount
  await sleep(1300);
  const sx = await state(A);
  check('none of these proves the wallet: nothing sent, an allowance\'s move, another wallet\'s, to another address, another coin, the wrong amount',
    sx.j.proof.status === 'open' && !linkedTo().length, JSON.stringify(sx.j.proof));
  check('  ...the wrong amount from the wallet itself is said in the window, so a typo can be put right in the same hour', sx.j.proof.amountSeen != null && sx.j.proof.foreignSeen === true, JSON.stringify(sx.j.proof));
  const tx = transfer({ from: X, value: AX });
  const got = await until(async () => (await statusOf(A)) === 'linked', 4000);
  const sA = await state(A);
  check('a burn of exactly the amount, sent by the wallet itself inside the hour, links it', got && sA.j.proof.tx === tx, JSON.stringify(sA.j.proof));
  const me = await api('/api/me', { sid: A.sid });
  const wl = (me.j.user && me.j.user.walletList) || [];
  check('  ...as a wallet of the account, marked as proved by a burn', wl.length === 1 && wl[0].address === X && wl[0].byBurn === true, JSON.stringify(wl));
  check('  ...and the owner is told, in words, how it was linked (and was told when the hour started)', (() => { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(A.name).id; const n = d.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND text LIKE '%by a burn sent from it%'").get(uid).n; const m = d.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND text LIKE '%burn proof was started%'").get(uid).n; d.close(); return n === 1 && m >= 1; })());
  // the link changed the account's wallets, so every session's "confirm it's you" closed (the watcher has no session to spare)
  const again = await open(A, X);
  check('  ...which closes every session\'s "confirm it\'s you" window, as any change to the wallets does', again.status === 401 && again.j.code === 'need_verify', again.status + ' ' + JSON.stringify(again.j));
  await api('/api/auth/verify', { method: 'POST', sid: A.sid, body: { password: A.password } });
  check('  ...and a wallet already on this account is refused a second window', (await open(A, X)).status === 409);

  // a transfer tax: the wallet sends the amount, the coin keeps a cut, less reaches 0x…dEaD — it still proves the wallet
  const TX_ = await account(), WT = wallet();
  const ot = await open(TX_, WT), AT = amt(ot);
  transfer({ from: WT, value: AT - AT / 100n, fee: AT / 100n });
  check('a burn of the amount that a transfer tax took a cut of on the way still proves the wallet (the gross send is the amount)', await until(async () => (await statusOf(TX_)) === 'linked', 4000));

  // a burn made BEFORE the window opened never counts, and an hour with no burn ends — once the chain says the hour is over
  const B = await account(), V = wallet();
  transfer({ from: V, value: 10n ** 17n });
  await sleep(300);
  await open(B, V);
  await sleep(HOUR - 1200);
  check('a burn made before the window opened does not count', (await statusOf(B)) === 'open');
  const ended = await until(async () => (await statusOf(B)) === 'expired', HOUR + SKEW + 3000);
  const sB = await state(B);
  check('  ...and the hour ends without a link, saying why', ended && /no burn of the exact amount, sent by that wallet itself, reached the burn address within the hour/.test(sB.j.proof.reason || ''), JSON.stringify(sB.j.proof));

  // the chain will not answer: a window waits rather than ending "no burn" — and a burn inside the hour still counts once it is read
  const C = await account(), W1 = wallet();
  const oc = await open(C, W1);
  chain.down = true;
  await sleep(400);
  transfer({ from: W1, value: amt(oc) });          // mined inside the hour, while the site cannot read the chain
  await sleep(HOUR + SKEW + 1200);
  const sC = await state(C);
  check('a chain that will not answer leaves the window open past its deadline — never "no burn arrived"', sC.j.proof.status === 'open' && sC.j.chain.failing === true, JSON.stringify(sC.j));
  check('  ...and a new window can\'t start while the chain is unreadable', (await open(await account(), wallet())).status === 503);
  chain.down = false;
  check('  ...and once it answers, the burn that landed inside the hour links the wallet', await until(async () => (await statusOf(C)) === 'linked', 5000));

  // a burn stamped after the hour, read late, does not count
  const D = await account(), W2 = wallet();
  const od = await open(D, W2);
  chain.down = true;
  await sleep(HOUR + SKEW + 1200);
  transfer({ from: W2, value: amt(od) });          // after the deadline
  chain.down = false;
  const lateEnd = await until(async () => (await statusOf(D)) === 'expired', 5000);
  check('a burn stamped after the hour does not count, even read with the hour\'s window still open', lateEnd && linkedTo().length === 3, (await statusOf(D)) + ' / ' + linkedTo().length);

  // a squatter: an account with a window open on a wallet it does not control
  const S1 = await account(), OWN = await account(), U = wallet();
  const os1 = await open(S1, U);
  transfer({ from: U, value: 123456789n * 10n ** 9n });   // the wallet burns for a reason of its own (a dev burn, a Data API key)
  await sleep(1200);
  check('a burn the wallet makes for its own reasons does not hand it to an account that only kept a window open on it', (await statusOf(S1)) === 'open' && linkedTo().length === 3);
  const oo = await open(OWN, U);
  check('  ...two windows open on one wallet never ask for the same amount', amt(oo) > 0n && amt(oo) !== amt(os1), amt(oo) + ' / ' + amt(os1));
  transfer({ from: U, value: amt(oo) });          // the owner sends the amount on THEIR screen
  check('  ...and the owner\'s burn of their own amount links it to them, whoever else is watching it', await until(async () => (await statusOf(OWN)) === 'linked', 4000) && (await statusOf(S1)) === 'open');
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: S1.sid, body: {} });

  // a wallet already on another account: the window opens (nothing about another account is said before a burn), the burn is refused
  const G = await account();
  const go = await open(G, X);
  transfer({ from: X, value: amt(go) });
  const gEnd = await until(async () => (await statusOf(G)) === 'refused', 4000);
  check('a window for a wallet on another account opens like any other (nothing about another account is said before a burn)', go.status === 200, go.status);
  check('  ...and its burn is refused: the wallet stays where it was', gEnd && /already linked to another account/.test(((await state(G)).j.proof || {}).reason || '') && linkedTo().length === 4);   // X, WT, W1, U
  // everything X sent to 0x…dEaD counts toward the Data API, like a signed wallet's: an allowance's move, the proof, and G's
  const el = await api('/api/data/eligibility?fresh=1', { sid: A.sid });
  const xBurns = chain.logs.filter((l) => l.address === SEND && l.topics[1] === topic(X) && l.topics[2] === topic(DEAD)).reduce((t, l) => t + BigInt(l.data), 0n);
  check('a wallet proved by a burn counts toward the Data API exactly like a signed one: every burn it sent', el.status === 200 && el.j.burn && el.j.burn.wei === xBurns.toString(), el.status + ' ' + JSON.stringify(el.j && (el.j.burn || el.j.error)) + ' want ' + xBurns);

  // a smart account: its UserOperation, carried by a bundler, is the wallet's own act
  const H = await account(), S = wallet(), BUNDLER = wallet();
  const oh = await open(H, S);
  transfer({ from: S, value: amt(oh), sender: BUNDLER, op: S });
  check('a smart account\'s burn, sent as its own ERC-4337 UserOperation by a bundler, proves it', await until(async () => (await statusOf(H)) === 'linked', 4000));

  // a node whose head lags: the window opens below a burn of its own amount stamped seconds before it opened
  const L = await account(), WL = wallet();
  await sleep(3500);
  chain.lag = 40;
  const lo = await open(L, WL);
  chain.lag = 0;
  { // a block inside the lag, stamped well before the window opened, carries the very amount it asks for
    let b = 0; for (const [n, t] of chain.ts) if (n > chain.head - 38 && t * 1000 < Date.now() - 4500) b = Math.max(b, n);
    if (b) transfer({ from: WL, value: amt(lo), block: b });
    check('  (the planted burn sits in a block the lagging head let the window open below)', b > 0, b);
  }
  await sleep(1600);
  check('a burn of the window\'s own amount made before it opened does not count, even when the node\'s head lags behind it', lo.status === 200 && (await statusOf(L)) === 'open' && linkedTo().length === 5, (await statusOf(L)) + ' / ' + linkedTo().length);   // ...and S
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: L.sid, body: {} });

  // a burn of the amount that the wallet did not send itself (a Safe's owner key, a relayer): it does not count, and the window says so
  const FA = await account(), WF = wallet();
  const of = await open(FA, WF);
  transfer({ from: WF, value: amt(of), sender: wallet() });
  await sleep(1200);
  check('a burn of the amount from the wallet, sent by another address, is flagged while the window is open', ((await state(FA)).j.proof || {}).foreignSeen === true);
  const fEnd = await until(async () => (await statusOf(FA)) === 'expired', HOUR + SKEW + 3000);
  check('  ...and the window ends saying what happened, not "no burn arrived"', fEnd && /sent by another address/.test(((await state(FA)).j.proof || {}).reason || '') && linkedTo().length === 5);

  // the wrong amount, from the wallet itself, all hour: the window ends naming both amounts
  const WA = await account(), WW = wallet();
  const ow = await open(WA, WW);
  transfer({ from: WW, value: amt(ow) * 2n });
  const wEnd = await until(async () => (await statusOf(WA)) === 'expired', HOUR + SKEW + 3000);
  check('a burn of the wrong amount ends the hour naming what arrived and what it had to be', wEnd && /not the exact .* \$SEND this hour asked for/.test(((await state(WA)).j.proof || {}).reason || ''), JSON.stringify((await state(WA)).j.proof));

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
  const I = await account(), Q = wallet();
  const oq = await open(I, Q);
  const cx = await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: I.sid, body: {} });
  transfer({ from: Q, value: amt(oq) });
  await sleep(1000);
  check('a cancelled window ends, and a burn after it links nothing', cx.status === 200 && cx.j.proof.status === 'cancelled' && (await statusOf(I)) === 'cancelled' && linkedTo().length === 5, linkedTo().length);

  // more burns to 0x…dEaD from other wallets than one read may hold: they never reach a window's read
  const K = await account(), WK = wallet();
  const ok_ = await open(K, WK);
  { const b = mine(); for (let i = 0; i < 21000; i++) chain.logs.push({ address: SEND, topics: [TRANSFER, topic(wallet()), topic(DEAD)], data: '0x' + word(1), blockNumber: hx(b), transactionHash: '0x' + randomBytes(32).toString('hex'), logIndex: hx(i), removed: false }); }
  transfer({ from: WK, value: amt(ok_) });
  check('21,000 other wallets\' burns in the hour do not stall the window: its own burn still links it', await until(async () => (await statusOf(K)) === 'linked', 5000));
  chain.logs = chain.logs.filter((l) => chain.receipts.has(l.transactionHash));   // the flood is not wanted by anything after

  // every amount at the scale but one is open on a wallet: a new window must draw the one left (the pick never repeats an open amount)
  const UQ = wallet(), n0 = 1000n + BigInt(Math.floor(Math.random() * 9000));
  { const d = openDb(); d.exec('BEGIN'); for (let n = 1000n; n <= 9999n; n++) if (n !== n0) d.prepare("INSERT INTO burn_proofs (user_id, addr_idx, addr_enc, from_block, scanned_to, opened_at, deadline, status, amount_enc) VALUES (999999,?,?,?,?,?,?,'open',?)").run(KK.bidx(UQ), KK.encField(UQ), chain.head, chain.head, Date.now(), Date.now() + 3600e3, KK.encField((n * 10n ** 14n).toString())); d.exec('COMMIT'); d.close(); }
  const UQA = await account();
  const ouq = await open(UQA, UQ);
  check('with every other amount open on a wallet, a new window draws the one amount left — two open windows never share one', amt(ouq) === n0 * 10n ** 14n, amt(ouq) + ' / ' + n0);
  { const d = openDb(); d.prepare('DELETE FROM burn_proofs WHERE user_id = 999999').run(); d.close(); }
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: UQA.sid, body: {} });

  // if a burn ever fits two accounts' windows (one by what reached 0x…dEaD, the other by the gross a transfer tax took a cut of), it links neither
  const E1 = await account(), E2 = await account(), WE = wallet();
  const a1 = amt(await open(E1, WE)), a2 = amt(await open(E2, WE));
  const aLo = a1 < a2 ? a1 : a2, aHi = a1 < a2 ? a2 : a1;
  transfer({ from: WE, value: aLo, fee: aHi - aLo });
  const both = await until(async () => (await statusOf(E1)) === 'refused' && (await statusOf(E2)) === 'refused', 4000);
  check('a burn that fits two accounts\' windows links neither, and both are told why', both && /cannot say which of you sent it/.test(((await state(E1)).j.proof || {}).reason || '') && linkedTo().length === 6   /* ...and WK */
    && (() => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) n FROM notifications WHERE text LIKE '%linked neither%'").get().n; d.close(); return n === 2; })());

  // a window left by an earlier build, with no amount: no burn can prove it (and nothing breaks reading it)
  const NA = wallet(), NAU = await account();
  { const d = openDb(); const uid = d.prepare('SELECT id FROM users WHERE username = ?').get(NAU.name).id; d.prepare("INSERT INTO burn_proofs (user_id, addr_idx, addr_enc, from_block, scanned_to, opened_at, deadline, status) VALUES (?,?,?,?,?,?,?,'open')").run(uid, KK.bidx(NA), KK.encField(NA), chain.head, chain.head, Date.now(), Date.now() + HOUR); d.close(); }
  transfer({ from: NA, value: 10n ** 17n });
  await sleep(1200);
  const sna = await state(NAU);
  check('a window with no amount (an earlier build\'s) is never proved by a burn, and still reads', sna.status === 200 && sna.j.proof.status === 'open' && sna.j.proof.amount === null && linkedTo().length === 6, JSON.stringify(sna.j.proof));
  await api('/api/wallet/burnproof/cancel', { method: 'POST', sid: NAU.sid, body: {} });

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
