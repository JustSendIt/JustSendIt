/* ===== Sender search: finds public walls — and tokens by address — keyboard accessible =====
   A search box over a list of LINKS, not a combobox: the results are real <a href> that take DOM focus, and
   a combobox promises aria-activedescendant/option semantics this never had (a reader in forms mode heard
   nothing when results landed, and an option that was really a link). So the box is a plain searchbox that
   names the results panel with aria-controls, and every result set — including "no matches" — is spoken
   through the shared live region. A pasted address (a whole one, or 0x and the start of one) finds the tokens the
   site knows at it (their dashboard, their community), a pool's token, or — for a whole address it has no record
   of — a scan of it and the Wallet Tracker with it filled in. The address is drawn on one line, shortened to fit.
   A word (2+ characters) also finds TOKENS by name or symbol on Robinhood Chain — every one GeckoTerminal, Dexscreener or the
   site has, traded today or not (owner, 2026-10-14) — each with its market cap, 24-hour volume and holders, under the senders.
   The senders come first and at once; the tokens follow from /api/search/tokens, and holders still being read are filled in
   by one more ask a few seconds later, in place, so a reader already in the list keeps their place. */
(function () {
  // attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  // an address on one line: as much as fits, then …, then its last 4 (.addr-fit in styles.css)
  const addrFit = (a) => '<code class="addr-fit" title="' + esc(a) + '"><span class="sr-only">' + esc(a) + '</span><span class="addr-head" aria-hidden="true">' + esc(a.slice(0, -4)) + '</span><span class="addr-tail" aria-hidden="true">' + esc(a.slice(-4)) + '</span></code>';
  const ADDR = /^(?:0x)?([0-9a-f]{40})$/i, ADDR_START = /^0x([0-9a-f]{4,39})$/i;
  // dollars the way a token list shows them: < $0.01, $0.42, $8,120, $39.1K, $2.4M
  const usd = (n) => n == null ? null : (n > 0 && n < 0.01) ? '< $0.01' : n < 1 ? '$' + Number(n).toFixed(2) : n < 1e4 ? '$' + Math.round(n).toLocaleString('en-US') : n < 1e6 ? '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : n < 1e9 ? '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  const capWord = (k) => (k === 'fdv' ? 'FDV ' : k === 'either' ? 'MC/FDV ' : 'MC ');   // 'either': the radar kept a market cap, or the FDV when that was all it had
  // one token row's figures, each with its word (never a bare number, never colour alone)
  function tokStats(t, pending) {
    const mc = t.marketCap == null ? 'market cap unknown' : capWord(t.marketCapKind) + usd(t.marketCap);
    const vol = t.volume24h == null ? 'volume unknown' : t.volume24h === 0 ? 'no trades in 24h' : 'Vol 24h ' + usd(t.volume24h);
    const hold = t.holders != null ? Number(t.holders).toLocaleString('en-US') + (t.holders === 1 ? ' holder' : ' holders')
      : t.holdersKnown ? 'holders unknown' : pending ? 'holders: reading…' : 'holders not read yet';
    return mc + ' · ' + vol + ' · ' + hold;
  }
  const tokTitle = (t) => (t.symbol ? '$' + t.symbol : 'Unnamed token') + (t.name ? ' · ' + t.name : '') + (t.nameCut ? ' (name shortened here — its dashboard shows it whole)' : '');
  const TOK_NOTE = 'Includes tokens that are not trading. Prices and volume from Dexscreener and GeckoTerminal (FDV where only the fully diluted value is known); holders from the chain, GoPlus or the site’s last scan.';
  // the same query rules as the server: a leading $ and extra spaces go; 2+ characters; 0x… or 40 hex characters is an address
  const normQ = (q) => String(q || '').normalize('NFC').replace(/^\s*\$/, '').replace(/\s+/g, ' ').trim();
  const isNameQuery = (q) => { const n = normQ(q); return Array.from(n).length >= 2 && !/^0x/i.test(n) && !/^[0-9a-f]{40}$/i.test(n); };
  // what an answer can honestly say about itself
  function tokFacts(ans, q) {
    const items = (ans && ans.items) || [];
    const missing = ans && Array.isArray(ans.partial) && ans.partial.length ? ans.partial.join(' and ') : '';
    return {
      items,
      count: items.length ? ((ans.more || ans.total > items.length) ? 'first ' + items.length : String(items.length)) : '',
      partialLine: missing ? missing + ' could not be asked just now — this list may be missing tokens.' : '',
      moreLine: ans && ans.more ? 'These are the first matches — type more of the name to narrow it.' : '',
      empty: ans && ans.tooShort ? 'Type 2 or more letters to search tokens by name.'
        : ans && ans.error ? ans.error
        : missing ? 'Nothing found, but ' + missing + ' could not be asked just now — try again in a moment.'
        : 'No token whose name or symbol contains “' + q + '” was found on Robinhood Chain.',
    };
  }
  // the search, as the pages ask it: a refused or failed ask becomes a sentence, never the server's raw words
  async function askTokenSearch(q) {
    try {
      const r = await fetch('/api/search/tokens?q=' + encodeURIComponent(q), { credentials: 'same-origin' });
      if (r.status === 429) { const ra = Number(r.headers.get('Retry-After')) || 15; return { items: [], total: 0, pending: false, error: 'Too many token searches in the last minute — trying again in a few seconds.', retryAfter: ra }; }
      const j = await r.json();
      if (!r.ok) return { items: [], total: 0, pending: false, error: 'Could not search tokens just now.' };
      return j;
    } catch { return { items: [], total: 0, pending: false, error: 'Could not search tokens just now.' }; }
  }
  /* shared with the Scanner (scanner.js) and the DEX List (newpairs.js): the "Tokens named …" block they show on the page,
     built from the same /api/search/tokens answer, each row opening that token's dashboard */
  window.TokenNames = {
    stats: tokStats, facts: tokFacts, isNameQuery, normQ, ask: askTokenSearch,
    blockHTML(ans, q) {
      const f = tokFacts(ans, q);
      const head = '<h3 class="np-named-h">Tokens named “' + esc(q) + '” on Robinhood Chain' + (f.count ? ' <span class="np-named-n">' + esc(f.count) + '</span>' : '') + '</h3>';
      const lines = (f.partialLine ? '<p class="np-named-none is-warn">⚠️ ' + esc(f.partialLine) + '</p>' : '') + (f.moreLine ? '<p class="np-named-none">' + esc(f.moreLine) + '</p>' : '');
      if (!f.items.length) return head + '<p class="np-named-none">' + esc(f.empty) + '</p>';
      return head + lines + '<ul class="np-named-list">' + f.items.map((t) =>
        '<li><a class="np-named-row" data-token="' + esc(t.token) + '" href="/newpairs.html?scan=' + encodeURIComponent(t.token) + '" data-tip="Opens this token&#39;s dashboard: its chart, holders and risk checks">' +
          (t.logo ? '<img class="np-named-logo" src="' + esc(t.logo) + '" alt="" width="36" height="36" loading="lazy" decoding="async">' : '<span class="np-named-logo" aria-hidden="true">🪙</span>') +
          '<span class="np-named-main"><b class="np-named-name">' + esc(tokTitle(t)) + '</b>' +
          '<span class="np-named-stats">' + esc(tokStats(t, ans.pending)) + '</span>' + addrFit(t.token) + '</span></a></li>').join('') + '</ul>' +
        '<p class="np-named-note">' + esc(TOK_NOTE) + '</p>';
    },
    // holders read since: the figures change in place, so nothing moves under a reader; a failed or empty re-ask changes nothing
    refill(box, ans, sel) {
      if (!box || !ans || ans.error || !Array.isArray(ans.items) || !ans.items.length) return;
      for (const t of ans.items) { const el = box.querySelector((sel || '.np-named-row') + '[data-token="' + t.token + '"] ' + (sel ? '.h-stats' : '.np-named-stats')); if (el) el.textContent = tokStats(t, !!ans.pending); }
    },
    // ask again while holders are still being read: 3.5 s, 7 s, 14 s, then stop (a row still unread then says "not read yet")
    follow(q, live, onAns) {
      let n = 0;
      const step = () => setTimeout(async () => {
        if (!live()) return;
        const k = await askTokenSearch(q);
        if (!live() || k.error || !Array.isArray(k.items) || !k.items.length) return;
        n++;
        onAns(n >= 3 ? Object.assign({}, k, { pending: false }) : k);
        if (k.pending && n < 3) step();
      }, 3500 * Math.pow(2, n));
      step();
    },
  };
  // a token logo that does not load becomes the coin, not a broken-image icon
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.classList || !(t.classList.contains('np-named-logo') || t.classList.contains('h-logo'))) return;
    const sp = document.createElement('span');
    sp.className = t.classList.contains('h-logo') ? 'h-ava' : 'np-named-logo'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = '🪙';
    t.replaceWith(sp);
  }, true);
  function tokRow(t, pending) {
    const a = document.createElement('a');
    a.className = 'search-hit search-tok';
    a.href = '/newpairs.html?scan=' + encodeURIComponent(t.token);
    a.dataset.token = t.token;
    const ico = t.logo ? '<img class="h-ava h-logo" src="' + esc(t.logo) + '" alt="" width="34" height="34" loading="lazy" decoding="async">' : '<span class="h-ava" aria-hidden="true">🪙</span>';
    a.innerHTML = ico + '<div><div class="h-name">' + esc(tokTitle(t)) + '</div><div class="h-sub h-stats">' + esc(tokStats(t, pending)) + '</div><div class="h-addr">' + addrFit(t.token) + '</div></div>';
    return a;
  }
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
      'aria-controls="sender-search-results" aria-describedby="sender-search-help" aria-label="Search senders, or tokens by name, symbol or address">' +
      '<span class="sr-only" id="sender-search-help">Matching senders, and tokens by name, are listed below the box as you type; press Down arrow to move into the list.</span>';
    const input = slot.querySelector('input');
    let drop = null, timer = null, hits = [], sel = -1;

    const say = (t) => { if (typeof window.announce === 'function') window.announce(t); };
    function close() {
      if (drop) { drop.remove(); drop = null; }
      sel = -1;
    }
    /* the token half: answers kept per word (going back to a word reuses its answer), an error shown but never kept, the
       holders filled in place by up to three follow-ups */
    const tokAnswers = new Map();   // q -> answer
    let tokErr = null, tokDebounce = null, tokRetry = null, lastUsers = [], lastRows = [];
    const current = () => input.value.trim();
    function tokSection(q) {   // a heading, then the rows (or what is happening), then what the figures are
      const box = document.createElement('div');
      box.className = 'search-toks';
      const ans = tokAnswers.get(q) || (tokErr && tokErr.q === q ? tokErr.ans : null);
      const f = tokFacts(ans, q);
      box.innerHTML = '<div class="search-sec">Tokens on Robinhood Chain' + (f.count ? ' <span class="search-sec-n">' + esc(f.count) + '</span>' : '') + '</div>';
      if (!ans) { box.insertAdjacentHTML('beforeend', '<div class="search-empty search-wait">Searching tokens named “' + esc(q) + '”…</div>'); return box; }
      if (!f.items.length) { box.insertAdjacentHTML('beforeend', '<div class="search-empty">' + esc(f.empty) + '</div>'); return box; }
      if (f.partialLine) box.insertAdjacentHTML('beforeend', '<div class="search-note is-warn">⚠️ ' + esc(f.partialLine) + '</div>');
      for (const t of f.items) box.appendChild(tokRow(t, ans.pending));
      const note = document.createElement('div');
      note.className = 'search-note';
      note.textContent = (f.moreLine ? f.moreLine + ' ' : '') + TOK_NOTE;
      box.appendChild(note);
      return box;
    }
    // one sentence for what is on screen now, said once the senders and the tokens have both landed (or failed)
    function sayResults(q) {
      if (current() !== q) return;
      const named = isNameQuery(q);
      const ans = tokAnswers.get(q) || (tokErr && tokErr.q === q ? tokErr.ans : null);
      if (named && !ans) return;   // the tokens are still on their way: the full sentence comes when they land
      const parts = [lastRows.length ? lastRows.length + (lastRows.length === 1 ? ' result for this address' : ' results for this address') : lastUsers.length ? lastUsers.length + (lastUsers.length === 1 ? ' sender' : ' senders') : 'No senders match'];
      if (named) {
        const f = tokFacts(ans, q);
        parts.push(f.items.length ? (f.count.startsWith('first') ? 'the first ' + f.items.length : f.items.length) + (f.items.length === 1 ? ' token' : ' tokens') + ' named ' + q + (f.partialLine ? ' — ' + f.partialLine : '') : f.empty);
      }
      const links = drop ? drop.querySelectorAll('.search-hit').length : 0;
      say(parts.join('; ') + (links ? ' — press Down arrow to browse' : ''));
    }
    // the tokens' answer landed: swap the section in place (a reader already in the list keeps their focus)
    function showTokens(q) {
      if (!drop || current() !== q) return;
      const old = drop.querySelector('.search-toks'); if (!old) return;
      const focusTok = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.token : null;
      const box = tokSection(q);
      old.replaceWith(box);
      if (focusTok) { const again = box.querySelector('[data-token="' + focusTok + '"]'); if (again) again.focus(); }
      sayResults(q);
    }
    async function askTokens(q) {
      const j = await askTokenSearch(q);
      if (j.error && !(j.items || []).length) {   // shown, never kept: the next keystroke or the retry asks again
        if (current() !== q) return;
        tokErr = { q, ans: j }; showTokens(q);
        if (j.retryAfter) { clearTimeout(tokRetry); tokRetry = setTimeout(() => { if (current() === q && !tokAnswers.has(q)) askTokens(q); }, j.retryAfter * 1000); }
        return;
      }
      if (tokAnswers.size > 30) tokAnswers.delete(tokAnswers.keys().next().value);
      tokAnswers.set(q, j);
      if (current() !== q) return;
      showTokens(q);
      if (j.pending) TokenNames.follow(q, () => current() === q, (k) => {   // holders, in place: nothing else moves
        tokAnswers.set(q, Object.assign({}, tokAnswers.get(q), { items: (tokAnswers.get(q).items || []).map((t) => { const u = k.items.find((x) => x.token === t.token); return u ? Object.assign({}, t, { holders: u.holders, holdersKnown: u.holdersKnown, holdersSource: u.holdersSource }) : t; }), pending: k.pending }));
        TokenNames.refill(drop, tokAnswers.get(q), '.search-tok');
      });
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
      const named = !am && isNameQuery(q);   // a word: tokens by name follow the senders
      lastUsers = users; lastRows = rows;
      if (!users.length && !rows.length && named) {
        // nothing to list yet but the tokens: sayResults speaks once they land
      } else if (!users.length && !rows.length) {
        const msg = am ? (ADDR.test(q) ? 'Nothing found at that address' : 'No token on record starts with ' + q + ' — paste the whole address to scan it') : 'No senders match "' + q + '"';
        drop.innerHTML = '<div class="search-empty">' + (am && !ADDR.test(q) ? 'No token on record starts with ' + addrFit(q) + ' — paste the whole address to scan it' : esc(msg)) + ' 👻</div>';   // a partial address stays on one line
        say(msg);
      } else if (!users.length) {
        say(rows.length + (rows.length === 1 ? ' result' : ' results') + ' for this address — press Down arrow to browse');
      } else {
        if (!named) say((rows.length ? rows.length + users.length + ' results' : users.length + (users.length === 1 ? ' sender matches' : ' senders match')) + ' — press Down arrow to browse');
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
      if (named) drop.appendChild(tokSection(q));
      slot.appendChild(drop);
      if (named) sayResults(q);
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (!q) { close(); return; }
      // the tokens wait for the word to settle (0.7 s without a keystroke), so typing "pepe" asks once, not for "pe" and "pep"
      clearTimeout(tokDebounce);
      if (isNameQuery(q) && !tokAnswers.has(q)) tokDebounce = setTimeout(() => { if (current() === q) askTokens(q); }, 700);
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
