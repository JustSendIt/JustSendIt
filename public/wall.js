/* ===== The Send Wall: shared feed, tabs, votes, reactions, comments =====
   Also drives the Support board (support.html), which is the same feed under its own namespace: same post
   card, same voting, same comment thread, same moderation. The page declares which room it is with
   <body data-board="support">; everything below reads that one value. Building a second copy of this file
   for questions would have meant two implementations of voting and comments drifting apart from day one. */
let oldestId = null, lastScore = null;
let currentFeed = 'all';
let currentSort = 'top'; // matches the server default for the Send Wall (most-upvoted first)
const BOARD = document.body.dataset.board || '';        // '' = the Send Wall, 'support' = the help desk
const boardQ = BOARD ? 'board=' + encodeURIComponent(BOARD) : '';
const feedEl = document.getElementById('feed');

// attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
// real U+2212 minus for negatives; positives stay neutral (no + / $ — voting is a signal, not money)
function fmtScore(n) { n = n | 0; return n < 0 ? '−' + Math.abs(n) : String(n); }

// SHARED post card — kept byte-identical with upage.js (only the data source differs)
function postEl(p) {
  const el = document.createElement('article');
  el.className = 'post';
  el.dataset.id = p.id;
  el.dataset.score = p.score;
  const uHref = '/u/' + encodeURIComponent(p.username);
  if (p.accent) el.style.borderColor = p.accent + '55';
  const ava = p.avatar_img
    ? '<a href="' + uHref + '" aria-hidden="true" tabindex="-1">' + window.avatarHTML(p.avatar_img, 'post-avatar', 'style="object-fit:cover;"') + '</a>'
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
  /* A post from a community wears its community: the badge names it, carries its logo, and links straight
     to it — so someone reading the public wall can see where this came from and go and join it. Holders-only
     posts never reach this feed at all (the server's query excludes them), so a badge here always means a
     community anyone can look at. */
  const comm = p.community
    ? '<a class="post-comm" href="/community.html?id=' + encodeURIComponent(p.community.id) + '" title="Go to the ' +
        esc('$' + p.community.symbol) + ' community">' +
        (p.community.image ? '<img class="post-comm-logo" src="' + esc(p.community.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="post-comm-logo-none" aria-hidden="true">🏘️</span>') +
        '<span class="post-comm-name">' + esc('$' + p.community.symbol) + '</span>' +
        '<span class="post-comm-sub">' + (p.community.status === 'live' ? 'community' : 'community · not live yet') + '</span>' +
        '<span class="post-comm-go" aria-hidden="true">→</span>' +
      '</a>'
    : '';
  el.innerHTML = comm +
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
// render the server-authoritative {score,myVote} in place — client never computes score locally
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

async function loadFeed(reset = true) {
  const params = [];
  if (boardQ) params.push(boardQ);
  if (currentFeed === 'following') params.push('feed=following');
  if (currentSort === 'new') params.push('sort=new');
  if (!reset && oldestId != null) {
    params.push('before=' + oldestId);
    if (currentSort === 'top' && lastScore != null) params.push('beforeScore=' + lastScore); // composite (score,id) keyset
  }
  /* A first paint with nothing in it is not neutral: an empty wall says "nobody has posted", and a blank one
     after a failed request says "this site is broken" — with only a toast, already gone, to say otherwise.
     So the feed says what it is doing, and says what went wrong with a way to try again. */
  if (reset && !feedEl.children.length) { feedEl.setAttribute('aria-busy', 'true'); feedEl.innerHTML = '<p class="empty-wall">Loading the wall…</p>'; }
  try {
    const j = await api('/api/posts' + (params.length ? '?' + params.join('&') : ''));
    feedEl.removeAttribute('aria-busy');
    if (reset) { feedEl.innerHTML = ''; oldestId = null; lastScore = null; }
    for (const p of j.posts) {
      if (!feedEl.querySelector('.post[data-id="' + p.id + '"]')) feedEl.appendChild(postEl(p)); // skip a post already shown (e.g. a just-prepended one)
      oldestId = p.id; lastScore = p.score; // still advance the (score,id) cursor past it
    }
    if (window.SendCall) { SendCall.wire(feedEl); SendCall.live(feedEl); SendCall.observe(feedEl); } // Send Call widgets: actions + live Xs
    const empty = document.getElementById('empty');
    empty.style.display = feedEl.children.length ? 'none' : '';
    empty.querySelector('p').textContent = BOARD === 'support'
      ? 'No questions yet. Ask the first one — someone else probably has the same one.'
      : currentFeed === 'following'
        ? 'Nothing here yet — follow some senders and their posts land here.'
        : 'Nothing on the wall yet. Be the first to send it.';
    document.getElementById('load-more').hidden = j.posts.length < 30;
  } catch (e) {
    feedEl.removeAttribute('aria-busy');
    const msg = (e && e.message) || 'Could not load the feed';
    if (reset) {
      feedEl.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'empty-wall';
      box.setAttribute('role', 'status');
      const p1 = document.createElement('p');
      p1.textContent = '😬 ' + msg;
      const p2 = document.createElement('p');
      p2.className = 'modal-note';
      p2.textContent = 'The wall could not be loaded — this is about the connection, not about anything anyone posted.';
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.type = 'button';
      btn.textContent = '↻ Try again';
      btn.addEventListener('click', () => loadFeed(true));
      box.append(p1, p2, btn);
      feedEl.appendChild(box);
      const empty = document.getElementById('empty');
      if (empty) empty.style.display = 'none';   // the "nothing posted yet" copy would contradict the error
    } else {
      sendToast(msg);   // a failed "load more" keeps what is already on screen
    }
  }
}

/* feed tabs (WHO) */
document.querySelectorAll('.feed-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    // signed out: a real click/Enter opens sign-in; the synthetic click from arrow-key browsing (app.js) only moves focus
    if (tab.dataset.feed === 'following' && !AUTH.user) { if (e.isTrusted) AUTH.open(); return; }
    currentFeed = tab.dataset.feed;
    document.querySelectorAll('.feed-tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    loadFeed(true);
  });
});

/* sort (ORDER): Top = most-upvoted first (default, matches server), New = newest first */
document.querySelectorAll('.sort-btn').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.sort === currentSort) return;
  currentSort = b.dataset.sort;
  document.querySelectorAll('.sort-btn').forEach(x => { const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
  const cap = document.getElementById('sort-caption');
  if (cap) cap.textContent = currentSort === 'top'
    ? 'Ranked by community upvotes — top sends float up. 🔥🚀 are just for vibes.'
    : 'Newest sends first.';
  const nudge = document.getElementById('resort-nudge'); if (nudge) nudge.hidden = true;
  loadFeed(true);
}));
// a vote can change the local Top order — offer a refresh chip instead of yanking the feed under the user
function maybeResortNudge() {
  const nudge = document.getElementById('resort-nudge');
  if (!nudge || currentSort !== 'top') return;
  const s = [...feedEl.children].map(el => +el.dataset.score);
  const sorted = [...s].sort((a, b) => b - a);
  nudge.hidden = s.every((v, i) => v === sorted[i]);
}
const resortBtn = document.getElementById('resort-btn');
if (resortBtn) resortBtn.addEventListener('click', () => { document.getElementById('resort-nudge').hidden = true; loadFeed(true); });

