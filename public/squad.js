/* ===== Send Squad page: hero, gate + join, owner editor, lifetime tracker, and the four tabs =====
 * Wall (members only) · Calls (squad calls, live) · Conviction (members' pinned tokens, aggregated) · Members.
 * Every route under /api/squads answers 401 when signed out, so the page opens on a locked panel and only
 * paints once the server has said who is asking. Every figure printed here came from the API; a null is a dash. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // a person's @name opens their Send Wall (/u/<name>); no name, no link
  const wallLink = (u) => u ? '<a class="wall-link" href="/u/' + encodeURIComponent(u) + '">@' + esc(u) + '</a>' : '@—';
  function timeAgo(ts) { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
  // the API's dollar figures arrive already rounded — this only abbreviates them, and never fills a gap
  function fmtUsd(n) { if (n == null || isNaN(n)) return '—'; n = Number(n); const a = Math.abs(n); const sign = n < 0 ? '−' : ''; if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'k'; if (a >= 1) return sign + '$' + a.toFixed(2); if (a > 0) return sign + '$' + a.toPrecision(2); return '$0'; }
  function fmtNum(n) { if (n == null || isNaN(n)) return '—'; n = Number(n); return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 4 }); }
  // Xs use the call rule (+100% = 1x); a total of many calls can be large, so the decimals shrink as it grows
  function xFmt(x) { if (x == null || !isFinite(x)) return '—'; const s = x >= 0 ? '+' : '−'; const a = Math.abs(x); return s + (a < 10 ? a.toFixed(2) : a < 100 ? a.toFixed(1) : Math.round(a)) + 'x'; }
  function days(n) { if (n == null || isNaN(n)) return '—'; n = Number(n); return (n >= 10 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, '')) + ' d'; }
  const ogB = (og) => (window.ogBadge ? window.ogBadge(og) : '');
  const rich = (t, toks) => (window.richText ? richText(t, toks) : esc(t));
  const SQUAD_NAME_RE = /^[\w .\-'$&!?]{3,40}$/;          // mirrors the server's SQUAD_NAME_RE so a bad name is caught before the round-trip
  const IMG_MAX = 3.5 * 1024 * 1024;                        // the server's cap for a data: URL avatar/banner
  const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const TABS = ['wall', 'calls', 'conviction', 'members'];

  const id = Number(new URLSearchParams(location.search).get('id') || 0);
  const lockedEl = document.getElementById('sqd-locked');
  const heroEl = document.getElementById('sqd-hero');
  const editEl = document.getElementById('sqd-edit');
  const lifeEl = document.getElementById('sqd-life'), lifeGrid = document.getElementById('sqd-life-grid');
  const tabsSec = document.getElementById('sqd-tabs-sec');
  const noteEl = document.getElementById('sqd-cw-note');
  const feedEl = document.getElementById('sqd-feed'), emptyEl = document.getElementById('sqd-empty');
  const callsEl = document.getElementById('sqd-calls'), callsEmpty = document.getElementById('sqd-calls-empty');
  let S = null, oldest = null, wallGen = 0;
  let tab = 'wall';                 // which tab is on screen
  let lastKey = null;               // membership state the tabs were last painted for — a change re-opens/closes the private tabs
  let img = null;                   // media attached to the composer

  // ---------- hero ----------
  function xpBar(label, lvl, into, span, cls) {
    into = Number(into) || 0; span = Number(span) || 0;
    const pct = span ? Math.min(100, Math.round(into / span * 100)) : 100;
    return '<div class="comm-xp ' + (cls || '') + '"><div class="comm-xp-head"><span>' + label + '</span><b>Lv ' + esc(lvl) + '</b></div>' +
      '<div class="gxp" role="progressbar" aria-valuenow="' + into + '" aria-valuemin="0" aria-valuemax="' + (span || into) + '" aria-label="' + label + ' level ' + esc(lvl) + ', ' + into + ' of ' + (span || '—') + ' XP"><span class="gxp-fill" style="width:' + pct + '%"></span></div>' +
      '<div class="comm-xp-sub">' + (span ? into.toLocaleString('en-US') + ' / ' + span.toLocaleString('en-US') + ' XP to Lv ' + (Number(lvl) + 1) : 'max') + '</div></div>';
  }
  const isMember = () => !!(S && S.mine && S.mine.member);
  const isVerified = () => !!(isMember() && S.mine.verified);
  const isOwner = () => !!(isMember() && S.mine.role === 'owner');
  const gated = () => !!(S && S.gate && S.gate.kind !== 'none');
  const gateSym = () => (S && S.gate && S.gate.symbol) ? '$' + S.gate.symbol : 'the gate token';

  function gateLine(s) {
    const g = s.gate || {};
    if (g.kind === 'none' || !g.kind) return '<p class="sqd-gate-line">🔓 <b>Open to anyone</b> with an account — no token to hold.</p>';
    const sym = g.symbol ? '$' + esc(g.symbol) : 'the token';
    let held = '';
    // what the viewer holds vs what it takes — only when the server sent both figures
    const h = s.mine && s.mine.holds;
    if (h && h.amount != null && h.need != null) held = ' <span class="sqd-gate-held">You hold <b>' + esc(fmtNum(h.amount)) + '</b> of <b>' + esc(fmtNum(h.need)) + '</b> ' + (h.symbol ? '$' + esc(h.symbol) : sym) + (s.mine.checkedAt ? ' · checked ' + esc(timeAgo(s.mine.checkedAt)) : '') + '.</span>';
    return '<p class="sqd-gate-line">🔒 <b>It takes ' + esc(g.text || ('holding ' + sym)) + '</b> — read on-chain and summed across your linked wallets, and re-checked while you are in.' +
      (g.token ? ' <button class="linklike sqd-viewtoken" type="button" data-tip="Opens a panel with on-chain detail for the gate token">View ' + sym + ' on-chain ↗</button>' : '') + held + '</p>';
  }

  function renderHero(s) {
    if (!s) return;   // a noop/degenerate response must never blow away the rendered hero
    S = s;
    document.title = s.name + ' — Send Squad · $Send 🛡️';
    const banner = s.banner ? '<div class="comm-hero-banner has-img" style="background-image:url(&quot;' + esc(s.banner) + '&quot;)"></div>' : '<div class="comm-hero-banner"></div>';
    const logo = s.avatar ? '<img class="comm-hero-logo" src="' + esc(s.avatar) + '" alt="" loading="lazy">' : '<span class="comm-hero-logo comm-hero-logo-none" aria-hidden="true">🛡️</span>';
    const g = s.gate || {}, li = s.levelInfo || {};
    const pills = '<div class="sqd-pills">' +
      (s.official ? '<span class="comm-pill comm-pill-official" title="Run by the site itself">🏠 Official</span>' : '') +
      (g.kind && g.kind !== 'none'
        ? '<span class="comm-pill comm-pill-pending" title="' + esc(g.text || 'Token-gated') + '">🔒 Gated' + (g.symbol ? ' · $' + esc(g.symbol) : '') + '</span>'
        : '<span class="comm-pill comm-pill-live" title="Anyone with an account can join">🔓 Open</span>') +
      '<span class="comm-pill comm-pill-live">🏅 Lv ' + esc(li.level != null ? li.level : s.level) + '</span>' +
    '</div>';
    const metrics = '<div class="comm-hero-metrics">' +
      '<span>👥 <b>' + fmtNum(s.memberCount) + '</b> members' + (s.verifiedCount != null ? ' <small class="comm-src">' + fmtNum(s.verifiedCount) + ' verified</small>' : '') + '</span>' +
      '<span title="Points the squad earned since Monday 00:00 UTC">⚡ <b>' + fmtNum(s.xpWeek) + '</b> this week</span>' +
      '<span title="Points the squad earned last week">🗓️ <b>' + fmtNum(s.xpLast) + '</b> last week</span>' +
      '<span title="All-time squad points">🏆 <b>' + fmtNum(s.xp) + '</b> all-time</span>' +
    '</div>';
    const level = xpBar('🏆 Squad level', li.level != null ? li.level : s.level, li.intoLevel, li.spanLevel, 'comm-xp-community');
    // membership → the one primary action, plus a badge that says how the server sees you right now
    let actions, badge = '';
    if (!isMember()) {
      actions = '<button class="btn btn-primary comm-join-btn" id="sqd-join" type="button" data-tip="' + (gated() ? 'Joins after reading your linked wallets on-chain to check you hold what it takes' : 'Adds you to this squad — anyone with an account can join') + '">🛡️ Join this squad</button>';
    } else if (isOwner()) {
      badge = '<span class="comm-2x-badge" title="You started this squad. The person who starts a squad cannot leave it.">👑 Squad owner</span>';
      actions = '<button class="btn btn-ghost btn-sm" id="sqd-edit-open" type="button" data-tip="Opens the editor for the name, bio and pictures">✏️ Edit squad</button>' +
        (isVerified() ? '' : '<button class="btn btn-primary btn-sm" id="sqd-reverify" type="button" data-tip="Re-reads your linked wallets on-chain and tries to verify your spot again">↻ Re-verify my holding</button>') +
        '<span class="modal-note sqd-owner-note">The owner cannot leave — a squad always has the person who started it.</span>';
    } else if (isVerified()) {
      badge = '<span class="comm-2x-badge" title="Your membership is verified' + (gated() ? ' — your linked wallets hold what the gate takes' : '') + '">✅ Verified member</span>';
      actions = '<button class="btn btn-ghost comm-join-btn" id="sqd-join" type="button" aria-pressed="true" data-tip="A second tap within four seconds leaves the squad">✓ You’re in</button>';
    } else {
      badge = '<span class="comm-2x-badge comm-2x-off" title="You are a member, but your holding could not be verified at the last on-chain check">⏸ Not verified</span>';
      actions = '<button class="btn btn-primary comm-join-btn" id="sqd-reverify" type="button" data-tip="Re-reads your linked wallets on-chain and tries to verify your spot again">↻ Re-verify my holding</button> ' +
        '<button class="btn btn-ghost btn-sm" id="sqd-leave" type="button" data-tip="Leaves after a second press within four seconds">Leave</button>';
    }
    // the 60s refresh repaints the hero: remember which control had focus so a keyboard user is not dropped to <body>
    const active = document.activeElement, keepId = (active && heroEl.contains(active) && active.id) ? active.id : null;
    heroEl.innerHTML = banner +
      '<div class="comm-hero-body">' +
        '<div class="comm-hero-top">' + logo +
          '<div class="comm-hero-id"><h1 class="comm-hero-name">' + esc(s.name) + '</h1>' +
          '<p class="comm-hero-sub">Send Squad · started by ' + wallLink((s.creator && typeof s.creator === 'object') ? s.creator.username : s.creator) + (s.createdAt ? ' · ' + esc(timeAgo(s.createdAt)) : '') + '</p>' + pills + '</div>' +
          badge +
        '</div>' +
        (s.bio ? '<p class="sqd-bio">' + esc(s.bio) + '</p>' : '') +
        metrics + level + gateLine(s) +
        '<div class="comm-hero-actions sqd-actions">' + actions + '</div>' +
        '<p class="comm-gate-msg" id="sqd-gate" role="status" aria-live="polite" hidden></p>' +
        '<details class="grules comm-rules"><summary>📖 How a Send Squad earns points</summary><div class="grules-body"><ul class="comm-rules-list">' +
          '<li>🛡️ <b>Private.</b> Posts, calls and the conviction board are only ever served to <b>verified members</b> — never on the Send Wall, never on a profile, never in the public data feed.</li>' +
          '<li>🔒 <b>The gate was set once</b> when the squad was started and can never change. A gated squad reads your <b>linked wallets on-chain</b> (summed) when you join, and keeps re-checking while you are in.</li>' +
          '<li>📣 <b>Squad calls:</b> a member calls a token <b>to the squad</b> — same on-chain rules as a public call, but <b>every point goes to the squad</b>: the opening award, the X ladder, the diamond-hands bonus, and every member who Sends It on it. The caller personally earns nothing from it.</li>' +
          '<li>💎 <b>Conviction:</b> once a day, every token a verified member has pinned as a <b>Conviction Play</b> and <b>still holds</b> (worth at least $20 at the live price) earns the squad points — <b>2</b> on the day it is pinned, growing with how long the pin has been held, up to <b>26</b> a day at 360 days. If the price cannot be read that day, the pin is simply skipped — never penalised.</li>' +
          '<li>🧱 <b>Posts, comments and reactions earn the squad nothing</b> — only calls and conviction do. Your own personal points for posting are unchanged.</li>' +
          '<li>🏆 <b>Level</b> climbs on the same curve as communities. The <b>weekly board</b> runs Monday 00:00 UTC → Monday 00:00 UTC, and there is nothing to win but bragging rights. 🎉 Entertainment only — nothing here tells anyone to buy anything.</li>' +
        '</ul></div></details>' +
      '</div>';
    heroEl.hidden = false;
    if (keepId) { const back = document.getElementById(keepId); if (back) { try { back.focus(); } catch {} } }
    // the owner's editor lives outside the hero so a refresh never wipes a half-typed bio
    if (!isOwner()) { editEl.hidden = true; }
    renderLifetime(s.lifetime);
    tabsSec.hidden = false;
    paintTabs();
    // membership decides which tabs are open; re-run the tab only on the first paint or when that changes
    const key = [isMember(), isVerified(), isOwner()].join('|');
    if (key !== lastKey) { lastKey = key; loadTab(true); }
    wire();
  }

  // ---------- lifetime tracker (paper figures, from stored on-chain reads of the squad's calls) ----------
  function renderLifetime(l) {
    if (!lifeEl || !lifeGrid) return;
    if (!l) { lifeEl.hidden = true; return; }
    lifeEl.hidden = false;
    const tile = (val, label, cls, title) => '<div class="sc-stat"' + (title ? ' title="' + esc(title) + '"' : '') + '><b' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</b><i>' + label + '</i></div>';
    lifeGrid.innerHTML =
      tile(fmtNum(l.calls), 'Squad calls', '', 'How many Send Calls members have made to this squad') +
      tile(xFmt(l.totalX), 'Total Xs', l.totalX > 0 ? 'sc-up' : '', 'Sum of each call’s peak X since its entry (each capped at 50x)') +
      tile(xFmt(l.bestX), 'Best X', l.bestX > 0 ? 'sc-up' : '', 'The single highest peak X among the squad’s calls') +
      tile(fmtUsd(l.sentUsd), 'Sent in (paper)', '', 'What callers and followers put in at entry — read on-chain, a paper figure') +
      tile(fmtUsd(l.peakGainUsd), 'Paper gain at peak', l.peakGainUsd > 0 ? 'sc-up' : '', 'What that would have been up at each call’s peak — a paper figure, not realised') +
      tile(fmtUsd(l.nowGainUsd), 'Paper gain now', l.nowGainUsd > 0 ? 'sc-up' : '', 'What it is up (or down) at the current price — a paper figure, not realised');
  }

  // ---------- tabs ----------
  const tabBtns = [...document.querySelectorAll('.sqd-cw-tabs .cw-tab')];
  function paintTabs() {
    for (const b of tabBtns) {
      const on = b.dataset.stab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const k of TABS) { const p = document.getElementById('sqd-panel-' + k); if (p) p.hidden = k !== tab; }
    if (!noteEl) return;
    const m = S && S.members ? S.members : {};
    noteEl.innerHTML = tab === 'wall'
      ? '🔒 <b>Members only.</b> Everything here is visible <b>only to verified members of this squad</b> — never on the Send Wall, never on a profile, never in the public data feed.' + (isVerified() ? ' You are in.' : '')
      : tab === 'calls'
      ? '📣 <b>Squad calls.</b> Private to the squad, and <b>every point goes to the squad</b>. Xs, entry and peak are read on-chain and update live.'
      : tab === 'conviction'
      ? '💎 <b>Conviction.</b> The tokens members have pinned as Conviction Plays and still hold — every count and every day here is from the last on-chain check.'
      : '👥 <b>Members.</b> ' + (m.count != null ? '<b>' + fmtNum(m.count) + '</b> in the squad' + (m.verified != null ? ', <b>' + fmtNum(m.verified) + '</b> verified' : '') + '.' : 'Everyone in the squad, with their role and verified state.');
  }
  function pick(which, focus) {
    if (TABS.indexOf(which) < 0 || tab === which) return;
    // a draft written for the private wall stays private: it is simply kept while you look at another tab
    tab = which;
    paintTabs();
    loadTab(true);
    try { history.replaceState(null, '', location.pathname + location.search + '#' + which); } catch {}
    if (focus) { const b = tabBtns.find(t => t.dataset.stab === which); if (b) b.focus(); }
  }
  function loadTab(force) {
    if (!S) return;
    if (tab === 'wall') { setupComposer(); if (isVerified()) { if (force || !feedEl.children.length) loadWall(true); } else { feedEl.innerHTML = ''; oldest = null; emptyEl.style.display = 'none'; document.getElementById('sqd-more').hidden = true; } }
    else if (tab === 'calls') loadCalls();
    else if (tab === 'conviction') loadConviction();
    else if (tab === 'members') loadMembers();
  }
  // the door to a private tab, in words: who can see it and what to do about it. The server refuses the
  // feed itself to anyone without a verified slot — this control is the door, not the lock.
  function lockedCopy(what) {
    if (!isMember()) return '🔒 <b>The ' + what + ' is for verified members of this squad.</b> It is never sent to anyone else. <b>Join above</b>' + (gated() ? ' — the squad reads your linked wallets on-chain (a free signature, never a transaction) and checks they hold ' + esc((S.gate && S.gate.text) || 'what the gate takes') + '.' : ' — anyone with an account can.');
    return '⏸ <b>Your spot isn’t verified right now</b>, so the ' + what + ' is closed to you. <b>Re-verify above</b> — the squad re-reads your linked wallets on-chain' + (gated() ? ' for ' + esc(gateSym()) : '') + '.';
  }

  // ---------- wall ----------
  function setupComposer() {
    const comp = document.getElementById('sqd-composer'), lk = document.getElementById('sqd-wall-locked');
    if (isVerified() && window.AUTH && AUTH.user) {
      comp.hidden = false; lk.hidden = true; lk.innerHTML = '';
      document.getElementById('sqd-c-ava').textContent = AUTH.user.avatar;
      document.getElementById('sqd-c-handle').textContent = AUTH.user.username;
    } else {
      comp.hidden = true; lk.hidden = false; lk.innerHTML = lockedCopy('wall');
    }
  }
  function postCard(p) {
    const ava = p.avatar_img ? window.avatarHTML(p.avatar_img, 'post-avatar', 'style="object-fit:cover;"') : '<span class="post-avatar" aria-hidden="true">' + esc(p.avatar || '🚀') + '</span>';
    const fire = (p.reactions && p.reactions.fire) || 0, rocket = (p.reactions && p.reactions.rocket) || 0;
    const myR = p.myReactions || [];
    return '<article class="post post-private" data-id="' + Number(p.id) + '">' +
      '<div class="post-head">' + ava + '<div><div class="who"><a class="handle" href="/u/' + encodeURIComponent(p.username) + '" style="text-decoration:none;' + (p.accent ? 'color:' + esc(p.accent) : '') + '">@' + esc(p.username) + '</a>' + ogB(p.og) +
        '<span class="post-lock" title="Squad only — visible only to verified members of this squad">🔒 Squad only</span>' +
      '</div><div class="when">' + timeAgo(p.created_at) + '</div></div></div>' +
      (p.text ? '<p class="post-body">' + rich(p.text, p.tokens) + '</p>' : '') + // $TICKERs → token chips (tokentext.js)
      (p.image ? window.mediaTag(esc(p.image), esc(p.username)) : '') +
      (p.call && window.SendCall ? SendCall.widgetHTML(Object.assign(p.call, { mineOwn: p.mine })) : '') + // a squad call's widget post lands on this wall too
      '<div class="post-actions">' +
        '<button class="react-btn' + (myR.includes('fire') ? ' lit' : '') + '" type="button" aria-pressed="' + myR.includes('fire') + '" data-react="fire" data-tip="Adds your fire reaction to this post, or takes it back" aria-label="React with fire">🔥 <span>' + fire + '</span></button>' +
        '<button class="react-btn' + (myR.includes('rocket') ? ' lit' : '') + '" type="button" aria-pressed="' + myR.includes('rocket') + '" data-react="rocket" data-tip="Adds your rocket reaction to this post, or takes it back" aria-label="React with rocket">🚀 <span>' + rocket + '</span></button>' +
        '<button class="react-btn comm-cmt-toggle" type="button" data-comments data-tip="Shows or hides the comments members left on this post" aria-label="Show comments" aria-expanded="false">💬 <span>' + (p.comments || 0) + '</span></button>' +
        (!p.mine ? '<button class="react-btn post-report" type="button" data-report="post" data-report-id="' + Number(p.id) + '" aria-label="Report this post" data-tip="Reports this post to the moderators">⚑</button>' : '') +
      '</div>' +
      '<div class="comm-cmt-zone" hidden></div>' +
    '</article>';
  }
  function flashPost(el) {
    if (!el) return;
    el.classList.remove('post-flash'); void el.offsetWidth; el.classList.add('post-flash');
    el.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'center' });
  }
  let hashTries = 0;
  function focusFromHash() {
    const m = /^#p(\d+)$/.exec(location.hash || ''); if (!m) return;
    const el = feedEl.querySelector('.post[data-id="' + Number(m[1]) + '"]');
    if (el) { hashTries = 0; setTimeout(() => flashPost(el), 60); return; }
    const more = document.getElementById('sqd-more');
    if (++hashTries <= 2 && more && !more.hidden) { loadWall(false); return; }
    if (hashTries === 3 && window.sendToast) sendToast('That post is not on this wall \u2014 it may be older.');
  }
  async function loadWall(reset) {
    if (reset) { oldest = null; feedEl.innerHTML = ''; }
    const gen = ++wallGen;
    const more = document.getElementById('sqd-more');
    if (more) more.disabled = true;
    try {
      const j = await window.api('/api/squads/' + id + '/posts' + (oldest ? '?before=' + oldest : ''));
      if (gen !== wallGen || tab !== 'wall') return;   // the reader moved on
      const posts = j.posts || [];
      if (!posts.length && !feedEl.children.length) { emptyEl.style.display = 'block'; if (more) more.hidden = true; return; }
      emptyEl.style.display = 'none';
      posts.forEach(p => { feedEl.insertAdjacentHTML('beforeend', postCard(p)); oldest = p.id; });
      if (more) more.hidden = posts.length < 30;
      if (window.SendCall) { SendCall.wire(feedEl); SendCall.live(feedEl); }
      focusFromHash();   // a notification links to /p/<id>, which lands here as ?id=<sid>#p<id>
    } catch (e) {
      if (gen !== wallGen || tab !== 'wall') return;
      // a refusal is the honest answer, not an empty wall: a slot can lapse between loading the page and opening this tab
      document.getElementById('sqd-composer').hidden = true;
      const lk = document.getElementById('sqd-wall-locked');
      lk.hidden = false;
      lk.innerHTML = (e && (e.code === 'members' || e.status === 403)) ? lockedCopy('wall') : '⚠️ <b>' + esc((e && e.message) || 'Could not load the wall.') + '</b>';
      emptyEl.style.display = 'none';
      if (more) more.hidden = true;
    } finally { if (more) more.disabled = false; }
  }

  // ---------- calls ----------
  function callCard(c) {
    const who = c.username
      ? '<div class="post-head">' + (c.avatarImg ? window.avatarHTML(c.avatarImg, 'post-avatar', 'style="object-fit:cover;"') : '<span class="post-avatar" aria-hidden="true">' + esc(c.avatar || '🚀') + '</span>') +
        '<div><div class="who"><a class="handle" href="/u/' + encodeURIComponent(c.username) + '" style="text-decoration:none;' + (c.accent ? 'color:' + esc(c.accent) : '') + '">@' + esc(c.username) + '</a>' + ogB(c.callerOg) +
        '<span class="post-lock" title="A squad call — private to this squad; its points went to the squad">🔒 Squad call</span></div>' +
        '<div class="when">' + (c.calledAt ? timeAgo(c.calledAt) : '') + '</div></div></div>'
      : '';
    return '<article class="post post-private sqd-call" data-call-id="' + Number(c.id) + '">' + who +
      (c.note ? '<p class="post-body">' + rich(c.note, c.tokens) + '</p>' : '') +
      (window.SendCall ? SendCall.widgetHTML(Object.assign(c, { mineOwn: !!c.mine })) : '') +
    '</article>';
  }
  async function loadCalls() {
    const lk = document.getElementById('sqd-calls-locked'), st = document.getElementById('sqd-calls-status'), btn = document.getElementById('sqd-call-btn');
    if (btn) btn.hidden = !isVerified();
    if (!isVerified()) { lk.hidden = false; lk.innerHTML = lockedCopy('calls list'); callsEl.innerHTML = ''; callsEmpty.style.display = 'none'; st.textContent = ''; return; }
    lk.hidden = true; lk.innerHTML = '';
    if (!callsEl.children.length) st.textContent = 'Loading squad calls…';
    try {
      const j = await window.api('/api/squads/' + id + '/calls');
      if (tab !== 'calls') return;
      st.textContent = '';
      const calls = j.calls || [];
      if (j.lifetime) renderLifetime(j.lifetime);
      if (!calls.length) { callsEl.innerHTML = ''; callsEmpty.style.display = 'block'; return; }
      callsEmpty.style.display = 'none';
      callsEl.innerHTML = calls.map(callCard).join('');
      if (window.SendCall) { SendCall.wire(callsEl); SendCall.live(callsEl); }
    } catch (e) {
      if (tab !== 'calls') return;
      st.textContent = '';
      if (e && (e.code === 'members' || e.status === 403)) { lk.hidden = false; lk.innerHTML = lockedCopy('calls list'); callsEl.innerHTML = ''; callsEmpty.style.display = 'none'; return; }
      if (!callsEl.children.length) st.textContent = '⚠️ ' + ((e && e.message) || 'Could not load the squad’s calls.');
    }
  }

  // ---------- conviction ----------
  function holderLinks(list, total) {
    const names = (list || []).map(u => '<a class="sqd-holder" href="/u/' + encodeURIComponent(u) + '">@' + esc(u) + '</a>').join(', ');
    const more = total != null && total > (list || []).length ? ' <span class="sqd-holder-more">+' + fmtNum(total - list.length) + ' more</span>' : '';
    return names ? names + more : '—';
  }
  function tokenRow(t) {
    const logo = t.image ? '<img class="sqd-tok-logo" src="' + esc(t.image) + '" alt="" loading="lazy" decoding="async" width="28" height="28">' : '<span class="sqd-tok-logo sqd-tok-logo-none" aria-hidden="true">🪙</span>';
    return '<tr>' +
      '<th scope="row" class="sqd-tok">' + logo + '<span class="sqd-tok-id"><b>$' + esc(t.symbol || '?') + '</b><span class="sqd-tok-name">' + esc(t.name || '') + '</span></span></th>' +
      '<td class="sqd-num">' + fmtNum(t.members) + '</td>' +
      '<td class="sqd-num">' + fmtNum(t.held) + '</td>' +
      '<td class="sqd-num">' + days(t.longestDays) + '</td>' +
      '<td class="sqd-num">' + days(t.avgDays) + '</td>' +
      '<td class="sqd-holders">' + holderLinks(t.holders, t.members) + '</td>' +
    '</tr>';
  }
  function topRow(m, i) {
    const ava = m.avatar_img ? window.avatarHTML(m.avatar_img, 'cm-ava', 'loading="lazy"') : '<span class="cm-ava cm-ava-emoji" aria-hidden="true">' + esc(m.avatar || '🚀') + '</span>';
    const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    return '<li class="cm-row">' +
      '<span class="cm-rank" role="img" aria-label="' + (i < 3 ? 'rank ' + (i + 1) : String(i + 1)) + '">' + rank + '</span>' + ava +
      '<a class="cm-name" href="/u/' + encodeURIComponent(m.username) + '">@' + esc(m.username) + '</a>' +
      '<span class="cm-lvl" title="Pinned tokens still held · longest pin">📌 ' + fmtNum(m.pins) + ' · 💎 ' + days(m.longestDays) + '</span>' +
    '</li>';
  }
  async function loadConviction() {
    const st = document.getElementById('sqd-conv-status'), pts = document.getElementById('sqd-conv-points');
    const tokEl = document.getElementById('sqd-conv-tokens'), topEl = document.getElementById('sqd-conv-top'), chk = document.getElementById('sqd-conv-checked');
    if (!tokEl.children.length) st.textContent = 'Loading the conviction board…';
    try {
      const j = await window.api('/api/squads/' + id + '/conviction');
      if (tab !== 'conviction') return;
      st.textContent = '';
      const tokens = j.tokens || [], top = j.top || [];
      pts.innerHTML =
        '<div class="sc-stat" title="Points conviction has earned the squad, all-time"><b>' + fmtNum(j.pointsAllTime) + '</b><i>Conviction pts all-time</i></div>' +
        '<div class="sc-stat" title="Points conviction has earned the squad since Monday 00:00 UTC"><b>' + fmtNum(j.pointsWeek) + '</b><i>Conviction pts this week</i></div>' +
        '<div class="sc-stat" title="Distinct tokens pinned by members"><b>' + fmtNum(tokens.length) + '</b><i>Tokens</i></div>';
      tokEl.innerHTML = tokens.length
        ? '<table class="sqd-table"><thead><tr>' +
            '<th scope="col">Token</th><th scope="col" class="sqd-num" title="Members with this token pinned">Convicted</th><th scope="col" class="sqd-num" title="Of those, still holding at the last on-chain check">Still holding</th>' +
            '<th scope="col" class="sqd-num" title="Longest a member has kept it pinned">Longest</th><th scope="col" class="sqd-num" title="Average days pinned">Average</th><th scope="col">Holders</th>' +
          '</tr></thead><tbody>' + tokens.map(tokenRow).join('') + '</tbody></table>'
        : '<p class="modal-note sqd-conv-empty">No conviction plays yet. Members pin tokens on their own profile as <b>Conviction Plays</b>; every pin a verified member still holds earns the squad points daily.</p>';
      topEl.innerHTML = top.map(topRow).join('') || '<li class="modal-note sqd-conv-empty">Nobody yet — the first member to pin a token they hold goes here.</li>';
      chk.textContent = j.checkedAt ? 'Last on-chain check ' + timeAgo(j.checkedAt) + '. Counts are only ever what the chain said then.' : 'No on-chain check has run yet.';
    } catch (e) {
      if (tab !== 'conviction') return;
      st.textContent = '⚠️ ' + ((e && e.message) || 'Could not load the conviction board.');
    }
  }

  // ---------- members ----------
  function memberRow(m, i) {
    const ava = m.avatar_img ? window.avatarHTML(m.avatar_img, 'cm-ava', 'loading="lazy"') : '<span class="cm-ava cm-ava-emoji" aria-hidden="true">' + esc(m.avatar || '🚀') + '</span>';
    const owner = m.role === 'owner';
    const crown = owner ? '<span class="cm-crown" role="img" title="Squad owner" aria-label="squad owner">👑</span>' : '';
    const nameStyle = m.accent ? ' style="color:' + esc(m.accent) + '"' : '';
    const ver = m.verified
      ? '<span class="sqd-ver sqd-ver-on" title="Verified at the last on-chain check">✅ Verified</span>'
      : '<span class="sqd-ver sqd-ver-off" title="Not verified at the last on-chain check">⏳ Unverified</span>';
    return '<li class="cm-row' + (owner ? ' cm-creator' : '') + '">' +
      '<span class="cm-rank" aria-hidden="true">' + (i + 1) + '</span>' + ava +
      '<a class="cm-name" href="/u/' + encodeURIComponent(m.username) + '"' + nameStyle + '>@' + esc(m.username) + '</a>' + ogB(m.og) + crown + ver +
      '<span class="cm-lvl" title="Pinned tokens still held · longest pin · joined">📌 ' + fmtNum(m.pins) + ' · 💎 ' + days(m.longestDays) + (m.joinedAt ? ' · ' + esc(timeAgo(m.joinedAt)) : '') + '</span>' +
    '</li>';
  }
  async function loadMembers() {
    const listEl = document.getElementById('sqd-members-list'), st = document.getElementById('sqd-members-status'), sub = document.getElementById('sqd-members-sub');
    if (!listEl.children.length) st.textContent = 'Loading members…';
    try {
      const j = await window.api('/api/squads/' + id + '/members');
      if (tab !== 'members') return;
      st.textContent = '';
      const members = j.members || [];
      const verified = members.filter(m => m.verified).length;
      sub.innerHTML = '<b>' + fmtNum(j.count != null ? j.count : members.length) + '</b> member' + ((j.count != null ? j.count : members.length) === 1 ? '' : 's') + ' · <b>' + fmtNum(verified) + '</b> verified' + (j.count > members.length ? ' · showing the first ' + fmtNum(members.length) : '') + '. Owner first, then by when they joined.';
      listEl.innerHTML = members.map(memberRow).join('') || '<li class="modal-note">Nobody here yet.</li>';
    } catch (e) {
      if (tab !== 'members') return;
      st.textContent = '⚠️ ' + ((e && e.message) || 'Could not load the members.');
    }
  }

  // ---------- join / leave / re-verify ----------
  // The gate refusal, from the 403 body: what it takes vs what the viewer's wallets hold. Only the figures the
  // server sent are printed; nothing here suggests getting more of anything.
  function gateRefusal(j) {
    const need = j.need || {}, held = j.held || {};
    const sym = need.symbol ? '$' + esc(need.symbol) : esc(gateSym());
    const takes = need.kind === 'pct'
      ? (need.amount != null ? esc(fmtNum(need.amount)) + '% of ' + sym + '’s supply' + (need.tokens != null ? ' (≈ ' + esc(fmtNum(need.tokens)) + ' ' + sym + ')' : '') : '—')
      : (need.tokens != null ? esc(fmtNum(need.tokens)) + ' ' + sym : need.amount != null ? esc(fmtNum(need.amount)) + ' ' + sym : '—');
    const holds = held.tokens != null ? esc(fmtNum(held.tokens)) + ' ' + sym : '—';
    const noWallet = !(window.AUTH && AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length);
    return '🪙 ' + esc(j.error || 'Your linked wallets do not hold what this squad takes.') +
      ' <b>It takes ' + takes + '</b>; your linked wallets hold <b>' + holds + '</b> (summed, read on-chain).' +
      (noWallet ? ' <b>Step 1:</b> <a class="linklike" href="/profile.html#connected-wallet">Connect a wallet →</a> (a free signature — never a transaction).' : '');
  }
  async function membership(btn, leaving) {
    if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
    btn.disabled = true;
    const gate = document.getElementById('sqd-gate');
    try {
      const r = await fetch('/api/squads/' + id + '/join', { method: leaving ? 'DELETE' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) { if (window.AUTH) AUTH.open(); btn.disabled = false; return; }
        if (gate && r.status === 403 && j.code === 'gate') { gate.hidden = false; gate.innerHTML = gateRefusal(j); if (window.announce) announce(gate.textContent); }
        else if (gate && r.status === 503) { gate.hidden = false; gate.textContent = '⏳ ' + (j.error || 'The chain could not be read just now — nothing was decided. Try again in a moment.'); }
        else if (j.needsProof && window.AUTH && AUTH.needsProof) { try { AUTH.needsProof(Object.assign(new Error(j.error || ''), { needsProof: true, proof: j.proof || null })); } catch {} }
        if (window.sendToast) sendToast(j.error || 'Could not update');
        btn.disabled = false; return;
      }
      if (gate) { gate.hidden = true; gate.innerHTML = ''; }
      if (leaving) { if (window.sendToast) sendToast('Left the squad'); S = null; lastKey = null; feedEl.innerHTML = ''; callsEl.innerHTML = ''; await load(); }
      else {
        if (window.sendToast) sendToast(j.verified ? '🛡️ You’re in — verified' + (gated() ? ' on-chain' : '') + '!' : '🛡️ You’re in — but not verified yet');
        if (j.squad) renderHero(j.squad); else await load();
      }
      const nb = document.getElementById('sqd-join') || document.getElementById('sqd-reverify'); if (nb) nb.focus(); // keyboard focus back on the rebuilt control
    } catch { btn.disabled = false; if (window.sendToast) sendToast('Could not update'); }
  }
  // Leaving is destructive yet the button reads like a status pill — require a second tap within 4s.
  function armed(btn) {
    if (btn._armed) { clearTimeout(btn._armT); btn._armed = false; return true; }
    btn._armed = true; btn.dataset.label = btn.textContent; btn.textContent = '⚠️ Tap again to leave';
    btn.setAttribute('aria-label', 'Tap again to confirm leaving this squad');
    if (window.announce) announce('Tap again to confirm leaving. Expires in 4 seconds.');
    clearTimeout(btn._armT); btn._armT = setTimeout(() => { if (btn.isConnected) { btn._armed = false; btn.textContent = btn.dataset.label || '✓ You’re in'; btn.removeAttribute('aria-label'); } }, 4000);
    return false;
  }

  // ---------- owner editor ----------
  let pendAva = null, pendBan = null;
  function fillEdit() {
    if (!S) return;
    document.getElementById('sqd-edit-name').value = S.name || '';
    document.getElementById('sqd-edit-bio').value = S.bio || '';
    pendAva = null; pendBan = null;
    document.getElementById('sqd-edit-ava-rm').checked = false;
    document.getElementById('sqd-edit-ban-rm').checked = false;
    document.getElementById('sqd-edit-ava').value = '';
    document.getElementById('sqd-edit-ban').value = '';
    paintEditPreview('ava', S.avatar); paintEditPreview('ban', S.banner);
    document.getElementById('sqd-edit-status').textContent = '';
  }
  function paintEditPreview(kind, src) {
    const el = document.getElementById('sqd-edit-' + kind + '-prev'); if (!el) return;
    if (src) { el.style.backgroundImage = 'url("' + String(src).replace(/["\\]/g, '\\$&') + '")'; el.classList.add('has-img'); el.innerHTML = ''; }
    else { el.style.backgroundImage = ''; el.classList.remove('has-img'); el.innerHTML = kind === 'ava' ? '<span class="sqd-edit-fallback">🛡️</span>' : ''; }
  }
  function readImage(input, kind) {
    const f = input.files && input.files[0]; if (!f) return;
    const st = document.getElementById('sqd-edit-status');
    if (IMG_TYPES.indexOf((f.type || '').toLowerCase()) < 0) { st.textContent = '⚠️ Use a JPG, PNG or WebP.'; input.value = ''; return; }
    if (f.size > IMG_MAX) { st.textContent = '⚠️ That file is over 3.5 MB — pick a smaller one.'; input.value = ''; return; }
    const rd = new FileReader();
    rd.onload = () => {
      if (kind === 'ava') { pendAva = rd.result; document.getElementById('sqd-edit-ava-rm').checked = false; }
      else { pendBan = rd.result; document.getElementById('sqd-edit-ban-rm').checked = false; }
      paintEditPreview(kind, rd.result); st.textContent = '';
    };
    rd.onerror = () => { st.textContent = '⚠️ Could not read that file.'; input.value = ''; };
    rd.readAsDataURL(f);
  }
  async function saveEdit(e) {
    e.preventDefault();
    if (!S || !isOwner()) return;
    const st = document.getElementById('sqd-edit-status'), save = document.getElementById('sqd-edit-save');
    const name = document.getElementById('sqd-edit-name').value.trim(), bio = document.getElementById('sqd-edit-bio').value.trim();
    const body = {};
    if (name !== (S.name || '')) { if (!SQUAD_NAME_RE.test(name)) { st.textContent = '⚠️ A name is 3–40 characters: letters, numbers, spaces and . - \' $ & ! ?'; document.getElementById('sqd-edit-name').focus(); return; } body.name = name; }
    if (bio !== (S.bio || '')) { if (bio.length > 280) { st.textContent = '⚠️ The bio is at most 280 characters.'; return; } body.bio = bio; }
    if (document.getElementById('sqd-edit-ava-rm').checked) body.removeAvatar = true; else if (pendAva) body.avatar = pendAva;
    if (document.getElementById('sqd-edit-ban-rm').checked) body.removeBanner = true; else if (pendBan) body.banner = pendBan;
    if (!Object.keys(body).length) { st.textContent = 'Nothing changed.'; return; }
    save.disabled = true; st.textContent = 'Saving… ⏳';
    try {
      const j = await window.api('/api/squads/' + id + '/settings', { method: 'POST', body });
      st.textContent = '';
      if (window.sendToast) sendToast('Squad updated ✨');
      editEl.hidden = true;
      if (j.squad) renderHero(j.squad); else await load();
      const ob = document.getElementById('sqd-edit-open'); if (ob) ob.focus();
    } catch (err) { st.textContent = '⚠️ ' + ((err && err.message) || 'could not save'); }
    save.disabled = false;
  }

  // ---------- wiring (once) ----------
  function wire() {
    if (heroEl._wired) return; heroEl._wired = true;
    document.addEventListener('click', async (e) => {
      const join = e.target.closest('#sqd-join');
      if (join) {
        const leaving = isMember();
        if (leaving && !armed(join)) return;
        membership(join, leaving); return;
      }
      const leave = e.target.closest('#sqd-leave');
      if (leave) { if (!armed(leave)) return; membership(leave, true); return; }
      const rv = e.target.closest('#sqd-reverify');
      if (rv) { membership(rv, false); return; }
      const eo = e.target.closest('#sqd-edit-open');
      if (eo) { fillEdit(); editEl.hidden = false; editEl.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'start' }); setTimeout(() => { try { document.getElementById('sqd-edit-name').focus(); } catch {} }, 250); return; }
      const vt = e.target.closest('.sqd-viewtoken');
      if (vt && S && S.gate && S.gate.token && window.TokenModal) { TokenModal.open(S.gate.token, { symbol: S.gate.symbol, name: S.gate.name }); return; }
    });
    // feed: reactions + comments
    feedEl.addEventListener('click', async (e) => {
      const rb = e.target.closest('[data-react]');
      if (rb) {
        if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
        const post = rb.closest('.post'), pid = post.dataset.id;
        try { const j = await window.api('/api/posts/' + pid + '/react', { method: 'POST', body: { kind: rb.dataset.react } }); rb.classList.toggle('lit', j.on); rb.setAttribute('aria-pressed', String(!!j.on)); rb.querySelector('span').textContent = j.count; if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned); }
        catch (err) { const m = (err && err.message) || 'could not react'; if (window.sendToast) sendToast(m); if (window.announce) announce(m); }
        return;
      }
      const ct = e.target.closest('[data-comments]');
      if (ct) { toggleComments(ct.closest('.post')); return; }
    });
    // composer
    const send = document.getElementById('sqd-c-send'), ta = document.getElementById('sqd-c-text'), count = document.getElementById('sqd-c-count');
    const setCount = (n) => { count.textContent = n; count.setAttribute('aria-hidden', n > 20 ? 'true' : 'false'); }; // announce to SRs only when low
    ta.addEventListener('input', () => setCount(500 - ta.value.length));
    const imgEl = document.getElementById('sqd-c-img');
    const clearMedia = () => { img = null; imgEl._attachGen = (imgEl._attachGen || 0) + 1; imgEl.value = ''; window.setMediaPreview(document.getElementById('sqd-c-preview'), null); };
    imgEl.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const st = document.getElementById('sqd-c-status'); send.disabled = true;
      const r = await window.guardedAttach(e.target, f, document.getElementById('sqd-c-preview'), clearMedia, m => { if (st) st.textContent = m; });
      send.disabled = false;
      if (r && r.skip) return;
      if (!r) { clearMedia(); return; }
      img = r.url;
    });
    send.addEventListener('click', async () => {
      const text = ta.value.trim(), st = document.getElementById('sqd-c-status');
      if (imgEl._busy) { st.textContent = 'Hang on — still uploading… ⏳'; return; }
      if (!text && !img) { st.textContent = 'Say something first 🤌'; return; }
      send.disabled = true;
      try {
        const j = await window.api('/api/squads/' + id + '/posts', { method: 'POST', body: { text, image: img } });
        ta.value = ''; img = null; setCount(500); window.setMediaPreview(document.getElementById('sqd-c-preview'), null); imgEl.value = ''; st.textContent = '';
        feedEl.insertAdjacentHTML('afterbegin', postCard(j.post)); emptyEl.style.display = 'none';
        if (window.showPoints && j.pointsEarned > 0) showPoints(j.pointsEarned);
        if (window.sendToast) sendToast('Posted to the squad 🔒');
      } catch (err) { st.textContent = '⚠️ ' + ((err && err.message) || 'could not post'); }
      send.disabled = false;
    });
    document.getElementById('sqd-more').addEventListener('click', () => loadWall(false));

    // tabs: click + arrow keys (roving tabindex)
    tabBtns.forEach((b, i) => {
      b.addEventListener('click', () => pick(b.dataset.stab, false));
      b.addEventListener('keydown', e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        pick(tabBtns[(i + d + tabBtns.length) % tabBtns.length].dataset.stab, true);
      });
    });

    // "call a token to this squad" → the site composer in call mode with this squad preselected (compose.js
    // exposes window.COMPOSE.openCall); without it, the plain FAB so the reader still lands in the composer
    const callBtn = document.getElementById('sqd-call-btn');
    if (callBtn) callBtn.addEventListener('click', () => {
      if (!(window.AUTH && AUTH.user)) { if (window.AUTH) AUTH.open(); return; }
      if (!isVerified()) { if (window.sendToast) sendToast('Only verified members can call a token to this squad'); return; }
      if (window.COMPOSE && typeof COMPOSE.openCall === 'function') { COMPOSE.openCall({ squadId: id, squadName: S ? S.name : '' }); return; }
      const fab = document.getElementById('compose-fab');
      if (fab) fab.click(); else if (window.sendToast) sendToast('The composer isn’t available on this page');
    });

    // owner editor
    document.getElementById('sqd-edit-form').addEventListener('submit', saveEdit);
    document.getElementById('sqd-edit-cancel').addEventListener('click', () => { editEl.hidden = true; pendAva = null; pendBan = null; const ob = document.getElementById('sqd-edit-open'); if (ob) ob.focus(); });
    document.getElementById('sqd-edit-ava').addEventListener('change', (e) => readImage(e.target, 'ava'));
    document.getElementById('sqd-edit-ban').addEventListener('change', (e) => readImage(e.target, 'ban'));
    document.getElementById('sqd-edit-ava-rm').addEventListener('change', (e) => { if (e.target.checked) { pendAva = null; document.getElementById('sqd-edit-ava').value = ''; paintEditPreview('ava', null); } else paintEditPreview('ava', S && S.avatar); });
    document.getElementById('sqd-edit-ban-rm').addEventListener('change', (e) => { if (e.target.checked) { pendBan = null; document.getElementById('sqd-edit-ban').value = ''; paintEditPreview('ban', null); } else paintEditPreview('ban', S && S.banner); });
  }

  async function toggleComments(post, refresh) {
    const zone = post.querySelector('.comm-cmt-zone'), tbtn = post.querySelector('.comm-cmt-toggle');
    const setOpen = (open) => { if (tbtn) { tbtn.setAttribute('aria-expanded', String(open)); tbtn.setAttribute('aria-label', open ? 'Hide comments' : 'Show comments'); } };
    if (!zone.hidden && !refresh) { zone.hidden = true; setOpen(false); return; }
    zone.hidden = false; setOpen(true); zone.innerHTML = '<p class="modal-note">loading…</p>';
    const pid = post.dataset.id;
    try {
      const j = await window.api('/api/posts/' + pid + '/comments');
      const tog = post.querySelector('.comm-cmt-toggle span'); if (tog) tog.textContent = (j.comments || []).length; // keep the 💬 badge truthful
      const list = (j.comments || []).map(c => '<div class="comm-cmt"><a class="c-who" href="/u/' + encodeURIComponent(c.username) + '">@' + esc(c.username) + '</a>' + ogB(c.og) + ' <span class="c-text">' + rich(c.text, c.tokens) + '</span></div>').join('') || '<p class="modal-note">no comments yet — start it off 👇</p>';
      zone.innerHTML = list + (window.AUTH && AUTH.user ? '<form class="comm-cmt-form"><input class="addr-input" maxlength="300" placeholder="add a comment…" aria-label="Write a comment"><button class="btn btn-primary btn-sm" type="submit" data-tip="Adds what you typed as a comment on this post">Reply</button></form>' : '<p class="modal-note"><button class="linklike" type="button" data-signin data-tip="Opens the sign-in box so you can join in">Sign in</button> to comment.</p>');
      const form = zone.querySelector('.comm-cmt-form');
      if (form) form.addEventListener('submit', async (ev) => { ev.preventDefault(); const inp = form.querySelector('input'); const txt = inp.value.trim(); if (!txt) return; try { const cj = await window.api('/api/posts/' + pid + '/comments', { method: 'POST', body: { text: txt } }); inp.value = ''; await toggleComments(post, true); const back = zone.querySelector('.comm-cmt-form input'); if (back) { try { back.focus(); } catch {} } if (window.announce) announce('Comment posted'); if (window.showPoints && cj.pointsEarned > 0) showPoints(cj.pointsEarned); }
        catch (err) { const m = (err && err.message) || 'could not send'; if (window.sendToast) sendToast(m); if (window.announce) announce(m); } });
      const si = zone.querySelector('[data-signin]'); if (si) si.addEventListener('click', () => { if (window.AUTH) AUTH.open(); });
    } catch { zone.innerHTML = '<p class="modal-note">could not load comments</p>'; }
  }

  // ---------- load / lock / fail ----------
  function showLocked(on) {
    lockedEl.hidden = !on;
    if (on) { heroEl.hidden = true; editEl.hidden = true; lifeEl.hidden = true; tabsSec.hidden = true; feedEl.innerHTML = ''; callsEl.innerHTML = ''; oldest = null; lastKey = null; }
  }
  // The hero carries the page's only <h1> and its <title>, so a failure has to paint both too.
  function renderFailure(msg) {
    document.title = msg + ' — $Send 🛡️';
    showLocked(false);
    heroEl.hidden = false;
    heroEl.innerHTML = '<div style="text-align:center; padding:1.5rem;"><h1 class="comm-hero-name" style="font-size:1.4rem;">' + esc(msg) + '</h1>' +
      '<p class="modal-note" style="margin:0.5rem 0 0;"><a href="communities.html?tab=squads">Browse all Send Squads →</a></p></div>';
  }
  async function load() {
    if (!id) { renderFailure('No squad specified'); return; }
    try {
      const j = await window.api('/api/squads/' + id);
      if (j.squad) { showLocked(false); renderHero(j.squad); }
      else if (!S) renderFailure('Squad not found');
    } catch (e) {
      if (e && (e.status === 401 || e.code === 'need_signin')) { S = null; showLocked(true); return; }
      if (!S) renderFailure(e && e.status === 404 ? 'Squad not found' : 'Could not load this squad');
    }
  }
  document.getElementById('sqd-signin').addEventListener('click', () => { if (window.AUTH) AUTH.open(); });

  // deep links: #wall / #calls / #conviction / #members open a tab; #p<id> is a post on the wall
  (function () {
    const h = (location.hash || '').slice(1);
    if (TABS.indexOf(h) >= 0) tab = h;
  })();
  paintTabs();
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').slice(1);
    if (TABS.indexOf(h) >= 0) { pick(h, false); return; }
    if (/^p\d+$/.test(h)) { hashTries = 0; if (tab !== 'wall') pick('wall', false); else focusFromHash(); }
  });

  // a squad call made from the composer (compose.js dispatches squad:call, never post:created — the post is private)
  document.addEventListener('squad:call', (e) => {
    const d = e.detail || {}; if (Number(d.squadId) !== id) return;
    if (tab === 'calls') loadCalls();
    load();   // the squad's points, level and lifetime figures moved
  });
  // a post or squad call made from the site composer lands here live (compose.js dispatches post:created)
  document.addEventListener('post:created', (e) => {
    const p = e.detail; if (!p) return;
    const sid = (p.squad && p.squad.id) || (p.call && p.call.squadId);
    if (Number(sid) !== id) return;
    if (tab === 'wall' && isVerified() && p.id && !feedEl.querySelector('.post[data-id="' + Number(p.id) + '"]')) {
      feedEl.insertAdjacentHTML('afterbegin', postCard(p)); emptyEl.style.display = 'none';
      if (window.SendCall) { SendCall.wire(feedEl); SendCall.live(feedEl); }
      flashPost(feedEl.firstElementChild);
    }
    if (p.call && tab === 'calls') loadCalls();
    load();   // the squad's points, level and lifetime figures moved
  });

  load();
  document.addEventListener('auth:change', () => { lastKey = null; load(); }); // re-render on sign-in/out (locked panel, composer, private tabs)
  // the hero's figures and the tab on screen stay live while the tab is showing; the wall is left alone so a draft or an open thread is never yanked
  // the hero is left alone while the reader is mid-action: a gate refusal on screen, or a leave button they have just armed
  setInterval(() => { if (document.hidden || !S) return; const busy = heroEl && (heroEl.querySelector('#sqd-gate:not(:empty)') || [...heroEl.querySelectorAll('button')].some(b => b._armed)); if (!busy) load(); if (tab !== 'wall') loadTab(true); }, 60000);
})();
