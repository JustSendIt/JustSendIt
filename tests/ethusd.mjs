/* ETH/USD at any past block (lib/ethusd.js; the "$100 bought" rebuild, decisions H9 / WP1). Owner, 2026-11-17: "make it
   $100 of value bought in the token not the current token value" — a buy paid in WETH is valued at ETH's USD price at
   its own block, read from the chain's WETH/USDG pool.

   Pure: no server, no database, no network. Everything runs on measured chain answers (tests/fixtures/ethusd/README.txt
   says where each came from): two 300,000-block slices of the pair's Sync logs and the pair's token0 / token1 / USDG
   decimals / factory answers. Every expected figure here is worked out by this file from the raw logs — its own decoding,
   its own per-block expansion of the price, its own median — never taken from the code under test.

     1. the pair: the measured answers say token0 WETH, token1 USDG with 6 decimals, and the factory names this pair;
     2. decodeSync matches the saved Syncs to the cent (two prices worked out with bc, then every Sync), refuses what is
        not this pair's Sync, and reads a drained pool as no price (never a division by zero);
     3. one price per block: six Syncs in one block are one price, the last by logIndex (and the real 3-Sync blocks);
     4. every cell's median equals a brute-force median over the cell's 10,000 blocks, each block at the price in force;
        so does the Sync that stood longest (top) and the dominant flag (it stood for half the cell or more);
     5. a one-transaction spike: reversed in the next block it moves no cell at all; standing until the pool's own next
        Sync, at EVERY Sync however far that is, it moves no cell by 1% unless it stood for half the cell — and then the
        cell is flagged dominant, naming the push's block (where a plain mean of the Syncs would have moved anyway);
     6. an empty cell carries the last price forward, flagged, with its staleness — and opens the next cell;
     7. a window split mid-cell (or mid-block, reversed, read twice, stored as JSON) equals one unsplit read; alignWindow;
        a Map keyed by anything but each cell's own whole-number ci is refused; reorgs: a removed log takes its point
        out, and a range read again with `replace` equals a fresh read of the chain as it now is;
     8. before the pool's first Sync (and outside what was read) → null with the reason, a code and a kind;
     9. thin cells, the still-open cell (provisional), a drained pool — no price for any block inside a drain, its own
        cell included;
    10. the file stays pure: nothing required, no clock, never a log's blockTimestamp. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'lib', 'ethusd.js'));
const FIX = (f) => JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'ethusd', f), 'utf8'));
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const section = (name, fn) => { try { fn(); } catch (e) { check(name + ' ran to the end', false, e && e.stack); } };

const PAIR = '0x8803c117ccae7b5146297876c2a25df135141c4d';
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const SYNC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';
const CELL = 10000;
const SLICES = [
  { file: 'sync-41300000-41599999.json', from: 41300000, to: 41599999 },
  { file: 'sync-116100000-116399999.json', from: 116100000, to: 116399999 },
];
for (const s of SLICES) s.logs = FIX(s.file).result;

/* ── this file's own reading of the logs (not the library's) ── */
const hexN = (h) => parseInt(h, 16);
const reserves = (l) => { const d = l.data.slice(2); return [BigInt('0x' + d.slice(0, 64)), BigInt('0x' + d.slice(64, 128))]; };
const microOf = (l) => { const [r0, r1] = reserves(l); return Number(r1 * 10n ** 18n / r0); };          // USDG(6) per WETH(18), in millionths
const centsOf = (l) => { const [r0, r1] = reserves(l); return Number((r1 * 10n ** 14n * 2n + r0) / (2n * r0)); };   // rounded half up
// per block: the price of its Sync with the highest logIndex
function lastPerBlock(logs) {
  const m = new Map();
  for (const l of logs) { const b = hexN(l.blockNumber), i = hexN(l.logIndex), p = m.get(b); if (!p || i > p.li) m.set(b, { li: i, micro: microOf(l) }); }
  return m;
}
/* the brute force: every block of [lo, hi] at the price in force there (the last Sync at or before it, nothing before the
   first Sync read), sorted; the lower median is the element at ceil(count / 2) - 1. Each block also counts toward the
   Sync whose price it was at (named by its block); the one with the most blocks, the earliest of equals, is the top */
function bruteCell(perBlock, sortedBlocks, lo, hi) {
  let cur = null, setter = null;
  for (const b of sortedBlocks) { if (b >= lo) break; cur = perBlock.get(b).micro; setter = b; }
  const arr = [], by = new Map();
  let n = 0, first = null, last = null;
  for (let b = lo; b <= hi; b++) {
    const p = perBlock.get(b);
    if (p) { cur = p.micro; setter = b; n++; if (first == null) first = b; last = b; }
    if (cur != null) { arr.push(cur); by.set(setter, (by.get(setter) || 0) + 1); }
  }
  arr.sort((a, b) => a - b);
  let top = null;
  for (const [block, blocks] of by) if (!top || blocks > top.blocks) top = { block, blocks };
  return { micro: arr.length ? arr[Math.ceil(arr.length / 2) - 1] : null, n, first, last, weight: arr.length, top, dominant: !!top && top.blocks * 2 >= arr.length };
}
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const hx = (n) => '0x' + n.toString(16);
const syncLog = (block, li, r0, r1, extra) => ({ address: PAIR, topics: [SYNC], data: '0x' + word(r0) + word(r1), blockNumber: hx(block), logIndex: hx(li), transactionHash: '0x' + String(block).padStart(60, '0') + String(li).padStart(4, '0'), blockTimestamp: '0x0', removed: false, ...(extra || {}) });
const fold = (logs) => { const cells = new Map(); E.foldCells(cells, logs); return cells; };
const gridOf = (s, opts) => E.buildGrid(fold(s.logs), { from: s.from, to: s.to, ...(opts || {}) });
const cellsJson = (cells) => JSON.stringify([...cells].sort((a, b) => a[0] - b[0]));
const sumsJson = (g) => JSON.stringify([...g.sums].sort((a, b) => a[0] - b[0]));

