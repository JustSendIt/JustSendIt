/* ===== Community detail + wall: branded hero, levels, go-live/opt-in, and the community wall ===== */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function timeAgo(ts) { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
  function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; const a = Math.abs(n); if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k'; if (a >= 1) return '$' + n.toFixed(2); if (a > 0) return '$' + n.toPrecision(2); return '$0'; }
  function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function chgChip(v) { if (v == null || isNaN(v)) return ''; const up = v >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(v).toFixed(1) + '% (24h)</span>'; }
  // a stock moves by the trading day, not a rolling 24h — say so, and carry the dollar move when the source gave it
  function stockChip(pct, chg) { const up = pct >= 0; return '<span class="price-chip ' + (up ? 'up' : 'down') + '">' + (up ? '▲ +' : '▼ ') + Math.abs(pct).toFixed(2) + '% today' + (chg != null && !isNaN(chg) ? ' (' + (chg >= 0 ? '+' : '−') + '$' + Math.abs(chg).toFixed(2) + ')' : '') + '</span>'; }
  const ogB = (og) => (window.ogBadge ? window.ogBadge(og) : '');

  const id = Number(new URLSearchParams(location.search).get('id') || 0);
  const heroEl = document.getElementById('comm-hero');
  const wallEl = document.getElementById('comm-wall');
  const feedEl = document.getElementById('comm-feed');
  const emptyEl = document.getElementById('comm-empty');
  const memEl = document.getElementById('comm-members'), memListEl = document.getElementById('comm-members-list'), memSubEl = document.getElementById('comm-members-sub');
  let C = null, oldest = null, wall = 'public';   // which wall is on screen: the public one, or the holders-only one
  let wallGen = 0;                                // bumped on every switch/reset: a late response for the wall you left is dropped

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
    // always rendered: an empty one paints the gradient fallback. When it was omitted for a community with no
    // banner image, the hero body's negative offset pulled the name up into nothing and the card clipped it away.
    const banner = c.banner ? '<div class="comm-hero-banner has-img" style="background-image:url(&quot;' + esc(c.banner) + '&quot;)"></div>' : '<div class="comm-hero-banner"></div>';
    const logo = c.image ? '<img class="comm-hero-logo" src="' + esc(c.image) + '" alt="" loading="lazy">' : '<span class="comm-hero-logo comm-hero-logo-none" aria-hidden="true">' + (c.demo ? '📈' : '🪙') + '</span>'; // the sandbox wears the site's own mark, never a company's
    const live = c.status === 'live';
    const joined = c.mine && c.mine.joined;
    // The sandbox is branded for the listed company behind the chain, so its figures are the STOCK's — labelled as
    // such, with the source and time the quote was read, and null (never a guess) when no source could be read.
    const st = c.demo && c.stock ? c.stock : null, hasQ = !!(st && st.price != null);
    const metrics = c.demo
      ? '<div class="comm-hero-metrics">' +
          '<span>👥 <b>' + fmtNum(c.memberCount) + '</b> members</span>' +
          (hasQ
            ? '<span>📈 <b>$' + Number(st.price).toFixed(2) + '</b> ' + esc(st.symbol) + '</span>' +
              (st.changePct != null ? '<span>' + stockChip(st.changePct, st.change) + '</span>' : '') +
              (st.marketCap ? '<span>🏦 <b>' + fmtUsd(st.marketCap) + '</b> market cap</span>' : '') +
              '<span>' + esc(st.exchange || 'NASDAQ') + (st.marketState ? ' · ' + esc(st.marketState) : '') + '</span>'
            : '<span>📈 <b>$' + esc(c.symbol) + '</b> ' + (st && st.live === false ? 'live quote switched off' : 'quote unavailable right now') + '</span>') +
        '</div>' +
        '<p class="comm-stock-note">' +
          (hasQ ? 'Quote from ' + esc(st.source) + (st.asOfText ? ', as of ' + esc(st.asOfText) : (st.asOf ? ', as of ' + esc(new Date(st.asOf).toUTCString().slice(0, 22)) + ' UTC' : '')) + (st.stale ? ' — <b>stale</b>: the source could not be re-read' : '') + '. ' : '') +
          '<b>$' + esc(c.symbol) + ' is a stock, not a token</b> — ' + esc((st && st.longName) || 'Robinhood Markets, Inc.') + ' (' + esc((st && st.exchange) || 'NASDAQ') + ': ' + esc(c.symbol) + ') is the listed company whose app and chain this site runs on. It cannot be bought, held or swapped here, and nothing on this page is investment advice. This site is not affiliated with, endorsed by or sponsored by Robinhood Markets, Inc.' +
        '</p>'
      : '<div class="comm-hero-metrics">' +
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
    const twoX = c.demo ? '<span class="comm-2x-badge comm-2x-off" title="The sandbox is for trying things out, so it grants no Send Power multiplier">🧪 Sandbox — no 10×</span>'
      : (qualified && live) ? '<span class="comm-2x-badge" title="You earn 10× Send Power on everything while in a live community">⚡ 10× active</span>'
      : (joined && live ? '<span class="comm-2x-badge comm-2x-off" title="' + esc(blockReason || 'Your holding could not be verified on-chain right now — hold this token to keep the 10×') + '">⏸ 10× ' + (blockReason ? 'not active' : 'paused') + '</span>' : '');

    heroEl.innerHTML = banner +
      '<div class="comm-hero-body">' +
        '<div class="comm-hero-top">' + logo +
          '<div class="comm-hero-id"><h1 class="comm-hero-name">' + esc(c.name) + ' <b>$' + esc(c.symbol) + '</b></h1>' +
          (c.demo
            ? '<p class="comm-hero-sub">The open sandbox · started by @' + esc(c.creator || '—') + ' · <a href="' + esc((st && st.quoteUrl) || 'https://www.nasdaq.com/market-activity/stocks/hood') + '" target="_blank" rel="noopener nofollow">' + esc((st && st.exchange) || 'NASDAQ') + ': ' + esc(c.symbol) + ' ↗</a></p></div>'
            : '<p class="comm-hero-sub">Community · started by @' + esc(c.creator || '—') + ' · <button class="linklike comm-viewtoken" type="button">View token on-chain ↗</button></p></div>') +
          twoX +
        '</div>' +
        metrics + panel + conv +
        '<div class="comm-hero-actions">' + optBtn + '</div>' +
        '<p class="comm-gate-msg" id="comm-gate" role="status" aria-live="polite" hidden></p>' +
        '<details class="grules comm-rules"><summary>📖 How points, levels &amp; the 10× work</summary><div class="grules-body"><ul class="comm-rules-list">' +
          (c.demo
            ? '<li>🧪 <b>The sandbox:</b> there is no token to hold — anyone can opt in with no wallet and try everything (posting, proposals and voting). It grants <b>no Send Power multiplier</b>; live token communities do.</li>'
            : '<li>🪙 <b>Holders only:</b> you must <b>hold $' + esc(c.symbol) + '</b> (verified on-chain from a linked wallet) to opt in and post — it keeps communities real.</li>') +
          '<li>⚡ <b>10× Send Power</b> on <b>everything</b> while you’re in ≥1 live <b>token</b> community (flat — five communities is still one 10×; it adds on top of your Holder Boost &amp; OG — boosts add, they don’t multiply).</li>' +
          '<li>🏆 <b>Community level</b> climbs with active members posting &amp; reacting (exponential curve, daily-capped so it can’t be farmed).</li>' +
          '<li>💎 <b>Your conviction</b> here rises the longer you stay + the more you post' + (c.demo ? ' — a member level for this page and its members list; the sandbox has no token to pin on your wall.' : '; it shows next to $' + esc(c.symbol) + ' in your public wall’s <b>Convicted In</b> section.') + '</li>' +
          '<li>👑 The starter earns a one-time <b>founder bonus</b> when the community hits ' + c.goLive.need + ' members.</li>' +
        '</ul></div></details>' +
      '</div>';

    // a persistent, honest explanation for a member blocked by the anti-sybil caps (the toast alone vanished in 2.6 s)
    if (blockReason) { const g = document.getElementById('comm-gate'); if (g) { g.hidden = false; g.textContent = '🛡️ ' + blockReason; } }
    // wall visibility
    if (live) { wallEl.hidden = false; paintWallTabs(); setupComposer(qualified); loadWall(true); }   // paintWallTabs hides the tabs where there is no second wall
    else { wallEl.hidden = false; paintWallTabs(); document.getElementById('comm-composer').hidden = true; feedEl.innerHTML = ''; emptyEl.style.display = 'none';
      const lk = document.getElementById('comm-wall-locked'); lk.hidden = false; lk.innerHTML = '🔒 <b>The wall opens when the community goes LIVE</b> (' + c.goLive.qualCount + '/' + c.goLive.need + '). Opt in above to help it get there.'; }
    loadMembers();
    wire();
  }

  // The two walls, in one place: which tab is live, what the note says, and whether the composer can be open.
  // `qualified` is the same verified-holder slot the server checks, so the UI and the gate can never disagree.
  // A community has a second wall only when it is LIVE and has a token to hold. The sandbox hands its
  // "verified holder" slot to anyone who taps Join, so a holders-only wall there would be open to everyone
  // while the copy promised an on-chain check — it simply does not have one, and the tabs do not appear.
  function hasPrivateWall() { return !!(C && C.status === 'live' && !C.demo); }
  function paintWallTabs() {
    const qual = !!(C && C.mine && C.mine.qualified), sym = C ? esc(C.symbol) : '';
    const tabsEl = document.querySelector('.cw-tabs'), noteEl = document.getElementById('cw-note');
    if (!hasPrivateWall()) {
      if (tabsEl) tabsEl.hidden = true;
      if (noteEl) { noteEl.hidden = true; noteEl.textContent = ''; }
      wall = 'public';
      return;
    }
    if (tabsEl) tabsEl.hidden = false;
    if (noteEl) noteEl.hidden = false;
    for (const b of document.querySelectorAll('.cw-tab')) {
      const on = b.dataset.wall === wall;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const panel = document.getElementById('comm-wall-panel');
    if (panel) panel.setAttribute('aria-labelledby', 'cw-tab-' + wall);
    const note = document.getElementById('cw-note');
    if (note) note.innerHTML = wall === 'holders'
      ? '🔒 <b>Holders only.</b> Everything here is visible <b>only to verified holders of $' + sym + '</b> — it is never served to anyone else, never appears on the Send Wall or a profile, and is not in the public data feed.' + (qual ? ' You are in.' : '')
      : '🌐 <b>Public.</b> Anyone can read this wall. To post you must hold $' + sym + '. Switch to <b>🔒 Holders only</b> for the wall only verified holders can see.';
  }
  function setupComposer(joined) {
    const comp = document.getElementById('comm-composer'), lk = document.getElementById('comm-wall-locked');
    const ta = document.getElementById('comm-c-text'), sendBtn = document.getElementById('comm-c-send');
    if (ta) ta.placeholder = wall === 'holders'
      ? 'Post to the holders-only wall 🔒 — only verified holders of $' + (C ? C.symbol : '') + ' will ever see this'
      : 'Post to the community 🏘️ Paste a contract address → it becomes a clickable $TICKER';
    if (sendBtn) sendBtn.textContent = wall === 'holders' ? 'Post to holders 🔒' : 'Post 🚀';
    if (comp) comp.classList.toggle('is-private', wall === 'holders');
    if (joined && window.AUTH && AUTH.user) {
      comp.hidden = false; lk.hidden = true;
      document.getElementById('comm-c-ava').textContent = AUTH.user.avatar;
      document.getElementById('comm-c-handle').textContent = AUTH.user.username;
    } else {
      comp.hidden = true; lk.hidden = false;
      // The sandbox community has no token to hold and deliberately grants no multiplier, so it must
      // not repeat the standard copy — that would be telling people something untrue about it.
      document.getElementById('comm-wall-locked').innerHTML = wall === 'holders'
        ? '🔒 <b>This wall is for verified holders of $' + (C ? esc(C.symbol) : '') + '.</b> Its posts are never sent to anyone else — not to this page, not to the Send Wall, not to the public data feed. To read it, <b>opt in</b> above: connect a wallet (a free signature, never a transaction) and hold the token, checked on-chain. Sell it and the wall closes again.'
        : joined ? ''
        : ((C && C.demo)
          ? '👀 <b>Anyone can read this wall.</b> This is the open sandbox: <b>join with no tokens and no wallet</b> and try everything — posting, proposals and voting. It is for learning, so it earns <b>no Send Power multiplier</b>.'
          : '👀 <b>Anyone can read this wall.</b> To post, <b>opt in</b> above — that means <b>connecting a wallet</b> and confirming you <b>hold this token</b> on-chain. Members also earn <b>10× Send Power</b>. ⚡');
    }
  }

  // ---- wall posts ----
  function postCard(p) {
    const ava = p.avatar_img ? window.avatarHTML(p.avatar_img, 'post-avatar', 'style="object-fit:cover;"') : '<span class="post-avatar" aria-hidden="true">' + esc(p.avatar || '🚀') + '</span>';
    const fire = (p.reactions && p.reactions.fire) || 0, rocket = (p.reactions && p.reactions.rocket) || 0;
    const myR = p.myReactions || [];
    return '<article class="post' + (p.private ? ' post-private' : '') + '" data-id="' + p.id + '">' +
      '<div class="post-head">' + ava + '<div><div class="who"><a class="handle" href="/u/' + encodeURIComponent(p.username) + '" style="text-decoration:none;' + (p.accent ? 'color:' + esc(p.accent) : '') + '">@' + esc(p.username) + '</a>' + ogB(p.og) +
        (p.private ? '<span class="post-lock" title="Holders only — only verified holders of this token can see this post">🔒 Holders only</span>' : '') +
      '</div><div class="when">' + timeAgo(p.created_at) + '</div></div></div>' +
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
    const gen = ++wallGen, forWall = wall;
    const more = document.getElementById('comm-more');
    if (more) more.disabled = true;
    try {
      const j = await window.api('/api/communities/' + id + '/posts?wall=' + wall + (oldest ? '&before=' + oldest : ''));
      if (gen !== wallGen || forWall !== wall) return;         // the reader moved on; this page belongs to a wall they left
      const posts = j.posts || [];
      if (!posts.length && !feedEl.children.length) {
        emptyEl.style.display = 'block';
        const line = emptyEl.querySelector('p');
        if (line) line.textContent = wall === 'holders' ? 'Nothing on the holders-only wall yet — say the first thing.' : 'No posts yet — be the first to send it here.';
        return;
      }
      emptyEl.style.display = 'none';
      posts.forEach(p => { feedEl.insertAdjacentHTML('beforeend', postCard(p)); oldest = p.id; });
      document.getElementById('comm-more').hidden = posts.length < 30;
    } catch (e) {
      // A refusal is the honest answer, not an empty wall — and not a silent dead "Load more" either: a slot
      // can lapse between loading the page and opening this tab (the sweep re-checks holdings continuously).
      if (gen !== wallGen || forWall !== wall) return;
      if (wall === 'holders') {
        document.getElementById('comm-composer').hidden = true;
        const lk = document.getElementById('comm-wall-locked');
        lk.hidden = false;
        lk.innerHTML = '🔒 <b>' + esc((e && e.message) || 'This wall is for verified holders.') + '</b>';
        emptyEl.style.display = 'none';
        if (more) more.hidden = true;
      }
    } finally { if (more) more.disabled = false; }
  }

  // ---- members roster (public; ranked by community level = conviction earned by participating) ----
  function memberRow(m, i) {
    const ava = m.avatar_img ? window.avatarHTML(m.avatar_img, 'cm-ava', 'loading="lazy"') : '<span class="cm-ava cm-ava-emoji" aria-hidden="true">' + esc(m.avatar || '🚀') + '</span>';
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
      memSubEl.textContent = '· ' + fmtNum(j.memberCount != null ? j.memberCount : members.length) + (j.qualCount != null && !(C && C.demo) ? ' (' + fmtNum(j.qualCount) + ' verified holders)' : ''); // the sandbox verifies nobody's holdings
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
            if (gate && r.status === 403 && C && !C.demo) { // the sandbox has no holder gate: a 403 there is the read-only restriction, already toasted
              const noWallet = !(window.AUTH && AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length);
              gate.hidden = false;
              gate.innerHTML = '🪙 ' + (j.error ? j.error.replace(/</g, '&lt;') : 'You must hold this token to join.') +
                (noWallet ? ' <b>Step 1:</b> <a class="linklike" href="/profile.html#connected-wallet">Connect a wallet →</a> (a free signature — never a transaction) · <b>Step 2:</b> hold some $' + esc(C.symbol) + ' in it.' : '') +
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
            else sendToast((C && C.demo) ? '🧪 You’re in the sandbox — try everything!' : (j.status === 'live' ? '⚡ You’re in — 10× Send Power active!' : '➕ Opted in!'));
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
        const j = await window.api('/api/communities/' + id + '/posts', { method: 'POST', body: { text, image: img, private: wall === 'holders' } });
        ta.value = ''; img = null; setCommCount(500); window.setMediaPreview(document.getElementById('comm-c-preview'), null); document.getElementById('comm-c-img').value = ''; document.getElementById('comm-c-status').textContent = '';
        feedEl.insertAdjacentHTML('afterbegin', postCard(j.post)); emptyEl.style.display = 'none';
        if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
        if (window.sendToast) sendToast(wall === 'holders' ? 'Posted to the holders-only wall 🔒' : 'Posted to the community 🚀');
      } catch (err) { document.getElementById('comm-c-status').textContent = '⚠️ ' + ((err && err.message) || 'could not post'); }
      send.disabled = false;
    });
    document.getElementById('comm-more').addEventListener('click', () => loadWall());

    // Switching walls repaints only the wall block. A viewer without a verified slot never triggers a fetch for the
    // private feed — the server would refuse it anyway; this just shows them what it is and how to get in.
    const tabs = [...document.querySelectorAll('.cw-tab')];
    function pick(which, focus) {
      if (wall === which || !hasPrivateWall()) return;
      // A draft written under "only verified holders will see this" must never be posted in public because
      // the reader changed tabs. Switching audience clears the composer, and says so.
      const ta = document.getElementById('comm-c-text');
      if (ta && (ta.value.trim() || img)) {
        ta.value = ''; clearCommMedia(); setCommCount(500);
        if (window.sendToast) sendToast('Draft cleared — it was written for the other wall');
      }
      wall = which;
      const qual = !!(C && C.mine && C.mine.qualified);
      const open = which === 'public' || qual;
      paintWallTabs();
      setupComposer(open && qual);
      feedEl.innerHTML = ''; oldest = null; emptyEl.style.display = 'none';
      document.getElementById('comm-more').hidden = true;
      if (open) loadWall(true);
      if (focus) { const b = tabs.find(t => t.dataset.wall === which); if (b) b.focus(); }
    }
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => pick(b.dataset.wall, false));
      b.addEventListener('keydown', e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        pick(tabs[(i + d + tabs.length) % tabs.length].dataset.wall, true);
      });
    });
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
