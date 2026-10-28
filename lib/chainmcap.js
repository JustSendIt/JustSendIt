'use strict';
/* ===== Chain market caps, cross-checked (owner, 2026-10-28) =======================================================
   Owner's ask: "make sure you are showing the right market caps for all of the chains pulled from multiple sources and
   cross verified". This module is the rule book for the market cap of a chain's own token (Market Data's chains list, a
   chain's detail, the Send API's chains resources): which coin a chain's token is in each source, which figure is shown,
   and what the check says about it. It is pure — no I/O, no clock of its own (the caller passes `now`) — so every rule is
   tested on the sources' own answers (tests/fixtures/marketdata/, measured 2026-10-28).

   What the sources are (measured 2026-10-28):
     · CoinGecko (keyless /coins/markets, one read of up to 250 coins per chains run): the reference — the figure shown,
       the one the rest of the site uses. Its own price, circulating supply, FDV and update time are checked against its
       figure ("CoinGecko internal checks" below).
     · CoinLore (keyless; its API page says it is free and open "for developers, traders, researchers, and businesses
       building crypto apps, dashboards, screeners"): the INDEPENDENT second source. Its coin ids are learned once a day by
       a walk of its list, and each chains run reads those coins again; a CoinLore coin counts only when it is the same
       coin as CoinGecko's (matchCoin) on that very read.
     · DefiLlama's coins.llama.fi/mcaps relays CoinGecko's figure. It is not a second source and is never counted as one:
       it stands in when CoinGecko itself cannot be read (said so on the figure), and when both are read a relay that
       differs from CoinGecko's own figure by more than 2% is noted (one of them is older).
     · NOT used: CoinPaprika. Its free plan is for personal use only, and showing its data needs its Enterprise licence.
     · CoinGecko's /asset_platforms (daily): which coin CoinGecko names as a chain's native coin, to check DefiLlama's
       chain → token mapping (mappingCheck).

   The rules (every figure in a note is the source's own; nothing is averaged, blended or estimated):
     · CoinGecko's figure g is its market_cap when above 0. A 0 is not a market cap of $0: CoinGecko gives 0 when it has no
       circulating supply for the coin (Fantom, Mixin, PulseChain, Krown Network on 2026-10-28) — that is null with why.
     · CoinLore's figure l is its market_cap_usd when above 0 and its coin passed the match on this read.
     · status: 'agreed' (both, within 10% of g), 'differs' (both, further apart — the note says why from the numbers),
       'single' (one), 'none' (neither). The figure shown is g when there is one, else l (labelled as the only source).
     · A 'differs' note: prices within 2% → the same price, a different circulating supply counted (each source's own);
       else how far apart their prices are.
   ================================================================================================================== */

const HOUR = 60 * 60 * 1000;
const TOL = Object.freeze({
  price: 0.10,       // a CoinLore coin is CoinGecko's only if its price is within 10% of CoinGecko's on the same read
  agree: 0.10,       // the two market caps agree when within 10% of CoinGecko's
  samePrice: 0.02,   // a 'differs' note says "the same price" when the prices are within 2%
  self: 0.02,        // CoinGecko's figure should equal its own price × circulating supply to within 2%
  fdv: 0.01,         // …and be no larger than its own FDV (1% slack for rounding)
  relay: 0.02,       // DefiLlama's relay more than 2% from CoinGecko's own figure is noted
  staleMs: 6 * HOUR, // a CoinGecko figure last updated more than 6 hours before the read is noted as stale
});

