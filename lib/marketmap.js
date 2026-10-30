'use strict';
/* ===== The whole crypto market, last 24 h: Market Data's bubble map (owner, 2026-10-30) ===============================
   Owner's request, with a picture of a "market heatmap" (one big circle packed with a bubble per coin, its area the coin's
   market cap, its colour the coin's 24 h change in nine steps, BTC, ETH and USDT the largest with "Dominance: 59.9%"): "Add in
   a view like this that shows a 24 quick visual on the top tokens across the whole market on the Market Data page."

   This module is the pure half: no request, no database, no clock of its own. lib/marketdata.js's 'heatmap' job reads the
   sources and keeps what they answered in mkt_state 'heatmap'; everything here turns those answers into the rows that
   /api/market/heatmap and the Send API's heatmap resource serve. public/market.js packs and draws the bubbles itself.

   What is read (measured 2026-10-30 ~00:30 UTC with this site's honest User-Agent; tests/fixtures/marketdata/heatmap-*.json):
     · CoinGecko /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h — the 100
       largest coins by market cap, every chain's: price, market cap, 24 h change, 24 h volume (one read every 10 minutes);
     · CoinGecko /global — its total market cap of every coin it lists, what a coin's dominance is a share of (every 30 minutes);
     · CoinGecko /coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=250 — the coins it files as
       stablecoins (every 6 hours). A coin is a stablecoin here when CoinGecko files it there, nothing else; the 250 largest are
       every stablecoin that could be among the top 100 (17 were on 2026-10-30);
     · CoinLore /tickers/?start=0&limit=100 — its 100 largest coins (every run): the independent check of each market cap,
       matched and compared by lib/chainmcap.js's own rules (matchCoin: the same symbol, the same name and a price within 10%
       on the same read; crossCheck: agreed within 10%, differs, one source) — reused here, never forked.

   The rules (every figure { v, src, at, why?, label? }; unknown is null with a reason in words, never 0):
     · the market cap is crossCheck's: CoinGecko's own figure; a 0 is "no market cap" (CoinGecko's 0 for a coin without a
       circulating supply), never $0; CoinLore's only when CoinGecko has none, and said so. A coin with no market cap is listed,
       never drawn (a bubble's area IS its market cap);
     · dominance is the coin's market cap ÷ CoinGecko's total market cap, both CoinGecko's, in percent (59.6 = 59.6%): the
       figure's `at` is the older of the two figures' times and its label names the total. None when the market cap is not
       CoinGecko's own, or when the total and the coins were read more than 2 hours apart — either way round: the coins are kept
       last-good while /global may go on answering, and a share of an old market cap in a new total is no share at all;
     · the 24 h change is CoinGecko's price_change_percentage_24h, in percent (−5.27 = down 5.27%); a coin with none is "no change
       given" — never 0%. A 0 is CoinGecko's own 0 (a fund token held at $1.00) and is the legend's "0%";
     · CoinLore's coins count for the check only when they were read within 15 minutes of CoinGecko's (a price check across
       a longer gap would compare two different moments). ================================================================ */

const CM = require('./chainmcap.js');
const MIN = 60 * 1000, HOUR = 60 * MIN;
const TOP = 100;                     // CoinGecko's 100 largest coins: one page, one read
const LORE_FRESH = 15 * MIN;         // CoinLore's read counts for the check only this close to CoinGecko's
const TOTAL_FRESH = 2 * HOUR;        // a dominance is worked out only from a total read at most this long from the coins (before or after)
const STABLES_PER_CALL = 250;        // CoinGecko's stablecoins category, largest first: every one that could be in the top 100

const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
const pos = (x) => { const v = num(x); return v != null && v > 0 ? v : null; };
const okId = (x) => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x);
const utcMin = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'an unknown time');

