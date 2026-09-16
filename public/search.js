/* ===== Sender search: finds public walls, keyboard accessible =====
   A search box over a list of LINKS, not a combobox: the results are real <a href> that take DOM focus, and
   a combobox promises aria-activedescendant/option semantics this never had (a reader in forms mode heard
   nothing when results landed, and an option that was really a link). So the box is a plain searchbox that
   names the results panel with aria-controls, and every result set — including "no matches" — is spoken
   through the shared live region. */
(function () {
  // attribute-safe HTML escape (also encodes quotes so it's safe inside src="…"/style="…")
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function init() {
    const slot = document.getElementById('nav-search-slot');
    if (!slot) return;
    slot.className = 'nav-search';
    slot.innerHTML =
      '<span class="s-icon" aria-hidden="true">🔎</span>' +
      '<input type="search" id="sender-search" placeholder="find senders…" autocomplete="off" ' +
      'aria-controls="sender-search-results" aria-describedby="sender-search-help" aria-label="Search for senders and their public walls">' +
      '<span class="sr-only" id="sender-search-help">Matching senders are listed below the box as you type; press Down arrow to move into the list.</span>';
    const input = slot.querySelector('input');
    let drop = null, timer = null, hits = [], sel = -1;

    const say = (t) => { if (typeof window.announce === 'function') window.announce(t); };
    function close() {
      if (drop) { drop.remove(); drop = null; }
      sel = -1;
    }
    function open(users, q) {
      close();
      drop = document.createElement('div');
      drop.className = 'search-drop';
      drop.id = 'sender-search-results';
      drop.setAttribute('aria-label', 'Sender search results');
      hits = users;
      if (!users.length) {
        drop.innerHTML = '<div class="search-empty">No senders match "' + esc(q) + '" 👻</div>';
        say('No senders match ' + q);
      } else {
        say(users.length + (users.length === 1 ? ' sender matches' : ' senders match') + ' — press Down arrow to browse');
        for (const u of users) {
          const a = document.createElement('a');
          a.className = 'search-hit';
          a.href = '/u/' + encodeURIComponent(u.username);
          const ava = u.avatar_img
            ? window.avatarHTML(u.avatar_img, 'h-ava')
            : '<span class="h-ava" aria-hidden="true">' + esc(u.avatar) + '</span>';
          a.innerHTML = ava +
            '<div><div class="h-name"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + (window.ogBadge ? ogBadge(u.og) : '') + '</div>' +
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
          if (input.value.trim() === q) open(j.users || [], q);
        } catch {}
      }, 220);
    });
    // keys while the text box is focused: ArrowDown enters the list, Enter opens the top hit
    input.addEventListener('keydown', e => {
      if (!drop) return;
      const links = [...drop.querySelectorAll('.search-hit')];
      if (e.key === 'ArrowDown' && links.length) { e.preventDefault(); e.stopPropagation(); links[0].focus(); }
      else if (e.key === 'Escape') { close(); input.blur(); }
      else if (e.key === 'Enter' && links.length) { e.preventDefault(); links[0].click(); }
    });
    // keys while a result is focused: move between results, open the focused one
    slot.addEventListener('keydown', e => {
      const links = drop ? [...drop.querySelectorAll('.search-hit')] : [];
      const idx = links.indexOf(document.activeElement);
      if (idx < 0) return; // input-focused keys are handled above
      if (e.key === 'ArrowDown') { e.preventDefault(); (links[idx + 1] || links[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (links[idx - 1] || input).focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); links[idx].click(); }
      else if (e.key === 'Escape') { close(); input.focus(); }
    });
    document.addEventListener('click', e => { if (!slot.contains(e.target)) close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
