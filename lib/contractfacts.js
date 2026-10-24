'use strict';
/* ===== What a token's contract lets someone do — and whether anyone still can =====================================
   Owner, 2026-10-24: "apply the red flag rule to robinhood too. Also make sure to check if a contract is renounced cause
   then that negates any functions that may have been written in the contract originally. Having it be renounced or owned
   by a dead address makes it so that the developer of the project cannot use any of those functions anymore. Also make
   sure to check is liquidity is locked by checking if the liquidity is owned by a dead address also. Make sure if another
   address is the owner of the contract or liquidity make sure the users can see that contract address."

   One module, used by the server (scanVerdict, the Hot Feed's first-cleared moment, the home chain's profile) and by
   lib/multichain.js (Ethereum) — and mirrored, key for key, by public/newpairs.js (vendorFacts), which a test runs side by
   side with redFacts below so the page and the server can never disagree about which red facts were found.

     · DEAD_ADDRS — the addresses nobody holds a key to: the zero address, 0x…dEaD, and 0xdead…42069 (the third burn
       address common on EVM launchpads). Ownership given to one is renounced; LP tokens sent to one are burned — gone for
       good, which is a stronger lock than any locker.
     · evmFacts(g) — GoPlus Security's token-security reading in the site's vocabulary (Ethereum, and Robinhood Chain:
       GoPlus serves chain 4663), with the LP holders split into burned (a dead address), in a locker, and everyone else —
       each with its address, so a reader can see who holds the LP.
     · redFacts(p) — the red powers the reading found, split into the ones still usable and the ones a REAL renounce has
       neutralised. A power an owner calls (mint, blacklist, pause, change balances, change the tax) cannot be called once
       ownership sits at a dead address — unless GoPlus also reads a way to take ownership back or a hidden owner, in which
       case the renounce is not real and nothing is neutralised. What is not an owner's call stays red whatever the owner:
       a honeypot, a sell or buy block (the token's behaviour now), self-destruct, a hidden owner, a take-back path. */

const DEAD_ADDRS = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead', '0xdead000000000000000042069420694206942069']);
const lc = (a) => String(a || '').toLowerCase();
const isDead = (a) => DEAD_ADDRS.has(lc(a));
// a number read from a feed: a blank, a null or anything that is not numeric is null — not read — never 0
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
const gpFlag = (v) => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null);   // GoPlus answers "1"/"0"; anything else is unknown

/* GoPlus's reading → chainFacts. Every field is true / false / null (not read); a share is a percent of the whole. */
function evmFacts(g, meta) {
  if (!g) return null;
  const pct = (v) => { const n = num(v); return n == null ? null : n * 100; };
  /* The LP holders GoPlus lists (its top ten): who holds the pool's LP tokens. Burned = held by a dead address (GoPlus also
     marks those is_locked, so they are taken out of the locker share, never counted twice). A share that is blank makes
     its sum unread (null), not smaller. */
  const lpTop = Array.isArray(g.lp_holders) ? g.lp_holders.map((h) => ({
    address: lc(h.address), pct: num(h.percent) != null ? num(h.percent) * 100 : null, dead: isDead(h.address),
    locked: gpFlag(h.is_locked) === true && !isDead(h.address), contract: gpFlag(h.is_contract), tag: h.tag ? String(h.tag).slice(0, 40) : null,
  })).filter((h) => /^0x[0-9a-f]{40}$/.test(h.address)) : null;
  const share = (test) => (lpTop && lpTop.length ? lpTop.reduce((a, h) => (a == null || !test(h) ? a : h.pct == null ? null : a + h.pct), 0) : null);
  const owner = g.owner_address != null && String(g.owner_address).trim() !== '' ? lc(g.owner_address) : null;
  return {
    honeypot: gpFlag(g.is_honeypot), cannotSellAll: gpFlag(g.cannot_sell_all), cannotBuy: gpFlag(g.cannot_buy),
    buyTax: pct(g.buy_tax), sellTax: pct(g.sell_tax), transferTax: pct(g.transfer_tax),
    mintable: gpFlag(g.is_mintable), proxy: gpFlag(g.is_proxy), blacklist: gpFlag(g.is_blacklisted), whitelist: gpFlag(g.is_whitelisted),
    pausable: gpFlag(g.transfer_pausable), cooldown: gpFlag(g.trading_cooldown), takeBack: gpFlag(g.can_take_back_ownership), hiddenOwner: gpFlag(g.hidden_owner),
    selfdestruct: gpFlag(g.selfdestruct), externalCall: gpFlag(g.external_call), antiWhale: gpFlag(g.is_anti_whale), inDex: gpFlag(g.is_in_dex), inCex: gpFlag(g.is_in_cex),
    ownerChangeBalance: gpFlag(g.owner_change_balance), slippageModifiable: gpFlag(g.slippage_modifiable), antiWhaleModifiable: gpFlag(g.anti_whale_modifiable),
    personalSlippage: gpFlag(g.personal_slippage_modifiable),
    owner,   // GoPlus's owner_address, as it gave it (a dead address included) — null when it named none
    // the share of LP GoPlus marks locked, dead addresses included (what this field always meant) — and the two parts of it
    lpHolders: num(g.lp_holder_count), lpLockedPct: share((h) => h.locked || h.dead),
    lpBurnedPct: share((h) => h.dead), lpLockerPct: share((h) => h.locked), lpTop: lpTop ? lpTop.slice(0, 10) : null, lpSource: lpTop && lpTop.length ? 'goplus' : null,
    /* WHICH pool those LP figures are for: GoPlus lists the token's pools in dex[]; with exactly one, its LP holders are that pool's.
       With several (or none) the pool is not named, and a caller that reads a pool itself must not mix the two (lpPool null). */
    lpPool: Array.isArray(g.dex) && g.dex.length === 1 && g.dex[0] && /^0x[0-9a-f]{40}$/i.test(String(g.dex[0].pair || '')) ? lc(g.dex[0].pair) : null,
    lpTotalSupply: num(g.lp_total_supply),   // in whole LP tokens — a second way to tell that GoPlus read the same pool
    creator: g.creator_address ? lc(g.creator_address) : null, source: 'goplus', program: (meta && meta.program) || null,
  };
}