/* ----- the legend: the reference's nine steps, and one for a coin with no change given ----- */
const BUCKETS = Object.freeze([
  { key: 'up10', label: '>10%', words: 'up more than 10%' },
  { key: 'up5', label: '>5%', words: 'up more than 5%, at most 10%' },
  { key: 'up2', label: '>2%', words: 'up more than 2%, at most 5%' },
  { key: 'up0', label: '>0%', words: 'up, at most 2%' },
  { key: 'flat', label: '0%', words: 'unchanged: CoinGecko gives exactly 0%' },
  { key: 'dn0', label: '<0%', words: 'down, at most 2%' },
  { key: 'dn2', label: '<−2%', words: 'down more than 2%, at most 5%' },
  { key: 'dn5', label: '<−5%', words: 'down more than 5%, at most 10%' },
  { key: 'dn10', label: '<−10%', words: 'down more than 10%' },
  { key: 'none', label: 'no 24 h change given', words: 'CoinGecko gives no 24 h change for the coin — never drawn as 0%' },
].map(Object.freeze));
function bucketOf(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'none';
  if (v > 10) return 'up10';
  if (v > 5) return 'up5';
  if (v > 2) return 'up2';
  if (v > 0) return 'up0';
  if (v === 0) return 'flat';
  if (v < -10) return 'dn10';
  if (v < -5) return 'dn5';
  if (v < -2) return 'dn2';
  return 'dn0';
}

/* ----- the sources' answers, parsed (each { ok, …, why? }: a read that did not parse keeps the last good one) ----- */
// CoinGecko /coins/markets → the coins, in CoinGecko's own order (largest market cap first), at most TOP
function parseMarkets(list, readAt) {
  if (!Array.isArray(list)) return { ok: false, why: 'not a list' };
  const out = [], seen = new Set();
  for (const x of list) {
    const c = CM.cgCoin(x, readAt);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, symbol: c.symbol, name: c.name, rank: Number.isSafeInteger(x.market_cap_rank) && x.market_cap_rank > 0 ? x.market_cap_rank : null,
      price: c.price, mcap: c.mcap, supply: c.supply, fdv: c.fdv, updatedAt: c.updatedAt, change24h: num(x.price_change_percentage_24h), volume24h: pos(x.total_volume) });
    if (out.length >= TOP) break;
  }
  return out.length ? { ok: true, list: out } : { ok: false, why: 'an empty list' };
}
// CoinGecko /global → its total market cap (USD), its own dominance figures, when it updated them
function parseGlobal(j) {
  const d = j && typeof j === 'object' ? j.data : null;
  const total = d && d.total_market_cap && typeof d.total_market_cap === 'object' ? pos(d.total_market_cap.usd) : null;
  if (total == null) return { ok: false, why: 'no total market cap in USD' };
  const pct = {};
  if (d.market_cap_percentage && typeof d.market_cap_percentage === 'object') for (const [k, v] of Object.entries(d.market_cap_percentage)) { const n = num(v); if (n != null && /^[a-z0-9_-]{1,24}$/i.test(k)) pct[k.toLowerCase()] = n; }
  const up = num(d.updated_at);
  return { ok: true, total, pct, updatedAt: up != null && up > 1.6e9 && up < 1e11 ? up * 1000 : null, change24h: num(d.market_cap_change_percentage_24h_usd) };
}
// CoinGecko's stablecoins category → its coin ids
function parseStables(list) {
  if (!Array.isArray(list)) return { ok: false, why: 'not a list' };
  const ids = [...new Set(list.map((x) => x && x.id).filter(okId))].slice(0, STABLES_PER_CALL);
  return ids.length ? { ok: true, ids } : { ok: false, why: 'an empty list' };
}
// CoinLore /tickers/ → its coins, in lib/chainmcap.js's shape, and how many it lists
function parseLore(j, readAt) {
  const list = j && Array.isArray(j.data) ? j.data : null;
  if (!list) return { ok: false, why: 'not a list' };
  const out = [];
  // priceFull: CoinLore's own market cap ÷ supply where its 6-decimal price lost its digits (SHIB, PEPE) — lib/chainmcap.js compares at it
  for (const x of list) { const c = CM.loreCoin(x, readAt); if (c) out.push(Object.assign({ id: c.id, symbol: c.symbol, name: c.name, price: c.price, mcap: c.mcap, supply: c.supply }, c.priceFull != null ? { priceFull: c.priceFull } : {})); }
  const listed = j.info ? num(j.info.coins_num) : null;
  return out.length ? { ok: true, list: out, listed } : { ok: false, why: 'an empty list' };
}

