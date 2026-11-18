'use strict';
/* ===== ETH/USD at any past block, from the chain's own WETH/USDG pool ("$100 bought", decisions H9) =================
   Owner, 2026-11-17: "make it $100 of value bought in the token not the current token value". A buy paid in WETH is
   worth the WETH paid × ETH's USD price AT THAT BLOCK, so the site needs ETH/USD for any past block. Today it has only
   a live figure (server.js ethUsd(), CoinGecko, one minute old), and nothing third-party keeps a per-block history of
   this chain. The chain does: its Uniswap-v2-style WETH/USDG pair emits Sync(reserve0, reserve1) every time its
   reserves change, and its price at every block is the last Sync before it.

   The pair (measured 2026-11-18 01:34 UTC on the public node with the site's honest User-Agent; the answers are kept
   in tests/fixtures/ethusd/pair-facts.json): 0x8803c117ccae7b5146297876c2a25df135141c4d — token0() is WETH (18
   decimals), token1() is USDG (decimals() answered 6), and the factory's getPair(WETH, USDG) answers this address.
   USDG is counted at $1 (the copy says so), so ETH/USD = reserve1 / 10^6 ÷ reserve0 / 10^18 = reserve1 · 10^12 / reserve0.

   Why not just read the Sync before the buy: the pool is thin (~$125k–$170k a side in the saved answers), so one
   transaction can push its price anywhere for a block and be arbitraged back in the next one. A buy dated inside that
   block would be valued at the pushed price. So the price is never one Sync; it is a cell's median (the rules below),
   and one block cannot move it far. Measured on the saved answers (tests/ethusd.mjs), a ×3 spike placed after every
   Sync of the 48 busy cells: reversed by the next block it moves no median at all; left standing until the pool's own
   next Sync it moves a median by 0.58% at most (0.11% when that Sync came within 1,000 blocks) — UNLESS the push stood
   for half the cell or more (12 of the 903 placements, each over 5,000 blocks, about 8 minutes). A price that stood
   for half a cell's priced blocks IS its median, ×3 or not, and nothing inside one cell can tell a push nobody
   arbitraged from a quiet pool's honest price (14 of the 48 real busy cells have one Sync standing that long). So such
   a cell is flagged `dominant`, with the Sync that stood (top): the same "this figure rests on one observation" class
   as thin, for the reader to treat as it treats thin (lib/acquire.js, the gate). The flag counts ONE Sync: a push held
   through more Syncs of the pusher's own (small follow-up trades) splits into pieces none of which is half the cell,
   and is not flagged. Only comparing a cell with its neighbours catches that, and this file does not.

   The rules (decisions H9, every one tested in tests/ethusd.mjs on the saved chain answers):
     · cells of CELL = 10,000 blocks (about 17 minutes at the chain's ~0.1 s blocks); a block's cell is floor(block / CELL);
     · one price per block: the block's LAST Sync by logIndex. Six Syncs in one block (a router's hops, a sandwich)
       are one price — what the block ended on;
     · per cell, the BLOCK-WEIGHTED median: each price weighs the number of the cell's blocks it was in force for, so a
       price that stood for one block weighs one block. The blocks before the cell's first Sync are opened by the price
       in force when the cell began (the previous priced cell's last Sync); n = the cell's priced blocks; its first and
       last priced block are kept. The median is the lower weighted median, in whole millionths of a dollar, so the
       same Syncs always give the same number, however and in whatever order they were read;
     · a cell with no Sync CARRIES the last price forward, flagged carried, with the block that set it and how many
       blocks old it is. Only before the pool's first Sync is there no price (null with the reason);
     · a cell with fewer than THIN_BELOW = 3 priced blocks is flagged thin (a carried cell has 0);
     · a cell where one Sync's price stood for half its priced blocks or more is flagged dominant (a carried cell is);
     · the still-open cell (its last block is past what was read) is provisional: a buy valued there is valued again
       once the cell closes;
     · a Sync whose reserves fall under the drain floor (1e-4 WETH or 0.1 USDG, the price chart's PHIST_DRAIN_* rule)
       is a drained pool: no price for any block from that Sync's block until a Sync restores one — in its own cell
       too, whatever that cell's median is — and nothing is carried across it.

   Unknown is null with a reason, never 0 and never a guess: { v: null, why, code, kind }. `why` is copy; `code` is the
   reason to store (decisions H13); `kind` says whether reading on can change it (lib/acquire.js reads it, H11):
     transient  — not-read-yet (a block past what was read), not-read (before what was read, when the read did not
                  start at the pool's first Sync);
     structural — before-first-sync, drained (inside a drain), no-block (not a block number): that block will never
                  have a price from this pool.

   This file is pure: no chain reads, no database, no clock. The tape walker (lib/tape.js) reads the pair's Sync logs
   window by window — alignWindow() keeps every window ending on a cell's last block — and folds each answer at once
   (foldCells). A range read again because the chain may have changed under it (the open cell, every tick) is folded
   with `replace`, which clears that range's old points first: a plain fold merges, so a Sync a reorg took away would
   otherwise stand (and keep beating a canonical Sync with a lower logIndex). The server keeps the folded cells and
   builds the grid (buildGrid) that ethUsdAt() reads. A log's blockTimestamp is never read (the node answers "0x0"). */

