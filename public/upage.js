/* ===== Public wall page: profile header, follow, posts + full interactions ===== */
const uname = decodeURIComponent((location.pathname.split('/u/')[1] || '').split('/')[0] || new URLSearchParams(location.search).get('u') || '');

// attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ===== "Convicted In" — pinned tokens: live mcap, Xs since conviction, paste-to-convict, hover holdings =====
function pinUsd(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
function pinNum(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return String(Math.round(n)); }
function pinDur(ms) { if (!ms) return ''; const s = Math.max(0, (Date.now() - ms) / 1000), d = s / 86400; if (d >= 365) return (d / 365 >= 10 ? Math.round(d / 365) : (d / 365).toFixed(1)) + 'y'; if (d >= 30) return Math.round(d / 30) + 'mo'; if (d >= 1) return Math.round(d) + 'd'; if (s >= 3600) return Math.round(s / 3600) + 'h'; return Math.max(1, Math.round(s / 60)) + 'm'; }
function pinXsChip(xs) {
  if (xs == null) return '';
  if (xs >= 1) return '<span class="pin-chip-xs up" role="img" aria-label="Up ' + xs.toFixed(xs < 10 ? 1 : 0) + 'x since you convicted" title="Up since you convicted (price ×' + (xs + 1).toFixed(1) + ')">▲ ' + xs.toFixed(xs < 10 ? 1 : 0) + 'x</span>';
  if (xs >= 0) return '<span class="pin-chip-xs up" role="img" aria-label="Up ' + Math.round(xs * 100) + '% since you convicted" title="Up since you convicted">▲ +' + Math.round(xs * 100) + '%</span>';
  return '<span class="pin-chip-xs down" role="img" aria-label="Down ' + Math.round(Math.abs(xs) * 100) + '% since you convicted" title="Down since you convicted">▼ ' + Math.round(Math.abs(xs) * 100) + '%</span>';
}
function pinChip(p, mine, owner) {
  const logo = (p.brand && p.brand.imageUrl)
    ? '<img class="pin-chip-logo" src="' + esc(p.brand.imageUrl) + '" alt="" loading="lazy" decoding="async">'
    : '<span class="pin-chip-logo-none" aria-hidden="true">🪙</span>';
  const sym = p.symbol ? '$' + esc(p.symbol) : 'Token';
  const tipId = 'pintip-' + esc(p.token);
  const conv = (p.conviction && p.conviction.live)
    ? '<a class="conv-badge" href="/community.html?id=' + encodeURIComponent(p.conviction.communityId) + '" title="' + esc(p.conviction.title) + ' — member level in the ' + sym + ' community" aria-label="Conviction ' + esc(p.conviction.title) + ', level ' + p.conviction.level + ' in the ' + sym + ' community">💎 Lv ' + p.conviction.level + '</a>'
    : '';
  const stats = '<span class="pin-chip-stats">' + (p.curMc != null ? '<span class="pin-chip-mc" role="img" aria-label="Market cap ' + pinUsd(p.curMc) + '" title="Current market cap">💰 ' + pinUsd(p.curMc) + '</span>' : '') + pinXsChip(p.xs) + '</span>';
  const comm = window.tokenCommunitySlot ? tokenCommunitySlot(p.token, p.symbol || '') : ''; // 🏘️ Community / ＋ Start community (filled by tokentext.js)
  return '<span class="pin-chip" data-token="' + esc(p.token) + '" data-owner="' + esc(owner) + '" data-sym="' + esc(p.symbol || '') + '">' +
    '<button class="pin-chip-open" type="button" aria-describedby="' + tipId + '" data-pin-view="' + esc(p.token) + '" data-sym="' + esc(p.symbol || '') + '" data-name="' + esc(p.name || '') + '">' + logo + '<span class="pin-chip-sym">' + sym + '</span></button>' + conv + stats + comm +
    (mine ? '<button class="pin-chip-rm" type="button" data-pin-rm="' + esc(p.token) + '" data-sym="' + esc(p.symbol || '') + '" aria-label="Remove ' + sym + ' from your convictions">✕</button>' : '') +
    '<span class="pin-hover" role="tooltip" id="' + tipId + '" aria-live="polite"><span class="pin-hover-load">holdings load on hover…</span></span>' +
    '</span>';
}
function renderPins(u) {
  const box = document.getElementById('pub-pins');
  if (!box) return;
  box._isMe = !!u.isMe; box._uname = u.username;
  fetch('/api/pins?user=' + encodeURIComponent(u.username), { credentials: 'same-origin' })
    .then(r => r.json()).then(j => {
      const pins = j.pins || [];
      if (!pins.length && !u.isMe) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      const sub = u.isMe ? 'tokens you’re convicted in — hover to see your holdings' : 'tokens @' + esc(u.username) + ' is convicted in — hover a token';
      const head = '<div class="wall-pins-head">💎 Convicted In <span class="wall-pins-sub">' + sub + '</span></div>';
      const list = pins.length ? '<div class="wall-pins-list">' + pins.map(p => pinChip(p, u.isMe, u.username)).join('') + '</div>' : '';
      const empty = (!pins.length && u.isMe) ? '<p class="wall-pins-empty">Convict a token to show it here — paste its contract below, or open any token’s on-chain details anywhere and tap <b>📌 Pin to my wall</b>.</p>' : '';
      const adder = u.isMe ? '<form class="pin-add" autocomplete="off"><label class="sr-only" for="pin-add-input">Token contract address to convict</label><input class="addr-input pin-add-input" id="pin-add-input" type="text" inputmode="text" spellcheck="false" placeholder="Paste a contract to convict (0x…)" pattern="0x[0-9a-fA-F]{40}"><button class="btn btn-primary btn-sm pin-add-go" type="submit">💎 Convict</button></form><p class="pin-add-msg" role="status" aria-live="polite"></p>' : '';
      box.innerHTML = head + list + empty + adder;
    }).catch(() => { box.hidden = true; });
}
(function wirePins() {
  const box = document.getElementById('pub-pins');
  if (!box) return;
  // a pin toggled from anywhere on the page (e.g. inside the detail popup) → refresh "Convicted In" live
  document.addEventListener('pins:changed', () => { if (box._uname) renderPins({ username: box._uname, isMe: box._isMe }); });
  // lazily fetch the owner's on-chain holding (amount + how long held) into the chip's hover tooltip
  async function loadHold(chip) {
    if (chip._loaded) return; chip._loaded = true;
    const tip = chip.querySelector('.pin-hover'); if (!tip) return;
    try {
      const j = await fetch('/api/pins/holding?user=' + encodeURIComponent(chip.dataset.owner) + '&token=' + encodeURIComponent(chip.dataset.token), { credentials: 'same-origin' }).then(r => r.json());
      const symTxt = chip.dataset.sym ? '$' + esc(chip.dataset.sym) : 'this token';
      let html;
      if (!j.hasWallet) html = '<span class="pin-hover-note">No wallet linked — a conviction, not verified holdings. Tap to see the token.</span>';
      else if (j.held) {
        const amt = pinNum(j.amountTok) + ' ' + symTxt + (j.amountUsd ? ' <span class="pin-hover-usd">(~' + pinUsd(j.amountUsd) + ')</span>' : '');
        const since = j.heldSinceMs ? ('held ' + (j.approx ? '≥ ' : '') + pinDur(j.heldSinceMs)) : 'currently holding';
        html = '<b class="pin-hover-hold">🪙 Holds ' + amt + '</b><span class="pin-hover-since">⏳ ' + since + '</span>';
      } else html = '<span class="pin-hover-note">Wallet holds none right now.</span>';
      tip.innerHTML = html;
    } catch { tip.innerHTML = '<span class="pin-hover-note">Couldn’t load holdings.</span>'; }
  }
  box.addEventListener('mouseover', (e) => { const chip = e.target.closest('.pin-chip'); if (chip) loadHold(chip); });
  box.addEventListener('focusin', (e) => { const chip = e.target.closest('.pin-chip'); if (chip) loadHold(chip); });
  // paste-to-convict (own wall)
  box.addEventListener('submit', async (e) => {
    const form = e.target.closest('.pin-add'); if (!form) return;
    e.preventDefault();
    const msg = box.querySelector('.pin-add-msg'), inp = form.querySelector('.pin-add-input'), go = form.querySelector('.pin-add-go');
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    const token = (inp.value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) { msg.textContent = '⚠️ Paste a valid 0x token contract address.'; return; }
    go.disabled = true; msg.textContent = '🔎 Reading the token on-chain…';
    try {
      const r = await fetch('/api/pins', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { inp.value = ''; msg.textContent = ''; if (window.sendToast) sendToast('💎 Convicted in ' + (j.symbol ? '$' + j.symbol : 'that token') + '!'); if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 40, emojiRatio: 0.5 }); document.dispatchEvent(new CustomEvent('pins:changed')); }
      else { go.disabled = false; msg.textContent = '⚠️ ' + (j.error || 'Could not convict that token.'); }
    } catch { go.disabled = false; msg.textContent = '⚠️ Could not convict that token — try again.'; }
  });
  box.addEventListener('click', async (e) => {
    // remove ✕ (own wall) — destructive, stays its own action
    const rm = e.target.closest('[data-pin-rm]');
    if (rm) {
      rm.disabled = true;
      try {
        await fetch('/api/pins', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: rm.dataset.pinRm }) });
        if (window.sendToast) sendToast('Unpinned ' + (rm.dataset.sym ? '$' + rm.dataset.sym : 'token') + ' 📌');
        renderPins({ username: box._uname, isMe: box._isMe });
      } catch { rm.disabled = false; }
      return;
    }
    // the 💎 conviction badge and the 🏘️ community tag are real links — let them navigate, don't hijack them
    if (e.target.closest('.conv-badge') || e.target.closest('.tok-comm')) return;
    // click ANYWHERE else on the chip (logo, symbol, market cap, ▲x, padding) pops up the token info
    const chip = e.target.closest('.pin-chip');
    if (chip && window.TokenModal) {
      // don't hijack a text drag-select over the chip's stats into a modal open (a real click collapses the selection first)
      const sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && chip.contains(sel.anchorNode)) return;
      const btn = chip.querySelector('[data-pin-view]');
      if (btn) btn.focus(); // opened from a dead region → focus the chip's button so the modal restores focus here (not <body>) on close
      TokenModal.open(chip.dataset.token, { symbol: chip.dataset.sym || (btn && btn.dataset.sym) || '', name: (btn && btn.dataset.name) || '' });
    }
  });
})();