/* ----- one part's read, as the answer reports it: { at (the data's time), ok (the last attempt worked), why? } ----- */
function readOf(rec, what) {
  if (!rec || (!rec.readAt && !rec.failAt)) return { at: null, ok: false, why: what + ' has not been read yet' };
  if (rec.failAt && (!rec.readAt || rec.failAt >= rec.readAt)) return { at: rec.readAt || null, ok: false, why: what + ' could not be read at ' + utcMin(rec.failAt) + ' (' + (rec.failWhy || 'no answer') + ')' + (rec.readAt ? ' — the last good read, from ' + utcMin(rec.readAt) + ', is used' : '') };
  return { at: rec.readAt, ok: true };
}

const DEFINITIONS = Object.freeze({
  coins: 'The 100 largest coins by market cap on CoinGecko, on every chain, in CoinGecko\'s order; rank is CoinGecko\'s market-cap rank.',
  bubble: 'Bubble size: market cap — each bubble\'s area is the coin\'s market cap, so a coin twice the size has twice the area. A coin with no market cap is listed and not drawn.',
  colour: 'Colour: the 24 h price change, in the legend\'s nine steps; a coin CoinGecko gives no change for is outlined and hatched ("no 24 h change given"), never drawn as 0%.',
  change24h: 'CoinGecko\'s change in the coin\'s US-dollar price over the last 24 hours, in percent (−5.27 means down 5.27%); null with why when CoinGecko gives none, never 0.',
  dominance: 'The coin\'s market cap as a share of CoinGecko\'s total market cap of every coin it lists, in percent (59.6 means 59.6%; its /global read, every 30 minutes, which the label names). Worked out by this site from CoinGecko\'s two figures, and as old as the older of them (its at); none when the market cap is not CoinGecko\'s own, or the total and the coins were read more than 2 hours apart.',
  volume24h: 'CoinGecko\'s trading volume over the last 24 hours, every market it tracks.',
  stable: 'true when CoinGecko files the coin in its stablecoins category (read every 6 hours); null until that list has been read.',
  check: 'The market cap checked against CoinLore\'s 100 largest coins, by the chain market caps\' rules (lib/chainmcap.js): its coin counts when its symbol, name and price (within 10%) are CoinGecko\'s on the same read — for a coin under $0.0001, whose price CoinLore rounds to 6 decimal places, CoinLore\'s own market cap ÷ circulating supply is the price compared; "agreed" within 10%, "differs" (the notes say why from the numbers), "single" (one source; the notes say why).',
  total: 'CoinGecko\'s total market cap of every coin it lists — not only the 100 drawn.',
});
const SOURCES = Object.freeze([
  Object.freeze({ id: 'coingecko', name: 'CoinGecko (the 100 largest coins, its total market cap, its stablecoins category)', href: 'https://www.coingecko.com' }),
  Object.freeze({ id: 'coinlore', name: 'CoinLore (its 100 largest coins, to check each market cap)', href: 'https://www.coinlore.com' }),
]);

/* ===== the map's rows from the stored reads =========================================================================
   st: mkt_state 'heatmap' — { coins: { readAt, list, failAt?, failWhy? }, global: { readAt, total, pct, updatedAt, … },
   stables: { readAt, ids, … }, lore: { readAt, list, listed, … } }. F: lib/marketdata.js's fig() and none() (the figure
   contract has one home). Out: { at, total, rows, reads, counts, why? } — rows in CoinGecko's order, every one of the top 100. */