const CELL = 10000;
const THIN_BELOW = 3;
const SRC = 'rh-weth-usdg-pool';
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1';   // Sync(uint112,uint112)
const PAIR = Object.freeze({
  address: '0x8803c117ccae7b5146297876c2a25df135141c4d',
  factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f',
  token0: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', dec0: 18,   // WETH
  token1: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', dec1: 6,    // USDG (Global Dollar), counted at $1
});
// a drained pool: reserves under these are no price at all (server.js PHIST_DRAIN_WETH = 1e-4, PHIST_DRAIN_USDG = 0.1)
const DRAIN_WETH_WEI = 10n ** 14n;
const DRAIN_USDG_UNITS = 10n ** 5n;
const UINT112_MAX = (1n << 112n) - 1n;
const MICRO = 1e6;                       // prices are kept in whole millionths of a dollar (exact integers in a Number)
const DRAINED_WHY = 'the pool was drained (its reserves fell under 0.0001 WETH or 0.1 USDG), so it gave no price';
// every reason a block has no price, and whether reading on can change it (the header says which is which)
const NULL_KINDS = Object.freeze({
  'not-read-yet': 'transient', 'not-read': 'transient',
  'before-first-sync': 'structural', drained: 'structural', 'no-block': 'structural',
});
const none = (code, why) => ({ v: null, why, code, kind: NULL_KINDS[code] });

const lc = (a) => String(a == null ? '' : a).toLowerCase();
function blockNo(x) {             // '0x…' (a node's answer) or a whole number (a stored row) → a block number, else null
  if (typeof x === 'number') return Number.isSafeInteger(x) && x >= 0 ? x : null;
  if (typeof x !== 'string' || !/^0x[0-9a-f]{1,14}$/i.test(x)) return null;
  return parseInt(x, 16);
}
const cellOf = (block, size = CELL) => Math.floor(block / size);
const cellSpan = (ci, size = CELL) => ({ from: ci * size, to: ci * size + size - 1 });

/* ----- one Sync log → its reserves and its price ------------------------------------------------------------------
   Returns { block, li, tx, r0, r1, micro, usd } (r0 WETH wei and r1 USDG units as BigInt; micro = USD per ETH in whole
   millionths, rounded down; usd = micro / 10^6), or for a drained pool micro and usd null with `why`. Throws on a log
   that is not this pair's Sync — a walker that asked the wrong question must fail loudly, never fold a silent zero. */
