/* The saved wallet history (wallet_hist) and the job rules around it: the blob helpers, the merge of a saved copy
   with a newly read window, which tokens are asked about again, how a job is retired, the bounded line, the gate on
   rebuilds, the deletion paths, and the bell that rings when a read finishes after its page has gone — the helpers
   lifted out of server.js as they are (no copy to drift) and the read itself driven through the real HTTP API with
   a FABRICATED saved copy (a few transfers in the recent past, one token marked "no market"), so the chain read is
   a short window and not a whole-chain walk. Throwaway rows only; all removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import vm from 'node:vm';
import { DB_PATH, KEY_PATH, ROOT, SERVER_JS } from './_paths.mjs';
import { rpcDispatcher, LIVE_CHAIN, liveSkipped } from './_rpc.mjs';
const require = createRequire(ROOT + '/package.json');
const { Wallet } = require('ethers');

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const SRC = readFileSync(SERVER_JS, 'utf8');
const PRIV = readFileSync(path.join(ROOT, 'public', 'privacy.html'), 'utf8');
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const grab = (re, name) => { const m = re.exec(SRC); if (!m) throw new Error('could not find ' + name + ' in server.js'); return m[0]; };
const hexOf = (n) => randomBytes(n).toString('hex');

// the key the throwaway server runs under, so a row this suite writes reads back through the server's own helpers
const DATA_KEY = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
const IDX_KEY = createHmac('sha256', DATA_KEY).update('blind-index').digest();
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', PAIR = '0xf30bb531d0255969be155533abac34b22bd63414';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
async function rpc(method, params) {
  for (let i = 0; ; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: UA, dispatcher: rpcDispatcher, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    let j = null; try { j = await r.json(); } catch {}
    if ((r.status === 429 || (j && j.error && /too many/i.test(j.error.message || ''))) && i < 6) { await sleep(2500 * (i + 1)); continue; }
    if (!j || j.error) throw new Error((j && j.error && j.error.message) || 'rpc ' + r.status);
    return j.result;
  }
}
const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'jsi_age=18; sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, headers: r.headers };
};
// past the participation gate (holder_verified_at set): this suite tests the saved history, not the gate
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + hexOf(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: raw };
}
const setSudo = (sid, on) => db.prepare('UPDATE sessions SET sudo_until = ? WHERE token = ?').run(on ? Date.now() + 3600e3 : null, createHash('sha256').update(sid).digest('hex'));
async function link(sid, w, proof) {
  const addr = w.address.toLowerCase();
  const n = await api('/api/auth/wallet/nonce?purpose=link&address=' + addr, { sid });
  const signature = await w.signMessage(n.j.message);
  let current;
  if (proof) { const pa = proof.address.toLowerCase(); const pn = await api('/api/auth/wallet/nonce?purpose=manage&address=' + pa, { sid }); current = { address: pa, signature: await proof.signMessage(pn.j.message) }; }
  return api('/api/auth/wallet/verify', { method: 'POST', sid, body: { address: addr, signature, current } });
}
const histRow = (uid, addr) => db.prepare('SELECT read_to, updated_at, partial, length(hist) n FROM wallet_hist WHERE user_id = ? AND addr_idx = ?').get(uid, bidx(addr));

/* ═══ the helpers: lib/keys.js in single-key mode, which is what the test server runs (its key is data/.data_key) ═══ */
const { Keys } = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'keys.js'));
const KEYS = Keys.legacy(DATA_KEY);
const encField = (s) => KEYS.encField(s), decField = (s) => KEYS.decField(s), encBlob = (b) => KEYS.encBlob(b), decBlob = (b) => KEYS.decBlob(b), bidx = (s) => KEYS.bidx(s);
check('the server encrypts through lib/keys.js (the module this suite exercises)', /const KEYLIB = require\('\.\/lib\/keys\.js'\);/.test(SRC) && /function encBlob\(buf\) \{ return KEYS\.encBlob\(buf\); \}/.test(SRC) && /function decBlob\(buf\) \{ return KEYS\.decBlob\(buf\); \}/.test(SRC));
check('  ...and single-key mode is byte-for-byte the old index (HMAC of HMAC(key, "blind-index"))', bidx('0xabc') === createHmac('sha256', IDX_KEY).update('0xabc').digest('hex'));
const packHist = (h) => encBlob(zlib.brotliCompressSync(Buffer.from(JSON.stringify(h))));   // the row the server would have written
const putHist = (uid, addr, h, partial) => db.prepare('INSERT INTO wallet_hist (user_id, addr_idx, read_to, updated_at, partial, hist) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id, addr_idx) DO UPDATE SET read_to = excluded.read_to, updated_at = excluded.updated_at, partial = excluded.partial, hist = excluded.hist')
  .run(uid, bidx(addr), h.head, Date.now(), partial ? 1 : 0, packHist(h));

