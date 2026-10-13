/* The menu search, for an address (owner, 2026-10-13: "allow the search bar in the menu to also search up contract
   addresses"). /api/search answers a whole address, or 0x and the start of one, from the site's own token tables only
   — communities, the Scanner's record, the radar's cache — never a chain read and never a wallet table, so a wallet
   somebody linked or tracks gets exactly the answer any unknown address gets. Throwaway rows only, removed at the end. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');
const SRC = readFileSync(SERVER_JS, 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const hex = (n) => randomBytes(n).toString('hex');
const addr = () => '0x' + hex(20);
const made = { users: [], tokens: [], scans: [], comms: [] };
const get = async (q) => { const r = await fetch(BASE + '/api/search?q=' + encodeURIComponent(q)); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };

try {
  const now = Date.now();
  // a creator for the communities
  const uname = '__as_' + hex(3);
  db.prepare('INSERT INTO users (username, created_at, avatar) VALUES (?,?,?)').run(uname, now, '🧪');
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(uname).id; made.users.push(uid);
  // a token the radar knows, one it could not price, one with no name; a scanned token with its pool; a community (and a demo one)
  const tokA = '0xabcd' + hex(18), tokDead = '0xabcd' + hex(18), tokNoName = '0xabcd' + hex(18), tokS = addr(), poolS = addr(), tokC = addr(), pairC = addr(), tokDemo = addr();
  const putTok = (a, sym, name, found) => { db.prepare('INSERT INTO token_cache (token_addr, symbol, name, found, updated_at, last_read_at, reads) VALUES (?,?,?,?,?,?,?)').run(a, sym, name, found, now, now, 3); made.tokens.push(a); };
  putTok(tokA, 'ASRCH', 'Search Test Coin', 1);
  putTok(tokDead, 'DEAD', 'Not Priced', 0);
  putTok(tokNoName, '???', 'Unknown Token', 1);
  db.prepare("INSERT INTO scans (token_addr, pool_addr, kind, symbol, name, first_at, last_at, read_at, count) VALUES (?,?,?,?,?,?,?,?,?)").run(tokS, poolS, 'pool', 'SCANT', 'Scanned Test', now, now, now, 2); made.scans.push(tokS);
  const mkComm = (tok, pair, sym, name, demo) => {
    db.prepare("INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, created_at, demo) VALUES (?,?,?,?,?,?,?,?)").run(uid, tok, pair, sym, name, 'pending', now, demo);
    const id = db.prepare('SELECT id FROM communities WHERE token_addr = ?').get(tok).id; made.comms.push(id); return id;
  };
  const commId = mkComm(tokC, pairC, 'COMT', 'Community Test', 0);
  mkComm(tokDemo, addr(), 'DEMO', 'Demo Sandbox', 1);

  let r = await get(tokA);
  check('a whole token address finds the token the radar knows: its symbol, name and address (for its dashboard)', r.status === 200 && r.j && r.j.addr && r.j.addr.full === true && r.j.addr.tokens.length === 1
    && r.j.addr.tokens[0].token === tokA && r.j.addr.tokens[0].symbol === 'ASRCH' && r.j.addr.tokens[0].name === 'Search Test Coin' && Array.isArray(r.j.users) && r.j.users.length === 0, r.text);
  r = await get(tokA.toUpperCase().replace('0X', '0x'));
  check('  ...in any letter case', r.j && r.j.addr && r.j.addr.tokens.length === 1 && r.j.addr.tokens[0].token === tokA, r.text);
  r = await get(tokA.slice(2));
  check('  ...and without its 0x', r.j && r.j.addr && r.j.addr.tokens.length === 1 && r.j.addr.tokens[0].token === tokA, r.text);
  r = await get(tokA.slice(0, 12));
  check('the start of an address (0x and 4+ more) finds the named tokens that begin with it — not one it could not price, not an unnamed one', r.j && r.j.addr && r.j.addr.full === false
    && r.j.addr.tokens.some((t) => t.token === tokA) && !r.j.addr.tokens.some((t) => t.token === tokDead || t.token === tokNoName), r.text);
  r = await get(poolS);
  check('a pool the Scanner resolved finds its token (marked as the pool)', r.j && r.j.addr && r.j.addr.tokens.length === 1 && r.j.addr.tokens[0].token === tokS && r.j.addr.tokens[0].via === 'pool', r.text);
  r = await get(tokC);
  check('a token with a community carries that community (for its page)', r.j && r.j.addr && r.j.addr.tokens.length === 1 && r.j.addr.tokens[0].community && r.j.addr.tokens[0].community.id === commId, r.text);
  r = await get(tokDemo);
  check('  ...but never a demo sandbox', r.j && r.j.addr && r.j.addr.tokens.length === 0, r.text);
  const unknown = addr();
  r = await get(unknown);
  check('an address the site has no record of answers an empty list (the menu then offers a scan and the Wallet Tracker) — and never repeats the address', r.j && r.j.addr && r.j.addr.full === true && r.j.addr.tokens.length === 0 && !r.text.toLowerCase().includes(unknown.slice(2)), r.text);

  // privacy: a wallet somebody linked or tracks answers exactly what an unknown address does; no bio is searched for an address
  const wallet = addr(), tracked = addr();
  db.prepare("INSERT INTO identities (user_id, type, identifier, identifier_enc, linked_at) VALUES (?,?,?,?,?)").run(uid, 'wallet', hex(32), wallet, now);
  db.prepare('INSERT INTO tracked_wallets (user_id, address, address_enc, label, created_at) VALUES (?,?,?,?,?)').run(uid, hex(32), tracked, 'as-secret', now);
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run('my wallet is ' + wallet, uid);
  const base = JSON.stringify((await get(addr())).j);
  const w1 = await get(wallet), w2 = await get(tracked), w3 = await get(wallet.slice(0, 14));
  check('a wallet somebody linked, one somebody tracks, or the start of one answers exactly what an unknown address does — no account, no bio', JSON.stringify(w1.j) === base && JSON.stringify(w2.j) === base
    && w3.j && w3.j.users.length === 0 && w3.j.addr.tokens.length === 0 && !w1.text.includes(uname) && !w3.text.includes(uname), [w1.text, w3.text].join(' | '));
  r = await get('wallet is');
  check('  ...while a plain word still searches names and bios as before', r.j && r.j.users.some((u) => u.username === uname), r.text);

  // the source: the address path reads the site's own tables only
  const fn = (SRC.match(/function searchAddr\(a, full\) \{[\s\S]*?\n\}\n/) || [''])[0];
  const route = (SRC.match(/if \(p === '\/api\/search' && req\.method === 'GET'\) \{[\s\S]*?\n      \}\n/) || [''])[0];
  const banned = ['rpc(', 'ethCall', 'lookupTokenPair', 'fetchAndStore', 'addrHasCode', 'identities', 'tracked_wallets', 'wallet_hist', 'gate_wallets', 'holder_balances', 'FROM calls', '_tokenNameCache', 'dh_follow', 'dh_moves'];
  check('the address search reads no chain and no wallet table (communities, scans, token_cache only)', fn && route && banned.every((b) => !fn.includes(b) && !route.includes(b)) && /FROM communities/.test(fn) && /FROM scans/.test(fn) && /FROM token_cache WHERE found = 1/.test(fn), banned.filter((b) => fn.includes(b) || route.includes(b)).join(','));
  // the menu: placeholder, label, one-line address, the two "nothing on record" rows, the tracker hash
  const SJ = readFileSync(path.join(ROOT, 'public', 'search.js'), 'utf8'), TP = readFileSync(path.join(ROOT, 'public', 'trackerpage.js'), 'utf8');
  check('the menu box says it takes addresses, and draws an address on one line (head …, last 4)', /placeholder="find Senders or Scan Tokens"/.test(SJ) && /aria-label="Search for senders, or paste a token, pool or wallet address"/.test(SJ) && /const addrFit = \(a\) => '<code class="addr-fit"/.test(SJ));
  check('  ...a token row opens its dashboard (a pool row the pool\'s), a community row its page; an address with no record offers a scan and the Wallet Tracker', /'\/newpairs\.html\?scan=' \+ encodeURIComponent\(pool \? a : t\.token\)/.test(SJ) && /'\/community\.html\?id=' \+ encodeURIComponent\(t\.community\.id\)/.test(SJ)
    && /name: 'Scan this address'/.test(SJ) && /'\/tracker\.html#track=' \+ encodeURIComponent\(a\)/.test(SJ));
  check('  ...and the Wallet Tracker only fills a #track= address in (never tracks it without a tap), keeping it out of server logs', /function trackFromHash\(h\) \{ const m = \/\^#track=\(0x\[0-9a-fA-F\]\{40\}\)\$\/\.exec/.test(TP) && /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/.test(TP) && /function fillTrack\(h\) \{\n    addrIn\.value = h;/.test(TP) && /window\.addEventListener\('hashchange'/.test(TP) && !/addWallet\(h/.test(TP));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the suite ran to the end', false, e && e.message);
} finally {
  for (const a of made.tokens) { try { db.prepare('DELETE FROM token_cache WHERE token_addr = ?').run(a); } catch {} }
  for (const a of made.scans) { try { db.prepare('DELETE FROM scans WHERE token_addr = ?').run(a); } catch {} }
  for (const id of made.comms) { try { db.prepare('DELETE FROM communities WHERE id = ?').run(id); } catch {} }
  for (const id of made.users) {
    for (const t of ['identities', 'tracked_wallets', 'sessions']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