/* ═══ 1. the pair ═══ */
section('the pair', () => {
  const pf = FIX('pair-facts.json'), ans = new Map(pf.answer.map((a) => [a.id, a.result]));
  const addr = (r) => '0x' + String(r).slice(-40).toLowerCase();
  check('the measured answers: token0() is WETH, token1() is USDG, USDG decimals() is 6, getPair(WETH, USDG) is this pair', addr(ans.get(1)) === WETH && addr(ans.get(2)) === USDG && BigInt(ans.get(3)) === 6n && addr(ans.get(4)) === PAIR, JSON.stringify(pf.answer));
  check('  ...and they were asked of the public node with the site\'s honest User-Agent', pf.node === 'https://rpc.mainnet.chain.robinhood.com' && /^JustSendIt\/1\.0 \(\+https:\/\/sendrh\.com\)$/.test(pf.userAgent));
  check('the library names the same pair, factory, tokens and decimals (WETH 18, USDG 6)', E.PAIR.address === PAIR && E.PAIR.token0 === WETH && E.PAIR.token1 === USDG && E.PAIR.dec0 === 18 && E.PAIR.dec1 === 6 && E.PAIR.factory === pf.asked[3].params[0].to && E.SYNC_TOPIC === SYNC && E.CELL === CELL && E.THIN_BELOW === 3 && E.SRC === 'rh-weth-usdg-pool');
  check('every saved log is this pair\'s Sync, and the node wrote 0x0 in every blockTimestamp (so it can never be a date)', SLICES.every((s) => s.logs.length > 100 && s.logs.every((l) => l.address === PAIR && l.topics[0] === SYNC && l.blockTimestamp === '0x0')), SLICES.map((s) => s.logs.length).join(' / '));
});

/* ═══ 2. decoding ═══ */
section('decoding', () => {
  // worked out with bc from the raw words: 131256357730 · 10^12 / 57562724772280549668 and 170869449446 · 10^12 / 93300068027911267460
  const a = E.decodeSync(SLICES[0].logs[0]), b = E.decodeSync(SLICES[1].logs[0]);
  check('the first saved Sync of each slice decodes to the cent: $2,280.23 at block 41,300,002 and $1,831.40 at block 116,107,328', a.usd.toFixed(2) === '2280.23' && a.block === 41300002 && b.usd.toFixed(2) === '1831.40' && b.block === 116107328, a.usd + ' ' + b.usd);
  check('  ...with the reserves as BigInt (57.56 WETH and 131,256.36 USDG) and the block, log index and transaction', a.r0 === 57562724772280549668n && a.r1 === 131256357730n && a.li === hexN(SLICES[0].logs[0].logIndex) && a.tx === SLICES[0].logs[0].transactionHash);
  let bad = 0, total = 0;
  for (const s of SLICES) for (const l of s.logs) { total++; const d = E.decodeSync(l); if (Math.round(d.usd * 100) !== centsOf(l) || d.micro !== microOf(l)) bad++; }
  check('every one of the ' + total + ' saved Syncs decodes to the cent of this file\'s own reading of its reserves', total > 1000 && bad === 0, bad + ' differ');
  check('the decoded Sync carries no date of any kind (the node\'s blockTimestamp is never read)', !Object.keys(a).some((k) => /time|ts|date|at$/i.test(k)), Object.keys(a).join(','));
  const throws = (l) => { try { E.decodeSync(l); return false; } catch { return true; } };
  const ok = SLICES[0].logs[0];
  check('it refuses what is not this pair\'s Sync — a Swap log, another pool\'s Sync, three words of data, no block number, a reserve wider than uint112 — by throwing, never a silent zero',
    throws({ ...ok, topics: ['0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'] }) && throws({ ...ok, address: '0x' + 'ab'.repeat(20) }) && throws({ ...ok, data: ok.data + '0'.repeat(64) }) && throws({ ...ok, blockNumber: undefined }) && throws(syncLog(5, 1, 1n << 112n, 10n ** 12n)) && !throws(ok));
  const dr = E.decodeSync(syncLog(5, 1, 0n, 10n ** 11n)), dr2 = E.decodeSync(syncLog(5, 1, 10n ** 20n, 99999n));
  check('a drained pool (no WETH, or under 0.1 USDG) is no price with the reason — never a division by zero, never 0', dr.micro === null && dr.usd === null && /drained/.test(dr.why) && dr2.micro === null && /drained/.test(dr2.why));
  const cells = new Map(), r = E.foldCells(cells, [...SLICES[0].logs.slice(0, 5), { ...SLICES[0].logs[5], removed: true }]);
  check('a log a reorg removed is skipped and counted, never folded', r.n === 5 && r.removed === 1 && [...cells.values()].reduce((t, c) => t + c.pts.length, 0) === new Set(SLICES[0].logs.slice(0, 5).map((l) => l.blockNumber)).size);
});