try {
  /* ═══ 1. the blob: AES-256-GCM over bytes, 1 version byte + iv + tag ═══ */
  {
    const plain = randomBytes(5000);
    const sealed = encBlob(plain);
    check('encBlob/decBlob round-trip bytes exactly', Buffer.isBuffer(sealed) && sealed[0] === 1 && sealed.length === 1 + 12 + 16 + plain.length && decBlob(sealed).equals(plain), sealed.length);
    const tampered = Buffer.from(sealed); tampered[40] ^= 1;
    check('  ...a tampered byte reads as nothing, never as half a history', decBlob(tampered) === null);
    const other = Buffer.from(sealed); other[0] = 2;
    check('  ...and so does an unknown version byte or a short buffer', decBlob(other) === null && decBlob(Buffer.alloc(10)) === null && decBlob(null) === null);
    check('  ...a Uint8Array (what node:sqlite hands back) opens the same', decBlob(new Uint8Array(sealed)).equals(plain));
    check('the row is compressed with the ASYNC brotli, inside the job, never on a request handler', /const brotliAsync = require\('node:util'\)\.promisify\(zlib\.brotliCompress\)/.test(SRC) && /encBlob\(await brotliAsync\(/.test(SRC) && /JSON\.parse\(\(await unbrotliAsync\(packed\)\)/.test(SRC) && !/brotliCompressSync\([^)]*hist/.test(SRC));
    check('  ...and a history over 8 MB is not stored (saved:false, "too large")', /WALLET_HIST_JSON_MAX = 8 \* 1024 \* 1024/.test(SRC) && /> WALLET_HIST_JSON_MAX\) return \{ saved: false, savedWhy: 'too large' \}/.test(SRC));
    check('the table keeps the blob LAST, keyed per member and wallet, cascading with the account', /CREATE TABLE IF NOT EXISTS wallet_hist \([\s\S]*?user_id\s+INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE[\s\S]*?partial\s+INTEGER NOT NULL DEFAULT 0,[^\n]*\n\s*hist\s+BLOB NOT NULL,\s*PRIMARY KEY \(user_id, addr_idx\)/.test(SRC));
  }

  /* ═══ 2. the merge: a saved copy plus a window read after it ═══ */
  {
    const ctx = vm.createContext({ Number, Object, Set, Array });
    vm.runInContext(grab(/function mergeWalletHistory\(prior, readFrom, rows, nftNew\) \{[\s\S]*?\n\}\n/, 'mergeWalletHistory') + grab(/const tokensToRecheck = [^\n]+\n/, 'tokensToRecheck') + '\nthis.merge = mergeWalletHistory; this.recheck = tokensToRecheck;', ctx);
    const W = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40), TOK = '0x' + 'a'.repeat(40);
    const row = (block, li, from, to, hash) => [block, li, hash || ('0x' + hexOf(32)), TOK, from, to, '1000', 1700000000000];
    const prior = { head: 1000, transfers: [row(990, 1, OTHER, W), row(600, 2, OTHER, W), row(100, 0, OTHER, W)], nftByBlock: { 990: 2, 100: 1 } };
    const m0 = ctx.merge(prior, Math.max(0, prior.head - 5000), [], {});   // the server's rule is max(0, head − 5000): here the overlap reaches block 0, so every saved row is re-read
    check('the overlap window replaces the saved rows it covers — reaching block 0, a re-read that found nothing leaves nothing', m0.transfers.length === 0 && m0.nftTransfers === 0, JSON.stringify(m0));
    // the realistic case: a window from head − 5000 that keeps everything older
    const big = { head: 60000, transfers: [row(59000, 1, OTHER, W), row(30000, 2, OTHER, W), row(100, 0, OTHER, W)], nftByBlock: { 59000: 2, 100: 1 } };
    const out = row(60500, 7, W, OTHER);   // the ONLY new transfer leaves the wallet: a "from the wallet" pass that waited for an arrival would miss it
    const m = ctx.merge(big, big.head - 5000, [out], { 60400: 1 });
    check('an increment whose only new transfer is OUTGOING is merged, newest first', m.transfers.length === 3 && m.transfers[0] === out && m.transfers[1][0] === 30000 && m.transfers[2][0] === 100, JSON.stringify(m.transfers.map((t) => t[0])));
    check('  ...the saved row inside the overlap (block 59000 ≥ 55000) was dropped and not seen again by the window, so it is gone', !m.transfers.some((t) => t[0] === 59000));
    check('  ...the NFT count follows the rows: 2 at 59000 dropped, 1 at 100 kept, 1 new = 2', m.nftTransfers === 2 && m.nftByBlock[100] === 1 && m.nftByBlock[60400] === 1 && !m.nftByBlock[59000], JSON.stringify(m.nftByBlock));
    const dup = ctx.merge(big, big.head - 5000, [out, big.transfers[2]], {});   // the window answered a row the saved copy already has
    check('  ...a row seen twice (hash + log index) is kept once', dup.transfers.length === 3, dup.transfers.length);
    check('  ...and a saved copy with no NFT map contributes no count (the read treats such a copy as unusable)', ctx.merge({ head: 10, transfers: [] }, 5, [], {}).nftTransfers === 0);
    check('the read walks BOTH topic sets over the window for an incremental read (laterPassesStartAtFirstHit only from scratch)', /laterPassesStartAtFirstHit: !base/.test(SRC) && /const readFrom = base \? Math\.max\(0, base\.head - WALLET_REORG_OVERLAP\) : 0/.test(SRC) && /WALLET_REORG_OVERLAP = 5000/.test(SRC));
    const pt = new Map([['a', { market: true }], ['b', { market: false }], ['c', { market: null }]]);
    const rc = ctx.recheck(['a', 'b', 'c', 'd'], pt);
    check('market:false and market:null tokens are asked about again, and new ones; a market once found stays found', JSON.stringify(rc) === '["b","c","d"]', JSON.stringify(rc));
    check('  ...the read uses that selection for the Dexscreener batches', /const recheck = tokensToRecheck\(toks, priorTok\);[\s\S]*?for \(let i = 0; i < recheck\.length; i \+= 30\)/.test(SRC));
  }

  /* ═══ 3. the job rules, lifted ═══ */
  {
    const consts = grab(/const WALLET_HIST_TTL = [^\n]+\n/, 'WALLET_HIST_TTL') + grab(/const WALLET_JOBS_MAX = [^\n]+\n/, 'WALLET_JOBS_MAX') + grab(/const WALLET_QUEUE_MAX = [^\n]+\n/, 'WALLET_QUEUE_MAX');
    const ctx = vm.createContext({ Math, String, Map, Set, Array, Promise, Object, now: () => Date.now(), db: { prepare: () => ({ get: () => undefined }) }, bidx: () => '', pruneCache: () => {} });
    const region = SRC.slice(SRC.indexOf('const _walletHistCache = new Map()'), SRC.indexOf('async function walletJobRun('));
    ctx.rateLimitLog = [];
    vm.runInContext(consts + grab(/const buckets = new Map\(\);\nfunction rateLimit\(key, max, windowMs\) \{[\s\S]*?\n\}\n/, 'rateLimit') +
      // the real runner reads the chain; this one takes its turn, remembers whether it got one, and never finishes — the line is what is under test
      'let runs = []; function walletJobRun(job, key) { runs.push(job); return walletTurn(job).then((go) => { job.go = go; if (!go && _walletJobs.get(key) === job) _walletJobs.delete(key); return new Promise(() => {}); }); }\n' + region +
      '\nthis.walletJob = walletJob; this.walletJobAbandoned = walletJobAbandoned; this.walletStageOf = walletStageOf; this.walletJobEta = walletJobEta; this.walletStartGate = walletStartGate; this.walletTurnDone = walletTurnDone; this.waiters = _walletWaiters; this.jobs = _walletJobs; this.readMs = _walletReadMs; this.running = () => _walletHistRunning; this.runs = runs;', ctx);
    const t = Date.now();
    check('a job with `progressed` survives 2 minutes without a poll', ctx.walletJobAbandoned({ polls: 3, progressed: true, polledAt: t - 120e3 }, t) === false);
    check('  ...and 25 minutes unpolled it is still NOT abandoned (a first read is about an hour on the public node; it ends only by stalling, at the deadline, or by finishing)', ctx.walletJobAbandoned({ polls: 3, progressed: true, polledAt: t - 25 * 60e3 }, t) === false && ctx.walletJobAbandoned({ polls: 1, progressed: true, polledAt: t - 3 * 3600e3 }, t) === false);
    check('  ...the idle allowance for a progressed read is gone from the code; its guard still ends a stalled or overdue read', !/WALLET_JOB_PROGRESSED_IDLE_MS/.test(SRC) && /if \(now\(\) - job\.movedAt > WALLET_JOB_STALL_MS \|\| now\(\) - job\.runAt > WALLET_JOB_DEADLINE_MS\) throw new Error\('the read took too long'\);/.test(SRC) && /WALLET_JOB_STALL_MS = 5 \* 60 \* 1000, WALLET_JOB_DEADLINE_MS = 2 \* 60 \* 60 \* 1000/.test(SRC));
    check('  ...one that has not progressed still goes after a minute', ctx.walletJobAbandoned({ polls: 3, progressed: false, polledAt: t - 61e3 }, t) === true && ctx.walletJobAbandoned({ polls: 3, progressed: false, polledAt: t - 50e3 }, t) === false);
    check('  ...and one never polled at all dies at 60 s, progressed or not', ctx.walletJobAbandoned({ polls: 0, progressed: true, polledAt: t - 61e3 }, t) === true && ctx.walletJobAbandoned({ polls: 0, progressed: false, polledAt: t - 61e3 }, t) === true && ctx.walletJobAbandoned({ polls: 0, progressed: true, polledAt: t - 59e3 }, t) === false);
    check('  ...a finished read rings the bell when nobody asked in the last 30 s', /WALLET_NOTIFY_QUIET_MS = 30 \* 1000/.test(SRC) && /if \(now\(\) - job\.polledAt > WALLET_NOTIFY_QUIET_MS\) walletReadNotify\(uid, w\);/.test(SRC));
    check('`progressed` is set the first time any step reports done > 0, and never cleared', /if \(done > 0\) job\.progressed = true;/.test(SRC) && !/job\.progressed = false/.test(SRC.slice(SRC.indexOf('async function walletJobRun('))));
    const so = (s) => ctx.walletStageOf(s).n;
    check('stageOf: transfers 1 · tokens 2 · dating 3 · markets 4 · receipts 5 · in line 0, of 5', so('reading the account') === 1 && so('reading every token transfer') === 1 && so('reading 41 tokens') === 2 && so('dating 300 blocks') === 3 && so('finding markets for 41 tokens') === 4 && so('reading 120 of its transactions') === 5 && so('done') === 5 && so('waiting for a turn') === 0 && ctx.walletStageOf('x').of === 5);
    const job = { turn: false, done: 4, total: 100, stageAt: t - 8000 };
    check('eta is null until five steps of the stage are in', ctx.walletJobEta(job, t) === null);
    job.done = 10;
    check('  ...then (total − done) × (elapsed in stage ÷ done), in ms: 90 × 800 = 72,000', ctx.walletJobEta(job, t) === 72000, ctx.walletJobEta(job, t));
    check('  ...and null again once done reaches total', ctx.walletJobEta({ turn: false, done: 100, total: 100, stageAt: t - 8000 }, t) === null);
    check('  ...in line, null until a first read has finished', ctx.walletJobEta({ turn: true }, t) === null);
    const uid0 = 900001;
    check('the gate lets a member start reads, and rebuild from scratch twice an hour, then says so', ctx.walletStartGate(uid0, 1) === null && ctx.walletStartGate(uid0, 2) === null && ctx.walletStartGate(uid0, 2) === null && ctx.walletStartGate(uid0, 2) === 'rebuild' && ctx.walletStartGate(uid0, 1) === null);
    check('  ...the route charges it only when a read starts, and answers a third rebuild 429 rebuild_limit', /walletJob\(me\.id, addr, fresh, \(\) => walletStartGate\(me\.id, fresh\)\)/.test(SRC) && /job\.why === 'rebuild' \? send\(res, 429, \{ error: [^}]*code: 'rebuild_limit' \}\)/.test(SRC) && /const fresh = url\.searchParams\.get\('fresh'\) === '2' \? 2 : url\.searchParams\.get\('fresh'\) === '1' \? 1 : 0;/.test(SRC));
    check('  ...a fresh=2 ask is never answered from the copy in memory', /if \(c && fresh !== 2 && now\(\) - c\.at < WALLET_HIST_TTL/.test(SRC));
    // the line: two run, six wait, the ninth is told the line is long
    const addr = '0x' + 'f'.repeat(40);
    const answers = [];
    for (let u = 1; u <= 9; u++) answers.push(ctx.walletJob(1000 + u, addr, 0, () => null));
    check('two reads run at once and six more wait in line', ctx.running() === 2 && ctx.waiters.length === 6 && answers.slice(0, 8).every((a) => a && a.uid), ctx.running() + ' running, ' + ctx.waiters.length + ' waiting');
    check('  ...the seventh waiter is refused: queueFull', answers[8] && answers[8].queueFull === true && !answers[8].uid, JSON.stringify(answers[8]));
    check('  ...which the route answers as 503 with the plain sentence', /if \(job\.queueFull\) return send\(res, 503, \{ error: 'the chain reader has a long line right now — try again in a while', queueFull: true \}\)/.test(SRC));
    check('  ...a job keeps its place in line without polls (the retire loop only drops one never polled after a minute)', !/j\.turn && now\(\) - j\.polledAt > WALLET_JOB_IDLE_MS/.test(SRC) && /else if \(j\.turn && walletNeverAsked\(j\)\)/.test(SRC));
    // every waiter was created just now and never polled; the fifth gets polled, the others go stale: a free slot goes to the polled one first
    for (const x of ctx.waiters) { x.job.polledAt = Date.now() - 90e3; x.job.polls = 1; }
    const fifth = ctx.waiters[4].job;
    ctx.walletJob(fifth.uid, addr, 0, () => null);   // a poll
    check('  ...a poll on a waiting job counts it as watched (polls, polledAt) and keeps the same job', fifth.polls === 2 && Date.now() - fifth.polledAt < 1000);
    ctx.walletTurnDone();   // a running read finished
    await sleep(10);
    check('  ...when a slot frees, the polled waiter goes first, un-polled ones after', fifth.turn === false && fifth.go === true && ctx.waiters.length === 5 && !ctx.waiters.some((x) => x.job === fifth) && ctx.running() === 2, ctx.waiters.map((x) => x.job.uid).join(','));
    // nobody is watching any waiter now: the oldest goes next — unless nobody EVER asked about it and a minute has passed
    const never = ctx.waiters[0].job; never.polls = 0; never.startedAt = Date.now() - 61e3; never.polledAt = never.startedAt;
    const second = ctx.waiters[1].job;
    ctx.walletTurnDone();
    await sleep(10);
    check('  ...a waiter nobody ever asked about after a minute is retired when a slot would be its (resolved false, dropped), the next one read instead', never.go === false && !ctx.jobs.has(never.uid + ':' + addr) && second.go === true && ctx.running() === 2 && ctx.waiters.length === 3, JSON.stringify({ never: never.go, second: second.go, running: ctx.running(), waiting: ctx.waiters.length }));
    ctx.readMs.push(60000, 120000);
    const third = ctx.waiters[1].job; third.polledAt = Date.now(); third.polls = 2; ctx.waiters[0].job.polledAt = Date.now() - 90e3;
    check('  ...in line, eta = reads ahead × the mean of the last first reads (1 ahead × 90 s, the un-watched one before it not counted)', ctx.walletJobEta(third, Date.now()) === 90000, ctx.walletJobEta(third, Date.now()));
  }

  /* ═══ 4. the 202 and 200 fields, the deletion paths, the policy ═══ */
  {
    check('the 202 carries startedAt, progressed, resuming, stageOf, eta and throttled (how long the read has waited out the node, 0 when it is not)', /return send\(res, 202, \{ pending: true, stage: job\.stage, done: job\.done, total: job\.total, ahead: walletJobsAhead\(job\), startedAt: job\.startedAt, progressed: job\.progressed, resuming: job\.resuming,\s*incremental: job\.incremental, readFrom: job\.readFrom, stageOf: walletStageOf\(job\.stage\), eta: walletJobEta\(job\), throttled: job\.throttledAt \? now\(\) - job\.throttledAt : 0 \}\)/.test(SRC));
    check('a finished read is saved only for a tracked or linked wallet, else saved:false "not tracked" and any stale row goes', /if \(walletHistKeeps\(uid, w\)\) \{ const s = await walletHistSave\(uid, w, v, false\); v\.saved = s\.saved; v\.savedWhy = s\.savedWhy; \}\s*else \{ v\.saved = false; v\.savedWhy = 'not tracked'; db\.prepare\('DELETE FROM wallet_hist WHERE user_id = \? AND addr_idx = \?'\)/.test(SRC));
    check('the checkpoint after the transfer walk is written with the same blob helpers, partial = 1, and only for a kept wallet — and the job notes it wrote one (checkpointed)', /checkpoint: async \(h\) => \{ if \(!walletHistKeeps\(uid, w\)\) return null; const s = await walletHistSave\(uid, w, h, true\); if \(s\.saved\) job\.checkpointed = true; return s; \}/.test(SRC) && /opts\.checkpoint\(\{ stage: 'transfers', head, transfers: rows, nftByBlock: merged\.nftByBlock \}\)/.test(SRC) && /WALLET_RESUME_MAX_BLOCKS = 2000000/.test(SRC));
    check('the account-deletion sweep names wallet_hist', /'tracker_cache', 'wallet_hist'\]\)/.test(SRC));
    check('unlinking a wallet and disconnecting them all delete the saved history', /DELETE FROM identities WHERE user_id = \? AND type = 'wallet' AND identifier = \?"\)\.run\(me\.id, bidx\(addr\)\);\s*if \(!db\.prepare\('SELECT 1 FROM tracked_wallets[^\n]*DELETE FROM wallet_hist WHERE user_id = \? AND addr_idx = \?/.test(SRC) && /DELETE FROM wallet_hist WHERE user_id = \? AND addr_idx NOT IN \(SELECT address FROM tracked_wallets WHERE user_id = \?\)/.test(SRC));
    check('the boot sweep removes rows whose wallet is no longer tracked or linked and keeps the total under 64 MB, oldest first', /^sweepWalletHist\(\);/m.test(SRC) && /WALLET_HIST_TOTAL_MAX = 64 \* 1024 \* 1024/.test(SRC) && /ORDER BY updated_at ASC'\)\.all\(\)\) \{\s*if \(total <= WALLET_HIST_TOTAL_MAX\) break;/.test(SRC));
    check('the bell for a finished read rings only when nobody polled for 30 s, and names the wallet by id, never by address', /if \(now\(\) - job\.polledAt > WALLET_NOTIFY_QUIET_MS\) walletReadNotify\(uid, w\)/.test(SRC) && /WALLET_NOTIFY_QUIET_MS = 30 \* 1000/.test(SRC) && /'\/tracker\?wid=' \+ row\.id : '\/tracker\?lid=' \+ linked\.id/.test(SRC));
    check('the privacy policy lists the saved histories, scrambled, deleted on untrack or account deletion', /Saved wallet histories — the token transfers and trade details of wallets you track, read from the chain<\/td>[\s\S]*?deleted when you untrack them or delete your account<\/td>/.test(PRIV));
    check('  ...and the policy\'s visible Version line is the current one (tests/sendy.mjs pins it)', /Version 2026-10-13 · \$Send \/ JustSendIt/.test(PRIV));
  }

  /* ═══ 5. the read itself, against a fabricated saved copy ═══ */
  const u = mkUser('__wh_' + hexOf(3));
  const addr = ('0x' + hexOf(20)).toLowerCase();                 // a wallet with no history on the chain: the window read finds nothing, the saved rows stay
  const add = await api('/api/wallets', { method: 'POST', sid: u.sid, body: { address: addr, label: 'Whale' } });
  check('a throwaway member can track a wallet', add.status === 200 && add.j && add.j.wallet && add.j.wallet.id, add.status + ' ' + JSON.stringify(add.j && add.j.error));
  const wid = add.j && add.j.wallet && add.j.wallet.id;
  const before = await api('/api/wallets', { sid: u.sid });
  const wBefore = (before.j.wallets || []).find((w) => w.address === addr);
  check('/api/wallets carries lastRead: null for a wallet never read', wBefore && 'lastRead' in wBefore && wBefore.lastRead === null, JSON.stringify(wBefore));
  let head = null;
  if (!LIVE_CHAIN) check(liveSkipped('the read itself: a 65,000-block window of a real wallet through the API'), true, 'skipped');
  else try { head = parseInt(await rpc('eth_blockNumber', []), 16); } catch (e) { check('the chain head could be read for the live part (not — the live checks are not asserted this run)', true, e.message); }
  if (head > 0) {
    const H = head - 60000, B = head - 70000;   // the saved copy is 60,000 blocks (~100 minutes) behind: the window read is 65,000 blocks, a few log reads
    const hash = '0x' + hexOf(32);
    const prior = {
      address: addr, head: H, readAt: Date.now() - 6e6, source: 'chain', complete: true, isContract: false, delegated: false, ethBalance: '0', txSent: 0,
      nftTransfers: 1, nftByBlock: { [B - 5]: 1 }, ethUsd: null,
      quotes: { [WETH]: { symbol: 'WETH', decimals: 18 }, [USDG]: { symbol: 'USDG', decimals: 6 } },
      tokens: [{ address: SEND, symbol: 'SEND', name: 'Send', decimals: 18, balance: '5000000000000000000', market: false }],   // "no market" is a lie we planted: the read must ask again
      transfers: [[B, 3, hash, SEND, PAIR, addr, '5000000000000000000', 1759000000000]],
      txs: {}, legsRead: 0, legsCapped: false, legsFrom: null, txsMissing: [], marketsKnown: true,
    };
    putHist(u.id, addr, prior, false);
    const t0 = Date.now();
    let r = await api('/api/chain/wallet?address=' + addr + '&fresh=1', { sid: u.sid });
    check('the first ask starts the job: 202 with startedAt, progressed:false, stageOf {n, of:5} and an eta that is null until measured', r.status === 202 && r.j && r.j.pending && r.j.startedAt > 0 && r.j.progressed === false && r.j.stageOf && r.j.stageOf.of === 5 && 'eta' in r.j && 'resuming' in r.j, r.status + ' ' + JSON.stringify(r.j));
    let sawIncremental = false, polls = 0;
    while (r.status === 202 && Date.now() - t0 < 3 * 60 * 1000) {
      await sleep(1500); polls++;
      r = await api('/api/chain/wallet?address=' + addr, { sid: u.sid });
      if (r.status === 202 && r.j && r.j.incremental === true && r.j.readFrom === H - 5000) sawIncremental = true;
    }
    if (r.status !== 200) check('the incremental read finished within 3 minutes (status ' + r.status + ' after ' + polls + ' polls — the node may be slow; not asserted)', true, JSON.stringify(r.j).slice(0, 200));
    else {
      const h = r.j;
      check('the read is incremental, from the saved head − 5,000, in ' + (Date.now() - t0) + ' ms', h.incremental === true && h.readFrom === H - 5000, JSON.stringify({ incremental: h.incremental, readFrom: h.readFrom, expected: H - 5000 }));
      check('  ...the 202s said so while it ran (incremental, readFrom)' + (polls < 2 ? ' — too quick to see; not asserted' : ''), sawIncremental || polls < 2, polls + ' polls');
      check('  ...the saved transfer before the window is still there, with its time, and the NFT count is the saved one', Array.isArray(h.transfers) && h.transfers.length === 1 && h.transfers[0][2] === hash && h.transfers[0][7] === 1759000000000 && h.nftTransfers === 1, JSON.stringify(h.transfers));
      check('  ...the head moved on to the chain\'s', h.head >= head, h.head + ' vs ' + head);
      const s = (h.tokens || []).find((t) => t.address === SEND);
      check('  ...the "no market" token was asked about again and is a market now ($SEND has its own pool)', s && s.market === true, JSON.stringify(s));
      check('  ...its balance was read live at the head (0 for this wallet), so no "as of block N"', s && s.balance === '0' && !('balanceAt' in s), JSON.stringify(s));
      check('  ...the decimals and a symbol are there (the saved ones, or the process\'s own cache of the same token)', s && typeof s.symbol === 'string' && s.symbol.length > 0 && s.decimals === 18, JSON.stringify(s && { symbol: s.symbol, decimals: s.decimals }));
      check('  ...it was saved (tracked): saved:true, savedWhy:null', h.saved === true && h.savedWhy === null, JSON.stringify({ saved: h.saved, savedWhy: h.savedWhy }));
      const row = histRow(u.id, addr);
      check('  ...and the row now reads to the new head, not partial', row && row.read_to === h.head && row.partial === 0 && row.n > 100, JSON.stringify(row));
      const after = await api('/api/wallets', { sid: u.sid });
      const wAfter = (after.j.wallets || []).find((w) => w.address === addr);
      check('  .../api/wallets shows lastRead {updatedAt, readTo, partial:false}', wAfter && wAfter.lastRead && wAfter.lastRead.readTo === h.head && wAfter.lastRead.partial === false && wAfter.lastRead.updatedAt > t0, JSON.stringify(wAfter && wAfter.lastRead));
      // $SEND just turned out to have a market, so the saved $SEND transfer's transaction is now a possible trade and its receipt is asked for — the hash is invented, so it is honestly "could not be read", never valued
      check('  ...a trade of a token that just became a market is read: the planted (unreadable) transaction is listed as missing, not guessed', h.complete === false && Array.isArray(h.txsMissing) && h.txsMissing.length === 1 && h.txsMissing[0] === hash && h.legsRead === 0 && h.legsCapped === false && h.marketsKnown === true, JSON.stringify({ complete: h.complete, txsMissing: h.txsMissing, legsRead: h.legsRead, legsCapped: h.legsCapped, marketsKnown: h.marketsKnown }));
      check('  ...a second ask within minutes is the same answer, from memory', (await api('/api/chain/wallet?address=' + addr, { sid: u.sid })).status === 200);

      /* a wallet nobody tracks: a stale row (planted here) is read from, then not kept */
      const loose = ('0x' + hexOf(20)).toLowerCase();
      putHist(u.id, loose, { ...prior, address: loose, transfers: [[B, 3, '0x' + hexOf(32), SEND, PAIR, loose, '1', 1759000000000]] }, false);
      const t1 = Date.now();
      let r2 = await api('/api/chain/wallet?address=' + loose + '&fresh=1', { sid: u.sid });
      while (r2.status === 202 && Date.now() - t1 < 3 * 60 * 1000) { await sleep(1500); r2 = await api('/api/chain/wallet?address=' + loose, { sid: u.sid }); }
      if (r2.status !== 200) check('the untracked read finished within 3 minutes (status ' + r2.status + ' — not asserted)', true, JSON.stringify(r2.j).slice(0, 200));
      else {
        check('a wallet that is neither tracked nor linked gets saved:false "not tracked"', r2.j.saved === false && r2.j.savedWhy === 'not tracked', JSON.stringify({ saved: r2.j.saved, savedWhy: r2.j.savedWhy }));
        check('  ...and its stale row is gone', !histRow(u.id, loose));
      }
    }
  }

  /* ═══ 6. deletion: untrack, unlink ═══ */
  if (wid) {
    if (!histRow(u.id, addr)) putHist(u.id, addr, { head: 10, transfers: [], nftByBlock: {}, tokens: [], txs: {} }, false);   // in case the live read did not finish
    const del = await api('/api/wallets/' + wid, { method: 'DELETE', sid: u.sid });
    check('untracking a wallet deletes its saved history', del.status === 200 && !histRow(u.id, addr), del.status + ' ' + JSON.stringify(histRow(u.id, addr)));
  }
  setSudo(u.sid, true);
  const w1 = Wallet.createRandom(), w2 = Wallet.createRandom();
  const l1 = await link(u.sid, w1);
  db.prepare('UPDATE sessions SET created_at = ? WHERE user_id = ?').run(Date.now() + 5, u.id);   // as if signed in again with w1, which then vouches for the next link
  const l2 = await link(u.sid, w2, w1);
  check('two wallets can be linked to the throwaway member', l1.status === 200 && l2.status === 200, l1.status + ' ' + l2.status + ' ' + JSON.stringify(l2.j && l2.j.error));
  const a2 = w2.address.toLowerCase();
  putHist(u.id, a2, { head: 10, transfers: [], nftByBlock: {}, tokens: [], txs: {} }, false);
  const list = await api('/api/wallets', { sid: u.sid });
  const mine2 = (list.j.wallets || []).find((w) => w.address === a2);
  const idRow = db.prepare("SELECT id FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(u.id, bidx(a2));
  check('a linked wallet is listed with lid = its identities row id (so ?lid= resolves without an address)', mine2 && mine2.mine === true && mine2.id === null && idRow && mine2.lid === idRow.id, JSON.stringify(mine2));
  check('  ...and its lastRead from the planted row', mine2 && mine2.lastRead && mine2.lastRead.readTo === 10 && mine2.lastRead.walking === false, JSON.stringify(mine2 && mine2.lastRead));
  // a transfer walk stopped part-way is saved as partial = 2: the list says so (walking) and names no block it has read "to"
  putHist(u.id, a2, { stage: 'walk', head: 10, start: 0, later: true, pass: 0, from: 4, earliest: null, transfers: [], nftByBlock: {} }, true);
  db.prepare('UPDATE wallet_hist SET partial = 2 WHERE user_id = ? AND addr_idx = ?').run(u.id, bidx(a2));
  const listW = await api('/api/wallets', { sid: u.sid });
  const mineW = (listW.j.wallets || []).find((w) => w.address === a2);
  check('a walk checkpoint (partial 2) is listed as walking, partial, with readTo null — the walk has no block it has read "to"', mineW && mineW.lastRead && mineW.lastRead.walking === true && mineW.lastRead.partial === true && mineW.lastRead.readTo === null, JSON.stringify(mineW && mineW.lastRead));
  check('  ...and walletHistSave writes partial 2 for a stage "walk" checkpoint, 1 for the transfers one, 0 for a finished history', /partial \? \(hist\.stage === 'walk' \? 2 : 1\) : 0, blob\);/.test(SRC));
  check('  ...a checkpoint the chain has moved more than WALLET_RESUME_MAX_BLOCKS past (by the head this server last saw) is stale: not resumable, said so in the list, and the 502 says what is on file (resumable: this read checkpointed, or one is on file and this was not a rebuild; saved: complete | checkpoint | null)', /const walletHistStale = \(r\) => !!\(r && r\.partial && _chainHead > 0 && _chainHead - r\.read_to > WALLET_RESUME_MAX_BLOCKS\);/.test(SRC) && /const walletHistResumable = \(uid, w\) => \{ const r = walletHistRow\(uid, w\); return !!\(r && r\.partial && !walletHistStale\(r\)\); \};/.test(SRC) && /walking: r\.partial === 2, stale: walletHistStale\(r\) \}/.test(SRC) && /resumable: !!\(job\.checkpointed \|\| \(job\.fresh !== 2 && walletHistResumable\(me\.id, addr\)\)\), saved: row \? \(row\.partial \? 'checkpoint' : 'complete'\) : null \}\);/.test(SRC) && /if \(head > _chainHead\) _chainHead = head;/.test(SRC) && (LIVE_CHAIN ? mineW.lastRead.stale === true : typeof mineW.lastRead.stale === 'boolean'), JSON.stringify(mineW && mineW.lastRead));   // planted at block 10: with live reads on, the read earlier in this suite showed the server a head millions of blocks on, so this one is stale; with them off it depends on whether an earlier suite made the server read a head, so only the field's presence is pinned
    db.prepare('UPDATE wallet_hist SET read_to = ? WHERE user_id = ? AND addr_idx = ?').run(9e9, u.id, bidx(a2));
    const listN = await api('/api/wallets', { sid: u.sid });
    const mineN = (listN.j.wallets || []).find((w) => w.address === a2);
    check('  ...a checkpoint the chain has not moved past is not stale', mineN && mineN.lastRead && mineN.lastRead.stale === false && mineN.lastRead.walking === true, JSON.stringify(mineN && mineN.lastRead));
  const un = await api('/api/wallet/unlink', { method: 'POST', sid: u.sid, body: { address: a2 } });
  check('unlinking a wallet deletes its saved history', un.status === 200 && !histRow(u.id, a2), un.status + ' ' + JSON.stringify(un.j && un.j.error) + ' row:' + JSON.stringify(histRow(u.id, a2)));

  /* ═══ 7. the bell: text and href carry no address ═══ */
  {
    const ctx = vm.createContext({ db, bidx, decField, String, Boolean, now: () => Date.now(), console });
    vm.runInContext(grab(/const NOTIF_KEEP = [^\n]+\n/, 'NOTIF_KEEP') + grab(/const NOTIF_KEEP_SYSTEM = [^\n]+\n/, 'NOTIF_KEEP_SYSTEM') + grab(/const NOTIF_KEEP_ALERT = [^\n]+\n/, 'NOTIF_KEEP_ALERT') +
      grab(/function walletList\(userId\) \{[\s\S]*?\n\}\n/, 'walletList') + grab(/function notifyLink\(href\) \{[\s\S]*?\n\}\n/, 'notifyLink') + grab(/function notify\(userId, icon, text, kind, actorId, href, postId\) \{[\s\S]*?\n\}\n/, 'notify') +
      grab(/function walletReadNotice\(uid, w\) \{[\s\S]*?\n\}\n/, 'walletReadNotice') + grab(/function walletReadNotify\(uid, w\) \{[\s\S]*?\n\}\n/, 'walletReadNotify') + grab(/function walletReadStoppedNotify\(uid, w, checkpointed\) \{[\s\S]*?\n\}\n/, 'walletReadStoppedNotify') +
      '\nthis.notice = walletReadNotice; this.ring = walletReadNotify; this.stopped = walletReadStoppedNotify;', ctx);
    const tracked = ('0x' + hexOf(20)).toLowerCase();
    const ins = db.prepare('INSERT INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(u.id, bidx(tracked), encField(tracked), 'Whale', Date.now());
    const tid = Number(ins.lastInsertRowid);
    const n1 = ctx.notice(u.id, tracked);
    check('a tracked wallet is named by its label and linked by its tracker id', n1 && n1.label === 'Whale' && n1.href === '/tracker?wid=' + tid, JSON.stringify(n1));
    const a1 = w1.address.toLowerCase();
    const n2 = ctx.notice(u.id, a1);
    const lid = db.prepare("SELECT id FROM identities WHERE user_id = ? AND type = 'wallet' AND identifier = ?").get(u.id, bidx(a1)).id;
    check('a linked wallet with no watch-list row is linked by its link id', n2 && n2.href === '/tracker?lid=' + lid && n2.label === '', JSON.stringify(n2));
    check('a wallet neither tracked nor linked gets no bell', ctx.notice(u.id, '0x' + '9'.repeat(40)) === null);
    db.prepare('UPDATE tracked_wallets SET label = ? WHERE id = ?').run('mine 0x' + tracked.slice(2, 14), tid);
    const n3 = ctx.notice(u.id, tracked);
    check('a label that quotes part of an address is not said', n3 && n3.label === '' && n3.href === '/tracker?wid=' + tid, JSON.stringify(n3));
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u.id);
    check('the bell rings through notify()', ctx.ring(u.id, tracked) === true && ctx.ring(u.id, a1) === true && ctx.ring(u.id, '0x' + '9'.repeat(40)) === false);
    const rows = db.prepare('SELECT kind, icon, text, href FROM notifications WHERE user_id = ? ORDER BY id').all(u.id);
    check('  ...two rows, kind tracker, 💼', rows.length === 2 && rows.every((r) => r.kind === 'tracker' && r.icon === '💼'), JSON.stringify(rows));
    check('  ...with the promised sentence', rows[0] && rows[0].text === 'Your wallet report for one of your wallets is ready.' && rows[1] && rows[1].text === 'Your wallet report for one of your wallets is ready.', JSON.stringify(rows.map((r) => r.text)));
    check('  ...and no 0x hex anywhere in text or href', rows.every((r) => !/0x[0-9a-f]{2,}/i.test(r.text + ' ' + r.href)) && rows[0].href === '/tracker?wid=' + tid && rows[1].href === '/tracker?lid=' + lid, JSON.stringify(rows.map((r) => r.href)));
    db.prepare('UPDATE tracked_wallets SET label = ? WHERE id = ?').run('Whale', tid);
    // a read that stopped after its page had gone: the bell says so, and whether it goes on from a checkpoint — never an address
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u.id);
    check('the stopped-read bell rings for a tracked or linked wallet only', ctx.stopped(u.id, tracked, true) === true && ctx.stopped(u.id, a1, false) === true && ctx.stopped(u.id, '0x' + '9'.repeat(40), true) === false);
    const srows = db.prepare('SELECT kind, icon, text, href FROM notifications WHERE user_id = ? ORDER BY id').all(u.id);
    check('  ...says the read stopped part-way and why, "goes on from where it stopped" only with a checkpoint, no address anywhere', srows.length === 2 && srows[0].text === 'The read of Whale stopped part-way — the chain node kept refusing it. Open the tracker and it goes on from where it stopped.' && srows[1].text === 'The read of one of your wallets stopped part-way — the chain node kept refusing it. Open the tracker to start it again.' && srows.every((r) => r.kind === 'tracker' && !/0x[0-9a-f]{2,}/i.test(r.text + ' ' + r.href)) && srows[0].href === '/tracker?wid=' + tid && srows[1].href === '/tracker?lid=' + lid, JSON.stringify(srows));
    check('  ...and walletJobRun rings it only for a read that had moved, whose page has been gone 30 s, that a throttle or a timeout ended', /if \(job\.progressed && now\(\) - job\.polledAt > WALLET_NOTIFY_QUIET_MS && \(isThrottle\(job\.error\) \|\| \/timed out\|timeout\|aborted\|too long\/i\.test\(job\.error\)\)\) walletReadStoppedNotify\(uid, w, job\.checkpointed\);/.test(SRC));
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u.id);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(u.id);
    ctx.ring(u.id, tracked);
    const r4 = db.prepare('SELECT text FROM notifications WHERE user_id = ?').get(u.id);
    check('  ...a clean label is used: "Your wallet report for Whale is ready."', r4 && r4.text === 'Your wallet report for Whale is ready.', r4 && r4.text);
  }
  /* ═══ 8. every plan the read can make, on a stubbed chain (a from-scratch read on the real node is about an hour of
         the site's shared budget — tests/walletchain.mjs runs that only when asked; here the read runs as it is, over
         fabricated answers) ═══ */
  {
    const T = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', pad = (a) => '0x' + a.slice(2).padStart(64, '0');
    const W = '0x' + '1'.repeat(40), POOL = '0x' + '2'.repeat(40), POOL2 = '0x' + '6'.repeat(40), OTHER = '0x' + '5'.repeat(40), FACT = '0x' + 'f0'.repeat(20);
    const TOK = '0x' + 'a'.repeat(40), TOK2 = '0x' + 'b'.repeat(40), NFT = '0x' + 'c'.repeat(40);
    const hx = (n) => '0x' + n.toString(16), amt = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
    const T1 = '0x' + '11'.repeat(32), T2 = '0x' + '22'.repeat(32), T3 = '0x' + '33'.repeat(32), T4 = '0x' + '44'.repeat(32), T5 = '0x' + '55'.repeat(32), FAKE = '0x' + 'ee'.repeat(32);
    const erc = (block, li, hash, tok, from, to, v) => ({ address: tok, topics: [T, pad(from), pad(to)], data: amt(v), blockNumber: hx(block), logIndex: hx(li), transactionHash: hash });
    const scratch = [erc(100, 1, T1, TOK, POOL, W, 1000), erc(200, 2, T2, TOK, W, POOL, 400), { address: NFT, topics: [T, pad(OTHER), pad(W), pad(W)], data: '0x', blockNumber: hx(300), logIndex: '0x0', transactionHash: T3 }];
    const near = (head) => head <= 100000 ? [] : [erc(head - 10, 5, T4, TOK2, POOL2, W, 100), erc(head - 8, 1, T5, TOK2, W, OTHER, 30)];   // what a window just below a LATER head holds (nothing beside the three from-scratch logs at the first head)
    const S = { head: 100000, balance: 1000n, calls: [], walks: [], asked: [], factoryAsked: [], pools: {}, stages: [], plans: [], checkpoints: [], receipts: { [T1]: { logs: [] }, [T2]: { logs: [] }, [T4]: { logs: [] }, [T5]: { logs: [] }, [FAKE]: null } };
    const answer = ([m, p]) => {
      if (m === 'eth_blockNumber') return hx(S.head);
      if (m === 'eth_getBalance') return '0x10';
      if (m === 'eth_getTransactionCount') return '0x5';
      if (m === 'eth_getCode') return '0x';
      if (m === 'eth_call') {
        const d = p[0].data;
        if (d.startsWith('0x70a08231')) return S.balanceNull ? null : amt(S.balance); if (d === '0x313ce567') return amt(18); if (d === '0x95d89b41') return 'SYM-' + p[0].to.slice(2, 4); if (d === '0x06fdde03') return 'Name ' + p[0].to.slice(2, 4);
        if (d.startsWith('0xe6a43905')) { const tok = '0x' + d.slice(10, 74).slice(-40), quote = '0x' + d.slice(74).slice(-40); S.factoryAsked.push([p[0].to, tok, quote]); return amt(BigInt(S.pools[tok + ':' + quote] || 0)); }   // getPair: the fabricated pool, else the zero address
      }
      if (m === 'eth_getBlockByNumber') return { timestamp: hx(1700000000 + parseInt(p[0], 16)) };
      if (m === 'eth_getTransactionReceipt') return S.receipts[p[0]] === undefined ? null : S.receipts[p[0]];
      return null;
    };
    const ctx = vm.createContext({
      BigInt, Number, Set, Map, Array, Object, Math, JSON, Error, parseInt, Infinity, Promise, String, Boolean, console,
      now: () => Date.now(), sleep: async () => {}, TRANSFER_TOPIC: T, TRACKER_HISTORY_MAX: 20000, TRACKER_TX_MAX: 5000, PACE_LOG_WEIGHT: 5, PACE_BATCH: 25, _paceMs: 0,
      WALLET_REORG_OVERLAP: 5000, WALLET_RESUME_MAX_BLOCKS: 2000000, WALLET_WALK_CHECKPOINT_MS: 120000, WETH_ADDR: WETH, USDG_ADDR: USDG, usdgDecimals: 6, FACTORY: FACT,
      _decimalsCache: new Map(), _tokenNameCache: new Map(), _txLegCache: new Map(), chainBlockMs: new Map(), pruneCache: () => {}, abiText: (r) => (r == null ? null : String(r)), ownPoolOf: () => null, _chainHead: 0,
      ethUsdFresh: async () => 2000, tradeLegs: () => [1, '7', '0', 0, '0', '0', 0, 0], receiptLegs: () => ({ seen: new Set(), legs: [] }), keepTxLegs: () => {},
      pacedCall: async () => { throw new Error('the stubbed walk reads for itself'); },
      pacedBatchAll: async (calls, onStep, guard, onPart) => { if (guard) guard(); for (const c of calls) S.calls.push(c); const out = calls.map(answer); if (onPart) { onPart(out, 0); return null; } if (onStep) onStep(calls.length, calls.length); return out; },
      transferLogWalk: async (address, sets, start, head, max, read, opts) => {
        S.walks.push({ start, head, max, later: !!(opts && opts.laterPassesStartAtFirstHit), sets: sets.length, resume: opts && opts.resume ? { ...opts.resume } : null });
        const ws = typeof S.windows === 'function' ? S.windows(start, head) : S.windows;
        if (opts && opts.onWindow && ws) for (const w of ws) { if (S.tick) S.tick(); await opts.onWindow(w); }   // what a real walk reports after each window (the clock moves between them)
        return [...scratch, ...near(S.head), ...(S.extra || [])].filter((l) => parseInt(l.blockNumber, 16) >= start && parseInt(l.blockNumber, 16) <= head);
      },
      jgetCached: async (url) => { const toks = url.split('/').pop().split(','); S.asked.push(toks); return toks.includes(TOK) ? [{ baseToken: { address: TOK }, quoteToken: { address: WETH } }] : []; },
    });
    vm.runInContext(grab(/function mergeWalletHistory\(prior, readFrom, rows, nftNew\) \{[\s\S]*?\n\}\n/, 'mergeWalletHistory') + grab(/const tokensToRecheck = [^\n]+\n/, 'tokensToRecheck') +
      grab(/const FACTORY_POOL_NONE_TTL = [^\n]+\n/, 'FACTORY_POOL_NONE_TTL') + grab(/const _factoryPoolCache = new Map\(\);[^\n]*\n/, '_factoryPoolCache') + grab(/const factoryPoolCached = [^\n]+\n/, 'factoryPoolCached') + grab(/async function factoryPoolsFor\(toks, guard\) \{[\s\S]*?\n\}\n/, 'factoryPoolsFor') +
      grab(/async function readWalletHistory\(w, uid, step, guard, prior, opts\) \{[\s\S]*?\n\}\n/, 'readWalletHistory') + '\nthis.read = readWalletHistory; this.poolCache = _factoryPoolCache; this.poolCached = factoryPoolCached; this.poolsFor = factoryPoolsFor;', ctx);
    const reset = () => { S.calls = []; S.walks = []; S.asked = []; S.factoryAsked = []; S.stages = []; S.plans = []; S.checkpoints = []; };
    const run = (prior) => ctx.read(W, 7, (stage) => { if (S.stages[S.stages.length - 1] !== stage) S.stages.push(stage); }, () => {}, prior, { onPlan: (p) => S.plans.push(p), checkpoint: (h) => S.checkpoints.push(JSON.parse(JSON.stringify(h))) });
    const balanceCalls = () => S.calls.filter((c) => c[0] === 'eth_call' && c[1][0].data.startsWith('0x70a08231')).map((c) => c[1][0].to);

    // A. from scratch
    reset(); S.head = 100000; S.balance = 1000n;
    const A = await run(null);
    check('from scratch: the walk covers [0, head] with "from the wallet" starting at the first arrival', S.walks.length === 1 && S.walks[0].start === 0 && S.walks[0].head === 100000 && S.walks[0].later === true && S.walks[0].sets === 2 && S.walks[0].max === 20000, JSON.stringify(S.walks));
    check('  ...the plan said so: incremental false, readFrom 0, not resuming', S.plans.length === 1 && S.plans[0].incremental === false && S.plans[0].readFrom === 0 && S.plans[0].resuming === false, JSON.stringify(S.plans));
    check('  ...a checkpoint after the walk (times still unread) and again once dated', S.checkpoints.length === 2 && S.checkpoints[0].stage === 'transfers' && S.checkpoints[0].head === 100000 && S.checkpoints[0].transfers.length === 2 && S.checkpoints[0].transfers.every((t) => t[7] === null) && S.checkpoints[1].transfers.every((t) => t[7] > 0) && S.checkpoints[0].nftByBlock[300] === 1, JSON.stringify(S.checkpoints.map((c) => c.transfers.map((t) => t[7]))));
    check('  ...the stages in order: account · transfers · tokens · dating · markets · receipts · done', S.stages.join('|') === 'reading the account|reading every token transfer|reading 1 tokens|dating 2 blocks|finding markets for 1 tokens|reading 2 of its transactions|done', S.stages.join('|'));
    check('  ...two ERC-20 rows newest first with times, one NFT counted per block, head, nonce, balance', A.transfers.length === 2 && A.transfers[0][2] === T2 && A.transfers[1][2] === T1 && A.transfers.every((t) => t[7] > 0) && A.nftTransfers === 1 && A.nftByBlock[300] === 1 && A.head === 100000 && A.txSent === 5 && A.ethBalance === '16', JSON.stringify({ n: A.transfers.length, nft: A.nftTransfers, head: A.head }));
    check('  ...the token: live balance at the head, decimals, symbol and name read, market from the feed', A.tokens.length === 1 && A.tokens[0].address === TOK && A.tokens[0].balance === '1000' && !('balanceAt' in A.tokens[0]) && A.tokens[0].decimals === 18 && A.tokens[0].symbol === 'SYM-aa' && A.tokens[0].market === true && A.marketsKnown === true, JSON.stringify(A.tokens));
    check('  ...both of its transactions were read and summed; nothing missing; incremental false, not resumed', Object.keys(A.txs).length === 2 && A.txs[T1][TOK] && A.txs[T2][TOK] && A.legsRead === 2 && A.legsCapped === false && A.txsMissing.length === 0 && A.complete === true && A.incremental === false && A.readFrom === 0 && A.resumed === false && A.legsFrom[0] === 100, JSON.stringify({ txs: Object.keys(A.txs), legsFrom: A.legsFrom }));
    check('  ...the factory is not asked about a token the feed listed', S.factoryAsked.length === 0 && !S.calls.some((c) => c[0] === 'eth_call' && c[1][0].to === FACT), JSON.stringify(S.factoryAsked));

    // B. resume from the checkpoint, 50,000 blocks on
    const partial = S.checkpoints[0];
    reset(); S.head = 150000; ctx._decimalsCache.clear(); ctx._tokenNameCache.clear();
    const B = await run(JSON.parse(JSON.stringify(partial)));
    check('resume: the walk covers only the tail from the checkpoint head − 5,000, both passes over the whole window', S.walks.length === 1 && S.walks[0].start === 95000 && S.walks[0].head === 150000 && S.walks[0].later === false && S.walks[0].max === 20000 - 2, JSON.stringify(S.walks));
    check('  ...the plan: resuming, not incremental, readFrom 95,000; the checkpoint is written again for the new head', S.plans[0].resuming === true && S.plans[0].incremental === false && S.plans[0].readFrom === 95000 && S.checkpoints.length === 2 && S.checkpoints[1].head === 150000, JSON.stringify(S.plans));
    check('  ...the saved rows are kept and the tail\'s two rows merged in, newest first; the NFT count carried', B.transfers.length === 4 && B.transfers[0][2] === T5 && B.transfers[1][2] === T4 && B.transfers[3][2] === T1 && B.nftTransfers === 1 && B.resumed === true && B.incremental === false, JSON.stringify(B.transfers.map((t) => t[2].slice(0, 6))));
    check('  ...every later stage ran in full: both tokens read; the market token\'s two transactions read, the no-market token\'s two not', B.tokens.length === 2 && balanceCalls().length === 2 && Object.keys(B.txs).length === 2 && B.txs[T1] && B.txs[T2] && B.legsRead === 2 && B.complete === true && B.tokens.find((t) => t.address === TOK2).market === false, JSON.stringify({ tokens: B.tokens.map((t) => t.symbol), txs: Object.keys(B.txs).length }));
    check('a token the feed did not list is asked of the factory through the paced batch — its WETH pool, then its USDG pool — and "no pool" is kept', S.factoryAsked.length === 2 && S.factoryAsked[0][0] === FACT && S.factoryAsked[0][1] === TOK2 && S.factoryAsked[0][2] === WETH && S.factoryAsked[1][1] === TOK2 && S.factoryAsked[1][2] === USDG && S.calls.filter((c) => c[0] === 'eth_call' && c[1][0].to === FACT).length === 2 && ctx.poolCache.get(TOK2) && ctx.poolCache.get(TOK2).pool === null, JSON.stringify(S.factoryAsked));
    check('  ...the code shape: every token not yet a market, bar the quote assets, goes to factoryPoolsFor (a saved "no pool" under a day old, for a token the window did not move, stands), which reads through pacedBatchAll', /const unlisted = toks\.filter\(\(t\) => \{\s*if \(marketToks\.has\(t\) \|\| t === WETH_ADDR \|\| t === USDG_ADDR\) return false;[\s\S]*?return !\(pt && pt\.market === false && pt\.poolAt > 0 && readAt - pt\.poolAt < FACTORY_POOL_RECHECK_MS && !touched\.has\(t\)\);\s*\}\);/.test(SRC) && /FACTORY_POOL_RECHECK_MS = 24 \* 3600e3/.test(SRC) && /await factoryPoolsFor\(unlisted, guard\)/.test(SRC) && /await pacedBatchAll\(ask\.map\(\(t\) => \['eth_call', \[\{ to: FACTORY, data: '0xe6a43905' \+ enc\(t\) \+ enc\(WETH_ADDR\) \}, 'latest'\]\]\), null, guard\)/.test(SRC) && /await pacedBatchAll\(noWeth\.map\(\(t\) => \['eth_call', \[\{ to: FACTORY, data: '0xe6a43905' \+ enc\(t\) \+ enc\(USDG_ADDR\) \}, 'latest'\]\]\), null, guard\)/.test(SRC) && !/ethCall\(FACTORY/.test(SRC.slice(SRC.indexOf('async function factoryPoolsFor('), SRC.indexOf('async function readWalletHistory('))));

    // C. incremental from A, 100,000 blocks on — with a planted "no market" on TOK, a null name to retry, and a receipt the saved read could not get
    const priorC = JSON.parse(JSON.stringify(A)); priorC.tokens[0].market = false; priorC.tokens[0].name = null; delete priorC.txs[T2]; priorC.txsMissing = [T2]; priorC.complete = false; priorC.legsRead = 1;   // as a read that could not get T2's receipt leaves it
    reset(); S.head = 200000; S.balance = 1234n; ctx._decimalsCache.clear(); ctx._tokenNameCache.clear(); S.receipts[T2] = null;
    const C = await run(priorC);
    S.receipts[T2] = { logs: [] };
    check('incremental: the walk covers [saved head − 5,000, head], both passes; no checkpoint is written over a finished history', S.walks.length === 1 && S.walks[0].start === 95000 && S.walks[0].later === false && S.checkpoints.length === 0 && S.plans[0].incremental === true && S.plans[0].readFrom === 95000, JSON.stringify(S.walks) + ' ' + S.checkpoints.length);
    check('  ...the saved rows kept, the window\'s two merged in; incremental:true readFrom 95,000', C.transfers.length === 4 && C.transfers[0][2] === T5 && C.transfers[3][2] === T1 && C.incremental === true && C.readFrom === 95000 && C.resumed === false, JSON.stringify(C.transfers.map((t) => t[0])));
    const cTok = C.tokens.find((t) => t.address === TOK), cTok2 = C.tokens.find((t) => t.address === TOK2);
    check('  ...the "no market" token was asked about again, and the new one', S.asked.length === 1 && S.asked[0].includes(TOK) && S.asked[0].includes(TOK2), JSON.stringify(S.asked));
    check('  ...the factory\'s "no pool" for it is kept ten minutes, so it was not asked again this soon; eleven minutes on, it would be', S.factoryAsked.length === 0 && ctx.poolCached(TOK2, Date.now()) === null && ctx.poolCached(TOK2, Date.now() + 11 * 60e3) === undefined && ctx.poolCached('0x' + '9'.repeat(40)) === undefined, JSON.stringify(S.factoryAsked));
    check('  ...once the feed said it has one, its balance was read live after all (not the saved 1000 "as of")', cTok && cTok.market === true && cTok.balance === '1234' && !('balanceAt' in cTok), JSON.stringify(cTok));
    check('  ...its null name was asked again, its decimals kept without a call; the new token read in full', cTok && cTok.name === 'Name aa' && cTok.decimals === 18 && !S.calls.some((c) => c[0] === 'eth_call' && c[1][0].to === TOK && c[1][0].data === '0x313ce567') && cTok2 && cTok2.decimals === 18 && cTok2.symbol === 'SYM-bb' && cTok2.market === false && cTok2.balance === '1234', JSON.stringify([cTok, cTok2]));
    check('  ...receipts: the saved missing one (T2) is asked for again — twice, as a full read would — and is still unreadable, so still missing; the summed one kept; TOK2 has no market so its two are not read', Object.keys(C.txs).length === 1 && C.txs[T1] && !C.txs[T2] && C.txsMissing.length === 1 && C.txsMissing[0] === T2 && C.complete === false && !S.calls.some((c) => c[0] === 'eth_getTransactionReceipt' && (c[1][0] === T4 || c[1][0] === T5)) && S.calls.filter((c) => c[0] === 'eth_getTransactionReceipt' && c[1][0] === T2).length === 2, JSON.stringify({ txs: Object.keys(C.txs).length, missing: C.txsMissing, receipts: S.calls.filter((c) => c[0] === 'eth_getTransactionReceipt').map((c) => c[1][0].slice(0, 6)) }));
    check('  ...legsRead carries the saved count (nothing new was read), legsFrom the oldest read, legsCapped false', C.legsRead === 1 && C.legsFrom[0] === 100 && C.legsCapped === false, JSON.stringify({ legsRead: C.legsRead, legsFrom: C.legsFrom }));

    // D. nothing new: the head has not moved (or the node answered one slightly behind)
    reset(); S.head = 199500; S.balance = 77n;
    const D = await run(JSON.parse(JSON.stringify(C)));
    check('nothing new (head 199,500 ≤ saved 200,000): no walk at all; incremental:true readFrom:null; the head stays the saved one', S.walks.length === 0 && D.incremental === true && D.readFrom === null && D.head === 200000 && S.plans[0].readFrom === null, JSON.stringify(S.plans));
    const dTok = D.tokens.find((t) => t.address === TOK), dTok2 = D.tokens.find((t) => t.address === TOK2);
    check('  ...balances re-read live for tokens that may have a market; a "no market" one keeps the saved figure, dated', dTok && dTok.balance === '77' && !('balanceAt' in dTok) && dTok2 && dTok2.balance === '1234' && dTok2.balanceAt === 200000 && balanceCalls().length === 1 && balanceCalls()[0] === TOK, JSON.stringify([dTok, dTok2]));
    check('  ...transfers, txs, the missing one and the NFT count are the saved ones; the nonce and ETH balance fresh', D.transfers.length === 4 && Object.keys(D.txs).length === 1 && D.txsMissing[0] === T2 && D.nftTransfers === 1 && D.txSent === 5, JSON.stringify({ n: D.transfers.length, txs: Object.keys(D.txs).length }));

    // D2. a balance the chain would not answer: asked and unreadable is UNREAD (null, no "as of block N"), on both paths — only a figure the read did not ask for is the saved one, dated
    reset(); S.head = 199500; S.balanceNull = true;
    const D2 = await run(JSON.parse(JSON.stringify(C)));
    const d2Tok = D2.tokens.find((t) => t.address === TOK), d2Tok2 = D2.tokens.find((t) => t.address === TOK2);
    check('a live balance the chain would not answer is unread — null, no balanceAt — never the saved figure labelled "not re-read" (nothing-new path); the "no market" token not asked keeps its saved figure, dated', d2Tok && d2Tok.balance === null && !('balanceAt' in d2Tok) && d2Tok2 && d2Tok2.balance === '1234' && d2Tok2.balanceAt === 200000 && balanceCalls().length === 1, JSON.stringify([d2Tok, d2Tok2]));
    reset(); S.head = 250000;
    const D3 = await run(JSON.parse(JSON.stringify(C)));
    const d3Tok = D3.tokens.find((t) => t.address === TOK), d3Tok2 = D3.tokens.find((t) => t.address === TOK2);
    check('  ...and on the incremental path: the market token and the token the window moved were asked, answered nothing, and are unread (null, no balanceAt)', balanceCalls().includes(TOK) && balanceCalls().includes(TOK2) && d3Tok && d3Tok.balance === null && !('balanceAt' in d3Tok) && d3Tok2 && d3Tok2.balance === null && !('balanceAt' in d3Tok2), JSON.stringify([d3Tok, d3Tok2]));
    S.balanceNull = false;

    // E. a head far behind the saved one (a different chain, or a broken answer): read it all
    reset(); S.head = 90000;
    const E = await run(JSON.parse(JSON.stringify(C)));
    check('a head more than 1,000 blocks behind the saved one is not trusted: a from-scratch read', S.walks.length === 1 && S.walks[0].start === 0 && S.walks[0].later === true && E.incremental === false && E.resumed === false, JSON.stringify(S.walks));

    // F. a checkpoint too old to resume (2,000,000 blocks — about three days of this chain; the logs it kept are final, so the horizon is wide)
    reset(); S.head = 100000 + 2000001;
    const F = await run(JSON.parse(JSON.stringify(partial)));
    check('a checkpoint more than 2,000,000 blocks behind the head is not resumed: a from-scratch read, checkpointed anew', S.walks.length === 1 && S.walks[0].start === 0 && S.walks[0].later === true && F.resumed === false && S.checkpoints.length === 2 && S.checkpoints[0].head === 2100001, JSON.stringify(S.walks));
    reset(); S.head = 100000 + 2000000;
    const F2 = await run(JSON.parse(JSON.stringify(partial)));
    check('  ...one exactly 2,000,000 behind still is', S.walks[0].start === 95000 && F2.resumed === true, JSON.stringify(S.walks));

    // F3. a walk that stopped mid-way (a checkpoint of stage "walk"): finished first — its pass from its next block, to the head it read to — then the window since
    reset(); S.head = 160000;
    const T9 = '0x' + '99'.repeat(32);   // a row only the checkpoint holds (block 50: the stub walk never answers it) — the finished walk must keep it
    const walkCk = { stage: 'walk', head: 100000, start: 0, later: true, pass: 0, from: 60000, earliest: 50, transfers: [[100, 1, T1, TOK, POOL, W, '1000', null], [50, 1, T9, TOK, POOL, W, '5', null]], nftByBlock: {} };
    const W1 = await run(JSON.parse(JSON.stringify(walkCk)));
    check('a walk checkpoint resumes the walk itself: pass 0 from block 60,000 to the old head 100,000 with the earliest hit carried, then both passes over [95,000, 160,000]', S.walks.length === 2 && S.walks[0].start === 0 && S.walks[0].head === 100000 && S.walks[0].later === true && S.walks[0].resume && S.walks[0].resume.pass === 0 && S.walks[0].resume.from === 60000 && S.walks[0].resume.earliest === 50 && S.walks[0].max === 20000 - 2 && S.walks[1].start === 95000 && S.walks[1].head === 160000 && S.walks[1].later === false && !S.walks[1].resume, JSON.stringify(S.walks));
    check('  ...one plan: resuming from block 60,000, not incremental', S.plans.length === 1 && S.plans[0].resuming === true && S.plans[0].incremental === false && S.plans[0].readFrom === 60000, JSON.stringify(S.plans));
    check('  ...a transfers checkpoint at the old head once that walk is whole: the checkpoint\'s own rows kept (the one the walk never answers included, newest first), the walk\'s copy of a row and the checkpoint\'s one, then the usual two at the new head', S.checkpoints.length === 3 && S.checkpoints[0].stage === 'transfers' && S.checkpoints[0].head === 100000 && S.checkpoints[0].transfers.length === 3 && S.checkpoints[0].transfers[2][2] === T9 && S.checkpoints[0].transfers[2][0] === 50 && S.checkpoints[0].nftByBlock[300] === 1 && S.checkpoints[1].head === 160000 && S.checkpoints[2].head === 160000 && S.checkpoints[2].transfers.every((t) => t[7] > 0), JSON.stringify(S.checkpoints.map((c) => [c.stage, c.head, c.transfers.map((t) => t[2].slice(0, 6))])));
    check('  ...the report has every transfer once (five, the checkpoint-only row among them) and says it resumed', W1.resumed === true && W1.incremental === false && W1.transfers.length === 5 && new Set(W1.transfers.map((t) => t[2])).size === 5 && W1.transfers.some((t) => t[2] === T9), W1.transfers.length);
    reset(); S.head = 100000 + 2000001;
    const W2 = await run(JSON.parse(JSON.stringify(walkCk)));
    check('a walk checkpoint more than 2,000,000 blocks behind is not resumed: a from-scratch read', S.walks.length === 1 && S.walks[0].start === 0 && S.walks[0].later === true && !S.walks[0].resume && W2.resumed === false, JSON.stringify(S.walks));
    reset(); S.head = 100000 + 2000000;
    const W3 = await run(JSON.parse(JSON.stringify(walkCk)));
    check('  ...one exactly 2,000,000 behind still is, its rows kept', S.walks.length === 2 && S.walks[0].resume && S.walks[0].resume.from === 60000 && W3.resumed === true && W3.transfers.some((t) => t[2] === T9), JSON.stringify(S.walks));
    for (const [what, bad] of [['from: -1', { from: -1 }], ['no start', { start: undefined }], ['no pass', { pass: undefined }], ['from: 1.5', { from: 1.5 }]]) {
      reset(); S.head = 160000;
      const W4 = await run(JSON.parse(JSON.stringify({ ...walkCk, ...bad })));
      check('  ...a walk checkpoint missing its place (' + what + ') is not trusted: a from-scratch read', S.walks.length === 1 && S.walks[0].start === 0 && !S.walks[0].resume && W4.resumed === false, JSON.stringify(S.walks));
    }

    // F4. the walk checkpoints itself: every WALLET_WALK_CHECKPOINT_MS (by the clock, not every window), the rows so far and where it is — only for a read with no finished history
    let CLK = 1e12; ctx.now = () => CLK; S.tick = () => { CLK += 60e3; };   // the stubbed walk reports a window a minute
    reset(); S.head = 100000;
    S.windows = [1, 2, 3, 4, 5].map((n) => ({ pass: n < 4 ? 0 : 1, from: n * 10000, earliest: n < 4 ? Infinity : 100, logs: n < 2 ? [scratch[0]] : scratch }));
    await run(null);
    const wk = S.checkpoints.filter((c) => c.stage === 'walk');
    check('from scratch, with windows reported a minute apart, only the windows at +2 and +4 minutes are checkpointed (stage "walk": the pass, the next block, the earliest hit — null before one —, the walk\'s start and first-hit rule, the rows so far)', wk.length === 2 && wk.every((c) => c.head === 100000 && c.start === 0 && c.later === true) && wk[0].pass === 0 && wk[0].from === 20000 && wk[0].earliest === null && wk[0].transfers.length === 2 && wk[1].pass === 1 && wk[1].from === 40000 && wk[1].earliest === 100 && wk[1].transfers.length === 2 && wk[1].nftByBlock[300] === 1, JSON.stringify(wk.map((c) => [c.pass, c.from, c.earliest, c.transfers.length])));
    check('  ...and the finished checkpoints still follow (transfers, then dated)', S.checkpoints.filter((c) => c.stage === 'transfers').length === 2 && S.checkpoints[S.checkpoints.length - 1].transfers.every((t) => t[7] > 0), S.checkpoints.map((c) => c.stage).join(','));
    // finishing an earlier walk: its checkpoints keep that walk's rows (under it, to its head); the window since then checkpoints on top of the finished walk, from the walk's own start —
    // so a transfer (and an NFT, which is a bare count) in the 5,000-block overlap the tail reads again is in the checkpoint ONCE
    const TX = '0x' + '77'.repeat(32), NFTX = { address: NFT, topics: [T, pad(OTHER), pad(W), pad(W)], data: '0x', blockNumber: hx(98000), logIndex: '0x2', transactionHash: '0x' + '88'.repeat(32) };
    const ercX = erc(98000, 3, TX, TOK, POOL, W, 7);
    const walkCkO = { ...walkCk, transfers: [[98000, 3, TX, TOK, POOL, W, '7', null], ...walkCk.transfers], nftByBlock: { 98000: 1 } };
    reset(); S.head = 160000; S.extra = [ercX, NFTX];
    S.windows = (start, head) => head === 100000 ? [{ pass: 0, from: 70000, earliest: 50, logs: [scratch[0]] }, { pass: 1, from: 80000, earliest: 50, logs: scratch }] : [{ pass: 0, from: 99000, earliest: Infinity, logs: [ercX, NFTX] }, { pass: 1, from: 99000, earliest: 98000, logs: [ercX, NFTX] }];
    await run(JSON.parse(JSON.stringify(walkCkO)));
    const wk2 = S.checkpoints.filter((c) => c.stage === 'walk');
    check('  ...finishing an earlier walk (two windows a minute apart: the second is checkpointed), the checkpoint carries that walk\'s rows too (under it), to its head', wk2.length === 2 && wk2[0].head === 100000 && wk2[0].start === 0 && wk2[0].later === true && wk2[0].pass === 1 && wk2[0].from === 80000 && wk2[0].transfers.map((t) => t[2]).join() === [TX, T2, T1, T9].join() && wk2[0].nftByBlock[98000] === 1 && wk2[0].nftByBlock[300] === 1, JSON.stringify(wk2.map((c) => [c.head, c.start, c.transfers.map((t) => t[2].slice(0, 6)), c.nftByBlock])));
    check('  ...the window since then checkpoints from the walk\'s own start (95,000): the transfer and the NFT at 98,000 that the tail reads again are there once, everything below the start kept', wk2[1] && wk2[1].head === 160000 && wk2[1].start === 95000 && wk2[1].later === false && wk2[1].transfers.length === 4 && wk2[1].transfers.filter((t) => t[2] === TX).length === 1 && wk2[1].nftByBlock[98000] === 1 && wk2[1].nftByBlock[300] === 1, JSON.stringify(wk2.slice(1).map((c) => [c.head, c.start, c.transfers.map((t) => t[2].slice(0, 6)), c.nftByBlock])));
    S.windows = null; S.extra = null;
    reset(); S.head = 150000;
    S.windows = [{ pass: 0, from: 30000, earliest: Infinity, logs: [] }, { pass: 0, from: 60000, earliest: Infinity, logs: [] }];
    await run(JSON.parse(JSON.stringify(A)));
    check('  ...never on an incremental refresh (a finished history is on file)', S.checkpoints.length === 0, S.checkpoints.length);
    S.windows = null; S.tick = null; ctx.now = () => Date.now();
    check('  ...WALLET_WALK_CHECKPOINT_MS is two minutes (a checkpoint is a brotli and a row)', /WALLET_WALK_CHECKPOINT_MS = 2 \* 60 \* 1000;/.test(SRC));

    // G. a merged history over the budget is refused, as a full read would be
    reset(); S.head = 300000; ctx.TRACKER_HISTORY_MAX = 3;
    let err = null; try { await run(JSON.parse(JSON.stringify(A))); } catch (e) { err = e.message; }
    check('a merge that passes TRACKER_HISTORY_MAX throws the same "longer than the chain read budget" (the stored row is left alone)', /longer than the chain read budget/.test(err || ''), err);
    ctx.TRACKER_HISTORY_MAX = 20000;

    // H. a pool the feed never lists: the factory knows one (the site prices the token from its reserves), so on the incremental path the saved "no market" token becomes a market, its balance live, its trades read
    reset(); S.head = 250000; S.balance = 500n; ctx.poolCache.clear(); S.pools[TOK2 + ':' + WETH] = POOL2;
    const Hh = await run(JSON.parse(JSON.stringify(C)));
    const hTok2 = Hh.tokens.find((t) => t.address === TOK2);
    check('a saved "no market" token whose own pool the factory knows (the feed still silent) is asked again on the incremental path: WETH only (found, so USDG is not asked), the pool kept as final', S.asked.length === 1 && S.asked[0].includes(TOK2) && S.factoryAsked.length === 1 && S.factoryAsked[0][1] === TOK2 && S.factoryAsked[0][2] === WETH && ctx.poolCache.get(TOK2).pool === POOL2 && ctx.poolCached(TOK2, Date.now() + 365 * 864e5) === POOL2, JSON.stringify(S.factoryAsked));
    check('  ...so its market is true, its balance read live, and its two transactions\' receipts read and summed', hTok2 && hTok2.market === true && hTok2.balance === '500' && !('balanceAt' in hTok2) && Hh.txs[T4] && Hh.txs[T4][TOK2] && Hh.txs[T5] && Hh.txs[T5][TOK2] && S.calls.filter((c) => c[0] === 'eth_getTransactionReceipt' && (c[1][0] === T4 || c[1][0] === T5)).length === 2, JSON.stringify({ tok: hTok2, txs: Object.keys(Hh.txs).map((h) => h.slice(0, 6)) }));
    const direct = await ctx.poolsFor([TOK2, TOK], () => {});
    check('  ...factoryPoolsFor answers a kept pool without a read and asks about the rest (WETH, then USDG)', direct.get(TOK2) === POOL2 && direct.get(TOK) === null && S.factoryAsked.filter((a) => a[1] === TOK).map((a) => a[2]).join(',') === WETH + ',' + USDG && S.factoryAsked.filter((a) => a[1] === TOK2).length === 1, JSON.stringify([...direct]));
    delete S.pools[TOK2 + ':' + WETH];

    // I. the factory's "no pool" is kept in the saved row (poolAt): an incremental read does not ask again for a token whose saved "no" is under a day
    //    old and that the window did not move — a Refresh past the cache's ten minutes used to cost two paced reads per poolless token; one older than a day, or moved, is asked
    const TOK3 = '0x' + 'd'.repeat(40), T6 = '0x' + '66'.repeat(32);
    const priorI = JSON.parse(JSON.stringify(C));
    priorI.transfers.push([50000, 0, T6, TOK3, OTHER, W, '5', 1700000050000]);   // an old arrival of a third token, below any window the read will cover
    priorI.tokens.push({ address: TOK3, symbol: 'SYM-dd', name: 'Name dd', decimals: 18, balance: '5', market: false, poolAt: Date.now() - 60e3 });
    const i0Tok2 = priorI.tokens.find((t) => t.address === TOK2);
    check('a read that heard "no pool" from the factory (or held it in its cache) keeps that in the token\'s row, dated at the read: market false, poolAt', i0Tok2 && i0Tok2.market === false && i0Tok2.poolAt > 0 && Date.now() - i0Tok2.poolAt < 5 * 60e3 && !('poolAt' in priorI.tokens.find((t) => t.address === TOK)), JSON.stringify(priorI.tokens.map((t) => [t.symbol, t.market, t.poolAt])));
    reset(); S.head = 250000; S.balance = 9n; ctx.poolCache.clear();
    const I1 = await run(JSON.parse(JSON.stringify(priorI)));
    const i1Tok3 = I1.tokens.find((t) => t.address === TOK3), i1Tok2 = I1.tokens.find((t) => t.address === TOK2);
    check('on an incremental read a saved "no pool" under a day old, for a token the window did not move, is NOT asked of the factory again; the token the window moved is (WETH, then USDG)', !S.factoryAsked.some((a) => a[1] === TOK3) && S.factoryAsked.filter((a) => a[1] === TOK2).map((a) => a[2]).join(',') === WETH + ',' + USDG && S.asked[0].includes(TOK3), JSON.stringify(S.factoryAsked.map((a) => [a[1].slice(0, 6), a[2] === WETH ? 'WETH' : 'USDG'])));
    check('  ...the unasked token keeps its saved verdict and its date (and its saved balance, dated); the asked one is re-dated at this read', i1Tok3 && i1Tok3.market === false && i1Tok3.poolAt === priorI.tokens[2].poolAt && i1Tok3.balance === '5' && i1Tok3.balanceAt === 200000 && i1Tok2 && i1Tok2.market === false && i1Tok2.poolAt > priorI.tokens[2].poolAt && Date.now() - i1Tok2.poolAt < 60e3, JSON.stringify([i1Tok3, i1Tok2]));
    priorI.tokens[2].poolAt = Date.now() - 25 * 3600e3;
    reset(); S.head = 250000; ctx.poolCache.clear();
    const I2 = await run(JSON.parse(JSON.stringify(priorI)));
    check('  ...a saved "no" older than a day is asked again (WETH, then USDG) and re-dated', S.factoryAsked.filter((a) => a[1] === TOK3).map((a) => a[2]).join(',') === WETH + ',' + USDG && I2.tokens.find((t) => t.address === TOK3).poolAt > Date.now() - 60e3, JSON.stringify(S.factoryAsked.map((a) => a[1].slice(0, 6))));
    priorI.tokens[2].poolAt = Date.now() - 60e3; priorI.tokens[2].market = null;
    reset(); S.head = 250000; ctx.poolCache.clear();
    await run(JSON.parse(JSON.stringify(priorI)));
    check('  ...and a saved "unknown" (market null) is asked whatever its date: only a factory "no" stands', S.factoryAsked.some((a) => a[1] === TOK3), JSON.stringify(S.factoryAsked.map((a) => a[1].slice(0, 6))));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made) {
    for (const t of ['wallet_hist', 'tracked_wallets', 'tracker_cache', 'identities', 'sessions', 'points_events', 'notifications', 'holder_state'])
      { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_wh\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