function decodeSync(log) {
  if (!log || typeof log !== 'object') throw new Error('not a log');
  if (lc(log.address) !== PAIR.address) throw new Error('a log from ' + (log.address || 'no address') + ', not the WETH/USDG pair');
  if (!Array.isArray(log.topics) || lc(log.topics[0]) !== SYNC_TOPIC) throw new Error('not a Sync log');
  const d = String(log.data || '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{128}$/i.test(d)) throw new Error('a Sync whose data is not two words');
  const block = blockNo(log.blockNumber), li = blockNo(log.logIndex);
  if (block == null || li == null) throw new Error('a Sync without a block number or a log index');
  const r0 = BigInt('0x' + d.slice(0, 64)), r1 = BigInt('0x' + d.slice(64));
  if (r0 > UINT112_MAX || r1 > UINT112_MAX) throw new Error('a Sync with a reserve wider than uint112');
  const out = { block, li, tx: log.transactionHash ? lc(log.transactionHash) : null, r0, r1, micro: null, usd: null };
  if (r0 < DRAIN_WETH_WEI || r1 < DRAIN_USDG_UNITS) { out.why = DRAINED_WHY; return out; }
  // USD per ETH = (r1 / 10^6) / (r0 / 10^18); in millionths: r1 · 10^18 / r0 (BigInt, so no float error before the end)
  out.micro = Number((r1 * 10n ** 18n) / r0);
  out.usd = out.micro / MICRO;
  return out;
}

/* ----- fold Sync logs into cells --------------------------------------------------------------------------------------
   cells: a Map cell index (a Number, equal to the cell's own ci) → { ci, size, pts }, pts = [[block, logIndex,
   micro|null]] sorted by block, ONE entry per block (the highest logIndex seen wins). Plain arrays, so a cell stores as
   JSON and comes back unchanged — but the Map must be rebuilt with NUMBER keys (new Map(rows.map((c) => [c.ci, c])));
   a Map keyed '4145' is refused here and in buildGrid, never read as an empty cell. The fold is order-free and
   repeatable: the same logs read in one window, in ten, in reverse or twice leave the same cells — which is what lets a
   window split mid-cell (the minute-by-minute tail) equal one unsplit read.
   opts.replace = { from, to }: this answer is a fresh read of exactly [from … to], so the points already folded there
   are cleared first and the answer's own put in (a log outside the range throws). That is how a re-read after a reorg
   lands: a merge would keep the orphaned Sync, and keep it over a canonical one with a lower logIndex.
   A log a reorg removed (removed: true) takes out the point it put in — the same block, logIndex and price — before
   anything in the answer is added, and is counted; a cell left with no point is deleted from the Map. Every log is
   decoded before a single cell changes, so a bad log leaves the cells as they were.
   Returns { n, removed, dropped, cleared, first, last }: n Syncs folded, removed logs seen, points they took out,
   points the replace cleared; first / last: the answer's own earliest and latest Sync, { block, li, micro }. */
function foldCells(cells, logs, size = CELL, opts) {
  if (!(cells instanceof Map)) throw new TypeError('foldCells needs a Map of cells');
  if (!Number.isSafeInteger(size) || size < 1) throw new TypeError('a cell size must be a whole number of blocks');
  checkCells(cells, size);
  const rep = opts && opts.replace != null ? opts.replace : null;
  if (rep && (!Number.isSafeInteger(rep.from) || !Number.isSafeInteger(rep.to) || rep.from < 0 || rep.to < rep.from)) {
    throw new RangeError('a replace needs the blocks it re-read: whole numbers, from ≤ to');
  }
  const adds = [], drops = [];
  for (const l of logs || []) {
    const s = decodeSync(l);
    if (rep && (s.block < rep.from || s.block > rep.to)) throw new RangeError('a Sync at block ' + s.block + ', outside the range this fold replaces (' + rep.from + '–' + rep.to + ')');
    (l.removed ? drops : adds).push(s);
  }
  let cleared = 0, dropped = 0, first = null, last = null;
  if (rep) {
    for (let ci = cellOf(rep.from, size), end = cellOf(rep.to, size); ci <= end; ci++) {
      const c = cells.get(ci);
      if (!c) continue;
      const keep = c.pts.filter((p) => p[0] < rep.from || p[0] > rep.to);
      cleared += c.pts.length - keep.length;
      if (keep.length) c.pts = keep; else cells.delete(ci);
    }
  }
  // removals before additions, so an answer that carries both the orphaned log and its replacement ends on the replacement
  for (const s of drops) {
    const c = cells.get(cellOf(s.block, size));
    if (c && dropPoint(c.pts, s.block, s.li, s.micro)) { dropped++; if (!c.pts.length) cells.delete(c.ci); }
  }
  for (const s of adds) {
    const ci = cellOf(s.block, size);
    let c = cells.get(ci);
    if (!c) cells.set(ci, c = { ci, size, pts: [] });
    putPoint(c.pts, s.block, s.li, s.micro);
    const p = { block: s.block, li: s.li, micro: s.micro };
    if (!first || s.block < first.block || (s.block === first.block && s.li < first.li)) first = p;
    if (!last || s.block > last.block || (s.block === last.block && s.li > last.li)) last = p;
  }
  return { n: adds.length, removed: drops.length, dropped, cleared, first, last };
}
/* every key a whole number equal to its cell's own ci, every cell folded at this size: a Map rebuilt from stored rows
   with string keys ('4145') would otherwise miss on cells.get(4145) — foldCells would start a second cell next to it,
   and ethUsdAt would fall through to the previous cell's last Sync, flagged carried: a wrong price that looks honest */
function checkCells(cells, size) {
  for (const [k, c] of cells) {
    if (!Number.isSafeInteger(k) || !c || c.ci !== k || !Array.isArray(c.pts)) throw new TypeError('cells must be keyed by their own whole-number ci (key ' + JSON.stringify(k) + ', ci ' + JSON.stringify(c && c.ci) + ')');
    if ((c.size || CELL) !== size) throw new Error('cell ' + k + ' was folded with ' + c.size + '-block cells, not ' + size);
  }
}
function findBlock(pts, block) {
  // logs arrive in chain order almost always: the append (or same-last-block) path first, a binary search otherwise
  let lo = 0, hi = pts.length;
  if (hi && pts[hi - 1][0] < block) return hi;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < block) lo = m + 1; else hi = m; }
  return lo;
}
function putPoint(pts, block, li, micro) {
  const lo = findBlock(pts, block), at = pts[lo];
  if (at && at[0] === block) { if (li > at[1]) pts[lo] = [block, li, micro]; return; }   // the block's later Sync is its price
  pts.splice(lo, 0, [block, li, micro]);
}
function dropPoint(pts, block, li, micro) {
  // only the point this very log put in: the same logIndex AND price (a block keeps one point, so a removed log with a
  // lower logIndex than the stored one was never its price and changes nothing)
  const lo = findBlock(pts, block), at = pts[lo];
  if (!at || at[0] !== block || at[1] !== li || at[2] !== micro) return false;
  pts.splice(lo, 1);
  return true;
}