/* ═══ 3. one price per block ═══ */
section('one price per block', () => {
  const s = SLICES[0], B = 41348609;               // a real block with three Syncs
  const real = s.logs.filter((l) => hexN(l.blockNumber) === B);
  const cells = fold(s.logs), c = cells.get(Math.floor(B / CELL));
  const top = real.reduce((x, y) => (hexN(y.logIndex) > hexN(x.logIndex) ? y : x));
  check('a real block with three Syncs is one point, at its last Sync by logIndex', real.length === 3 && c.pts.filter((p) => p[0] === B).length === 1 && c.pts.find((p) => p[0] === B)[2] === microOf(top));
  let multi = 0, wrong = 0;
  for (const sl of SLICES) {
    const per = lastPerBlock(sl.logs), cs = fold(sl.logs), counts = new Map();
    for (const l of sl.logs) counts.set(hexN(l.blockNumber), (counts.get(hexN(l.blockNumber)) || 0) + 1);
    for (const [b, k] of counts) {
      if (k < 2) continue; multi++;
      const pts = cs.get(Math.floor(b / CELL)).pts.filter((p) => p[0] === b);
      if (pts.length !== 1 || pts[0][2] !== per.get(b).micro) wrong++;
    }
  }
  check('  ...and so is every one of the ' + multi + ' saved blocks with two or three Syncs', multi > 10 && wrong === 0, wrong + ' wrong');
  // six Syncs in that block, out of order: the attacker's pushes and the router's hops, then the block's last word
  const [r0, r1] = reserves(top);
  const six = [[40, 3n], [12, 5n], [55, 1n], [3, 7n], [54, 9n], [20, 2n]].map(([li, k]) => syncLog(B, li, r0, r1 * k));
  const rest = s.logs.filter((l) => hexN(l.blockNumber) !== B);
  const withSix = fold([...rest.slice(0, 200), ...six, ...rest.slice(200)]);
  const onlyLast = fold([...rest, six[2]]);
  const ci = Math.floor(B / CELL), cs6 = withSix.get(ci), m6 = E.cellMedian(cs6, null), m1 = E.cellMedian(onlyLast.get(ci), null);
  check('six Syncs in one block, read out of order, are one price: the one with the highest logIndex (55), counted once', cs6.pts.filter((p) => p[0] === B).length === 1 && cs6.pts.find((p) => p[0] === B)[1] === 55 && cs6.pts.find((p) => p[0] === B)[2] === microOf(six[2]));
  check('  ...and the cell\'s median and n are exactly what the block\'s last Sync alone gives', m6.micro === m1.micro && m6.n === m1.n && m6.weight === m1.weight, m6.micro + ' vs ' + m1.micro);
});

