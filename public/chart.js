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
  const HOURS = { '5m': 12, '15m': 48, '1h': 168, '4h': 720, '1d': 720 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.prefersReduced && window.prefersReduced());

  function fmtPrice(v, usd) {
    if (!(v > 0)) return '—';
    const p = usd ? v * usd : v;
    if (!usd) return p.toExponential(3) + ' ETH';
    if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 4 });
    // small numbers: show enough significant figures to be meaningful rather than $0.00
    const d = Math.max(2, Math.min(12, Math.ceil(-Math.log10(p)) + 3));
    return '$' + p.toFixed(d);
  }

  // Direction drives colour everywhere: green when the current price is at or above where the
  // window opened, red when it is below. One rule, applied to the line, the fill, the dot and the
  // readout, so the chart never contradicts itself.
  function dirOf(pts) {
    if (!pts.length) return 1;
    return pts[pts.length - 1].p >= pts[0].p ? 1 : -1;
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
    if (pts.length < 2) return;

    const css = getComputedStyle(document.documentElement);
    const tok = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
    const up = tok('--green-bright', '#b4ff2b'), down = tok('--red', '#ff5d5d');
    const grid = 'rgba(255,255,255,0.07)', axis = tok('--text-mute', '#8a93bd');
    const dir = dirOf(pts);
    const col = dir >= 0 ? up : down;

    const PAD = { l: 8, r: 70, t: 12, b: 18 };
    let lo = Infinity, hi = -Infinity;
    for (const q of pts) { if (q.p < lo) lo = q.p; if (q.p > hi) hi = q.p; }
    const pad = (hi - lo) * 0.12 || hi * 0.12 || 1;
    const yMin = Math.max(0, lo - pad), yMax = hi + pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || (t0 + 1);
    const px = (t) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
    const py = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4), y = py(v);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(W - PAD.r, y + 0.5); ctx.stroke();
      ctx.fillStyle = axis; ctx.fillText(fmtPrice(v, data.ethUsd), W - PAD.r + 5, y);
    }

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
  }

  function summarise(data) {
    const pts = data.points || [];
    if (!pts.length) return data.note || 'No trades to chart yet.';
    const first = pts[0].p, last = pts[pts.length - 1].p;
    const chg = first > 0 ? ((last - first) / first) * 100 : 0;
    return fmtPrice(last, data.ethUsd) + ' — ' + (chg >= 0 ? 'up ' : 'down ') + Math.abs(chg).toFixed(2) +
      '% over this window, from ' + data.swaps + (data.swaps === 1 ? ' on-chain swap' : ' on-chain swaps') + '.';
  }

  function tableHTML(data) {
    const pts = (data.points || []).slice(-40).reverse();
    if (!pts.length) return '';
    return '<table class="oc-table"><caption class="sr-only">Recent prices for this pair, newest first</caption>' +
      '<thead><tr><th scope="col">Time (UTC)</th><th scope="col">Price</th><th scope="col">Swaps</th></tr></thead><tbody>' +
      pts.map(q => {
        const t = new Date(q.t * 1000).toISOString().slice(5, 16).replace('T', ' ');
        return '<tr><td>' + t + '</td><td>' + esc(fmtPrice(q.p, data.ethUsd)) + '</td><td>' + (q.n || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // History becomes a point series; the live poll appends to the same series, so the line is one
  // continuous thing rather than a chart with a separate "live" gadget bolted on.
  function pointsFromCandles(cs) { return (cs || []).map(c => ({ t: c.t, p: c.c, n: c.n })); }

  async function load(host) {
    const pair = host.dataset.pair, token = host.dataset.token;
    if (!pair || !token) return;
    const tf = host.dataset.tf || '1h';
    const status = host.querySelector('.oc-status');
    const cv = host.querySelector('canvas');
    status.textContent = 'Reading the chain…';
    try {
      const d = await fetch('/api/chart?pair=' + encodeURIComponent(pair) + '&token=' + encodeURIComponent(token) +
        '&tf=' + encodeURIComponent(tf) + '&hours=' + (HOURS[tf] || 168), { credentials: 'same-origin' }).then(r => r.json());
      if (d.error) { status.textContent = '⚠️ ' + d.error; return; }
      d.points = pointsFromCandles(d.candles);
      host._data = d;
      paint(host);
      const tbl = host.querySelector('.oc-table-wrap');
      if (tbl) tbl.innerHTML = tableHTML(d);
      startTicking(host);
    } catch { status.textContent = '⚠️ Could not read the chain right now.'; }
  }

  function paint(host) {
    const d = host._data; if (!d) return;
    const cv = host.querySelector('canvas');
    draw(cv, d);
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
      live.textContent = fmtPrice(last, d.ethUsd);
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
        const r = await fetch('/api/price?pair=' + encodeURIComponent(pair) + '&token=' + encodeURIComponent(token),
          { credentials: 'same-origin' }).then(x => x.json());
        if (r && r.price > 0 && host._data) {
          missed = 0;
          const pts = host._data.points;
          const t = Math.floor((r.at || Date.now()) / 1000);
          const last = pts[pts.length - 1];
          if (last && t - last.t < 1) { last.p = r.price; }   // same second — update in place
          else pts.push({ t, p: r.price, n: 0 });
          // keep the window bounded so a chart left open all day cannot grow without limit
          if (pts.length > 900) pts.splice(0, pts.length - 900);
          if (r.ethUsd) host._data.ethUsd = r.ethUsd;
          paint(host);
        } else if (r && r.why) {
          // three misses in a row is a real outage, not a blip — say so instead of freezing silently
          if (++missed === 3) host.querySelector('.oc-status').textContent = '⚠️ Live price paused: ' + r.why + '.';
        }
      } catch { if (++missed === 3) host.querySelector('.oc-status').textContent = '⚠️ Live price paused — connection trouble.'; }
    };
    host._tick = setInterval(tick, 1000);
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
        '<span class="oc-src" title="Built from this pair contract&#39;s own Swap events">⛓️ on-chain · live</span>' +
      '</div>' +
      '<canvas class="oc-canvas" role="img" aria-label="Price chart"></canvas>' +
      '<p class="oc-status" role="status" aria-live="polite"></p>' +
      '<details class="oc-data"><summary>View the numbers</summary><div class="oc-table-wrap"></div></details>';
    host.addEventListener('click', (e) => {
      const b = e.target.closest('.oc-tf');
      if (!b) return;
      host.dataset.tf = b.dataset.tf;
      host.querySelectorAll('.oc-tf').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
      load(host);
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