/* ----- one cell's block-weighted median ------------------------------------------------------------------------------
   carryIn: the price in force when the cell (or the read part of it) begins — { micro, block } as the previous priced
   cell's `out` gives it (micro null: the pool was drained then), or null when nothing before is known. bounds
   { from, to } (optional) limit the cell to the blocks actually read: Syncs outside them are ignored and the blocks
   past `to` weigh nothing (the still-open cell). Returns
     { ci, from, to, closed, n, first, last, micro, usd, weight, opened, out, thin, carried, since, top, dominant,
       drains, why?, code?, kind? }
   micro / usd: the lower weighted median (null with why, code and kind when no price was in force anywhere in it);
   weight: the priced blocks it was taken over; opened: the price the cell opened on; out: the price in force at its
   last read block (the next cell's carryIn); carried: no Sync of this cell priced it (the opening price did), since =
   the block that set it; top: { block, blocks } — the Sync whose price stood the longest here (block: the block whose
   last Sync it was; the carryIn's block for the opening price) and how many blocks; dominant: top stood for half the
   weight or more, so the median IS that one Sync's price; drains: [[from, to]] — the stretches of this cell's read
   blocks when the pool was drained (from the draining Sync's block to the block before the Sync that restored it). */
function cellMedian(cell, carryIn, bounds) {
  if (!cell || !Number.isSafeInteger(cell.ci) || !Array.isArray(cell.pts)) throw new TypeError('cellMedian needs a folded cell');
  const size = cell.size || CELL, span = cellSpan(cell.ci, size);
  const lo = bounds && bounds.from != null ? Math.max(span.from, bounds.from) : span.from;
  const hi = bounds && bounds.to != null ? Math.min(span.to, bounds.to) : span.to;
  const base = { ci: cell.ci, from: lo, to: hi, closed: hi === span.to };
  if (hi < lo) return { ...base, n: 0, first: null, last: null, micro: null, usd: null, weight: 0, opened: null, out: carryIn || null, thin: true, carried: false, since: null, top: null, dominant: false, drains: [], why: 'no block of this cell was read', code: 'not-read', kind: NULL_KINDS['not-read'] };
  const opened = carryIn && carryIn.micro != null ? carryIn.micro : null;
  const segs = [];                 // [micro, blocks it stood for, the block whose Sync set it]; a drained stretch weighs nothing
  const drains = [];
  let at = lo, cur = opened, setBy = carryIn && carryIn.block != null ? carryIn.block : null;
  let n = 0, first = null, last = null, lastPt = null;
  let drainFrom = carryIn && carryIn.micro == null ? lo : null;   // the cell opened drained
  for (const p of cell.pts) {
    const b = p[0];
    if (b < lo || b > hi) continue;
    if (b > at && cur != null) segs.push([cur, b - at, setBy]);
    if (p[2] == null) { if (drainFrom == null) drainFrom = b; }
    else {
      if (drainFrom != null) { if (b > drainFrom) drains.push([drainFrom, b - 1]); drainFrom = null; }
      n++; if (first == null) first = b; last = b;
    }
    cur = p[2]; at = b; setBy = b; lastPt = p;
  }
  if (cur != null) segs.push([cur, hi - at + 1, setBy]);
  if (drainFrom != null) drains.push([drainFrom, hi]);
  let weight = 0, top = null;
  for (const s of segs) { weight += s[1]; if (!top || s[1] > top.blocks) top = { block: s[2], blocks: s[1] }; }   // the earliest of equals
  const out = lastPt ? { micro: lastPt[2], block: lastPt[0] } : (carryIn || null);
  const res = { ...base, n, first, last, micro: null, usd: null, weight, opened, out, thin: n < THIN_BELOW, carried: false, since: null, top, dominant: !!top && top.blocks * 2 >= weight, drains };
  if (!weight) {
    const drained = drains.length > 0;
    res.why = drained ? DRAINED_WHY + ', and no Sync in this cell restored it' : 'no price was in force in this cell (nothing before it was read, or the pool had no Sync yet)';
    res.code = drained ? 'drained' : 'not-read'; res.kind = NULL_KINDS[res.code];
    return res;
  }
  segs.sort((a, b) => a[0] - b[0]);
  let cum = 0;
  for (const s of segs) { cum += s[1]; if (cum * 2 >= weight) { res.micro = s[0]; break; } }   // the lower weighted median
  res.usd = res.micro / MICRO;
  if (!n) { res.carried = true; res.since = carryIn ? carryIn.block : null; }
  return res;
}