/* ----- words: names and symbols as the sources write them ----- */
// zero-width and other invisible characters: CoinGecko writes stable-2's name "​​Stable" (measured 2026-10-28)
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
function cleanText(s, n = 80) {
  if (s == null) return null;
  const t = String(s).replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  return t || null;
}
// a name for comparing: lower case, invisible characters and punctuation gone, a parenthesised part dropped
// ("Gram (prev. Toncoin)" → "gram", "Sonic (prev. FTM)" → "sonic")
function normName(s) {
  const t = cleanText(s, 200);
  if (!t) return '';
  return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');
}
// the same name: equal once normalised, or one starts with the other and both have at least 3 characters
function sameName(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));
}
const symOf = (s) => { const t = cleanText(s, 24); return t ? t.toUpperCase() : null; };
const dollarSym = (sym) => (sym ? '$' + sym : 'this token');

/* ----- numbers ----- */
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
const pos = (x) => { const v = num(x); return v != null && v > 0 ? v : null; };
const trim0 = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
function scaled(v) {   // 1.15B, 904M, 32.4k, 12.34, 0.0033
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  const sig3 = (x) => trim0(x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2));
  if (a >= 1e12) return s + sig3(a / 1e12) + 'T';
  if (a >= 1e9) return s + sig3(a / 1e9) + 'B';
  if (a >= 1e6) return s + sig3(a / 1e6) + 'M';
  if (a >= 1e4) return s + sig3(a / 1e3) + 'k';
  if (a >= 1) return s + trim0(a.toFixed(2));
  if (a === 0) return '0';
  return s + trim0(a.toFixed(Math.min(20, 1 - Math.floor(Math.log10(a)))));   // two significant digits, never an exponent
}
const money = (v) => (v == null || !Number.isFinite(v) ? 'no figure' : (v < 0 ? '−$' + scaled(-v) : '$' + scaled(v)));
const qty = (v) => (v == null || !Number.isFinite(v) ? 'no figure' : scaled(v));
const apart = (a, b) => Math.abs(a - b) / Math.abs(a);   // as a share of the first (the reference)
const pctText = (x) => { const p = x * 100; return (p >= 10 ? Math.round(p) : trim0(p.toFixed(1))) + '%'; };
function agoWords(ms) {
  const h = ms / HOUR;
  if (h < 48) return Math.round(h) + ' h';
  return Math.round(h / 24) + ' days';
}

/* ----- the sources' rows, in one shape ----- */
// CoinGecko /coins/markets → { id, symbol, name, price, mcap, supply, total, fdv, updatedAt, readAt }
function cgCoin(x, readAt) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(x.id)) return null;
  const up = typeof x.last_updated === 'string' ? Date.parse(x.last_updated) : NaN;
  return { id: x.id, symbol: symOf(x.symbol), name: cleanText(x.name), price: pos(x.current_price), mcap: num(x.market_cap), supply: num(x.circulating_supply),
    total: num(x.total_supply), fdv: num(x.fully_diluted_valuation), updatedAt: Number.isFinite(up) ? up : null, readAt: readAt || null };
}
// CoinLore /tickers/ (data[]) and /ticker/?id= (an array) → { id, symbol, name, price, mcap, supply, readAt }
function loreCoin(x, readAt) {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id == null ? '' : x.id);
  if (!/^\d{1,12}$/.test(id)) return null;
  return { id, symbol: symOf(x.symbol), name: cleanText(x.name), price: pos(x.price_usd), mcap: num(x.market_cap_usd), supply: num(x.csupply), readAt: readAt || null };
}
// CoinGecko /asset_platforms → [{ id, chainId, name, native }]
function platformsOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(p.id)) continue;
    out.push({ id: p.id, chainId: Number.isSafeInteger(p.chain_identifier) ? p.chain_identifier : null, name: cleanText(p.name),
      native: typeof p.native_coin_id === 'string' && /^[a-z0-9-]{1,80}$/.test(p.native_coin_id) ? p.native_coin_id : null });
  }
  return out;
}