/* ═══ 4. the median, against a brute force over every block ═══ */
section('the median', () => {
  for (const s of SLICES) {
    const g = gridOf(s), per = lastPerBlock(s.logs), blocks = [...per.keys()].sort((a, b) => a - b);
    let cells = 0, bad = [], carried = 0, dom = 0, busy = 0;
    for (let ci = Math.floor(s.from / CELL); ci <= Math.floor(s.to / CELL); ci++) {
      cells++;
      const lo = Math.max(ci * CELL, s.from), hi = Math.min(ci * CELL + CELL - 1, s.to), want = bruteCell(per, blocks, lo, hi);
      const got = E.ethUsdAt(g, hi);
      if (got.carried) carried++;
      if (!got.thin) { busy++; if (got.dominant) dom++; }
      if (got.v == null || Math.round(got.v * 1e6) !== want.micro || got.cell.n !== want.n || got.cell.first !== want.first || got.cell.last !== want.last) bad.push(ci + ':' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
      if (!got.cell.top || got.cell.top.block !== want.top.block || got.cell.top.blocks !== want.top.blocks || got.dominant !== want.dominant) bad.push(ci + ' top/dominant:' + JSON.stringify([got.cell.top, got.dominant]) + ' want ' + JSON.stringify([want.top, want.dominant]));
    }
    check(s.file + ': each of its ' + cells + ' cells (' + carried + ' carried) is the median of its blocks, each at the price in force there, with n and the first and last priced block', cells === 30 && !bad.length, bad.slice(0, 2).join(' | '));
    check('  ...and the Sync whose price stood longest (top) and the dominant flag (it stood for half the priced blocks or more) match the brute force: ' + dom + ' of the ' + busy + ' busy cells are dominant on the real chain, so the flag means "one observation", not "pushed"', busy > 15 && dom > 0 && dom < busy && !bad.length);
  }
  const g = gridOf(SLICES[0]), s1 = g.sums.get(4131), s0 = g.sums.get(4130);
  check('a cell opens on the price the previous cell ended on (its last Sync), weighed by the blocks before its own first Sync', s1.opened === s0.out.micro && s0.out.block === s0.last && s1.weight === CELL && s0.weight === CELL - (s0.first - 4130 * CELL));
});

/* ═══ 5. a one-transaction spike ═══ */
section('the spike', () => {
  let cells = 0, moved0 = 0, tried = 0, worst = 0, meanMin = Infinity, same = 0, far = 0, held = 0, flagged = 0, heldMin = Infinity, near = 0;
  for (const s of SLICES) {
    const g = gridOf(s), c0 = fold(s.logs);
    for (const ci of g.keys) {
      const base = g.sums.get(ci); if (base.thin) continue;
      cells++;
      const idx = g.keys.indexOf(ci), carry = idx ? g.sums.get(g.keys[idx - 1]).out : null, pts = c0.get(ci).pts;
      for (let i = 0; i < pts.length; i++) {
        const next = i + 1 < pts.length ? pts[i + 1][0] : ci * CELL + CELL, gap = next - pts[i][0];
        if (gap < 3) continue;
        const spike = pts[i][2] * 3, b = pts[i][0] + 1;
        // (a) pushed ×3 by one transaction, the next block's arbitrage puts it back
        const a = { ci, size: CELL, pts: [...pts.slice(0, i + 1), [b, 0, spike], [b + 1, 0, pts[i][2]], ...pts.slice(i + 1)] };
        if (E.cellMedian(a, carry).micro !== base.micro) moved0++;
        // (b) pushed ×3 and left there until the pool's own next Sync — at every Sync, however far that next Sync is.
        // Under half the cell it must not move the median by 1%; for half the cell or more it IS the median, and the
        // cell must say so: dominant, with the push's own block as its top
        const st = { ci, size: CELL, pts: [...pts.slice(0, i + 1), [b, 0, spike], ...pts.slice(i + 1)] };
        const m = E.cellMedian(st, carry), d = Math.abs(m.micro - base.micro) / base.micro;
        tried++; if (gap > 1000) far++;
        if ((next - b) * 2 >= m.weight) { held++; heldMin = Math.min(heldMin, d); if (m.dominant && m.top.block === b && m.top.blocks === next - b) flagged++; }
        else { if (d > worst) worst = d; if (gap <= 1000 && d > near) near = d; }
      }
      // (c) pushed and put back inside the same block: the block's last Sync is the put-back price
      const sb = pts[Math.floor(pts.length / 2)][0];
      const [lr0, lr1] = [10n ** 20n, 10n ** 11n];
      const cs = fold([...s.logs.filter((l) => Math.floor(hexN(l.blockNumber) / CELL) === ci), syncLog(sb, 0, lr0, lr1 * 50n)]);
      if (E.cellMedian(cs.get(ci), carry).micro === base.micro) same++;
      const syncs = pts.map((p) => p[2]), mean = syncs.reduce((x, y) => x + y, 0) / syncs.length;
      meanMin = Math.min(meanMin, ((mean * syncs.length + base.micro * 3) / (syncs.length + 1) - mean) / mean);
    }
  }
  check('a ×3 spike the next block reverses moves the median of none of the ' + cells + ' busy cells (both slices, at every Sync)', cells > 40 && moved0 === 0, moved0 + ' moved');
  check('a ×3 spike left standing until the pool\'s own next Sync, at every Sync (' + tried + ' placements, ' + far + ' of them over 1,000 blocks), moves no cell\'s median by 1% while it stood for under half the cell (worst ' + (worst * 100).toFixed(3) + '%; ' + (near * 100).toFixed(3) + '% where that Sync came within 1,000 blocks)', tried > 850 && far > 90 && worst < 0.01 && near <= worst, worst);
  check('  ...and the ' + held + ' that stood for half the cell or more — where it moved the median by ' + (heldMin * 100).toFixed(0) + '% or more — are every one flagged dominant, naming the push\'s block and how long it stood', held >= 10 && flagged === held && heldMin > 1, flagged + '/' + held);
  check('  ...where a plain mean of the cell\'s Syncs would have moved by at least ' + (meanMin * 100).toFixed(1) + '% for one ×3 Sync', meanMin > 0.01);
  check('a push put back inside the same block changes nothing at all: the block\'s last Sync is its price', same === cells, same + '/' + cells);
});

/* ═══ 6. empty cells carry ═══ */
section('carry', () => {
  const s = SLICES[1], g = gridOf(s), per = lastPerBlock(s.logs), blocks = [...per.keys()].sort((a, b) => a - b);
  const empty = [];
  for (let ci = Math.floor(s.from / CELL); ci <= Math.floor(s.to / CELL); ci++) if (!blocks.some((b) => Math.floor(b / CELL) === ci)) empty.push(ci);
  let bad = [];
  for (const ci of empty) {
    const at = ci * CELL + 4321, before = blocks.filter((b) => b < ci * CELL).pop(), want = per.get(before).micro;
    const got = E.ethUsdAt(g, at), next = g.sums.get(ci + 1);
    if (!(got.v * 1e6 === want && got.carried === true && got.since === before && got.staleBlocks === at - before && got.thin === true && got.dominant === true && got.cell.top.block === before && got.cell.top.blocks === CELL && got.provisional === false && got.cell.n === 0 && got.cell.index === ci && got.src === 'rh-weth-usdg-pool')) bad.push(ci + ' ' + JSON.stringify(got));
    if (next && next.opened !== want) bad.push('cell ' + (ci + 1) + ' did not open on the carried price');
  }
  check('the ' + empty.length + ' cells with no Sync (' + empty.join(', ') + ') carry the last Sync before them: flagged carried, thin and dominant (one Sync\'s price for the whole cell), with the block that set it and its age in blocks', empty.length === 5 && !bad.length, bad.join(' | '));
  check('  ...and each next cell opens on that carried price', !bad.some((x) => /did not open/.test(x)));
  const real = E.ethUsdAt(g, 116125000);
  check('a cell with Syncs of its own is not carried (since null, staleBlocks 0)', real.carried === false && real.since === null && real.staleBlocks === 0 && real.v > 1000);
});

/* ═══ 7. windows: split mid-cell = unsplit ═══ */
section('windows', () => {
  const s = SLICES[0], whole = fold(s.logs), gWhole = gridOf(s);
  // a walker over the slice: windows of at most 123,457 blocks, each end pulled back to a cell's last block
  const wins = []; let from = s.from;
  while (from <= s.to) { const w = E.alignWindow(from, Math.min(s.to, from + 123456)); wins.push(w); from = w.to + 1; }
  const walked = new Map();
  for (const w of wins) E.foldCells(walked, s.logs.filter((l) => hexN(l.blockNumber) >= w.from && hexN(l.blockNumber) <= w.to));
  check('a walk in cell-aligned windows (' + wins.map((w) => w.from + '–' + w.to).join(', ') + ') ends every window on a cell\'s last block', wins.length === 3 && wins.every((w) => (w.to + 1) % CELL === 0 && !w.open) && wins[wins.length - 1].to === s.to);
  check('  ...and folds to exactly the cells one unsplit read gives', cellsJson(walked) === cellsJson(whole));
  // the tail: split mid-cell, and mid-block — block 41,348,609's Syncs are at logIndex 24, 47 and 70: the one at 70 (the
  // block's price) in the part folded FIRST, 24 and 47 in the part folded after it, which must not replace it
  const B = 41348609, cut = (l) => hexN(l.blockNumber) < B || (hexN(l.blockNumber) === B && hexN(l.logIndex) < 50);
  const later = s.logs.filter((l) => !cut(l)), earlier = s.logs.filter(cut), inB = (part) => part.filter((l) => hexN(l.blockNumber) === B).map((l) => hexN(l.logIndex)).sort((a, b) => a - b).join();
  const split = new Map();
  E.foldCells(split, later.reverse());
  E.foldCells(split, earlier);
  const halves = cellsJson(split), atB = split.get(4134).pts.find((p) => p[0] === B);   // before the window read twice (it holds block B again)
  E.foldCells(split, s.logs.slice(100, 300));       // a window read twice
  const g2 = E.buildGrid(split, { from: s.from, to: s.to });
  check('the split really is mid-block: block 41,348,609\'s Sync at logIndex 70 is in the part folded first, its 24 and 47 in the part folded after', inB(later) === '70' && inB(earlier) === '24,47', inB(later) + ' / ' + inB(earlier));
  check('  ...and the two halves alone already fold to the unsplit cells: the later call kept logIndex 70 as the block\'s price', halves === cellsJson(whole) && atB[1] === 70 && atB[2] === microOf(s.logs.find((l) => hexN(l.blockNumber) === B && hexN(l.logIndex) === 70)), JSON.stringify(atB));
  check('a read split mid-cell and mid-block, its parts folded in reverse and one window read twice, equals the unsplit read: the same cells and the same medians', cellsJson(split) === cellsJson(whole) && sumsJson(g2) === sumsJson(gWhole));
  let diff = 0; for (let b = s.from; b <= s.to; b += 997) if (JSON.stringify(E.ethUsdAt(g2, b)) !== JSON.stringify(E.ethUsdAt(gWhole, b))) diff++;
  check('  ...and the same answer at every 997th block of the slice', diff === 0, diff);
  const stored = new Map(JSON.parse(JSON.stringify([...whole])));
  check('the folded cells stored as JSON and read back give the same grid (what the server keeps is plain JSON)', sumsJson(E.buildGrid(stored, { from: s.from, to: s.to })) === sumsJson(gWhole));
  const rows = JSON.parse(JSON.stringify([...whole.values()]));     // one stored row per cell, as the server keeps them
  check('  ...and so do the cells stored one row per cell and keyed again by each row\'s own ci', sumsJson(E.buildGrid(new Map(rows.map((c) => [c.ci, c])), { from: s.from, to: s.to })) === sumsJson(gWhole));
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  const strKeyed = new Map(Object.entries(Object.fromEntries(whole)));            // '4130' → cell: what an Object.entries rebuild gives
  const shifted = new Map([...whole].map(([k, c]) => [k + 1, c]));                // every row under its neighbour's key
  check('a Map of cells keyed by strings (an Object.entries rebuild, a TEXT column) or under the wrong cell\'s key is refused by buildGrid and foldCells — never read as an empty cell and answered with the previous cell\'s last Sync, flagged carried',
    throws(() => E.buildGrid(strKeyed, { from: s.from, to: s.to })) && throws(() => E.foldCells(strKeyed, s.logs.slice(0, 3))) && throws(() => E.buildGrid(shifted, { from: s.from, to: s.to })) && throws(() => E.foldCells(shifted, [])) && strKeyed.size === 30 && !strKeyed.has(4145));
  // alignWindow on its own
  const a1 = E.alignWindow(41300000, 41345678), a2 = E.alignWindow(41340000, 41345678), a3 = E.alignWindow(41345679, 41349999), a4 = E.alignWindow(5, 4), a5 = E.alignWindow(0, 999, 100), a6 = E.alignWindow(1234, 1250, 100);
  check('alignWindow pulls a mid-cell end back to the last whole cell (41,300,000–41,345,678 → …41,339,999, 4 cells)', a1.from === 41300000 && a1.to === 41339999 && a1.open === false && a1.cells === 4, JSON.stringify(a1));
  check('  ...keeps the tail, a range inside one cell, as it is and flags it open', a2.to === 41345678 && a2.open === true && a2.cells === 1, JSON.stringify(a2));
  check('  ...a range ending on a cell\'s last block is already whole; an empty range is null; the cell size is the caller\'s', a3.to === 41349999 && a3.open === false && a4 === null && a5.to === 999 && a5.cells === 10 && a6.to === 1250 && a6.open === true && E.alignWindow(-1, 5) === null && E.alignWindow(1.5, 9) === null);
});

/* ═══ 7b. reorgs: a removed log, and a range read again ═══ */
section('reorgs', () => {
  const r0 = 50n * 10n ** 18n, r1 = 100000n * 10n ** 6n, throws = (fn) => { try { fn(); return false; } catch { return true; } };
  const a = new Map();
  E.foldCells(a, [syncLog(2000500, 7, r0, r1)]);
  const ra = E.foldCells(a, [syncLog(2000500, 7, r0, r1, { removed: true })]);
  check('a log a reorg removed takes out the point it put in (and a cell left empty is gone), counted', a.size === 0 && ra.removed === 1 && ra.dropped === 1 && ra.n === 0, JSON.stringify([[...a], ra]));
  const b = new Map();
  E.foldCells(b, [syncLog(2000500, 9, r0, r1)]);
  const rb = E.foldCells(b, [syncLog(2000500, 7, r0, r1, { removed: true }), syncLog(2000500, 9, r0, r1 * 2n, { removed: true })]);
  check('  ...but only that point: a removed log with another logIndex, or the same logIndex and another price, takes out nothing', JSON.stringify(b.get(200).pts) === JSON.stringify([[2000500, 9, 2000000000]]) && rb.removed === 2 && rb.dropped === 0);
  const orphan = syncLog(2000500, 7, r0, r1, { removed: true }), heir = syncLog(2000500, 7, r0, r1 * 3n);
  const c1 = new Map(), c2 = new Map();
  E.foldCells(c1, [syncLog(2000500, 7, r0, r1)]); E.foldCells(c1, [orphan, heir]);
  E.foldCells(c2, [syncLog(2000500, 7, r0, r1)]); E.foldCells(c2, [heir, orphan]);
  check('  ...and an answer carrying both the orphaned Sync and its replacement ends on the replacement, in either order', JSON.stringify(c1.get(200).pts) === JSON.stringify([[2000500, 7, 6000000000]]) && cellsJson(c1) === cellsJson(c2));

  // block 41,348,609 (Syncs at logIndex 24, 47 and 70) reorganised: the chain now has, in 41,348,000–41,349,999, only one
  // Sync — at logIndex 3 of that block, at another price. The walker reads that range again.
  const s = SLICES[0], B = 41348609, R = { from: 41348000, to: 41349999 };
  const inR = (l) => hexN(l.blockNumber) >= R.from && hexN(l.blockNumber) <= R.to;
  const topB = s.logs.filter((l) => hexN(l.blockNumber) === B).reduce((x, y) => (hexN(y.logIndex) > hexN(x.logIndex) ? y : x));
  const [b0, b1] = reserves(topB), reread = [syncLog(B, 3, b0, b1 * 2n)];
  const canonical = [...s.logs.filter((l) => !inR(l)), ...reread];
  const merged = fold(s.logs); E.foldCells(merged, reread);
  check('a plain fold of the re-read keeps the orphaned Syncs — logIndex 70 beats the canonical 3 — which is why a re-read must replace', s.logs.filter(inR).length > 1 && merged.get(4134).pts.find((p) => p[0] === B)[1] === 70 && cellsJson(merged) !== cellsJson(fold(canonical)));
  const replaced = fold(s.logs), rr = E.foldCells(replaced, reread, CELL, { replace: R });
  check('  ...and with replace the cells, the grid and every answer equal a fresh read of the chain as it now is', cellsJson(replaced) === cellsJson(fold(canonical)) && sumsJson(E.buildGrid(replaced, { from: s.from, to: s.to })) === sumsJson(E.buildGrid(fold(canonical), { from: s.from, to: s.to })) && rr.cleared === new Set(s.logs.filter(inR).map((l) => l.blockNumber)).size && rr.n === 1 && replaced.get(4134).pts.find((p) => p[0] === B)[1] === 3, JSON.stringify(rr));
  const emptied = fold(s.logs);
  E.foldCells(emptied, [], CELL, { replace: { from: 41350000, to: 41359999 } });
  check('  ...a re-read that finds no Sync in a whole cell removes that cell, as a fresh read would never have made it', !emptied.has(4135) && cellsJson(emptied) === cellsJson(fold(s.logs.filter((l) => Math.floor(hexN(l.blockNumber) / CELL) !== 4135))));
  const before = cellsJson(replaced);
  check('a replace refuses a Sync outside the range it re-read, and a bad log anywhere in an answer leaves every cell as it was (all decoded before any change)',
    throws(() => E.foldCells(replaced, [syncLog(R.to + 1, 0, r0, r1)], CELL, { replace: R })) && throws(() => E.foldCells(replaced, [syncLog(B, 1, r0, r1)], CELL, { replace: { from: 5, to: 4 } })) &&
    throws(() => E.foldCells(replaced, [syncLog(B + 1, 0, r0, r1), { ...s.logs[0], topics: ['0x' + '00'.repeat(32)] }])) && cellsJson(replaced) === before);
});

/* ═══ 8. before the first Sync, and outside what was read ═══ */
section('no price', () => {
  const s = SLICES[0], cells = fold(s.logs);
  const g = E.buildGrid(cells, { from: 41290000, to: s.to, origin: true });   // a read that began before the pool's first Sync
  const r1 = E.ethUsdAt(g, 41300001), r2 = E.ethUsdAt(g, 41280000), r3 = E.ethUsdAt(g, 41300002);
  check('before the pool\'s first Sync → null, with the reason and the block of that first Sync', r1.v === null && /before the WETH\/USDG pool’s first Sync \(block 41300002\)/.test(r1.why) && r2.v === null && r2.why === r1.why, JSON.stringify([r1, r2]));
  check('  ...and from the first Sync\'s own block on, a price', r3.v > 2000 && r3.carried === false);
  const g2 = E.buildGrid(cells, { from: s.from, to: s.to });
  const n1 = E.ethUsdAt(g2, 41300001), n2 = E.ethUsdAt(g2, 41299999), n3 = E.ethUsdAt(g2, s.to + 1);
  check('a read that did not start at the pool\'s beginning says so instead: "not read", never "before the first Sync"', n1.v === null && /price before block 41300000 was not read/.test(n1.why) && n2.v === null && /not read: the ETH\/USD history starts at block 41300000/.test(n2.why), JSON.stringify([n1, n2]));
  check('a block past what was read → null, "not read yet", with the block it is read up to', n3.v === null && n3.why === 'not read yet: the ETH/USD history is read up to block 41599999');
  check('no block number → null with the reason (never a price for block 0 or NaN)', [undefined, null, -1, 1.5, '41300005', NaN].every((b) => { const r = E.ethUsdAt(g2, b); return r.v === null && /no block number/.test(r.why); }));
  const none = E.buildGrid(new Map(), { from: 100, to: 99999, origin: true });
  check('a pool with no Sync at all in what was read → null with the reason', E.ethUsdAt(none, 5000).v === null && /no Sync up to block 99999/.test(E.ethUsdAt(none, 5000).why));
  // the reason codes and kinds lib/acquire.js reads (x.kind === 'structural'; anything else is retried as transient)
  const codeOf = (r) => r.code + '/' + r.kind;
  const pinned = [
    [r1, 'before-first-sync/structural'], [r2, 'before-first-sync/structural'], [E.ethUsdAt(none, 5000), 'before-first-sync/structural'],
    [n1, 'not-read/transient'], [n2, 'not-read/transient'], [n3, 'not-read-yet/transient'], [E.ethUsdAt(g2, 1.5), 'no-block/structural'],
  ];
  check('every null carries a reason code and a kind: before-first-sync and no-block are structural (that block will never have a price here), not-read-yet and not-read transient (reading on can price it)', pinned.every(([r, want]) => r.v === null && codeOf(r) === want), pinned.map(([r]) => codeOf(r)).join(' '));
  check('  ...and the library\'s table of them is exactly that (with drained structural)', JSON.stringify(E.NULL_KINDS) === JSON.stringify({ 'not-read-yet': 'transient', 'not-read': 'transient', 'before-first-sync': 'structural', drained: 'structural', 'no-block': 'structural' }) && Object.isFrozen(E.NULL_KINDS));
});

/* ═══ 9. thin, provisional, drained ═══ */
section('flags', () => {
  const s = SLICES[1], g = gridOf(s), counts = new Map();
  for (const b of lastPerBlock(s.logs).keys()) counts.set(Math.floor(b / CELL), (counts.get(Math.floor(b / CELL)) || 0) + 1);
  const thinWant = [...counts].filter(([, k]) => k < 3).map(([ci]) => ci).sort((a, b) => a - b);
  const thinGot = [], wrong = [];
  for (const [ci] of counts) { const r = E.ethUsdAt(g, ci * CELL + CELL - 1); if (r.thin) thinGot.push(ci); if (r.thin !== (counts.get(ci) < 3)) wrong.push(ci); }
  check('a cell with fewer than 3 priced blocks is flagged thin (' + thinWant.join(', ') + '), and no other cell is', thinWant.length >= 4 && !wrong.length && thinGot.sort((a, b) => a - b).join() === thinWant.join(), wrong.join());
  const s0 = SLICES[0], cells = fold(s0.logs), gOpen = E.buildGrid(cells, { from: s0.from, to: 41345678 }), gFull = gridOf(s0);
  const p1 = E.ethUsdAt(gOpen, 41345000), p0 = E.ethUsdAt(gOpen, 41339999), pf = E.ethUsdAt(gFull, 41345000);
  check('the still-open cell (read only to block 41,345,678) is provisional; the cells before it are not', p1.provisional === true && p1.cell.to === 41345678 && p0.provisional === false && p0.v === E.ethUsdAt(gFull, 41339999).v);
  check('  ...and once its last block is read it is not, and its median is taken over the whole cell', pf.provisional === false && pf.cell.to === 41349999 && gFull.sums.get(4134).weight === CELL);
  const cs = new Map(), r0 = 50n * 10n ** 18n, r1 = 100000n * 10n ** 6n;
  E.foldCells(cs, [syncLog(1000100, 1, r0, r1), syncLog(1000200, 2, r0, r1 * 2n), syncLog(1000300, 3, r0, r1), syncLog(1005000, 4, 0n, 0n), syncLog(1035000, 5, r0, r1 * 3n)]);
  const gd = E.buildGrid(cs, { from: 1000000, to: 1049999, origin: true });
  const d1 = E.ethUsdAt(gd, 1004000), d2 = E.ethUsdAt(gd, 1015000), d3 = E.ethUsdAt(gd, 1035001), d4 = E.ethUsdAt(gd, 1045000);
  check('a drained pool: the cell it drained in is priced by the blocks before the drain only', d1.v === 2000 && d1.cell.n === 3 && gd.sums.get(100).weight === 4900, JSON.stringify(d1));
  check('  ...the empty cells after it are null with "drained", never the old price carried across the drain', d2.v === null && /drained/.test(d2.why) && /at block 1005000/.test(d2.why), JSON.stringify(d2));
  check('  ...a Sync that restores reserves prices again, and carries from there', d3.v === 6000 && d4.v === 6000 && d4.carried === true && d4.since === 1035000);
  check('  ...and the empty cells\' null says so in code: drained, structural', d2.code === 'drained' && d2.kind === 'structural');
  // inside a drain in a cell that has a median of its own: no price, whatever the cell's other blocks give
  const at = (b) => E.ethUsdAt(gd, b), isDrained = (r) => r.v === null && r.code === 'drained' && r.kind === 'structural' && /drained/.test(r.why);
  check('a block inside a drain in its own cell has no price: the drain\'s block and after (1,005,000, 1,006,000, 1,009,999) — never the cell\'s pre-drain median — while the block before it has one',
    isDrained(at(1005000)) && isDrained(at(1006000)) && isDrained(at(1009999)) && /from block 1005000/.test(at(1006000).why) && at(1004999).v === 2000, JSON.stringify(at(1006000)));
  check('  ...nor a block still drained before the Sync that restores it (1,030,000–1,034,999), which never reads the 6,000 that only came at 1,035,000; from that block on, a price',
    isDrained(at(1030000)) && isDrained(at(1031000)) && isDrained(at(1034999)) && /until block 1035000 restored it/.test(at(1031000).why) && at(1035000).v === 6000 && at(1039999).v === 6000, JSON.stringify(at(1031000)));
  check('  ...the cells record their drained stretches', JSON.stringify(gd.sums.get(100).drains) === '[[1005000,1009999]]' && JSON.stringify(gd.sums.get(103).drains) === '[[1030000,1034999]]' && !gd.sums.has(101));
  const ce = new Map();
  E.foldCells(ce, [syncLog(1000100, 1, r0, r1), syncLog(1000200, 2, r0, r1 * 2n), syncLog(1000300, 3, r0, r1), syncLog(1012000, 4, 0n, 0n)]);
  const ge = E.buildGrid(ce, { from: 1000000, to: 1029999, origin: true }), e1 = E.ethUsdAt(ge, 1011000), e2 = E.ethUsdAt(ge, 1019000), e3 = E.ethUsdAt(ge, 1025000);
  check('a cell whose only Sync drains the pool: carried before the drain (since 1,000,300), no price from the drain on — in that cell and the empty one after it', e1.v === 2000 && e1.carried === true && e1.since === 1000300 && isDrained(e2) && isDrained(e3), JSON.stringify([e1, e2, e3]));
});

/* ═══ 10. pure ═══ */
section('purity', () => {
  const src = readFileSync(path.join(ROOT, 'lib', 'ethusd.js'), 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('lib/ethusd.js requires nothing, reads no clock and never touches a log\'s blockTimestamp', !/\brequire\s*\(/.test(code) && !/Date\.now|new Date|performance\./.test(code) && !/blockTimestamp/.test(code));
  const s = SLICES[0], junk = s.logs.map((l) => ({ ...l, blockTimestamp: '0x' + (Math.random() * 1e9 | 0).toString(16) }));
  check('folding the same logs with different blockTimestamps gives the same cells', cellsJson(fold(junk)) === cellsJson(fold(s.logs)));
  const g = gridOf(s);
  check('the grid, its cell list and every cell\'s summary are frozen (a reader cannot change a price under another)', Object.isFrozen(g) && Object.isFrozen(g.keys) && [...g.sums.values()].every((c) => Object.isFrozen(c) && Object.isFrozen(c.out) && Object.isFrozen(c.top) && Object.isFrozen(c.drains)));
});

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !x ? '' : '  — ' + x)); if (ok) pass++; }
console.log(`${pass}/${results.length} passed`);
process.exitCode = pass === results.length ? 0 : 1;