function applyTheme(t) {
  if (!t) return;
  if (t.accent) {
    document.documentElement.style.setProperty('--accent', t.accent);
    const nameLine = document.getElementById('pub-name-line');
    nameLine.style.color = t.accent;
    nameLine.style.textShadow = '0 0 30px ' + t.accent + '66';
  }
  if (t.wall_bg) { document.body.style.background = t.wall_bg; document.body.classList.add('themed-page'); }
  if (t.bg_img) {
    document.body.style.backgroundImage = 'linear-gradient(rgba(6,8,12,0.82), rgba(6,8,12,0.9)), url(' + t.bg_img + ')';
    document.body.classList.add('themed-page');
  }
  if (t.header_img) { const h = document.getElementById('header-img'); h.src = t.header_img; h.hidden = false; }
  // avatar: the wrap owns the circle; toggle the permanent img/emoji children (show the image only once it proves it loaded)
  const aimg = document.getElementById('pub-avatar-img'), aemo = document.getElementById('pub-avatar');
  if (t.avatar_img) {
    aimg.addEventListener('load', () => { aimg.hidden = false; aemo.hidden = true; }, { once: true });
    aimg.addEventListener('error', () => { aimg.hidden = true; aemo.hidden = false; }, { once: true });
    aimg.src = t.avatar_img;
  } else { aimg.hidden = true; aemo.hidden = false; }
}

