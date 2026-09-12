/* ===== chart.js — our own candlestick chart, drawn from on-chain swap events =====
 *
 * WHY THIS EXISTS: it replaces an embedded third-party chart. The candles come from the pair
 * contract's own Swap logs, which is the same data every aggregator derives its charts from — so
 * this is not a downgrade, it is one step closer to the source. It also removes a third-party
 * iframe, a rate limit we do not control, and a tracking surface.
 *
 * Canvas rather than SVG because a few hundred candles as DOM nodes is wasteful, and canvas is what
 * the site already uses for the arcade.
 * CSP-safe: no inline JS. Accessible: the canvas carries a text summary, and a table of the same
 * numbers is available to screen readers rather than leaving them with an image they cannot read. */
(function () {
  'use strict';

  const TF = [['5m', '5m'], ['15m', '15m'], ['1h', '1h'], ['4h', '4h'], ['1d', '1D']];
  const TAIL_MAX = 900;                // live points kept behind the history; the history itself is never evicted
  /* b was 18, which was exactly enough for nothing: there was no time axis at all, so a reader could see
     a shape without ever learning what span it covered. 46 buys a labelled axis and a rail for the
     markers that do not belong at a price. r is the price gutter. Module scope because the two drag
     strips are DOM elements laid over exactly these two margins — if they and the renderer disagreed by
     a pixel, the grab area would sit off the axis it is supposed to grab. */
  const PAD = { l: 8, r: 70, t: 12, b: 46 };
  const ZOOM_MIN = 1, ZOOM_MAX = 60;   // 1 = the whole loaded window; 60 = about a hundredth of it
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const defaultView = () => ({ x: 1, y: 1, tEnd: null });   // tEnd null = pinned to the live edge
  const isZoomed = (v) => !!v && (v.x !== 1 || v.y !== 1 || v.tEnd != null);
  const HOURS = { '5m': 12, '15m': 48, '1h': 168, '4h': 720, '1d': 720 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.prefersReduced && window.prefersReduced());

  /* ABSENT and NULL are different answers and must not share a branch. A payload with no `quoteUsd` key
     at all predates the field, and falling back to the ETH rate keeps a WETH pool — every pool on this
     chain today — rendering exactly as it did before. A payload that carries `quoteUsd: null` is the
     server saying it CANNOT value this pool's quote asset: either the pool prices in some third token,
     or our ETH rate has gone stale. Reading that as "absent" and multiplying by the ETH rate anyway is
     how a token/token ratio acquires a confident dollar sign. When there is no rate there is no dollar
     figure, and the chart says so in the pool's own units. */
  const quoteUsd = (d) => {
    if (!d) return null;
    if ('quoteUsd' in d) return d.quoteUsd;                       // null included — then nothing is in dollars
    return d.quote === 'USDG' ? 1 : (d.ethUsd || null);           // pre-quoteUsd cache entries only
  };
  /* `usd` is DOLLARS PER UNIT OF THE POOL'S QUOTE ASSET, not dollars per ETH. The two are the same on a
     WETH-quoted pool and nowhere else: a USDG-quoted pool is already priced in dollars, and multiplying
     it by the ETH rate drew the chart about three thousand times too high with a confident axis on it.
     The server now sends quoteUsd; when it is null the price cannot be valued and we say so in the
     pool's own units rather than inventing a dollar figure. */
  function fmtPrice(v, usd, sym) {
    if (!(v > 0)) return '—';
    const p = usd ? v * usd : v;
    if (!usd) return p.toExponential(3) + ' ' + (sym || 'quote');
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    // small numbers: show enough significant figures to be meaningful rather than $0.00
    const d = Math.max(2, Math.min(12, Math.ceil(-Math.log10(p)) + 3));
    return '$' + p.toFixed(d);
  }

  /* MARKET CAP = price x supply, and the supply is TODAY'S. This chain's RPC keeps no archival state
     (eth_call at a past block answers "metadata is not found"), so the supply as it stood at an old
     candle cannot be read at any price. For a fixed-supply token the figure is exact; for one that has
     minted or burned since, it is not — so the label says which supply it used rather than printing a
     market cap the site cannot stand behind. When supply is unknown we show nothing, never a zero. */
  function fmtCap(priceUsd, supply) {
    if (!(priceUsd > 0) || !(supply > 0)) return null;
    const v = priceUsd * supply;
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  }
  const fmtUsd = (v) => v == null ? '—' : (v >= 1000 ? '$' + Math.round(v).toLocaleString('en-US')
    : v >= 1 ? '$' + v.toFixed(0) : '$' + v.toFixed(2));
  // Xs, the site's own convention everywhere else: +100% is 1x
  const fmtX = (x) => x == null ? null : (x >= 0 ? '+' : '') + x.toFixed(2) + 'x';
  /* Time labels sized to the window. A 12-hour chart wants clock time; a month wants dates. Labelling
     both the same way is how an axis stops meaning anything. */
  function tickLabel(ms, spanMs) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    if (spanMs <= 36e5 * 30) return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    if (spanMs <= 864e5 * 10) return p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
  }
  const fullTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

  /* The five marker kinds. `pin` decides whether a marker sits at its own price on the line or on the
     bottom rail: a Send Call and a Sent It happened AT a price we recorded, so they belong on the line;
     a conviction play is someone joining a community, which has no price of its own. */
  const MARKERS = {
    call:       { glyph: '📣', label: 'Send Calls',      colour: '#b4ff2b', pin: 'price' },
    sent:       { glyph: '🚀', label: 'Sent Its',        colour: '#38e8ff', pin: 'price' },
    conviction: { glyph: '💠', label: 'Conviction',      colour: '#c9a6ff', pin: 'rail' },
    dev:        { glyph: '🛠️', label: 'Dev wallet',      colour: '#ffb340', pin: 'rail' },
    block0:     { glyph: '🎯', label: 'First 10 blocks', colour: '#ff2e88', pin: 'rail' },
  };
  const MARKER_ORDER = ['call', 'sent', 'conviction', 'dev', 'block0'];
  /* Which layers are on, remembered per browser. Defaults to everything on: the markers are the reason
     this chart exists rather than an embedded one, so hiding them by default would be hiding the point.
     "Clean chart" turns every layer off in one press for anyone who just wants the price. */
  function loadToggles() {
    try {
      const raw = JSON.parse(localStorage.getItem('jsi:chart-markers') || 'null');
      if (raw && typeof raw === 'object') return MARKER_ORDER.reduce((a, k) => (a[k] = raw[k] !== false, a), {});
    } catch {}
    return MARKER_ORDER.reduce((a, k) => (a[k] = true, a), {});
  }
  function saveToggles(t) { try { localStorage.setItem('jsi:chart-markers', JSON.stringify(t)); } catch {} }

  // Direction drives colour everywhere: green when the current price is at or above where the
  // window opened, red when it is below. One rule, applied to the line, the fill, the dot and the
  // readout, so the chart never contradicts itself.
  function dirOf(pts) {
    if (!pts.length) return 1;
    return pts[pts.length - 1].p >= pts[0].p ? 1 : -1;
  }

  /* The frame, with a sentence in the middle of it. Same gutter and gridlines as a real chart so the
     card does not change shape when the data arrives. */
  function drawEmpty(ctx, cv, data, W, H) {
    const css = getComputedStyle(document.documentElement);
    const axis = ((css.getPropertyValue('--text-mute') || '').trim()) || '#8a93bd';
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.t + (i / 4) * (H - PAD.t - PAD.b);
      ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(W - PAD.r, y + 0.5); ctx.stroke();
    }
    ctx.fillStyle = axis; ctx.font = '11px Rubik, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const msg = (data && (data._msg || data.note)) || 'Reading the chain…';
    // wrap by hand: canvas has no line breaking, and a one-line sentence would run under the gutter
    const words = String(msg).split(' '); const max = W - PAD.l - PAD.r - 20; const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    const cy = PAD.t + (H - PAD.t - PAD.b) / 2 - (lines.length - 1) * 8;
    lines.slice(0, 4).forEach((ln, i) => ctx.fillText(ln, (PAD.l + W - PAD.r) / 2, cy + i * 16));
    ctx.textAlign = 'start'; ctx.textBaseline = 'middle';
  }

  function draw(cv, data) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const pts = data.points || [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const W = Math.max(240, Math.round(r.width)), H = Math.max(160, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Fewer than two points is not a reason to hand back an empty rectangle. Draw the frame and say what
    // is actually going on — reading, nothing traded, or a chain we could not reach — because a blank
    // box reads as broken, and "broken" is a different claim from "this pool has had no swaps".
    if (pts.length < 2) { drawEmpty(ctx, cv, data, W, H); return; }

    const css = getComputedStyle(document.documentElement);
    const tok = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
    const up = tok('--green-bright', '#b4ff2b'), down = tok('--red', '#ff5d5d');
    const grid = 'rgba(255,255,255,0.07)', axis = tok('--text-mute', '#8a93bd');
    const dir = dirOf(pts);
    const col = dir >= 0 ? up : down;

    /* Just INSIDE the plot, not below it. The rail used to sit at H - PAD.b + 16, on top of the time
       labels — the markers collided with the axis text, and once the bottom margin became a drag strip
       they would also have stopped being hoverable. Inside the plot they sit over the area fill, which
       is dark, and the bottom margin is left to the axis and to the strip that grabs it. */
    const RAIL = H - PAD.b - 12;

    /* ---- the view ----
       The chart is drawn through a view rather than straight from the data, so dragging the time axis or
       the price gutter changes what is on screen without going back to the chain for it. view.x and
       view.y are zoom factors over the loaded window; view.tEnd is the right-hand edge, and null means
       "pinned to the live edge" so a chart nobody has touched keeps following the last trade. */
    const v = data._view || defaultView();
    const fullT0 = pts[0].t, fullT1 = pts[pts.length - 1].t || (fullT0 + 1);
    const fullSpan = Math.max(1, fullT1 - fullT0);
    const span = Math.max(1, fullSpan / clamp(v.x, ZOOM_MIN, ZOOM_MAX));
    const t1 = clamp(v.tEnd == null ? fullT1 : v.tEnd, fullT0 + span, fullT1);
    const t0 = t1 - span;
    /* Price autoscales to WHAT IS IN VIEW, then view.y stretches or compresses that around its middle.
       Scaling to the whole series instead would leave a zoomed-in window as a flat line halfway up a
       range it never reaches. */
    let lo = Infinity, hi = -Infinity;
    for (const q of pts) { if (q.t < t0 || q.t > t1) continue; if (q.p < lo) lo = q.p; if (q.p > hi) hi = q.p; }
    if (!(lo < Infinity)) { for (const q of pts) { if (q.p < lo) lo = q.p; if (q.p > hi) hi = q.p; } }
    const pad = (hi - lo) * 0.12 || hi * 0.12 || 1;
    const mid = (lo + hi) / 2;
    const half = Math.max(1e-18, ((hi - lo) / 2 + pad) / clamp(v.y, ZOOM_MIN, ZOOM_MAX));
    const yMin = Math.max(0, mid - half), yMax = mid + half;
    const px = (t) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
    const py = (val) => PAD.t + (1 - (val - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4), y = py(v);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(W - PAD.r, y + 0.5); ctx.stroke();
      ctx.fillStyle = axis; ctx.fillText(fmtPrice(v, quoteUsd(data), data.quote), W - PAD.r + 5, y);
    }

    /* Everything from here to the restore() below is clipped to the plot. Zoomed in, most of the series
       lies outside it, and without a clip the line would paint straight over the price gutter and the
       time axis. */
    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b); ctx.clip();

    // area fill under the line, in the direction colour
    ctx.beginPath();
    ctx.moveTo(px(pts[0].t), py(pts[0].p));
    for (const q of pts) ctx.lineTo(px(q.t), py(q.p));
    ctx.lineTo(px(pts[pts.length - 1].t), H - PAD.b);
    ctx.lineTo(px(pts[0].t), H - PAD.b);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
    g.addColorStop(0, dir >= 0 ? 'rgba(180,255,43,0.28)' : 'rgba(255,93,93,0.26)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px(pts[0].t), py(pts[0].p));
    for (const q of pts) ctx.lineTo(px(q.t), py(q.p));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();

    // the live end: a dot with a soft halo so "this is now" is obvious at a glance
    const lastP = pts[pts.length - 1];
    const lx = px(lastP.t), ly = py(lastP.p);
    ctx.beginPath(); ctx.arc(lx, ly, 7, 0, Math.PI * 2);
    ctx.fillStyle = dir >= 0 ? 'rgba(180,255,43,0.22)' : 'rgba(255,93,93,0.22)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();

    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(PAD.l, ly + 0.5); ctx.lineTo(W - PAD.r, ly + 0.5); ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.restore();

    /* ---- the time axis ----
       Ticks on round wall-clock boundaries, not on evenly-spaced sample indices: "14:00" is a time a
       reader recognises, "14:07" is an artefact of where the data happened to start. */
    const spanMs = (t1 - t0) * 1000;
    const STEPS = [60, 300, 900, 1800, 3600, 7200, 14400, 43200, 86400, 172800, 604800];
    const wantTicks = Math.max(2, Math.min(7, Math.floor((W - PAD.l - PAD.r) / 92)));
    const rawStep = (t1 - t0) / wantTicks;
    const step = STEPS.find(x => x >= rawStep) || STEPS[STEPS.length - 1];
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = axis; ctx.font = '10px ui-monospace, Menlo, monospace';
    for (let tt = Math.ceil(t0 / step) * step; tt <= t1; tt += step) {
      const x = px(tt);
      if (x < PAD.l + 30 || x > W - PAD.r - 30) continue;   // centred labels need half their own width of clearance
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, PAD.t); ctx.lineTo(x + 0.5, H - PAD.b); ctx.stroke();
      ctx.fillText(tickLabel(tt * 1000, spanMs), x, H - PAD.b + 4);
    }
    // the span, said once in words, because a row of clock times does not tell you it is a week
    ctx.textAlign = 'left';
    ctx.fillStyle = axis; ctx.globalAlpha = 0.8;
    ctx.fillText(tickLabel(t0 * 1000, spanMs) + ' → ' + tickLabel(t1 * 1000, spanMs) + ' UTC', PAD.l, H - 12);
    ctx.globalAlpha = 1; ctx.textAlign = 'start'; ctx.textBaseline = 'middle';

    // geometry the hover, the marker layer and the two drag strips all reuse, so there is exactly one
    // source of truth for it — including the full extent, which panning has to clamp against
    cv._geo = { W, H, PAD, RAIL, t0, t1, yMin, yMax, px, py, col, fullT0, fullT1, fullSpan, span };

    drawMarkers(ctx, cv, data);
    drawCrosshair(ctx, cv, data);
  }

  /* ---- markers ----
     Drawn after the line so they sit on top of it, and hit-boxes are recorded in the same pass so the
     pointer code never has to recompute a position the renderer already worked out. */
  function drawMarkers(ctx, cv, data) {
    const g = cv._geo; if (!g) return;
    cv._hits = [];
    const on = data._toggles || {};
    const sets = data.markers && data.markers.types;
    if (!sets) return;
    for (const kind of MARKER_ORDER) {
      if (!on[kind]) continue;
      const spec = MARKERS[kind];
      for (const m of sets[kind] || []) {
        const ts = Math.floor(m.t / 1000);
        if (ts < g.t0 || ts > g.t1) continue;
        const x = g.px(ts);
        /* Markers carry a DOLLAR price; the y-axis is in the pool's quote units. Divide before plotting,
           or a marker lands thousands of times off the top of the chart — drawn, hit-testable, and
           invisible. When the quote cannot be valued there is no conversion to make, so it goes to the
           rail rather than to a made-up height. */
        const qu = quoteUsd(data);
        const yUnits = (m.priceUsd > 0 && qu > 0) ? m.priceUsd / qu : null;
        let y = (spec.pin === 'price' && yUnits > 0) ? g.py(yUnits) : g.RAIL;
        let pinned = spec.pin !== 'price';
        /* An entry outside this window's price range would otherwise be drawn above the top edge or
           below the bottom one — present in the hit-boxes, invisible on screen, and hoverable only by
           accident. A call made at a price the visible window never reaches is a real thing that
           happened; it goes to the rail, and the card says why it is there. */
        if (!pinned && (y < g.PAD.t + 8 || y > g.H - g.PAD.b - 8)) { y = g.RAIL; pinned = true; m._offScale = true; }
        else if (!pinned) m._offScale = false;
        // a stem from the rail markers up to the line, so an event is visibly tied to a moment
        if (pinned) {
          ctx.strokeStyle = spec.colour; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(x + 0.5, g.PAD.t); ctx.lineTo(x + 0.5, y - 8); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        ctx.beginPath(); ctx.arc(x, y, m.n ? 9 : 7, 0, Math.PI * 2);
        ctx.fillStyle = spec.colour; ctx.globalAlpha = 0.18; ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = spec.colour; ctx.stroke();
        ctx.font = (m.n ? '9px' : '10px') + ' ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // a cluster shows its count rather than stacking identical glyphs nobody can separate
        ctx.fillStyle = spec.colour;
        ctx.fillText(m.n ? String(m.n) : spec.glyph, x, y + 0.5);
        ctx.textAlign = 'start'; ctx.textBaseline = 'middle';
        cv._hits.push({ x, y, r: 11, kind, m });
      }
    }
  }

  /* ---- the crosshair ----
     Follows the pointer along the series rather than floating free: the readout is about a real sample,
     so the line is drawn at the sample it is reading. */
  function drawCrosshair(ctx, cv, data) {
    const g = cv._geo, h = cv._hover;
    if (!g || !h || h.i == null) return;
    const pts = data.points || [];
    const q = pts[h.i]; if (!q) return;
    const x = g.px(q.t), y = g.py(q.p);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x + 0.5, g.PAD.t); ctx.lineTo(x + 0.5, g.H - g.PAD.b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.PAD.l, y + 0.5); ctx.lineTo(g.W - g.PAD.r, y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = g.col; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  /* ═══ the hover readout ═══════════════════════════════════════════════════════════════════════════
     A DOM tip rather than canvas text: it can be styled with the rest of the site, it can be read by a
     screen reader, and the numbers in it can be selected and copied. Positioned inside the host so it
     never escapes the card it belongs to. */
  function tipHTML(host, data, i) {
    const pts = data.points || [];
    const q = pts[i]; if (!q) return '';
    const qu = quoteUsd(data);
    const usd = qu ? q.p * qu : null;
    const cap = fmtCap(usd, data.supply);
    const last = pts[pts.length - 1];
    /* A candle is a SPAN, not an instant: its number is the last trade inside a bucket, and labelling it
       with a single clock time invites reading it as the price at that second. Live tail points (pushed
       by the poll, n === 0) really are instants, and are labelled as such. */
    const live = !q.n && q.live;
    const span = Number(data.tfSec) || 0;
    const title = live ? fullTime(q.t * 1000) + ' · live'
      : span ? fullTime(q.t * 1000) + ' → ' + hhmm((q.t + span) * 1000) + (i === pts.length - 1 ? ' · still open' : '')
      : fullTime(q.t * 1000);
    // the move from here to now, which needs neither a dollar rate nor a supply to be true
    const mult = (i < pts.length - 1 && q.p > 0 && last && last.p > 0) ? fmtX(last.p / q.p - 1) : null;
    const hiLo = (!live && q.n > 0 && q.h > 0 && q.l > 0 && q.h !== q.l)
      ? esc(fmtPrice(q.h, qu, data.quote)) + ' / ' + esc(fmtPrice(q.l, qu, data.quote)) : null;
    /* Why there may be no dollar figure, said plainly rather than left as a dash. The two reasons are
       different and a reader can act on the difference: one is our rate being old, the other is a pool we
       have no way to value at all. */
    const noUsd = qu != null ? '' : '<div class="oc-tip-note">' + (data.quote === 'WETH'
      ? 'No dollar price right now — our ETH/USD rate is more than ten minutes old, so the chart is in WETH until it refreshes.'
      : 'No dollar price — this pool prices in a token we can’t value, so everything here is in pool units and there is no market cap.') + '</div>';
    return '<div class="oc-tip-t">' + esc(title) + '</div>' +
      '<div class="oc-tip-row"><span>' + (live ? 'Price' : 'Close') + '</span><b>' + esc(fmtPrice(q.p, qu, data.quote)) + '</b></div>' +
      (hiLo ? '<div class="oc-tip-row oc-tip-dim"><span>High / low</span><b>' + hiLo + '</b></div>' : '') +
      (mult ? '<div class="oc-tip-row"><span>Since then</span><b class="' + (last.p >= q.p ? 'oc-up' : 'oc-dn') + '">' + esc(mult) + '</b></div>' : '') +
      (cap ? '<div class="oc-tip-row"><span>Market cap</span><b>≈' + esc(cap) + '</b></div>'
           : qu != null ? '<div class="oc-tip-row oc-tip-dim"><span>Market cap</span><b>not known</b></div>' : '') +
      (q.n ? '<div class="oc-tip-row oc-tip-dim"><span>Swaps in this candle</span><b>' + q.n + '</b></div>' : '') +
      noUsd +
      (cap ? '<div class="oc-tip-note">Market cap is this price × today’s supply' +
        (data.supply ? ' (' + Math.round(data.supply).toLocaleString('en-US') + ' tokens' +
          (data.supplyAsOf ? ', read ' + esc(hhmm(data.supplyAsOf)) + ' UTC' : '') + ')' : '') +
        '. This chain keeps no archival state, so the supply as it stood then can’t be read — if the token has minted or burned since, this figure is wrong.</div>'
        : (qu != null && !data.supply) ? '<div class="oc-tip-note">We couldn’t read this token’s total supply, so there is no market cap to show.</div>' : '');
  }
  /* A marker's card. Everything in it is already public on the call card and the Senders list, and it is
     shown at the same rounding — the server rounds anyone's figures but their own, and this never asks
     for more than the server is willing to send. */
  function markerHTML(hit, data) {
    const { kind, m } = hit, spec = MARKERS[kind];
    /* The dollar move on a position, and only ever on your own: the server sends `pnlUsd` for your rows
       and null for everyone else's, because every other row's stake is already rounded to two figures
       and a dollar PNL derived from it would wear a precision it does not have. */
    const pnl = (x) => x.pnlUsd == null ? ''
      : ' · <span class="' + (x.pnlUsd >= 0 ? 'oc-up' : 'oc-dn') + '">' +
        (x.pnlUsd >= 0 ? '+' : '−') + esc(fmtUsd(Math.abs(x.pnlUsd))) + '</span> on paper';
    const one = (x) => {
      if (kind === 'call') return '<b>@' + esc(x.who) + '</b> called it' +
        (x.usd ? ' with ' + esc(fmtUsd(x.usd)) + ' in' : '') +
        (x.mc > 0 ? ' at ' + esc(fmtCap(x.mc, 1) || '—') + ' market cap' : '') +
        (x.x != null ? ' · <span class="' + (x.x >= 0 ? 'oc-up' : 'oc-dn') + '">' + esc(fmtX(x.x)) + '</span> since' : '') + pnl(x);
      if (kind === 'sent') return '<b>@' + esc(x.who) + '</b> sent it' +
        (x.usd ? ' with ' + esc(fmtUsd(x.usd)) + ' in' : '') +
        (x.mc > 0 ? ' at ' + esc(fmtCap(x.mc, 1) || '—') + ' market cap' : '') +
        (x.x != null ? ' · <span class="' + (x.x >= 0 ? 'oc-up' : 'oc-dn') + '">' + esc(fmtX(x.x)) + '</span>' : '') + pnl(x) +
        (x.holding === false ? ' · sold out' : '');
      if (kind === 'conviction') return '<b>@' + esc(x.who) + '</b> joined the $' + esc(x.community || '') + ' community — verified holder';
      if (kind === 'dev') return '<b>Deployer</b> ' + (x.side === 'buy' ? 'bought' : 'sold') +
        (x.tokens ? ' ' + Math.round(x.tokens).toLocaleString('en-US') + ' tokens' : '');
      if (kind === 'block0') return '<b>' + esc(x.addr) + '</b> bought in the first ' + ((x.blocksAfterZero || 0) + 1) + ' block' + ((x.blocksAfterZero || 0) === 0 ? '' : 's') +
        (x.tookPct != null ? ' · took ' + x.tookPct.toFixed(2) + '% of supply' : '') +
        (x.sold ? ' · <span class="oc-dn">sold out</span>' : (x.holdsPct != null ? ' · still holds ' + x.holdsPct.toFixed(2) + '%' : ''));
      return '';
    };
    const rows = m.members ? m.members : [m];
    const rounded = rows.some(r => r.rounded);
    return '<div class="oc-tip-t">' + spec.glyph + ' ' + esc(spec.label) + ' · ' + esc(fullTime(m.t)) + '</div>' +
      (m.n ? '<div class="oc-tip-row oc-tip-dim"><span>' + m.n + ' in this moment</span><b>showing ' + rows.length + '</b></div>' : '') +
      '<ul class="oc-tip-list">' + rows.map(r => '<li>' + one(r) + '</li>').join('') + '</ul>' +
      /* Kept SHORT on purpose: a card that covers the chart it is describing is worse than one that says
         less. Each of these is load-bearing — where the number came from, and what it is not. */
      (rounded ? '<div class="oc-tip-note">Rounded to two figures — exact only for the person it belongs to.</div>' : '') +
      (m._offScale ? '<div class="oc-tip-note">Entry is outside this window’s price range — pinned to the rail.</div>' : '') +
      (kind === 'sent' || kind === 'call'
        ? '<div class="oc-tip-note">Size read from their linked wallets, read-only. The x is the move from their own entry; the market cap is the one captured then. Measurements, not advice.</div>' : '');
  }
  /* The tip belongs to .oc-plot, not to the host. x and y arrive in CANVAS coordinates, and .oc-plot is
     the only ancestor that is both positioned and exactly the canvas's box — appending to the host put
     the tip in whatever card happened to be the nearest positioned ancestor instead, which floated it a
     couple of hundred pixels above the chart, over the buttons of the card above. */
  function showTip(host, html, x, y, wide) {
    const plot = host.querySelector('.oc-plot') || host;
    let tip = plot.querySelector('.oc-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'oc-tip'; tip.setAttribute('role', 'status'); plot.appendChild(tip); }
    tip.innerHTML = html;
    tip.classList.toggle('is-wide', !!wide);
    tip.hidden = false;
    /* Horizontally it is confined to the plot — a card hanging off the side of a chart in a list is worse
       than no card. Vertically it is allowed to spill past the canvas and over the legend below, because
       a card tall enough to need that is better read across the legend than squashed onto the price it is
       annotating. The limit is the CARD, which it never leaves. */
    const pb = plot.getBoundingClientRect(), hb = host.getBoundingClientRect(), tb = tip.getBoundingClientRect();
    const dy = pb.top - hb.top;                     // where the plot sits inside the card
    let left = x + 14;
    if (left + tb.width > pb.width - 6) left = Math.max(6, x - tb.width - 14);
    let top = y - tb.height - 12;
    if (top < 4) top = y + 18;
    top = Math.min(top, hb.height - dy - tb.height - 4);
    top = Math.max(top, -dy + 4);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }
  function hideTip(host) { const t = host.querySelector('.oc-tip'); if (t) t.hidden = true; }

  /* Pointer handling. Markers win over the price readout when the pointer is on one, because a marker is
     the more specific thing the person is pointing at. */
  function wirePointer(host) {
    const cv = host.querySelector('canvas');
    if (!cv || cv._ptr) return;
    cv._ptr = true;
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const move = (e) => {
      const d = host._data; if (!d || !cv._geo) return;
      if (cv._panning) return;              // a pan is a different gesture; it owns the pointer while it lasts
      const { x, y } = at(e);
      const hit = (cv._hits || []).find(h => Math.hypot(h.x - x, h.y - y) <= h.r);
      if (hit) {
        cv._hover = null; paint(host, true);
        showTip(host, markerHTML(hit, d), hit.x, hit.y, true);
        cv.style.cursor = 'pointer';
        return;
      }
      cv.style.cursor = 'crosshair';
      const pts = d.points || [];
      if (pts.length < 2) return;
      const g = cv._geo;
      const tGuess = g.t0 + ((x - g.PAD.l) / Math.max(1, g.W - g.PAD.l - g.PAD.r)) * (g.t1 - g.t0);
      // nearest sample, so the readout is always a real number and never an interpolation
      let i = 0, best = Infinity;
      for (let k = 0; k < pts.length; k++) { const dd = Math.abs(pts[k].t - tGuess); if (dd < best) { best = dd; i = k; } }
      /* The loop above always returns SOMETHING, so a pointer in the price gutter past the last candle was
         being answered with that candle's numbers as though it were pointing at them. Inside the plot the
         snap is fine and visible — the crosshair moves to the candle being read and the card names its
         time — but outside it there is nothing to read at all. Bound by the PLOT, not by distance to the
         nearest sample: a thinly-traded pool has real gaps between candles, and a distance rule turns
         those gaps into dead chart. */
      if (x < g.PAD.l - 4 || x > g.W - g.PAD.r + 4) { cv._hover = null; hideTip(host); paint(host, true); return; }
      cv._hover = { i };
      paint(host, true);
      showTip(host, tipHTML(host, d, i), g.px(pts[i].t), g.py(pts[i].p), false);
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', () => { cv._hover = null; hideTip(host); paint(host, true); cv.style.cursor = ''; });
  }

  /* ═══ the two scales, and panning ═══════════════════════════════════════════════════════════════
     Zoom is a VIEW over data already loaded, not a new request: dragging the time axis does not go back
     to the chain, it changes which slice of the window the same points are drawn across. That keeps the
     gesture instant and costs the server nothing, and it is why the zoom stops at the edges of what was
     fetched rather than pretending to go further.

     Exponential, not linear: a fixed number of pixels should mean the same PROPORTIONAL change whether
     you are looking at a week or at ten minutes, which is what makes a drag feel like a scale rather
     than a slider. A full plot-width drag is about one e-fold either way.

     Panning lives on the canvas and only exists once you are zoomed in — with the whole window on screen
     there is nothing to pan to, and a drag that does nothing reads as a broken control. Let go at the
     live edge and the view re-pins itself there, so a chart left alone goes back to following the last
     trade instead of drifting quietly into the past. */
  const ZOOM_RATE = 2.2;
  function wireScales(host) {
    const cv = host.querySelector('canvas');
    const plot = host.querySelector('.oc-plot');
    if (!cv || !plot || plot._scales) return;
    plot._scales = true;
    const view = () => host._view || (host._view = defaultView());
    const redraw = () => paint(host, true);

    for (const g of plot.querySelectorAll('.oc-grab')) {
      const axis = g.dataset.grab;
      let from = null;
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { g.setPointerCapture(e.pointerId); } catch {}
        from = { x: e.clientX, y: e.clientY, z: axis === 'x' ? view().x : view().y };
        g.classList.add('is-dragging');
        hideTip(host);
      });
      g.addEventListener('pointermove', (e) => {
        if (!from) return;
        // right stretches time, up stretches price — in both cases, away from where the scale's small end is
        const reach = Math.max(80, axis === 'x' ? plot.clientWidth : plot.clientHeight);
        const d = axis === 'x' ? (e.clientX - from.x) : (from.y - e.clientY);
        const z = clamp(from.z * Math.exp((d / reach) * ZOOM_RATE), ZOOM_MIN, ZOOM_MAX);
        if (axis === 'x') view().x = z; else view().y = z;
        redraw();
      });
      const end = (e) => {
        if (!from) return;
        from = null; g.classList.remove('is-dragging');
        try { g.releasePointerCapture(e.pointerId); } catch {}
      };
      g.addEventListener('pointerup', end);
      g.addEventListener('pointercancel', end);
      // the same control from the keyboard, because a drag is not available to everybody
      g.addEventListener('keydown', (e) => {
        const k = e.key;
        const step = (up) => {
          const z = clamp((axis === 'x' ? view().x : view().y) * (up ? 1.25 : 0.8), ZOOM_MIN, ZOOM_MAX);
          if (axis === 'x') view().x = z; else view().y = z;
          redraw();
        };
        if (axis === 'x' && (k === 'ArrowRight' || k === 'ArrowUp')) step(true);
        else if (axis === 'x' && (k === 'ArrowLeft' || k === 'ArrowDown')) step(false);
        else if (axis === 'y' && (k === 'ArrowUp' || k === 'ArrowRight')) step(true);
        else if (axis === 'y' && (k === 'ArrowDown' || k === 'ArrowLeft')) step(false);
        else if (k === 'Home' || k === 'Escape') { host._view = defaultView(); redraw(); }
        else return;
        e.preventDefault();
      });
    }

    // panning: only meaningful once the window no longer fits on screen
    let pan = null;
    cv.addEventListener('pointerdown', (e) => {
      const g = cv._geo; if (!g || view().x <= 1) return;
      pan = { x: e.clientX, t1: g.t1, moved: false };
      try { cv.setPointerCapture(e.pointerId); } catch {}
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pan) return;
      const g = cv._geo; if (!g) return;
      const dx = e.clientX - pan.x;
      if (!pan.moved && Math.abs(dx) < 4) return;       // a click is not a pan
      pan.moved = true;
      cv._panning = true;                               // the hover handler stands down while this is true
      cv.style.cursor = 'grabbing';
      hideTip(host); cv._hover = null;
      const perPx = g.span / Math.max(1, g.W - PAD.l - PAD.r);
      const t1 = clamp(pan.t1 - dx * perPx, g.fullT0 + g.span, g.fullT1);
      view().tEnd = (t1 >= g.fullT1 - 1) ? null : t1;   // back at the live edge: follow it again
      redraw();
    }, true);
    const endPan = (e) => {
      if (!pan) return;
      pan = null; cv._panning = false; cv.style.cursor = '';
      try { cv.releasePointerCapture(e.pointerId); } catch {}
    };
    cv.addEventListener('pointerup', endPan);
    cv.addEventListener('pointercancel', endPan);
    cv.addEventListener('dblclick', () => { host._view = defaultView(); redraw(); });

    const reset = plot.querySelector('.oc-reset');
    if (reset) reset.addEventListener('click', () => { host._view = defaultView(); redraw(); });
  }

  /* ═══ markers: fetch ═══
     One request per chart per timeframe change, not per tick. Charts appear in lists, so this is behind
     the same visibility gate the price poll uses: a chart nobody is looking at asks for nothing. */
  async function loadMarkers(host) {
    const d = host._data; if (!d) return;
    const pts = d.points || []; if (!pts.length) return;
    /* Deliberately WIDER than the chart draws. A 5m chart covers twelve hours, and on a token whose
       calls are three days old it would come back empty and the legend would say "none in this window" —
       true, and useless. Asking for the server's full clamp instead lets the legend say "2 ↔ outside this
       timeframe, widen the window", which is the thing a reader can act on. Everything beyond t0..t1 is
       counted and never drawn. Same indexed reads either way. */
    const to = Date.now();
    // The deployer layer is the only one that costs the server a chain read, so it is only asked for
    // when it is switched on — and re-asked once, the moment somebody switches it on.
    const wantDev = !!(host._toggles && host._toggles.dev);
    try {
      const m = await fetch('/api/chart/markers?token=' + encodeURIComponent(host.dataset.token) +
        '&pair=' + encodeURIComponent(host.dataset.pair) + '&to=' + to +
        '&tf=' + encodeURIComponent(host.dataset.tf || '1h') + (wantDev ? '&dev=1' : ''),
        { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null);
      if (m && m.types) { d.markers = m; host._devLoaded = wantDev; paint(host); renderLegend(host); }
    } catch { /* markers are an enhancement; a chart without them is still a chart */ }
  }

  /* ═══ the toggle row ═══ */
  function renderLegend(host) {
    const bar = host.querySelector('.oc-legend'); if (!bar) return;
    const d = host._data, sets = (d && d.markers && d.markers.types) || {};
    const notes = (d && d.markers && d.markers.notes) || {};
    const on = host._toggles;
    const pts = (d && d.points) || [];
    const t0 = pts.length ? pts[0].t * 1000 : 0, t1 = pts.length ? pts[pts.length - 1].t * 1000 : Date.now();
    // in-window only: this number has to agree with what is actually drawn on the canvas
    const count = (k) => (sets[k] || []).filter(m => m.t >= t0 && m.t <= t1).reduce((a, m) => a + (m.n || 1), 0);
    // Events the server found but this timeframe does not reach. A pool's first ten blocks are months
    // old on an established token, so "0" on a 7-day chart would read as "nobody sniped this" — which is
    // a different claim entirely, and not one we can make.
    const outside = (k) => (sets[k] || []).filter(m => m.t < t0 || m.t > t1).reduce((a, m) => a + (m.n || 1), 0);
    const anyOn = MARKER_ORDER.some(k => on[k]);
    bar.innerHTML = MARKER_ORDER.map(k => {
      const n = count(k), out = outside(k), note = notes[k === 'block0' ? 'chain' : k] || notes[k];
      const title = note ? note
        : n ? n + ' on this chart'
        : out ? out + ' — but outside this timeframe. Widen the window to see ' + (out === 1 ? 'it' : 'them') + '.'
        : 'none in this window';
      return '<button class="oc-mk' + (on[k] ? ' is-on' : '') + (n ? '' : ' is-empty') + '" type="button" data-mk="' + k + '"' +
        ' aria-pressed="' + !!on[k] + '" title="' + esc(title) + '">' +
        '<span class="oc-mk-g" aria-hidden="true">' + MARKERS[k].glyph + '</span>' + esc(MARKERS[k].label) +
        (n ? '<span class="oc-mk-n">' + n + '</span>' : out ? '<span class="oc-mk-n oc-mk-out">' + out + '↔</span>' : '') + '</button>';
    }).join('') +
      '<button class="oc-mk oc-mk-clean" type="button" data-mk="__clean" title="Hide every marker and just show the price">' +
      (anyOn ? '🧹 Clean chart' : '↩︎ Show markers') + '</button>';
  }

  function summarise(data) {
    const pts = data.points || [];
    if (!pts.length) return data.note || 'No trades to chart yet.';
    const first = pts[0].p, last = pts[pts.length - 1].p;
    const chg = first > 0 ? ((last - first) / first) * 100 : 0;
    return fmtPrice(last, quoteUsd(data), data.quote) + ' — ' + (chg >= 0 ? 'up ' : 'down ') + Math.abs(chg).toFixed(2) +
      '% over this window, from ' + data.swaps + (data.swaps === 1 ? ' on-chain swap' : ' on-chain swaps') + '.';
  }

  function tableHTML(data) {
    const pts = (data.points || []).slice(-40).reverse();
    if (!pts.length) return '';
    return '<table class="oc-table"><caption class="sr-only">Recent prices for this pair, newest first</caption>' +
      '<thead><tr><th scope="col">Time (UTC)</th><th scope="col">Price</th><th scope="col">Swaps</th></tr></thead><tbody>' +
      pts.map(q => {
        const t = new Date(q.t * 1000).toISOString().slice(5, 16).replace('T', ' ');
        return '<tr><td>' + t + '</td><td>' + esc(fmtPrice(q.p, quoteUsd(data), data.quote)) + '</td><td>' + (q.n || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // History becomes a point series; the live poll appends to the same series, so the line is one
  // continuous thing rather than a chart with a separate "live" gadget bolted on.
  function pointsFromCandles(cs) { return (cs || []).map(c => ({ t: c.t, p: c.c, n: c.n, h: c.h, l: c.l })); }

  async function load(host) {
    const pair = host.dataset.pair, token = host.dataset.token;
    if (!pair || !token) return;
    const tf = host.dataset.tf || '1h';
    host._view = defaultView();          // a new timeframe is a new window — it starts where it fits
    const status = host.querySelector('.oc-status');
    const cv = host.querySelector('canvas');
    status.textContent = 'Reading the chain…';
    // something on the canvas while the chain is being read, rather than an empty box that reads as broken
    host._data = host._data || { points: [] };
    host._data._msg = 'Reading the chain…';
    if ((host._data.points || []).length < 2) paint(host, true);
    try {
      const d = await fetch('/api/chart?pair=' + encodeURIComponent(pair) + '&token=' + encodeURIComponent(token) +
        '&tf=' + encodeURIComponent(tf) + '&hours=' + (HOURS[tf] || 168), { credentials: 'same-origin' }).then(r => r.json());
      if (d.error) { status.textContent = '⚠️ ' + d.error; host._data._msg = d.error; paint(host, true); return; }
      d.points = pointsFromCandles(d.candles);
      d._msg = d.note || 'No swaps on this pool in this window. The pool exists; nobody traded it.';
      /* How many of those points are HISTORY. The live tick appends behind this line and only ever
         trims what it appended — see TAIL_MAX. */
      host._hist = d.points.length;
      host._data = d;
      paint(host);
      const tbl = host.querySelector('.oc-table-wrap');
      if (tbl) tbl.innerHTML = tableHTML(d);
      wirePointer(host);
      wireScales(host);
      renderLegend(host);
      loadMarkers(host);
      startTicking(host);
    } catch {
      status.textContent = '⚠️ Could not read the chain right now.';
      host._data._msg = 'Could not read the chain right now — the explorer link above still works.';
      paint(host, true);
    }
  }

  function paint(host, hoverOnly) {
    const d = host._data; if (!d) return;
    const cv = host.querySelector('canvas');
    d._toggles = host._toggles;          // draw() reads these to decide which marker layers to render
    d._view = host._view || (host._view = defaultView());
    draw(cv, d);
    const rb = host.querySelector('.oc-reset');
    if (rb) rb.hidden = !isZoomed(host._view);
    if (hoverOnly) return;               // a crosshair repaint must not redo the status line and the table
    const sum = summarise(d);
    host.querySelector('.oc-status').textContent = sum;
    cv.setAttribute('aria-label', sum);
    const pts = d.points || [];
    const dir = pts.length ? dirOf(pts) : 1;
    host.classList.toggle('is-up', dir >= 0);
    host.classList.toggle('is-down', dir < 0);
    const live = host.querySelector('.oc-live');
    if (live && pts.length) {
      const last = pts[pts.length - 1].p;
      live.textContent = fmtPrice(last, quoteUsd(d), d.quote);
      live.classList.remove('tick'); void live.offsetWidth; if (!reduced()) live.classList.add('tick');
    }
  }

  /* ---------- the 1-second live tick ----------
     Polls a spot-price endpoint that costs ONE eth_call and is coalesced+cached server-side, not the
     full history endpoint. Stops entirely when the tab is hidden or the chart scrolls out of view,
     because a chart nobody is looking at should not be polling anything. */
  function startTicking(host) {
    stopTicking(host);
    const pair = host.dataset.pair, token = host.dataset.token;
    let missed = 0;
    const tick = async () => {
      if (document.hidden || !host.isConnected || !host._visible) return;
      try {
        const res = await fetch('/api/price?pair=' + encodeURIComponent(pair) + '&token=' + encodeURIComponent(token),
          { credentials: 'same-origin' });
        const r = await res.json().catch(() => null);
        if (res.ok && r && r.price > 0 && host._data) {
          missed = 0;
          const pts = host._data.points;
          const t = Math.floor((r.at || Date.now()) / 1000);
          const last = pts[pts.length - 1];
          if (last && t - last.t < 1) { last.p = r.price; }   // same second — update in place
          else pts.push({ t, p: r.price, n: 0, live: true });
          /* Bound the LIVE TAIL, not the series. This was `splice(0, …)`, which evicts from the FRONT —
             so once the buffer filled (about twelve minutes on a 1h chart) every further tick deleted a
             history candle. The window silently shrank to the last few minutes while the timeframe
             button still said 1h, the summary and the table narrowed with it, and every marker older
             than the surviving head was dropped by the `ts < t0` test without a word. */
          const head = host._hist || 0;
          if (pts.length > head + TAIL_MAX) pts.splice(head, pts.length - head - TAIL_MAX);
          if (r.ethUsd) host._data.ethUsd = r.ethUsd;
          if (r.quoteUsd !== undefined) host._data.quoteUsd = r.quoteUsd;   // null is an answer: no dollars
          if (r.quote) host._data.quote = r.quote;
          paint(host);
        } else if (++missed === 3) {
          /* Three in a row is an outage, not a blip. A 429 body carries `error`, not `why`, so the old
             shape matched neither branch: `missed` never moved, the green live chip stayed lit, and the
             chart quietly stopped updating while still claiming to be live. */
          host.querySelector('.oc-status').textContent = res.status === 429
            ? '⚠️ Live price paused — too many requests from this network. The history below is still on-chain.'
            : '⚠️ Live price paused: ' + ((r && (r.why || r.error)) || 'chain read failed') + '.';
        }
      } catch { if (++missed === 3) host.querySelector('.oc-status').textContent = '⚠️ Live price paused — connection trouble.'; }
    };
    /* Charts on a page that is mostly read, rather than watched, can say so with data-poll. Two charts
       polling once a second is 120 requests a minute from one visitor against a 240/min bucket — the
       landing page asks for 5s instead, and the chip below the chart is written to match. */
    host._tick = setInterval(tick, Math.max(1000, Number(host.dataset.poll) || 1000));
    tick();
  }
  function stopTicking(host) { if (host._tick) { clearInterval(host._tick); host._tick = null; } }

  // One public entry point. Anywhere that used to embed a third-party chart calls this instead.
  window.renderOnChainChart = function (host) {
    if (!host || host._wired) { if (host && host._wired) load(host); return; }
    host._wired = true;
    host.innerHTML =
      '<div class="oc-head">' +
        '<div class="oc-tfs" role="tablist" aria-label="Chart timeframe">' +
          TF.map(([k, lbl]) => '<button class="oc-tf' + (k === (host.dataset.tf || '1h') ? ' is-on' : '') +
            '" type="button" role="tab" aria-selected="' + (k === (host.dataset.tf || '1h')) + '" data-tf="' + k + '">' + lbl + '</button>').join('') +
        '</div>' +
        '<span class="oc-live" aria-live="off"></span>' +
        '<span class="oc-src" title="History from this pair contract&#39;s own Swap events; the live price from its reserves, every ' +
          Math.round(Math.max(1000, Number(host.dataset.poll) || 1000) / 1000) + 's">⛓️ on-chain · live</span>' +
      '</div>' +
      '<div class="oc-plot">' +
        '<canvas class="oc-canvas" role="img" aria-label="Price chart"></canvas>' +
        /* The two scales are real controls, not decoration on the canvas: a button each, laid exactly over
           the margins the renderer reserves for them, so they can be dragged, tabbed to and driven from
           the keyboard. They are also the only elements here with touch-action:none — the canvas keeps
           pan-y so a phone can still scroll the page by dragging over the chart. */
        '<button class="oc-grab oc-grab-x" type="button" data-grab="x"' +
          ' aria-label="Time scale. Drag right to stretch time and see less of it, left to fit more in. Arrow keys also work; press Home to fit the window."' +
          ' title="Drag to stretch or compress time"><span>↔</span></button>' +
        '<button class="oc-grab oc-grab-y" type="button" data-grab="y"' +
          ' aria-label="Price scale. Drag up to stretch the price range and see it in more detail, down to fit more in. Arrow keys also work; press Home to fit the window."' +
          ' title="Drag to stretch or compress the price scale"><span>↕</span></button>' +
        '<button class="oc-reset" type="button" hidden>↺ Fit</button>' +
      '</div>' +
      '<div class="oc-legend" role="group" aria-label="Which markers to show"></div>' +
      '<p class="oc-status" role="status" aria-live="polite"></p>' +
      '<details class="oc-data"><summary>View the numbers</summary><div class="oc-table-wrap"></div></details>';
    host._toggles = loadToggles();
    host.addEventListener('click', (e) => {
      const b = e.target.closest('.oc-tf');
      if (b) {
        host.dataset.tf = b.dataset.tf;
        host.querySelectorAll('.oc-tf').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
        load(host);
        return;
      }
      const mk = e.target.closest('.oc-mk');
      if (!mk) return;
      const k = mk.dataset.mk;
      if (k === '__clean') {
        // one press for "just the price", and the same press to bring it all back
        const anyOn = MARKER_ORDER.some(x => host._toggles[x]);
        MARKER_ORDER.forEach(x => { host._toggles[x] = !anyOn; });
      } else host._toggles[k] = !host._toggles[k];
      saveToggles(host._toggles);
      renderLegend(host);
      paint(host, true);
      // the deployer layer is fetched on demand, so switching it on for the first time has to go and get it
      if (host._toggles.dev && !host._devLoaded) loadMarkers(host);
    });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (host._data) paint(host); }, 150); });
    // Only a chart actually on screen polls. Without this, every collapsed detail body on a long
    // list would hammer the endpoint once a second each.
    host._visible = true;
    if ('IntersectionObserver' in window) {
      host._visible = false;
      new IntersectionObserver((es) => { host._visible = es.some(e => e.isIntersecting); }, { rootMargin: '120px' }).observe(host);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && host._data) paint(host); });
    load(host);
  };

  // auto-mount anything already on the page
  function mountAll(root) { (root || document).querySelectorAll('.onchain-chart:not([data-mounted])').forEach(h => { h.setAttribute('data-mounted', '1'); window.renderOnChainChart(h); }); }
  window.mountOnChainCharts = mountAll;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll()); else mountAll();
})();
