/* ===== Community detail + wall: branded hero, levels, go-live/opt-in, and the community wall ===== */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function timeAgo(ts) { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
  function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
  function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function chgChip(v) { if (v == null || isNaN(v)) return ''; const up = v >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(v).toFixed(1) + '% (24h)</span>'; }
  const ogB = (og) => (window.ogBadge ? window.ogBadge(og) : '');

  const id = Number(new URLSearchParams(location.search).get('id') || 0);
  const heroEl = document.getElementById('comm-hero');
  const wallEl = document.getElementById('comm-wall');
  const feedEl = document.getElementById('comm-feed');
  const emptyEl = document.getElementById('comm-empty');
  const memEl = document.getElementById('comm-members'), memListEl = document.getElementById('comm-members-list'), memSubEl = document.getElementById('comm-members-sub');
  let C = null, oldest = null;

  function xpBar(label, lvl, into, span, cls) {
    const pct = span ? Math.min(100, Math.round(into / span * 100)) : 100;
    return '<div class="comm-xp ' + (cls || '') + '"><div class="comm-xp-head"><span>' + label + '</span><b>Lv ' + lvl + '</b></div>' +
      '<div class="gxp" role="progressbar" aria-valuenow="' + into + '" aria-valuemin="0" aria-valuemax="' + (span || into) + '" aria-label="' + label + ' level ' + lvl + ', ' + into + ' of ' + (span || '—') + ' XP"><span class="gxp-fill" style="width:' + pct + '%"></span></div>' +
      '<div class="comm-xp-sub">' + (span ? into.toLocaleString('en-US') + ' / ' + span.toLocaleString('en-US') + ' XP to Lv ' + (lvl + 1) : 'max') + '</div></div>';
  }

  function renderHero(c) {
    if (!c) return; // a noop/degenerate response must never blow away the rendered hero
    C = c;
    document.title = c.name + ' ($' + c.symbol + ') Community — $Send 🏘️';
    const banner = c.banner ? '<div class="comm-hero-banner" style="background-image:url(&quot;' + esc(c.banner) + '&quot;)"></div>' : '';
    const logo = c.image ? '<img class="comm-hero-logo" src="' + esc(c.image) + '" alt="" loading="lazy">' : '<span class="comm-hero-logo comm-hero-logo-none" aria-hidden="true">🪙</span>';
    const live = c.status === 'live';
    const joined = c.mine && c.mine.joined;
    const metrics = '<div class="comm-hero-metrics">' +
      '<span>👥 <b>' + fmtNum(c.memberCount) + '</b> members</span>' +
      '<span>🪙 <b>' + fmtNum(c.holders) + '</b> holders</span>' +
      '<span>💰 <b>' + fmtUsd(c.mcap) + '</b> MC</span>' +
      (chgChip(c.priceChange) ? '<span>' + chgChip(c.priceChange) + '</span>' : '') +
    '</div>';
    // status / go-live panel
    let panel;
    if (live) {
      const cl = c.communityLevel;
      panel = '<div class="comm-hero-status"><span class="comm-pill comm-pill-live">🟢 LIVE</span> <span class="comm-pulse tier-' + String(c.activityTier).toLowerCase() + '"><i></i> ' + esc(c.activityTier) + '</span></div>' +
        xpBar('🏆 Community level', cl.level, cl.intoLevel, cl.spanLevel, 'comm-xp-community');
    } else {
      const pct = Math.min(100, Math.round(c.goLive.qualCount / c.goLive.need * 100));
      panel = '<div class="comm-golive-panel"><div class="comm-golive-head">⏳ <b>' + c.goLive.qualCount + ' / ' + c.goLive.need + '</b> members to go <b>LIVE</b></div>' +
        '<div class="gxp" role="progressbar" aria-valuenow="' + c.goLive.qualCount + '" aria-valuemin="0" aria-valuemax="' + c.goLive.need + '" aria-label="Go-live progress: ' + c.goLive.qualCount + ' of ' + c.goLive.need + ' members"><span class="gxp-fill" style="width:' + pct + '%"></span></div>' +
        '<p class="modal-note" style="margin:0.5rem 0 0;">Opt in to help it reach ' + c.goLive.need + '. The starter earns a <b>founder bonus</b> when it goes live — and everyone in gets <b>10× Send Power</b>.</p></div>';
    }
    // opt-in button + your conviction
    const qualified = !!(joined && c.mine && c.mine.qualified); // the 10× + posting need a CURRENTLY-verified holder, not just an opt-in row (revoked members keep neither)
    const requalify = joined && !qualified; // de-qualified (sold / disconnected / moved bags) → the primary action is to re-verify, never a dead end
    const optBtn = requalify
      ? '<button class="btn btn-primary comm-join-btn" id="comm-join" type="button">' + (c.mine && c.mine.blockReason ? '↻ Re-check my slot' : '↻ Re-verify holdings &amp; opt back in') + '</button> <button class="btn btn-ghost btn-sm" id="comm-leave" type="button">Leave</button>'
      : '<button class="btn ' + (joined ? 'btn-ghost' : 'btn-primary') + ' comm-join-btn" id="comm-join" type="button" aria-pressed="' + (!!joined) + '">' + (joined ? '✓ You’re in' + (c.mine && c.mine.isCreator ? ' (starter 👑)' : '') : '➕ Opt in' + (live ? ' & get 10×' : '')) + '</button>';
    const conv = (joined && c.mine) ? xpBar('💎 Your conviction · ' + esc(c.mine.convictionTitle), c.mine.convictionLevel, c.mine.convictionInto, c.mine.convictionSpan, 'comm-xp-conv') : '';
    const blockReason = (c.mine && c.mine.blockReason) || null; // anti-sybil block (IP cap / starter network) — NOT a holdings problem, so say so
    const twoX = (qualified && live) ? '<span class="comm-2x-badge" title="You earn 10× Send Power on everything while in a live community">⚡ 10× active</span>'
      : (joined && live ? '<span class="comm-2x-badge comm-2x-off" title="' + esc(blockReason || 'Your holding could not be verified on-chain right now — hold this token to keep the 10×') + '">⏸ 10× ' + (blockReason ? 'not active' : 'paused') + '</span>' : '');

    heroEl.innerHTML = banner +
      '<div class="comm-hero-body">' +
        '<div class="comm-hero-top">' + logo +
          '<div class="comm-hero-id"><h1 class="comm-hero-name">' + esc(c.name) + ' <b>$' + esc(c.symbol) + '</b></h1>' +
          '<p class="comm-hero-sub">Community · started by @' + esc(c.creator || '—') + ' · <button class="linklike comm-viewtoken" type="button">View token on-chain ↗</button></p></div>' +
          twoX +
        '</div>' +
        metrics + panel + conv +
        '<div class="comm-hero-actions">' + optBtn + '</div>' +
        '<p class="comm-gate-msg" id="comm-gate" role="status" aria-live="polite" hidden></p>' +
        '<details class="grules comm-rules"><summary>📖 How points, levels &amp; the 10× work</summary><div class="grules-body"><ul class="comm-rules-list">' +
          '<li>🪙 <b>Holders only:</b> you must <b>hold $' + esc(c.symbol) + '</b> (verified on-chain from a linked wallet) to opt in and post — it keeps communities real.</li>' +
          '<li>⚡ <b>10× Send Power</b> on <b>everything</b> while you’re in ≥1 live community (flat — five communities is still 10×; stacks on your Holder Boost &amp; OG).</li>' +
          '<li>🏆 <b>Community level</b> climbs with active members posting &amp; reacting (exponential curve, daily-capped so it can’t be farmed).</li>' +
          '<li>💎 <b>Your conviction</b> here rises the longer you stay + the more you post; it shows next to $' + esc(c.symbol) + ' in your public wall’s <b>Convicted In</b> section.</li>' +
          '<li>👑 The starter earns a one-time <b>founder bonus</b> when the community hits ' + c.goLive.need + ' members.</li>' +
        '</ul></div></details>' +
      '</div>';

    // a persistent, honest explanation for a member blocked by the anti-sybil caps (the toast alone vanished in 2.6 s)
    if (blockReason) { const g = document.getElementById('comm-gate'); if (g) { g.hidden = false; g.textContent = '🛡️ ' + blockReason; } }
    // wall visibility
    if (live) { wallEl.hidden = false; setupComposer(qualified); loadWall(true); }
    else { wallEl.hidden = false; document.getElementById('comm-composer').hidden = true; feedEl.innerHTML = ''; emptyEl.style.display = 'none';
      const lk = document.getElementById('comm-wall-locked'); lk.hidden = false; lk.innerHTML = '🔒 <b>The wall opens when the community goes LIVE</b> (' + c.goLive.qualCount + '/' + c.goLive.need + '). Opt in above to help it get there.'; }
    loadMembers();
    wire();
  }

  function setupComposer(joined) {
    const comp = document.getElementById('comm-composer'), lk = document.getElementById('comm-wall-locked');
    if (joined && window.AUTH && AUTH.user) {
      comp.hidden = false; lk.hidden = true;
      document.getElementById('comm-c-ava').textContent = AUTH.user.avatar;
      document.getElementById('comm-c-handle').textContent = AUTH.user.username;
    } else {
      comp.hidden = true; lk.hidden = false;
      document.getElementById('comm-wall-locked').innerHTML = joined ? '' : '👀 <b>Anyone can read this wall.</b> To post, <b>opt in</b> above — that means <b>connecting a wallet</b> and confirming you <b>hold this token</b> on-chain. Members also earn <b>10× Send Power</b>. ⚡';
    }
  }

  // ---- wall posts ----
  function postCard(p) {
    const ava = p.avatar_img ? '<img class="post-avatar" src="' + esc(p.avatar_img) + '" alt="" style="object-fit:cover;">' : '<span class="post-avatar" aria-hidden="true">' + esc(p.avatar || '🚀') + '</span>';
    const fire = (p.reactions && p.reactions.fire) || 0, rocket = (p.reactions && p.reactions.rocket) || 0;
    const myR = p.myReactions || [];
    return '<article class="post" data-id="' + p.id + '">' +
      '<div class="post-head">' + ava + '<div><div class="who"><a class="handle" href="/u/' + encodeURIComponent(p.username) + '" style="text-decoration:none;' + (p.accent ? 'color:' + esc(p.accent) : '') + '">@' + esc(p.username) + '</a>' + ogB(p.og) + '</div><div class="when">' + timeAgo(p.created_at) + '</div></div></div>' +
      (p.text ? '<p class="post-body">' + (window.richText ? richText(p.text, p.tokens) : esc(p.text)) + '</p>' : '') + // $TICKERs → token chips (tokentext.js)
      (p.image ? window.mediaTag(esc(p.image), esc(p.username)) : '') +
      '<div class="post-actions">' +
        '<button class="react-btn' + (myR.includes('fire') ? ' lit' : '') + '" type="button" data-react="fire" aria-label="React with fire">🔥 <span>' + fire + '</span></button>' +
        '<button class="react-btn' + (myR.includes('rocket') ? ' lit' : '') + '" type="button" data-react="rocket" aria-label="React with rocket">🚀 <span>' + rocket + '</span></button>' +
        '<button class="react-btn comm-cmt-toggle" type="button" data-comments aria-label="Show comments">💬 <span>' + (p.comments || 0) + '</span></button>' +
      '</div>' +
      '<div class="comm-cmt-zone" hidden></div>' +
    '</article>';
  }

  async function loadWall(reset) {
    if (reset) { oldest = null; feedEl.innerHTML = ''; }
    try {
      const j = await window.api('/api/communities/' + id + '/posts' + (oldest ? '?before=' + oldest : ''));
      const posts = j.posts || [];
      if (!posts.length && !feedEl.children.length) { emptyEl.style.display = 'block'; return; }
      emptyEl.style.display = 'none';
      posts.forEach(p => { feedEl.insertAdjacentHTML('beforeend', postCard(p)); oldest = p.id; });
      document.getElementById('comm-more').hidden = posts.length < 30;
    } catch (e) {}
  }

  // ---- members roster (public; ranked by community level = conviction earned by participating) ----
  function memberRow(m, i) {
    const ava = m.avatar_img ? '<img class="cm-ava" src="' + esc(m.avatar_img) + '" alt="" loading="lazy">' : '<span class="cm-ava cm-ava-emoji" aria-hidden="true">' + esc(m.avatar || '🚀') + '</span>';
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const rankLbl = i < 3 ? ('rank ' + (i + 1)) : String(i + 1);
    const crown = m.isCreator ? '<span class="cm-crown" title="Community starter" aria-label="community starter">👑</span>' : '';
    const nameStyle = m.accent ? ' style="color:' + esc(m.accent) + '"' : '';
    return '<li class="cm-row' + (m.isCreator ? ' cm-creator' : '') + '">' +
      '<span class="cm-rank" role="img" aria-label="' + rankLbl + '">' + rank + '</span>' +
      ava +
      '<a class="cm-name" href="/u/' + encodeURIComponent(m.username) + '"' + nameStyle + '>@' + esc(m.username) + '</a>' + ogB(m.og) + crown +
      '<span class="cm-lvl" title="Community member level — earned by participating here">💎 Lv ' + m.level + ' · ' + esc(m.title) + '</span>' +
    '</li>';
  }
  async function loadMembers() {
    if (!memEl) return;
    try {
      const j = await window.api('/api/communities/' + id + '/members');
      const members = j.members || [];
      if (!members.length) { memEl.hidden = true; return; }
      memEl.hidden = false;
      memSubEl.textContent = '· ' + fmtNum(j.memberCount != null ? j.memberCount : members.length) + (j.qualCount != null ? ' (' + fmtNum(j.qualCount) + ' verified holders)' : '');
      memListEl.innerHTML = members.map(memberRow).join('');
    } catch (e) { memEl.hidden = true; }
  }

  // ---- interactions ----
  function wire() {
    if (heroEl._wired) return; heroEl._wired = true;
    // opt-in / leave
    document.addEventListener('click', async (e) => {
      const join = e.target.closest('#comm-join, #comm-leave');
      if (join) {
        if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
        const joined = C && C.mine && C.mine.joined;
        const qualified = !!(joined && C.mine.qualified);
        const leaving = !!joined && (join.id === 'comm-leave' || qualified); // #comm-join on a de-qualified member = re-verify (POST), not leave
        // Leaving is destructive (you lose your member level + the 10× until you re-qualify) yet the button reads like a
        // status pill — require a second tap within 4s so a stray click can't drop you out of the community.
        if (leaving && !join._armed) {
          join._armed = true; join.dataset.label = join.textContent; join.textContent = '⚠️ Tap again to leave';
          join.setAttribute('aria-label', 'Tap again to confirm leaving this community');
          clearTimeout(join._armT); join._armT = setTimeout(() => { if (join.isConnected) { join._armed = false; join.textContent = join.dataset.label || '✓ You’re in'; join.removeAttribute('aria-label'); } }, 4000);
          return;
        }
        clearTimeout(join._armT); join._armed = false;
        join.disabled = true;
        try {
          const r = await fetch('/api/communities/' + id + '/join', { method: leaving ? 'DELETE' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
          const j = await r.json();
          if (!r.ok) {
            if (window.sendToast) sendToast(j.error || 'Could not update');
            const gate = document.getElementById('comm-gate'); // holder-gate (403) → persistent notice + buy/recheck actions
            if (gate && r.status === 403 && C) {
              const noWallet = !(window.AUTH && AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length);
              gate.hidden = false;
              gate.innerHTML = '🪙 ' + (j.error ? j.error.replace(/</g, '&lt;') : 'You must hold this token to join.') +
                (noWallet ? ' <b>Step 1:</b> <a class="linklike" href="/profile.html#link-wallet">Connect a wallet →</a> (a free signature — never a transaction) · <b>Step 2:</b> hold some $' + esc(C.symbol) + ' in it.' : '') +
                ' <button class="linklike comm-viewtoken" type="button">Get $' + esc(C.symbol) + ' ↗</button>';
            }
            join.disabled = false; return;
          }
          const gclr = document.getElementById('comm-gate'); if (gclr) { gclr.hidden = true; gclr.innerHTML = ''; }
          if (j.wentLive) { if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 80, emojiRatio: 0.4 }); if (window.sendToast) sendToast('🎉 Community is LIVE!'); }
          else if (window.sendToast) {
            if (leaving) sendToast('Left the community');
            else if (j.qualified === false) sendToast(j.reason || 'You’re in as a member — but not as a verified holder yet'); // honest: no "Opted in!" for a blocked slot
            else if (j.requalified) sendToast('↻ Re-verified — you’re back in as a holder' + (j.status === 'live' ? ' (10× restored) ⚡' : ''));
            else sendToast(j.status === 'live' ? '⚡ You’re in — 10× Send Power active!' : '➕ Opted in!');
          }
          // founder bonus is credited to the CREATOR only — pop it just for them (the joiner who tips it live isn't the creator)
          if (j.founder && j.founder.awarded && j.community && j.community.mine && j.community.mine.isCreator && window.showPoints) showPoints(j.founder.points);
          renderHero(j.community);
          const nb = document.getElementById('comm-join'); if (nb) nb.focus(); // restore keyboard focus to the rebuilt button
        } catch { join.disabled = false; }
        return;
      }
      const vt = e.target.closest('.comm-viewtoken');
      if (vt && C && window.TokenModal) { TokenModal.open(C.token, { symbol: C.symbol, name: C.name }); return; }
    });
    // feed: reactions + comments
    feedEl.addEventListener('click', async (e) => {
      const rb = e.target.closest('[data-react]');
      if (rb) {
        if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
        const post = rb.closest('.post'), pid = post.dataset.id;
        try { const j = await window.api('/api/posts/' + pid + '/react', { method: 'POST', body: { kind: rb.dataset.react } }); rb.classList.toggle('lit', j.on); rb.querySelector('span').textContent = j.count; if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned); } catch {}
        return;
      }
      const ct = e.target.closest('[data-comments]');
      if (ct) { toggleComments(ct.closest('.post')); return; }
    });
    // composer
    const send = document.getElementById('comm-c-send'), ta = document.getElementById('comm-c-text'), count = document.getElementById('comm-c-count');
    let img = null;
    const setCommCount = (n) => { count.textContent = n; count.setAttribute('aria-hidden', n > 20 ? 'true' : 'false'); }; // announce to SRs only when low
    ta.addEventListener('input', () => setCommCount(500 - ta.value.length));
    const commImgEl = document.getElementById('comm-c-img');
    const clearCommMedia = () => { img = null; commImgEl._attachGen = (commImgEl._attachGen || 0) + 1; commImgEl.value = ''; window.setMediaPreview(document.getElementById('comm-c-preview'), null); };
    commImgEl.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const st = document.getElementById('comm-c-status'); send.disabled = true;
      const r = await window.guardedAttach(e.target, f, document.getElementById('comm-c-preview'), clearCommMedia, m => { if (st) st.textContent = m; });
      send.disabled = false;
      if (r && r.skip) return;
      if (!r) { clearCommMedia(); return; }
      img = r.url;
    });
    send.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (commImgEl._busy) { document.getElementById('comm-c-status').textContent = 'Hang on — still uploading… ⏳'; return; }
      if (!text && !img) { document.getElementById('comm-c-status').textContent = 'Say something first 🤌'; return; }
      send.disabled = true;
      try {
        const j = await window.api('/api/communities/' + id + '/posts', { method: 'POST', body: { text, image: img } });
        ta.value = ''; img = null; setCommCount(500); window.setMediaPreview(document.getElementById('comm-c-preview'), null); document.getElementById('comm-c-img').value = ''; document.getElementById('comm-c-status').textContent = '';
        feedEl.insertAdjacentHTML('afterbegin', postCard(j.post)); emptyEl.style.display = 'none';
        if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
        if (window.sendToast) sendToast('Posted to the community 🚀');
      } catch (err) { document.getElementById('comm-c-status').textContent = '⚠️ ' + ((err && err.message) || 'could not post'); }
      send.disabled = false;
    });
    document.getElementById('comm-more').addEventListener('click', () => loadWall());
  }

  async function toggleComments(post) {
    const zone = post.querySelector('.comm-cmt-zone');
    if (!zone.hidden) { zone.hidden = true; return; }
    zone.hidden = false; zone.innerHTML = '<p class="modal-note">loading…</p>';
    const pid = post.dataset.id;
    try {
      const j = await window.api('/api/posts/' + pid + '/comments');
      const tog = post.querySelector('.comm-cmt-toggle span'); if (tog) tog.textContent = (j.comments || []).length; // keep the 💬 badge truthful
      const list = (j.comments || []).map(c => '<div class="comm-cmt"><a class="c-who" href="/u/' + encodeURIComponent(c.username) + '">@' + esc(c.username) + '</a>' + ogB(c.og) + ' <span class="c-text">' + (window.richText ? richText(c.text, c.tokens) : esc(c.text)) + '</span></div>').join('') || '<p class="modal-note">no comments yet — start it off 👇</p>';
      zone.innerHTML = list + (window.AUTH && AUTH.user ? '<form class="comm-cmt-form"><input class="addr-input" maxlength="300" placeholder="add a comment…" aria-label="Write a comment"><button class="btn btn-primary btn-sm" type="submit">Reply</button></form>' : '<p class="modal-note"><button class="linklike" type="button" data-signin>Sign in</button> to comment.</p>');
      const form = zone.querySelector('.comm-cmt-form');
      if (form) form.addEventListener('submit', async (ev) => { ev.preventDefault(); const inp = form.querySelector('input'); const txt = inp.value.trim(); if (!txt) return; try { const cj = await window.api('/api/posts/' + pid + '/comments', { method: 'POST', body: { text: txt } }); inp.value = ''; toggleComments(post); toggleComments(post); if (window.showPoints && cj.pointsEarned > 0) showPoints(cj.pointsEarned); } catch {} });
      const si = zone.querySelector('[data-signin]'); if (si) si.addEventListener('click', () => { if (window.AUTH) AUTH.open(); });
    } catch { zone.innerHTML = '<p class="modal-note">could not load comments</p>'; }
  }

  async function load() {
    if (!id) { heroEl.innerHTML = '<p class="modal-note" style="text-align:center; padding:1.5rem;">No community specified. <a href="communities.html">Browse all →</a></p>'; return; }
    try { const j = await window.api('/api/communities/' + id); renderHero(j.community); }
    catch (e) { heroEl.innerHTML = '<p class="modal-note" style="text-align:center; padding:1.5rem;">Community not found. <a href="communities.html">Browse all →</a></p>'; }
  }
  load();
  document.addEventListener('auth:change', load); // re-render on login (opt-in state / composer)
})();