// real U+2212 minus for negatives; positives stay neutral (no + / $ — voting is a signal, not money)
function fmtScore(n) { n = n | 0; return n < 0 ? '−' + Math.abs(n) : String(n); }

// SHARED post card — kept byte-identical with wall.js (only the data source differs)
function postEl(p) {
  const el = document.createElement('article');
  el.className = 'post';
  el.dataset.id = p.id;
  el.dataset.score = p.score;
  const uHref = '/u/' + encodeURIComponent(p.username);
  if (p.accent) el.style.borderColor = p.accent + '55';
  const ava = p.avatar_img
    ? '<a href="' + uHref + '" aria-hidden="true" tabindex="-1"><img class="post-avatar" src="' + esc(p.avatar_img) + '" alt="" style="object-fit:cover;"></a>'
    : '<a class="post-avatar" href="' + uHref + '" aria-hidden="true" tabindex="-1" style="text-decoration:none;">' + esc(p.avatar) + '</a>';
  const up = p.myVote === 1, down = p.myVote === -1, sTxt = fmtScore(p.score);
  // own posts show a read-only score (no self-voting); everyone else gets the interactive up/down arrows
  const voteHTML = p.mine
    ? '<div class="vote vote-own" role="group" aria-label="Your post · score ' + sTxt + '">' +
        '<svg class="vote-ico vote-static" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5l6 8H4z"/></svg>' +
        '<span class="vote-score' + (p.score < 0 ? ' neg' : '') + '">' + sTxt + '</span>' +
        '<svg class="vote-ico vote-static" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15L4 7h12z"/></svg>' +
      '</div>'
    : '<div class="vote" role="group" aria-label="Score ' + sTxt + '. Upvote or downvote.">' +
        '<button class="vote-btn vote-up' + (up ? ' on' : '') + '" data-vote="up" aria-pressed="' + up + '" aria-label="Upvote">' +
          '<svg class="vote-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 5l6 8H4z"/></svg></button>' +
        '<span class="vote-score' + (p.score < 0 ? ' neg' : '') + '" aria-hidden="true">' + sTxt + '</span>' +
        '<button class="vote-btn vote-down' + (down ? ' on' : '') + '" data-vote="down" aria-pressed="' + down + '" aria-label="Downvote">' +
          '<svg class="vote-ico" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 15L4 7h12z"/></svg></button>' +
        '<span class="sr-only" role="status" data-vote-status></span>' +
      '</div>';
  el.innerHTML =
    '<div class="post-head">' + ava +
      '<div><div class="who"><a class="handle" href="' + uHref + '" style="text-decoration:none;' + (p.accent ? 'color:' + esc(p.accent) : '') + '">@' + esc(p.username) + '</a>' + (window.ogBadge ? ogBadge(p.og) : '') + '</div>' +
      '<div class="when">' + timeAgo(p.created_at) + '</div></div>' +
    '</div>' +
    (p.text ? '<div class="post-body">' + (window.richText ? richText(p.text, p.tokens) : esc(p.text)) + '</div>' : '') + // $TICKERs → token chips (tokentext.js)
    (p.image ? window.mediaTag(esc(p.image), esc(p.username)) : '') +
    (p.call && window.SendCall ? SendCall.widgetHTML(Object.assign(p.call, { mineOwn: p.mine })) : '') +
    '<div class="post-actions">' +
      voteHTML +
      '<span class="act-sep" aria-hidden="true"></span>' +
      '<button class="react-btn' + (p.myReactions.includes('fire') ? ' lit' : '') + '" data-react="fire" aria-label="React with fire">🔥 <span>' + p.reactions.fire + '</span></button>' +
      '<button class="react-btn' + (p.myReactions.includes('rocket') ? ' lit' : '') + '" data-react="rocket" aria-label="React with rocket">🚀 <span>' + p.reactions.rocket + '</span></button>' +
      '<button class="react-btn" data-comments aria-expanded="false" aria-label="Show comments">💬 <span>' + p.comments + '</span></button>' +
      (p.mine && !p.call ? '<button class="react-btn post-del" data-del aria-label="Delete your post">🗑</button>' : '') + // Send Calls are final — no delete
    '</div>' +
    '<div class="comments" hidden></div>';
  return el;
}
function setVote(post, score, myVote) {
  const grp = post.querySelector('.vote');
  const up = grp.querySelector('.vote-up'), dn = grp.querySelector('.vote-down'), sc = grp.querySelector('.vote-score');
  sc.textContent = fmtScore(score); sc.classList.toggle('neg', score < 0);
  up.classList.toggle('on', myVote === 1); up.setAttribute('aria-pressed', String(myVote === 1));
  dn.classList.toggle('on', myVote === -1); dn.setAttribute('aria-pressed', String(myVote === -1));
  grp.setAttribute('aria-label', 'Score ' + fmtScore(score) + '. Upvote or downvote.');
  grp.querySelector('[data-vote-status]').textContent =
    (myVote === 1 ? 'Upvoted. ' : myVote === -1 ? 'Downvoted. ' : 'Vote cleared. ') + 'Score ' + fmtScore(score) + '.';
  post.dataset.score = score;
}

