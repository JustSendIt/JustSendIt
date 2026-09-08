/* ===== compete.js — the Arcade's competitions hub ==================================================
   Every race running on the site, in one place: this week's Biggest Sender, this week's Send Calls, the
   community race, the OG campaign, today's Rocket Run and the all-time Hall of Fame. One read of
   /api/competitions feeds every card; the clocks tick locally from the server's own clock, and the page
   re-reads every 45 s while it is visible. Nothing here is typed in — every prize, ladder, window and date
   comes from the server, which is what pays them. buildHTML(data, ctx) is a pure function of the data so
   the whole hub can be rendered headless.
   "Movement" chips (▲2 / ▼1 / NEW) compare a board against the one this browser saw the LAST time the
   page was opened — local, honest, and labelled as such. */
(function () {
  'use strict';
  const root = document.getElementById('cmp'); if (!root) return;
  const grid = document.getElementById('cmp-grid'), jump = document.getElementById('cmp-jump'), live = document.getElementById('cmp-live');

  /* ---------- formatting ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const nf = n => Number(n || 0).toLocaleString('en-US');
  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  // the same shape the Send Wall prints a call's gain in: +2.00x means the token tripled from the entry
  const xf = (x, d) => (x == null || !isFinite(x)) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d == null ? 2 : d) + 'x';
  function fmtLeft(ms) {
    if (!(ms > 0)) return 'any moment now';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
    return d > 0 ? d + 'd ' + h + 'h ' + m + 'm' : h > 0 ? h + 'h ' + m + 'm ' + s + 's' : m + 'm ' + s + 's';
  }
  function dateShort(ms) { try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } }
  function dateUTC(ms) { return new Date(ms).toUTCString().slice(0, 16); }
  const medal = ['🥇', '🥈', '🥉'];
  const reduced = () => (window.prefersReduced ? window.prefersReduced() : (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));

  /* ---------- clock: the server's now, carried forward on this device ---------- */
  let offset = 0;
  const serverNow = () => Date.now() + offset;

  /* ---------- pieces ---------- */
  function ava(u, cls) {
    return u.avatar_img && window.avatarHTML ? window.avatarHTML(u.avatar_img, cls, 'loading="lazy"')
      : '<span class="' + cls + ' cmp-ava--emoji" aria-hidden="true">' + esc(u.avatar || '🚀') + '</span>';
  }
  const ogb = u => (window.ogBadge ? window.ogBadge(u.og) : '');
  const nameLink = u => '<a class="cmp-name" href="/u/' + encodeURIComponent(u.username) + '"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + '</a>';
  function move(prev, u) {
    if (!prev) return '';
    const was = prev[u.username];
    if (was == null) return '<span class="cmp-move cmp-move--new" title="Not on this board when you last looked">NEW</span>';
    const d = was - u.rank;
    if (!d) return '';
    const up = d > 0, n = Math.abs(d);
    return '<span class="cmp-move cmp-move--' + (up ? 'up' : 'down') + '" role="img" aria-label="' + (up ? 'up' : 'down') + ' ' + n + ' since your last visit" title="' + (up ? 'Up' : 'Down') + ' ' + n + ' since your last visit">' + (up ? '▲' : '▼') + n + '</span>';
  }
  function mark(rows, username) {
    const me = username ? username.toLowerCase() : null;
    return (rows || []).map(u => Object.assign({}, u, { me: !!(me && u.username && u.username.toLowerCase() === me) }));
  }
  // top three as a podium: DOM order 1-2-3 for a screen reader, CSS puts #1 in the middle and tallest
  function podium(rows, prev, valueOf, label) {
    const top = rows.slice(0, 3); if (!top.length) return '';
    const max = Math.max(1, ...top.map(valueOf));
    return '<ol class="cmp-podium" aria-label="Top three">' + top.map(u => {
      const h = Math.max(22, Math.round(valueOf(u) / max * 100));
      return '<li class="cmp-step cmp-step--' + Math.min(3, u.rank) + (u.me ? ' is-me' : '') + '" style="--h:' + h + '%">' +
        '<div class="cmp-step-who">' + ava(u, 'cmp-ava') + '<span class="cmp-step-name">' + nameLink(u) + ogb(u) + move(prev, u) + '</span></div>' +
        '<div class="cmp-bar"><span class="cmp-bar-rank" aria-hidden="true">' + (medal[u.rank - 1] || '#' + u.rank) + '</span><span class="sr-only">Place ' + u.rank + '</span></div>' +
        '<span class="cmp-step-val">' + label(u) + '</span>' +
      '</li>';
    }).join('') + '</ol>';
  }
  function list(rows, prev, label) {
    const rest = rows.slice(3); if (!rest.length) return '';   // positional, like the podium — a shared rank in the top three must not drop a row
    return '<ol class="cmp-list" aria-label="Places ' + rest[0].rank + ' to ' + rest[rest.length - 1].rank + '">' + rest.map(u =>
      '<li' + (u.me ? ' class="is-me"' : '') + '><span class="cmp-rank">#' + u.rank + '</span>' + ava(u, 'cmp-ava cmp-ava--sm') + nameLink(u) + ogb(u) + move(prev, u) + '<span class="cmp-val">' + label(u) + '</span></li>').join('') + '</ol>';
  }
  function card(id, o) {
    const now = serverNow();
    return '<article class="card cmp-card cmp-card--' + id + '" id="cmp-' + id + '" aria-labelledby="cmp-' + id + '-h">' +
      '<header class="cmp-card-head">' +
        '<h3 class="cmp-card-h" id="cmp-' + id + '-h"><span class="cmp-card-ico" aria-hidden="true">' + o.emoji + '</span>' + esc(o.title) + '</h3>' +
        '<span class="cmp-head-tools">' +
          (o.live ? '<span class="cmp-live-pill"><i aria-hidden="true"></i>' + esc(o.live) + '</span>' : '') +
          (o.how ? '<button class="cmp-info" id="cmp-' + id + '-info" type="button" aria-expanded="false" aria-controls="cmp-' + id + '-tip" aria-describedby="cmp-' + id + '-tip" aria-label="How ' + esc(o.title) + ' works">ⓘ</button>' : '') +
        '</span>' +
        (o.how ? '<div class="cmp-tip" role="tooltip" id="cmp-' + id + '-tip">' + o.how + '</div>' : '') +
      '</header>' +
      (o.clock ? '<p class="cmp-clock">' + esc(o.clock.label) + ' <b class="cmp-count" data-ends="' + o.clock.endsAt + '">' + fmtLeft(o.clock.endsAt - now) + '</b>' +
        (o.clock.startsAt ? '<span class="cmp-prog" aria-hidden="true"><span style="width:' + Math.max(0, Math.min(100, Math.round((now - o.clock.startsAt) / (o.clock.endsAt - o.clock.startsAt) * 100))) + '%"></span></span>' : '') + '</p>' : '') +
      (o.prize ? '<p class="cmp-prize">' + o.prize + '</p>' : '') +
      '<div class="cmp-body">' + (o.body || '') + '</div>' +
      (o.me ? '<p class="cmp-me">' + o.me + '</p>' : '') +
      (o.cta ? '<div class="cmp-actions">' + o.cta + '</div>' : '') +
    '</article>';
  }
  const signInBtn = label => '<button class="btn btn-sm btn-ghost" type="button" data-cmp-signin>' + esc(label || 'Sign in to race') + '</button>';

  /* ---------- the six cards ---------- */
  function biggestSenderCard(d, ctx) {
    const bs = d.biggestSender, n = bs.prize.winners, ladder = bs.prize.ladder || [], rows = mark(bs.top, ctx.username);
    const pts = u => compact(u.points) + ' SP';
    let me = '';
    if (!ctx.signedIn) me = 'Everything you earn this week counts toward the prize places. ' + signInBtn();
    else if (bs.me && bs.me.rank) {
      const inside = bs.me.rank <= n, edge = rows[n - 1];
      me = 'You are <b>#' + bs.me.rank + '</b> with <b>' + nf(bs.me.points) + '</b> Send Power' +
        (inside ? ' — inside the prize places: <b>#' + bs.me.rank + ' pays ' + ladder[bs.me.rank - 1] + '×</b>. Hold it. 🏆'
          : edge ? ' — <b>' + nf(Math.max(1, edge.points - bs.me.points)) + '</b> more draws level with #' + edge.rank + ', and a tie shares the rung.' : '.');
    } else if (bs.me) me = rows.length < n ? 'The top ' + n + ' is not full yet — your next post, reaction or Send Call puts you on it.' : 'You have not scored this week — your next post, reaction or Send Call counts.';
    if (bs.myBoost && bs.myBoost.boost > 1) me += ' <span class="cmp-carry">🏆 Carrying <b>' + bs.myBoost.boost + '×</b> from week ' + esc(bs.myBoost.wonIn || '') + ' until ' + esc(dateUTC(bs.myBoost.until)) + '.</span>';
    const last = bs.last && bs.last.winners && bs.last.winners.length
      ? '<p class="cmp-last">Last week (' + esc(bs.last.key) + '): ' + bs.last.winners.slice(0, 3).map(w => (medal[w.rank - 1] || '#' + w.rank) + ' ' + nameLink(w) + ' <span class="cmp-prizechip">' + w.boost + '×</span>').join(' · ') + '</p>' : '';
    return card('bs', {
      emoji: '🏆', title: 'Biggest Sender', live: 'Week ' + bs.week.key,
      clock: { label: 'Resets in', endsAt: bs.week.endsAt, startsAt: bs.week.startsAt },
      prize: 'Top <b>' + n + '</b> win a Send Power boost for the next ' + bs.prize.lastsDays + ' days — <b>#1 gets ' + ladder[0] + '×</b>' + (ladder.length > 1 ? ', down to ' + ladder[ladder.length - 1] + '× for #' + ladder.length : '') + '.',
      body: rows.length ? podium(rows, ctx.prev.bs, u => u.points, pts) + list(rows, ctx.prev.bs, pts) : '<p class="cmp-empty">Nobody has scored this week yet. The first post takes the lead. 🚀</p>',
      me: me + last,
      cta: '<a class="btn btn-sm btn-primary" href="wall.html">Post on the Send Wall</a>',
      how: '<b>A fresh race every week.</b> Every Monday at 00:00 UTC the board resets to zero: only Send Power earned inside the week counts, with any prize you were already carrying taken back out, so last week\'s winners race on the same footing as everyone else. When the week ends the game master pays the top ' + n + ' by finishing place — ' + ladder.map(b => b + '×').join(' · ') + ' — for the whole of the next week; tied places share a rung. Boosts add on top of your other boosts, they don\'t multiply.',
    });
  }
  function sendCallsCard(d, ctx) {
    const sc = d.sendCalls, rows = mark(sc.top, ctx.username);
    const val = u => '<b>' + xf(u.totalX) + '</b> <small>' + u.calls + ' call' + (u.calls === 1 ? '' : 's') + (u.bestGrade ? ' · best ' + esc(u.bestGrade.emoji) : '') + '</small>';
    let me = '';
    if (!ctx.signedIn) me = 'Call a token in public and get paid as it climbs. ' + signInBtn('Sign in to call');
    else if (sc.me && sc.me.rank) me = 'You are <b>#' + sc.me.rank + '</b> on the 7-day board at <b>' + xf(sc.me.totalX) + '</b> across ' + sc.me.calls + ' call' + (sc.me.calls === 1 ? '' : 's') + (sc.me.bestGrade ? ' — best ' + esc(sc.me.bestGrade.emoji) + ' ' + esc(sc.me.bestGrade.label) : '') + '.';
    else if (sc.me) me = 'No call of yours is on the 7-day board. Paste a contract on the Send Wall to make one.';
    return card('calls', {
      emoji: '📣', title: 'Send Calls', live: 'Last 7 days',
      prize: 'Ranked by <b>total peak gain</b> across every call made in the last 7 days (each call counted up to ' + sc.cap + 'x) — a rolling window, so a call drops off the board a week after it was made. A call pays Send Power as it climbs, and most of it for <b>holding in profit</b>.',
      body: rows.length ? podium(rows, ctx.prev.calls, u => Math.max(0, u.totalX), val) + list(rows, ctx.prev.calls, val) : '<p class="cmp-empty">No call on the board in the last 7 days. The first good call leads. 📣</p>',
      me,
      cta: '<a class="btn btn-sm btn-primary" href="wall.html">Make a Send Call</a>',
      how: '<b>A Send Call is a public call on a token.</b> Its gain is tracked from your entry price to its peak, and it is graded: 💪 Solid from +2x, 🔥 Big from +5x, 🚀 Massive from +10x, 🏆 Legendary from +20x. The board adds up every call you made in the last 7 days, each counted up to +' + sc.cap + 'x, so one lucky call cannot carry the week alone. Tokens need at least $' + nf(sc.minLiq) + ' of pooled liquidity to be callable. Calls pay an opening award, a milestone for each whole X, and a hold bonus that grows the longer they stay in profit — bigger still when the people who Sent It on your call are in profit too.',
    });
  }
  function communitiesCard(d, ctx) {
    const cm = d.communities, board = cm.board || [], max = Math.max(1, ...board.map(c => c.xpWeek)), hasDemo = board.some(c => c.demo);
    const body = board.length ? '<ol class="cmp-comms" aria-label="Top communities this week">' + board.map(c =>
      '<li' + (c.joined ? ' class="is-me"' : '') + '><span class="cmp-rank">' + (medal[c.rank - 1] || '#' + c.rank) + '</span>' +
        (c.image ? '<img class="cmp-cava" src="' + esc(c.image) + '" alt="" loading="lazy">' : '<span class="cmp-cava cmp-cava--txt" aria-hidden="true">' + (c.demo ? '📈' : esc(String(c.symbol || '?').slice(0, 3))) + '</span>') +
        '<span class="cmp-comm-main"><a class="cmp-name" href="community.html?id=' + encodeURIComponent(c.id) + '">$' + esc(c.symbol) + '</a>' +
          (c.demo ? '<span class="cmp-sandbox" title="Open to everyone: no token, no wallet, no multiplier">🧪 Sandbox · stock, not a token · no 10×</span>' : '') +
          '<small>' + esc(c.name) + ' · ' + nf(c.memberCount) + ' member' + (c.memberCount === 1 ? '' : 's') + ' · Lv ' + c.level + (c.joined ? ' · <b>joined ✓</b>' : '') + '</small>' +
        '<span class="cmp-xpbar" aria-hidden="true"><span style="width:' + Math.max(4, Math.round(c.xpWeek / max * 100)) + '%"></span></span></span>' +
        '<span class="cmp-val">' + compact(c.xpWeek) + ' XP</span></li>').join('') + '</ol>' +
      (hasDemo ? '<p class="cmp-fine">$HOOD is a listed stock, not a token: the sandbox is open to everyone and grants no boost. This site is not affiliated with, endorsed by or sponsored by Robinhood Markets, Inc.</p>' : '')
      : '<p class="cmp-empty">No community has scored this week yet. The first post on a community wall leads. 🏘️</p>';
    const joinedTok = board.filter(c => c.joined && !c.demo), joinedDemo = board.some(c => c.joined && c.demo);
    return card('comm', {
      emoji: '🏘️', title: 'Community Race', live: 'Week ' + cm.week.key,
      clock: { label: 'Resets in', endsAt: cm.week.endsAt, startsAt: cm.week.startsAt },
      prize: 'Which community earned the most <b>community XP</b> this week. A board, not a payout — the prize is the community\'s level, which is permanent.',
      body,
      me: ctx.signedIn
        ? (joinedTok.length ? 'You are in <b>' + joinedTok.map(c => '$' + esc(c.symbol)).join(', ') + '</b> — every post and reaction there counts for the race.' + (joinedDemo ? ' The sandbox races on its own row but pays no boost.' : '')
          : joinedDemo ? 'You are in the sandbox — it races here but grants no boost. A live <b>token</b> community is what pays the 10×.'
          : 'Join a live token community and post there — every member action adds to its week.')
        : 'Rally around a token: join its community and post there. ' + signInBtn('Sign in to join'),
      cta: '<a class="btn btn-sm btn-primary" href="communities.html">Browse communities</a>',
      how: '<b>Communities level up as their members show up.</b> Posting, reacting and commenting on a community wall earns it community XP, capped per member per day so one person cannot carry it. The weekly bucket resets on its own every Monday at 00:00 UTC; the all-time XP — and the level it buys — stays. Being in at least one live <i>token</i> community adds a 10× community boost to your own Send Power stack; the sandbox grants none.',
    });
  }
  function ogCard(d, ctx) {
    const o = d.og, now = serverNow(), tiers = [['gold', 3], ['silver', 2], ['bronze', 1]];
    const rowsHtml = '<ol class="cmp-og" aria-label="OG windows">' + tiers.map(([k, t], i) => {
      const closes = o.closes[k], state = closes <= now ? 'closed' : o.tierNow === t ? 'open' : 'later', opensAt = i > 0 ? o.closes[tiers[i - 1][0]] : null;
      return '<li class="cmp-og-row is-' + state + '"><span class="cmp-og-medal" aria-hidden="true">' + medal[3 - t] + '</span><b>OG ' + esc(o.name[t]) + '</b><span class="cmp-og-mult">' + o.mult[t] + '×</span>' +
        '<span class="cmp-og-state">' + (state === 'closed' ? 'closed ' + esc(dateShort(closes)) : state === 'open' ? '<b>open now</b> · closes ' + esc(dateShort(closes)) : (t === o.tierNow - 1 ? 'opens next, ' : 'opens ') + esc(dateShort(opensAt)) + ' · until ' + esc(dateShort(closes))) + '</span></li>';
    }).join('') + '</ol>';
    const cur = tiers.find(([k, t]) => o.tierNow === t);
    let me = '';
    if (!ctx.signedIn) me = 'The badge follows a wallet that got in early and still holds. ' + signInBtn('Sign in to link a wallet');
    else if (o.mine && o.mine.og && o.mine.tier) me = 'You hold <b>OG ' + esc(o.mine.name) + ' — ' + o.mult[o.mine.tier] + '×</b> on everything you earn. It stays for as long as both coins stay in your wallet.';
    else me = o.open ? 'No badge on this account. It goes to wallets that got into <b>both $SEND and $GWC</b> inside a window and still hold both — link a wallet on your profile to be checked.' : 'No badge on this account, and every window has closed.';
    return card('og', {
      emoji: '🏅', title: 'OG Campaign', live: o.open ? (cur ? o.name[cur[1]] + ' window' : 'Open') : '',
      clock: o.open && cur ? { label: 'The ' + o.name[cur[1]].toLowerCase() + ' window closes in', endsAt: o.closes[cur[0]] } : null,
      prize: 'A permanent badge and a Send Power multiplier for being early in <b>both $SEND and $GWC</b> — <b>10×</b> Gold, 5× Silver, 3× Bronze. One standard; only <i>when</i> you got in changes the size.',
      body: rowsHtml,
      me,
      cta: '<a class="btn btn-sm btn-primary" href="about.html#og-rules">The OG rules</a>' + (ctx.signedIn ? '<a class="btn btn-sm btn-ghost" href="profile.html">Link a wallet</a>' : ''),
      how: '<b>Three windows, one rule.</b> Windows count from each coin\'s own launch and your tier is the <b>lower</b> of your two coins, because the rule is that you held both. ' + (o.closes ? 'Gold closes ' + esc(dateShort(o.closes.gold)) + ', Silver ' + esc(dateShort(o.closes.silver)) + ', Bronze ' + esc(dateShort(o.closes.bronze)) + '; after that no badge is granted. ' : '') + 'A wallet that dumped its whole holding inside its first month <i>and</i> holds less today than it did then earns nothing. Sell out of either coin entirely, ever, and the badge is revoked. Everything is read from the chain and re-checked; a read that cannot complete is retried, never guessed.',
    });
  }
  function rocketCard(d, ctx) {
    const rr = d.rocketRun, m = rr.me;
    const tile = (v, l) => '<div class="cmp-tile"><b>' + v + '</b><span>' + l + '</span></div>';
    const body = '<div class="cmp-tiles">' +
      tile(nf(rr.flightsToday), 'flight' + (rr.flightsToday === 1 ? '' : 's') + ' today') +
      tile(nf(rr.cashedToday), 'cashed out') +
      tile(rr.bestXToday != null ? rr.bestXToday.toFixed(2) + '×' : '—', 'best cash-out today' + (rr.bestBoostToday != null ? ' → ' + rr.bestBoostToday.toFixed(2) + '× boost' : '')) +
      tile(nf(rr.boostedNow), 'pilot' + (rr.boostedNow === 1 ? '' : 's') + ' boosted right now') +
    '</div>';
    let me = '';
    if (!ctx.signedIn) me = 'One free flight a day, nothing at stake. ' + signInBtn('Sign in to fly');
    else if (m && m.boost > 1) me = 'Your boost: <b>' + m.boost.toFixed(2) + '×</b> until ' + esc(new Date(m.until).toUTCString().slice(0, 22)) + ' UTC.' + (m.playedToday ? '' : ' Your flight for today is still waiting. 🚀');
    else if (m && m.playedToday) me = 'You have flown today — the next flight unlocks at 00:00 UTC.';
    else me = 'Your free flight is waiting. 🚀';
    return card('rocket', {
      emoji: '🚀', title: 'Rocket Run', live: 'Today',
      clock: { label: 'Flights reset in', endsAt: rr.resetsAt },
      prize: 'Cash out for a Send Power boost of up to <b>' + rr.maxBoost + '×</b> for 24 hours. Free, one flight a day, nothing at stake.',
      body,
      me,
      cta: '<button class="btn btn-sm btn-primary" type="button" data-cmp-launch>Go to the rocket</button>',
      how: '<b>Ride the multiplier, tap before it blows.</b> The multiplier is e<sup>' + rr.growth + ' × seconds</sup>, capped at ' + rr.maxX + '×; your boost is 1 + (multiplier − 1) ÷ 4, capped at ' + rr.maxBoost + '×, for 24 hours. The crash point is rolled on the server the moment you launch and revealed only when your flight ends. The numbers on this card are today\'s totals across every pilot — never who flew.',
    });
  }
  function hallCard(d, ctx) {
    const al = d.allTime, rows = mark(al.top, ctx.username);
    const val = u => '<b>' + compact(u.points) + ' SP</b> <small>Lv ' + u.level + (u.title ? ' · ' + esc(u.title) : '') + '</small>';
    let me = '';
    if (!ctx.signedIn) me = 'Every point ever earned, every boost applied. ' + signInBtn();
    else if (al.me) me = al.me.rank ? 'You are <b>#' + nf(al.me.rank) + '</b> all-time with <b>' + nf(al.me.points) + '</b> Send Power · Level ' + al.me.level + '.' : 'You have not earned Send Power yet — your first post starts the count.';
    return card('all', {
      emoji: '👑', title: 'Hall of Fame', live: 'All time',
      prize: 'Every Send Power point ever earned, with every boost applied. <b>Level 100</b> is the Biggest Sender crown 👑.',
      body: rows.length ? podium(rows, ctx.prev.all, u => u.points, val) + list(rows, ctx.prev.all, val) : '<p class="cmp-empty">Nobody has scored yet.</p>',
      me,
      cta: ctx.signedIn ? '<a class="btn btn-sm btn-ghost" href="profile.html">My Send Power</a>' : '',
      how: '<b>The long game.</b> Levels climb an exponential curve with no cap — each level costs about 10% more than the last. Your Holder, OG, community, Rocket Run and Biggest Sender boosts all add together and every point you earn is paid at that total.',
    });
  }

  /* ---------- the whole hub, as one string ---------- */
  function buildHTML(d, ctx) {
    const cards = [biggestSenderCard, sendCallsCard, communitiesCard, ogCard, rocketCard, hallCard].map(f => f(d, ctx)).join('');
    const chips = [['bs', '🏆', 'Biggest Sender'], ['calls', '📣', 'Send Calls'], ['comm', '🏘️', 'Community Race'], ['og', '🏅', 'OG Campaign'], ['rocket', '🚀', 'Rocket Run'], ['all', '👑', 'Hall of Fame']]
      .map(([id, e, l]) => '<a class="cmp-chip" id="cmp-chip-' + id + '" href="#cmp-' + id + '"><span aria-hidden="true">' + e + '</span>' + l + '</a>').join('');
    return { cards, chips };
  }
  window.cmpBuildHTML = buildHTML; // exposed for the headless render probe

  /* ---------- snapshot of the last visit (movement chips) ---------- */
  const SNAP = 'sendit_cmp_ranks';
  function readSnap() { try { const j = JSON.parse(localStorage.getItem(SNAP) || 'null'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
  function writeSnap(d) {
    const m = rows => { const o = {}; (rows || []).forEach(u => { if (u && u.username) o[u.username] = u.rank; }); return o; };
    try { localStorage.setItem(SNAP, JSON.stringify({ at: Date.now(), bs: m(d.biggestSender.top), calls: m(d.sendCalls.top), all: m(d.allTime.top) })); } catch {}
  }
  const prev = (function () { const s = readSnap(); return { bs: s.bs || null, calls: s.calls || null, all: s.all || null }; })();

  /* ---------- state ---------- */
  let data = null, painted = null, pending = false, lastJSON = '', pollTimer = null, tickTimer = null, refetchAt = 0, cheered = null;

  function ctxNow() {
    const u = (window.AUTH && AUTH.user) ? AUTH.user : null;
    return { signedIn: !!u, username: u ? u.username : null, prev };
  }
  // A repaint replaces the boards wholesale, so it never happens under someone's hands: not while an ⓘ tip is open and
  // not while keyboard focus is inside the hub. The update waits (pending) and lands the moment they leave, and the
  // live region speaks only about a board that was actually painted.
  // focus on a control with a stable id (an ⓘ button, a jump chip) survives a repaint — it is handed straight back
  function focusInside() { const a = document.activeElement; return a && a !== root && root.contains(a) ? a : null; }
  function busy() { const a = focusInside(); return !!root.querySelector('.cmp-card-head.is-open') || !!(a && !a.id); }
  function render() {
    if (!data) return false;
    if (painted && busy()) { pending = true; return false; }
    const keep = focusInside(); const keepId = keep ? keep.id : null;
    const dismissed = [...root.querySelectorAll('.cmp-card-head.is-dismissed')].map(h => h.closest('.cmp-card').id); // an Esc'd tip stays parked across the repaint
    const { cards, chips } = buildHTML(data, ctxNow());
    grid.innerHTML = cards; jump.innerHTML = chips;
    root.setAttribute('aria-busy', 'false');
    dismissed.forEach(id => { const h = document.querySelector('#' + id + ' .cmp-card-head'); if (h) h.classList.add('is-dismissed'); });
    if (keepId) { const el = document.getElementById(keepId); if (el) el.focus({ preventScroll: true }); }
    pending = false;
    announceDiff(painted, data); painted = data;
    writeSnap(data);
    cheer();
    return true;
  }
  function flush() { if (pending && !busy()) render(); }
  // once per week: confetti if you are sitting inside the prize places when you open the page
  function cheer() {
    const bs = data.biggestSender; if (!bs.me || !bs.me.rank || bs.me.rank > bs.prize.winners) return;
    const key = 'sendit_cmp_cheer';
    try { if (localStorage.getItem(key) === bs.week.key) return; localStorage.setItem(key, bs.week.key); } catch {}
    if (cheered === bs.week.key) return; cheered = bs.week.key;
    if (window.sendConfetti && !reduced()) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 60, emojiRatio: 0.5 });
    if (window.sendToast) sendToast('🏆 You are #' + bs.me.rank + ' this week — inside the prize places!');
  }
  function announceDiff(old, cur) {
    if (!old) return;
    const top = b => (b.biggestSender.top || []).slice(0, 3).map(u => u.username).join(',');
    const myRank = b => b.biggestSender.me ? b.biggestSender.me.rank : null;
    const msgs = [];
    if (top(old) !== top(cur)) msgs.push('Biggest Sender top three changed' + (cur.biggestSender.top[0] ? ': ' + cur.biggestSender.top[0].username + ' leads' : ''));
    if (myRank(old) !== myRank(cur) && myRank(cur)) msgs.push('you are now #' + myRank(cur) + ' this week');
    if (msgs.length) live.textContent = msgs.join('; ') + '.';
  }
  async function load() {
    try {
      const r = await fetch('/api/competitions', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      offset = (Number(j.serverNow) || Date.now()) - Date.now();
      const txt = JSON.stringify(j, (k, v) => (k === 'serverNow' || k === 'msLeft' ? undefined : v));
      if (txt === lastJSON) return;                    // nothing moved — leave the DOM (and focus) alone
      lastJSON = txt; data = j;
      render();
    } catch (e) {
      if (!data) { grid.innerHTML = '<p class="cmp-empty cmp-err" role="alert">The boards could not be reached — <button class="btn btn-sm btn-ghost" type="button" data-cmp-retry>try again</button></p>'; root.setAttribute('aria-busy', 'false'); }
    }
  }
  function tick() {
    const now = serverNow(); let due = false;
    root.querySelectorAll('.cmp-count[data-ends]').forEach(el => {
      const ends = Number(el.dataset.ends); if (!ends) return;
      const t = fmtLeft(ends - now); if (el.textContent !== t) el.textContent = t;
      if (ends <= now) due = true;
    });
    if (due && !document.hidden && now > refetchAt) { refetchAt = now + 15000; load(); }   // a clock hit zero → the board has rolled over (a hidden tab waits for its visible turn)
  }

  /* ---------- interaction ---------- */
  function closeTips() {
    root.querySelectorAll('.cmp-card-head.is-open').forEach(h => { h.classList.remove('is-open'); const b = h.querySelector('.cmp-info'); if (b) b.setAttribute('aria-expanded', 'false'); });
    setTimeout(flush, 0);
  }
  // Esc must dismiss a tip however it was shown (WCAG 1.4.13): a hover/focus-shown one is CSS-driven, so it is parked
  // behind .is-dismissed until the pointer or focus leaves the header
  function dismissTips() { closeTips(); root.querySelectorAll('.cmp-card-head').forEach(h => h.classList.add('is-dismissed')); }
  root.addEventListener('mouseout', e => { const h = e.target.closest('.cmp-card-head'); if (h && !h.contains(e.relatedTarget)) h.classList.remove('is-dismissed'); });
  root.addEventListener('focusout', e => { const h = e.target.closest('.cmp-card-head'); if (h && !h.contains(e.relatedTarget)) h.classList.remove('is-dismissed'); setTimeout(flush, 0); });
  root.addEventListener('click', e => {
    const info = e.target.closest('.cmp-info');
    if (info) {
      const h = info.closest('.cmp-card-head'), open = !h.classList.contains('is-open');
      closeTips(); h.classList.remove('is-dismissed');
      if (open) { h.classList.add('is-open'); info.setAttribute('aria-expanded', 'true'); } else info.blur();
      return;
    }
    if (!e.target.closest('.cmp-tip')) closeTips();
    if (e.target.closest('[data-cmp-signin]')) { if (window.AUTH && AUTH.open) AUTH.open(); return; }
    if (e.target.closest('[data-cmp-retry]')) { grid.innerHTML = '<p class="cmp-loading">Loading the boards…</p>'; load(); return; }
    if (e.target.closest('[data-cmp-launch]')) {
      const game = document.getElementById('arc-game'), btn = document.getElementById('arc-btn');
      if (game) scrollTo({ top: game.getBoundingClientRect().top + scrollY - 84, behavior: reduced() ? 'auto' : 'smooth' }); // 84px: the sticky nav
      const target = btn && !btn.hidden && !btn.disabled ? btn : document.getElementById('arc-game-h');
      if (target) { if (!target.hasAttribute('tabindex') && target.tagName !== 'BUTTON') target.setAttribute('tabindex', '-1'); setTimeout(() => target.focus({ preventScroll: true }), reduced() ? 0 : 450); }
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') dismissTips(); });

  /* ---------- lifecycle ---------- */
  function startTimers() {
    if (!tickTimer) tickTimer = setInterval(tick, 1000);
    if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden) load(); }, 45000);
  }
  // re-read when the tab comes BACK — the visible event some browsers fire at load must not double the first read
  let wasHidden = false;
  document.addEventListener('visibilitychange', () => { if (document.hidden) wasHidden = true; else if (wasHidden) { wasHidden = false; load(); } });
  // auth:change also fires once at init — only a real sign-in / sign-out re-reads the boards
  let bootedFor;
  function boot() {
    const u = (window.AUTH && AUTH.user) ? String(AUTH.user.username || '1') : null;
    if (bootedFor !== undefined && u === bootedFor) return;
    bootedFor = u; lastJSON = ''; load();
  }
  document.addEventListener('auth:change', boot);
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  startTimers();
})();