function buildMap(st, F) {
  const s = st && typeof st === 'object' ? st : {};
  const coins = s.coins || null, glob = s.global || null, stables = s.stables || null, lore = s.lore || null;
  const reads = { coins: readOf(coins, 'CoinGecko\'s top 100 coins'), global: readOf(glob, 'CoinGecko\'s total market cap'), stables: readOf(stables, 'CoinGecko\'s stablecoins category'), coinlore: readOf(lore, 'CoinLore\'s 100 largest coins') };
  const list = coins && Array.isArray(coins.list) ? coins.list : [];
  const at = list.length ? coins.readAt || null : null;
  const total = glob && pos(glob.total) != null
    ? F.fig(glob.total, 'coingecko', glob.readAt, { label: 'total market cap of every coin CoinGecko lists' + (glob.updatedAt ? ' (CoinGecko updated it at ' + utcMin(glob.updatedAt) + ')' : '') })
    : F.none(reads.global.why || 'CoinGecko\'s total market cap has not been read yet', 'coingecko', null);
  if (!list.length) return { at: null, total, rows: [], reads, counts: { up: 0, down: 0, flat: 0, none: 0, drawn: 0 }, lore: { compared: false, why: 'there are no coins to compare' }, why: reads.coins.why || 'CoinGecko\'s top 100 coins have not been read yet' };
  // a total read too long before the coins is not divided into them — nor are coins kept last-good for hours divided into a total read since
  const totalV = glob && pos(glob.total) != null && at && glob.readAt && Math.abs(at - glob.readAt) <= TOTAL_FRESH ? glob.total : null;
  const totalWhy = !glob || pos(glob.total) == null ? (reads.global.why || 'CoinGecko\'s total market cap has not been read yet') + ', so no share of it is worked out'
    : !glob.readAt || glob.readAt < at ? 'CoinGecko\'s total market cap was last read at ' + utcMin(glob.readAt) + ', more than 2 hours before these coins — no share is worked out from it'
    : 'these coins were last read at ' + utcMin(at) + ', more than 2 hours before CoinGecko\'s total market cap (read at ' + utcMin(glob.readAt) + ') — no share of a newer total is worked out from older market caps';
  // CoinLore: its coins, read close enough to CoinGecko's to compare prices on "the same read"
  let loreIdx = null, loreWhy = null;
  if (!lore || !Array.isArray(lore.list) || !lore.list.length) loreWhy = reads.coinlore.why || 'CoinLore was not read';
  else if (!lore.readAt || Math.abs(at - lore.readAt) > LORE_FRESH) loreWhy = 'CoinLore\'s last good read (' + utcMin(lore.readAt) + ') is more than 15 minutes from CoinGecko\'s, so its prices are not compared with these';
  else loreIdx = CM.bySymbol(lore.list.map((c) => Object.assign({}, c, { readAt: lore.readAt })));
  const stableSet = stables && Array.isArray(stables.ids) && stables.ids.length ? new Set(stables.ids) : null;
  const counts = { up: 0, down: 0, flat: 0, none: 0, drawn: 0 };
  const rows = list.map((c) => {
    const cAt = c.updatedAt || at;
    const cg = { id: c.id, symbol: c.symbol, name: c.name, price: c.price, mcap: c.mcap, supply: c.supply, fdv: c.fdv, updatedAt: c.updatedAt, readAt: at };
    let m = null;
    // (matchCoin says itself why a coin without a symbol or a name cannot be matched; `absent` is for one with both)
    if (loreIdx) m = CM.matchCoin(cg, loreIdx, { absent: 'CoinLore’s 100 largest coins include none with the symbol $' + c.symbol + ' — the part of its list this map reads' });
    const x = CM.crossCheck({ sym: c.symbol, cg, lore: m && m.coin ? m.coin : null, loreWhy: m ? m.why : loreWhy, loreAlso: m && m.coin && m.rejected.length ? m.rejected : null, now: at });
    const mcap = x.v != null ? F.fig(x.v, x.src, x.at || at, x.via === 'coinlore' ? { label: 'CoinLore\'s market cap — CoinGecko gives none for this coin' } : { label: 'market cap (CoinGecko)' })
      : F.none(x.why || 'no source gave a market cap', 'coingecko', at);
    const dominance = mcap.v == null ? F.none('no market cap, so no share of the total', 'coingecko', at)
      : x.src !== 'coingecko' ? F.none('its market cap is not CoinGecko\'s own, so it is not divided into CoinGecko\'s total', 'coingecko', at)
      : totalV == null ? F.none(totalWhy, 'coingecko', glob && glob.readAt ? glob.readAt : at)
      : F.fig((mcap.v / totalV) * 100, 'coingecko', Math.min(mcap.at || at, glob.readAt), { label: 'share of CoinGecko\'s total, ' + CM.money(totalV) + ', in percent' });
    const change24h = c.change24h != null ? F.fig(c.change24h, 'coingecko', cAt, { label: '24 h price change, in percent (CoinGecko)' }) : F.none('no change given — CoinGecko gives no 24 h change for this coin', 'coingecko', cAt);
    const b = bucketOf(change24h.v);
    if (mcap.v != null) { counts.drawn++; if (b === 'none') counts.none++; else if (b === 'flat') counts.flat++; else if (b.startsWith('up')) counts.up++; else counts.down++; }
    return {
      id: c.id, symbol: c.symbol, name: c.name, rank: c.rank,
      price: c.price != null ? F.fig(c.price, 'coingecko', cAt, { label: 'price (CoinGecko)' }) : F.none('CoinGecko gives no price for this coin', 'coingecko', cAt),
      mcap, dominance, change24h,
      volume24h: c.volume24h != null ? F.fig(c.volume24h, 'coingecko', cAt, { label: '24 h volume (CoinGecko)' }) : F.none('CoinGecko gives no 24 h volume for this coin', 'coingecko', cAt),
      stable: stableSet ? stableSet.has(c.id) : null,
      check: { status: x.check.status, sources: x.check.sources, notes: x.check.notes },
    };
  });
  return { at, total, rows, reads, counts, lore: loreIdx ? { compared: true } : { compared: false, why: loreWhy } };
}
// counts of the rows shown (after a limit or the stablecoins left out): the drawn ones only, by direction
function countRows(rows) {
  const c = { up: 0, down: 0, flat: 0, none: 0, drawn: 0 };
  for (const r of rows) {
    if (!r.mcap || r.mcap.v == null) continue;
    c.drawn++;
    const b = bucketOf(r.change24h ? r.change24h.v : null);
    if (b === 'none') c.none++; else if (b === 'flat') c.flat++; else if (b.startsWith('up')) c.up++; else c.down++;
  }
  return c;
}

/* the answer's note on the CoinLore check, from the rows served: how many were found in CoinLore's 100 largest and compared, never
   "every market cap is checked" when some (or all) have one source. lore: buildMap's { compared, why? } */
function checkNote(rows, lore) {
  if (!lore || !lore.compared) return 'No market cap here is checked against CoinLore just now: ' + ((lore && lore.why) || 'CoinLore was not read') + '.';
  const n = { agreed: 0, differs: 0 };
  for (const r of rows) if (r.check && n[r.check.status] != null) n[r.check.status]++;
  const both = n.agreed + n.differs, one = rows.length - both;
  return 'Each market cap is looked up in CoinLore\'s 100 largest coins: ' + both + ' of these ' + rows.length + ' were found there and compared (' + n.agreed + ' agree, ' + n.differs + ' differ by more than 10%)'
    + (one ? '; ' + one + (one === 1 ? ' has' : ' have') + ' one source' : '') + ' — the chip on each coin says which.';
}

module.exports = { TOP, LORE_FRESH, TOTAL_FRESH, STABLES_PER_CALL, BUCKETS, bucketOf, parseMarkets, parseGlobal, parseStables, parseLore, readOf, buildMap, countRows, checkNote, DEFINITIONS, SOURCES };
