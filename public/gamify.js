/* ===== $Send gamification dashboard (profile page) — "Send Power" command center =====
   One connected machine: GREEN = your Sender level (participation), CYAN = your Diamond
   conviction, multiplying into your GOLD Send Power. Everything below is rendered from the
   on-chain-verified /api/gamify payload — holdings, hold-time and diamond tier are read from
   the blockchain server-side, so nothing here can be faked by the client. */
(function () {
  const dash = document.getElementById('gamify-dash');
  if (!dash) return;

  /* ---------- formatting helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const nf = n => Number(n || 0).toLocaleString('en-US');
  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  // honest % formatter — keeps small holdings legible without ever rounding to a fake 0
  function pctFmt(p) {
    p = Number(p) || 0;
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(3);
    if (p > 0) return p.toPrecision(2);
    return '0';
  }
  const reducedMotion = () => window.prefersReduced && window.prefersReduced();
  /* todayPoints sums the last 24 hours of the ledger, and the ledger contains DECAY — a negative row. It
     was printed as '+' + nf(v), so an account whose only event that day was a drain read "+-1,234" in the
     colour the site uses for gains. A day can genuinely be negative; the number has to be able to say so. */
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v));

  /* ---------- action metadata ---------- */
  const ACTION_LABEL = {
    swap: ['🚀', 'Swap for $Send / $GWC'],
    connect_wallet: ['🔗', 'Connect your wallet'],
    first_post: ['✨', 'Your first post'],
    post: ['🧱', 'Post on the Send Wall'],
    track_wallet: ['🕵️', 'Track a new wallet'],
    watch_token: ['⭐', 'Add a token to your watchlist'],
    send_call: ['📣', 'Make a Send Call'],
    call_x: ['🚀', 'Your Send Calls run (per X)'],
    call_hold: ['💎', 'Diamond-hand a winning call'],
    hop_on: ['🚀', 'Send It! on a call'],
    hop_hold: ['💎', 'Diamond-hand a Send in profit'],
    daily: ['📅', 'Check in daily'],
    // the only entry that takes rather than gives — it must be named, or a shrinking balance is a mystery
    decay: ['📉', 'Send Power decayed (away, read-only, or calls underwater)'],
    customize: ['🎨', 'Customize your wall'],
    comment: ['💬', 'Comment on a post'],
    react_give: ['🔥', 'React to a post'],
    vote_give: ['⬆️', 'Vote on the Send Wall'],
    be_followed: ['⭐', 'Gain a follower'],
    react_get: ['💚', 'Get a reaction'],
    vote_get: ['🔺', 'Get upvoted'],
    follow: ['👀', 'Follow a sender'],
    community_founder: ['👑', 'Founded a community'],
  };
  const ORDER = ['swap', 'send_call', 'call_x', 'call_hold', 'hop_on', 'hop_hold', 'connect_wallet', 'first_post', 'post', 'track_wallet', 'watch_token', 'daily', 'customize', 'comment', 'react_give', 'vote_give', 'follow', 'be_followed'];
  const VARIABLE = new Set(['call_x', 'call_hold', 'hop_hold']); // points scale with real performance — shown as "⚡ scales", not a fixed number
  // where clicking a "how to earn" row takes you to actually do it
  const EARN_ACTION = {
    swap: { href: '/index.html#swap' },
    connect_wallet: { open: 'sec-security' },
    first_post: { href: '/wall.html' },
    post: { href: '/wall.html' },
    track_wallet: { scroll: 'add-wallet-form', focus: 'tw-addr' },
    watch_token: { href: '/newpairs.html' },
    send_call: { href: '/newpairs.html' },
    call_x: { href: '/wall.html' },
    call_hold: { href: '/wall.html' },
    hop_on: { href: '/wall.html' },
    hop_hold: { href: '/wall.html' },
    daily: { wall: true },   // resolved per-render: "✓ today" only once you've ACTUALLY checked in
    customize: { open: 'sec-wall' },
    comment: { href: '/wall.html' },
    react_give: { href: '/wall.html' },
    vote_give: { href: '/wall.html' },
    follow: { href: '/wall.html' },
    be_followed: { href: '/wall.html' },
  };
  /* Hover/tap detail for each way to earn.
     THE DAILY CAPS ARE NOT WRITTEN HERE ANY MORE. They used to be, "mirroring server.js DAILY_CAP" — and
     five of them had drifted: track said 10/day where the code allows 3, watch said 30 where it allows 5,
     react_get said 60 where it allows 20, vote_get said 100 where it allows 30, be_followed said 30 where
     it allows 10. A cap is a promise about what the site will pay you; a wrong one is worse than none.
     capLine() below appends the real figure from g.rules.dailyCap at render time, so it cannot drift again. */
  const EARN_DESC = {
    swap: 'Swap ETH for $SEND or $GWC via the in-page swap. Verified on-chain — the biggest fixed award on the board.',
    connect_wallet: 'Link a wallet holding $SEND/$GWC (read-only signature). Once per wallet.',
    first_post: 'A one-time bonus for your very first post on the Send Wall.',
    post: 'Post on the Send Wall — memes, gains, pain.',
    track_wallet: 'Save a new wallet to your private tracker.',
    watch_token: 'Save a token to your watchlist from New Pairs (☆). Once per token.',
    send_call: 'Call any token (📣) from New Pairs — it needs ≥$500 liquidity so nobody can farm a dust pool. It posts a permanent, live widget to your wall that tracks its Xs forever. +120 Send Power (📥 boosted by the value of the tokens you bought & still hold — every $100 held = ×1, so $1,000 = ×10; best-effort, on-chain), 5 calls/day to start (rolling 24h — it floats with your call quality, and Diamond holders get more). Calls are FINAL — they can never be deleted.',
    /* The ladder used to be described here as 170 × the X — "2x → +340 … 50x → +8,500". It has not paid
       that since it was changed to a STRAIGHT LINE: rung m pays the first rung plus a fixed step each
       time, so a 50× rung is worth about 5.9 rungs, not 50. The promise on this card was eight and a half
       times what the code pays at the top of the ladder. ladderCopy() below writes this sentence from
       g.rules, so the numbers come from the same constants awardPoints uses. */
    call_x: '',
    call_hold: '💎 Diamond hands: a call that STAYS in profit earns more the longer AND higher it holds — the bonus compounds (grows faster than the Xs alone), accruing automatically every few minutes while it’s above your entry price. This is where most of a call’s Send Power lives: at least 60% of everything a call can ever pay is reserved for holding in profit. And it accrues faster when the people who Sent It on your call are in profit too — +10% per Sender in the green with at least $20 of their own in the token, up to 3×.',
    hop_on: 'Send It! (🚀) on someone else’s Send Call from the Send Wall to ride it with them. +30 Send Power, up to 30/day.',
    hop_hold: '💎 If you Send It on someone’s call and stay in profit from your entry price, you earn a compounding diamond-hands bonus on the same curve the caller does — the longer you hold in the green and the higher it runs, the more. One difference: the crew multiplier is the caller’s alone. A Sender’s hold bonus is never boosted by how many other Senders are in profit, and a Sender’s lifetime budget for one call is a quarter of the caller’s.',
    daily: 'Tap ✅ Check in for today on your own wall. Once per UTC day, multiplied by your boosts.',
    customize: 'Style your wall (accent, avatar, banner). Once a day.',
    comment: 'Reply on any post.',
    react_give: 'React 🔥/🚀 to a post.',
    vote_give: 'Upvote or downvote posts on the Send Wall.',
    follow: 'Follow another sender.',
    be_followed: 'Earned automatically when someone follows you.',
    react_get: 'Earned when your post gets a reaction.',
    vote_get: 'Earned when your post gets upvoted.',
    community_founder: 'A one-time bonus for starting a community and growing it to the 10 verified holders that take it live. Paid once, when it flips live.',
  };
  // Diamond tiers — MUST mirror server.js DIAMOND_TIERS exactly (used only for "next tier" labels)
  const DIA_TIERS = [
    ['📄', 'Paper Grip', 0], ['✊', 'Getting a Grip', 3], ['🤝', 'Firm Hands', 7],
    ['🔩', 'Steel Hands', 14], ['💠', 'Diamond Forming', 30], ['💎', 'Diamond Hands', 60],
    ['💎', 'Flawless Diamond', 120], ['🛡️', 'Titanium Grip', 240], ['🏆', 'Diamond Legend', 365],
    ['👑', 'Unbreakable', 550], ['🔥', 'Immortal Diamond', 730],
  ];
  const diaNext = lvl => DIA_TIERS[lvl + 1] || null;
  const diaNextLabel = lvl => { const n = diaNext(lvl); return n ? n[0] + ' ' + n[1] : ''; };

  // whale tiers by % of a token's supply
  const WHALE = [
    { t: 0, e: '🦐', n: 'Shrimp' }, { t: 0.001, e: '🐟', n: 'Fish' }, { t: 0.01, e: '🐬', n: 'Dolphin' },
    { t: 0.1, e: '🦈', n: 'Shark' }, { t: 1, e: '🐋', n: 'Whale' },
  ];
  function whale(p) { let i = 0; for (let j = 0; j < WHALE.length; j++) if (p >= WHALE[j].t) i = j; return { cur: WHALE[i], next: WHALE[i + 1] || null }; }
  // log-scaled meter fill so tiny (but real) holdings still show meaningful bar (0.0001%→0, 10%→100)
  function fillLog(p) { p = Number(p) || 0; if (p <= 0) return 0; return Math.max(0, Math.min(100, (Math.log10(p) + 4) / 5 * 100)); }
  const GWC_W = 3; // $GWC weighted heavier than $SEND (mirror server GWC_SUPPLY_WEIGHT)
  // supply-boost term exactly as the server computes it: +10× per weighted 1% of supply ($GWC counts ×3)
  /* ONLY COINS THAT CLEAR THE $100 FLOOR COUNT. The server's holderMultiplier runs on qualSendBp/qualGwcBp
     — a coin under the floor contributes zero — while this used the raw percentages. The equation strip
     therefore printed its own terms and its own total from two different rules: an account holding $45 of
     $SEND and $130 of $GWC was shown "1 + 3.9 × 10 = 28.00×", which is not an equation, it is two numbers
     next to each other. Anyone who did the arithmetic got 40 and was wrong, and had no way to find out why.
     A coin the server has not priced yet (`null`, not `false`) is left counting, because nothing has been
     decided about it — that is the same rule refreshHolder uses. */
  function qualPct(pct, qualifies) { return qualifies === false ? 0 : (pct || 0); }
  function supplyTermOf(h) { return 10 * (qualPct(h.pctSend, h.sendQualifies) + GWC_W * qualPct(h.pctGwc, h.gwcQualifies)); }
  // does this account hold anything the floor is currently excluding? the strip says so rather than just shrinking
  function dustedCoins(h) {
    const out = [];
    if (h && h.sendQualifies === false && (h.pctSend || 0) > 0) out.push('$SEND');
    if (h && h.gwcQualifies === false && (h.pctGwc || 0) > 0) out.push('$GWC');
    return out;
  }
  // the boost the server actually pays every point at: 1 + (Holder−1) + (OG−1) + (Community−1) + (Arcade−1) + (Prize−1) — boosts add (mirror effectiveMult)
  function effMult(g) {
    const holder = g.multiplier || 1;
    const h = g.holder;
    const ogOn = !!(g.og && h && h.fresh !== false && (h.sendTok || 0) > 0 && (h.gwcTok || 0) > 0); // OG pays only while freshly verified & still holding both
    // No `|| 10` fallback: ogBonus is the USER'S tier multiplier (10/5/3), so falling back to 10 would
    // show a bronze holder four times the bonus they are actually paid.
    const og = ogOn ? (Number(g.ogBonus) || 1) : 1;
    const comm = g.communityMult || 1;
    const arcade = (g.arcade && g.arcade.boost > 1) ? g.arcade.boost : 1;
    const weekly = (g.weekBoost && g.weekBoost.boost > 1) ? g.weekBoost.boost : 1;
    /* The BETA BADGE was missing from this stack entirely. A top-ten beta finisher is paid
       BETA_BADGE_MULT forever by effectiveMult() on the server, and this file added five terms and not
       that one — so the ten accounts with the rarest thing on the site were shown a smaller multiplier
       than they were being paid, on every screen that reads this. */
    const beta = (g.boost && g.boost.beta > 1) ? g.boost.beta : 1;
    // Boosts ADD, they do not multiply — mirror of effectiveMult() on the server: 1 + Σ(each boost − 1).
    const plus = x => (Math.round((x - 1) * 100) / 100) + '×';
    const parts = [];
    if (holder > 1) parts.push('Holder ' + plus(holder));
    if (og > 1) parts.push('OG ' + plus(og));
    if (comm > 1) parts.push('Community ' + plus(comm));
    if (arcade > 1) parts.push('Arcade ' + plus(arcade));
    if (weekly > 1) parts.push('Prize ' + plus(weekly));
    if (beta > 1) parts.push('Beta badge ' + plus(beta));
    const local = Math.round((1 + (holder - 1) + (og - 1) + (comm - 1) + (arcade - 1) + (weekly - 1) + (beta - 1)) * 100) / 100;
    /* THE SERVER'S NUMBER WINS. This function exists to name the parts; the total a person is paid is
       decided by effectiveMult() and now travels with the payload, so what the dashboard prints is the
       figure itself rather than a re-derivation of it that has already drifted once. The locally
       computed value is kept only as the fallback for a payload that predates the field. */
    const eff = (g.boost && g.boost.total > 0) ? g.boost.total : local;
    return { holder, og, comm, arcade, weekly, beta, eff, parts };
  }


  /* ---------- animation plumbing ---------- */
  const rafs = new Set();
  function stopRafs() { rafs.forEach(id => cancelAnimationFrame(id)); rafs.clear(); }
  function fmtVal(v, kind) { v = Number(v) || 0; if (kind === 'nf') return nf(Math.round(v)); if (kind === 'compact') return compact(v); return String(Math.round(v)); }
  function countUp(el, to, kind) {
    if (reducedMotion()) { el.textContent = fmtVal(to, kind); return; }
    const dur = 900; let t0 = null;
    const step = t => {
      if (t0 == null) t0 = t;
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtVal(to * e, kind);
      if (p < 1) { const id = requestAnimationFrame(step); rafs.add(id); } else el.textContent = fmtVal(to, kind);
    };
    const id = requestAnimationFrame(step); rafs.add(id);
  }
  // fill every [data-fill] meter/arc from its 0 baseline after a reflow so the transition runs
  function animate(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('[data-fill]').forEach(el => {
        const v = el.getAttribute('data-fill');
        if (el.getAttribute('data-fillkind') === 'dash') el.style.strokeDashoffset = v;
        else el.style.width = v + '%';
      });
    }));
    root.querySelectorAll('[data-cu]').forEach(el => countUp(el, Number(el.getAttribute('data-cu')) || 0, el.getAttribute('data-cufmt') || 'int'));
  }

  let leaderboard = null;
  let competition = null;   // this week's Biggest Sender board, from /api/competition
  let _lg = null;             // last gamify summary (for re-rendering the loot log on toggle)
  let _lootMode = 'today';    // achievement log resets every 24h by default; toggle to 'all' for all-time

  async function load() {
    dash.innerHTML = '<p class="modal-note" style="text-align:center; padding:1.5rem;">Loading your Send Power… 🎮</p>';
    let g, lb;
    try { g = await api('/api/gamify/me'); } catch (e) { dash.innerHTML = '<p class="modal-note">Could not load your dashboard.</p>'; return; }
    // re-verify holdings on-chain each visit so an honest holder's boost stays fresh (server gates a stale boost to 1×)
    if (AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length) {
      try { g = await api('/api/gamify/refresh', { method: 'POST' }); } catch {}
    }
    try { lb = await (await fetch('/api/leaderboard', { credentials: 'same-origin' })).json(); } catch { lb = { top: [], me: null }; }
    leaderboard = lb;
    try { competition = await (await fetch('/api/competition', { credentials: 'same-origin' })).json(); } catch { competition = null; }
    render(g, lb);
  }

  /* ---------- per-token holdings %: prefer the live refresh split, else the stored server split ---------- */
  function tokenPcts(g) {
    const h = g.holder || {};
    const live = g.holderLive || {};
    return {
      send: Number(live.pctSend != null ? live.pctSend : h.pctSend) || 0,
      gwc: Number(live.pctGwc != null ? live.pctGwc : h.pctGwc) || 0,
    };
  }

  /* =========================================================================
     SECTION 1 — HERO POWER CORE (concentric rings) + nameplate
     ========================================================================= */
  function heroBlock(g) {
    const maxed = g.nextLevelXp == null;
    const xpPct = maxed ? 100 : (g.spanLevel ? Math.max(0, Math.min(100, g.intoLevel / g.spanLevel * 100)) : 0);
    const h = g.holder;
    const diaPct = (h && h.diamond) ? Math.round((h.diamond.progress || 0) * 100) : 0;
    const em = effMult(g);
    const mult = em.eff; // what every point is really multiplied by (Holder × OG × Community), not the holder term alone
    const rankTxt = g.rank === 1 ? '👑 #1 all time' : '#' + g.rank + ' all time';
    const boosted = mult > 1;
    const multParts = em.parts.length > 1 ? '1× + ' + em.parts.join(' + ') + ' = ' + mult.toFixed(2) + '×' : '';
    return '<div class="pc-hero">' +
      '<div class="pc-core" aria-hidden="true">' +
        '<svg viewBox="0 0 120 120" class="pc-svg">' +
          '<defs>' +
            '<linearGradient id="gXp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a9e00"/><stop offset="1" stop-color="#b4ff2b"/></linearGradient>' +
            '<linearGradient id="gDia" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a7fb0"/><stop offset="1" stop-color="#9fe0ff"/></linearGradient>' +
          '</defs>' +
          '<circle cx="60" cy="60" r="54" class="pc-track"/>' +
          '<circle cx="60" cy="60" r="54" class="pc-arc pc-arc-xp" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-fill="' + (100 - xpPct) + '" data-fillkind="dash" transform="rotate(-90 60 60)"/>' +
          '<circle cx="60" cy="60" r="41" class="pc-track"/>' +
          '<circle cx="60" cy="60" r="41" class="pc-arc pc-arc-dia" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-fill="' + (100 - diaPct) + '" data-fillkind="dash" transform="rotate(-90 60 60)"/>' +
          '<text x="60" y="60" text-anchor="middle" class="pc-num">' + g.level + '</text>' +
          '<text x="60" y="77" text-anchor="middle" class="pc-lbl">LEVEL</text>' +
        '</svg>' +
      '</div>' +
      '<div class="pc-name">' +
        '<div class="pc-title">' + esc(g.title) + '</div>' +
        '<div class="pc-rank">' + rankTxt + '</div>' +
        '<div class="pc-power"><span class="cu" data-cu="' + (g.points || 0) + '" data-cufmt="nf" aria-hidden="true">0</span><span class="sr-only">' + nf(g.points) + ' Send Power</span></div>' +
        '<div class="pc-power-lbl">⚡ SEND POWER</div>' +
        '<div class="pc-chips">' +
          (boosted ? '<span class="pc-mult">⚡ ' + mult.toFixed(2) + '× boost</span>' : '<span class="pc-mult pc-mult-off">⚡ 1× · unlock boost ↓</span>') +
          (g.todayPoints ? '<span class="pc-today' + (g.todayPoints < 0 ? ' is-down' : '') + '">' + signed(g.todayPoints) + ' today</span>' : '') +
          (g.weekBoost && g.weekBoost.boost > 1 ? '<span class="pc-week" title="Biggest Sender prize — the boost your finishing place won last week, added to everything you earn until ' + esc(new Date(g.weekBoost.until).toUTCString().slice(0, 16)) + ' 00:00 UTC">🏆 ' + g.weekBoost.boost + '× prize</span>' : '') +
        '</div>' +
        (multParts ? '<div class="pc-mult-parts">' + esc(multParts) + ' on every point</div>' : '') +
      '</div>' +
    '</div>';
  }

  /* =========================================================================
     SECTION 2 — OBJECTIVE BAR (what to do next + what not to lose)
     ========================================================================= */
  function objectiveBar(g) {
    const h = g.holder;
    const hasWallet = AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length;
    const stale = h && h.streakStart && h.fresh === false;
    if (stale) {
      return '<div class="gobj gobj-alert" role="status">' +
        '<div class="gobj-primary">⏸ Your <b>⚡' + (Math.round((1 + supplyTermOf(h) * (h.diamond ? h.diamond.factor : 1)) * 100) / 100).toFixed(2) + '×</b> boost is paused (paying 1× right now) — <button class="gobj-link js-refresh" type="button">Refresh to re-verify your bags →</button></div>' +
      '</div>';
    }
    const maxed = g.nextLevelXp == null;
    const xpPct = maxed ? 100 : (g.spanLevel ? g.intoLevel / g.spanLevel * 100 : 0);
    const xpGap = maxed ? 0 : Math.max(0, (g.spanLevel || 0) - (g.intoLevel || 0));
    const d = h && h.diamond;
    const diaProg = (d && d.nextDays != null) ? d.progress * 100 : (d ? 100 : 0);
    const diaLeft = (d && d.nextDays != null) ? Math.max(0, d.nextDays - d.days) : 0;
    const nextLbl = d ? diaNextLabel(d.level) : '';

    let primary;
    if (maxed && (!d || d.nextDays == null)) primary = '👑 You\'ve maxed everything — you are the <b>Biggest Sender</b>. Flex it. 🚀';
    else if (d && d.nextDays != null && diaProg >= xpPct) primary = '💎 <b>' + diaLeft + '</b> day' + (diaLeft === 1 ? '' : 's') + ' of holding to <b>' + esc(nextLbl) + '</b> — just don\'t sell →';
    else if (!maxed) primary = '🔥 <b>' + nf(xpGap) + '</b> XP from <b>Level ' + (g.level + 1) + '</b> — <a href="/index.html#swap">one boosted swap can do it →</a>';
    else primary = '🚀 <a href="/wall.html">Keep sending on the Wall to climb →</a>';

    let secondary;
    if (d && h.streakStart) {
      secondary = d.nextDays != null
        ? '💎 Don\'t break your <b>' + Math.floor(h.holdDays) + '-day</b> diamond streak — ' + diaLeft + ' day' + (diaLeft === 1 ? '' : 's') + ' to ' + esc(nextLbl)
        : '👑 <b>' + esc(d.name) + '</b> — the highest Diamond tier there is. Never sell. 💎';
    } else if (hasWallet) {
      secondary = '💰 <button class="gobj-link js-refresh" type="button">Buy &amp; hold $SEND / $GWC, then Refresh</button> to unlock your boost';
    } else {
      secondary = '🔗 <button class="gobj-link js-connect" type="button">Connect a wallet</button> that holds $SEND / $GWC to unlock your Holder Boost';
    }
    return '<div class="gobj" role="status">' +
      '<div class="gobj-primary">' + primary + '</div>' +
      '<div class="gobj-secondary">' + secondary + '</div>' +
    '</div>';
  }

  /* =========================================================================
     SECTION 3 — KPI STRIP (decodes the hero rings into hard numbers)
     ========================================================================= */
  function kpiStrip(g) {
    const h = g.holder;
    const days = h && h.streakStart ? Math.floor(h.holdDays || 0) : 0;
    const dLv = h && h.diamond ? h.diamond.level : 0;
    const dName = h && h.diamond ? h.diamond.name : 'No holdings';
    const tile = (ico, val, sub, cls) => '<div class="kpi ' + (cls || '') + '"><div class="kpi-ico" aria-hidden="true">' + ico + '</div><div class="kpi-val">' + val + '</div><div class="kpi-sub">' + sub + '</div></div>';
    return '<div class="kpi-strip">' +
      tile('🪙', nf(g.points), 'Send Power' + (g.todayPoints ? ' · <span class="' + (g.todayPoints < 0 ? 'kpi-dn' : 'kpi-up') + '">' + signed(g.todayPoints) + '</span>' : ''), 'kpi-gold') +
      tile('👑', '#' + g.rank, 'All-time rank', 'kpi-green') +
      tile('🔥', days, 'Day hold streak', 'kpi-flame') +
      tile('💎', 'Lv ' + dLv, esc(dName), 'kpi-dia') +
    '</div>';
  }

  /* =========================================================================
     SECTION 4 — SENDER XP BAR (the green track, in detail)
     ========================================================================= */
  function xpBar(g) {
    const maxed = g.nextLevelXp == null;
    const pct = maxed ? 100 : (g.spanLevel ? Math.max(0, Math.min(100, g.intoLevel / g.spanLevel * 100)) : 0);
    const near = !maxed && pct >= 85;
    const ariaMax = maxed ? 100 : (g.spanLevel || 0);
    const ariaNow = maxed ? 100 : (g.intoLevel || 0);
    const ariaLabel = maxed ? 'Max level reached' : 'Progress to level ' + (g.level + 1);
    const gap = maxed ? 0 : Math.max(0, (g.spanLevel || 0) - (g.intoLevel || 0));
    const text = maxed ? 'MAX LEVEL 👑' : nf(g.intoLevel) + ' / ' + nf(g.spanLevel) + ' XP → Lvl ' + (g.level + 1);
    return '<div class="xpwrap">' +
      '<div class="xprow"><span class="xp-cap">Lvl ' + g.level + '</span>' +
        '<div class="gxp' + (near ? ' near' : '') + (maxed ? ' maxed' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + ariaMax + '" aria-valuenow="' + ariaNow + '" aria-label="' + ariaLabel + '">' +
          '<div class="gxp-fill" data-fill="' + pct.toFixed(1) + '" style="width:0"></div>' +
          '<i class="gxp-notches" aria-hidden="true"></i>' +
          '<span class="gxp-text">' + text + '</span>' +
        '</div>' +
        '<span class="xp-cap ghost">' + (maxed ? '👑' : 'Lvl ' + (g.level + 1)) + '</span>' +
      '</div>' +
      (near ? '<div class="xp-near">🔥 Only <b>' + nf(gap) + '</b> XP from Level ' + (g.level + 1) + ' — send it!</div>' : '') +
    '</div>';
  }

  /* =========================================================================
     SECTION 5 — EQUATION STRIP (how the two tracks multiply into Power)
     ========================================================================= */
  function equationStrip(g) {
    const h = g.holder;
    if (!h || !h.streakStart || (h.scorePct || 0) <= 0) return '';
    const stale = h.fresh === false;
    const supplyTerm = supplyTermOf(h);
    const factor = h.diamond ? h.diamond.factor : 1;
    const mult = g.multiplier || 1;
    const em = effMult(g);
    const stacked = em.og > 1 || em.comm > 1 || em.arcade > 1 || em.weekly > 1; // other boosts ADD onto the Holder Boost — show the whole sum, not just the holder term
    // while the boost is paused (stale holdings) the server pays 1× — show the value the displayed terms WOULD give, labelled paused,
    // so the strip never reads "1 + 30 × 2 = 1.00×"
    const paused = stale ? Math.round((1 + supplyTerm * factor) * 100) / 100 : null;
    const dust = dustedCoins(h);
    return '<div class="eqstrip' + (stale ? ' eq-stale' : '') + '">' +
      '<div class="eq-row">' +
        '<span class="eq-chip eq-base">⚡ 1</span>' +
        '<span class="eq-op">+</span>' +
        '<span class="eq-chip eq-supply">📊 ×' + supplyTerm.toFixed(1) + '<small>supply that counts · $GWC ×' + GWC_W + '</small></span>' +
        '<span class="eq-op">×</span>' +
        '<span class="eq-chip eq-dia">💎 ×' + factor.toFixed(1) + '<small>Diamond Lv ' + h.diamond.level + (h.gwcDays >= 1 ? ' · $GWC ' + Math.floor(h.gwcDays) + 'd' : '') + '</small></span>' +
        '<span class="eq-op">=</span>' +
        (stale
          ? '<span class="eq-chip eq-out">⏸ ' + paused.toFixed(2) + '×<small>PAUSED · paying 1× until you refresh</small></span>'
          : '<span class="eq-chip eq-out">⚡ ' + mult.toFixed(2) + '×<small>' + (stacked ? 'HOLDER BOOST' : 'SEND POWER') + '</small></span>') +
        (em.og > 1 ? '<span class="eq-op">+</span><span class="eq-chip eq-og' + ogVariant(g) + '">🏅 +' + (em.og - 1) + '<small>OG' + (g.ogTierName ? ' ' + g.ogTierName.toUpperCase() : '') + ' · ' + em.og + '× alone</small></span>' : '') +
        (em.comm > 1 ? '<span class="eq-op">+</span><span class="eq-chip eq-comm">🏘️ +' + (em.comm - 1) + '<small>community · ' + em.comm + '× alone</small></span>' : '') +
        (em.arcade > 1 ? '<span class="eq-op">+</span><span class="eq-chip eq-comm">🚀 +' + (Math.round((em.arcade - 1) * 100) / 100) + '<small>arcade · ' + em.arcade + '× alone</small></span>' : '') +
        (em.weekly > 1 ? '<span class="eq-op">+</span><span class="eq-chip eq-og">🏆 +' + (Math.round((em.weekly - 1) * 100) / 100) + '<small>prize · ' + em.weekly + '× alone</small></span>' : '') +
        (stacked ? '<span class="eq-op">=</span><span class="eq-chip eq-out">⚡ ' + em.eff.toFixed(2) + '×<small>SEND POWER</small></span>' : '') +
      '</div>' +
      '<p class="eq-note">' + (stale ? '⏸ Paused until you Refresh — we re-verify your bags on-chain.' : '<b>$GWC counts ×3</b>, and holding $GWC longer levels your Diamond faster — bigger bags held longer scale this up with <b>no cap</b> · every point ×your Power · <b>resets when you sell</b>.') + '</p>' +
      (dust.length ? '<p class="eq-dust">⚠️ Your ' + dust.join(' and ') + ' ' + (dust.length > 1 ? 'are' : 'is') + ' under the $' + ((g.rules && g.rules.holdFloorUsd) || 100) +
        ' floor, so ' + (dust.length > 1 ? 'they count' : 'it counts') + ' for nothing in the supply term above. That is why the number is smaller than your holdings suggest — <a href="#rekt-revoke-h">the floor, and where you stand against it</a>.</p>' : '') +
    '</div>';
  }

  // how long is left in a window, coarse on purpose — this is a rules card, not the homepage countdown
  function fmtLeft(ms) {
    if (!(ms > 0)) return '';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
    return d >= 1 ? d + ' day' + (d === 1 ? '' : 's') : h + ' hour' + (h === 1 ? '' : 's');
  }
  // which tier's colour a block/chip wears — '' is gold, which the base rules already paint
  function ogVariant(g) {
    const t = Number(g.ogTier || g.og) || 0;
    return t === 2 ? '--silver' : t === 1 ? '--bronze' : '';
  }
  // OG status banner on your own dashboard. Every number and every window phrase comes from the
  // server's own tier record — none of it is written into this file, because the three tiers pay
  // three different multipliers and a hardcoded one would be a number the user is not earning.
  function ogBlock(g) {
    const tier = Number(g.ogTier || g.og) || 0;
    if (tier) {
      const when = tier === 3 ? 'in their first month'
        : tier === 2 ? 'in the two months after the gold window closed'
        : 'in the nine months after the silver window closed';
      const v = ogVariant(g);
      return '<div class="og-block' + (v ? ' og-block' + v : '') + '"><span class="og-block-badge">🏅 OG ' + (g.ogTierName || '') + '</span>'
        + '<div class="og-block-body"><b>You’re an OG ' + (g.ogTierName || '') + '.</b> You bought <b>both $Send and $GWC</b> '
        + when + ' (checked on-chain) — a permanent <b>' + (Number(g.ogBonus) || 1) + '× Send Power</b> bonus on <b>everything</b> you do (+' + ((Number(g.ogBonus) || 1) - 1) + '× on top of any other boosts — boosts add, they don’t multiply). '
        + 'Keep holding <b>both</b>: sell out of either and it’s gone for good.</div></div>';
    }
    if (g.ogRevoked) return '<div class="og-block og-block-lost"><span class="og-block-badge">🥀</span><div class="og-block-body"><b>OG status removed.</b> OG requires holding <b>both</b> $Send and $GWC, and you sold out of one — your badge and its Send Power bonus are gone, and can’t be reclaimed.</div></div>';
    // ogDq is one bit for the whole account: it says at least one wallet was ruled out by the dump
    // standard, NOT that this is the only reason there is no badge (the other coin may simply never
    // have been bought). So it states what it actually knows and stops there — the earlier wording
    // named a single cause and a single remedy, both of which could be wrong for the reader, and the
    // remedy pointed at a purchase, which is not something this site tells anyone to make.
    if (g.ogDq) return '<div class="og-block og-block-lost"><span class="og-block-badge">⚠️</span><div class="og-block-body"><b>One of your wallets didn’t meet the OG standard.</b> It bought inside a window, but it sold its whole holding to nothing inside its first month <b>and</b> holds less now than it did at the end of that month. That is not the only thing OG needs — it also requires having bought <b>both</b> $Send and $GWC and still holding both. Nothing here is permanent: your wallets are re-read from the chain on a schedule while the windows are open.</div></div>';
    // No badge, nothing lost: say which window is open and what it pays, from the server's own clock.
    // Every number here is the campaign the server serves — none is written into this file.
    const c = g.ogCampaign;
    if (c && c.open && c.tierNow && c.name && c.mult) {
      const name = c.name[c.tierNow] || '', mult = c.mult[c.tierNow];
      const closes = c.closes && c.closes[name.toLowerCase()];
      const left = closes ? fmtLeft(closes - Date.now()) : '';
      const v = c.tierNow === 2 ? '--silver' : c.tierNow === 1 ? '--bronze' : '';
      return '<div class="og-block' + (v ? ' og-block' + v : '') + '"><span class="og-block-badge">🏅 OG ' + esc(name) + '</span>'
        + '<div class="og-block-body"><b>The OG ' + esc(name) + ' window is open' + (left ? ' — it closes in ' + left : '') + '.</b> '
        + 'Anyone who holds <b>both $Send and $GWC</b> bought inside this window, and keeps holding both, earns a permanent badge and <b>' + mult + '× Send Power</b> on everything. '
        + 'The standard is identical in every window — gold 10×, silver 5×, bronze 3× — only <b>when</b> you got in changes the size. Sell out of either and it’s gone for good. '
        + 'Not a reason to buy — just how the badge works.</div></div>';
    }
    return '';
  }

  // 🏘️ Communities & Conviction — the flat 10× status + your community/conviction levels
  function communityBlock(g) {
    const all = g.communities || [], live = all.filter(c => c.status === 'live' && !c.demo), sandbox = all.find(c => c.demo);
    // the sandbox is a membership, not a multiplier: it is named, and never counted toward "10× active"
    const sandboxLine = sandbox ? '<p class="comm-sandbox-line">🧪 You are also in the <a href="community.html?id=' + sandbox.id + '">sandbox</a> ($' + esc(sandbox.symbol) + ' — a listed stock, not a token) — it grants no multiplier.</p>' : '';
    if (!live.length) {
      return '<div class="og-block comm-invite"><span class="og-block-badge">🏘️</span>' +
        '<div class="og-block-body"><b>Join a community for a flat 10× Send Power.</b> Rally around any token — a community goes <b>live at 10 verified holder slots</b>, and while you’re in <b>≥1 live</b> one, <b>a flat 10× boost (+9×) is added to every point you earn</b>, on top of your Holder Boost &amp; OG — boosts add, they don’t multiply. Post, react &amp; comment on its wall to raise your <b>community member level</b> and help the community level up. ' +
        '<a class="gobj-link" href="communities.html">Browse communities →</a>' + sandboxLine + '</div></div>';
    }
    const bar = (label, lvl, into, span, cls) => {
      const pct = span ? Math.min(100, Math.round(into / span * 100)) : 100;
      return '<div class="comm-xp ' + cls + '"><div class="comm-xp-head"><span>' + label + '</span><b>Lv ' + lvl + '</b></div>' +
        '<div class="gxp" role="progressbar" aria-valuenow="' + into + '" aria-valuemin="0" aria-valuemax="' + (span || into) + '" aria-label="' + label + ' level ' + lvl + '"><span class="gxp-fill" style="width:' + pct + '%"></span></div></div>';
    };
    const rows = live.map(c =>
      '<a class="comm-mini" href="community.html?id=' + c.id + '">' +
        '<div class="comm-mini-head"><b>$' + esc(c.symbol) + '</b> <span class="comm-mini-name">' + esc(c.name) + '</span></div>' +
        bar('🏆 Community', c.commLevel, c.commInto, c.commSpan, 'comm-xp-community') +
        bar('💎 ' + esc(c.conviction.title), c.conviction.level, c.conviction.into, c.conviction.span, 'comm-xp-conv') +
      '</a>').join('');
    return '<div class="og-block comm-block"><span class="og-block-badge comm-block-badge">⚡ 10×</span>' +
      '<div class="og-block-body"><b>10× Send Power active.</b> You’re in ' + live.length + ' live communit' + (live.length === 1 ? 'y' : 'ies') + ' — a flat <b>10× boost (+9×)</b> is added to every point you earn, on top of your Holder Boost &amp; OG — boosts add, they don’t multiply. Keep posting, reacting &amp; commenting on their walls to raise your <b>member level</b> and help each community level up.' +
      '<div class="comm-mini-grid">' + rows + '</div>' + sandboxLine + '</div></div>';
  }

  /* =========================================================================
     SECTION 6 — BOOST ENGINE: The Vault (holdings + hold forge) | Diamond Relic
     ========================================================================= */
  function tokenRow(sym, cls, amount, pct) {
    const w = whale(pct);
    const fill = fillLog(pct);
    const truthful = pctFmt(pct) + '% of ' + sym + ' supply, ' + w.cur.n + ' tier' + (w.next ? ' — ' + pctFmt(Math.max(0, w.next.t - pct)) + '% to ' + w.next.n : ', top tier');
    const cap = w.next
      ? pctFmt(pct) + '% of supply · <b>' + pctFmt(Math.max(0, w.next.t - pct)) + '%</b> to ' + w.next.e + ' ' + w.next.n
      : pctFmt(pct) + '% of supply · 🐋 top tier reached';
    return '<div class="vtok">' +
      '<span class="token-emblem ' + cls + ' vtok-emblem" aria-hidden="true">$</span>' +
      '<div class="vtok-body">' +
        '<div class="vtok-line">' +
          '<span class="vtok-amt"><span class="cu" data-cu="' + amount + '" data-cufmt="compact" aria-hidden="true">0</span><span class="sr-only">' + compact(amount) + '</span></span>' +
          '<span class="vtok-sym">' + sym + '</span>' +
          '<span class="vtok-pill">' + w.cur.e + ' ' + w.cur.n + '</span>' +
        '</div>' +
        '<div class="vmeter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(fill) + '" aria-valuetext="' + esc(truthful) + '" aria-label="' + sym + ' holdings — progress to next holder tier">' +
          '<div class="vmeter-fill ' + cls + '" data-fill="' + fill.toFixed(1) + '" style="width:0"></div>' +
          '<i class="vtick" style="left:20%"></i><i class="vtick" style="left:40%"></i><i class="vtick" style="left:60%"></i><i class="vtick" style="left:80%"></i>' +
        '</div>' +
        '<div class="vtok-cap">' + cap + '</div>' +
      '</div>' +
    '</div>';
  }

  function holdForge(h) {
    const days = Math.floor(h.holdDays || 0);
    const stale = h.fresh === false;
    const since = h.streakStart ? new Date(h.streakStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const flame = Math.min(2.7, 1.5 + days / 120 * 1.2).toFixed(2);
    return '<div class="forge' + (stale ? ' forge-stale' : '') + '" role="group" aria-label="' + days + '-day hold streak' + (since ? ' since ' + since : '') + ', resets if you sell">' +
      '<div class="forge-flame" aria-hidden="true" style="font-size:' + flame + 'rem">🔥</div>' +
      '<div class="forge-body">' +
        '<div class="forge-days"><span class="cu" data-cu="' + days + '" data-cufmt="int" aria-hidden="true">0</span><span class="sr-only">' + days + '</span> <span class="forge-unit">day' + (days === 1 ? '' : 's') + ' held</span></div>' +
        '<div class="forge-sub">' + (stale
          ? '<span class="danger">⏸ Verify to keep your streak alive</span>'
          : (since ? 'Never sold since <b>' + since + '</b> · ' : '') + '<span class="danger">sell = reset to 📄 Paper Grip</span>') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function diamondRelic(h) {
    const d = h.diamond || { level: 0, maxLevel: 10, name: 'Paper Grip', emoji: '📄', days: 0, nextDays: null, progress: 0, factor: 1 };
    const days = Math.floor(h.holdDays || 0);
    const diaPct = Math.round((d.progress || 0) * 100);
    const maxed = d.nextDays == null;
    // 10 rim pips encode earned tiers BY SHAPE (filled disc = earned, hollow = not, gold ring = current)
    let pips = '';
    for (let i = 1; i <= 10; i++) {
      const ang = (-90 + (i - 1) * 36) * Math.PI / 180;
      const x = (60 + 52 * Math.cos(ang)).toFixed(1), y = (60 + 52 * Math.sin(ang)).toFixed(1);
      const earned = d.level >= i, current = d.level === i;
      pips += '<circle cx="' + x + '" cy="' + y + '" r="' + (earned ? 4 : 2.6) + '" class="relic-pip' + (earned ? ' on' : '') + (current ? ' cur' : '') + '"/>';
    }
    // frame the bar as within-tier progress so the visible label AND the aria value both match the rendered fill (diaPct)
    const daysLeft = maxed ? 0 : Math.max(0, d.nextDays - days);
    const barText = maxed ? '👑 ' + esc(d.name) + ' — MAX' : days + ' day' + (days === 1 ? '' : 's') + ' held · ' + daysLeft + ' to ' + esc(diaNextLabel(d.level));
    return '<div class="relic' + (maxed ? ' relic-max' : '') + '">' +
      '<h3 class="eng-h">💎 Diamond Relic</h3>' +
      '<div class="relic-medal-wrap">' +
        '<svg viewBox="0 0 120 120" class="relic-medal" aria-hidden="true">' +
          '<defs><linearGradient id="gRelic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a7fb0"/><stop offset="1" stop-color="#9fe0ff"/></linearGradient></defs>' +
          '<circle cx="60" cy="60" r="52" class="relic-track"/>' +
          '<circle cx="60" cy="60" r="52" class="relic-arc" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-fill="' + (100 - diaPct) + '" data-fillkind="dash" transform="rotate(-90 60 60)"/>' +
          '<circle cx="60" cy="60" r="40" class="relic-disc"/>' +
          pips +
          '<text x="60" y="58" text-anchor="middle" class="relic-emoji">' + d.emoji + '</text>' +
          '<text x="60" y="80" text-anchor="middle" class="relic-lv">LV ' + d.level + '</text>' +
        '</svg>' +
      '</div>' +
      '<div class="relic-name">' + d.emoji + ' ' + esc(d.name) + '</div>' +
      '<div class="relic-meta">Diamond Lv <b>' + d.level + '</b> / ' + d.maxLevel + ' · gives <b>×' + d.factor.toFixed(1) + '</b> hold boost</div>' +
      '<div class="gd-bar relic-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (maxed ? 100 : diaPct) + '" aria-valuetext="' + barText + '" aria-label="Progress to next Diamond tier">' +
        '<div class="gd-fill" data-fill="' + (maxed ? 100 : diaPct) + '" style="width:0"></div>' +
        '<span class="gd-text">' + barText + '</span>' +
      '</div>' +
    '</div>';
  }

  function boostEngine(g) {
    const h = g.holder;
    const hasWallet = AUTH.user && AUTH.user.wallets && AUTH.user.wallets.length;
    if (!h || !h.streakStart || (h.scorePct || 0) <= 0) {
      // locked — collapse Vault + Relic into one invite
      return '<div class="engine engine-locked">' +
        '<div class="lock-ico" aria-hidden="true">🔒</div>' +
        '<h3 class="eng-h">Holder Boost locked</h3>' +
        '<p class="modal-note" style="margin:0.3rem 0 0.7rem;">' +
          (hasWallet
            ? 'Buy &amp; hold <b>$SEND / $GWC</b> to unlock a boost that multiplies <b>every point</b> you earn — then it climbs the longer you hold. Hit Refresh after you buy.'
            : 'Connect a wallet holding <b>$SEND / $GWC</b> to unlock a boost that multiplies <b>every point</b> you earn — and grows the longer you diamond-hand.') +
        '</p>' +
        '<div class="lock-btns">' +
          (hasWallet ? '' : '<button class="btn btn-primary btn-sm js-connect" type="button">Connect wallet 🔗</button>') +
          '<button class="btn btn-ghost btn-sm js-refresh" type="button">↻ Refresh holdings</button>' +
        '</div>' +
      '</div>';
    }
    const p = tokenPcts(g);
    const scorePct = h.scorePct || 0;
    // per-token % is unknown only for a pre-migration holder row whose on-chain re-verify hasn't landed yet.
    // In that window show the honest combined figure + a refresh CTA instead of a misleading "0% + 0%".
    const live = g.holderLive && (g.holderLive.pctSend != null || g.holderLive.pctGwc != null);
    const splitKnown = h.splitKnown !== false || live;
    // the same $GWC-weighted term the server applies (and the equation strip shows); unweighted only while the split is unknown
    const supplyTerm = splitKnown ? supplyTermOf(h) : 10 * scorePct;
    const vaultInner = splitKnown
      ? tokenRow('$SEND', 'send', h.sendTok || 0, p.send) +
        tokenRow('$GWC', 'gwc', h.gwcTok || 0, p.gwc) +
        /* The weighted, QUALIFYING percentage — the one that actually produces the number beside it.
           scorePct is the raw combined %, unweighted and with no floor applied, so pairing it with the
           supply term read as an equation that does not hold: 0.150% × 10 is 1.5, not 3.9. */
        '<div class="vault-foot">Together <b>' + pctFmt(supplyTerm / 10) + '%</b> weighted ($GWC counts ×' + GWC_W +
          (dustedCoins(h).length ? ', and your ' + dustedCoins(h).join(' and ') + ' sits under the $' + ((g.rules && g.rules.holdFloorUsd) || 100) + ' floor so it counts for nothing' : '') +
          ') → feeds your <b>×' + supplyTerm.toFixed(1) + '</b> supply boost</div>'
      : '<div class="vtok"><span class="token-emblem send vtok-emblem" aria-hidden="true">$</span><div class="vtok-body"><div class="vtok-line"><span class="vtok-amt">' + compact(h.sendTok || 0) + '</span> <span class="vtok-sym">$SEND</span></div></div></div>' +
        '<div class="vtok"><span class="token-emblem gwc vtok-emblem" aria-hidden="true">$</span><div class="vtok-body"><div class="vtok-line"><span class="vtok-amt">' + compact(h.gwcTok || 0) + '</span> <span class="vtok-sym">$GWC</span></div></div></div>' +
        '<div class="vault-foot">You hold <b>' + pctFmt(scorePct) + '%</b> of combined supply → <b>×' + supplyTerm.toFixed(1) + '</b> supply boost · <button class="gobj-link js-refresh" type="button">Refresh to see your $SEND / $GWC split</button></div>';
    return '<div class="engine engine-live">' +
      '<div class="vault">' +
        '<h3 class="eng-h">🏦 The Vault</h3>' +
        vaultInner +
        holdForge(h) +
      '</div>' +
      diamondRelic(h) +
    '</div>';
  }

  /* =========================================================================
     SECTION 7 — LOOT LOG (bonus points by feature)
     ========================================================================= */
  const RAMP = ['var(--green)', 'var(--gold)', 'var(--diamond)', 'var(--green-bright)', 'var(--gold-deep)', 'var(--diamond-deep)', 'var(--text-dim)'];
  function wireLootToggle() {
    dash.querySelectorAll('[data-lootmode]').forEach(b => {
      if (b._lw) return; b._lw = true;
      b.addEventListener('click', () => {
        if (_lootMode === b.dataset.lootmode) return;
        _lootMode = b.dataset.lootmode;
        const loot = dash.querySelector('.loot');
        if (loot && _lg) { loot.outerHTML = lootLog(_lg); animate(dash); wireLootToggle(); }
      });
    });
  }
  function lootToggle() {
    return '<div class="ll-toggle" role="group" aria-label="Achievement log window">' +
      '<button type="button" data-lootmode="today" class="' + (_lootMode === 'today' ? 'active' : '') + '" aria-pressed="' + (_lootMode === 'today') + '">Today</button>' +
      '<button type="button" data-lootmode="all" class="' + (_lootMode === 'all' ? 'active' : '') + '" aria-pressed="' + (_lootMode === 'all') + '">All&nbsp;time</button>' +
    '</div>';
  }
  function lootLog(g) {
    /* `x.total > 0` used to be the filter, which meant a negative kind could never appear here — and
       'decay' is the only negative kind there is. So the site wrote a ledger line for every drain, kept a
       📉 label ready for it, told users in two places that "every drain writes a line to your points
       history", and then filtered that line out of the only history a user can read. Losses belong in the
       log; the bars below are drawn from magnitudes, so a negative row sizes correctly and is coloured and
       signed as a loss. */
    const all = ((_lootMode === 'today' ? g.todayBreakdown : g.breakdown) || []).filter(x => x.total !== 0);
    const bd = all.filter(x => x.total > 0);
    const losses = all.filter(x => x.total < 0);
    const head = '<div class="ll-head"><h3 class="gsub">🎒 Loot Log</h3>' + lootToggle() + '</div>';
    if (!bd.length && !losses.length) {
      return '<div class="loot">' + head +
        '<p class="modal-note">' + (_lootMode === 'today' ? 'No loot today yet — the log resets every 24h. Complete a quest below! 🗺️' : 'No loot yet — complete a quest below to start your log. 🗺️') + '</p></div>';
    }
    const sum = bd.reduce((a, x) => a + x.total, 0);
    // bd can now be empty while losses is not (a day whose only event was a drain) — bd[0] would throw
    const max = (bd[0] && bd[0].total) || 1;
    const legend = bd.map(x => (ACTION_LABEL[x.kind] ? ACTION_LABEL[x.kind][1] : x.kind) + ' ' + Math.round(x.total / sum * 100) + '%').join(', ');
    let segs = '';
    bd.forEach((x, i) => { segs += '<span style="width:' + (x.total / sum * 100).toFixed(2) + '%;background:' + RAMP[i % RAMP.length] + '"></span>'; });
    let rows = '';
    bd.forEach((x, i) => {
      const meta = ACTION_LABEL[x.kind] || ['🪙', x.kind];
      // The tip is the Quest Board's own explanation of this kind, plus what THIS row adds up to — so
      // "Diamond hands · 4,120" reads as "paid while a call you made stayed in profit: 12 payouts". A kind
      // with no description still gets the totals line rather than a blank bubble.
      const why = (EARN_DESC[x.kind] ? esc(EARN_DESC[x.kind]) + ' ' : '') + '<b>' + nf(x.total) + ' Send Power</b> from ' + x.n + ' payout' + (x.n === 1 ? '' : 's') + (_lootMode === 'today' ? ' in the last 24h.' : ' all time.');
      rows += '<li class="ll-li" style="--i:' + i + '" aria-label="' + esc(meta[1]) + ': ' + nf(x.total) + ' points from ' + x.n + ' action' + (x.n === 1 ? '' : 's') + '">' +
        '<span class="ll-ico" aria-hidden="true">' + meta[0] + '</span>' +
        '<span class="ll-label">' + esc(meta[1]) + (i === 0 ? ' <span class="ll-top">⭐ Top</span>' : '') + '<span class="ll-n">×' + x.n + '</span>' +
          '<button class="ll-info" type="button" aria-expanded="false" aria-label="What ' + esc(meta[1]) + ' points are for">ⓘ</button></span>' +
        '<span class="ge-tip" role="tooltip">' + why + '</span>' +
        '<span class="ll-track" aria-hidden="true"><span class="ll-fill" data-fill="' + (x.total / max * 100).toFixed(1) + '" style="width:0;background:' + RAMP[i % RAMP.length] + '"></span></span>' +
        '<span class="ll-pts">' + nf(x.total) + '</span>' +
      '</li>';
    });
    // nudge an untried high-value action
    if (!bd.find(x => x.kind === 'swap')) {
      rows += '<li class="ll-nudge"><span class="ll-ico" aria-hidden="true">🚀</span>' +
        '<a class="ll-label" href="/index.html#swap">Swap for $Send — you haven\'t tried this <span class="ll-n">+450 each →</span></a></li>';
    }
    /* What was taken, listed under what was given rather than left out of the ledger entirely. It is kept
       visually separate because it is not loot — it is the counterweight, and mixing a loss into the same
       ranked list as the earnings would make the biggest drain look like the best day. */
    let lossRows = '';
    if (losses.length) {
      const lost = losses.reduce((a, x) => a + Math.abs(x.total), 0);
      lossRows = '<ul class="loot-list loot-losses" aria-label="Send Power taken back">' + losses.map(x => {
        const meta = ACTION_LABEL[x.kind] || ['📉', x.kind];
        return '<li class="ll-li ll-loss" aria-label="' + esc(meta[1]) + ': ' + nf(Math.abs(x.total)) + ' points taken across ' + x.n + ' charge' + (x.n === 1 ? '' : 's') + '">' +
          '<span class="ll-ico" aria-hidden="true">' + meta[0] + '</span>' +
          '<span class="ll-label">' + esc(meta[1]) + '<span class="ll-n">×' + x.n + '</span></span>' +
          '<span class="ll-track" aria-hidden="true"><span class="ll-fill ll-fill-loss" data-fill="' + Math.min(100, Math.abs(x.total) / Math.max(1, max) * 100).toFixed(1) + '" style="width:0"></span></span>' +
          '<span class="ll-pts ll-pts-loss">−' + nf(Math.abs(x.total)) + '</span>' +
        '</li>';
      }).join('') + '</ul>' +
      '<p class="loot-foot loot-foot-loss">Taken back ' + (_lootMode === 'today' ? 'today' : 'all time') + ': <b>−' + nf(lost) + '</b> · ' +
      '<a href="#rekt-h">why, and what it costs you next →</a></p>';
    }
    return '<div class="loot">' + head +
      (bd.length ? '<div class="loot-bar" role="img" aria-label="Points by source: ' + esc(legend) + '">' + segs + '</div>' +
        '<ul class="loot-list">' + rows + '</ul>' +
        '<p class="loot-foot">' + (_lootMode === 'today' ? 'Earned today' : 'Total earned') + ': <b>' + nf(sum) + '</b> across ' + bd.length + ' feature' + (bd.length === 1 ? '' : 's') + (_lootMode === 'today' ? ' · resets every 24h' : '') + '</p>'
        : '<p class="modal-note">' + (_lootMode === 'today' ? 'Nothing earned in the last 24h.' : 'Nothing earned yet.') + '</p>') +
      lossRows +
    '</div>';
  }

  /* =========================================================================
     SECTION 8 — QUEST BOARD + ARENA
     ========================================================================= */
  /* ═══ copy built from the server's own constants ═══════════════════════════════════════════════════
     Anything with a number in it that a user might act on gets written here, from g.rules, rather than
     typed into a string above. Five daily caps and the whole X ladder had already drifted out of sync
     doing it the other way. */
  function capLine(k, rules) {
    const cap = rules && rules.dailyCap && rules.dailyCap[k];
    if (!(cap > 0)) return '';
    if (cap === 1) return ' Once, ever.';
    return ' Capped ' + cap + '/day.';
  }
  function ladderCopy(rules) {
    if (!rules || !(rules.callXFirst > 0)) return 'Each whole X your call hits pays a Send Power milestone as it runs.';
    const first = rules.callXFirst, step = rules.callXStep || 0, cap = rules.callXCap || 50;
    const rung = (m) => Math.round(first * (1 + (m - 1) * step));
    return 'The payoff: each whole X your call hits pays a milestone, awarded once as it passes, with no daily cap. ' +
      'The rungs rise in a straight line rather than with the multiple — 1x → +' + nf(first) + ', 2x → +' + nf(rung(2)) +
      ', 10x → +' + nf(rung(10)) + ', up to ' + cap + 'x → +' + nf(rung(cap)) + ' — so the ladder is a reward for a call that runs, ' +
      'not the whole prize. Most of what a call can pay is reserved for holding it in profit. ' +
      'Everything one call ever pays you shares a single lifetime budget of ' + nf(rules.callBudget || 0) + '. Remember +100% = 1x.';
  }

  /* The rolling ceiling, which nothing on the site used to mention. Every daily-capped kind plus the
     check-in share ONE 24-hour budget on the PAID amount, so a 400× holder and a 1× newcomer both stop at
     the same number for a day of clicks. That is the single most consequential rule on the Quest Board and
     it was not written anywhere a user could read it. */
  function dayCapLine(g) {
    const r = g.rules; if (!r || !(r.socialDayCap > 0)) return '';
    const spent = Math.max(0, r.socialSpentToday || 0), cap = r.socialDayCap;
    const pct = Math.min(100, Math.round(spent / cap * 100));
    const left = Math.max(0, cap - spent);
    return '<div class="gcap" role="group" aria-label="Rolling 24-hour earning ceiling">' +
      '<div class="gcap-head"><span>🧢 Rolling 24h ceiling</span>' +
        '<b><span class="cu" data-cu="' + spent + '" data-cufmt="nf" aria-hidden="true">0</span><span class="sr-only">' + nf(spent) + '</span> / ' + nf(cap) + '</b></div>' +
      '<div class="gxp" role="progressbar" aria-valuemin="0" aria-valuemax="' + cap + '" aria-valuenow="' + spent + '"' +
        ' aria-valuetext="' + nf(spent) + ' of ' + nf(cap) + ' used, ' + nf(left) + ' left"><span class="gxp-fill gcap-fill" data-fill="' + pct + '" style="width:0"></span></div>' +
      '<p class="gcap-note">Everything except Send Call performance shares this one ceiling, <b>after</b> your boost. ' +
      (left > 0 ? '<b>' + nf(left) + '</b> left today.' : '<b>Reached for now</b> — it is a rolling window, so it frees up as the last 24 hours pass.') +
      ' Calls held in profit are paid outside it: that is the fast lane.</p>' +
    '</div>' +
    '<p class="modal-note" style="margin-top:0.4rem;">Tap any quest to go do it. Points × your ⚡ Power, then this ceiling.</p>';
  }

  function earnList(perAction, mult, rules) {
    mult = mult || 1;
    let html = '<ul class="gearn">';
    for (const k of ORDER) {
      if (!ACTION_LABEL[k]) continue;
      const [ico, label] = ACTION_LABEL[k];
      const t = EARN_ACTION[k] || {};
      const variable = VARIABLE.has(k);
      if (!variable && perAction[k] == null) continue; // fixed-point action with no configured value → skip
      const base = perAction[k];
      // the server's real per-event ceiling. This was hardcoded at 500,000 while PTS_EVENT_CAP is 73,762,
      // so a large stack was shown a per-action figure up to ~6.8x what it would actually be paid.
      const evCap = (rules && rules.eventCap > 0) ? rules.eventCap : 73762;
      const eff = base != null ? Math.min(evCap, Math.max(1, Math.round(base * mult))) : 0;
      const pts = variable
        ? '<span class="ge-pts ge-var" title="Points scale with real performance">⚡ scales</span>'
        : (mult > 1
          ? '<span class="ge-pts">+' + base + ' <span class="ge-eff">→ +' + nf(eff) + ' ⚡</span></span>'
          : '<span class="ge-pts">+' + base + '</span>');
      const inner = '<span class="ge-ico" aria-hidden="true">' + ico + '</span><span class="ge-label">' + label + '</span>' + pts;
      const desc = (k === 'call_x' ? ladderCopy(rules) : (EARN_DESC[k] || '')) + capLine(k, rules);
      const aria = label + '. ' + desc + (variable ? ' Points scale with your call’s performance.' : ' Earn ' + (mult > 1 ? eff + ' boosted' : base) + ' points.');
      const tip = desc
        ? '<span class="ge-tip" role="tooltip">' + esc(desc) + (mult > 1 ? ' Your ⚡' + mult.toFixed(2) + '× boost makes it +' + nf(eff) + '.' : '') + '</span>'
        : '';
      let row;
      // The daily bonus is a BUTTON on your own wall now, not something that happens to you on page load — so this
      // row may only claim "✓ today" when the server says you actually checked in; otherwise it's a quest to go do.
      const mine = (window.AUTH && AUTH.user && AUTH.user.username) || '';
      const done = t.done || (t.wall && !!(window.AUTH && AUTH.user && AUTH.user.checkedInToday));
      const wallHref = mine ? '/u/' + encodeURIComponent(mine) : '/wall.html';
      if (done) row = '<div class="gearn-row gearn-done">' + inner + '<span class="ge-go" aria-hidden="true">✓ today</span></div>';
      else if (t.wall) row = '<a class="gearn-row" href="' + wallHref + '" aria-label="' + aria + '">' + inner + '<span class="ge-go" aria-hidden="true">→</span></a>';
      else if (t.href) row = '<a class="gearn-row" href="' + t.href + '" aria-label="' + aria + '">' + inner + '<span class="ge-go" aria-hidden="true">→</span></a>';
      else row = '<button class="gearn-row" type="button" data-earn="' + k + '" aria-label="' + aria + '">' + inner + '<span class="ge-go" aria-hidden="true">→</span></button>';
      // ⓘ toggle so the rule text is reachable by tap, not just hover (audit #24 — mobile has no hover)
      const info = tip ? '<button class="ge-info" type="button" aria-expanded="false" aria-label="Rules for ' + esc(label) + '">ⓘ</button>' : '';
      html += '<li class="gearn-li">' + row + info + tip + '</li>';
    }
    html += '</ul>';
    const rcv = (k, word) => { const c = rules && rules.dailyCap && rules.dailyCap[k]; return '<b>' + word + '</b>' + (c > 0 ? ' (' + c + '/day)' : ''); };
    html += '<p class="gearn-passive">💚 You also earn passively — ' + rcv('react_get', 'a reaction') + ', ' +
      rcv('vote_get', 'an upvote') + ', or ' + rcv('be_followed', 'a new follower') + ' on your posts all add Send Power automatically. ' +
      'Those are the three a ring of fake accounts could push at you, so they are the tightest caps on the board.</p>';
    return html;
  }


  /* ═══════════════════════════════════════════════════════════════════════════════════════════════════
     💀 REKT — the other half of the ledger
     ═══════════════════════════════════════════════════════════════════════════════════════════════════
     Everything above this point on the dashboard is a way to GAIN. The same engine also takes: it drains
     a balance for absence, for being muted and for calls left underwater; it shrinks a caller's daily
     allowance; it revokes badges the moment a bag is sold; and it counts strikes that never expire.
     None of that was reachable from the client, so the first a person heard of any of it was a
     notification telling them it had already happened.

     Design rules for this block, which are not decoration:
       - It states the RULE and then this account's STANDING against it. A rule with no standing is a
         poster; a standing with no rule is a scolding.
       - Every number comes from g.rules / g.decay / g.restriction — the server's own constants. Nothing
         here is retyped, because retyped numbers on this site have drifted every single time.
       - Danger is never carried by colour alone: every risky row has a word, an icon and a shape.
       - It is not hidden behind a <details> the way the rulebook is. Consequences a person can be
         surprised by have to be visible without a click.
  */
  function pctTxt(p) { return (Math.round(p * 10) / 10) + '%'; }

  // the live decay forecast: what the next sweep costs this account, and what is holding it there
  function decayCard(g) {
    const d = g.decay; if (!d) return '';
    const at = d.pct > 0;
    const why = {
      away: (r) => '<b>' + r.days + ' day' + (r.days === 1 ? '' : 's') + ' without checking in</b> — ' + pctTxt(r.pct) +
        '. The first ' + d.graceDays + ' days are free; after that it starts at ' + pctTxt(d.basePct) + ' and adds ' + pctTxt(d.accelPct) + ' for every further day away.',
      readonly: (r) => '<b>Read-only</b> — a flat ' + pctTxt(r.pct) + ' a day for as long as the restriction lasts. Checking in does not stop this part; only the restriction lifting does.',
      badcalls: (r) => '<b>' + r.n + ' call' + (r.n === 1 ? '' : 's') + ' underwater</b> — ' + pctTxt(r.pct) +
        ' (' + pctTxt(d.badCallPct) + ' each, capped at ' + pctTxt(d.badCallMax) + '). Only charged on days you were already away.',
    };
    const rows = (d.reasons || []).map(r => '<li class="rekt-row rekt-row-bad"><span class="rekt-dot" aria-hidden="true">▲</span><span>' + why[r.key](r) + '</span></li>').join('');
    const head = d.protected
      ? '<span class="rekt-state rekt-state-safe">Nothing at risk</span>'
      : at
        ? '<span class="rekt-state rekt-state-bad">−' + nf(d.drain) + ' at the next sweep</span>'
        : '<span class="rekt-state rekt-state-safe">Nothing at risk</span>';
    const body = d.protected
      ? '<p class="rekt-p">Balances at or under <b>' + nf(d.floor) + '</b> are never touched, so nothing can be taken from you yet. Decay starts mattering above that.</p>'
      : at
        ? '<ul class="rekt-list">' + rows + '</ul>' +
          '<p class="rekt-p">That is <b>' + pctTxt(d.pct) + '</b> of your balance' + (d.hitCeiling ? ' — the ceiling; one day can never take more than ' + pctTxt(d.maxPct) + ' however long you are away' : '') +
          ', and it can never take you below <b>' + nf(d.floor) + '</b>.' + (d.showedUp ? '' : ' <b>Checking in today zeroes the absence part immediately.</b>') + '</p>'
        : '<p class="rekt-p">You have checked in, you are not restricted, and nothing is underwater. ' +
          'For reference: absence costs nothing for ' + d.graceDays + ' days, then ' + pctTxt(d.basePct) + ' rising by ' + pctTxt(d.accelPct) + ' a day, ' +
          'read-only adds a flat ' + pctTxt(d.readOnlyPct) + ', underwater calls add ' + pctTxt(d.badCallPct) + ' each up to ' + pctTxt(d.badCallMax) + ', and one day never takes more than ' + pctTxt(d.maxPct) + '.</p>';
    const last = d.lastDrain > 0
      ? '<p class="rekt-last">Last charged <b>−' + nf(d.lastDrain) + '</b>' + (d.lastAt ? ' · ' + new Date(d.lastAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') + '.</p>'
      : '';
    return '<section class="rekt-card' + (at && !d.protected ? ' is-live' : '') + '" aria-labelledby="rekt-decay-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-decay-h">📉 Send Power decay</h4>' + head + '</div>' +
      '<p class="rekt-lede">Send Power is a balance, not a trophy. It drains while you are away, while you are muted, and while your calls sit underwater.</p>' +
      body + last +
    '</section>';
  }

  // the strike ladder + this account's standing on it, and both ways back
  function restrictCard(g) {
    const r = g.restriction, p = g.probation, rules = g.rules || {};
    const strikes = g.strikes || 0;
    const rung = (n, label, on) => '<li class="rekt-rung' + (on ? ' is-on' : '') + '"><span class="rekt-rung-n" aria-hidden="true">' + n + '</span>' +
      '<span>' + label + '</span>' + (on ? '<span class="rekt-rung-you">you are here</span>' : '') + '</li>';
    const ladder = '<ol class="rekt-ladder" aria-label="The strike ladder">' +
      rung(1, '<b>First strike</b> — 24 hours read-only', strikes === 1) +
      rung(2, '<b>Second strike</b> — one week', strikes === 2) +
      rung(3, '<b>Third strike</b> — permanent', strikes >= 3) +
    '</ol>';
    const triggers = '<ul class="rekt-list">' +
      '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Acting like a bot.</b> Write-action velocity and duplicate/copypasta posting are watched. The thresholds sit far above what a real person does.</span></li>' +
      '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Burning a whole day of Send Calls in an hour.</b> If every call in your <b>full daily allowance</b> — the boosted number, however large it is — lands inside ' + (rules.callSpamWindowMin || 60) + ' minutes, that reads as spam. It only applies while that allowance is at least ' + (rules.callSpamMin || 3) + ', so nobody down to one or two calls a day is ever punished for using them.</span></li>' +
      '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>A ring of accounts on one connection pushing the same coin.</b> Everyone in the ring is restricted, and the buy-out costs double.</span></li>' +
    '</ul>';
    /* Both lists come from the server, whether or not a restriction is active. They are the same arrays
       restrictionOf() carries, so a person can read what read-only costs BEFORE they are in it — and the
       client never keeps its own copy to drift out of date. */
    const allowed = (r && r.allowed) || rules.readOnlyAllowed || [];
    const blocked = (r && r.blocked) || rules.readOnlyBlocked || [];
    const whileMuted = (allowed.length || blocked.length) ? '<div class="rekt-split">' +
      (allowed.length ? '<div><h5 class="rekt-h5">Still open to you</h5><ul class="rekt-yes">' +
        allowed.map(x => '<li><span aria-hidden="true">✓</span> ' + esc(String(x).replace(/&amp;/g, '&')) + '</li>').join('') +
      '</ul></div>' : '') +
      (blocked.length ? '<div><h5 class="rekt-h5">Paused</h5><ul class="rekt-no">' +
        blocked.map(x => '<li><span aria-hidden="true">✕</span> ' + esc(x) + '</li>').join('') +
      '</ul></div>' : '') +
    '</div>' : '';
    let live = '';
    if (r) {
      const until = r.permanent ? 'indefinitely' : 'until ' + new Date(r.until).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      live = '<div class="rekt-live" role="status">' +
        '<p><b>Your account is read-only ' + until + '.</b> ' + esc(r.reason) + '</p>' +
        '<p>Two ways out, and they are different in kind. You can buy and hold <b>$' + nf(Math.round(r.redeemUsd)) + '</b> of $SEND for <b>' +
        Math.max(1, Math.round(r.holdMs / 864e5)) + ' day' + (Math.round(r.holdMs / 864e5) === 1 ? '' : 's') + '</b> to lift it — sell before that hold is up and it returns, doubled. ' +
        'Or you can <a href="mailto:' + esc(r.appealEmail) + '">appeal to a person at ' + esc(r.appealEmail) + '</a>, which costs nothing, ever. ' +
        'We are not telling you to buy anything: the appeal is a real route and it is free.</p>' +
      '</div>';
    } else if (p) {
      live = '<div class="rekt-live" role="status"><p><b>You are on probation until ' +
        new Date(p.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '.</b> ' +
        'You bought your way out of a restriction; hold that $SEND until then and it clears for good. Sell more than 2% below the floor you set and the restriction returns, doubled.</p></div>';
    }
    const strikeLine = strikes > 0
      ? '<span class="rekt-state rekt-state-bad">' + strikes + ' strike' + (strikes === 1 ? '' : 's') + ' on record</span>'
      : '<span class="rekt-state rekt-state-safe">No strikes</span>';
    return '<section class="rekt-card' + (r ? ' is-live' : '') + '" aria-labelledby="rekt-mute-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-mute-h">🔇 Read-only mode</h4>' + strikeLine + '</div>' +
      '<p class="rekt-lede">Read-only pauses what you can make, not what you have already earned. <b>Strikes never expire</b> — the ladder only goes one way.</p>' +
      live + ladder + '<h5 class="rekt-h5">What puts you here</h5>' + triggers + whileMuted +
    '</section>';
  }

  // selling, dust, and the things that are revoked rather than drained
  function revokeCard(g) {
    const rules = g.rules || {};
    const floor = rules.holdFloorUsd || 100;
    const h = g.holder;
    const q = (label, usd, ok) => {
      if (ok == null) return '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">○</span><span><b>' + label + '</b> — not checked yet. Tap <b>Refresh holdings</b>.</span></li>';
      return '<li class="rekt-row ' + (ok ? 'rekt-row-ok' : 'rekt-row-bad') + '"><span class="rekt-dot" aria-hidden="true">' + (ok ? '✓' : '▲') + '</span><span><b>' + label + '</b> — ' +
        (usd == null ? 'value unknown' : '$' + Number(usd).toFixed(2)) + (ok ? ' · counting' : ' · under the $' + floor + ' floor, so it counts for nothing') + '.</span></li>';
    };
    const floorRows = h
      ? '<ul class="rekt-list">' + q('$SEND', h.sendUsd, h.sendQualifies) + q('$GWC', h.gwcUsd, h.gwcQualifies) + '</ul>'
      : '<p class="rekt-p">No holdings read yet — link a wallet and tap <b>Refresh holdings</b> to see where you stand against the floor.</p>';
    return '<section class="rekt-card" aria-labelledby="rekt-revoke-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-revoke-h">💔 Revoked, not drained</h4></div>' +
      '<p class="rekt-lede">Some things are not taken a percent at a time. They are simply gone the moment the thing they were based on stops being true.</p>' +
      '<ul class="rekt-list">' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Sell, and your Diamond Level resets to zero.</b> The streak is what the tier measures, so selling ends it — and the factor it was applying to your whole Holder Boost goes with it.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Sell out of either $SEND or $GWC entirely and the OG badge is revoked for good.</b> It cannot be re-earned. Unlinking the wallet only pauses it; relink and it returns.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Sell a community’s token and that community’s ' + (rules.communityMult || 10) + '× is revoked,</b> along with your standing in it. Membership is re-checked on-chain, not taken on trust.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Let a holdings check go stale and every holding-based boost pays 1× until it is re-read.</b> Not a punishment — the site will not quote a multiplier it has not verified.</span></li>' +
      '</ul>' +
      '<h5 class="rekt-h5">The $' + floor + ' floor — dust earns nothing</h5>' +
      '<p class="rekt-p">One rule for every token on the site: a bag counts at <b>$' + floor + ' or more</b>, priced live. Below that you hold dust, and dust earns no Diamond level, no Diamond factor, no no-sell streak, no community verification and no conviction standing. It exists because every holder reward here is measured in <b>time</b>, and one cent held for a year would otherwise have out-earned a real bag held for a month.</p>' +
      floorRows +
    '</section>';
  }

  // the call-side penalties: a shrinking allowance, and a rug on the record forever
  function callRiskCard(g) {
    const a = g.callAllowance, rules = g.rules || {};
    const rugged = g.rugged || 0;
    const state = rugged > 0
      ? '<span class="rekt-state rekt-state-bad">' + rugged + ' rugged call' + (rugged === 1 ? '' : 's') + ' on record</span>'
      : a ? '<span class="rekt-state rekt-state-safe">Limit ' + a.earned + '/' + (rules.callLimitBase || 5) + '</span>' : '';
    return '<section class="rekt-card' + (rugged > 0 ? ' is-live' : '') + '" aria-labelledby="rekt-call-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-call-h">📣 What bad calls cost</h4>' + state + '</div>' +
      '<p class="rekt-lede">A Send Call is permanent and public. It can never be deleted, and it keeps scoring long after you make it.</p>' +
      '<ul class="rekt-list">' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>A day of only duds costs you a call.</b> Your earned daily limit steps down by one, toward a floor of ' + (rules.callLimitMin || 1) + '. Land one call that doubles (' + (rules.callGoodX || 1) + 'x) and it steps back up, to a ceiling of ' + (rules.callLimitBase || 5) + '.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>If a call you made gets rugged, your daily limit drops by ' + (g.rugPenalty || 2) + ' at once</b> — and the call is marked RUGGED on your wall, permanently.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Calls left underwater feed decay</b> — ' + pctTxt((g.decay && g.decay.badCallPct) || 0.3) + ' a day each, up to ' + pctTxt((g.decay && g.decay.badCallMax) || 1.5) + ', but only on days you did not check in.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">▲</span><span><b>Using your whole daily allowance inside ' + (rules.callSpamWindowMin || 60) + ' minutes is read as spam</b> and puts the account read-only — but only while that allowance is at least ' + (rules.callSpamMin || 3) + '.</span></li>' +
      '</ul>' +
    '</section>';
  }

  // the participation gate — a read-only that is nobody's fault and is not a punishment
  function gateCard(g) {
    if (g.holderVerified) return '';
    const rules = g.rules || {}, floor = rules.holdFloorUsd || 100, days = rules.proofMinHoldDays || 7;
    const p = g.holderProof || {};
    return '<section class="rekt-card is-live" aria-labelledby="rekt-gate-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-gate-h">🪪 You are in read-only until you prove your bags</h4>' +
        '<span class="rekt-state rekt-state-warn">Not a strike</span></div>' +
      '<p class="rekt-lede">This is a different read-only from the one above and it is <b>not a penalty</b>. You can read everything; doing anything needs proof that you hold the coins.</p>' +
      '<ul class="rekt-list">' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">○</span><span>Hold at least <b>$' + floor + '</b> of <b>both</b> $SEND and $GWC.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">○</span><span>Have held them for at least <b>' + days + ' days</b>.</span></li>' +
        '<li class="rekt-row"><span class="rekt-dot" aria-hidden="true">○</span><span>Be a <b>net accumulator</b> of each — you have bought more than you have sold.</span></li>' +
      '</ul>' +
      '<p class="rekt-p">It is a read-only wallet check: a signature over a sentence, never a transaction. ' + esc(p.reason || '') + '</p>' +
    '</section>';
  }

  // the beta reset — everyone goes to zero, and it is better to know beforehand
  function betaCard(g) {
    const b = g.beta; if (!b || !b.endsAt) return '';
    const left = b.endsAt - Date.now();
    if (b.over || b.settled) {
      if (!(b.rank > 0)) return '';
      return '<section class="rekt-card" aria-labelledby="rekt-beta-h">' +
        '<div class="rekt-head"><h4 class="rekt-h" id="rekt-beta-h">🏅 Beta badge</h4><span class="rekt-state rekt-state-safe">#' + b.rank + '</span></div>' +
        '<p class="rekt-lede">You finished <b>#' + b.rank + '</b> in the beta with <b>' + nf(b.finalPoints || 0) + '</b>. The badge pays <b>+' + (b.badgeMult - 1) + '×</b> on everything, forever.</p>' +
      '</section>';
    }
    return '<section class="rekt-card" aria-labelledby="rekt-beta-h">' +
      '<div class="rekt-head"><h4 class="rekt-h" id="rekt-beta-h">🔄 The beta reset</h4>' +
        '<span class="rekt-state rekt-state-warn">' + fmtLeft(left) + ' left</span></div>' +
      '<p class="rekt-lede">When the beta ends, <b>every balance on the site goes to zero</b> — including yours. It is not a penalty and nobody is exempt; it is how the real game starts level.</p>' +
      '<p class="rekt-p">The standings are frozen at that moment and the <b>top ' + b.topN + '</b> keep a permanent badge worth <b>+' + (b.badgeMult - 1) + '×</b> on everything afterwards. Everyone’s final score is kept on record, so the reset can be checked.</p>' +
    '</section>';
  }


  /* ═══════════════════════════════════════════════════════════════════════════════════════════════════
     🗂️ YOUR RECORD — the state the site keeps on this account
     ═══════════════════════════════════════════════════════════════════════════════════════════════════
     Every figure here was already being tracked server-side and had no route to the screen. A site that
     scores you is obliged to show you the scorecard: what rank you hold, how many strikes are on record,
     how long you have held each coin, whether each bag clears the floor, how many wallets are linked, and
     what happens to all of it when the beta ends.

     A definition list, not a table: these are name/value pairs, a screen reader announces them as such,
     and they reflow to one column on a phone without a horizontal scroll. */
  function recDt(label, value, sub, tone) {
    return '<div class="rec' + (tone ? ' rec-' + tone : '') + '">' +
      '<dt class="rec-k">' + label + '</dt>' +
      '<dd class="rec-v">' + value + (sub ? '<span class="rec-sub">' + sub + '</span>' : '') + '</dd>' +
    '</div>';
  }
  function recordBlock(g) {
    const rules = g.rules || {}, h = g.holder, d = g.decay || {}, a = g.callAllowance, b = g.beta;
    const floor = rules.holdFloorUsd || 100;
    const days = (n) => n == null ? '—' : nf(Math.floor(n)) + (Math.floor(n) === 1 ? ' day' : ' days');
    const items = [];

    items.push(recDt('Rank', g.rank ? '#' + nf(g.rank) : '—', 'all-time Send Power'));
    items.push(recDt('Level', 'Lv ' + (g.level || 0), esc(g.title || '')));
    items.push(recDt('Send Power', nf(g.points || 0), signed(g.todayPoints || 0) + ' in 24h', (g.todayPoints || 0) < 0 ? 'bad' : ''));
    items.push(recDt('Paid at', '⚡ ' + (effMult(g).eff || 1).toFixed(2) + '×', 'every point, right now'));

    // the two things that decide whether a holding counts at all
    if (h) {
      items.push(recDt('$SEND held', h.sendUsd == null ? '—' : '$' + Number(h.sendUsd).toFixed(2),
        h.sendQualifies == null ? 'not checked' : h.sendQualifies ? 'clears the $' + floor + ' floor' : 'under the $' + floor + ' floor',
        h.sendQualifies === false ? 'bad' : h.sendQualifies ? 'ok' : ''));
      items.push(recDt('$GWC held', h.gwcUsd == null ? '—' : '$' + Number(h.gwcUsd).toFixed(2),
        h.gwcQualifies == null ? 'not checked' : h.gwcQualifies ? 'clears the $' + floor + ' floor' : 'under the $' + floor + ' floor',
        h.gwcQualifies === false ? 'bad' : h.gwcQualifies ? 'ok' : ''));
      items.push(recDt('No-sell streak', days(h.holdDays), 'the clock the Diamond tier reads'));
      items.push(recDt('$GWC streak', days(h.gwcDays), 'counts double toward the tier'));
      if (h.diamond) items.push(recDt('Diamond tier', (h.diamond.emoji || '💎') + ' Lv ' + h.diamond.level, esc(h.diamond.name || '')));
      items.push(recDt('Holdings read', h.fresh ? 'Fresh' : 'Stale', h.fresh ? 'boosts are live' : 'boosts pay 1× until re-read', h.fresh ? 'ok' : 'bad'));
    }

    if (a) {
      items.push(recDt('Call allowance', nf(a.used) + ' / ' + nf(a.limit), 'earned ' + a.earned + '/' + (rules.callLimitBase || 5) + ' × ' + nf(a.boost) + ' Diamond'));
    }
    if (g.rugged > 0) items.push(recDt('Rugged calls', nf(g.rugged), 'permanent, on your wall', 'bad'));

    items.push(recDt('Strikes', nf(g.strikes || 0), (g.strikes || 0) === 0 ? 'none — they never expire' : 'they never expire', (g.strikes || 0) > 0 ? 'bad' : 'ok'));
    items.push(recDt('Days away', nf(d.streak || 0), (d.streak || 0) > (d.graceDays || 2) ? 'past the free window' : 'grace is ' + (d.graceDays || 2) + ' days', (d.streak || 0) > (d.graceDays || 2) ? 'bad' : 'ok'));
    items.push(recDt('Wallets linked', nf(g.wallets || 0), (g.wallets || 0) === 0 ? 'boosts need at least one' : 'read-only, signature only', (g.wallets || 0) === 0 ? 'bad' : ''));
    items.push(recDt('Participation', g.holderVerified ? 'Verified' : 'Read-only', g.holderVerified ? 'you can do everything' : 'prove your bags to act', g.holderVerified ? 'ok' : 'bad'));

    if (g.og) items.push(recDt('OG badge', '🏅 ' + esc(g.ogTierName || ''), (g.ogBonus || 1) + '× — revoked if you sell out'));
    else if (g.ogRevoked) items.push(recDt('OG badge', 'Revoked', 'sold out of a coin — it cannot come back', 'bad'));

    const live = (g.communities || []).filter(c => c.status === 'live' && !c.demo);
    items.push(recDt('Communities', nf(live.length), live.length ? 'a flat ' + (rules.communityMult || 10) + '× while in ≥1' : 'no ' + (rules.communityMult || 10) + '× yet'));

    if (b && b.rank > 0) items.push(recDt('Beta finish', '#' + b.rank, 'badge pays +' + (b.badgeMult - 1) + '× forever', 'ok'));
    else if (b && b.endsAt && !b.over) items.push(recDt('Beta ends', fmtLeft(b.endsAt - Date.now()), 'every balance goes to zero', 'warn'));

    return '<section class="grec" aria-labelledby="rec-h">' +
      '<div class="grekt-head"><h3 class="gsub" id="rec-h">🗂️ Your record</h3>' +
      '<p class="grekt-lede">Everything the site keeps on this account, including the parts that count against you. Read from the chain and from your own ledger — nothing here is self-reported.</p></div>' +
      '<dl class="rec-grid">' + items.join('') + '</dl>' +
    '</section>';
  }

  function rektBlock(g) {
    return '<section class="grekt" aria-labelledby="rekt-h">' +
      '<div class="grekt-head">' +
        '<h3 class="gsub" id="rekt-h">💀 Rekt — how you lose it</h3>' +
        '<p class="grekt-lede">Everything above is a way to gain. This is the other half, with your own standing against each rule. Nothing here is hidden behind a click.</p>' +
      '</div>' +
      '<div class="grekt-grid">' +
        gateCard(g) + restrictCard(g) + decayCard(g) + callRiskCard(g) + revokeCard(g) + betaCard(g) +
      '</div>' +
    '</section>';
  }

  function boardList(lb, myUsername) {
    if (!lb || !lb.top || !lb.top.length) return '<p class="modal-note">No senders on the board yet — be the first! 🚀</p>';
    const medal = ['🥇', '🥈', '🥉'];
    let html = '<ol class="gboard">';
    for (const u of lb.top.slice(0, 6)) {
      const me = myUsername && u.username.toLowerCase() === myUsername.toLowerCase();
      const av = u.avatar_img ? window.avatarHTML(u.avatar_img, 'gb-ava') : '<span class="gb-ava" aria-hidden="true">' + esc(u.avatar) + '</span>';
      html += '<li class="' + (me ? 'gb-me' : '') + '">' +
        '<span class="gb-rank">' + (medal[u.rank - 1] || ('#' + u.rank)) + '</span>' + av +
        '<a class="gb-name" href="/u/' + encodeURIComponent(u.username) + '"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + '</a>' + (window.ogBadge ? ogBadge(u.og) : '') +
        (u.diamond && u.diamond.level > 0 ? '<span class="gb-dia" title="' + esc(u.diamond.name) + ' (Diamond Lv ' + u.diamond.level + ')">' + u.diamond.emoji + '</span>' : '') +
        '<span class="gb-lv">Lv ' + u.level + '</span>' +
        '<span class="gb-pts">' + compact(u.points) + '</span>' +
      '</li>';
    }
    html += '</ol>';
    // "you're X points from overtaking" — real numbers only
    if (lb.me && lb.top && lb.top.length) {
      const meRank = lb.me.rank;
      const ahead = lb.top.find(u => u.rank === meRank - 1);
      if (ahead && lb.me.points != null && ahead.points >= lb.me.points) {
        html += '<p class="modal-note" style="text-align:center; margin-top:0.5rem;">You\'re <b>#' + meRank + '</b> · <b>' + nf(ahead.points - lb.me.points + 1) + '</b> pts to overtake @' + esc(ahead.username) + ' 📈</p>';
      } else if (meRank > 6) {
        html += '<p class="modal-note" style="text-align:center; margin-top:0.5rem;">You\'re <b>#' + meRank + '</b> · keep sending to climb 📈</p>';
      }
    }
    return html;
  }

  /* =========================================================================
     SECTION 9 — CODEX (rules)
     ========================================================================= */
  /* ---------- The Arena: two boards behind one toggle ----------
     All time is the classic points board. Biggest Senders is THIS WEEK's race: what each account earned
     inside the week with any previous prize divided back out, the clock to the reset, last week's winners
     and the boost each of them drew. The choice is remembered per browser. */
  let _arenaTab = (() => { try { return localStorage.getItem('sendit_arena_tab') || 'all'; } catch { return 'all'; } })();
  function fmtLeftLong(ms) {
    if (!(ms > 0)) return 'any moment now';
    const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }
  // Switching boards repaints ONLY the Arena column: a full render() dropped keyboard focus, replayed every
  // count-up and rebuilt the loot log for a tab click. Focus returns to the chosen tab; arrows move between tabs.
  function wireArena() {
    const col = document.getElementById('arena-col'); if (!col) return;
    const tabs = Array.from(col.querySelectorAll('.arena-tab'));
    const pick = (key) => {
      _arenaTab = key === 'week' ? 'week' : 'all';
      try { localStorage.setItem('sendit_arena_tab', _arenaTab); } catch {}
      col.innerHTML = arenaBlock(leaderboard, competition, AUTH.user && AUTH.user.username);
      wireArena();
      const t = col.querySelector('.arena-tab[data-arena="' + _arenaTab + '"]'); if (t) t.focus();
    };
    tabs.forEach(b => {
      b.addEventListener('click', () => pick(b.dataset.arena));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const i = tabs.indexOf(b);
        const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        pick(tabs[j].dataset.arena);
      });
    });
  }
  function arenaBlock(lb, comp, myUsername) {
    const week = _arenaTab === 'week';
    const tab = (key, label, on) => '<button class="arena-tab' + (on ? ' is-on' : '') + '" type="button" role="tab" id="arena-tab-' + key + '" aria-selected="' + on + '" aria-controls="arena-panel" tabindex="' + (on ? '0' : '-1') + '" data-arena="' + key + '">' + label + '</button>';
    return '<div class="arena-head"><h3 class="gsub">🏟️ The Arena</h3>' +
      '<div class="arena-tabs" role="tablist" aria-label="Which board">' + tab('all', '👑 All time', !week) + tab('week', '🏆 Biggest Senders', week) + '</div></div>' +
      '<div id="arena-panel" role="tabpanel" aria-labelledby="arena-tab-' + (week ? 'week' : 'all') + '">' + (week ? compBoard(comp, myUsername) : boardList(lb, myUsername)) + '</div>';
  }
  function compRow(u, myUsername, ptsLabel) {
    const medal = ['🥇', '🥈', '🥉'];
    const me = myUsername && u.username && u.username.toLowerCase() === myUsername.toLowerCase();
    const av = u.avatar_img ? window.avatarHTML(u.avatar_img, 'gb-ava') : '<span class="gb-ava" aria-hidden="true">' + esc(u.avatar || '🚀') + '</span>';
    return '<li class="' + (me ? 'gb-me' : '') + '">' +
      '<span class="gb-rank">' + (medal[u.rank - 1] || ('#' + u.rank)) + '</span>' + av +
      '<a class="gb-name" href="/u/' + encodeURIComponent(u.username) + '"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + '</a>' + (window.ogBadge ? ogBadge(u.og) : '') +
      (u.boost ? '<span class="gb-prize" title="the boost this place won">' + u.boost + '×</span>' : '') +
      '<span class="gb-pts">' + ptsLabel + '</span>' +
    '</li>';
  }
  function compBoard(comp, myUsername) {
    if (!comp || !comp.week) return '<p class="modal-note">The Biggest Sender board is loading — or could not be reached. Refresh to try again.</p>';
    const n = comp.prize ? comp.prize.winners : 10, ladder = (comp.prize && comp.prize.ladder) || [];
    let html = '<p class="comp-clock">Week ' + esc(comp.week.key) + ' · resets in <b>' + fmtLeftLong(comp.week.msLeft) + '</b> · top <b>' + n + '</b> win a boost, biggest for #1</p>';
    if (!comp.top || !comp.top.length) html += '<p class="modal-note">Nobody has scored this week yet — every point you earn from now counts. 🚀</p>';
    else html += '<ol class="gboard">' + comp.top.filter(u => u.rank <= n).map(u => compRow(u, myUsername, compact(u.points))).join('') + '</ol>';
    if (comp.me) {
      html += '<p class="modal-note" style="text-align:center; margin-top:0.5rem;">' + (comp.me.rank
        ? 'You\'re <b>#' + comp.me.rank + '</b> this week with <b>' + nf(comp.me.points) + '</b> Send Power' + (comp.me.rank <= n ? ' — inside the prize places. Hold it. 🏆' : ' — top ' + n + ' wins a boost.')
        : 'You haven\'t scored this week yet — anything you earn from now counts.') + '</p>';
    }
    if (comp.myBoost && comp.myBoost.boost > 1) html += '<p class="comp-mine">🏆 Your prize from week ' + esc(comp.myBoost.wonIn || '') + ': <b>' + comp.myBoost.boost + '×</b> on everything you earn until ' + esc(new Date(comp.myBoost.until).toUTCString().slice(0, 16)) + ' 00:00 UTC. It does not count toward this week\'s standings — that\'s what keeps the race fair.</p>';
    if (comp.last && comp.last.winners && comp.last.winners.length) {
      html += '<h4 class="comp-last">Last week (' + esc(comp.last.key) + ') — winners and their prizes</h4>' +
        '<ol class="gboard gboard-compact">' + comp.last.winners.map(w => compRow(w, myUsername, compact(w.points))).join('') + '</ol>';
    }
    html += '<p class="comp-rules">Every Monday 00:00 UTC the board resets to zero and the game master pays the top ' + n + ' a Send Power boost by finishing place' +
      (ladder.length ? ' — <b>#1 gets ' + ladder[0] + '×</b>, down to ' + ladder[ladder.length - 1] + '× for #' + ladder.length + ' (' + ladder.map(b => b + '×').join(' · ') + '); a tie at the edge goes to whoever joined first —' : '') + ' for the whole of the next week. It adds on top of your Holder, OG, community and arcade boosts (boosts add, they don\'t multiply). A winner\'s prize never counts toward next week\'s standings, so the same people can\'t buy the board with it.</p>';
    return html;
  }
  // OG rules for the rules card. Dates are read from g.ogCampaign (the server's OG_LAUNCH + OG_TIER_END),
  // never typed here, so this card cannot drift from what checkOg() actually enforces.
  function ogRulesHtml(g) {
    const c = g && g.ogCampaign;
    const dt = (ms) => { try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
    const closes = (k) => (c && c.closes && c.closes[k]) ? ' (closes ' + dt(c.closes[k]) + ')' : '';
    const state = !c ? '' : !c.open ? ' <b>Every window has now closed; no new OG badges are granted.</b>' : c.tierNow ? ' <b>Right now the ' + esc((c.name && c.name[c.tierNow]) || '').toLowerCase() + ' window is open.</b>' : '';
    return '<p><b>🏅 OG — being early, three ways.</b> Hold <b>both $Send and $GWC</b>, bought from the market, and keep holding both: you earn a permanent OG badge and a Send Power multiplier. There is <b>one standard</b>; only when you got in changes the size. Windows are counted from each coin’s own launch, and your tier is the <b>lower</b> of your two coins, because the rule is that you held both.' + state + '</p>' +
      '<ul>' +
        '<li><b>🥇 Gold — 10×.</b> Bought both inside the first month' + closes('gold') + '.</li>' +
        '<li><b>🥈 Silver — 5×.</b> Bought both in the two months after gold closed' + closes('silver') + '.</li>' +
        '<li><b>🥉 Bronze — 3×.</b> Bought both in the nine months after silver closed' + closes('bronze') + '.</li>' +
        '<li><b>After that:</b> no badge, whatever you buy. Twelve 30-day months in all.</li>' +
        '<li><b>Two things disqualify a wallet, the same way in every window:</b> if it dumped its whole holding to nothing inside its own first month <b>and</b> it holds less today than it did at the end of that month, it earns nothing. A wallet that sold out but bought back past where it stood keeps its place.</li>' +
        '<li><b>Sell out of either coin entirely, ever, and the badge is revoked for good.</b> The badge follows your wallet: unlink it and the badge pauses until you relink. Everything is read from the chain, and a read that cannot be completed is retried rather than guessed — nobody loses a badge to an outage.</li>' +
      '</ul>';
  }
  /* The two community ladders, printed from the server's own tables. Before this, the community-XP rates
     appeared in NO file a signed-in user could reach — they existed only in the whitepaper, which lives at
     the repo root and is never served — and the conviction rates only in about.html. A person could
     therefore see their two bars move and have no way to learn what moved them. */
  // shared by rulesBlock and xpTable: print the server's constant, fall back only if the payload predates it
  const nCap = (v, fallback) => nf(v > 0 ? v : fallback);
  function xpTable(R) {
    const rows = [
      ['Join', 'join', 'join'],
      ['Post on its wall', 'wall_post', 'wall_post'],
      ['Comment there', 'wall_comment', 'wall_comment'],
      ['Get a reaction on your post there', 'wall_react_get', null],
      ['React to a post there', null, 'wall_react_give'],
      ['Send Call its token', 'send_call', 'send_call'],
    ];
    const c = R.commXp || {}, v = R.convXp || {};
    if (!Object.keys(c).length && !Object.keys(v).length) return '';
    const cell = (t, k) => (k && t[k] != null) ? '<b>+' + nf(t[k]) + '</b>' : '<span class="gxp-na">—</span>';
    return '<div class="gxp-table-wrap"><table class="gxp-table">' +
      '<caption>What moves each bar, per action</caption>' +
      '<thead><tr><th scope="col">Action in a community</th><th scope="col">🏆 Community XP</th><th scope="col">💎 Your conviction</th></tr></thead><tbody>' +
      rows.map(r => '<tr><th scope="row">' + r[0] + '</th><td>' + cell(c, r[1]) + '</td><td>' + cell(v, r[2]) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<p class="gxp-foot">Two separate ledgers. Community XP levels the <b>community</b> up; conviction levels <b>you</b> up inside it. ' +
      'A reaction pays community XP to the post’s author and conviction to whoever reacted. Your conviction is capped at <b>' + nCap(R.convDailyCap, 150) + '</b> a day per community, ' +
      'and it only moves when you <b>do</b> something — never for time served.</p></div>';
  }

  function rulesBlock(g) {
    const R = g.rules || {};
    return '<details class="grules">' +
      '<summary>📖 How Send Power works — points, levels, the Holder Boost &amp; Communities</summary>' +
      '<div class="grules-body">' +
        '<p><b>🪙 Send Power (points).</b> You earn points for doing things on the site — posting, reacting, commenting, following, tracking wallets, connecting your wallet, showing up daily, and swapping. Each action is capped per day so it stays fair for everyone — and everything that is not Send Call performance shares <b>one ceiling of ' + nCap(R.socialDayCap, 73762) + ' Send Power per rolling 24 hours</b>, whatever your boosts. No single award can exceed <b>' + nCap(R.eventCap, 73762) + '</b> either. Boosts pay in full on calls held in profit; that is the fast lane.</p>' +
        '<p><b>🏆 Levels — infinite, exponential.</b> Points level you up on an exponential curve: early levels are quick, and each new level costs about <b>10% more Power than the last</b>, forever — there is <b>no level cap</b> (Level 10 ≈ 1,150 · Level 50 ≈ 101,000 · Level 99 ≈ 13,000,000 · Level 100 ≈ 14,400,000 · and it keeps climbing). Level 100 makes you the <b>Biggest Sender 👑</b>; beyond that lie <b>Send Deity ✨</b>, <b>Eternal Sender ♾️</b> and higher.</p>' +
        '<p><b>🔥 Holder Boost.</b> Hold $SEND / $GWC and <b>every</b> point you earn is multiplied. Your boost is <b>1 + (Supply boost × Diamond boost)</b>:</p>' +
        '<ul>' +
          '<li><b>📊 Supply boost — +10× for each 1% of supply you hold, and $GWC counts ×3.</b> Your %SEND and %GWC add together, with <b>$GWC weighted 3×</b> (so 1% of $GWC ≈ +30×, 1% of $SEND ≈ +10×) — $GWC is the Generational Wealth Coin, so holding it moves your Power the most.</li>' +
          '<li><b>💎 Diamond boost — for holding without ever selling, and holding $GWC counts double.</b> The longer you hold, the higher your <b>Diamond Level</b> climbs through 11 tiers (Paper Grip → … → 👑 Immortal Diamond, 0 days up to ~2 years). <b>Every day you hold $GWC counts as two</b> toward your level, so diamond-handing $GWC levels you up twice as fast. Each tier multiplies your supply boost further — <b>up to ×100</b> at Immortal Diamond.</li>' +
          '<li>The two combine as <b>1 + (supply × diamond)</b>, with <b>no cap</b> — big bags held long enough scale your boost without limit.</li>' +
          '<li>Your Diamond Level and boost <b>reset the moment you sell</b> — that\'s what makes it a <i>diamond hands</i> reward. They also pause if we haven\'t re-checked your holdings in a day; open your profile or tap <b>Refresh holdings</b> to keep them live.</li>' +
        '</ul>' +
        '<p><b>🏘️ Communities &amp; the 10× multiplier.</b> Rally around any token by starting or joining its community (paste a contract to start one — it goes live at <b>10 verified holder slots</b>, each one a wallet that really holds the token). While you’re in <b>≥1 live community</b>, a flat <b>10×</b> community boost joins your stack — <b>+9×</b> on top of your base, on every post, reaction and comment inside the community too. Being in five communities is still one 10× (it doesn’t stack with itself). <b>Boosts add, they don’t multiply:</b> every boost contributes what it pays above 1×, so OG Gold 10× and a community 10× together are 19×, not 100×. Anyone can read a live community’s wall; to post you connect a wallet and confirm you hold its token, and participating raises your <b>member level</b> while levelling the community up.</p>' +
        '<ul>' +
          '<li><b>🪙 Real holders only:</b> to start, join, or post in a community you must <b>hold that token</b> (verified on-chain from a linked wallet). Sell or move it out and your 10× for that community is revoked.</li>' +
          '<li><b>🏆 Community level</b> climbs as its <b>distinct members</b> stay active — posting and reacting on the community wall. Same exponential curve as your own level, and <b>daily-capped</b> so one person cannot farm it: any single member can push at most <b>' + nCap(R.commXpPerUserDay, 250) + ' community XP a day</b> into one community, however much they post.</li>' +
          xpTable(R) +
          '<li><b>💎 Your member level</b> (your “conviction”) is <b>per community</b>, and it moves <b>only when you do something there</b> — joining, posting, commenting, reacting, making a Send Call for that token, voting on a proposal. It never rises for time alone: being a member for a year and saying nothing leaves it where it started. It shows as a badge next to that token in the <b>Conviction Plays</b> section of your public wall, and it needs a <b>verified holder slot</b> — sell the token and it stops accruing.</li>' +
          '<li><b>👑 Founder bonus:</b> whoever starts a community and grows it to <b>10 verified holder slots</b> — not 10 taps of Join — earns a one-time bonus when it flips live. It is paid once per <b>account</b>, ever, and it shares the same rolling 24h ceiling as everything else, so a day already spent grinding can leave less of it to pay out.</li>' +
        '</ul>' +
        ogRulesHtml(g) +
        '<p><b>📣 Send Calls — what one call can pay.</b> A call pays three ways: an opening award (bigger for a bigger on-chain buy), a milestone for each whole X it hits — the rungs rise in a <b>straight line</b>, not with the multiple, so a 50x rung is worth about six of the first rung rather than fifty, and a <b>diamond-hands hold bonus</b> that compounds the longer and higher it stays in profit. Everything one call ever pays you comes out of <b>one lifetime budget — the Send Power it takes to reach Level 70 (' + nCap(R.callBudget, 737627) + ')</b> — and that budget is carved on purpose: the opening award may take at most a tenth, the ladder at most three tenths, and <b>at least 60% is reserved for holding in profit</b>. Your hold bonus also accrues faster when the people who Sent It on your call are in profit too: <b>+10% per Sender in the green, up to 3×</b>. Level 100 is about twenty perfect calls; no single call can carry anyone to the top.</p>' +
        '<p><b>🏆 Biggest Sender — a fresh race every week.</b> Every Monday at 00:00 UTC the Biggest Sender board resets to zero, so the week\'s standings are only what you earned inside it. When the week ends, the game master pays the <b>top 10</b> a Send Power boost <b>by finishing place</b> — #1 gets 5×, then 4.5×, 4×, 3.5×, 3×, 2.5×, 2×, 1.75×, 1.5× and 1.25× for #10; exactly ten prizes, a tie at the edge to whoever joined first — on everything they earn for the whole of the following week, added on top of their other boosts. The board ranks <b>base points</b>: what you did, with every boost (Holder, OG, community, Rocket Run) and any prize taken out, so a whale, an OG and a newcomer race on the same footing. Toggle the Arena to 🏆 Biggest Senders to watch it.</p>' +
        '<p><b>🔒 Fair &amp; safe.</b> Your holdings, and whether you\'ve sold, are read straight from the blockchain and re-verified — so no one can fake diamond hands to cheat their level. Connecting your wallet is a <b>free signature — never a transaction</b>, and this site can never touch or move your funds.</p>' +
      '</div>' +
    '</details>';
  }

  /* ---------- return / refresh celebration (only real increases fire, once each) ---------- */
  function celebrate(g) {
    let seen = null;
    try { seen = JSON.parse(localStorage.getItem('sendit_seen') || 'null'); } catch {}
    const dia = g.holder && g.holder.diamond ? g.holder.diamond.level : 0;
    const cur = { level: g.level || 0, dia: dia, mult: Math.round((g.multiplier || 1) * 100) / 100 };
    if (seen) {
      if (cur.level > seen.level) {
        if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 70, emojiRatio: 0.5 });
        if (window.sendToast) sendToast('🎉 LEVEL UP → Level ' + cur.level + '!');
      } else if (cur.dia > seen.dia && g.holder && g.holder.diamond) {
        if (window.sendConfetti) sendConfetti(innerWidth / 2, innerHeight / 3, { count: 50, emojiRatio: 0.5 });
        if (window.sendToast) sendToast(g.holder.diamond.emoji + ' DIAMOND TIER UP → ' + g.holder.diamond.name + '!');
      }
    }
    try { localStorage.setItem('sendit_seen', JSON.stringify(cur)); } catch {}
  }

  /* ---------- render ---------- */
  // Send Call daily allowance — how many calls you have today, your earned base, and the diamond boost
  function callAllowanceBlock(g) {
    const a = g.callAllowance; if (!a) return '';
    const usedPct = a.limit > 0 ? Math.min(100, Math.round(a.used / a.limit * 100)) : 0;
    let resetTxt = '';
    if (a.remaining <= 0 && a.resetAt) {
      const mins = Math.max(1, Math.ceil((a.resetAt - Date.now()) / 60000));
      resetTxt = mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
    }
    const boostLine = a.diamondLevel > 0
      ? '💎 Diamond Lv ' + a.diamondLevel + ' → your daily limit is boosted <b>×' + a.boost + '</b> (2<sup>' + a.diamondLevel + '</sup>)'
      : 'Hold $SEND / $GWC to climb Diamond levels — each level <b>doubles</b> your daily Send Calls (×2 per level).';
    return '<div class="g-callcap">' +
      '<div class="gcc-head"><span class="gcc-title">📣 Send Calls today</span>' +
        '<span class="gcc-count"><b>' + a.used + '</b> / ' + a.limit + '</span></div>' +
      '<div class="gcc-bar"><span style="width:' + usedPct + '%"></span></div>' +
      '<p class="gcc-note">' + (a.remaining > 0
        ? '<b>' + a.remaining + '</b> call' + (a.remaining === 1 ? '' : 's') + ' left. Base limit <b>' + a.earned + '/5</b> — land winners (a call that doubles, 1x+) to earn +1/day; duds shrink it toward 1.'
        : 'All used up — your next call frees up in <b>' + (resetTxt || 'a bit') + '</b>. Land winners (1x+) to earn a bigger daily limit.') + '</p>' +
      '<p class="gcc-boost">' + boostLine + '</p>' +
    '</div>';
  }
  function render(g, lb) {
    stopRafs();
    _lg = g;
    const mult = effMult(g).eff; // the Quest Board must quote the SAME multiplier the hero shows and the server pays (Holder × OG × Community)
    dash.innerHTML =
      heroBlock(g) +
      objectiveBar(g) +
      kpiStrip(g) +
      xpBar(g) +
      ogBlock(g) +
      communityBlock(g) +
      equationStrip(g) +
      boostEngine(g) +
      callAllowanceBlock(g) +
      lootLog(g) +
      '<div class="gdash-cols">' +
        '<div class="gcol"><h3 class="gsub">🗺️ Quest Board</h3>' + earnList(g.perAction, mult, g.rules) + dayCapLine(g) + '</div>' +
        '<div class="gcol" id="arena-col">' + arenaBlock(lb, competition, AUTH.user && AUTH.user.username) + '</div>' +
      '</div>' +
      rektBlock(g) +
      recordBlock(g) +
      rulesBlock(g);

    // clickable quest rows that open the right section / page
    dash.querySelectorAll('[data-earn]').forEach(btn => btn.addEventListener('click', () => {
      const t = EARN_ACTION[btn.dataset.earn] || {};
      if (t.open) { const s = document.getElementById(t.open); if (s) { s.open = true; s.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } }
      else if (t.scroll) {
        const s = document.getElementById(t.scroll);
        if (s) { s.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); const f = t.focus && document.getElementById(t.focus); if (f) setTimeout(() => { try { f.focus(); } catch {} }, reducedMotion() ? 0 : 450); }
      }
    }));
    // quest-rule ⓘ toggles: one open at a time; state exposed via aria-expanded; Escape / a click elsewhere closes
    const closeTips = () => dash.querySelectorAll('.gearn-li.is-open, .ll-li.is-open').forEach(o => { o.classList.remove('is-open'); const ob = o.querySelector('.ge-info, .ll-info'); if (ob) ob.setAttribute('aria-expanded', 'false'); });
    dash.querySelectorAll('.ge-info, .ll-info').forEach(b => b.addEventListener('click', () => {
      const li = b.closest('.gearn-li, .ll-li');
      const open = !li.classList.contains('is-open');
      closeTips();
      li.classList.toggle('is-open', open);
      b.setAttribute('aria-expanded', String(open));
      if (!open) b.blur(); // the focus-within hover rule must not keep showing a tip the user just closed
    }));
    if (!dash._tipDismiss) {
      dash._tipDismiss = true;
      dash.addEventListener('click', e => { if (!e.target.closest('.gearn-li, .ll-li')) closeTips(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTips(); });
    }
    wireLootToggle(); // achievement-log window toggle (Today resets every 24h · All time)
    wireArena();
    dash.querySelectorAll('.js-refresh').forEach(b => b.addEventListener('click', doRefresh));
    dash.querySelectorAll('.js-connect').forEach(b => b.addEventListener('click', () => {
      const sec = document.getElementById('sec-security'); if (sec) { sec.open = true; sec.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }); }
      if (window.sendToast) sendToast('Link a wallet under Security, then hit Refresh 🔗');
    }));

    animate(dash);
    celebrate(g);
  }

  async function doRefresh() {
    const btns = Array.from(dash.querySelectorAll('.js-refresh'));
    btns.forEach(b => { b.disabled = true; b.dataset.orig = b.textContent; b.textContent = 'Reading the chain… ⛓️'; });
    try {
      const g = await api('/api/gamify/refresh', { method: 'POST' });
      let lb; try { lb = await (await fetch('/api/leaderboard', { credentials: 'same-origin' })).json(); } catch { lb = leaderboard; }
      leaderboard = lb;
      try { competition = await (await fetch('/api/competition', { credentials: 'same-origin' })).json(); } catch {}
      render(g, lb); // render() runs celebrate() → confetti only on a real level/tier increase
      if (window.sendToast) sendToast(g.holderLive && g.holderLive.multiplier > 1 ? ('Holder Boost live: ' + g.holderLive.multiplier.toFixed(2) + '× 🔥') : 'Holdings refreshed ✓');
    } catch (e) {
      btns.forEach(b => { b.disabled = false; if (b.dataset.orig) b.textContent = b.dataset.orig; });
      if (window.sendToast) sendToast('⚠️ ' + (e.message || 'refresh failed'));
    }
  }

  // re-render when auth becomes ready / changes on the profile page
  window.loadGamify = load;
  if (window.AUTH && AUTH.user) load();
  document.addEventListener('auth:change', e => { if (e.detail) load(); });
})();
