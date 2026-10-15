/* ===== walletchart.js — a wallet's token holdings' value over time, drawn from on-chain Sync events =====
 *
 * value(t) = Σ over the charted tokens of held(t) × price(t). held(t) is exact: the wallet's own transfers (self-
 * transfers excluded), reconciled against the live balance by tracker.js. price(t) is each token's pool's own spot
 * price — exact at every Sync of a Uniswap-v2-style pair and carried forward between Syncs, read by the server
 * (GET /api/chain/pricehist) from the pair's reserves. Only v2-style pairs are charted; a pool that keeps no
 * reserves is "not charted (its pool has no v2 price history)". The ETH balance is NOT in the curve (plain ETH
 * moves leave no log) and is shown beside it as today's figure. USD is at today's ETH price, said everywhere.
 *
 * A change in holdings value is never called a gain or a loss: no percent, no arrow, no green/red on that line —
 * it rises when the wallet buys or receives. A dashed second line, net invested to date (ETH the pools took for
 * the wallet's own buys of the charted tokens − ETH they paid out for its sells), is drawn beside it, and the note
 * says the gap between the two is not a profit figure.
 *
 * CSP-safe (no inline JS), DPR-aware canvas like chart.js, keyboard crosshair (role=slider), a table of the same
 * numbers for screen readers, forced-colours and reduced-motion aware. window.mountWalletChart(host, report, prefs).
 * Nothing at the top level touches document/matchMedia: tests load this file in a bare vm with only `window`. */