/* ----- the rule ----- */
// [key, the word for it, what it lets someone do] — the order the verdict names them in. The client's VENDOR_EVM is the same list.
const RED_EVM = [
  ['honeypot', 'Honeypot', 'a buy goes through and a sell does not'],
  ['cannotSellAll', 'Cannot sell all at once', 'a holder cannot sell a whole balance in one go'],
  ['cannotBuy', 'Cannot buy', 'buying is blocked'],
  ['mintable', 'Mintable', 'more tokens can be minted'],
  ['blacklist', 'Blacklist', 'wallets can be blocked from trading'],
  ['pausable', 'Pausable transfers', 'transfers can be switched off'],
  ['ownerChangeBalance', 'Owner can change balances', 'any wallet’s balance can be changed by the owner'],
  ['slippageModifiable', 'Changeable tax', 'the trading tax can be raised, up to trapping sellers'],
  ['personalSlippage', 'Per-wallet tax', 'a tax can be set for one wallet, up to blocking it from selling'],
  ['antiWhaleModifiable', 'Changeable trade caps', 'the caps on buys, sells or wallets can be tightened onto sellers'],
  ['hiddenOwner', 'Hidden owner', 'an owner the public owner() call does not show'],
  ['takeBack', 'Ownership can be taken back', 'ownership can be reclaimed after it is given up'],
  ['selfdestruct', 'Self-destruct', 'the contract can destroy itself'],
];
// the powers an OWNER calls — a real renounce leaves nobody able to call them
const OWNER_GATED = new Set(['mintable', 'blacklist', 'pausable', 'ownerChangeBalance', 'slippageModifiable', 'personalSlippage', 'antiWhaleModifiable']);

/* Is ownership REALLY given up? The owner read is at a dead address (token.renounced, from the chain's own owner() call on
   Robinhood Chain, GoPlus's owner_address on Ethereum) and GoPlus reads no way back to it (take-back) and no owner behind
   it (hidden owner). null when not read. */
function renouncedReal(p) {
  const t = (p && p.token) || {}, f = (p && p.chainFacts) || {};
  /* A proxy is not renounced by its owner(): whoever administers the proxy can swap the code underneath, owner and all (review,
     2026-10-24). A take-back path or a hidden owner means the renounce can be undone or was never the whole story. */
  if (f.takeBack === true || f.hiddenOwner === true || f.proxy === true) return false;
  // a dead owner, however the profile stored it (ownerBurn since 2026-10-24; an older profile kept it in owner, with renounced false for 0x…dEaD)
  if (t.ownerBurn ? isDead(t.ownerBurn) : (t.owner && isDead(t.owner))) return true;
  return t.renounced === true ? true : t.renounced === false ? false : null;
}

/* The red facts a profile carries: { found, neutralised }. found withholds the rocket and ✅ (the floor); neutralised is
   said on the card ("renounced — nobody can use it") and does not. Solana's version is its authorities: a held mint or
   freeze authority is found, and there is nothing to neutralise (a revoked authority reads as mintable false). */
function redFacts(p) {
  const f = p && p.chainFacts, out = { found: [], neutralised: [] };
  if (!f) return out;
  if (p.chain === 'solana') {
    if (f.mintable === true) out.found.push('mintable');
    if (f.freezable === true) out.found.push('freezable');
    return out;
  }
  const ren = renouncedReal(p) === true;
  for (const [k] of RED_EVM) {
    if (f[k] !== true) continue;
    if (k === 'honeypot' && p.risk && p.risk.honeypotSuspect) continue;   // already the honeypot flag on the floor — not said twice
    (OWNER_GATED.has(k) && ren ? out.neutralised : out.found).push(k);
  }
  return out;
}

module.exports = { DEAD_ADDRS, isDead, num, gpFlag, evmFacts, RED_EVM, OWNER_GATED, renouncedReal, redFacts };