document.getElementById('feed').addEventListener('click', async (e) => {
  const post = e.target.closest('.post'); if (!post) return;
  const id = post.dataset.id;

  const vBtn = e.target.closest('[data-vote]');
  if (vBtn) {
    if (!AUTH.user) { AUTH.open(); return; }
    try {
      const j = await api('/api/posts/' + id + '/vote', { method: 'POST', body: { dir: vBtn.dataset.vote } });
      setVote(post, j.score, j.myVote);
      vBtn.classList.remove('pop'); void vBtn.offsetWidth; vBtn.classList.add('pop');
      if (j.pointsEarned && window.showPoints) { const r = vBtn.getBoundingClientRect(); showPoints(j.pointsEarned, r.left, r.top); }
    } catch (err) { sendToast(err.message); }
    return;
  }

  const dBtn = e.target.closest('[data-del]');
  if (dBtn) {
    if (dBtn.dataset.armed) {
      try { await api('/api/posts/' + id, { method: 'DELETE' }); post.remove(); sendToast('Unsent 🫥'); }
      catch (err) { sendToast(err.message); }
    } else {
      const oldLbl = dBtn.getAttribute('aria-label');
      dBtn.dataset.armed = '1'; dBtn.textContent = 'Sure? 🗑'; dBtn.style.color = 'var(--red)';
      dBtn.setAttribute('aria-label', 'Confirm delete — tap again within 4 seconds'); // the arm state must be perceivable without sight
      if (window.announce) announce('Tap delete again to confirm. Expires in 4 seconds.');
      setTimeout(() => { delete dBtn.dataset.armed; dBtn.textContent = '🗑'; dBtn.style.color = ''; if (oldLbl) dBtn.setAttribute('aria-label', oldLbl); else dBtn.removeAttribute('aria-label'); }, 4000);
    }
    return;
  }

  const rBtn = e.target.closest('[data-react]');
  if (rBtn) {
    if (!AUTH.user) { AUTH.open(); return; }
    try {
      const j = await api('/api/posts/' + id + '/react', { method: 'POST', body: { kind: rBtn.dataset.react } });
      rBtn.classList.toggle('lit', j.on);
      rBtn.querySelector('span').textContent = j.count;
      if (j.on) { const r = rBtn.getBoundingClientRect(); sendConfetti(r.left + r.width / 2, r.top, { count: 10, emojiRatio: 1 }); if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top); }
    } catch (err) { sendToast(err.message); }
    return;
  }
  const cBtn = e.target.closest('[data-comments]');
  if (cBtn) {
    const zone = post.querySelector('.comments');
    const open = !zone.hidden;
    zone.hidden = open;
    cBtn.setAttribute('aria-expanded', String(!open));
    if (!open) await renderComments(post, id);
  }
});

async function renderComments(post, id) {
  const zone = post.querySelector('.comments');
  zone.innerHTML = '<p class="modal-note">loading…</p>';
  try {
    const j = await api('/api/posts/' + id + '/comments');
    zone.innerHTML = '';
    for (const c of j.comments) {
      const d = document.createElement('div');
      d.className = 'comment';
      const cAva = c.avatar_img ? '<img class="c-ava" src="' + esc(c.avatar_img) + '" alt="" style="width:22px; height:22px; border-radius:50%; object-fit:cover;">' : '<span class="c-ava" aria-hidden="true">' + esc(c.avatar) + '</span>';
      d.innerHTML = cAva + '<div><a class="c-who" href="/u/' + encodeURIComponent(c.username) + '" style="text-decoration:none;">@' + esc(c.username) + '</a>' + (window.ogBadge ? ogBadge(c.og) : '') + ' <span class="c-text">' + (window.richText ? richText(c.text, c.tokens) : esc(c.text)) + '</span></div>';
      zone.appendChild(d);
    }
    if (!j.comments.length) zone.innerHTML = '<p class="modal-note">no comments yet — start it off 👇</p>';
    if (AUTH.user) {
      const form = document.createElement('form');
      form.className = 'comment-form';
      form.innerHTML = '<input class="addr-input" maxlength="300" placeholder="add a comment…" aria-label="Write a comment"><button class="btn btn-primary btn-sm" type="submit">Reply</button>';
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const input = form.querySelector('input');
        if (!input.value.trim()) return;
        try {
          const cj = await api('/api/posts/' + id + '/comments', { method: 'POST', body: { text: input.value } });
          input.value = '';
          await renderComments(post, id);
          const n = post.querySelector('[data-comments] span');
          n.textContent = Number(n.textContent) + 1;
          if (cj.pointsEarned && window.showPoints) showPoints(cj.pointsEarned);
        } catch (err) { sendToast(err.message); }
      });
      zone.appendChild(form);
    }
  } catch { zone.innerHTML = '<p class="modal-note">could not load comments</p>'; }
}

