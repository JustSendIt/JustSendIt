/* ===== Homepage: market cap, swap, MoonPay, celebrations ===== */
initTokenCards();

/* ---------- OG banner: live countdown to the tier windows ----------
   The deadlines come from /api/og/campaign, not from this file and not from the HTML. They used to be
   hardcoded epochs in index.html sitting beside the same constants on the server; with three windows
   per coin that is six numbers to hand-maintain, and a countdown that is confidently wrong is worse
   than no countdown. Each element names the window it wants (data-og-window) and the server answers
   with the binding date — the EARLIER of the two coins', since a tier requires holding both. */
(function ogBannerTimers() {
  const els = document.querySelectorAll('[data-og-deadline]');
  if (!els.length) return;
  const banner = document.querySelector('.og-banner');
  const label = document.querySelector('.og-tier-label');
  let loaded = false;   // three states, not two: open, closed, and "we don't know yet"
  fetch('/api/og/campaign', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(c => {
      if (!c || !c.closes) return;                   // leave the em-dash rather than invent a date
      // "current" resolves to whichever window is actually open. Hardcoding it to gold while the
      // LABEL followed c.tierNow meant that from day 31 the banner read "silver closes in closed" —
      // the label and the number describing two different windows for 330 of the campaign's 360 days.
      const openKey = (c.name && c.name[c.tierNow] || '').toLowerCase();
      els.forEach(el => {
        const w = el.dataset.ogWindow === 'current' ? openKey : el.dataset.ogWindow;
        if (w && c.closes[w]) el.dataset.ogDeadline = String(c.closes[w]);
      });
      if (label && openKey) label.textContent = openKey;
      loaded = true;
      tick();
    })
    .catch(() => {});
  function fmt(ms) {
    if (ms <= 0) return 'closed';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
    return m + 'm ' + sec + 's';
  }
  function tick() {
    const now = Date.now();
    let allClosed = true;
    els.forEach(el => {
      const at = Number(el.dataset.ogDeadline);
      if (!at) { el.textContent = '—'; return; }     // not filled in yet (or the request failed)
      const left = at - now;
      el.textContent = fmt(left);
      el.classList.toggle('og-timer-closed', left <= 0);
      // The urgency pulse marks the last three days of the window that is OPEN NOW — the deadline for the
      // tier being earned today, which is a fact the reader needs — and never the "everything closes" timer,
      // so at most one element pulses, and only three times across the whole year, each at a real cut-off.
      if (el.parentElement) el.parentElement.classList.toggle('og-timer-soon', el.dataset.ogWindow === 'current' && left > 0 && left < 3 * 86400 * 1000);
      if (left > 0) allClosed = false;
    });
    // Only claim the campaign is over once we actually know. Before the fetch resolves (and forever
    // if it fails) every deadline is empty, which made allClosed true and greyed the banner out —
    // presenting a live campaign as expired on every page load and on every flaky connection.
    if (banner && loaded) banner.classList.toggle('og-banner-closed', allClosed);
  }
  tick();
  setInterval(() => { if (!document.hidden) tick(); }, 1000); // a countdown nobody can see doesn't need repainting
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  /* ---------- the CTA: the one action the site can honestly offer, by who is looking ----------
     Signed out → read the rules. Signed in → get your linked wallet checked (the badge is earned by holding,
     and checking is the only step this site performs). Already OG → your badge. Never "buy": the banner says
     itself that it is not a reason to buy, and a CTA must not contradict the sentence beside it. */
  const cta = document.getElementById('og-banner-cta');
  const TIER = { 3: ['Gold', 10], 2: ['Silver', 5], 1: ['Bronze', 3] };
  function paintCta() {
    if (!banner || !cta) return;
    const u = (window.AUTH && AUTH.user) ? AUTH.user : null;
    const base = banner.dataset.ariaBase || '';
    let text, href, tail;
    const tier = u ? (Number(u.og) || 0) : 0;   // /api/me reports `og` as the tier (3 gold · 2 silver · 1 bronze · 0 none)
    if (u && TIER[tier]) { text = 'You are OG ' + TIER[tier][0] + ' · ' + TIER[tier][1] + '×'; href = 'profile.html'; tail = 'You hold OG ' + TIER[tier][0] + '. Tap to open your profile.'; }
    else if (u) { text = 'Check my wallet for OG'; href = 'profile.html#connected-wallet'; tail = 'Tap to link a wallet and have it checked on-chain. Not a recommendation to buy.'; }
    else { text = 'How OG works'; href = 'about.html#og-rules'; tail = 'Tap to read how it works. Not a recommendation to buy.'; }
    cta.innerHTML = text + ' <span class="og-cta-arrow">→</span>';
    banner.setAttribute('href', href);
    if (base) banner.setAttribute('aria-label', base + ' ' + tail);
  }
  paintCta();
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(paintCta, paintCta);
  document.addEventListener('auth:change', paintCta);
})();

const _reduced = () => (window.prefersReduced ? window.prefersReduced() : false);

/* ---------- live market cap with count-up (per token: $SEND + $GWC) ---------- */
const mcapState = {}; // key -> last animated value
function setMcap(key, target, opts = {}) {
  const el = document.getElementById('mcap-value-' + key);
  if (!el) return;
  if (target == null) { el.textContent = '$———'; return; }
  const from = mcapState[key] == null ? target * 0.985 : mcapState[key];
  mcapState[key] = target;
  const finalText = '$' + target.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (document.hidden || _reduced()) { el.textContent = finalText; return; } // no count-up animation under reduced motion / hidden
  const t0 = performance.now(), dur = opts.fast ? 400 : 1800;
  if (opts.pump) el.classList.add('pumping');
  function frame(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const v = from + (target - from) * eased;
    el.textContent = '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (k < 1) requestAnimationFrame(frame);
    else if (opts.pump) setTimeout(() => el.classList.remove('pumping'), 1200);
  }
  requestAnimationFrame(frame);
}
async function refreshMcap(opts) {
  try {
    const pairs = await fetchPairs();
    let a11yText = '';
    for (const key of ['SEND', 'GWC']) {
      const p = pairs[key];
      // Dexscreener: marketCap = circulating market cap, fdv = fully-diluted. Show the real market cap; only
      // fall back to FDV when it's missing — and relabel the panel so we never call FDV a "market cap".
      const hasMc = !!(p && p.marketCap != null);
      if (!(hasMc || (p && p.fdv != null))) continue;
      const fdv = Number(hasMc ? p.marketCap : p.fdv);
      setMcap(key, fdv, opts);
      // remember live USD prices so the swap panel can show dollar equivalents (ETH/USD = priceUsd ÷ priceNative)
      if (p.priceUsd && p.priceNative && Number(p.priceNative) > 0) lastEthUsd = Number(p.priceUsd) / Number(p.priceNative);
      lastTokUsd[key] = Number(p.priceUsd) || null;
      const lbl = document.getElementById('mcap-label-' + key);
      if (lbl) lbl.textContent = '$' + key + (hasMc ? ' Market Cap · Live' : ' FDV (fully diluted) · Live');
      const sub = document.getElementById('mcap-sub-' + key);
      if (sub) sub.textContent = '$' + Number(p.priceUsd).toPrecision(3) + ' per $' + key + ' · 24h vol ' + fmtUsd(p.volume && p.volume.h24 || 0);
      // 24h delta chip (never color-only — always an arrow + sign)
      const chg = p.priceChange && p.priceChange.h24 != null ? Number(p.priceChange.h24) : null;
      const deltaEl = document.getElementById('mcap-delta-' + key);
      if (deltaEl && chg != null) { deltaEl.textContent = (chg >= 0 ? '▲ +' : '▼ ') + chg.toFixed(2) + '% today'; deltaEl.className = 'mcap-delta ' + (chg >= 0 ? 'up' : 'down'); }
      // banner image behind the tracker (Dexscreener branding, CDN-validated)
      const banner = document.getElementById('mcap-banner-' + key);
      const img = p.info && typeof dexImg === 'function' && dexImg(p.info.header || p.info.openGraph);
      if (banner && img) banner.style.backgroundImage = 'url("' + img + '")';
      a11yText += '$' + key + (hasMc ? ' market cap about ' : ' fully diluted value about ') + fmtUsd(fdv) + (chg != null ? ', ' + (chg >= 0 ? 'up ' : 'down ') + Math.abs(chg).toFixed(1) + '% today. ' : '. ');
    }
    const a11y = document.getElementById('mcap-a11y');
    if (a11y && a11yText) a11y.textContent = a11yText;
  } catch {}
}
refreshMcap();
// don't hammer Dexscreener for a tab nobody is looking at — poll only while visible, and catch up on return
setInterval(() => { if (!document.hidden) refreshMcap(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMcap({ fast: true }); });

/* each mcap panel is a button → jump to the live charts */
document.querySelectorAll('[data-mcap-jump]').forEach(j => {
  j.addEventListener('click', () => { const t = document.getElementById('tokens'); if (t) t.scrollIntoView({ behavior: _reduced() ? 'auto' : 'smooth' }); });
});

/* reduced-motion: stop decorative autoplay/loop videos (CSS can't pause <video>) */
if (_reduced()) {
  document.querySelectorAll('video[autoplay]').forEach(v => { try { v.removeAttribute('autoplay'); v.pause(); if (!v.classList.contains('hero-bg-video')) v.controls = true; } catch {} });
}

/* pause / resume the looping clips — auto-playing motion must be user-pausable (WCAG 2.2.2) */
(function () {
  const btn = document.getElementById('clip-toggle');
  if (!btn) return;
  let paused = _reduced(); // reduced-motion already paused them above
  const paint = () => { btn.setAttribute('aria-pressed', String(paused)); btn.textContent = paused ? '▶ Play clips' : '⏸ Pause clips'; };
  btn.addEventListener('click', () => {
    paused = !paused;
    document.querySelectorAll('.clip-card video').forEach(v => { try { if (paused) v.pause(); else v.play().catch(() => {}); } catch {} });
    paint();
  });
  paint();
})();

/* ---------- MoonPay (embedded widget when the server has an API key) ---------- */
fetch('/api/config').then(r => r.json()).then(c => {
  const btn = document.getElementById('moonpay-btn');
  if (c.moonpay && c.moonpay.widget) btn.href = c.moonpay.widget;
  else if (c.moonpay && c.moonpay.fallback) btn.href = c.moonpay.fallback;
}).catch(() => {});

/* ---------- rocket storm on confirmed buys ---------- */
function rocketStorm() {
  let n = 0;
  const iv = setInterval(() => {
    sendConfetti(Math.random() * innerWidth, innerHeight * (0.3 + Math.random() * 0.5), { count: 26, emojiRatio: 1 });
    if (++n >= 7) clearInterval(iv);
  }, 180);
  sendToast('SENT! WELCOME ABOARD 🚀🚀🚀');
}
async function watchSwapTx(hash) {
  const pend = document.getElementById('swap-pending');
  pend.hidden = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const rcpt = await rpcCall('eth_getTransactionReceipt', [hash]);
      if (rcpt) {
        pend.hidden = true;
        if (rcpt.status === '0x1') {
          rocketStorm();
          setTimeout(() => refreshMcap({ pump: true }), 1200);
          // credit Send Points for the verified on-chain swap (server re-verifies the receipt; no-op if signed out)
          fetch('/api/gamify/swap', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash }) })
            .then(r => r.json()).then(j => { if (j && j.awarded > 0) { sendToast('+' + j.awarded + ' Send Points for that swap! 🎮'); if (window.showPoints) showPoints(j.awarded); } }).catch(() => {});
        } else {
          sendToast('Transaction reverted 😬 — nothing was taken except gas');
        }
        return;
      }
    } catch {}
  }
  pend.hidden = true;
  sendToast('Still pending — check your wallet or the explorer ⏳');
}