/* ===== Matching a chain's token on CoinLore =====================================================================
   The token is DefiLlama's gecko_id, which is CoinGecko's own id. A CoinLore coin is that coin when its symbol is
   CoinGecko's (any case), its name is CoinGecko's (sameName), AND its price is within 10% of CoinGecko's on the same
   read. A coin of the same name at another price is a different coin (CoinLore lists two "Beam"s on 2026-10-28: onbeam
   at $0.003362, which is CoinGecko's beam-2 at $0.0033395, and the older BEAM at $0.006579) — it is left out, and said.
   Two coins that both pass: neither is taken. The same CoinLore id seen twice (its list shifts while it is walked:
   Bubblemaps was on two pages of the 2026-10-28 walk) is one coin. ================================================= */
function bySymbol(cands) {
  const m = new Map(), seen = new Set();
  for (const c of cands || []) {
    if (!c || !c.id || !c.symbol || seen.has(c.id)) continue;
    seen.add(c.id);
    if (!m.has(c.symbol)) m.set(c.symbol, []);
    m.get(c.symbol).push(c);
  }
  return m;
}
function matchCoin(cg, cands, opts = {}) {
  const tol = opts.priceTol != null ? opts.priceTol : TOL.price;
  const out = { coin: null, why: null, rejected: [] };
  if (!cg || !cg.symbol || !cg.name) { out.why = 'CoinGecko\'s own symbol and name for this token were not read, so no CoinLore coin can be matched to it'; return out; }
  const S = dollarSym(cg.symbol), idx = cands instanceof Map ? cands : bySymbol(cands);
  const bySym = idx.get(cg.symbol) || [];
  const named = bySym.filter((c) => sameName(c.name, cg.name));
  if (!named.length) {
    out.why = bySym.length
      ? 'CoinLore lists ' + S + ' only under another name (“' + bySym.slice(0, 2).map((c) => c.name).join('”, “') + '”, not CoinGecko’s “' + cg.name + '”), so it is not taken as the same coin'
      : 'CoinLore does not list ' + S;
    return out;
  }
  if (cg.price == null) { out.why = 'CoinGecko gave no price for ' + S + ', so CoinLore’s coin cannot be confirmed as the same one'; return out; }
  const pass = [];
  for (const c of named) {
    if (c.price != null && apart(cg.price, c.price) <= tol) pass.push(c);
    else out.rejected.push({ id: c.id, name: c.name, price: c.price });
  }
  if (pass.length === 1) out.coin = pass[0];
  else if (pass.length > 1) out.why = 'CoinLore lists two coins that could be it (“' + pass.slice(0, 2).map((c) => c.name + '” at ' + money(c.price)).join(', “') + ') — neither is used';
  else {
    const r = out.rejected[0];
    out.why = 'CoinLore’s “' + r.name + '” is ' + (r.price == null ? 'given no price' : 'priced ' + money(r.price) + ' against CoinGecko’s ' + money(cg.price) + ' for ' + S) + ' — a different coin, not used';
  }
  return out;
}
/* the daily walk's result: for every chain token CoinGecko read, the CoinLore id that matched (with the same-name coins it
   left out), or why none did */
function learnLore(cgCoins, walk, opts) {
  const idx = bySymbol(walk), ids = {}, misses = {};
  for (const cg of cgCoins instanceof Map ? cgCoins.values() : cgCoins || []) {
    if (!cg || !cg.id) continue;
    const m = matchCoin(cg, idx, opts);
    if (m.coin) ids[cg.id] = Object.assign({ lore: m.coin.id }, m.rejected.length ? { rejected: m.rejected.slice(0, 3) } : {});
    else misses[cg.id] = m.why;
  }
  return { ids, misses };
}
const allMatched = (cgCoins, walk) => { const idx = bySymbol(walk); for (const cg of cgCoins.values()) if (!matchCoin(cg, idx).coin) return false; return true; };