/* follow + share */
function setFollowUI(on, followers) {
  const btn = document.getElementById('follow-btn');
  btn.classList.toggle('on', on);
  btn.textContent = on ? '✓ Following' : '＋ Follow';
  btn.setAttribute('aria-pressed', String(on));
  if (followers != null) document.getElementById('st-followers').textContent = followers;
}
document.getElementById('follow-btn').addEventListener('click', async () => {
  if (!AUTH.user) { AUTH.open(); return; }
  try {
    const j = await api('/api/users/' + encodeURIComponent(uname) + '/follow', { method: 'POST' });
    setFollowUI(j.following, j.followers);
    if (j.following) {
      const r = document.getElementById('follow-btn').getBoundingClientRect();
      sendConfetti(r.left + r.width / 2, r.top, { count: 22, emojiRatio: 0.5 });
      sendToast('Following @' + uname + ' ⭐');
      if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top);
    } else sendToast('Unfollowed');
  } catch (err) { sendToast(err.message); }
});
document.getElementById('share-btn').addEventListener('click', async () => {
  const url = location.origin + '/u/' + encodeURIComponent(uname);
  try {
    await navigator.clipboard.writeText(url);
    sendToast('Wall link copied 🔗 — go spread it');
    sendConfetti(innerWidth / 2, innerHeight / 3, { count: 18, emojiRatio: 0.5 });
  } catch { sendToast(url); }
});