feedEl.addEventListener('click', async (e) => {
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
      maybeResortNudge();
    } catch (err) { sendToast(err.message); }
    return;
  }

  const rBtn = e.target.closest('[data-react]');
  if (rBtn) {
    if (!AUTH.user) { AUTH.open(); return; }
    try {
      const j = await api('/api/posts/' + id + '/react', { method: 'POST', body: { kind: rBtn.dataset.react } });
      rBtn.classList.toggle('lit', j.on);
      rBtn.querySelector('span').textContent = j.count;
      if (j.on) { const r = rBtn.getBoundingClientRect(); sendConfetti(r.left + r.width / 2, r.top, { count: 10, emojiRatio: rBtn.dataset.react === 'rocket' ? 1 : 0.6 }); if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top); }
    } catch (err) { sendToast(err.message); }
    return;
  }

  const dBtn = e.target.closest('[data-del]');
  if (dBtn) {
    if (dBtn.dataset.armed) {
      try { await api('/api/posts/' + id, { method: 'DELETE' }); post.remove(); sendToast('Unsent 🫥'); }
      catch (err) { sendToast(err.message); }
    } else {
      dBtn.dataset.armed = '1';
      const oldLbl = dBtn.getAttribute('aria-label');
      dBtn.textContent = 'Sure? 🗑';
      dBtn.style.color = 'var(--red)';
      dBtn.setAttribute('aria-label', 'Confirm delete — tap again within 4 seconds'); // the arm state must be perceivable without sight
      if (window.announce) announce('Tap delete again to confirm. Expires in 4 seconds.');
      setTimeout(() => { delete dBtn.dataset.armed; dBtn.textContent = '🗑'; dBtn.style.color = ''; if (oldLbl) dBtn.setAttribute('aria-label', oldLbl); else dBtn.removeAttribute('aria-label'); }, 4000);
    }
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
      const cAva = c.avatar_img ? window.avatarHTML(c.avatar_img, 'c-ava', 'style="width:22px; height:22px; border-radius:50%; object-fit:cover;"') : '<span class="c-ava" aria-hidden="true">' + esc(c.avatar) + '</span>';
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

/* composer */
const ta = document.getElementById('post-text');
const charCount = document.getElementById('char-count');
function setCharCount(n) { charCount.textContent = n; charCount.setAttribute('aria-hidden', n > 20 ? 'true' : 'false'); } // only announce to SRs when running low
ta.addEventListener('input', () => setCharCount(500 - ta.value.length));

let pendingImg = null;
const postImgEl = document.getElementById('post-img'), wallStatus = document.getElementById('wall-c-status');
function clearWallMedia() { pendingImg = null; postImgEl._attachGen = (postImgEl._attachGen || 0) + 1; postImgEl.value = ''; window.setMediaPreview(document.getElementById('img-preview'), null); }
postImgEl.addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const btn = document.getElementById('publish-btn'); btn.disabled = true;                 // no posting mid-prep/upload
  const r = await window.guardedAttach(e.target, f, document.getElementById('img-preview'), clearWallMedia, m => { if (wallStatus) wallStatus.textContent = m; });
  btn.disabled = false;
  if (r && r.skip) return;                 // a flow was already running, or it was cleared/replaced — leave state as-is
  if (!r) { clearWallMedia(); return; }    // prep/upload failed
  pendingImg = r.url;
});

