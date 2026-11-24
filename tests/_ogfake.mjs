/* A stand-in for lib/bought.js's verdicts, for the suites that run the real checkOg on an in-memory database
   (tests/ogsilver.mjs, tests/diamondog.mjs). Since "$100 bought" (owner, 2026-11-17) checkOg reads no chain: it decides on
   each member's per-coin verdicts (ogBoughtFacts reads BOUGHT.stateOf). The real verdicts come from the acquisition engine
   on the coin tape (tested on real chain data in tests/acquire.mjs, and end to end in tests/bought.mjs); here they are
   built from per-WALLET facts a suite writes down — the shape ogScan used to return — the way the engine reads a wallet set:
     · the tier's date is the earliest buy across the linked wallets that are not claimed by another account (og_claims) and
       not disqualified by the dump standard;
     · the floor ($100 bought, $10 still held) stands in as the wallets' tokens at the suite's price: true / false — or null
       when a wallet "could not be read" ('fail') and what was read does not clear it;
     · the Diamond month: buys from unclaimed wallets in, every wallet's sales out;
     · the stretches $SEND was held: every wallet's, together.
   A member's verdicts can be frozen (made for the wallets linked at that moment): a wallet linked or unlinked afterwards makes
   them stale (fresh: false), as the real ones are, until they are made again (thaw). */
const EMPTY = { tier: 0, firstBuyMs: null, holds: false, balWei: '0', dumped: false, notAccumulator: false, monthBoughtWei: '0', monthSoldWei: '0' };

export function makeFakeBought({ mem, walletsOf, SCANS, PX, TOKS, idx = (a) => 'idx:' + String(a).toLowerCase() }) {
  const coinOf = (t) => (t === TOKS.SEND ? 'SEND' : 'GWC');
  const claimedElsewhere = (uid, a) => { const o = mem.prepare('SELECT user_id FROM og_claims WHERE addr_idx = ?').get(idx(a)); return !!(o && o.user_id !== uid); };
  function compute(uid, token, given) {
    const coin = coinOf(token), ws = given || walletsOf(uid);
    let held = 0n, readHeld = 0n, failed = false, tierMs = null, tierW = null, monthIn = 0n, monthOut = 0n, anyDq = false;
    const monthW = [], spans = [];
    for (const a of ws) {
      const s = SCANS.get(a + ':' + coin);
      if (s === 'fail') { failed = true; continue; }
      const x = s || EMPTY;
      const bal = BigInt(x.balWei || '0'); held += bal; readHeld += bal;
      if (Array.isArray(x.heldSpans)) spans.push(...x.heldSpans);
      const mine = !claimedElsewhere(uid, a);
      const mi = mine ? BigInt(x.monthBoughtWei || '0') : 0n;
      monthIn += mi; monthOut += BigInt(x.monthSoldWei || '0');
      if (mi > 0n) monthW.push(a);
      if (!x.firstBuyMs || !x.tier || !mine) continue;
      if (x.dumped && x.notAccumulator) { anyDq = true; continue; }
      if (tierMs == null || x.firstBuyMs < tierMs) { tierMs = x.firstBuyMs; tierW = a; }
    }
    const usd = Number(readHeld) / 1e18 * (PX[coin] || 0);
    const floor = usd >= 100 ? true : failed ? null : false;
    const diamondMonth = failed ? null : monthIn > 0n && monthIn > monthOut;
    const reason = floor === true ? 'ok' : floor === null ? 'unknown' : held === 0n ? 'none-held' : 'short-spent';
    return { token, floor, verdict: floor, complete: !failed, why: failed ? 'transient' : null, reason, heldWei: held.toString(),
      spentUsd: failed ? null : usd, heldCostUsd: failed ? null : usd, pendingUsd: 0,
      tierDateMs: tierMs, firstBuyMs: tierMs, tierWallets: tierW ? [tierW] : [], monthIn: monthIn.toString(), monthOut: monthOut.toString(),
      diamondMonth, monthWallets: monthW, spans, dq: { disqualified: tierMs == null && anyDq ? true : false } };
  }
  const frozen = new Map();   // uid → { sig, states }
  const patches = new Map();  // `${uid}:${coin}` → fields laid over the computed verdict (a figure the engine could not read, say)
  const wants = [];
  const sigOf = (uid) => walletsOf(uid).join(',');
  const BOUGHT = {
    stateOf(uid, token) {
      const f = frozen.get(uid);
      if (f) { const st = f.states[coinOf(token)]; return st ? { ...st, fresh: f.sig === sigOf(uid) } : null; }
      return { ...compute(uid, token), ...(patches.get(uid + ':' + coinOf(token)) || {}), fresh: true };
    },
    want(uid, token, opts) { wants.push({ uid, token, opts: opts || {} }); },
    verdictOf(uid, token) { const s = this.stateOf(uid, token); return s && s.fresh ? s.floor : null; },
    // a verdict for a wallet set given on purpose (the restore pass's wallets linked at removal): made now, stored nowhere
    async evaluateSet(uid, token, addrs) { return addrs && addrs.length ? { ...compute(uid, token, addrs.map((a) => String(a).toLowerCase())), ...(patches.get(uid + ':' + coinOf(token)) || {}), fresh: true, given: true } : null; },
  };
  return {
    BOUGHT, wants,
    freeze(uid) { frozen.set(uid, { sig: sigOf(uid), states: { SEND: compute(uid, TOKS.SEND), GWC: compute(uid, TOKS.GWC) } }); },
    thaw(uid) { frozen.delete(uid); },
    patch(uid, coin, fields) { if (fields) patches.set(uid + ':' + coin, fields); else patches.delete(uid + ':' + coin); },
  };
}