async function loadPage() {
  if (!uname) { document.getElementById('notfound').style.display = ''; document.getElementById('who-hero').hidden = true; return; }
  try {
    const j = await api('/api/users/' + encodeURIComponent(uname));
    const u = j.user;
    document.title = '@' + u.username + ' — $Send · Just Send It 👤';
    // per-user canonical + meta so each public wall is its own indexable page (SEO)
    try {
      const canonUrl = location.origin + '/u/' + encodeURIComponent(u.username);
      let canon = document.querySelector('link[rel="canonical"]');
      if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
      canon.href = canonUrl;
      const desc = '@' + u.username + ' on the $Send Send Wall — their sends, Send Calls, and the tokens they’re convicted in. Follow, react, and join the $Send / $GWC meme community on Robinhood Chain. Entertainment only.';
      const setMeta = (sel, val) => { const m = document.querySelector(sel); if (m) m.setAttribute('content', val); };
      setMeta('meta[name="description"]', desc);
      setMeta('meta[property="og:title"]', '@' + u.username + ' — $Send · Just Send It 🚀');
      setMeta('meta[property="og:description"]', desc);
      setMeta('meta[property="og:url"]', canonUrl);
    } catch (e) {}
    document.getElementById('pub-avatar').textContent = u.avatar;
    document.getElementById('pub-username').textContent = u.username;
    const nl = document.getElementById('pub-name-line'); // permanent OG badge in the header, next to the @name
    if (nl) { const old = nl.querySelector('.og-badge'); if (old) old.remove(); if (u.og && window.ogBadge) nl.insertAdjacentHTML('beforeend', ' ' + ogBadge(u.og)); }
    document.getElementById('pub-bio').textContent = u.bio || 'here to send it 🚀';
    const soc = document.getElementById('pub-socials');
    if (soc) { // handles are server-validated to [A-Za-z0-9_.] so they're safe to interpolate
      let sh = '';
      if (u.twitter) sh += '<a class="wall-soc wall-soc-x" href="https://x.com/' + u.twitter + '" target="_blank" rel="noopener nofollow">🐦 @' + u.twitter + '</a>';
      if (u.instagram) sh += '<a class="wall-soc wall-soc-ig" href="https://instagram.com/' + u.instagram + '" target="_blank" rel="noopener nofollow">📸 @' + u.instagram + '</a>';
      soc.innerHTML = sh; soc.hidden = !sh;
    }
    if (window.WallCheckin) WallCheckin.paint(!!u.isMe); // daily check-in card (own wall only)
    renderPins(u); // "Convicted In" pinned tokens
    document.getElementById('st-posts').textContent = u.posts;
    document.getElementById('st-followers').textContent = u.followers;
    document.getElementById('st-following').textContent = u.following;
    document.getElementById('st-fires').textContent = u.reactionsReceived;
    document.getElementById('pub-joined').textContent = new Date(u.joined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    if (u.level != null) {
      const lvl = document.getElementById('pub-level');
      lvl.textContent = '⭐ Lvl ' + u.level + ' · ' + (u.title || '') + (u.rank ? ' · #' + u.rank : '');
      lvl.hidden = false;
    }
    if (u.diamond) {
      const dia = document.getElementById('pub-diamond');
      dia.textContent = u.diamond.emoji + ' ' + u.diamond.name + ' · Diamond Lv ' + u.diamond.level;
      dia.hidden = false;
    }
    applyTheme(u.theme);
    if (u.isMe) {
      document.getElementById('edit-btn').hidden = false;
      // post like X, right from your own wall
      document.getElementById('pc-avatar').textContent = u.avatar;
      const pch = document.getElementById('pc-handle'); pch.textContent = u.username;
      if (u.og && window.ogBadge) pch.insertAdjacentHTML('afterend', ogBadge(u.og));
      document.getElementById('profile-composer').hidden = false;
    } else { document.getElementById('follow-btn').hidden = false; setFollowUI(u.iFollow); }
    const f = await api('/api/posts?user=' + encodeURIComponent(uname));
    const feed = document.getElementById('feed');
    feed.innerHTML = '';
    for (const p of f.posts) feed.appendChild(postEl(p));
    if (window.SendCall) { SendCall.wire(feed); SendCall.live(feed); SendCall.observe(feed); }
    document.getElementById('empty').style.display = f.posts.length ? 'none' : '';
    setupCallTabs(u); // Send Calls tab + leaderboard
  } catch {
    if (window.WallCheckin) WallCheckin.paint(false);
    document.getElementById('who-hero').hidden = true;
    document.getElementById('notfound').style.display = '';
  }
}
/* own-wall composer — post like X, right from your profile */
(function setupComposer() {
  const ta = document.getElementById('pc-text');
  if (!ta) return;
  const pcCount = document.getElementById('pc-count');
  const setPcCount = (n) => { pcCount.textContent = n; pcCount.setAttribute('aria-hidden', n > 20 ? 'true' : 'false'); }; // announce to SRs only when low
  ta.addEventListener('input', () => setPcCount(500 - ta.value.length));
  let pcImg = null;
  const pcImgEl = document.getElementById('pc-img'), pcStatus = document.getElementById('pc-status');
  const clearPcMedia = () => { pcImg = null; pcImgEl._attachGen = (pcImgEl._attachGen || 0) + 1; pcImgEl.value = ''; window.setMediaPreview(document.getElementById('pc-preview'), null); };
  pcImgEl.addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const btn = document.getElementById('pc-publish'); btn.disabled = true;
    const r = await window.guardedAttach(e.target, f, document.getElementById('pc-preview'), clearPcMedia, m => { if (pcStatus) pcStatus.textContent = m; });
    btn.disabled = false;
    if (r && r.skip) return;
    if (!r) { clearPcMedia(); return; }
    pcImg = r.url;
  });
  document.getElementById('pc-publish').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (pcImgEl._busy) { sendToast('Hang on — still uploading your media ⏳'); return; }
    if (!text && !pcImg) { sendToast('Say something or drop a meme first 🤌'); return; }
    const btn = document.getElementById('pc-publish'); btn.disabled = true;
    try {
      const j = await api('/api/posts', { method: 'POST', body: { text, image: pcImg } });
      ta.value = ''; setPcCount(500); if (pcStatus) pcStatus.textContent = '';
      pcImg = null; window.setMediaPreview(document.getElementById('pc-preview'), null);
      document.getElementById('pc-img').value = '';
      document.getElementById('feed').prepend(postEl(j.post));
      document.getElementById('empty').style.display = 'none';
      const st = document.getElementById('st-posts'); if (st) st.textContent = Number(st.textContent) + 1;
      sendConfetti(innerWidth / 2, 240, { count: 46, emojiRatio: 0.4 });
      sendToast('SENT! 🚀');
      if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned);
    } catch (err) { sendToast(err.message); }
    btn.disabled = false;
  });
})();

// a post made from the global compose FAB lands live on your own wall too
document.addEventListener('post:created', (e) => {
  const feed = document.getElementById('feed');
  if (e.detail && feed && uname && e.detail.username && e.detail.username.toLowerCase() === uname.toLowerCase()) {
    feed.prepend(postEl(e.detail));
    document.getElementById('empty').style.display = 'none';
    const st = document.getElementById('st-posts'); if (st) st.textContent = Number(st.textContent) + 1;
  }
});

window.onAuthReady = function () { loadPage(); };