(function () {
  'use strict';

  const RANGES = {
    '7d':  { size: 10000,  span: 6050000,  label: '7 days',  tip: 'Charts the last 7 days of holdings value' },
    '30d': { size: 50000,  span: 25900000, label: '30 days', tip: 'Charts the last 30 days of holdings value' },
    '90d': { size: 100000, span: 77800000, label: '90 days', tip: 'Charts the last 90 days of holdings value' },
    'all': { size: 500000, span: null,     label: 'All',     tip: 'Charts the whole history since the wallet’s first token transfer' },
  };
  const RANGE_ORDER = ['7d', '30d', '90d', 'all'];
  const CACHE = new Map();              // 'pair|token|from0|size' → { at, data }
  const CACHE_TTL = 15 * 60 * 1000;
  const CACHE_MAX = 96;                 // 8 tokens × 4 ranges × 3 wallets; a stale key never recurs (from0 moves with head), so expired entries are swept on every set
  const MAX_INFLIGHT = 2;
  const PAD = { l: 66, r: 14, t: 14, b: 38 };
  let current = null;                   // the AbortController of the live mount; the next mount aborts it
  let inflight = 0;
  const waiters = [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const reduced = () => !!((window.prefersReduced && window.prefersReduced()) || (window.document && document.documentElement.classList.contains('motion-off')));
  /* Money: 0 decimals at ≥ $1,000, 2 below, up to 4 below $1 — the same ladder as tracker.js. */
  const fmtUsd = (n) => {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    const s = abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : abs >= 1 ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return (n < 0 ? '−' : '') + '$' + s;
  };
  const fmtEth = (n) => {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    const s = abs >= 1 ? abs.toLocaleString('en-US', { maximumFractionDigits: 4 }) : abs >= 0.001 ? abs.toLocaleString('en-US', { maximumFractionDigits: 6 }) : abs === 0 ? '0' : String(Number(abs.toPrecision(3)));
    return (n < 0 ? '−' : '') + s + ' ETH';
  };
  const dateOf = (ms) => ms == null ? '—' : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dayOf = (ms) => ms == null ? '—' : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function tickLabel(ms, spanMs) {
    const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
    if (spanMs <= 36e5 * 30) return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    if (spanMs <= 864e5 * 3) return MON[d.getUTCMonth()] + ' ' + d.getUTCDate() + ' ' + p(d.getUTCHours()) + ':00';
    if (spanMs <= 864e5 * 400) return MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
    return MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  // one point per ~N — measured from the dated points, never assumed from a block rate
  function cadence(points) {
    const ds = [];
    for (let i = 1; i < points.length; i++) if (points[i].ms != null && points[i - 1].ms != null) ds.push(points[i].ms - points[i - 1].ms);
    if (!ds.length) return null;
    ds.sort((a, b) => a - b);
    const med = ds[Math.floor(ds.length / 2)];
    if (med < 36e5) return '~' + Math.max(1, Math.round(med / 6e4)) + ' minutes';
    if (med < 48 * 36e5) return '~' + Math.max(1, Math.round(med / 36e5)) + ' hours';
    return '~' + Math.max(1, Math.round(med / 864e5)) + ' days';
  }
  /* The summary sentence. This series never carries a percent, an arrow or a colour: a wallet that bought more is
     worth more, and that is not a return. */
  function summaryText(first, last, firstMs, invested, usd, partial, ethPriceMissing) {
    const v = usd ? fmtUsd : fmtEth;
    const from = first == null ? 'not valued' : (usd && first < 1 ? 'from under $1' : v(first));
    let s = 'Holdings value: ' + from + ' on ' + dateOf(firstMs) + ' → ' + (last == null ? 'not valued' : v(last)) + ' now (change in value — includes buys, sells and transfers, not a return). ' +
      'Net invested to date: ' + (invested == null ? 'not valued' : fmtEth(invested)) + '. ' +
      (usd ? 'USD at today\'s ETH price.' : 'USDG-quoted pools and USDG legs converted at today\'s ETH price.');
    if (partial) s += ' Partial: some points lack a price for part of the holdings.';
    if (ethPriceMissing) s += ' No ETH price could be read right now, so values are in ETH.';
    return s;
  }

  /* ---- the price-history fetch: cached per pair|token|from0|size, at most two in flight, one abort per mount ---- */
  const acquire = () => new Promise((res) => { if (inflight < MAX_INFLIGHT) { inflight++; res(); } else waiters.push(res); });
  const release = () => { inflight--; const w = waiters.shift(); if (w) { inflight++; w(); } };
  function cacheKey(pair, token, from, size) { return pair + '|' + token + '|' + (Math.floor(from / size) * size) + '|' + size; }
  function cached(pair, token, from, size) {
    const c = CACHE.get(cacheKey(pair, token, from, size));
    if (c && Date.now() - c.at < CACHE_TTL) return c.data;
    return null;
  }
  function remember(key, data) {        // bounded: expired entries are swept on every set, and the cap evicts oldest-first
    const now = Date.now();
    for (const [k, v] of CACHE) if (now - v.at >= CACHE_TTL) CACHE.delete(k);
    CACHE.delete(key);                  // re-insert so the cap evicts true oldest-first
    CACHE.set(key, { at: now, data });
    while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  }
  async function fetchHist(pair, token, from, size, signal) {
    const hit = cached(pair, token, from, size);
    if (hit) return hit;
    await acquire();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal && signal.aborted) return { ok: false, aborted: true };
        let res = null, j = null;
        try {
          res = await fetch('/api/chain/pricehist?pair=' + encodeURIComponent(pair) + '&token=' + encodeURIComponent(token) + '&from=' + Math.max(0, Math.floor(from)) + '&size=' + size, { credentials: 'same-origin', signal });
        } catch (e) {
          if (signal && signal.aborted) return { ok: false, aborted: true };
          // a cut connection (a proxy's 100 s, a dropped socket): the server keeps every block it dated, so one more ask converges
          if (attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }
          return { ok: false, why: 'could not be read just now' };
        }
        try { j = await res.json(); } catch {}
        if (res.status === 200 && j && Array.isArray(j.points)) {
          const data = { ok: true, data: j };
          remember(cacheKey(pair, token, from, size), data);
          return data;
        }
        if (res.status === 503 && j && j.busy && attempt === 0) {       // one reader at a time: wait as told, then ask once more
          const ra = Math.min(10, Math.max(1, Number(res.headers.get('retry-after')) || 5));
          await new Promise(r => setTimeout(r, ra * 1000));
          continue;
        }
        if (res.status === 400 && j && (j.unsupported || /does not hold|not supported/i.test(j.error || ''))) {
          // a stable answer: the pool keeps no v2 reserves, or the pair record does not hold this token — remembered like a hit, so a re-render does not ask again
          const data = { ok: false, unsupported: true, why: j.unsupported || /not supported/i.test(j.error || '') ? 'no v2 price history' : 'its pool record does not hold it' };
          remember(cacheKey(pair, token, from, size), data);
          return data;
        }
        if (res.status >= 500 && res.status !== 503 && attempt === 0) { await new Promise(r => setTimeout(r, 3000)); continue; }   // a 502/504 from the proxy: once more, for the same reason
        if (res.status === 422 && j && j.dense) return { ok: false, why: 'too busy to chart (over 200,000 swaps)' };
        if (res.status === 404) return { ok: false, why: 'could not be read (the server has no price history yet)' };
        return { ok: false, why: (j && j.error) || 'could not be read just now', busy: res.status === 503 || res.status === 429 };
      }
      return { ok: false, why: 'could not be read just now', busy: true };
    } finally { release(); }
  }

  /* ---- the series ---- */
  const stepAt = (pts, block) => {               // the step function's value at `block` (pts oldest first, [block, value])
    let lo = 0, hi = pts.length - 1, v = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= block) { v = pts[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return v;
  };
  /* Points on the shared bucket grid: every token's request carries the same from0 and size, so bucket i is the same
     span of blocks for all of them. Value = Σ held(b) × price(b); a token whose price is null at a point contributes
     nothing and marks the point partial when it held anything. A point where the wallet held something but NOTHING
     was priced is null — "not valued" — never 0; 0 is only a point where nothing was held. The last point uses the
     report's live prices. */
  function compute(C) {
    const usd = C.usd && C.ethUsd != null;
    const conv = (t, p) => p == null ? null : t.quote === 'USDG' ? (usd ? p : (C.ethUsd ? p / C.ethUsd : null)) : (usd ? p * C.ethUsd : p);
    const ok = C.tokens.filter(t => C.results[t.address] && C.results[t.address].ok && t.reconciles);
    let n = 0;
    for (const t of ok) n = Math.max(n, C.results[t.address].data.points.length);
    const points = [];
    for (let i = 0; i < n; i++) {
      let b = null, ms = null, value = 0, partial = false, any = false, priced = 0;
      for (const t of ok) {
        const pts = C.results[t.address].data.points;
        const q = pts[Math.min(i, pts.length - 1)];
        if (b == null && q.b != null) b = q.b;
        if (ms == null && q.ms != null) ms = q.ms;
        const held = stepAt(t.held, q.b != null ? q.b : b);
        if (!(held > 0)) continue;
        any = true;
        const p = conv(t, q.p);
        if (p == null) partial = true; else { value += held * p; priced++; }
      }
      points.push({ i, b, ms, value: any ? (priced ? value : null) : 0, partial, carried: false });
    }
    if (points.length) {                        // the last point at today's price, like the holdings table
      const last = points[points.length - 1];
      let value = 0, partial = false, any = false, priced = 0;
      for (const t of ok) {
        const held = t.heldNow != null ? t.heldNow : stepAt(t.held, last.b);
        if (!(held > 0)) continue;
        any = true;
        const p = t.priceUsd == null ? null : (usd ? t.priceUsd : (C.ethUsd ? t.priceUsd / C.ethUsd : null));
        if (p == null) partial = true; else { value += held * p; priced++; }
      }
      last.value = any ? (priced ? value : null) : 0; last.partial = partial; last.live = true;
      if (last.ms == null) last.ms = C.report.readAt || Date.now();
    }
    // net invested to date, over the tokens actually charted (valued trades only)
    const deltas = [];
    let unvalued = 0;
    for (const t of ok) { for (const d of t.invest || []) deltas.push(d); unvalued += t.investUnvalued || 0; }
    deltas.sort((a, b) => a[0] - b[0]);
    const inv = []; let cum = 0;
    for (const [b, e] of deltas) { cum += e; const l = inv[inv.length - 1]; if (l && l[0] === b) l[1] = cum; else inv.push([b, cum]); }
    for (const q of points) q.invested = q.b == null ? null : stepAt(inv, q.b);
    C.points = points; C.investedUnvalued = unvalued; C.charted = ok;
    C.investedNow = inv.length ? inv[inv.length - 1][1] : 0;
    // per-token notes: priced from its first Sync; not charted after the date its pool drained (its earlier holdings
    // ARE in the curve, so it stays in "Charted:" — "Not charted:" is for tokens that are not drawn at all)
    C.tokenNotes = [];
    for (const t of ok) {
      const d = C.results[t.address].data;
      const firstHeld = t.held.find(x => x[1] > 0);
      if (d.firstSync && firstHeld && firstHeld[0] < d.firstSync.block) C.tokenNotes.push('$' + t.symbol + ' priced from ' + dateOf(d.firstSync.ms) + '; earlier holdings not valued');
      const drained = d.points.find(q => q.drained);
      if (drained && !d.points.slice(d.points.indexOf(drained)).some(q => q.p != null)) C.tokenNotes.push('$' + t.symbol + ' not charted after ' + dayOf(drained.ms) + ' (pool drained after that Sync; later holdings not valued)');
    }
  }

  /* ---- drawing, in the chart.js idiom ---- */
  function colours(C) {
    const css = getComputedStyle(document.documentElement);
    const tok = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
    const out = { value: tok('--diamond', '#9fe0ff'), invested: tok('--gold', '#ffb340'), axis: tok('--text-mute', '#949c8a'), grid: 'rgba(255,255,255,0.08)', cross: 'rgba(255,255,255,0.35)', fill: 'rgba(159,224,255,0.16)' };
    if (C.forced) {                             // forced colours: system colours read from probes, nothing of our own
      const probe = (c) => { const s = document.createElement('span'); s.style.color = c; s.style.position = 'absolute'; s.style.left = '-9999px'; document.body.appendChild(s); const v = getComputedStyle(s).color; s.remove(); return v; };
      out.value = probe('CanvasText'); out.invested = probe('LinkText'); out.cross = probe('Highlight'); out.axis = out.value; out.grid = probe('GrayText'); out.fill = 'transparent';
    }
    return out;
  }
  function axisFont(C) {
    const probe = C.host.querySelector('.wc-probe');
    const fs = probe ? parseFloat(getComputedStyle(probe).fontSize) || 16 : 16;
    return Math.max(12, Math.round(fs * 0.7)) + 'px ui-monospace, Menlo, monospace';
  }
  /* A tick is labelled with the value it sits on: USD on the money ladder above (cents dropped only at ≥ $1,000, so a
     gridline at $5.40 reads $5.40, not $5); ETH formats the magnitude and re-attaches the sign as fmtEth does, so a
     negative net-invested tick reads −0.1900, never -1.9e-1. */
  function fmtAxis(v, usd) {
    if (!isFinite(v)) return '';
    if (usd) return fmtUsd(v);
    const s = Math.abs(v), sign = v < 0 ? '−' : '';
    return sign + (s >= 1 ? s.toFixed(2) : s >= 0.001 ? s.toFixed(4) : s === 0 ? '0' : s.toExponential(1));
  }
  function drawMessage(C, msg) {
    const cv = C.canvas, ctx = cv.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect(); const W = Math.max(240, Math.round(r.width)), H = Math.max(160, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const col = colours(C);
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = PAD.t + (i / 4) * (H - PAD.t - PAD.b); ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(W - PAD.r, y + 0.5); ctx.stroke(); }
    ctx.fillStyle = col.axis; ctx.font = axisFont(C); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = String(msg).split(' '), max = W - PAD.l - PAD.r - 20, lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    const cy = PAD.t + (H - PAD.t - PAD.b) / 2 - (lines.length - 1) * 9;
    lines.slice(0, 4).forEach((ln, i) => ctx.fillText(ln, (PAD.l + W - PAD.r) / 2, cy + i * 18));
    C.geo = null;
  }
  function draw(C) {
    const cv = C.canvas, ctx = cv.getContext('2d'); if (!ctx) return;
    const pts = C.points || [];
    if (pts.length < 2) { drawMessage(C, C.msg || 'Nothing to chart in this range.'); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect(); const W = Math.max(240, Math.round(r.width)), H = Math.max(160, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const col = colours(C), usd = C.usd && C.ethUsd != null;
    const showV = C.state.wcSeries.value !== false, showI = C.state.wcSeries.invested !== false;
    const invScale = (v) => v == null ? null : (usd && !C.invRight ? v * C.ethUsd : v);   // invested in $ on the shared axis, in ETH on its own
    const dated = pts.filter(q => q.ms != null);
    const t0 = dated.length ? dated[0].ms : 0, t1 = dated.length ? dated[dated.length - 1].ms : 1;
    // the value axis never goes below 0 (a null point — held, nothing priced — is not a value and does not scale it);
    // invested goes to a right-hand axis in ETH when it is ever negative
    let vMax = 0;
    for (const q of pts) { if (showV && q.value > vMax) vMax = q.value; if (showI && !C.invRight && invScale(q.invested) > vMax) vMax = invScale(q.invested); }
    if (!(vMax > 0)) vMax = 1;
    vMax *= 1.08;
    ctx.font = axisFont(C); ctx.textBaseline = 'middle';
    const fontPx = parseFloat(ctx.font) || 12;
    // the bottom gutter holds the tick row and the footer line, so it follows the axis font (PAD.b fit a 12px font only)
    const padB = Math.round(fontPx * 2.4 + 8);
    const py = (v) => PAD.t + (1 - v / vMax) * (H - PAD.t - padB);
    let iMin = 0, iMax = 0;
    if (C.invRight) { for (const q of pts) { if (q.invested != null) { if (q.invested < iMin) iMin = q.invested; if (q.invested > iMax) iMax = q.invested; } } if (iMax === iMin) iMax = iMin + 1; }
    // the gutters are measured from the labels they hold, at the axis font — a tick is never cut by the canvas edge;
    // the right gutter is the widest invested tick plus one line for the rotated title
    const widest = (f) => Math.ceil(Math.max(...[0, 1, 2, 3, 4].map(i => ctx.measureText(f(i)).width)));
    const padL = Math.max(PAD.l, widest(i => fmtAxis(vMax * (i / 4), usd)) + 12);
    const padR = C.invRight && showI ? Math.max(66, widest(i => fmtAxis(iMin + (iMax - iMin) * (i / 4), false)) + fontPx + 12) : PAD.r;
    const pyI = (v) => C.invRight ? PAD.t + (1 - (v - iMin) / (iMax - iMin)) * (H - PAD.t - padB) : py(invScale(v));
    const pxR = (q) => padL + (dated.length > 1 && q.ms != null ? (q.ms - t0) / (t1 - t0 || 1) : q.i / Math.max(1, pts.length - 1)) * (W - padL - padR);

    for (let i = 0; i <= 4; i++) {
      const v = vMax * (i / 4), y = py(v);
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(W - padR, y + 0.5); ctx.stroke();
      ctx.fillStyle = col.axis; ctx.textAlign = 'right'; ctx.fillText(fmtAxis(v, usd), padL - 6, y);
      if (C.invRight && showI) { ctx.textAlign = 'left'; ctx.fillStyle = col.invested; ctx.fillText(fmtAxis(iMin + (iMax - iMin) * (i / 4), false), W - padR + 6, y); }
    }
    // the rotated title sits one half-line in from the edge: its em box ends at W − 2 and starts 4px after the widest tick
    if (C.invRight && showI) { ctx.save(); ctx.translate(W - 2 - fontPx / 2, PAD.t + (H - PAD.t - padB) / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = col.invested; ctx.fillText('Net invested (ETH)', 0, 0); ctx.restore(); }
    ctx.save();
    ctx.beginPath(); ctx.rect(padL, PAD.t, W - padL - padR, H - PAD.t - padB); ctx.clip();
    if (showV) {
      // a faint fill under the line, in the same neutral colour — one fill per run of valued points: a null point
      // (held, nothing priced) is a gap in the curve, never a point drawn at 0
      const runs = []; let run = null;
      for (const q of pts) { if (q.value == null) { run = null; continue; } if (!run) runs.push(run = []); run.push(q); }
      for (const r of runs) {
        ctx.beginPath(); ctx.moveTo(pxR(r[0]), H - padB);
        for (const q of r) ctx.lineTo(pxR(q), py(q.value));
        ctx.lineTo(pxR(r[r.length - 1]), H - padB); ctx.closePath();
        ctx.fillStyle = col.fill; ctx.fill();
      }
      // the line; a partial stretch (a price missing for part of the holdings) is drawn dotted so it does not pass for exact
      ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = col.value;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].value == null || pts[i - 1].value == null) continue;
        ctx.setLineDash(pts[i].partial || pts[i - 1].partial ? [2, 4] : []);
        ctx.beginPath(); ctx.moveTo(pxR(pts[i - 1]), py(pts[i - 1].value)); ctx.lineTo(pxR(pts[i]), py(pts[i].value)); ctx.stroke();
      }
      ctx.setLineDash([]);
      const last = pts[pts.length - 1];
      if (last.value != null) { ctx.beginPath(); ctx.arc(pxR(last), py(last.value), 3.5, 0, Math.PI * 2); ctx.fillStyle = col.value; ctx.fill(); }
    }
    if (showI) {
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = col.invested;
      ctx.beginPath(); let started = false;
      for (const q of pts) { if (q.invested == null) continue; const x = pxR(q), y = pyI(q.invested); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // the time axis: ticks on round boundaries
    if (dated.length > 1) {
      const spanMs = t1 - t0;
      const STEPS = [3600, 7200, 14400, 43200, 86400, 172800, 259200, 345600, 604800, 1209600, 2592000, 7776000, 15552000, 31536000].map(s => s * 1000);
      const want = Math.max(2, Math.min(7, Math.floor((W - padL - padR) / 96)));
      const step = STEPS.find(x => x >= spanMs / want) || STEPS[STEPS.length - 1];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = col.axis;
      for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
        const x = padL + ((tt - t0) / (spanMs || 1)) * (W - padL - padR);
        if (x < padL + 28 || x > W - padR - 28) continue;
        ctx.strokeStyle = col.grid; ctx.beginPath(); ctx.moveTo(x + 0.5, PAD.t); ctx.lineTo(x + 0.5, H - padB); ctx.stroke();
        ctx.fillText(tickLabel(tt, spanMs), x, H - padB + 4);
      }
      ctx.textAlign = 'left'; ctx.globalAlpha = 0.85;
      let foot = dateOf(t0) + ' → ' + dateOf(t1) + ' (UTC ticks)';         // the span in words; shorter when the plot is narrow
      if (ctx.measureText(foot).width > W - padL - padR) foot = dayOf(t0) + ' → ' + dayOf(t1) + ' (UTC)';
      ctx.textBaseline = 'bottom'; ctx.fillText(foot, padL, H - 3); ctx.textBaseline = 'top';   // the footer sits on its own line under the ticks, inside the canvas
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'middle';
    C.geo = { W, H, padL, padR, padB, px: pxR, py, pyI, t0, t1 };
    drawCrosshair(C);
  }
  function drawCrosshair(C) {
    const g = C.geo; if (!g || C.hover == null) return;
    const q = C.points[C.hover]; if (!q) return;
    const ctx = C.canvas.getContext('2d'); if (!ctx) return;
    const col = colours(C);
    const x = g.px(q);
    ctx.save();
    ctx.strokeStyle = col.cross; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x + 0.5, PAD.t); ctx.lineTo(x + 0.5, g.H - g.padB); ctx.stroke();
    ctx.setLineDash([]);
    if (q.value != null) {                      // the dot marks a value; a not-valued point gets the line alone
      const y = g.py(q.value);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = col.value; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }
  function repaint(C) { if (C.points && C.points.length >= 2) draw(C); else drawMessage(C, C.msg || 'Nothing to chart in this range.'); }

  /* ---- the readout: a DOM tip (hover only, aria-hidden) and the slider's aria-valuetext (the AT surface) ---- */
  function pointText(C, i) {
    const q = C.points[i]; if (!q) return '';
    const usd = C.usd && C.ethUsd != null;
    return dateOf(q.ms) + ' · holdings ' + (q.value == null ? 'not valued (no price for any of it)' : usd ? fmtUsd(q.value) + ' (USD at today\'s ETH price)' : fmtEth(q.value)) +
      (q.partial && q.value != null ? ' (partial: a price is missing for part of it)' : '') + (q.live ? ' (now, at today\'s prices)' : '') +
      ' · net invested to date ' + (q.invested == null ? 'not valued' : fmtEth(q.invested));
  }
  function setHover(C, i, fromPointer) {
    const n = C.points.length;
    if (i == null || !n) { C.hover = null; hideTip(C); repaint(C); return; }
    i = clamp(i, 0, n - 1);
    C.hover = i;
    const sl = C.host.querySelector('.wc-slider');
    if (sl) { sl.setAttribute('aria-valuenow', String(i)); sl.setAttribute('aria-valuetext', pointText(C, i)); }
    repaint(C);
    if (C.geo) {
      const q = C.points[i], tip = C.host.querySelector('.wc-tip');
      if (tip) {
        tip.innerHTML = '<div class="wc-tip-t">' + esc(dateOf(q.ms)) + (q.live ? ' · now' : '') + '</div>' +
          '<div class="wc-tip-row"><span>Holdings</span><b>' + esc(q.value == null ? 'not valued' : C.usd && C.ethUsd != null ? fmtUsd(q.value) : fmtEth(q.value)) + '</b></div>' +
          '<div class="wc-tip-row"><span>Net invested</span><b>' + esc(q.invested == null ? '—' : fmtEth(q.invested)) + '</b></div>' +
          (q.value == null ? '<div class="wc-tip-note">Not valued — no charted token had a price yet.</div>'
            : q.partial ? '<div class="wc-tip-note">Partial — a price is missing for part of the holdings.</div>' : '') +
          (C.usd && C.ethUsd != null ? '<div class="wc-tip-note">USD at today’s ETH price.</div>' : '');
        tip.hidden = false;
        const plot = C.host.querySelector('.wc-plot');
        const pb = plot.getBoundingClientRect(), tb = tip.getBoundingClientRect();
        const x = C.geo.px(q), y = C.geo.py(q.value == null ? 0 : q.value);
        let left = x + 14; if (left + tb.width > pb.width - 6) left = Math.max(6, x - tb.width - 14);
        let top = y - tb.height - 12; if (top < 4) top = y + 18;
        top = Math.min(top, pb.height - tb.height - 4);
        tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(Math.max(4, top)) + 'px';
      }
    }
    if (!fromPointer) C.host.querySelector('.wc-plot').classList.add('is-keyed');
  }
  function hideTip(C) { const t = C.host.querySelector('.wc-tip'); if (t) t.hidden = true; }

  /* ---- the shell ---- */
  function shell(C) {
    const st = C.state;
    return '<div class="wc-head">' +
      // one Tab stop (the checked radio; arrows move it) and a ✓ on the checked one, as the report toggles do — never colour alone
      '<div class="wc-ranges" role="radiogroup" aria-label="Time range">' +
        RANGE_ORDER.map(k => { const on = st.wcRange === k; return '<button class="wc-range" data-tip="' + esc(RANGES[k].tip) + '" type="button" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-wc-range="' + k + '" data-trk-key="wc:' + k + '">' + (on ? '✓ ' : '') + esc(RANGES[k].label) + '</button>'; }).join('') +
      '</div>' +
      '<div class="wc-head-r">' +   // the series switches and the ⤢, together at the right
      '<div class="wc-series" role="group" aria-label="Series">' +
        '<button class="wc-sw" data-tip="Shows or hides the holdings value line" type="button" aria-pressed="' + (st.wcSeries.value !== false) + '" data-wc-series="value" data-trk-key="wc:s:value"><span class="wc-swatch wc-swatch-value" aria-hidden="true"></span>Holdings value</button>' +
        '<button class="wc-sw" data-tip="Shows or hides the dashed net-invested line" type="button" aria-pressed="' + (st.wcSeries.invested !== false) + '" data-wc-series="invested" data-trk-key="wc:s:invested"><span class="wc-swatch wc-swatch-invested" aria-hidden="true"></span>Net invested</button>' +
      '</div>' +
      '<button class="cf-open" type="button" data-cf-open aria-haspopup="dialog" aria-label="Show the value over time chart full screen" data-tip="Opens this chart full screen — Close or Esc brings it back"><i class="cf-ico" aria-hidden="true"></i></button>' +
      '</div></div>' +
      '<div class="wc-plot"><canvas class="wc-canvas" role="img" aria-label="Holdings value over time"></canvas><div class="wc-tip" role="tooltip" aria-hidden="true" hidden></div></div>' +
      '<div class="wc-slider" role="slider" tabindex="0" aria-label="Point in time" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="No points yet" data-tip="Moves the crosshair along the chart — arrow keys step one point, Page Up and Down ten, Home and End jump, Escape clears" data-trk-key="wc:slider"><span class="wc-slider-k" aria-hidden="true"></span></div>' +
      '<p class="wc-status" role="status"></p>' +
      '<p class="wc-summary"></p>' +
      '<details class="wc-table"' + (st.tableOpen ? ' open' : '') + '><summary data-tip="Lists every charted point as numbers">Show as a table</summary><div class="wc-table-wrap"></div></details>' +
      '<p class="wc-note modal-note"></p>' +
      '<span class="wc-probe" aria-hidden="true">0</span>';
  }
  function wire(C) {
    const host = C.host, sig = C.ctrl.signal;
    host.addEventListener('click', (e) => {
      const rb = e.target.closest('[data-wc-range]');
      if (rb) {
        const k = rb.dataset.wcRange; if (!RANGES[k] || k === C.state.wcRange) return;
        C.state.wcRange = k;
        host.querySelectorAll('[data-wc-range]').forEach(b => { const on = b.dataset.wcRange === k; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.textContent = (on ? '✓ ' : '') + RANGES[b.dataset.wcRange].label; });
        load(C);
        return;
      }
      const sb = e.target.closest('[data-wc-series]');
      if (sb) {
        const k = sb.dataset.wcSeries; C.state.wcSeries[k] = sb.getAttribute('aria-pressed') !== 'true';
        sb.setAttribute('aria-pressed', String(C.state.wcSeries[k]));
        repaint(C);
      }
    }, { signal: sig });
    host.querySelector('.wc-table').addEventListener('toggle', (e) => { C.state.tableOpen = e.target.open; }, { signal: sig });
    // the radiogroup from the keyboard: arrows move the checked range
    host.querySelector('.wc-ranges').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const i = RANGE_ORDER.indexOf(C.state.wcRange), d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
      const k = RANGE_ORDER[(i + d + RANGE_ORDER.length) % RANGE_ORDER.length];
      const b = host.querySelector('[data-wc-range="' + k + '"]'); if (b) { b.focus(); b.click(); }
      e.preventDefault();
    }, { signal: sig });
    const cv = C.canvas;
    const idxAt = (clientX) => {
      const g = C.geo; if (!g || !C.points.length) return null;
      const r = cv.getBoundingClientRect(), x = clientX - r.left;
      if (x < g.padL - 4 || x > g.W - g.padR + 4) return null;
      let best = 0, bd = Infinity;
      for (let i = 0; i < C.points.length; i++) { const d = Math.abs(g.px(C.points[i]) - x); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    const move = (e) => { const i = idxAt(e.clientX); if (i == null) { setHover(C, null, true); return; } setHover(C, i, true); C.host.querySelector('.wc-plot').classList.remove('is-keyed'); };
    cv.addEventListener('pointermove', move, { signal: sig });
    cv.addEventListener('pointerdown', move, { signal: sig });
    cv.addEventListener('pointerleave', () => setHover(C, null, true), { signal: sig });
    const sl = host.querySelector('.wc-slider');
    sl.addEventListener('keydown', (e) => {
      const n = C.points.length; if (!n) return;
      const cur = C.hover == null ? n - 1 : C.hover;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - 1;
      else if (e.key === 'PageUp') next = cur + 10;
      else if (e.key === 'PageDown') next = cur - 10;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = n - 1;
      else if (e.key === 'Escape') { if (C.hover == null) return; setHover(C, null); e.preventDefault(); return; }   // with no crosshair to clear, Esc is not the slider's (it closes a full-screen view)
      else return;
      e.preventDefault();
      setHover(C, clamp(next, 0, n - 1));
    }, { signal: sig });
    sl.addEventListener('blur', () => { if (C.host.querySelector('.wc-plot').classList.contains('is-keyed')) setHover(C, null); }, { signal: sig });
    // the slider track: a tap or drag along it reads the point under the finger, like the canvas
    sl.addEventListener('pointerdown', (e) => { const i = idxAt(e.clientX); if (i != null) setHover(C, i, true); }, { signal: sig });
    sl.addEventListener('pointermove', (e) => { if (e.buttons) { const i = idxAt(e.clientX); if (i != null) setHover(C, i, true); } }, { signal: sig });
    // redraw when the card changes size; stop when the next mount aborts this one
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (host.isConnected) repaint(C); });
      ro.observe(host.querySelector('.wc-plot'));
      sig.addEventListener('abort', () => ro.disconnect());
    }
    // forced colours: system colours now, and again if the setting changes while the chart is up
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(forced-colors: active)');
      C.forced = !!mq.matches;
      const onChange = () => { C.forced = !!mq.matches; repaint(C); };
      if (mq.addEventListener) { mq.addEventListener('change', onChange); sig.addEventListener('abort', () => mq.removeEventListener('change', onChange)); }
    }
  }

  /* ---- loading: one request per charted token for the range, from cache when it can be ---- */
  function rangeOf(C) {
    const R = RANGES[C.state.wcRange] || RANGES['7d'];
    const head = C.report.head != null ? C.report.head : (C.report.series && C.report.series.lastBlock) || 0;
    const first = (C.report.series && C.report.series.firstBlock) || 0;
    const from = R.span == null ? first : Math.max(0, head - R.span);
    return { size: R.size, from, head };
  }
  async function load(C) {
    const seq = C.seq = (C.seq || 0) + 1;
    const { size, from } = rangeOf(C);
    C.results = {}; C.notCharted = (C.report.series.notCharted || []).slice(); C.hover = null; hideTip(C);
    const want = C.tokens.filter(t => t.reconciles);
    // reconciles:false has two causes (tracker.js: the balance was read AND the transfers add up to it): heldNow is null exactly when the balance was unread
    for (const t of C.tokens) if (!t.reconciles) C.notCharted.push({ symbol: t.symbol, why: t.heldNow == null ? 'its balance could not be read' : 'its transfers do not add up to its live balance' });
    // what the cache already holds is drawn at once, with no loading text
    const pending = [];
    for (const t of want) { const hit = cached(t.pair, t.address, from, size); if (hit) C.results[t.address] = hit; else pending.push(t); }
    if (!want.length) { C.msg = 'No token with a v2 pool to chart.'; finish(C); return; }
    if (!pending.length) { finish(C); return; }
    C.msg = 'Reading ' + pending.length + (pending.length === 1 ? ' pool’s' : ' pools’') + ' price history…';
    status(C, C.msg);
    if (Object.keys(C.results).length) finish(C, true); else drawMessage(C, C.msg);
    await Promise.all(pending.map(async (t) => {
      const res = await fetchHist(t.pair, t.address, from, size, C.ctrl.signal);
      if (seq !== C.seq || C.ctrl.signal.aborted) return;
      C.results[t.address] = res;
    }));
    if (seq !== C.seq || C.ctrl.signal.aborted) return;
    finish(C);
  }
  function status(C, msg) { const s = C.host.querySelector('.wc-status'); if (s && s.textContent !== msg) s.textContent = msg; }
  function finish(C, provisional) {
    const failed = C.tokens.filter(t => t.reconciles && C.results[t.address] && !C.results[t.address].ok && !C.results[t.address].aborted);
    const busy = failed.filter(t => !C.results[t.address].unsupported);
    for (const t of failed) C.notCharted.push({ symbol: t.symbol, why: C.results[t.address].why || 'could not be read just now' });
    compute(C);
    const pts = C.points;
    C.invRight = pts.some(q => q.invested != null && q.invested < 0);
    const usd = C.usd && C.ethUsd != null;
    const partial = pts.some(q => q.partial) || busy.length > 0;
    const firstV = pts.length ? pts[0] : null, lastV = pts.length ? pts[pts.length - 1] : null;
    // settle the message first, then derive the summary from it: the canvas, its aria-label and the summary line say the
    // same thing (the loading text never outlives the load; a mid-load paint keeps it)
    if (pts.length < 2 && !provisional) C.msg = C.charted.length ? 'Nothing to chart in this range — no charted token was held in it.'
      : busy.length ? 'No pool could be read just now — nothing to chart.' : 'No token with a v2 pool to chart.';
    const summary = pts.length < 2 ? (C.msg || 'Nothing to chart in this range.')
      : summaryText(firstV.value, lastV.value, firstV.ms, lastV.invested, usd, partial, C.usd && C.ethUsd == null);
    repaint(C);
    C.canvas.setAttribute('aria-label', summary);
    const sl = C.host.querySelector('.wc-slider');
    if (sl) { sl.setAttribute('aria-valuemax', String(Math.max(0, pts.length - 1))); sl.setAttribute('aria-valuenow', String(Math.max(0, pts.length - 1))); sl.setAttribute('aria-valuetext', pts.length ? pointText(C, pts.length - 1) : 'No points to read'); }
    C.host.querySelector('.wc-summary').textContent = summary;
    if (!provisional) status(C, busy.length ? busy.length + (busy.length === 1 ? ' pool' : ' pools') + ' could not be read just now — the chart is partial.' : '');
    // the table of the same numbers
    const wrap = C.host.querySelector('.wc-table-wrap');
    if (wrap) {
      const rows = pts.slice().reverse().slice(0, 200);
      wrap.innerHTML = pts.length ? '<table class="wc-tbl" role="table"><caption>' + (usd ? 'Holdings value per bucket, USD at today\'s ETH price; net invested in ETH' : 'Holdings value per bucket, ETH; net invested in ETH') + '</caption>' +
        '<thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Date</th><th role="columnheader" scope="col" class="num">Holdings value</th><th role="columnheader" scope="col" class="num">Net invested</th></tr></thead><tbody role="rowgroup">' +
        rows.map(q => '<tr role="row"><td role="cell">' + esc(dateOf(q.ms)) + (q.live ? ' (now)' : '') + '</td><td role="cell" class="num">' + (q.value == null ? 'not valued' : esc(usd ? fmtUsd(q.value) : fmtEth(q.value)) + (q.partial ? ' (partial)' : '')) + '</td><td role="cell" class="num">' + esc(q.invested == null ? '—' : fmtEth(q.invested)) + '</td></tr>').join('') +
        '</tbody></table>' + (pts.length > rows.length ? '<p class="modal-note">Newest ' + rows.length + ' of ' + pts.length + ' points.</p>' : '') : '<p class="modal-note">No points.</p>';
    }
    // the note: what this is, and what it is not
    const per = cadence(pts);
    const nc = [];
    const seen = new Set();
    for (const x of C.notCharted) { const k = x.symbol + '|' + x.why; if (seen.has(k)) continue; seen.add(k); nc.push('$' + x.symbol + ' (' + x.why + ')'); }
    const note = 'Token holdings only — the ETH balance is not charted (plain ETH moves leave no log). ' +
      'Prices are each pool\'s own on-chain reserves at every swap (its spot price, not what a sale would fetch); ' + (per ? 'one point per ' + per + '; ' : '') + 'the last point at today\'s price; ' +
      (usd ? 'USD at today\'s ETH price. ' : 'USDG-quoted pools and USDG legs converted at today\'s ETH price. ') +
      'Net invested = ETH the pools took for this wallet\'s own buys of the charted tokens − ETH they paid out for its sells (USDG legs at today\'s ETH price); ' +
      (C.investedUnvalued || 0) + ' unvalued ' + (C.investedUnvalued === 1 ? 'trade' : 'trades') + ' and all transfers in/out are left out, so the gap between the lines is not a profit figure.' +
      (usd && !C.invRight ? ' Net invested in $ uses today\'s ETH price.' : '') +
      (C.tokenNotes.length ? ' ' + C.tokenNotes.join('; ') + '.' : '') +
      (nc.length ? ' Not charted: ' + nc.join(', ') + '.' : '') +
      (C.charted.length ? ' Charted: ' + C.charted.map(t => '$' + t.symbol).join(', ') + '.' : '');
    C.host.querySelector('.wc-note').textContent = note;
  }

  window.mountWalletChart = function (host, report, prefs) {
    if (!host) return;
    if (current) current.abort();
    current = new AbortController();
    const st = host._trkState || (host._trkState = {});
    if (!st.wcRange || !RANGES[st.wcRange]) st.wcRange = '7d';
    if (!st.wcSeries) st.wcSeries = { value: true, invested: true };
    const C = { host, report, usd: !(prefs && prefs.usd === false), ethUsd: report && report.ethUsd != null ? report.ethUsd : null, ctrl: current, state: st, tokens: [], results: {}, points: [], hover: null, forced: false, notCharted: [], tokenNotes: [], charted: [], msg: '' };
    host._wc = C;
    /* the ⤢ opens it full screen (ChartFull, app.js): the live chart itself is moved in, inside a .trk-dash (its styles live
       there). A report drawn again while it is open mounts a new chart and stops this one, so the view swaps to the new one
       by its key rather than show a chart that no longer answers */
    host.setAttribute('data-cf-unit', ''); host.setAttribute('data-cf-key', 'wallet-chart'); host.setAttribute('data-cf-ctx', 'trk-dash'); host.setAttribute('data-cf-title', 'Value over time');
    host.innerHTML = shell(C);
    C.canvas = host.querySelector('canvas');
    wire(C);
    const say = (m) => { C.msg = m; status(C, m); drawMessage(C, m); C.canvas.setAttribute('aria-label', m); host.querySelector('.wc-summary').textContent = m; host.querySelector('.wc-note').textContent = ''; host.querySelector('.wc-slider').setAttribute('aria-valuetext', m); };
    if (!report) { say('No report to chart.'); return; }
    if (report.holdingsFailed) { say('Balances could not be read — no chart'); return; }
    if (!report.series || !Array.isArray(report.series.tokens)) { say('No chart in this saved report — hit Refresh to read the chain.'); return; }
    C.tokens = report.series.tokens.filter(t => t && t.pair && Array.isArray(t.held));
    load(C);
  };
  window.mountWalletChart.helpers = { summaryText, cadence, stepAt, fmtUsd, fmtEth, fmtAxis, cacheKey, cached, remember, compute, RANGES };
})();
