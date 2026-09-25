/* The on-chain holder ledger and the community supply share. Real chain reads for $SEND (one eth_getLogs over its
   whole history); throwaway members whose "linked wallets" are public holder addresses taken from that ledger,
   joined to the official $SEND community and removed again in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const SRC = readFileSync(SERVER_JS, 'utf8');
const read = (f) => readFileSync(path.join(ROOT, 'public', f), 'utf8');
const CJS = read('community.js'), CSJS = read('communities.js'), NP = read('newpairs.js');
const SEND = '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105';
const hex = (n) => randomBytes(n).toString('hex');
const made = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
function mkUser(name, wallet) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id; made.push(id);
  const raw = 'tok_' + name + '_' + hex(8);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)').run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  if (wallet) db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?,?,?,?,?)").run(id, 'wallet', hex(32), wallet, Date.now()); // pre-migration plaintext form: decField passes it through
  return { id, sid: raw };
}
const comm = () => db.prepare('SELECT * FROM communities WHERE lower(token_addr)=? AND demo=0').get(SEND);
let cid = null;
const membersBefore = { count: null, qual: null };

try {
  /* ═══ the ledger ═══ */
  /* The public node rate-limits by IP, and this run shares that IP with every other suite (and, on this Mac, with
     the live site). When it refuses, the ledger stands down for LEDGER_COOL_MS (5 s under the runner) and resumes
     from the block it reached — so the honest test is to wait that out and ask again, a few times. */
  let scan, idx;
  for (let i = 0; i < 8; i++) {
    scan = await api('/api/scan?address=' + SEND);
    idx = db.prepare('SELECT * FROM holder_index WHERE token_addr=?').get(SEND);
    if (idx && idx.status === 'ok') break;
    await sleep(6000);
  }
  const h = (scan.j && scan.j.pair && scan.j.pair.holders) || {};
  if (!idx || idx.status !== 'ok') check('the ledger for $SEND was built by the scan (or the chain could not be read from here: ' + JSON.stringify(idx && idx.error) + ')', false, JSON.stringify(idx));
  else {
    check('a scan builds the token’s on-chain ledger: every Transfer event, folded into balances', idx.logs > 1000 && idx.last_block > idx.first_block && idx.first_block > 0, JSON.stringify({ logs: idx.logs, first: idx.first_block, last: idx.last_block }));
    const rows = db.prepare('SELECT wallet, balance, positive FROM holder_balances WHERE token_addr=?').all(SEND);
    const positive = rows.filter((r) => r.positive === 1 && r.wallet !== '0x0000000000000000000000000000000000000000' && r.wallet !== '0x000000000000000000000000000000000000dead');
    check('  ...the holder count IS the number of wallets with a balance above zero (zero and burn addresses excluded)', idx.holders === positive.length && idx.holders > 10, idx.holders + ' vs ' + positive.length);
    check('  ...the ledger adds up (the zero address is the only negative — it is where mints come from)', idx.consistent === 1 && rows.filter((r) => r.balance.startsWith('-')).every((r) => r.wallet === '0x0000000000000000000000000000000000000000'), 'consistent=' + idx.consistent);
    check('  ...balances are exact integers, never floats', rows.every((r) => /^-?\d+$/.test(r.balance)));
    check('  ...and totalSupply() was read from the chain for the shares', /^\d+$/.test(idx.supply || '') && BigInt(idx.supply) > 0n, idx.supply);
    // the boot-time seed may have profiled $SEND seconds ago (inside the scan's 5 s share window): a scan of an aged row must show the chain's count
    let hs = h;
    if (hs.source !== 'chain') { db.prepare('UPDATE token_cache SET updated_at = updated_at - 60000 WHERE token_addr=?').run(SEND); const again = await api('/api/scan?address=' + SEND); hs = (again.j && again.j.pair && again.j.pair.holders) || {}; }
    const idxNow = db.prepare('SELECT holders, last_block FROM holder_index WHERE token_addr=?').get(SEND);
    check('the scan shows the chain’s count, labelled as such, with the block it is exact at', hs.source === 'chain' && hs.count === idxNow.holders && hs.block === idxNow.last_block, JSON.stringify({ source: hs.source, count: hs.count, block: hs.block, idx: idxNow }));
    check('  ...and the market-only refresh loop carries the ledger into a cached profile too', /const lv = ledgerHolderView\(holderLedger\(tok\), p\.pair && p\.pair\.address\);/.test(SRC) && /if \(lv\) p\.holders = Object\.assign\(\{\}, p\.holders \|\| \{\}, lv\);/.test(SRC));
    check('  ...and the top holders come from the ledger as a share of totalSupply (pool, burn and zero address filtered)', Array.isArray(h.top) && h.top.length > 0 && h.top.every((t) => /^0x[0-9a-f]{40}$/.test(t.address) && typeof t.pct === 'number') && h.topHolderPct != null, JSON.stringify(h.top && h.top[0]));
    const idx2 = db.prepare('SELECT last_block, logs FROM holder_index WHERE token_addr=?').get(SEND);
    check('a second read within the fresh window makes no new chain read', idx2.last_block === idx.last_block && idx2.logs === idx.logs);
    // age the ledger: the next scan refreshes it INCREMENTALLY — only the blocks since last_block are read
    db.prepare('UPDATE holder_index SET updated_at = updated_at - 3600000 WHERE token_addr=?').run(SEND);
    await api('/api/scan?address=' + SEND);
    const idx3 = db.prepare('SELECT last_block, logs, updated_at FROM holder_index WHERE token_addr=?').get(SEND);
    check('an aged ledger is brought up to date incrementally (last_block moves forward, the log count only grows)', idx3.last_block >= idx.last_block && idx3.logs >= idx.logs && Date.now() - idx3.updated_at < 60000, JSON.stringify({ before: idx.last_block, after: idx3.last_block, logs: [idx.logs, idx3.logs] }));
  }
  check('the ledger is what every profile prefers; GoPlus and the explorer are the fallback, and `source` says which', /const ledger = holderLedger\(t\.token\);/.test(SRC) && /const count = \(ledger && ledger\.count != null\) \? ledger\.count/.test(SRC) && /source: holdersSource, block: ledger \? ledger\.block : null/.test(SRC));
  check('  ...every profile read kicks the ledger (built or refreshed behind the read, never blocking it)', /try \{ ensureLedger\(t\.token\)\.catch\(\(\) => \{\}\); \} catch \{\}/.test(SRC));
  check('  ...the community grid takes the chain’s count before asking the explorer', /if \(ledger && ledger\.count != null\) \{ holdersByToken\[tok\] = ledger\.count; continue; \}/.test(SRC));
  check('  ...and the page says where a count came from', /np-src-chain/.test(NP) && /on-chain/.test(NP));
  check('a first build is single-flight, bounded in concurrency, and backs off on the node’s 429', /const flying = _ledgerInflight\.get\(tok\); if \(flying\) return flying;/.test(SRC) && /while \(_ledgerRunning >= LEDGER_MAX_CONCURRENT\)/.test(SRC) && /async function _rpcPaced\(fn, tries = 3\)/.test(SRC));
  check('a failed refresh keeps the last good ledger, and a failed build resumes from the block it reached', /status=CASE WHEN holder_index\.status='ok' THEN 'ok' ELSE excluded\.status END/.test(SRC) && /let from = row && row\.last_block \? row\.last_block \+ 1 : 0;/.test(SRC) && /firstBlock = ledgerApply\(tok, out, to, firstBlock\);/.test(SRC));
  check('  ...the walk shrinks its window when the node says the answer is too large or too slow, and backs off on a 429', /TOO_MANY_RE\.test\(String\(\(e && e\.message\) \|\| ''\)\) && window > 50/.test(SRC) && /timed out\|timeout\|aborted/.test(SRC) && /async function _rpcSlow\(fn\)/.test(SRC));
  check('  ...a token too large to ledger is remembered as such (a day), keeps the indexer’s count, and the quote assets are never ledgered', /const LEDGER_MAX_LOGS = 1000000;/.test(SRC) && /r\.status === 'too-big' && now\(\) - r\.updated_at < 864e5/.test(SRC) && /QUOTE_SET\.has\(tok\)\) return null;/.test(SRC));
  check('the sweep does community tokens first, then a bounded slice of what people are reading', /ORDER BY COALESCE\(held_at, 0\) ASC LIMIT 6/.test(SRC) && /if \(\+\+done >= 6\) break;/.test(SRC) && /ledgerTimer\.unref\(\)/.test(SRC));

  /* ═══ the community supply share ═══ */
  // seeded at boot from a live lookup; a refused lookup is retried a minute later
  let c0 = comm();
  for (let i = 0; !c0 && i < 16; i++) { await sleep(5000); c0 = comm(); }
  check('the official $SEND community exists to measure', !!c0, c0 && c0.id);
  if (c0) {
    cid = c0.id;
    membersBefore.count = c0.member_count; membersBefore.qual = c0.qual_count;
    const top = db.prepare("SELECT wallet, balance FROM holder_balances WHERE token_addr=? AND positive=1 AND wallet NOT IN ('0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead') ORDER BY length(balance) DESC, balance DESC LIMIT 12").all(SEND);
    // three members, each with one public holder wallet — the pool and the biggest balance are skipped so the share is a members' share
    const pool = (scan.j && scan.j.pair && scan.j.pair.pair && scan.j.pair.pair.address) || '';
    const pick = top.filter((t) => t.wallet !== pool.toLowerCase()).slice(2, 5);
    const users = pick.map((t, i) => mkUser('__lg_m' + i + '__', t.wallet));
    for (const u of users) db.prepare('INSERT INTO community_members (community_id, user_id, joined_at, qualified) VALUES (?,?,?,1)').run(cid, u.id, Date.now());
    // before the third member: the share is withheld
    db.prepare('UPDATE communities SET held_at=NULL, held_pct=NULL, held_members=NULL WHERE id=?').run(cid);
    db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(cid, users[2].id);
    await api('/api/communities/' + cid);          // demand-driven refresh (fire-and-forget on the server)
    await sleep(2500);
    let d = await api('/api/communities/' + cid);
    let sp = d.j && d.j.community && d.j.community.supply;
    check('with two wallet-linked members the share is WITHHELD (k-anonymity floor of 3)', sp && sp.shown === false && sp.reason === 'few' && sp.members === 2 && sp.pct === null, JSON.stringify(sp));
    check('  ...and the page says why', /shown once <b>' \+ esc\(String\(sp\.need\)\) \+ '<\/b> members have linked a read-only wallet/.test(CJS));
    // the third joins: the share appears
    db.prepare('INSERT INTO community_members (community_id, user_id, joined_at, qualified) VALUES (?,?,?,1)').run(cid, users[2].id, Date.now());
    db.prepare('UPDATE communities SET held_at=NULL WHERE id=?').run(cid);
    await api('/api/communities/' + cid);
    await sleep(2500);
    d = await api('/api/communities/' + cid);
    sp = d.j && d.j.community && d.j.community.supply;
    const expected = pick.reduce((a, t) => a + BigInt(t.balance), 0n);
    const supply = BigInt(db.prepare('SELECT supply FROM holder_index WHERE token_addr=?').get(SEND).supply);
    const exactPct = Number((expected * 1000000n) / supply) / 10000;
    check('with three, the share is shown: the members’ wallets summed from the ledger over totalSupply', sp && sp.shown === true && typeof sp.pct === 'number' && sp.members === 3 && sp.wallets === 3 && sp.source === 'chain' && sp.block > 0, JSON.stringify(sp));
    check('  ...to two significant figures (a public money figure, never one precise enough to name a wallet)', sp && sp.pct === Number(exactPct.toPrecision(2)), sp && sp.pct + ' vs exact ' + exactPct);
    check('  ...with nothing about which members or wallets', sp && Object.keys(sp).every((k) => ['shown', 'reason', 'need', 'members', 'wallets', 'pct', 'at', 'block', 'source'].includes(k)) && !JSON.stringify(d.j).toLowerCase().includes(pick[0].wallet.slice(2, 12)), Object.keys(sp || {}).join(','));
    const list = await api('/api/communities');
    const card = list.j && [...(list.j.officials || []), ...(list.j.communities || [])].find((x) => x.id === cid);
    check('the communities index carries the same figure on the card (and the chain-sourced holder count)', card && card.supply && card.supply.shown === true && card.supply.pct === sp.pct && card.holdersSource === 'chain', JSON.stringify(card && { supply: card.supply, holdersSource: card.holdersSource, holders: card.holders }));
    check('  ...and the index page renders it with the privacy note in the title', /of supply held by members/.test(CSJS) && /shown once/.test(CSJS));
    check('the community page shows the share, its source block, when it was updated, and that only the total is shown', /Members’ wallets hold/.test(CJS) && /as of block/.test(CJS) && /Only the total is ever shown, never anyone’s balance/.test(CJS) && /setInterval\(\(\) => \{ if \(!document\.hidden && C\) load\(\); \}, 60000\);/.test(CJS));
    // a member leaves → the share is recomputed on the next read
    db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(cid, users[0].id);
    db.prepare('UPDATE communities SET held_at = held_at - 3600000 WHERE id=?').run(cid);
    await api('/api/communities/' + cid); await sleep(2500);
    d = await api('/api/communities/' + cid);
    sp = d.j && d.j.community && d.j.community.supply;
    check('a member leaving moves the figure back under the floor (recomputed on demand)', sp && sp.shown === false && sp.members === 2, JSON.stringify(sp));
    check('join, leave, wallet link and unlink all recompute the share', /if \(!c\.demo\) refreshCommunitySupply\(c, \{ waitMs: 0 \}\)/.test(SRC) && (SRC.match(/refreshSupplyForUser\(me\.id\)/g) || []).length >= 2);
    check('an inconsistent ledger falls back to bounded balanceOf reads, and a failed read never counts as zero', /if \(wallets\.length > 60\) return null;/.test(SRC) && /if \(vals\.some\(\(v\) => v == null\)\) return null;/.test(SRC));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  try {
    if (cid) { for (const id of made) db.prepare('DELETE FROM community_members WHERE community_id=? AND user_id=?').run(cid, id); db.prepare('UPDATE communities SET member_count=COALESCE(?, member_count), qual_count=COALESCE(?, qual_count), held_at=NULL, held_pct=NULL, held_members=NULL, held_wallets=NULL WHERE id=?').run(membersBefore.count, membersBefore.qual, cid); }
    for (const id of made) { for (const t of ['sessions', 'identities', 'notifications', 'points_events', 'community_members']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} } try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {} }
  } catch {}
  console.log('\ncleanup — throwaway users left:', db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_lg\\_%' ESCAPE '\\'").get().n);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