/* ===== Send Calls tab + leaderboard on the public wall ===== */
const _lbWindows = [['24h', '24h'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All time']];
const _xf = (x, d) => (x == null || !isFinite(x)) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d == null ? 2 : d) + 'x';
function setupCallTabs(u) {
  const tabs = [...document.querySelectorAll('.wall-tab')];
  if (!tabs.length) return;
  const panels = { posts: document.getElementById('panel-posts'), calls: document.getElementById('panel-calls'), lb: document.getElementById('panel-lb') };
  function activate(name) {
    tabs.forEach(t => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    Object.keys(panels).forEach(k => { if (panels[k]) panels[k].hidden = k !== name; });
    if (name === 'calls') loadCalls(u);            // re-fetch each time so a just-made call shows without a full reload
    if (name === 'lb') loadLeaderboard('all');
  }
  tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));
  // ←/→/Home/End on the role=tablist are handled by the shared delegated handler in app.js (a local handler here double-fired)
  const lbHelp = document.getElementById('lb-help');
  if (lbHelp) lbHelp.addEventListener('click', () => { const ex = document.getElementById('lb-explain'); const open = ex.hidden; ex.hidden = !open; lbHelp.setAttribute('aria-expanded', String(open)); });
}
async function loadCalls(u) {
  const statsEl = document.getElementById('sc-stats'), listEl = document.getElementById('sc-list');
  statsEl.innerHTML = '<div class="sc-stat-load">Loading Send Calls…</div>';
  try {
    const j = await api('/api/calls?user=' + encodeURIComponent(uname));
    const s = j.stats;
    statsEl.innerHTML = s.count
      ? '<div class="sc-stat"><b>' + s.count + '</b><i>Calls made</i></div>' +
        '<div class="sc-stat"><b class="' + (s.bestX > 0 ? 'sc-up' : '') + '">' + _xf(s.bestX) + '</b><i>Best ' + (s.bestGrade ? s.bestGrade.emoji : '') + '</i></div>' +
        '<div class="sc-stat"><b>' + _xf(s.totalX, 1) + '</b><i>Total Xs</i></div>' +
        '<div class="sc-stat"><b>' + s.hits + '</b><i>2x+ hits</i></div>'
      : '';
    if (!s.count) { listEl.innerHTML = '<div class="empty-wall"><div style="font-size:2.5rem;" aria-hidden="true">📣</div><p>' + (u.isMe ? 'No Send Calls yet — head to <a href="/newpairs.html">New Pairs</a> and call a token! 🚀' : '@' + esc(u.username) + ' hasn’t made any Send Calls yet.') + '</p></div>'; return; }
    listEl.innerHTML = s.calls.map(c => SendCall.widgetHTML(Object.assign(c, { mineOwn: u.isMe }))).join('');
    if (window.SendCall) { SendCall.wire(listEl); SendCall.live(listEl); SendCall.observe(listEl); }
  } catch { statsEl.innerHTML = ''; listEl.innerHTML = '<div class="empty-wall"><p>Couldn’t load Send Calls.</p></div>'; }
}
async function loadLeaderboard(win) {
  win = win || 'all';
  const winEl = document.getElementById('lb-windows'), listEl = document.getElementById('lb-list');
  winEl.innerHTML = _lbWindows.map(w => '<button class="lb-win' + (w[0] === win ? ' active' : '') + '" type="button" data-win="' + w[0] + '" aria-pressed="' + (w[0] === win) + '">' + w[1] + '</button>').join('');
  winEl.querySelectorAll('.lb-win').forEach(b => b.addEventListener('click', () => loadLeaderboard(b.dataset.win)));
  listEl.innerHTML = '<li class="lb-load">Loading…</li>';
  try {
    const j = await api('/api/calls/leaderboard?window=' + win);
    if (!j.top.length) { listEl.innerHTML = '<li class="lb-empty">No Send Calls in this window yet — be the first! 🚀</li>'; return; }
    listEl.innerHTML = j.top.map(t => {
      const ava = t.avatar_img ? '<img class="lb-ava" src="' + esc(t.avatar_img) + '" alt="">' : '<span class="lb-ava lb-ava-emo" aria-hidden="true">' + esc(t.avatar) + '</span>';
      return '<li class="lb-row' + (t.rank <= 3 ? ' lb-top' : '') + '"><span class="lb-rank">' + t.rank + '</span>' + ava +
        '<a class="lb-name" href="/u/' + encodeURIComponent(t.username) + '" style="' + (t.accent ? 'color:' + esc(t.accent) : '') + '">@' + esc(t.username) + '</a>' + (window.ogBadge ? ogBadge(t.og) : '') +
        '<span class="lb-grade" title="Best call">' + (t.bestGrade ? t.bestGrade.emoji : '') + '</span>' +
        '<span class="lb-x"><b>' + _xf(t.totalX, 1) + '</b><i>' + t.calls + ' call' + (t.calls === 1 ? '' : 's') + ' · best ' + _xf(t.bestX, 1) + '</i></span></li>';
    }).join('');
  } catch { listEl.innerHTML = '<li class="lb-empty">Couldn’t load the leaderboard.</li>'; }
}

/* ===== Daily check-in — own wall only =====
 * Showing up is something you DO: the daily Send Power bonus used to land silently on page load,
 * now it's an explicit tap. Server (POST /api/checkin) is idempotent per UTC day, so a double tap
 * is harmless — { already, awarded, checkedInToday }. Rendered into #checkin by WallCheckin.paint(isMe),
 * which loadPage() calls with the server's own u.isMe. Styles live in /checkin.css. */