/* ===== CoinGecko's own figure, checked against itself (the arithmetic is any source's; `who` names it in the note) ===== */
function selfChecks(cg, now, who = 'CoinGecko') {
  const notes = [], mc = pos(cg && cg.mcap);
  if (mc == null) return notes;
  const p = pos(cg.price), s = pos(cg.supply), f = pos(cg.fdv);
  if (p != null && s != null && apart(mc, p * s) > TOL.self) notes.push(who + '’s figure does not equal its own price × circulating supply (' + money(p) + ' × ' + qty(s) + ' = ' + money(p * s) + ', against ' + money(mc) + ')');
  if (f != null && mc > f * (1 + TOL.fdv)) notes.push(who + '’s market cap (' + money(mc) + ') is larger than its own fully diluted value (' + money(f) + ')');
  if (cg.updatedAt != null && now != null && now - cg.updatedAt > TOL.staleMs) notes.push('stale: ' + who + ' last updated this figure ' + agoWords(now - cg.updatedAt) + ' before it was read (' + new Date(cg.updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC)');
  return notes;
}

/* ===== the cross-check, one token =================================================================================
   in: { sym, cg (CoinGecko's coin, or null when CoinGecko's answer did not have it), cgWhy (why not), relay ({ v, at } from
   DefiLlama, or null), relayWhy, lore (CoinLore's coin that matched on this read, or null), loreWhy, loreAlso (same-name
   coins left out), now }. out: { v, src, at, why?, via ('relay' | 'coinlore' | null), check: { status, sources, notes } } */
function crossCheck(o) {
  const S = dollarSym(o.sym), now = o.now, notes = [], sources = [];
  const cg = o.cg || null, relay = o.relay && pos(o.relay.v) != null ? o.relay : null;
  let g = null, gWhy = null;
  if (cg) {
    const mc = pos(cg.mcap);
    if (mc != null) {
      g = { src: 'coingecko', v: mc, price: cg.price, supply: pos(cg.supply), at: cg.updatedAt || cg.readAt };
      notes.push(...selfChecks(cg, now));
      if (relay && apart(mc, relay.v) > TOL.relay) notes.push('DefiLlama’s relay differs from CoinGecko’s own figure (DefiLlama ' + money(relay.v) + ', CoinGecko ' + money(mc) + ' — one of them is older)');
    } else gWhy = 'CoinGecko gives no market cap for ' + S + (pos(cg.supply) == null ? ' — it lists no circulating supply' : '');
  } else if (relay) {
    g = { src: 'defillama', v: relay.v, price: null, supply: null, at: relay.at || null, relay: true };
    notes.push('CoinGecko’s figure, relayed by DefiLlama: ' + (o.cgWhy || 'CoinGecko itself was not read') + ' — DefiLlama relays CoinGecko, so this is still one source');
  } else gWhy = (o.cgWhy || 'CoinGecko was not read') + (o.relayWhy ? '; ' + o.relayWhy : '');
  let l = null, lWhy = null;
  if (o.lore) {
    const mc = pos(o.lore.mcap);
    if (mc != null) l = { src: 'coinlore', v: mc, price: o.lore.price, supply: pos(o.lore.supply), at: o.lore.readAt || null };
    else lWhy = 'CoinLore gives no market cap for ' + S;
  } else lWhy = o.loreWhy || 'CoinLore was not read';
  if (g) sources.push(g);
  if (l) sources.push(l);
  const status = g && l ? (apart(g.v, l.v) <= TOL.agree ? 'agreed' : 'differs') : g || l ? 'single' : 'none';
  if (status === 'differs') notes.unshift(differsNote(g, l, S));
  if (!g && l) notes.unshift((gWhy ? gWhy + '; ' : '') + 'the figure shown is CoinLore’s, the only source with one');
  if (g && lWhy) notes.push(lWhy);
  for (const r of o.loreAlso || []) notes.push('CoinLore also lists a “' + r.name + '”' + (r.price != null ? ' priced ' + money(r.price) : '') + ' — another coin, not counted');
  const shown = g || l;
  const res = { v: shown ? shown.v : null, src: shown ? shown.src : cg ? 'coingecko' : 'site', at: shown ? shown.at : (cg && cg.readAt) || null,
    via: g && g.relay ? 'relay' : !g && l ? 'coinlore' : null, check: { status, sources, notes } };
  if (!shown) res.why = [gWhy || 'no source gave a market cap', lWhy].filter(Boolean).join('; ');
  return res;
}
function differsNote(g, l, S) {
  const head = (g.relay ? 'CoinGecko (relayed by DefiLlama) ' : 'CoinGecko ') + money(g.v) + ', CoinLore ' + money(l.v) + ' (' + pctText(apart(g.v, l.v)) + ' apart): ';
  if (g.price != null && l.price != null) {
    if (apart(g.price, l.price) <= TOL.samePrice) {
      return head + 'both price ' + S + ' the same (about ' + money(g.price) + '); they count a different circulating supply (CoinGecko ' + qty(g.supply) + ', CoinLore ' + qty(l.supply) + ')';
    }
    return head + 'their prices for ' + S + ' differ by ' + pctText(apart(g.price, l.price)) + ' (CoinGecko ' + money(g.price) + ', CoinLore ' + money(l.price) + ')';
  }
  return head + 'DefiLlama relays CoinGecko’s figure without its price or supply, so the gap cannot be explained from this read';
}

/* ===== DefiLlama's chain → token mapping, checked against CoinGecko's asset platforms ==============================
   The platform for the chain: by its EVM chain id, else by its exact normalised name (a name or an id CoinGecko gives two
   platforms is not used). Its native coin equal to DefiLlama's own token or its gas token: 'confirmed' (a chain with two
   tokens — NEO and GAS, VET and VTHO, THETA and TFUEL — is confirmed by either). Another coin: 'differs', said with both
   ids; DefiLlama's mapping is kept (it is what the row has always used). No platform: 'unchecked'. ================== */
function platformIndex(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const byId = new Map(), byName = new Map();
  for (const p of list) {
    if (!p || !p.id) continue;
    if (p.chainId != null) byId.set(p.chainId, byId.has(p.chainId) ? null : p);
    const n = normName(p.name);
    if (n) byName.set(n, byName.has(n) ? null : p);
  }
  return { byId, byName, n: list.length };
}
function mappingCheck(ch, idx, coinOf) {
  if (!ch || !ch.gecko) return { status: 'unchecked', note: 'no token of its own to check' };
  if (!idx) return { status: 'unchecked', note: 'CoinGecko’s asset platforms have not been read yet' };
  let p = Number.isSafeInteger(ch.chainId) && idx.byId.has(ch.chainId) ? idx.byId.get(ch.chainId) : undefined;
  if (p === undefined) { const n = normName(ch.name); p = n && idx.byName.has(n) ? idx.byName.get(n) : undefined; }
  if (p === null) return { status: 'unchecked', note: 'CoinGecko lists more than one asset platform that could be this chain' };
  if (!p) return { status: 'unchecked', note: 'CoinGecko lists no asset platform for this chain' };
  if (!p.native) return { status: 'unchecked', note: 'CoinGecko’s asset platform for this chain (' + p.id + ') names no native coin' };
  if (p.native === ch.gecko || (ch.gas && p.native === ch.gas)) return { status: 'confirmed' };
  const c = typeof coinOf === 'function' ? coinOf(p.native) : null;
  return { status: 'differs', note: 'CoinGecko lists ' + (c && c.symbol ? '$' + c.symbol + ' (' + p.native + ')' : p.native) + ' as this chain’s native coin; DefiLlama names ' + ch.gecko
    + (ch.gas && ch.gas !== ch.gecko ? ' (and ' + ch.gas + ' for gas)' : '') + ' — the figure shown is for DefiLlama’s' };
}

module.exports = { TOL, cleanText, normName, sameName, symOf, money, qty, cgCoin, loreCoin, platformsOf, bySymbol, matchCoin, learnLore, allMatched, selfChecks, crossCheck, platformIndex, mappingCheck };