/* ---------- swap panel ---------- */
let swapPick = 'SEND';
const SLIPPAGE = 10; // % — generous guard for thin pools + GWC's transfer tax
function pickSwap(key) {
  swapPick = key;
  for (const k of ['SEND', 'GWC']) {
    const el = document.getElementById('choice-' + k);
    el.classList.toggle('selected', key === k);
    el.setAttribute('aria-pressed', String(key === k)); // reflect selection to assistive tech, not just visually
  }
  sendToast(key === 'SEND' ? '$SEND selected 🚀' : '$GWC selected 💰');
  refreshQuote();
}
var lastEthUsd = null, lastTokUsd = {}; // filled by refreshMcap (var: assigned asynchronously, read by refreshQuote)
/* inline swap status line (mirrors the toasts so errors don't vanish in 2.6s — audit #43) */
window.swapStatus = function (msg, kind) {
  const el = document.getElementById('swap-status'); if (!el) return;
  el.textContent = msg || '';
  el.className = 'hint swap-status' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
};
let quoteTimer = null, quoteSeq = 0;
function refreshQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(async () => {
    const qEl = document.getElementById('swap-quote');
    const mEl = document.getElementById('swap-min');
    const uEl = document.getElementById('swap-usd');
    const wei = parseEth(document.getElementById('swap-amt').value);
    if (!wei || wei <= 0n) { qEl.textContent = 'enter an amount ☝️'; mEl.textContent = ''; if (uEl) uEl.textContent = ''; return; }
    // dollar equivalent of the ETH you'd spend — raw ETH means nothing to a first-timer (audit #2)
    if (uEl) uEl.textContent = lastEthUsd ? toNum(wei, 18) + ' ETH ≈ ' + fmtUsd(toNum(wei, 18) * lastEthUsd) : '';
    const seq = ++quoteSeq;
    qEl.textContent = 'quoting…';
    try {
      const out = await quoteEthToToken(swapPick, wei);
      if (seq !== quoteSeq) return;
      const outN = toNum(out, 18);
      const usdOut = lastTokUsd[swapPick] ? outN * lastTokUsd[swapPick] : null;
      qEl.textContent = '~' + outN.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' $' + swapPick + (usdOut != null ? ' (≈ ' + fmtUsd(usdOut) + ')' : '');
      const minN = outN * (100 - SLIPPAGE) / 100;
      mEl.textContent = 'min received after ' + SLIPPAGE + '% slippage guard: ' + minN.toLocaleString('en-US', { maximumFractionDigits: 0 });
    } catch (e) {
      if (seq === quoteSeq) { qEl.textContent = 'quote unavailable 📡'; mEl.textContent = ''; }
    }
  }, 350);
}

for (const key of ['SEND', 'GWC']) {
  const el = document.getElementById('choice-' + key);
  el.addEventListener('click', () => pickSwap(key));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSwap(key); } });
}
document.getElementById('swap-amt').addEventListener('input', refreshQuote);
document.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('swap-amt').value = b.dataset.amt;
  refreshQuote();
}));
document.getElementById('swap-go').addEventListener('click', async () => {
  const hash = await executeSwap(swapPick, document.getElementById('swap-amt').value, SLIPPAGE);
  if (hash) watchSwapTx(hash);
});
document.querySelectorAll('[data-watch-token]').forEach(b =>
  b.addEventListener('click', () => watchToken(b.dataset.watchToken)));
document.getElementById('add-chain-btn').addEventListener('click', addRobinhoodChain);