/* ----- the grid: every cell's median, in chain order ----------------------------------------------------------------
   opts: { from, to, origin, size }. from / to: the blocks the folded cells cover, end to end (the walk's start and its
   cursor); a Sync outside them is ignored. origin: true when `from` is at or before the pool's first Sync (the walk
   began at the pair's creation), which is what lets a block before the first Sync read "before the pool's first Sync"
   rather than "not read". The cells are summed in order, each opened by the last price of the priced cell before it.
   Cells are keyed by their own ci (a Map keyed by anything else throws — see checkCells).
   Returns a frozen { src, pair, size, from, to, origin, firstSync, keys, sums } that ethUsdAt reads. */
function buildGrid(cells, opts) {
  if (!(cells instanceof Map)) throw new TypeError('buildGrid needs the Map foldCells filled');
  const o = opts || {}, size = o.size == null ? CELL : o.size, from = o.from, to = o.to;
  if (!Number.isSafeInteger(size) || size < 1) throw new TypeError('a cell size must be a whole number of blocks');
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(to) || to < from - 1) throw new RangeError('a grid needs the blocks it covers: whole numbers, from ≤ to + 1');
  checkCells(cells, size);
  const keys = [];
  for (const c of cells.values()) if (c.pts.some((p) => p[0] >= from && p[0] <= to)) keys.push(c.ci);
  keys.sort((a, b) => a - b);
  const sums = new Map();
  let carry = null;                // nothing before `from` is known: the first cell opens on no price
  for (const ci of keys) {
    const s = cellMedian(cells.get(ci), carry, { from, to });
    if (s.out) Object.freeze(s.out);
    if (s.top) Object.freeze(s.top);
    for (const d of s.drains) Object.freeze(d);
    Object.freeze(s.drains);
    sums.set(ci, Object.freeze(s));
    carry = s.out;
  }
  const firstSync = keys.length ? firstPointIn(cells.get(keys[0]), from, to) : null;   // the first Sync read (the pool's first, with origin)
  return Object.freeze({ src: SRC, pair: PAIR.address, size, from, to, origin: !!o.origin, firstSync, keys: Object.freeze(keys), sums });
}
function firstPointIn(cell, from, to) { for (const p of cell.pts) if (p[0] >= from && p[0] <= to) return p[0]; return null; }

/* ----- ETH/USD at a block -------------------------------------------------------------------------------------------
   → { v, src: 'rh-weth-usdg-pool', cell: { index, from, to, n, first, last, top }, carried, thin, dominant, provisional,
       since, staleBlocks }  (v in dollars per ETH; since / staleBlocks: for a carried price, the block whose Sync set it
       and how many blocks before this one; otherwise null and 0; top / dominant as cellMedian gives them — a carried
       price is one Sync's for the whole cell, so dominant)
   | { v: null, why, code, kind }  — past what was read, before it, before the pool's first Sync, or inside a drain
       (the codes and kinds: the header, NULL_KINDS). */
