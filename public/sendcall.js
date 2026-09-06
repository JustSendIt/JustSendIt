/* ===== Send Call widget — a live, on-chain call card that renders inside a wall post =====
 * Shared by the Send Wall (wall.js), public profiles (upage.js) and the profile Send Calls tab.
 * CSP-safe: addEventListener only, images only from Dexscreener's CDN. window.SendCall is the API. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function timeAgo(t) { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return Math.round(s) + 's ago'; const m = s / 60; if (m < 60) return Math.round(m) + 'm ago'; const h = m / 60; if (h < 24) return Math.round(h) + 'h ago'; return Math.round(h / 24) + 'd ago'; }
  function fmtUsd(n) { if (n == null) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
  // Xs use the call rule: each +100% = 1x. curX = price/entry − 1. So a call up +340% is "+3.4x".
  function xFmt(x) { if (x == null || !isFinite(x)) return '—'; const s = x >= 0 ? '+' : '−'; const a = Math.abs(x); return s + (a < 10 ? a.toFixed(2) : a < 100 ? a.toFixed(1) : Math.round(a)) + 'x'; }
  function hue(addr) { let h = 5381; const s = String(addr || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h % 360; }
  const xClass = (x) => x > 0 ? 'sc-up' : x < 0 ? 'sc-down' : 'sc-flat';

  function logo(call) {
    const img = call.brand && call.brand.imageUrl;
    return img ? '<span class="sc-logo"><img class="np-logo-img" src="' + esc(img) + '" alt="" loading="lazy" decoding="async" width="40" height="40"></span>' : '<span class="sc-logo sc-logo-none" aria-hidden="true">📣</span>';
  }
  // one line per sender: avatar + 💎level + @name · entry MC · $ put in · PNL in Xs · holding-for / sold
  function senderAva(s) {
    return s.avatarImg
      ? '<img class="sc-sender-ava" src="' + esc(s.avatarImg) + '" alt="" width="20" height="20" loading="lazy">'
      : '<span class="sc-sender-ava sc-sender-ava-emoji" aria-hidden="true">' + esc(s.avatar || '🚀') + '</span>';
  }
  function shortDur(ms) { const s = Math.max(0, ms / 1000); if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; }
  function sendersRowsHTML(list) {
    return (list || []).map(s => {
      const dia = s.diamond >= 1 ? '<span class="sc-sender-diamond" title="Diamond Hand Lv ' + s.diamond + '">💎' + s.diamond + '</span>' : '';
      const pnl = s.senderX != null ? '<span class="sc-sender-pnl ' + xClass(s.senderX) + '"><span class="sr-only">up </span>' + xFmt(s.senderX) + '</span>' : '';
      const hold = s.holding
        ? '<span class="sc-sender-hold sc-holding" title="Still holding for ' + shortDur(s.holdMs) + '">💎 ' + shortDur(s.holdMs) + '</span>'
        : (s.sold ? '<span class="sc-sender-hold sc-soldout" title="Sold out">💀 sold</span>' : '<span class="sc-sender-hold sc-nobuy" title="Sent It — no on-chain buy found">—</span>');
      return '<li class="sc-sender' + (s.holding ? '' : ' sc-sender-out') + '">' +
        '<a class="sc-sender-who" href="/u/' + encodeURIComponent(s.username) + '">' + senderAva(s) + dia + '<span class="sc-sender-name">@' + esc(s.username) + '</span>' + (window.ogBadge ? ogBadge(s.og) : '') + '</a>' +
        '<span class="sc-sender-stats">' +
          '<span class="sc-sender-mc"><span class="sr-only">got in at </span>@ <b>' + (s.entryMc != null ? fmtUsd(s.entryMc) : '—') + '</b></span>' +
          '<span class="sc-sender-sent"><span class="sr-only">put in </span>💸 <b>' + fmtUsd(s.sentUsd || 0) + '</b></span>' +
          pnl + hold +
        '</span>' +
      '</li>';
    }).join('');
  }
  // ---- Share on X: build a "Just Send It!" card image (token logo backdrop → Send-logo fallback) ----
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function shareCard(call) {
    const W = 1200, H = 675, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#080d08'; ctx.fillRect(0, 0, W, H);
    // backdrop: the token logo (via same-origin proxy so the canvas isn't CORS-tainted), else the Send logo
    const tokLogo = call.brand && call.brand.imageUrl;
    let bg = null;
    if (tokLogo) { try { bg = await loadImg('/api/img?u=' + encodeURIComponent(tokLogo)); } catch {} }
    if (!bg) { try { bg = await loadImg('/assets/logo.png'); } catch {} }
    if (bg && bg.width) {
      const scale = Math.max(W / bg.width, H / bg.height), dw = bg.width * scale, dh = bg.height * scale;
      ctx.globalAlpha = 0.5; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1;
    }
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(6,10,6,0.5)'); grad.addColorStop(0.5, 'rgba(6,10,6,0.78)'); grad.addColorStop(1, 'rgba(6,10,6,0.95)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8ee000'; ctx.lineWidth = 10; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8ee000'; ctx.font = '900 96px "Luckiest Guy", Arial Black, Arial, sans-serif';
    ctx.fillText('Just Send It! 🚀', W / 2, 168);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 78px Arial, sans-serif';
    ctx.fillText('$' + (call.symbol || '?'), W / 2, 292);
    const mc = (!call.stale && call.curMc != null) ? call.curMc : call.entryMc;
    if (mc != null) { ctx.fillStyle = '#cfe9b0'; ctx.font = '600 46px Arial, sans-serif'; ctx.fillText((call.stale ? 'called at ' : '') + fmtUsd(mc) + ' market cap', W / 2, 372); }
    if (!call.stale && call.curX != null && isFinite(call.curX)) { ctx.fillStyle = call.curX >= 0 ? '#8ee000' : '#ff6a6a'; ctx.font = '900 128px Arial Black, Arial, sans-serif'; ctx.fillText(xFmt(call.curX), W / 2, 520); }
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText('JustSendIt · a $Send call 🟢', W / 2, H - 38);
    return cv.toDataURL('image/png');
  }
  async function shareCall(btn) {
    const w = btn.closest('.sc-widget'); const id = w && w.dataset.call; if (!id) return;
    const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '🖼️ Building…';
    let call = null;
    try { const r = await fetch('/api/calls/' + encodeURIComponent(id), { credentials: 'same-origin' }); const j = await r.json(); call = j && j.call; } catch {}
    if (!call) call = { id: id };
    let dataUrl = null;
    try { dataUrl = await shareCard(call); } catch {}
    if (dataUrl) { try { const a = document.createElement('a'); a.href = dataUrl; a.download = 'justsendit-' + (call.symbol || 'call') + '.png'; document.body.appendChild(a); a.click(); a.remove(); } catch {} }
    const link = location.origin + (call.postId ? '/wall.html#p' + call.postId : '/wall.html');
    let text = 'Just Send It! 🚀';
    if (call.symbol) text += ' I called $' + call.symbol + (call.entryMc != null ? ' at ' + fmtUsd(call.entryMc) + ' MC' : '');
    text += ' on $Send';
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(link), '_blank', 'noopener');
    btn.disabled = false; btn.innerHTML = orig;
    if (window.sendToast) sendToast(dataUrl ? '🖼️ Call card saved — attach it to your tweet on X!' : 'Opening X…');
  }

  function widgetHTML(call) {
    const g = call.grade || { g: 'E', emoji: '➖', label: 'Flat' };
    const chart = (call.links && call.links.dex) || ('https://dexscreener.com/robinhood/' + call.pair);
    return '<div class="sc-widget sc-g' + esc(g.g) + (call.rugged ? ' sc-is-rugged' : '') + '" data-call="' + call.id + '" data-token="' + esc(call.token) + '" style="--tok:hsl(' + hue(call.token) + ' 72% 60%)">' +
      (call.rugged ? '<div class="sc-rugged" role="alert">💀 RUGGED! <span>Liquidity was pulled — DO NOT BUY.</span></div>' : '') +
      '<div class="sc-top">' + logo(call) +
        '<div class="sc-id"><span class="sc-name">' + esc(call.name || 'Token') + ' <b>$' + esc(call.symbol || '?') + '</b></span>' +
          '<span class="sc-when">📣 Send Call · ' + timeAgo(call.calledAt) + ' · entry ' + (call.entryMc != null ? fmtUsd(call.entryMc) + ' MC' : '$' + (call.entryPrice != null ? Number(call.entryPrice).toPrecision(3) : '—')) + '</span></div>' +
        '<span class="sc-grade" title="' + esc(g.label) + ' call">' + g.emoji + '<i>' + esc(g.g) + '</i></span>' +
      '</div>' +
      '<div class="sc-xrow">' +
        '<div class="sc-x ' + (call.stale ? 'sc-flat' : xClass(call.curX)) + '"><i>Now' + (call.stale ? ' ⚠︎' : '') + '</i><b class="sc-xnow">' + (call.stale ? '—' : xFmt(call.curX)) + '</b></div>' +
        '<div class="sc-x sc-x-max ' + xClass(call.maxX) + '"><i>Peak since call</i><b class="sc-xmax">' + xFmt(call.maxX) + '</b></div>' +
      '</div>' +
      (call.stale ? '<p class="sc-stale">⚠︎ No longer priced on Dexscreener (delisted or rugged). The peak above is the final record.</p>' : '') +
      (call.noDyor ? '<p class="sc-nodyor" role="note">⚠️ <b>Not researched.</b> The caller made this call <b>without opening the token’s full on-chain details</b> first — treat it with extra caution and <b>DYOR</b>.</p>' : '') +
      (call.entryMc != null ? '<div class="sc-mcs"><span>Entry <b>' + fmtUsd(call.entryMc) + '</b></span><span class="sc-arrow" aria-hidden="true">→</span><span>Now <b class="sc-curmc">' + (call.stale ? '—' : fmtUsd(call.curMc)) + '</b></span><span class="sc-dot" aria-hidden="true">·</span><span>ATH <b class="sc-peakmc">' + fmtUsd(call.peakMc) + '</b></span></div>' : '') +
      '<div class="sc-size"' + ((call.callerSpend > 0 || call.totalSpend > 0) ? '' : ' hidden') + '>' +
        '<span class="sc-size-item">📥 Caller Sent <b class="sc-callerspend">' + fmtUsd(call.callerSpend || 0) + '</b>' + (call.sizeMult > 1 ? ' <i class="sc-size-mult">×' + (call.sizeMult >= 10 ? Math.round(call.sizeMult) : (call.sizeMult || 1).toFixed(1)) + ' Power</i>' : '') + '</span>' +
        '<span class="sc-size-item">🚀 Followers <b class="sc-hopspend">' + fmtUsd(call.hopSpend || 0) + '</b></span>' +
        '<span class="sc-size-item sc-size-total">💰 Into $' + esc(call.symbol || '?') + ' <b class="sc-totalspend">' + fmtUsd(call.totalSpend || 0) + '</b></span>' +
      '</div>' +
      '<div class="sc-senders"' + (call.hops > 0 ? '' : ' hidden') + '>' +
        '<div class="sc-senders-head">🚀 <b class="sc-senders-n">' + (call.hops || 0) + '</b> also Sent It <span class="sc-senders-sub">— top senders</span></div>' +
        '<ol class="sc-senders-list" aria-label="Others who Sent It, ranked by how much they put in">' + sendersRowsHTML((call.senders || []).slice(0, 3)) + '</ol>' +
        (call.hops > 3 ? '<button class="sc-senders-toggle" type="button" data-senders-toggle="' + call.id + '" aria-expanded="false">▾ Show all ' + call.hops + '</button>' : '') +
      '</div>' +
      '<div class="sc-hold"' + (call.holdEarned > 0 ? '' : ' hidden') + '>💎 <b class="sc-holdn">' + (call.holdEarned || 0).toLocaleString('en-US') + '</b> diamond-hands bonus' + (call.stale ? '' : ' · grows while it stays in profit') + '</div>' +
      '<div class="sc-actions">' +
        '<button class="sc-btn sc-hop' + (call.hopped ? ' hopped' : '') + '" type="button" data-hop="' + call.id + '"' + (call.mineOwn ? ' disabled title="This is your own call"' : '') + '>🚀 ' + (call.hopped ? 'Sent it!' : 'Send It!') + ' <span class="sc-hopn">' + (call.hops || 0) + '</span></button>' +
        (call.wallet ? '<button class="sc-btn sc-track" type="button" data-track="' + esc(call.wallet) + '" data-sym="' + esc(call.symbol || '') + '">➕ Track caller’s wallet</button>' : '') +
        '<a class="sc-btn" href="' + esc(chart) + '" target="_blank" rel="noopener nofollow">📈 Chart</a>' +
        '<button class="sc-btn sc-share" type="button" data-share="' + call.id + '" title="Share this call on X — we build a card image you can attach">𝕏 Share</button>' +
        '<button class="sc-btn sc-info" type="button" data-scinfo aria-expanded="false">ⓘ What’s a Send Call?</button>' +
      '</div>' +
      '<div class="sc-explain" hidden>' +
        '<p><b>📣 What’s a Send Call?</b> A public, timestamped, <b>permanent</b> shout that a token will run. Once posted a call can never be edited or deleted — it’s on the record forever, tracked live.</p>' +
        '<p><b>Xs</b> = how far it’s run from the entry, where <b>+100% = 1x</b> (so +340% shows as +3.4x). <b>Peak since call</b> is the highest it has reached since it was called. Every call gets a live <b>grade</b> (E → S).</p>' +
        '<p class="sc-explain-h"><b>How a call earns Send Power 🏆</b></p>' +
        '<ul class="sc-rules">' +
          '<li>📣 <b>+40</b> for making a call (the token needs ≥$500 liquidity, so no one can farm a dust pool).</li>' +
          '<li>📥 <b>Send-size boost:</b> we read on-chain the value of the tokens you bought from the pool <b>and still hold</b> — <b>every $100 = ×1 Send Power</b> (so $1,000 still held = ×10). Sell and it drops. The same applies when you 🚀 Send It on someone else’s call. The card shows what the caller and all followers put in. (Best-effort — only pool buys you still hold count.)</li>' +
          '<li>🚀 <b>Per whole X it hits:</b> 1x → +60, 2x → +120, 3x → +180 … all the way to 50x. The bigger the call, the more — no daily cap.</li>' +
          '<li>💎 <b>Diamond hands:</b> a call that <b>stays in profit</b> earns even more the <b>longer and higher</b> it holds — this bonus <b>compounds</b> over time, accruing automatically every few minutes it’s above entry.</li>' +
          '<li>🚀 <b>+10</b> to <b>Send It!</b> on someone else’s call — and if you stay in profit from your entry price, you earn the <b>same 💎 diamond-hands bonus</b> the caller does.</li>' +
        '</ul>' +
        '<p class="sc-explain-note">Not financial advice. Most tokens go to zero — <b>always DYOR</b>.</p>' +
      '</div>' +
      '<button class="sc-toggle" type="button" data-sctoggle aria-expanded="false"><span class="sc-toggle-lbl">Full on-chain detail</span></button>' +
      '<div class="sc-detail" hidden></div>' +
    '</div>';
  }
  // update a live widget's numbers in place (no re-render, so an open explainer / focus stays put)
  function updateWidget(el, call) {
    const g = call.grade || {};
    el.className = 'sc-widget sc-g' + (g.g || 'E') + (el.classList.contains('sc-expanded') ? ' sc-expanded' : '') + (call.rugged ? ' sc-is-rugged' : ''); // preserve the open/closed toggle state through a live refresh
    if (call.rugged && !el.querySelector('.sc-rugged')) el.insertAdjacentHTML('afterbegin', '<div class="sc-rugged" role="alert">💀 RUGGED! <span>Liquidity was pulled — DO NOT BUY.</span></div>'); // a call that just rugged mid-refresh
    const nowEl = el.querySelector('.sc-xnow'); if (nowEl) { nowEl.textContent = call.stale ? '—' : xFmt(call.curX); nowEl.parentElement.className = 'sc-x ' + (call.stale ? 'sc-flat' : xClass(call.curX)); }
    const maxEl = el.querySelector('.sc-xmax'); if (maxEl) { maxEl.textContent = xFmt(call.maxX); maxEl.parentElement.className = 'sc-x sc-x-max ' + xClass(call.maxX); }
    const cm = el.querySelector('.sc-curmc'); if (cm) cm.textContent = call.stale ? '—' : fmtUsd(call.curMc);
    const pm = el.querySelector('.sc-peakmc'); if (pm) pm.textContent = fmtUsd(call.peakMc);
    const gr = el.querySelector('.sc-grade'); if (gr) { gr.firstChild.textContent = g.emoji || '➖'; const i = gr.querySelector('i'); if (i) i.textContent = g.g || 'E'; }
    const hn = el.querySelector('.sc-hopn'); if (hn) hn.textContent = call.hops || 0;
    const hold = el.querySelector('.sc-hold'); if (hold) { hold.hidden = !(call.holdEarned > 0); const hx = hold.querySelector('.sc-holdn'); if (hx) hx.textContent = (call.holdEarned || 0).toLocaleString('en-US'); }
    const hs = el.querySelector('.sc-hopspend'); if (hs) hs.textContent = fmtUsd(call.hopSpend || 0); // followers' cumulative buy-in grows as more Send It
    const ts = el.querySelector('.sc-totalspend'); if (ts) ts.textContent = fmtUsd(call.totalSpend || 0);
    const cs = el.querySelector('.sc-callerspend'); if (cs) cs.textContent = fmtUsd(call.callerSpend || 0);
    // senders list: keep the count + (when collapsed) the top-3 fresh as more people Send It
    const sw = el.querySelector('.sc-senders');
    if (sw) {
      sw.hidden = !(call.hops > 0);
      const sn = sw.querySelector('.sc-senders-n'); if (sn) sn.textContent = call.hops || 0;
      const stog = sw.querySelector('[data-senders-toggle]'), slist = sw.querySelector('.sc-senders-list');
      if (slist && (!stog || stog.getAttribute('aria-expanded') !== 'true')) slist.innerHTML = sendersRowsHTML((call.senders || []).slice(0, 3));
    }
  }

  // expand/collapse the full New-Pairs token detail under a widget (fetches the LIVE token on first open)
  async function toggleDetail(w) {
    if (!w) return;
    const detail = w.querySelector('.sc-detail'), tog = w.querySelector('[data-sctoggle]');
    const opening = !w.classList.contains('sc-expanded');
    w.classList.toggle('sc-expanded', opening);
    if (detail) detail.hidden = !opening;
    if (tog) { tog.setAttribute('aria-expanded', String(opening)); const lbl = tog.querySelector('.sc-toggle-lbl'); if (lbl) lbl.textContent = opening ? 'Hide on-chain detail' : 'Full on-chain detail'; }
    if (!opening || !detail || detail.dataset.loaded || detail.dataset.loading) return; // collapsing, already loaded, or a fetch is already in flight
    const token = w.dataset.token, id = w.dataset.call;
    if (!window.NPCard || !token) { detail.innerHTML = '<p class="sc-detail-msg">Full detail isn’t available here.</p>'; return; }
    detail.dataset.loading = '1';
    detail.innerHTML = '<p class="sc-detail-msg"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain for the latest on-chain detail…</p>';
    const renderDetail = (p, note) => { detail.innerHTML = (note || '') + window.NPCard.detailHTML(p); if (NPCard.animateRings) NPCard.animateRings(detail); detail.dataset.loaded = '1'; };
    try {
      const r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(token), { credentials: 'same-origin' });
      const j = await r.json();
      if (r.ok && j.pair) { renderDetail(j.pair); return; }
      // live lookup failed (delisted/rugged) → fall back to the call-time snapshot so the detail never dead-ends
      let snap = null;
      try { const sr = await fetch('/api/calls/' + encodeURIComponent(id), { credentials: 'same-origin' }); const sj = await sr.json(); snap = sj && sj.snapshot; } catch {}
      if (snap && snap.token) renderDetail(snap, '<p class="sc-detail-msg" style="text-align:left;margin:0 0 .6rem">⚠︎ Not priced on Dexscreener right now — showing the on-chain detail from when it was called.</p>');
      else detail.innerHTML = '<p class="sc-detail-msg">🤷 This token isn’t priced on Dexscreener anymore — it may have delisted or rugged. The Xs above are the final record.</p>';
    } catch { detail.innerHTML = '<p class="sc-detail-msg">Couldn’t load the full detail — collapse and open it again to retry.</p>'; }
    finally { delete detail.dataset.loading; }
  }
  // delegated actions inside a root (expand/collapse, hop, track caller wallet, toggle explainer). Call once per container.
  function wire(root) {
    if (!root || root._scWired) return; root._scWired = true;
    root.addEventListener('click', async (e) => {
      const tog = e.target.closest('[data-sctoggle]');
      if (tog) { e.preventDefault(); toggleDetail(tog.closest('.sc-widget')); return; }
      const info = e.target.closest('[data-scinfo]');
      if (info) { const w = info.closest('.sc-widget'); const ex = w.querySelector('.sc-explain'); const open = ex.hidden; ex.hidden = !open; info.setAttribute('aria-expanded', String(open)); return; }
      const share = e.target.closest('[data-share]');
      if (share) { e.preventDefault(); shareCall(share); return; }
      const stog = e.target.closest('[data-senders-toggle]');
      if (stog) {
        e.preventDefault();
        const wrap = stog.closest('.sc-senders'), list = wrap.querySelector('.sc-senders-list');
        if (stog.getAttribute('aria-expanded') === 'true') { // collapse → back to top 3
          list.innerHTML = sendersRowsHTML((wrap._all || []).slice(0, 3));
          stog.setAttribute('aria-expanded', 'false'); stog.innerHTML = '▾ Show all ' + ((wrap._all || []).length || stog.dataset.n || '');
          return;
        }
        if (stog.dataset.loading) return; stog.dataset.loading = '1';
        const label = stog.innerHTML; stog.innerHTML = 'Loading…';
        try {
          const r = await fetch('/api/calls/' + encodeURIComponent(stog.dataset.sendersToggle) + '/senders', { credentials: 'same-origin' });
          const j = await r.json();
          wrap._all = (j && j.senders) || [];
          list.innerHTML = sendersRowsHTML(wrap._all);
          stog.setAttribute('aria-expanded', 'true'); stog.innerHTML = '▴ Show top 3';
        } catch { stog.innerHTML = label; }
        finally { delete stog.dataset.loading; }
        return;
      }
      const hop = e.target.closest('[data-hop]');
      if (hop) {
        e.preventDefault();
        if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
        if (hop.disabled) return;
        const id = hop.dataset.hop; hop.disabled = true;
        try {
          const r = await fetch('/api/calls/' + encodeURIComponent(id) + '/hop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const j = await r.json();
          if (!r.ok) { if (window.sendToast) sendToast(j.error || 'Could not Send It'); hop.disabled = false; return; }
          hop.classList.add('hopped'); hop.innerHTML = '🚀 Sent it! <span class="sc-hopn">' + j.hops + '</span>';
          if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
          if (window.sendToast) sendToast('🚀 Sent it on the $' + (j.symbol || '') + ' call — good luck!');
          // reveal a track-wallet button if the caller has a public wallet and one isn't already shown
          const w = hop.closest('.sc-widget');
          if (j.wallet && w && !w.querySelector('.sc-track')) hop.insertAdjacentHTML('afterend', '<button class="sc-btn sc-track" type="button" data-track="' + esc(j.wallet) + '" data-sym="' + esc(j.symbol || '') + '">➕ Track caller’s wallet</button>');
        } catch { if (window.sendToast) sendToast('Could not Send It'); hop.disabled = false; }
        return;
      }
      const track = e.target.closest('[data-track]');
      if (track) {
        e.preventDefault();
        if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
        const addr = track.dataset.track; track.disabled = true;
        try {
          const r = await fetch('/api/wallets', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr, label: (track.dataset.sym ? '$' + track.dataset.sym + ' caller' : 'Send caller') }) });
          const j = await r.json();
          if (!r.ok) { if (window.sendToast) sendToast(j.error || 'Could not track that wallet'); track.disabled = false; return; }
          track.textContent = '✓ Tracking caller';
          if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
          if (window.sendToast) sendToast('💼 Added the caller’s wallet to your tracker');
        } catch { if (window.sendToast) sendToast('Could not track that wallet'); track.disabled = false; }
        return;
      }
      // click anywhere on the card CHROME (not a control, not inside the open detail) toggles the detail
      const card = e.target.closest('.sc-widget');
      if (card && !e.target.closest('.sc-actions, .sc-detail, .sc-explain, a, button')) toggleDetail(card);
    });
  }

  // live refresh: a SINGLE shared observer + visible-set + timer for the whole page, so every widget in any
  // container keeps its Xs current (across feed reloads and secondary lists) without a page reload.
  const _vis = new Set();      // ids currently on screen
  const _seen = new WeakSet(); // widgets already observed
  let _io = null, _timer = null;
  function ensureLive() {
    if (!('IntersectionObserver' in window)) return;
    if (!_io) _io = new IntersectionObserver((entries) => { entries.forEach(en => { const id = en.target.dataset.call; if (!id) return; if (en.isIntersecting) _vis.add(id); else _vis.delete(id); }); }, { rootMargin: '80px' });
    if (!_timer) _timer = setInterval(async () => {
      if (document.hidden) return;
      for (const id of [..._vis].slice(0, 8)) { // cap concurrent refreshes
        try {
          const r = await fetch('/api/calls/' + encodeURIComponent(id), { credentials: 'same-origin' });
          if (!r.ok) continue; const j = await r.json();
          document.querySelectorAll('.sc-widget[data-call="' + id + '"]').forEach(w => updateWidget(w, j.call));
        } catch {}
      }
    }, 25000);
  }
  function observe(root) { if (!_io || !root) return; root.querySelectorAll('.sc-widget[data-call]').forEach(w => { if (!_seen.has(w)) { _seen.add(w); _io.observe(w); } }); }
  function live(root) { ensureLive(); observe(root); } // set up the shared machinery, then observe this container's widgets

  window.SendCall = { widgetHTML, updateWidget, wire, live, observe };
})();