(function wallCheckin() {
  const host = document.getElementById('checkin');
  if (!host) return;

  const signedIn = () => !!(window.AUTH && AUTH.user);
  const say = (t) => { if (window.announce) window.announce(t); };
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const nf = (n) => Number(n || 0).toLocaleString('en-US');

  let timer = null, io = null, onScreen = true, shown = false;

  /* ---------- next UTC midnight ---------- */
  function nextResetMs() {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); // tomorrow 00:00 UTC
  }
  function clockText(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return h + 'h ' + p(m) + 'm ' + p(ss) + 's';
  }

  /* ---------- the two states ---------- */
  function renderReady() {
    stopTick();
    host.innerHTML =
      '<div class="card ci-card">' +
        '<div class="ci-head"><span class="ci-emoji" aria-hidden="true">📅</span>' +
        '<h2 class="ci-title">Daily check-in</h2></div>' +
        '<button class="btn btn-primary ci-btn" type="button" id="ci-go">✅ Check in for today</button>' +
        '<p class="ci-note">Claims today’s <b>Send Power</b> bonus — multiplied by your boosts. Free, once a day.</p>' +
        '<p class="ci-msg" id="ci-msg" role="status"></p>' +
      '</div>';
    host.hidden = false;
    shown = true;
  }
  function renderDone() {
    host.innerHTML =
      '<div class="card ci-card ci-card-done">' +
        '<div class="ci-done" id="ci-done" tabindex="-1">' +
          '<div class="ci-head"><span class="ci-emoji" aria-hidden="true">✅</span>' +
          '<h2 class="ci-title">Checked in today</h2></div>' +
          '<p class="ci-note">Today’s <b>Send Power</b> bonus is in the bag. Come back tomorrow for the next one. 🚀</p>' +
          '<p class="ci-next">Next check-in in <span class="ci-clock" id="ci-clock">…</span> <span class="ci-utc">(the day rolls over at midnight UTC)</span></p>' +
        '</div>' +
      '</div>';
    host.hidden = false;
    shown = true;
    tick();   // paint the clock before the first interval fires
    watch();  // …then run it only while visible + on screen
  }

  /* ---------- the countdown ticker: only while the tab is visible AND the card is on screen ---------- */
  function tick() {
    const clock = host.querySelector('#ci-clock');
    if (!clock) { stopTick(); return; }
    const ms = nextResetMs() - Date.now();
    if (ms <= 0) { // a fresh UTC day arrived while the page sat open — offer the check-in again
      stopTick();
      if (window.AUTH && AUTH.user) AUTH.user.checkedInToday = false;
      renderReady();
      say('A new daily check-in is available.');
      return;
    }
    clock.textContent = clockText(ms);
  }
  // tick() itself repaints on a UTC rollover, which removes #ci-clock — so re-check before arming the interval,
  // or a stray timer keeps firing against a card that no longer has a countdown in it.
  function startTick() {
    if (timer) return;
    tick();
    if (host.querySelector('#ci-clock')) timer = setInterval(tick, 1000);
  }
  function stopTick() { if (timer) { clearInterval(timer); timer = null; } }
  function sync() {
    if (!document.hidden && onScreen && host.querySelector('#ci-clock')) startTick();
    else stopTick();
  }
  function watch() {
    if (!io) {
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver((ents) => { onScreen = ents.some(e => e.isIntersecting); sync(); });
        io.observe(host);
      } else onScreen = true; // no IO → visibility alone gates the interval
    }
    sync();
  }
  document.addEventListener('visibilitychange', sync);

  /* ---------- checking in ---------- */
  async function go(btn) {
    if (!signedIn()) { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    const label = btn.innerHTML;
    const r = btn.getBoundingClientRect();              // grab the spot BEFORE the button is replaced
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // must be read BEFORE the disable below: disabling the focused button throws focus to <body>, and then
    // "was the user's focus in this card?" can only ever answer no.
    const keepFocus = host.contains(document.activeElement);
    const msg0 = host.querySelector('#ci-msg');
    if (msg0) msg0.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '⏳ Checking in…';
    let j;
    try {
      j = await window.api('/api/checkin', { method: 'POST' });
    } catch (err) {
      const why = (err && err.message) || 'Could not check in — try again in a moment.';
      // The card can be repainted while the request is in flight (a wall reload, or the UTC rollover), which
      // detaches the nodes we captured. Re-query: a 403 explaining a read-only account must never vanish.
      const live = host.querySelector('#ci-go'), msg = host.querySelector('#ci-msg');
      if (live) { live.disabled = false; live.innerHTML = label; }
      if (msg) msg.textContent = '⚠️ ' + why;
      else toast('⚠️ ' + why);
      return;
    }
    const awarded = Math.max(0, Math.round(Number(j && j.awarded) || 0));
    if (window.AUTH && AUTH.user) AUTH.user.checkedInToday = true;
    renderDone();
    if (keepFocus) { const d = host.querySelector('#ci-done'); if (d) d.focus(); } // never drop focus to <body>
    if (awarded > 0) {
      // showPoints() adds to AUTH.user.points AND fires 'points:changed' for the nav badge
      if (window.showPoints) showPoints(awarded, cx, cy);
      else {
        if (window.AUTH && AUTH.user) AUTH.user.points = (AUTH.user.points || 0) + awarded;
        document.dispatchEvent(new CustomEvent('points:changed'));
      }
      if (window.sendConfetti) sendConfetti(cx, cy, { count: 52, emojiRatio: 0.5 });
      // #toast-zone is itself role="status" aria-live="polite", so a toast IS the announcement — adding say()
      // here would read the same news to a screen reader twice.
      toast('✅ Checked in for today! You earned ' + nf(awarded) + ' Send Power 🪙');
    } else {
      toast('✅ You were already checked in today');
    }
  }
  host.addEventListener('click', (e) => { const b = e.target.closest('#ci-go'); if (b && !b.disabled) go(b); });

  /* ---------- entry point (called by loadPage with the server's u.isMe) ---------- */
  function paint(isMe) {
    if (!isMe || !signedIn()) { // someone else's wall, signed out, or a 404 → render nothing at all
      stopTick();
      if (shown || host.innerHTML) { host.innerHTML = ''; shown = false; }
      host.hidden = true;
      return;
    }
    if (AUTH.user.checkedInToday) renderDone(); else renderReady();
  }
  document.addEventListener('auth:change', () => { if (!signedIn()) paint(false); }); // clear it the instant you sign out
  window.WallCheckin = { paint };
})();
