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
let mcapAnnounced = false;
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
      if (sub) sub.textContent = '$' + Number(p.priceUsd).toPrecision(3) + ' per $' + key + ' · 24h vol ' + (p.volume && p.volume.h24 != null ? fmtUsd(p.volume.h24) : '—') + (p.source === 'reserves' ? ' · from the pool’s reserves' : '');
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
    if (a11y && a11yText) {
      // first fill is announced; later refreshes only update the text for a reader who goes looking for it —
      // a two-sentence interruption every 30s on a page someone is reading is the flood 2.2.2 forbids
      if (mcapAnnounced) { a11y.setAttribute('aria-live', 'off'); a11y.removeAttribute('role'); }
      a11y.textContent = a11yText;
      mcapAnnounced = true;
    }
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

/* The looping clips: user-pausable (WCAG 2.2.2), a still with controls under reduced motion (CSS can't
   pause <video>), and fetched only once they scroll into view. They carry preload="none" and no autoplay
   attribute, so a visitor who never reaches the section never pulls the ~3.5 MB the two files weigh. */
(function () {
  const btn = document.getElementById('clip-toggle');
  const clips = [...document.querySelectorAll('.clip-card video')];
  if (!btn || !clips.length) return;
  let paused = _reduced();
  if (paused) clips.forEach(v => { try { v.controls = true; } catch {} });   // reduced motion: only starts by hand
  const inView = new Set();
  const play = (v) => { if (paused || !inView.has(v)) return; try { v.preload = 'auto'; v.play().catch(() => {}); } catch {} };
  const paint = () => { btn.setAttribute('aria-pressed', String(paused)); btn.textContent = paused ? '▶ Play clips' : '⏸ Pause clips'; };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(ents => ents.forEach(en => {
      if (en.isIntersecting) { inView.add(en.target); play(en.target); }
      else { inView.delete(en.target); try { en.target.pause(); } catch {} }   // off-screen loops cost decode for nothing
    }), { threshold: 0.25 });
    clips.forEach(v => io.observe(v));
  } else clips.forEach(v => { inView.add(v); play(v); });
  btn.addEventListener('click', () => {
    paused = !paused;
    clips.forEach(v => { try { if (paused) v.pause(); else play(v); } catch {} });
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
  const inflight = document.getElementById('swap-inflight');
  const txEl = document.getElementById('swap-tx');
  // the hash is whatever the wallet handed back — pin its shape before it goes anywhere near a URL or markup
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) { sendToast('Swap sent — check your wallet for the result ⏳'); return; }
  /* "Watch it on the explorer" was an instruction with no link: the hash was only ever a polling key. The
     link + copy button live in #swap-pending, which stays visible after the spinner line goes — the moment
     money has left the wallet is exactly when someone wants to find their own transaction. */
  if (txEl) txEl.innerHTML = 'Your transaction: <a href="' + RH_CHAIN.explorer + '/tx/' + hash + '" target="_blank" rel="noopener">' + hash.slice(0, 10) + '…' + hash.slice(-6) + ' ↗</a> ' +
    '<button class="copy-btn" type="button" data-copy="' + hash + '" data-tip="Copies the full transaction hash so you can look it up in your wallet or the explorer">Copy hash</button>';
  if (inflight) inflight.hidden = false;
  pend.hidden = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const rcpt = await rpcCall('eth_getTransactionReceipt', [hash]);
      if (rcpt) {
        if (inflight) inflight.hidden = true;
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
  if (inflight) inflight.hidden = true;
  sendToast('Still pending — check your wallet or the explorer ⏳');
  if (typeof window.swapStatus === 'function') window.swapStatus('Still pending after two minutes — the explorer link above will show what happened ⏳', 'info');
}

/* ---------- swap panel ---------- */
let swapPick = 'SEND';
const SLIPPAGE = 10; // % — generous guard for thin pools + GWC's transfer tax
/* Transfer taxes the router's quote knows nothing about: getAmountsOut prices the pool leg only, then the
   token contract takes its cut on the transfer to the buyer (which is why the swap uses the fee-on-transfer
   router path). Without this the headline was ~5% high for $GWC and ~1% high for $SEND. The figures are
   the ones this page already states in the guide's warn-box ($Send 1% per transfer, $GWC 5% each way). */
const TAX_BPS = { SEND: 100, GWC: 500 };
/* Price impact is what a constant-product pool charges for SIZE, and the slippage guard never covered it —
   the guard trims an already-crushed quote by 10%, so "10% guard" read as a loss cap while a large order
   could fill far under the going rate. The going rate comes from the pool itself: a second quote for a
   sliver of ETH (0.0001, too small to move the pool) is its marginal price, no off-chain feed needed. */
const REF_WEI = 10n ** 14n;
const IMPACT_WARN = 5;   // % — from here the swap button asks before opening the wallet
let lastImpact = null;   // impact of the amount currently quoted; null while a quote is pending or unavailable
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
    if (!wei || wei <= 0n) { qEl.textContent = 'enter an amount ☝️'; mEl.textContent = ''; if (uEl) uEl.textContent = ''; const i0 = document.getElementById('swap-impact'); if (i0) i0.textContent = ''; lastImpact = null; return; }
    // dollar equivalent of the ETH you'd spend — raw ETH means nothing to a first-timer (audit #2)
    if (uEl) uEl.textContent = lastEthUsd ? toNum(wei, 18) + ' ETH ≈ ' + fmtUsd(toNum(wei, 18) * lastEthUsd) : '';
    const iEl = document.getElementById('swap-impact');
    const seq = ++quoteSeq;
    lastImpact = null;
    qEl.textContent = 'quoting…';
    try {
      const [out, ref] = await Promise.all([quoteEthToToken(swapPick, wei), quoteEthToToken(swapPick, REF_WEI).catch(() => null)]);
      if (seq !== quoteSeq) return;
      const outN = toNum(out, 18);
      const taxPct = (TAX_BPS[swapPick] || 0) / 100;
      const getN = outN * (1 - taxPct / 100);   // what actually lands in the wallet
      const usdOut = lastTokUsd[swapPick] ? getN * lastTokUsd[swapPick] : null;
      qEl.textContent = '~' + getN.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' $' + swapPick + (usdOut != null ? ' (≈ ' + fmtUsd(usdOut) + ')' : '');
      const minN = getN * (100 - SLIPPAGE) / 100;
      mEl.textContent = 'after the ' + taxPct + '% $' + swapPick + ' contract tax · min received after the ' + SLIPPAGE + '% slippage guard: ' + minN.toLocaleString('en-US', { maximumFractionDigits: 0 });
      let impact = null;
      if (ref && ref > 0n) {
        const spotOut = toNum(ref, 18) * (toNum(wei, 18) / toNum(REF_WEI, 18));   // this order at the pool's marginal rate
        if (spotOut > 0) impact = Math.max(0, (1 - outN / spotOut) * 100);
      }
      lastImpact = impact;
      if (iEl) iEl.textContent = impact == null ? '' :
        'price impact ~' + impact.toFixed(1) + '%' + (impact >= IMPACT_WARN ? ' ⚠️ big order for this pool — you would get that much less than the going rate, and the slippage guard does not cover it' : ' (the pool moves against your size — not covered by the slippage guard)');
    } catch (e) {
      if (seq === quoteSeq) { qEl.textContent = 'quote unavailable 📡'; mEl.textContent = ''; if (iEl) iEl.textContent = ''; }
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
const swapGo = document.getElementById('swap-go');
let swapBusy = false;
const SWAP_WORKING = 'Checking wallet, chain and quote… ⏳';
swapGo.addEventListener('click', async () => {
  if (swapBusy) return;
  // F079: past the impact threshold the button asks first — a fat-fingered 10 instead of 1.0 would otherwise
  // fill far under the going rate and still pass the slippage guard
  if (lastImpact != null && lastImpact >= IMPACT_WARN) {
    const ok = confirm('Price impact is about ' + lastImpact.toFixed(1) + '% — this order is big for the pool, so you would get that much less than the going rate, and the ' + SLIPPAGE + '% slippage guard does not protect against it. Swap anyway?');
    if (!ok) { window.swapStatus('Swap not sent — a smaller amount means less price impact', 'info'); return; }
  }
  swapBusy = true; swapGo.disabled = true;
  window.swapStatus(SWAP_WORKING, 'info');
  try {
    const hash = await executeSwap(swapPick, document.getElementById('swap-amt').value, SLIPPAGE);
    if (hash) watchSwapTx(hash);
  } finally {
    swapBusy = false; swapGo.disabled = false;
    const st = document.getElementById('swap-status');
    if (st && st.textContent === SWAP_WORKING) window.swapStatus('', 'info');   // a silent exit (picker closed) must not leave "checking…" on screen
  }
});
document.querySelectorAll('[data-watch-token]').forEach(b =>
  b.addEventListener('click', () => watchToken(b.dataset.watchToken)));
document.getElementById('add-chain-btn').addEventListener('click', addRobinhoodChain);

/* ===== How-to-Buy step 1: pick a wallet, then connect or link ==========================
   The list is rendered from WALLET.known() — the same curated registry the wallet picker
   uses — so the guide can never drift from what the picker actually offers. Detected
   wallets are marked "installed" so someone who already has one is told to press the
   button rather than download it again. */
(function () {
  const list = document.getElementById('g1-wallets');
  const btn = document.getElementById('g1-connect');
  const hint = document.getElementById('g1-hint');
  if (!list || !btn || !window.WALLET) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function installedKeys() {
    // WALLET.list() is what EIP-6963 actually announced in this browser
    try {
      const names = (WALLET.list() || []).map(w => ((w.info && (w.info.name + ' ' + (w.info.rdns || ''))) || '').toLowerCase());
      return (k) => names.some(n => n.includes(k.key) || n.includes(k.name.toLowerCase().split(' ')[0]));
    } catch { return () => false; }
  }

  function render() {
    const has = installedKeys();
    list.innerHTML = (WALLET.known() || []).map(k => {
      const here = has(k);
      return '<li class="g1-w">' +
        '<a class="g1-w-link" href="' + esc(k.get) + '" target="_blank" rel="noopener">' +
          '<span class="g1-w-ico" aria-hidden="true">' + esc(k.emoji) + '</span>' +
          '<span class="g1-w-name">' + esc(k.name) + '</span>' +
          (k.chain ? '<span class="g1-w-tag">native to this chain</span>' : '') +
          (here ? '<span class="g1-w-tag is-here">installed</span>' : '') +
        '</a></li>';
    }).join('');
  }

  // Signed out → the sign-in modal (its wallet button signs you in and makes the account).
  // Signed in → link this wallet to the account you already have. Same server route either way.
  /* One call either way now. Signed out it opens the panel already running the wallet sign-in, so the
     picker is the next thing you see; signed in it links straight from here. It used to drop a signed-out
     reader on the sign-in panel with no indication that the wallet button was the one they wanted. */
  async function go() {
    const signedIn = !!(window.AUTH && AUTH.user);
    if (!window.AUTH) return;
    if (!signedIn) { AUTH.connectWallet(); return; }
    btn.disabled = true;
    hint.textContent = 'Choose your wallet…';
    try {
      const j = await AUTH.connectWallet({ note: 'Linking a wallet adds it to the account you are signed in to.' });
      if (j.alreadyLinked) { hint.textContent = '✅ Already linked to your account.'; sendToast('That wallet is already linked ✅'); }
      else { hint.textContent = '✅ Linked — it now counts toward your Send Power.'; sendToast('Wallet linked 🔗'); }
    } catch (e) {
      hint.textContent = (e.message === 'cancelled') ? '' : '⚠️ ' + (e.message || 'could not link that wallet');
    } finally { btn.disabled = false; }
  }

  function paintBtn() {
    const signedIn = !!(window.AUTH && AUTH.user);
    btn.textContent = signedIn ? 'Link this wallet to my account 🔗' : 'Connect my wallet 🔗';
  }

  btn.addEventListener('click', go);
  document.addEventListener('auth:change', paintBtn);
  if (window.AUTH && AUTH.ready) AUTH.ready.then(paintBtn); else paintBtn();
  render();
  // wallets announce themselves asynchronously — repaint briefly so "installed" appears
  let ticks = 0;
  const iv = setInterval(() => { if (++ticks > 8) return clearInterval(iv); render(); }, 400);
})();

/* ===== The 90-day beta campaign banner ==================================================
   Countdown to the reset plus the live top ten. Everything comes from /api/beta so the page
   can never disagree with what the server will actually do at settlement. */
(function () {
  const when = document.getElementById('beta-when');
  const count = document.getElementById('beta-count');
  const board = document.getElementById('beta-board');
  if (!when || !board) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  let endsAt = null, settled = false;

  function tick() {
    if (endsAt == null) return;
    const left = endsAt - Date.now();
    if (left <= 0) { count.textContent = settled ? 'Reset complete' : 'Resetting…'; return; }
    const d = Math.floor(left / DAY), h = Math.floor((left % DAY) / 3600000), m = Math.floor((left % 3600000) / 60000);
    count.textContent = d + 'd ' + h + 'h ' + m + 'm';
  }

  async function load() {
    try {
      const r = await fetch('/api/beta', { credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      endsAt = j.endsAt; settled = !!j.settled;
      when.textContent = endsAt ? new Date(endsAt).toUTCString().replace(' GMT', ' UTC') : '—';
      document.getElementById('beta-live').textContent = settled ? 'final' : 'live';
      tick();
      board.innerHTML = (j.top || []).length
        ? j.top.map(t => '<li class="beta-row' + (t.rank <= 3 ? ' is-top' : '') + '">' +
            '<span class="beta-pl">' + (['🥇', '🥈', '🥉'][t.rank - 1] || ('#' + t.rank)) + '</span>' +
            '<span class="beta-av" aria-hidden="true">' + esc(t.avatar || '🚀') + '</span>' +
            '<span class="beta-nm">@' + esc(t.username) + '</span>' +
            '<span class="beta-pt">' + Number(t.points || 0).toLocaleString('en-US') + '</span></li>').join('')
        : '<li class="beta-empty">Nobody on the board yet — every point counts from here.</li>';
      const meEl = document.getElementById('beta-me');
      if (j.me && meEl) {
        meEl.innerHTML = j.me.rank
          ? '🏅 You finished <b>#' + j.me.rank + '</b> — your badge pays <b>' + j.badgeMult + '×</b> on everything from here.'
          : 'You have <b>' + Number(j.me.points || 0).toLocaleString('en-US') + '</b> Send Power. Top ' + j.topN + ' at the reset keeps a badge and a permanent ' + j.badgeMult + '×.';
      }
    } catch {
      board.innerHTML = '<li class="beta-empty">Board unavailable right now.</li>';
    }
  }
  load();
  setInterval(tick, 30000);
})();