async function publishPost() {
  const text = ta.value.trim();
  if (postImgEl._busy) { sendToast('Hang on — still uploading your media ⏳'); return; }
  if (!text && !pendingImg) { sendToast(BOARD === 'support' ? 'Write your question first 🙂' : 'Say something or drop a meme first 🤌'); return; }
  const btn = document.getElementById('publish-btn');
  btn.disabled = true;
  try {
    const j = await api('/api/posts', { method: 'POST', body: { text, image: pendingImg, board: BOARD || undefined } });
    ta.value = ''; setCharCount(500); if (wallStatus) wallStatus.textContent = '';
    pendingImg = null;
    window.setMediaPreview(document.getElementById('img-preview'), null);
    document.getElementById('post-img').value = '';
    const node = postEl(j.post);
    feedEl.prepend(node);
    document.getElementById('empty').style.display = 'none';
    if (j.post && j.post.id) history.replaceState(null, '', '#p' + j.post.id);
    flashPost(node);
    if (BOARD === 'support') sendToast('Question posted — others can answer and vote on it 🙌');
    else { sendConfetti(innerWidth / 2, 240, { count: 46, emojiRatio: 0.4 }); sendToast('SENT! 🚀'); }
    if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned);
  } catch (err) { sendToast(err.message); }
  btn.disabled = false;
}
document.getElementById('publish-btn').addEventListener('click', publishPost);
document.getElementById('load-more').addEventListener('click', () => loadFeed(false));
document.getElementById('signin-cta').addEventListener('click', () => AUTH.open());

// a post made from the global compose FAB appears live in the feed
document.addEventListener('post:created', (e) => {
  if (e.detail && feedEl) {
    const node = postEl(e.detail);
    feedEl.prepend(node);
    const empty = document.getElementById('empty');
    if (empty) empty.style.display = 'none';
    flashPost(node);
  }
});

// deep-link to a specific post/call on the wall (#p<id>) — used after making a post or a Send Call
function flashPost(el) {
  if (!el) return;
  el.classList.remove('post-flash'); void el.offsetWidth; el.classList.add('post-flash');
  el.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'center' });
}
async function focusPost(id) {
  if (!id || !feedEl) return;
  let el = feedEl.querySelector('.post[data-id="' + id + '"]');
  if (!el) { try { const j = await api('/api/posts/' + id); if (j && j.post) { el = postEl(j.post); feedEl.prepend(el); const empty = document.getElementById('empty'); if (empty) empty.style.display = 'none'; } } catch {} }
  if (el) setTimeout(() => flashPost(el), 60);
}
function focusFromHash() { const m = /^#p(\d+)$/.exec(location.hash || ''); if (m) focusPost(Number(m[1])); }
window.addEventListener('hashchange', focusFromHash);
setTimeout(focusFromHash, 500); // on load, after the feed starts populating

window.onAuthReady = function (user) {
  // the Support board reuses this file but has no Everyone/Following tabs, so every wall-only node is optional
  const byId = (id) => document.getElementById(id);
  const so = byId('composer-signedout'), si = byId('composer-signedin');
  if (so) so.hidden = !!user;
  if (si) si.hidden = !user;
  const tf = byId('tab-following'); if (tf) tf.hidden = false; // visible to all; prompts sign-in
  const myWall = byId('my-wall-link');
  if (myWall) { myWall.hidden = !user; if (user) myWall.href = '/u/' + encodeURIComponent(user.username); } // jump to your own public Send Wall
  if (user) {
    const av = byId('my-avatar'); if (av) av.textContent = user.avatar;
    const mh = byId('my-handle');
    if (mh) {
      mh.textContent = user.username;
      const oldOg = mh.parentElement.querySelector('.og-badge'); if (oldOg) oldOg.remove();
      if (user.og && window.ogBadge) mh.insertAdjacentHTML('afterend', ogBadge(user.og));
    }
  } else if (currentFeed === 'following') {
    currentFeed = 'all';
    document.querySelectorAll('.feed-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.feed === 'all')));
  }
  loadFeed(true);
};
