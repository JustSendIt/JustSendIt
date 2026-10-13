/* ===== Sender search: finds public walls — and tokens by address — keyboard accessible =====
   A search box over a list of LINKS, not a combobox: the results are real <a href> that take DOM focus, and
   a combobox promises aria-activedescendant/option semantics this never had (a reader in forms mode heard
   nothing when results landed, and an option that was really a link). So the box is a plain searchbox that
   names the results panel with aria-controls, and every result set — including "no matches" — is spoken
   through the shared live region. A pasted address (a whole one, or 0x and the start of one) finds the tokens the
   site knows at it (their dashboard, their community), a pool's token, or — for a whole address it has no record
   of — a scan of it and the Wallet Tracker with it filled in. The address is drawn on one line, shortened to fit. */
(function () {
  // attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // an address on one line: as much as fits, then …, then its last 4 (.addr-fit in styles.css)
  const addrFit = (a) => '<code class="addr-fit" title="' + esc(a) + '"><span class="sr-only">' + esc(a) + '</span><span class="addr-head" aria-hidden="true">' + esc(a.slice(0, -4)) + '</span><span class="addr-tail" aria-hidden="true">' + esc(a.slice(-4)) + '</span></code>';
  const ADDR = /^(?:0x)?([0-9a-f]{40})$/i, ADDR_START = /^0x([0-9a-f]{4,39})$/i;
  // the rows an address answer gives: a token's dashboard (and its community), a pool's token, or — a whole address the
  // site has no record of — a scan of it and the Wallet Tracker with it filled in
  function addrRows(r, a) {
    const rows = [];
    for (const t of (r && r.tokens) || []) {
      const pool = t.via === 'pool';
      rows.push({ href: '/newpairs.html?scan=' + encodeURIComponent(pool ? a : t.token), ico: '🪙', name: '$' + t.symbol + ' · ' + t.name,
        sub: pool ? 'The pool of $' + t.symbol + ' — its token dashboard' : 'Token dashboard', addr: pool ? a : t.token });
      if (t.community) rows.push({ href: '/community.html?id=' + encodeURIComponent(t.community.id), ico: '🏘️', name: '$' + t.symbol + ' community',
        sub: t.community.status === 'live' ? 'Live community' : 'Community, still forming' });
    }
    if (r && r.full && !rows.length) {
      rows.push({ href: '/newpairs.html?scan=' + encodeURIComponent(a), ico: '🔎', name: 'Scan this address', sub: 'Reads the chain for a token or pool at it', addr: a });
      rows.push({ href: '/tracker.html#track=' + encodeURIComponent(a), ico: '👛', name: 'Track it as a wallet', sub: 'Opens the Wallet Tracker with it filled in', addr: a });
    }
    return rows;
  }

  function init() {
    const slot = document.getElementById('nav-search-slot');
    if (!slot) return;
    slot.className = 'nav-search';
    slot.innerHTML =
      '<span class="s-icon" aria-hidden="true">🔎</span>' +
      '<input type="search" id="sender-search" placeholder="find Senders or Scan Tokens" autocomplete="off" spellcheck="false" ' +
      'aria-controls="sender-search-results" aria-describedby="sender-search-help" aria-label="Search for senders, or paste a token, pool or wallet address">' +
      '<span class="sr-only" id="sender-search-help">Matching senders and tokens are listed below the box as you type; press Down arrow to move into the list.</span>';
    const input = slot.querySelector('input');
    let drop = null, timer = null, hits = [], sel = -1;

    const say = (t) => { if (typeof window.announce === 'function') window.announce(t); };
    function close() {
      if (drop) { drop.remove(); drop = null; }
      sel = -1;
    }
    function open(users, q, addr) {
      close();
      drop = document.createElement('div');
      drop.className = 'search-drop';
      drop.id = 'sender-search-results';
      drop.setAttribute('aria-label', 'Search results');
      hits = users;
      const am = ADDR.exec(q) || ADDR_START.exec(q);
      const rows = am ? addrRows(addr || { full: ADDR.test(q), tokens: [] }, '0x' + am[1].toLowerCase()) : [];   // no answer: a whole address can still be scanned or tracked
      for (const r of rows) {
        const t = document.createElement('a');
        t.className = 'search-hit search-tok';
        t.href = r.href;
        t.innerHTML = '<span class="h-ava" aria-hidden="true">' + r.ico + '</span>' +
          '<div><div class="h-name">' + esc(r.name) + '</div><div class="h-sub">' + esc(r.sub) + '</div>' + (r.addr ? '<div class="h-addr">' + addrFit(r.addr) + '</div>' : '') + '</div>';
        drop.appendChild(t);
      }
      if (!users.length && !rows.length) {
        const msg = am ? (ADDR.test(q) ? 'Nothing found at that address' : 'No token on record starts with ' + q + ' — paste the whole address to scan it') : 'No senders match "' + q + '"';
        drop.innerHTML = '<div class="search-empty">' + (am && !ADDR.test(q) ? 'No token on record starts with ' + addrFit(q) + ' — paste the whole address to scan it' : esc(msg)) + ' 👻</div>';   // a partial address stays on one line
        say(msg);
      } else if (!users.length) {
        say(rows.length + (rows.length === 1 ? ' result' : ' results') + ' for this address — press Down arrow to browse');
      } else {
        say((rows.length ? rows.length + users.length + ' results' : users.length + (users.length === 1 ? ' sender matches' : ' senders match')) + ' — press Down arrow to browse');
        for (const u of users) {
          const a = document.createElement('a');
          a.className = 'search-hit';
          a.href = '/u/' + encodeURIComponent(u.username);
          const ava = u.avatar_img
            ? window.avatarHTML(u.avatar_img, 'h-ava')
            : '<span class="h-ava" aria-hidden="true">' + esc(u.avatar) + '</span>';
          a.innerHTML = ava +
            '<div><div class="h-name"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + (window.ogBadge ? ogBadge(u.og, 'in-link') : '') + '</div>' +
            '<div class="h-sub">' + (u.bio ? esc(u.bio) : (u.posts + ' posts · ' + u.followers + ' followers')) + '</div></div>';
          drop.appendChild(a);
        }
      }
      slot.appendChild(drop);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { close(); return; }
      timer = setTimeout(async () => {
        try {
          const j = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
          if (input.value.trim() === q) open(j.users || [], q, j.addr || null);
        } catch {}
      }, 220);
    });
    // keys while the text box is focused: ArrowDown enters the list, Enter opens the top hit
    input.addEventListener('keydown', e => {
      if (!drop) return;
      const links = [...drop.querySelectorAll('.search-hit')];
      if (e.key === 'ArrowDown' && links.length) { e.preventDefault(); e.stopPropagation(); links[0].focus(); }
      else if (e.key === 'Escape') { close(); input.blur(); }
      else if (e.key === 'Enter' && links.length) { e.preventDefault(); if (window.SFX) SFX.play('nav'); links[0].click(); }   // the scripted click is not a real one, so the generic layer would stay quiet
    });
    // keys while a result is focused: move between results, open the focused one
    slot.addEventListener('keydown', e => {
      const links = drop ? [...drop.querySelectorAll('.search-hit')] : [];
      const idx = links.indexOf(document.activeElement);
      if (idx < 0) return; // input-focused keys are handled above
      if (e.key === 'ArrowDown') { e.preventDefault(); (links[idx + 1] || links[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (links[idx - 1] || input).focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (window.SFX) SFX.play('nav'); links[idx].click(); }
      else if (e.key === 'Escape') { close(); input.focus(); }
    });
    document.addEventListener('click', e => { if (!slot.contains(e.target)) close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
