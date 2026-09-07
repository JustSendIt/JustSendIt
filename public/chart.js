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

  function draw(cv, data) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const cs = data.candles || [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const W = Math.max(240, Math.round(r.width)), H = Math.max(160, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!cs.length) return;

    const css = getComputedStyle(document.documentElement);
    const tok = (n, f) => (css.getPropertyValue(n) || '').trim() || f;
    const up = tok('--green-bright', '#b4ff2b'), down = tok('--red', '#ff5d5d');
    const grid = 'rgba(255,255,255,0.07)', axis = tok('--text-mute', '#8a93bd');

    const PAD = { l: 8, r: 66, t: 12, b: 20 };
    const lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
    const pad = (hi - lo) * 0.08 || hi * 0.08 || 1;
    const yMin = Math.max(0, lo - pad), yMax = hi + pad;
    const plotW = W - PAD.l - PAD.r;
    // A 1-3 candle series is centred at a sane width rather than smeared across the whole plot,
    // which otherwise reads as a solid block of colour instead of a chart.
    const slot = cs.length < 8 ? Math.min(56, plotW / Math.max(1, cs.length)) : plotW / cs.length;
    const x0 = cs.length < 8 ? PAD.l + (plotW - slot * cs.length) / 2 : PAD.l;
    const px = (i) => x0 + (i + 0.5) * slot;
    const py = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

    // horizontal grid + price axis, every label naming a value the chart actually reaches
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4), y = py(v);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(W - PAD.r, y + 0.5); ctx.stroke();
      ctx.fillStyle = axis;
      ctx.fillText(fmtPrice(v, data.ethUsd), W - PAD.r + 5, y);
    }

    const cw = Math.max(1, Math.min(28, (W - PAD.l - PAD.r) / cs.length * 0.62));
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i], x = px(i), rising = c.c >= c.o;
      ctx.strokeStyle = rising ? up : down;
      ctx.fillStyle = rising ? up : down;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, py(c.h)); ctx.lineTo(x, py(c.l)); ctx.stroke();   // wick
      const yO = py(c.o), yC = py(c.c);
      const top = Math.min(yO, yC), h = Math.max(1, Math.abs(yC - yO));
      ctx.fillRect(x - cw / 2, top, cw, h);                                            // body
    }
    // last price marker
    const last = cs[cs.length - 1];
    ctx.strokeStyle = last.c >= last.o ? up : down;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.l, py(last.c) + 0.5); ctx.lineTo(W - PAD.r, py(last.c) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
  }

  function summarise(data) {
    const cs = data.candles || [];
    if (!cs.length) return data.note || 'No trades to chart yet.';
    const first = cs[0].o, last = cs[cs.length - 1].c;
    const chg = first > 0 ? ((last - first) / first) * 100 : 0;
    const n = cs.length;
    return 'Price ' + fmtPrice(last, data.ethUsd) + ', ' + (chg >= 0 ? 'up ' : 'down ') +
      Math.abs(chg).toFixed(1) + '% over ' + n + ' ' + data.tf + (n === 1 ? ' candle' : ' candles') +
      ', from ' + data.swaps + (data.swaps === 1 ? ' on-chain swap.' : ' on-chain swaps.');
  }

  function tableHTML(data) {
    const cs = (data.candles || []).slice(-40).reverse();
    if (!cs.length) return '';
    return '<table class="oc-table"><caption class="sr-only">Recent ' + esc(data.tf) +
      ' candles for this pair, newest first</caption><thead><tr>' +
      '<th scope="col">Time (UTC)</th><th scope="col">Open</th><th scope="col">High</th><th scope="col">Low</th><th scope="col">Close</th><th scope="col">Swaps</th>' +
      '</tr></thead><tbody>' + cs.map(c => {
        const d = new Date(c.t * 1000);
        const t = d.toISOString().slice(5, 16).replace('T', ' ');
        return '<tr><td>' + t + '</td><td>' + esc(fmtPrice(c.o, data.ethUsd)) + '</td><td>' + esc(fmtPrice(c.h, data.ethUsd)) +
          '</td><td>' + esc(fmtPrice(c.l, data.ethUsd)) + '</td><td>' + esc(fmtPrice(c.c, data.ethUsd)) + '</td><td>' + c.n + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

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
      host._data = d;
      draw(cv, d);
      const sum = summarise(d);
      status.textContent = sum;
      cv.setAttribute('aria-label', sum);
      const tbl = host.querySelector('.oc-table-wrap');
      if (tbl) tbl.innerHTML = tableHTML(d);
    } catch { status.textContent = '⚠️ Could not read the chain right now.'; }
  }

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
        '<span class="oc-src" title="Built from this pair contract&#39;s own Swap events">⛓️ on-chain</span>' +
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
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (host._data) draw(host.querySelector('canvas'), host._data); }, 150); });
    load(host);
  };

  // auto-mount anything already on the page
  function mountAll(root) { (root || document).querySelectorAll('.onchain-chart:not([data-mounted])').forEach(h => { h.setAttribute('data-mounted', '1'); window.renderOnChainChart(h); }); }
  window.mountOnChainCharts = mountAll;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll()); else mountAll();
})();
