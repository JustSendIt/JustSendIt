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
  /* One block per sender. Line one is who they are (avatar · @name · 💎level · OG), given the whole width when it needs
     it, so a name is never squeezed into a column a letter wide. Line two is what they did: the market cap they got
     in at, what they put in, how far they are up or down, holding or sold, and when they Sent It — each figure kept
     whole and the set wrapping as a group. Line three is what everyone else says about it: 🔥 and 🚀, and a comment
     thread that opens under the row. */
  function senderAva(s) {
    return s.avatarImg
      ? window.avatarHTML(s.avatarImg, 'sc-sender-ava', 'width="20" height="20" loading="lazy"')
      : '<span class="sc-sender-ava sc-sender-ava-emoji" aria-hidden="true">' + esc(s.avatar || '🚀') + '</span>';
  }
  function shortDur(ms) { const s = Math.max(0, ms / 1000); if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; }
  // a 🔥 or 🚀 on one sender's Sent It: the generic click sound is silenced, the server's answer plays its own
  function senderReactHTML(s, kind) {
    const on = (s.myReactions || []).indexOf(kind) >= 0, n = (s.reactions && s.reactions[kind]) || 0;
    const emo = kind === 'rocket' ? '🚀' : '🔥';
    return '<button class="sc-sbtn sc-sreact' + (on ? ' on' : '') + '" type="button" data-sreact="' + kind + '" data-sfx="none" aria-pressed="' + on + '"' +
      ' data-tip="Reacts ' + emo + ' to @' + esc(s.username) + '’s Sent It; tap again to take it back">' +
      '<span aria-hidden="true">' + emo + '</span> <span class="sc-sbtn-n">' + n + '</span><span class="sr-only"> ' + (kind === 'rocket' ? 'rocket' : 'fire') + ' reactions</span></button>';
  }
  function sendersRowsHTML(list) {
    return (list || []).map(s => {
      // title= only ever reaches a mouse; the sr-only copy carries the same words to everyone else
      const dia = s.diamond >= 1 ? '<span class="sc-sender-diamond" title="Diamond Hand Lv ' + s.diamond + '">💎<span class="sr-only">Diamond Hand Lv </span>' + s.diamond + '</span>' : '';
      const pnl = s.senderX != null ? '<span class="sc-sender-pnl ' + xClass(s.senderX) + '" title="How far the price has moved since they Sent It"><span class="sr-only">since they Sent It </span>' + xFmt(s.senderX) + '</span>' : '';
      const hold = s.holding
        ? '<span class="sc-sender-hold sc-holding" title="Still holding for ' + shortDur(s.holdMs) + '">💎 <span class="sr-only">still holding for </span>' + shortDur(s.holdMs) + '</span>'
        : (s.sold ? '<span class="sc-sender-hold sc-soldout" title="Sold out">💀 sold<span class="sr-only"> out</span></span>' : '<span class="sc-sender-hold sc-nobuy" title="Sent It — no on-chain buy found"><span aria-hidden="true">—</span><span class="sr-only">Sent It — no on-chain buy found</span></span>');
      // other people's amounts arrive rounded to two figures (the server's rule); the ≈ says so
      const approx = s.rounded && s.sentUsd > 0;
      const when = s.sentAt ? '<span class="sc-sender-when" title="Sent It ' + esc(new Date(s.sentAt).toLocaleString()) + '"><span class="sr-only">Sent It </span><span aria-hidden="true">🕒</span> ' + timeAgo(s.sentAt) + '</span>' : '';
      return '<li class="sc-sender' + (s.holding ? '' : ' sc-sender-out') + '" data-sender="' + esc(s.username) + '">' +
        '<div class="sc-sender-main">' +
        '<a class="sc-sender-who" href="/u/' + encodeURIComponent(s.username) + '">' + senderAva(s) + '<span class="sc-sender-name">@' + esc(s.username) + '</span>' + dia + (window.ogBadge ? ogBadge(s.og, 'in-link') : '') + '</a>' +
        '<span class="sc-sender-stats">' +
          '<span class="sc-sender-mc" title="The market cap when they Sent It"><span class="sr-only">got in at </span>@ <b>' + (s.entryMc != null ? fmtUsd(s.entryMc) : '—') + '</b> MC</span>' +
          '<span class="sc-sender-sent" title="' + (approx ? 'What they put in, rounded to two figures — only they see the exact amount' : 'What they put in') + '"><span class="sr-only">put in ' + (approx ? 'about ' : '') + '</span>💸 <b>' + (approx ? '<span aria-hidden="true">≈</span>' : '') + fmtUsd(s.sentUsd || 0) + '</b></span>' +
          pnl + hold + when +
        '</span>' +
        '</div>' +
        '<div class="sc-sender-acts">' +
          senderReactHTML(s, 'fire') + senderReactHTML(s, 'rocket') +
          '<button class="sc-sbtn sc-scmt" type="button" data-scmt aria-expanded="false" data-tip="Opens the comments on @' + esc(s.username) + '’s Sent It, where you can add one">' +
            '<span aria-hidden="true">💬</span> <span class="sc-sbtn-n">' + (s.comments || 0) + '</span><span class="sr-only"> comments</span></button>' +
        '</div>' +
        '<div class="sc-thread" hidden></div>' +
      '</li>';
    }).join('');
  }
  // one comment under a sender's Sent It (its author's OG badge sits outside the name link: never a link in a link)
  function hopCommentHTML(c) {
    const ava = c.avatar_img ? window.avatarHTML(c.avatar_img, 'sc-sender-ava', 'width="20" height="20" loading="lazy"') : '<span class="sc-sender-ava sc-sender-ava-emoji" aria-hidden="true">' + esc(c.avatar || '🚀') + '</span>';
    // the ⚑ is a column of its own at the row's end: inside the text, a thumb-sized box would cover the line above it
    return '<li class="sc-cmt" data-cid="' + Number(c.id) + '">' + ava + '<div class="sc-cmt-body">' +
      '<a class="sc-cmt-who" href="/u/' + encodeURIComponent(c.username) + '">@' + esc(c.username) + '</a>' + (window.ogBadge ? ogBadge(c.og) : '') +
      ' <span class="sc-cmt-text">' + (window.richText ? richText(c.text, c.tokens) : esc(c.text)) + '</span>' +
      ' <span class="sc-cmt-when">' + timeAgo(c.created_at) + '</span>' +
    '</div>' +
    (c.mine ? '' : '<button class="sc-cmt-report" type="button" data-report="hopcomment" data-report-what="comment" data-report-id="' + Number(c.id) + '" aria-label="Report this comment" data-tip="Reports this comment to the moderators">⚑</button>') +
    '</li>';
  }
  function threadHTML(name, comments, total) {
    const signedIn = !!(window.AUTH && AUTH.user);
    // the server sends the newest comments of a long thread; the note says the rest exist rather than letting the count disagree
    return (total > comments.length ? '<p class="sc-thread-msg sc-thread-more">The newest ' + comments.length + ' of ' + total + ' comments.</p>' : '') +
      '<ol class="sc-thread-list" aria-label="Comments on @' + esc(name) + '’s Sent It"' + (comments.length ? '' : ' hidden') + '>' + comments.map(hopCommentHTML).join('') + '</ol>' +
      (comments.length ? '' : '<p class="sc-thread-msg">No comments yet.</p>') +
      (signedIn
        ? '<form class="sc-thread-form" data-scmt-form>' +
            '<label class="sc-thread-lbl"><span class="sr-only">Comment on @' + esc(name) + '’s Sent It</span>' +
            '<input class="sc-thread-input" name="text" maxlength="300" autocomplete="off" placeholder="Add a comment…"></label>' +
            '<button class="sc-sbtn sc-thread-post" type="submit" data-tip="Posts your comment under @' + esc(name) + '’s Sent It, for everyone who can see this call">Post</button>' +
          '</form>'
        : '<button class="sc-sbtn" type="button" data-scmt-signin data-tip="Opens sign-in, so you can comment and react">Sign in to comment</button>');
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
    // the server already sends artwork as our /api/img path; wrap only a raw CDN URL (an older cached call)
    if (tokLogo) { try { bg = await loadImg(/^\/api\/img\?/.test(tokLogo) ? tokLogo : '/api/img?u=' + encodeURIComponent(tokLogo)); } catch {} }
    if (!bg) { try { bg = await loadImg('/assets/logo.png'); } catch {} }
    if (bg && bg.width) {
      const scale = Math.max(W / bg.width, H / bg.height), dw = bg.width * scale, dh = bg.height * scale;
      ctx.globalAlpha = 0.5; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1;
    }
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(6,10,6,0.5)'); grad.addColorStop(0.5, 'rgba(6,10,6,0.78)'); grad.addColorStop(1, 'rgba(6,10,6,0.95)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#a8ce00'; ctx.lineWidth = 10; ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a8ce00'; ctx.font = '900 96px "Luckiest Guy", Arial Black, Arial, sans-serif';
    ctx.fillText('Just Send It! 🚀', W / 2, 168);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 78px Arial, sans-serif';
    ctx.fillText('$' + (call.symbol || '?'), W / 2, 292);
    const mc = (!call.stale && call.curMc != null) ? call.curMc : call.entryMc;
    if (mc != null) { ctx.fillStyle = '#cfe9b0'; ctx.font = '600 46px Arial, sans-serif'; ctx.fillText((call.stale ? 'called at ' : '') + fmtUsd(mc) + ' market cap', W / 2, 372); }
    if (!call.stale && call.curX != null && isFinite(call.curX)) { ctx.fillStyle = call.curX >= 0 ? '#a8ce00' : '#ff6a6a'; ctx.font = '900 128px Arial Black, Arial, sans-serif'; ctx.fillText(xFmt(call.curX), W / 2, 520); }
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
    // a squad call's post is private to the squad, so the link goes to the squad's Calls tab rather than to a wall post nobody else can open
    const link = location.origin + (squadOf(call) ? '/squad?id=' + call.squad.id + '#calls' : (call.postId ? '/wall#p' + call.postId : '/wall'));
    let text = 'Just Send It! 🚀';
    if (call.symbol) text += ' I called $' + call.symbol + (call.entryMc != null ? ' at ' + fmtUsd(call.entryMc) + ' MC' : '');
    text += ' on $Send';
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(link), '_blank', 'noopener');
    btn.disabled = false; btn.innerHTML = orig;
    if (dataUrl && window.SFX) SFX.play('success');   // the call card image is saved
    if (window.sendToast) sendToast(dataUrl ? '🖼️ Call card saved — attach it to your tweet on X!' : 'Opening X…');
  }

  // a call made "to a squad": private to its verified members, and every point it earns is the squad's
  const squadOf = (call) => (call && call.squad && call.squad.id) ? call.squad : null;
  function squadChipHTML(sq) {
    return sq ? '<span class="comm-pill comm-pill-live sc-squad-chip">🛡️ Squad call · ' + esc(String(sq.name || 'Squad #' + sq.id).slice(0, 40)) + '</span>' : '';
  }

  function widgetHTML(call) {
    const g = call.grade || { g: 'E', emoji: '➖', label: 'Flat' };
    const sq = squadOf(call);
    const chart = (call.links && call.links.dex) || ('https://dexscreener.com/robinhood/' + call.pair);
    /* entry price + pair travel with the card so the X can be recomputed from a live on-chain spot price
       between server refreshes — the X is price ÷ entry, and the entry never changes. */
    return '<div class="sc-widget sc-g' + esc(g.g) + (call.rugged ? ' sc-is-rugged' : '') + '" data-call="' + call.id + '" data-token="' + esc(call.token) + '" data-sym="' + esc(call.symbol || '') + '" data-name="' + esc(call.name || '') + '"' +
      ' data-pair="' + esc(call.pair || '') + '" data-entry="' + esc(call.entryPrice == null ? '' : String(call.entryPrice)) + '"' +
      ' data-entrymc="' + esc(call.entryMc == null ? '' : String(call.entryMc)) + '"' +
      ' style="--tok:hsl(' + hue(call.token) + ' 72% 60%)">' +
      (call.rugged ? '<div class="sc-rugged" role="alert">💀 RUGGED! <span>Liquidity was pulled — DO NOT BUY.</span></div>' : '') +
      '<div class="sc-top">' + logo(call) +
        '<div class="sc-id"><span class="sc-name">' + esc(call.name || 'Token') + ' <b>$' + esc(call.symbol || '?') + '</b></span>' +
          '<span class="sc-when">📣 Send Call · ' + timeAgo(call.calledAt) + ' · entry ' + (call.entryMc != null ? fmtUsd(call.entryMc) + ' MC' : '$' + (call.entryPrice != null ? Number(call.entryPrice).toPrecision(3) : '—')) + '</span>' +
          squadChipHTML(sq) + '</div>' +
        '<span class="sc-grade" title="' + esc(g.label) + ' call">' + g.emoji + '<i>' + esc(g.g) + '</i><span class="sr-only sc-grade-sr"> — ' + esc(g.label) + ' call</span></span>' +
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
        '<div class="sc-senders-head">🚀 <b class="sc-senders-n">' + (call.hops || 0) + '</b> also Sent It <span class="sc-senders-sub">— still holding first</span></div>' +
        '<ol class="sc-senders-list" aria-label="Others who Sent It: those still holding first, then by what they put in, how long they have held and how far they are up">' + sendersRowsHTML((call.senders || []).slice(0, 3)) + '</ol>' +
        (call.hops > 3 ? '<button class="sc-senders-toggle" type="button" data-tip="Lists everyone who Sent It on this call" data-senders-toggle="' + call.id + '" aria-expanded="false">▾ Show all ' + call.hops + '</button>' : '') +
      '</div>' +
      '<div class="sc-hold"' + (call.holdEarned > 0 ? '' : ' hidden') + '>💎 <b class="sc-holdn">' + (call.holdEarned || 0).toLocaleString('en-US') + '</b> diamond-hands bonus' + (sq ? ' · paid to the squad' : '') + (call.stale ? '' : ' · grows while it stays in profit') + '</div>' +
      '<div class="sc-actions">' +
        '<button class="sc-btn sc-hop' + (call.hopped ? ' hopped' : '') + '" type="button" data-tip="Adds you publicly to the senders on this call — no undo" data-hop="' + call.id + '"' + (call.mineOwn ? ' disabled title="This is your own call"' : '') + '>🚀 ' + (call.hopped ? 'Sent it!' : 'Send It!') + ' <span class="sc-hopn">' + (call.hops || 0) + '</span></button>' +
        (call.wallet ? '<button class="sc-btn sc-track" type="button" data-tip="Adds that address to your wallet tracker" data-track="' + esc(call.wallet) + '" data-sym="' + esc(call.symbol || '') + '">➕ Track caller’s wallet</button>' : '') +
        '<a class="sc-btn" data-tip="Opens this pair on Dexscreener in a new tab" href="' + esc(chart) + '" target="_blank" rel="noopener nofollow">📈 Chart</a>' +
        '<button class="sc-btn sc-share" type="button" data-tip="Saves a card image and opens X to post it" data-share="' + call.id + '" title="Share this call on X — we build a card image you can attach"><span aria-hidden="true">𝕏</span><span class="sr-only">X</span> Share</button>' +
        '<button class="sc-btn sc-info" type="button" data-tip="Shows how Send Calls and their scores work" data-scinfo aria-expanded="false">ⓘ What’s a Send Call?</button>' +
      '</div>' +
      '<div class="sc-explain" hidden>' +
        (sq
          ? '<p><b>🛡️ What’s a squad call?</b> A timestamped, <b>permanent</b> shout that a token will run, made <b>privately to ' + esc(sq.name || 'this squad') + '</b> — only its verified members see it. Once posted a call can never be edited or deleted — it’s on the squad’s record forever, tracked live.</p>'
          : '<p><b>📣 What’s a Send Call?</b> A public, timestamped, <b>permanent</b> shout that a token will run. Once posted a call can never be edited or deleted — it’s on the record forever, tracked live.</p>') +
        '<p><b>Xs</b> = how far it’s run from the entry, where <b>+100% = 1x</b> (so +340% shows as +3.4x). <b>Peak since call</b> is the highest it has reached since it was called. Every call gets a live <b>grade</b> (E → S).</p>' +
        (sq
          ? '<p class="sc-explain-h"><b>How a squad call earns Send Power for the squad 🛡️</b></p>' +
            '<p><b>Every point this call earns goes to the squad</b> — the opening award, each X it hits, the diamond-hands bonus and every Send It on it all land in the squad’s total, never in a member’s own score, and no personal multiplier applies. The rules are the same as a public call:</p>'
          : '<p class="sc-explain-h"><b>How a call earns Send Power 🏆</b></p>') +
        '<ul class="sc-rules">' +
          '<li>📣 <b>+120</b> for making a call, scaled by the size of your own on-chain buy (the token needs ≥$500 liquidity, so no one can farm a dust pool). One opening award per token, ever.</li>' +
          '<li>📥 <b>Send-size boost:</b> we read on-chain the value of the tokens you bought from the pool <b>and still hold</b> — <b>every $100 = ×1 Send Power</b> (so $1,000 still held = ×10). Sell and it drops. The same applies when you 🚀 Send It on someone else’s call. The card shows what the caller and all followers put in. (Best-effort — only pool buys you still hold count.)</li>' +
          /* These four rungs are the code's: rung m = round(PTS.call_x × (1 + (m−1)×CALL_X_STEP)) with call_x 170
             and step 0.1. This card promised 170 × the X — +8,500 at 50x — for as long as the ladder had been flat. */
          '<li>🚀 <b>Per whole X it hits:</b> a milestone as each one passes — the rungs rise in a <b>straight line</b>, not with the multiple: 1x → +170, 2x → +187, 10x → +323, 50x → +1,003. No daily cap, but everything one call ever pays shares one lifetime budget, and <b>most of it is reserved for holding in profit</b> rather than for the ladder.</li>' +
          '<li>💎 <b>Diamond hands:</b> a call that <b>stays in profit</b> earns even more the <b>longer and higher</b> it holds — this bonus <b>compounds</b> over time, accruing automatically every few minutes it’s above entry.</li>' +
          '<li>🚀 <b>+30</b> to <b>Send It!</b> on someone else’s call, scaled by your own buy — it pays on a <b>verified on-chain buy</b>, and one paying position per token. Stay in profit from your entry price and you earn a 💎 <b>diamond-hands bonus on the same curve</b> the caller does — though the crew multiplier is the caller’s alone, and a Sender’s lifetime budget for one call is a quarter of theirs.</li>' +
        '</ul>' +
        '<p class="sc-explain-note">Not financial advice. Most tokens go to zero — <b>always DYOR</b>.</p>' +
      '</div>' +
      // the token's dashboard opens in the token popup where the page has one; inline, the classic detail otherwise
      (dashPopup() ? '<button class="sc-toggle sc-toggle--dash" type="button" data-tip="Opens this token’s full dashboard: chart, safety read, holders and contract" data-sctoggle aria-haspopup="dialog"><span class="sc-toggle-lbl">📊 Full dashboard</span></button>'
                   : '<button class="sc-toggle" type="button" data-tip="Expands the live on-chain data for this token" data-sctoggle aria-expanded="false"><span class="sc-toggle-lbl">Full on-chain detail</span></button>') +
      '<div class="sc-detail" hidden></div>' +
    '</div>';
  }
  // update a live widget's numbers in place (no re-render, so an open explainer / focus stays put)
  // an open thread's "The newest N of M" note, kept true as comments arrive (and gone once everything is shown)
  function syncMoreNote(row, total) {
    const note = row.querySelector('.sc-thread-more'); if (!note || total == null) return;
    const shown = row.querySelectorAll('.sc-thread .sc-cmt').length;
    if (total > shown) note.textContent = 'The newest ' + shown + ' of ' + total + ' comments.'; else note.remove();
  }
  /* A sender row brought up to date in place: the figures, the counts and which reactions are yours. Nothing focusable is
     replaced, so a focused control, an open thread and a half-typed comment all stay where they are. */
  function patchSenderRow(li, s) {
    const tpl = document.createElement('template'); tpl.innerHTML = sendersRowsHTML([s]);
    const fresh = tpl.content.firstElementChild; if (!fresh) return;
    li.classList.toggle('sc-sender-out', !s.holding);
    for (const sel of ['.sc-sender-who', '.sc-sender-stats']) {
      const a = li.querySelector(sel), b = fresh.querySelector(sel);
      if (a && b && a.innerHTML !== b.innerHTML && !a.contains(document.activeElement)) a.innerHTML = b.innerHTML;
    }
    li.querySelectorAll('[data-sreact]').forEach((b) => {
      if (b.dataset.busy) return;   // a tap on its way: its own answer sets it
      const k = b.dataset.sreact, on = (s.myReactions || []).indexOf(k) >= 0;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      const n = b.querySelector('.sc-sbtn-n'); if (n) n.textContent = (s.reactions && s.reactions[k]) || 0;
    });
    const cn = li.querySelector('[data-scmt] .sc-sbtn-n'); if (cn) cn.textContent = s.comments || 0;
    syncMoreNote(li, s.comments || 0);
  }
  function updateWidget(el, call, askedAt) {
    const g = call.grade || {};
    el.className = 'sc-widget sc-g' + (g.g || 'E') + (el.classList.contains('sc-expanded') ? ' sc-expanded' : '') + (call.rugged ? ' sc-is-rugged' : ''); // preserve the open/closed toggle state through a live refresh
    if (call.rugged && !el.querySelector('.sc-rugged')) el.insertAdjacentHTML('afterbegin', '<div class="sc-rugged" role="alert">💀 RUGGED! <span>Liquidity was pulled — DO NOT BUY.</span></div>'); // a call that just rugged mid-refresh
    // the two Xs pulse when the chain actually moved them, so a reader can see the card is live
    const setX = (n, t) => { if (!n) return; if (window.LiveX) LiveX.setText(n, t); else n.textContent = t; };
    /* This payload's price came through a 45-second server refresh; the spot source reads the pool directly
       every 2 seconds. When a live read is recent, it is simply the better number — letting the slower one
       land on top would make the X visibly jump backwards on every payload tick. */
    const spotFresh = Date.now() - Number(el.dataset.spotAt || 0) < 15000;
    const nowEl = el.querySelector('.sc-xnow');
    if (nowEl && (!spotFresh || call.stale)) { setX(nowEl, call.stale ? '—' : xFmt(call.curX)); nowEl.parentElement.className = 'sc-x ' + (call.stale ? 'sc-flat' : xClass(call.curX)); }
    const maxEl = el.querySelector('.sc-xmax');
    if (maxEl) {
      // the peak only ever rises; a server value below what the live price already reached would be a regression
      const shown = parseFloat(String(maxEl.textContent).replace('−', '-').replace(/[+x]/g, ''));
      if (!(spotFresh && isFinite(shown) && shown > call.maxX)) { setX(maxEl, xFmt(call.maxX)); maxEl.parentElement.className = 'sc-x sc-x-max ' + xClass(call.maxX); }
    }
    const cm = el.querySelector('.sc-curmc'); if (cm && (!spotFresh || call.stale)) cm.textContent = call.stale ? '—' : fmtUsd(call.curMc);
    const pm = el.querySelector('.sc-peakmc'); if (pm) pm.textContent = fmtUsd(call.peakMc);
    const gr = el.querySelector('.sc-grade'); if (gr) { gr.firstChild.textContent = g.emoji || '➖'; const i = gr.querySelector('i'); if (i) i.textContent = g.g || 'E'; const sr = gr.querySelector('.sc-grade-sr'); if (sr) sr.textContent = ' — ' + (g.label || 'Flat') + ' call'; gr.setAttribute('title', (g.label || 'Flat') + ' call'); }
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
      /* A payload asked for before this reader's last reaction or comment was built without it: drawing it would put the
         old state back. The same senders in the same order are brought up to date in place; a new order redraws the rows,
         but not under an open thread, a tap on its way or a focused control (that would close the thread, drop a
         half-typed comment, lose the focus) — the next tick catches up. */
      const stale = askedAt && Number(sw.dataset.localAt || 0) > askedAt;
      if (slist && !stale && (!stog || stog.getAttribute('aria-expanded') !== 'true')) {
        const top = (call.senders || []).slice(0, 3), rows = [...slist.querySelectorAll('.sc-sender')];
        if (rows.length === top.length && top.every((s, i) => rows[i].dataset.sender === s.username)) top.forEach((s, i) => patchSenderRow(rows[i], s));
        else if (!slist.querySelector('.sc-thread:not([hidden]), [data-busy]') && !slist.contains(document.activeElement)) slist.innerHTML = sendersRowsHTML(top);
        else top.forEach((s) => { const li = rows.find((r) => r.dataset.sender === s.username); if (li) patchSenderRow(li, s); });   // the order waits; the numbers do not
      }
    }
  }

  function dashPopup() { return !!(window.TokenModal && window.NPCard && window.NPCard.dashboardHTML); }
  // the call-time snapshot, for a token that no longer prices — so its detail never dead-ends
  async function callSnapshot(id) {
    try { const sr = await fetch('/api/calls/' + encodeURIComponent(id), { credentials: 'same-origin' }); const sj = await sr.json(); return sj && sj.snapshot; } catch { return null; }
  }
  // expand/collapse the full New-Pairs token detail under a widget (fetches the LIVE token on first open)
  async function toggleDetail(w) {
    if (!w) return;
    // the token's dashboard, in the token popup: the live read first, the call-time snapshot if the token no longer prices
    if (dashPopup()) {
      if (window.SFX) SFX.play('open');   // the token's dashboard pops up (the toggle carries no aria-expanded to say so)
      const id = w.dataset.call;
      window.TokenModal.open(w.dataset.token, { symbol: w.dataset.sym, name: w.dataset.name, fallback: async (ans) => {
        const snap = await callSnapshot(id);
        // the note says why there is no live read: the chain said the pool is gone, or we simply could not ask just now
        return snap && snap.token ? { pair: snap, note: ans && ans.notFound
          ? '<p class="tm-msg tm-note">🤷 The chain reports no trading pool for this token now. Below is the on-chain detail from when it was called, not a live read.</p>'
          : '<p class="tm-msg tm-note">⏳ We couldn’t read it live just now — below is the on-chain detail from when it was called, not a live read. Nothing here is a judgement about the token.</p>' } : null;
      } });
      return;
    }
    const detail = w.querySelector('.sc-detail'), tog = w.querySelector('[data-sctoggle]');
    const opening = !w.classList.contains('sc-expanded');
    if (window.SFX) SFX.play(opening ? 'open' : 'close');   // a tap on the card itself toggles it too, which no generic click sound covers
    w.classList.toggle('sc-expanded', opening);
    if (detail) detail.hidden = !opening;
    if (tog) { tog.setAttribute('aria-expanded', String(opening)); const lbl = tog.querySelector('.sc-toggle-lbl'); if (lbl) lbl.textContent = opening ? 'Hide on-chain detail' : 'Full on-chain detail'; }
    if (!opening || !detail || detail.dataset.loaded || detail.dataset.loading) return; // collapsing, already loaded, or a fetch is already in flight
    const token = w.dataset.token, id = w.dataset.call;
    if (!window.NPCard || !token) { detail.innerHTML = '<p class="sc-detail-msg">Full detail isn’t available here.</p>'; return; }
    detail.dataset.loading = '1';
    detail.innerHTML = '<p class="sc-detail-msg"><span class="np-live-dot" aria-hidden="true"></span> Reading the chain for the latest on-chain detail…</p>';
    const renderDetail = (p, note) => { detail.innerHTML = (note || '') + window.NPCard.detailHTML(p); if (NPCard.animateRings) NPCard.animateRings(detail); if (window.mountOnChainCharts) mountOnChainCharts(detail); detail.dataset.loaded = '1'; };   // the chart (and its transaction tape) belongs on every on-chain detail panel, here as on the radar
    try {
      const r = await fetch('/api/pairs/lookup?token=' + encodeURIComponent(token), { credentials: 'same-origin' });
      const j = await r.json();
      if (r.ok && j.pair) { renderDetail(j.pair); return; }
      // live lookup failed (delisted/rugged) → fall back to the call-time snapshot so the detail never dead-ends
      const snap = await callSnapshot(id);
      if (snap && snap.token) renderDetail(snap, '<p class="sc-detail-msg" style="text-align:left;margin:0 0 .6rem">⚠︎ Not priced right now — showing the on-chain detail from when it was called.</p>');
      // only the chain saying "no pool" justifies the harder wording; an outage gets the honest one
      else if (j && j.unavailable) detail.innerHTML = '<p class="sc-detail-msg">⏳ We couldn’t reach the price feed or the chain just now, so we can’t show the current detail. Nothing here is a judgement about this token — reopen in a moment.</p>';
      else detail.innerHTML = '<p class="sc-detail-msg">🤷 No trading pool exists for this token any more — the chain says so. The Xs above are the final record.</p>';
    } catch { detail.innerHTML = '<p class="sc-detail-msg">Couldn’t load the full detail — collapse and open it again to retry.</p>'; }
    finally { delete detail.dataset.loading; }
  }
  /* ---- reactions and comments on one sender's Sent It ---- */
  const senderPath = (w, row) => '/api/calls/' + encodeURIComponent(w.dataset.call) + '/senders/' + encodeURIComponent(row.dataset.sender);
  // the row for a sender in this card now: the live refresh and Show all redraw rows, so a tap's answer may land after its row was replaced
  const rowIn = (w, name) => [...w.querySelectorAll('.sc-sender')].find((li) => li.dataset.sender === name) || null;
  // a reaction or comment of this reader's stamps the box; a live payload asked for before the stamp is not drawn (updateWidget)
  const stampLocal = (w) => { const sw = w.querySelector('.sc-senders'); if (sw) sw.dataset.localAt = String(Date.now()); };
  // the expanded list keeps the rows it fetched (collapsing re-draws the top 3 from them), so a change is written there too
  function rememberSender(w, name, fn) {
    const wrap = w.querySelector('.sc-senders'), s = wrap && (wrap._all || []).find((x) => x.username === name);
    if (s) fn(s);
  }
  function setCommentCount(w, name, n) {
    const row = rowIn(w, name), c = row && row.querySelector('.sc-scmt .sc-sbtn-n');
    if (c && n != null) c.textContent = n;
    if (row) syncMoreNote(row, n);
    rememberSender(w, name, (s) => { s.comments = n; });
  }
  /* A write goes through the site's shared api() (auth.js) where the page has it: a refusal at the holder-proof gate
     then opens the wallet check, the way every other write does, instead of a toast nobody can act on. */
  async function senderWrite(path, body) {
    if (window.api) return window.api(path, { method: 'POST', body });
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'request failed (' + r.status + ')'); e.needsProof = !!j.needsProof; throw e; }
    return j;
  }
  function writeRefused(err, fallback) {
    if (err && err.needsProof) return;   // api() has opened the holder check
    if (window.sendToast) sendToast('⚠️ ' + ((err && err.message) || fallback));
  }
  async function senderReact(btn) {
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const row = btn.closest('.sc-sender'), w = btn.closest('.sc-widget');
    if (!row || !w || btn.dataset.busy) return;
    const kind = btn.dataset.sreact, name = row.dataset.sender;
    btn.dataset.busy = '1';
    try {
      const j = await senderWrite(senderPath(w, row) + '/react', { kind });
      stampLocal(w);
      const live = rowIn(w, name), b = (live && live.querySelector('[data-sreact="' + kind + '"]')) || btn;
      b.classList.toggle('on', !!j.on); b.setAttribute('aria-pressed', String(!!j.on));
      const n = b.querySelector('.sc-sbtn-n'); if (n) n.textContent = j.count;
      rememberSender(w, name, (s) => {
        s.reactions = Object.assign({ fire: 0, rocket: 0 }, s.reactions, { [kind]: j.count });
        s.myReactions = (s.myReactions || []).filter((k) => k !== kind).concat(j.on ? [kind] : []);
      });
      if (window.SFX) SFX.play(j.on ? 'like' : 'unlike');   // the server counted it (or took it back)
      if (j.on && j.pointsEarned && window.showPoints) { const rc = b.getBoundingClientRect(); showPoints(j.pointsEarned, rc.left, rc.top); }
    } catch (err) { writeRefused(err, 'Could not react — try again'); }
    finally { delete btn.dataset.busy; }
  }
  async function loadThread(w, row, th) {
    if (th.dataset.loading) return;
    th.dataset.loading = '1';
    th.innerHTML = '<p class="sc-thread-msg">Loading the comments…</p>';
    try {
      const r = await fetch(senderPath(w, row) + '/comments', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'http ' + r.status);
      th.innerHTML = threadHTML(row.dataset.sender, j.comments || [], j.count);
      setCommentCount(w, row.dataset.sender, j.count);
    } catch { th.innerHTML = '<p class="sc-thread-msg">Couldn’t load the comments — close them and open them again to retry.</p>'; }
    finally { delete th.dataset.loading; }
  }
  function openThread(w, row, btn, th) {
    btn.setAttribute('aria-expanded', 'true');
    th.hidden = false;
    return loadThread(w, row, th);
  }
  function toggleThread(btn) {
    const row = btn.closest('.sc-sender'), w = btn.closest('.sc-widget'), th = row && row.querySelector('.sc-thread');
    if (!th || !w) return;
    // aria-expanded flips before the read, so the generic click sound says open or close
    if (btn.getAttribute('aria-expanded') === 'true') { btn.setAttribute('aria-expanded', 'false'); th.hidden = true; }
    else openThread(w, row, btn, th);
  }
  /* Show all / Show top 3 draws the rows again. An open thread is opened again on the new row and a half-typed comment
     put back, so switching the list never throws away what someone was writing. */
  function redrawRows(list, senders) {
    const w = list.closest('.sc-widget');
    /* A thread whose comment is still posting is not reopened here: the post reopens it when the server has answered
       (postHopComment), so the reopened thread reads the comment, and the words are never put back to be posted twice. */
    const keep = [...list.querySelectorAll('.sc-sender')].filter((li) => { const th = li.querySelector('.sc-thread'); return th && !th.hidden && !th.querySelector('[data-scmt-form][data-busy]'); })
      .map((li) => ({ name: li.dataset.sender, draft: (li.querySelector('.sc-thread-input') || {}).value || '' }));
    list.innerHTML = sendersRowsHTML(senders);
    for (const k of keep) {
      const li = rowIn(w, k.name); if (!li) continue;   // not in the shorter list
      const btn = li.querySelector('[data-scmt]'), th = li.querySelector('.sc-thread');
      if (btn && th) openThread(w, li, btn, th).then(() => { const inp = th.querySelector('.sc-thread-input'); if (inp && k.draft && !inp.value) inp.value = k.draft; });
    }
  }
  async function postHopComment(form) {
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const row = form.closest('.sc-sender'), w = form.closest('.sc-widget'), th = form.closest('.sc-thread');
    const input = form.querySelector('.sc-thread-input'), btn = form.querySelector('button[type="submit"]');
    if (!row || !w || !th || !input || form.dataset.busy) return;
    const text = input.value.trim(), name = row.dataset.sender;
    if (!text) { input.focus(); return; }
    form.dataset.busy = '1'; if (btn) btn.disabled = true;
    let j = null;
    try { j = await senderWrite(senderPath(w, row) + '/comments', { text }); }
    catch (err) { writeRefused(err, 'Could not post the comment — try again'); }
    finally { delete form.dataset.busy; if (btn) btn.disabled = false; }
    /* The thread now: this one, or — when Show all / Show top 3 redrew the rows while the post was on its way — the same
       sender's new row, opened here once the server has answered, so its read includes the new comment. A post that
       failed gives its words back to the new box rather than losing them. */
    let liveTh = th;
    if (!th.isConnected) {
      const live = rowIn(w, name), btn2 = live && live.querySelector('[data-scmt]');
      liveTh = live && live.querySelector('.sc-thread');
      if (liveTh && btn2 && liveTh.hidden) await openThread(w, live, btn2, liveTh);
      const inp2 = liveTh && liveTh.querySelector('.sc-thread-input');
      if (inp2 && !j && !inp2.value) inp2.value = text;
    }
    if (!j) return;
    stampLocal(w);
    input.value = '';
    if (liveTh && liveTh.isConnected) {
      const list = liveTh.querySelector('.sc-thread-list'), empty = liveTh.querySelector('.sc-thread-list[hidden] ~ .sc-thread-msg');
      if (list && j.comment && !list.querySelector('[data-cid="' + Number(j.comment.id) + '"]')) list.insertAdjacentHTML('beforeend', hopCommentHTML(j.comment));
      if (list && list.children.length) list.hidden = false;
      if (empty && list && list.children.length) empty.remove();
    }
    setCommentCount(w, name, j.count);
    if (window.SFX) SFX.play('send');   // the comment went out
    if (window.announce) announce('Comment posted');
    if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned);
  }
  // delegated actions inside a root (expand/collapse, hop, track caller wallet, toggle explainer). Call once per container.
  function wire(root) {
    if (!root || root._scWired) return; root._scWired = true;
    root.addEventListener('submit', (e) => {
      const form = e.target.closest && e.target.closest('[data-scmt-form]');
      if (!form || !root.contains(form)) return;
      e.preventDefault();
      postHopComment(form);
    });
    root.addEventListener('click', async (e) => {
      const tog = e.target.closest('[data-sctoggle]');
      if (tog) { e.preventDefault(); toggleDetail(tog.closest('.sc-widget')); return; }
      const info = e.target.closest('[data-scinfo]');
      if (info) { const w = info.closest('.sc-widget'); const ex = w.querySelector('.sc-explain'); const open = ex.hidden; ex.hidden = !open; info.setAttribute('aria-expanded', String(open)); return; }
      const share = e.target.closest('[data-share]');
      if (share) { e.preventDefault(); shareCall(share); return; }
      const sreact = e.target.closest('[data-sreact]');
      if (sreact) { e.preventDefault(); senderReact(sreact); return; }
      const scmt = e.target.closest('[data-scmt]');
      if (scmt) { e.preventDefault(); toggleThread(scmt); return; }
      if (e.target.closest('[data-scmt-signin]')) { e.preventDefault(); if (window.AUTH) AUTH.open(); return; }
      const stog = e.target.closest('[data-senders-toggle]');
      if (stog) {
        e.preventDefault();
        const wrap = stog.closest('.sc-senders'), list = wrap.querySelector('.sc-senders-list');
        if (stog.getAttribute('aria-expanded') === 'true') { // collapse → back to top 3
          redrawRows(list, (wrap._all || []).slice(0, 3));
          stog.setAttribute('aria-expanded', 'false'); stog.innerHTML = '▾ Show all ' + ((wrap._all || []).length || stog.dataset.n || '');
          return;
        }
        if (stog.dataset.loading) return; stog.dataset.loading = '1';
        if (window.SFX) SFX.play('open');   // expanding: aria-expanded only flips after the fetch, so the generic sound would say "close"
        const label = stog.innerHTML; stog.innerHTML = 'Loading…';
        try {
          const r = await fetch('/api/calls/' + encodeURIComponent(stog.dataset.sendersToggle) + '/senders', { credentials: 'same-origin' });
          const j = await r.json();
          wrap._all = (j && j.senders) || [];
          redrawRows(list, wrap._all);
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
          if (window.SFX) SFX.play('launch');   // Sent It on the call, confirmed by the server
          if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
          const w = hop.closest('.sc-widget');
          const toSquad = !!(w && w.querySelector('.sc-squad-chip'));   // on a squad call the points are the squad's, not yours
          if (window.sendToast) sendToast('🚀 Sent it on the $' + (j.symbol || '') + ' call — ' + (toSquad ? (j.squadPoints > 0 ? 'the squad earned +' + j.squadPoints + '. Good luck!' : 'counted for the squad; points need a verified position in the token.') : 'good luck!'));
          // reveal a track-wallet button if the caller has a public wallet and one isn't already shown
          if (j.wallet && w && !w.querySelector('.sc-track')) hop.insertAdjacentHTML('afterend', '<button class="sc-btn sc-track" type="button" data-tip="Adds that address to your wallet tracker" data-track="' + esc(j.wallet) + '" data-sym="' + esc(j.symbol || '') + '">➕ Track caller’s wallet</button>');
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
          if (window.SFX) SFX.play('success');   // saved to the tracker
          if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
          if (window.sendToast) sendToast('💼 Added the caller’s wallet to your tracker');
        } catch { if (window.sendToast) sendToast('Could not track that wallet'); track.disabled = false; }
        return;
      }
      // click anywhere on the card CHROME (not a control, not inside the open detail) toggles the detail; the senders box
      // is its own conversation (rows, reactions, comment threads), so a tap in it never opens the token
      const card = e.target.closest('.sc-widget');
      if (card && !e.target.closest('.sc-actions, .sc-detail, .sc-explain, .sc-senders, a, button, input, label, form')) toggleDetail(card);
    });
  }

  /* live refresh — one source on the shared LiveX clock (livex.js). Every card on screen, in any
     container and on any page, is read in ONE request per tick and updated in place. This used to be a
     private timer here that fetched /api/calls/:id once per visible card, so eight cards on screen cost
     eight round-trips every 25s; the batch is why the Xs can now move every 12s instead. */
  let _ensured = false;
  function ensureLive() {
    if (_ensured || !window.LiveX) return;
    _ensured = true;
    LiveX.source('calls', {
      collect() {
        // capped at what the server answers in one read; without IntersectionObserver "visible" means every
        // widget on the page, and an endless wall would otherwise build an endless query string
        const ids = [...new Set(LiveX.visible('.sc-widget[data-call]').map(w => w.dataset.call).filter(Boolean))].slice(0, 40);
        return ids.length ? ids : null;
      },
      async fetch(ids) {
        const askedAt = Date.now();   // a reaction made after this moment is newer than anything in the answer
        const r = await fetch('/api/calls/live?ids=' + encodeURIComponent(ids.join(',')), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('calls live http ' + r.status);
        const j = await r.json();
        if (j && typeof j === 'object') j._askedAt = askedAt;
        return j;
      },
      apply(j) {
        (j.calls || []).forEach(call => {
          document.querySelectorAll('.sc-widget[data-call="' + call.id + '"]').forEach(w => updateWidget(w, call, j._askedAt));
        });
      },
    });
  }
  /* The X, straight off the chain.
     A card's X is price ÷ entry. The payload above carries a price that came from Dexscreener via a
     45-second server refresh, so the number could sit a minute behind a chain the card claims to be reading —
     on a token moving fast, that is the difference between what someone sees and what is true. The entry
     price never changes, so the X can be recomputed locally from a live spot read of the pool's own reserves.
     One batched request covers every card on screen, every 2 seconds.

     Only "Now" is recomputed here. The peak, the grade, the spend and the sender list stay server-owned —
     they are a permanent record that feeds points and leaderboards, and a client must not author them. The
     one exception is a peak that the live price has just exceeded: showing a "Now" above the "Peak since
     call" would be visibly wrong, so the peak is allowed to follow it up (never down) until the server's next
     tick confirms it. */
  function liveSpot() {
    if (!window.LiveX) return;
    LiveX.source('callspot', {
      every: 2000,
      collect() {
        const keys = [];
        LiveX.visible('.sc-widget[data-call]').forEach(w => {
          const pair = w.dataset.pair, entry = Number(w.dataset.entry);
          if (!pair || !(entry > 0) || w.classList.contains('sc-is-rugged')) return;
          const k = pair.toLowerCase() + ':' + String(w.dataset.token || '').toLowerCase();
          if (keys.indexOf(k) < 0) keys.push(k);
        });
        return keys.length ? keys.slice(0, 40) : null;
      },
      async fetch(keys) {
        const r = await fetch('/api/spot?pairs=' + encodeURIComponent(keys.join(',')), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error('spot http ' + r.status);
        return r.json();
      },
      apply(j) {
        const prices = (j && j.prices) || {};
        document.querySelectorAll('.sc-widget[data-call]').forEach(w => {
          const entry = Number(w.dataset.entry);
          if (!(entry > 0) || w.classList.contains('sc-is-rugged')) return;
          const price = prices[String(w.dataset.pair || '').toLowerCase() + ':' + String(w.dataset.token || '').toLowerCase()];
          if (price == null || !isFinite(price) || price <= 0) return;   // unreadable: leave the last good number alone
          const curX = price / entry - 1;
          const nowEl = w.querySelector('.sc-xnow');
          if (nowEl) { LiveX.setText(nowEl, xFmt(curX)); nowEl.parentElement.className = 'sc-x ' + xClass(curX); }
          w.dataset.spotAt = String(Date.now());   // tells the 12s payload not to overwrite this with an older price
          const mcEl = w.querySelector('.sc-curmc'), entryMc = Number(w.dataset.entrymc);
          if (mcEl && entryMc > 0) mcEl.textContent = fmtUsd(entryMc * (price / entry));   // MC scales with price
          // let the peak follow a live number that has passed it, so "Now" can never read above "Peak"
          const maxEl = w.querySelector('.sc-xmax');
          if (maxEl) {
            const shown = parseFloat(String(maxEl.textContent).replace('−', '-').replace(/[+x]/g, ''));
            if (isFinite(shown) && curX > shown) { LiveX.setText(maxEl, xFmt(curX)); maxEl.parentElement.className = 'sc-x sc-x-max ' + xClass(curX); }
          }
        });
      },
    });
  }

  function observe(root) { if (window.LiveX && root) LiveX.watch(root, '.sc-widget[data-call]'); }
  function live(root) { ensureLive(); liveSpot(); observe(root); } // shared machinery + the fast spot read, then observe this container

  window.SendCall = { widgetHTML, updateWidget, wire, live, observe };
})();