function ethUsdAt(grid, block) {
  if (!grid || !(grid.sums instanceof Map) || !Array.isArray(grid.keys)) throw new TypeError('ethUsdAt needs a grid from buildGrid');
  if (!Number.isSafeInteger(block) || block < 0) return none('no-block', 'no block number to price');
  if (block > grid.to) return none('not-read-yet', 'not read yet: the ETH/USD history is read up to block ' + grid.to);
  const beforeFirst = () => none('before-first-sync', grid.firstSync == null
    ? 'the WETH/USDG pool has no Sync up to block ' + grid.to
    : 'before the WETH/USDG pool’s first Sync (block ' + grid.firstSync + ')');
  if (block < grid.from) return grid.origin ? beforeFirst() : none('not-read', 'not read: the ETH/USD history starts at block ' + grid.from);
  if (grid.firstSync == null || block < grid.firstSync) {
    return grid.origin ? beforeFirst() : none('not-read', 'no Sync was read between block ' + grid.from + ' and this block, and the price before block ' + grid.from + ' was not read');
  }
  const ci = cellOf(block, grid.size), span = cellSpan(ci, grid.size);
  const provisional = span.to > grid.to;
  const own = grid.sums.get(ci);
  if (own) {
    if (own.micro == null) return none(own.code, own.why);
    // a block inside a drain has no price, whatever the rest of its cell's blocks give
    for (const d of own.drains) {
      if (block >= d[0] && block <= d[1]) return none('drained', DRAINED_WHY + ' from block ' + d[0] + (d[1] < own.to ? ' until block ' + (d[1] + 1) + ' restored it' : ', and no Sync has restored it up to block ' + d[1]));
    }
    return {
      v: own.usd, src: SRC, cell: { index: ci, from: own.from, to: own.to, n: own.n, first: own.first, last: own.last, top: own.top },
      carried: own.carried, thin: own.thin, dominant: own.dominant, provisional, since: own.carried ? own.since : null,
      staleBlocks: own.carried && own.since != null ? block - own.since : 0,
    };
  }
  // no Sync in this cell: the price in force is the last Sync of the nearest priced cell before it
  const k = lastKeyBelow(grid.keys, ci);
  const prev = k == null ? null : grid.sums.get(k);
  if (!prev || !prev.out) return grid.origin ? beforeFirst() : none('not-read', 'no Sync was read before this block');
  if (prev.out.micro == null) return none('drained', DRAINED_WHY + ' at block ' + prev.out.block + ', and no Sync has restored it');
  const from = Math.max(span.from, grid.from), to = Math.min(span.to, grid.to);
  return {
    v: prev.out.micro / MICRO, src: SRC, cell: { index: ci, from, to, n: 0, first: null, last: null, top: { block: prev.out.block, blocks: to - from + 1 } },
    carried: true, thin: true, dominant: true, provisional, since: prev.out.block, staleBlocks: block - prev.out.block,
  };
}
function lastKeyBelow(keys, ci) {
  let lo = 0, hi = keys.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < ci) lo = m + 1; else hi = m; }
  return lo ? keys[lo - 1] : null;
}

/* ----- one walk window, its end on a cell's last block ----------------------------------------------------------------
   [from … to] → { from, to, open, cells }: `to` pulled back to the last block of the last cell that ends inside the
   range, so every cell the window touches is read to its end and closes (open: false). Only when the whole range sits
   inside one cell — the tail, the cell the head is in — does the window keep its own end (open: true): that cell stays
   provisional until a later window reaches its last block. `from` is kept as given: the walk's start (the pair's first
   Sync) or the block after the previous window. null for an empty or malformed range. */
function alignWindow(from, to, cellSize = CELL) {
  if (!Number.isSafeInteger(cellSize) || cellSize < 1) throw new TypeError('a cell size must be a whole number of blocks');
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) return null;
  const lastEnd = Math.floor((to + 1) / cellSize) * cellSize - 1;   // the last block of the last cell ending at or before `to`
  const end = lastEnd >= from ? lastEnd : to;
  return { from, to: end, open: end !== lastEnd, cells: cellOf(end, cellSize) - cellOf(from, cellSize) + 1 };
}

module.exports = {
  CELL, THIN_BELOW, SRC, SYNC_TOPIC, PAIR, DRAIN_WETH_WEI, DRAIN_USDG_UNITS, NULL_KINDS,
  decodeSync, foldCells, cellMedian, buildGrid, ethUsdAt, alignWindow, cellOf, cellSpan,
};
