/* ===== Sender search: finds public walls, keyboard accessible ===== */
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
      'role="combobox" aria-expanded="false" aria-label="Search for senders and their public walls">';
    const input = slot.querySelector('input');
    let drop = null, timer = null, hits = [], sel = -1;

    function close() {
      if (drop) { drop.remove(); drop = null; }
      input.setAttribute('aria-expanded', 'false');
      sel = -1;
    }
    function open(users, q) {
      close();
      drop = document.createElement('div');
      drop.className = 'search-drop';
      drop.setAttribute('role', 'listbox');
      hits = users;
      if (!users.length) {
        drop.innerHTML = '<div class="search-empty">No senders match "' + esc(q) + '" 👻</div>';
      } else {
        for (const u of users) {
          const a = document.createElement('a');
          a.className = 'search-hit';
          a.href = '/u/' + encodeURIComponent(u.username);
          a.setAttribute('role', 'option');
          const ava = u.avatar_img
            ? '<img class="h-ava" src="' + esc(u.avatar_img) + '" alt="">'
            : '<span class="h-ava" aria-hidden="true">' + esc(u.avatar) + '</span>';
          a.innerHTML = ava +
            '<div><div class="h-name"' + (u.accent ? ' style="color:' + esc(u.accent) + '"' : '') + '>@' + esc(u.username) + (window.ogBadge ? ogBadge(u.og) : '') + '</div>' +
            '<div class="h-sub">' + (u.bio ? esc(u.bio) : (u.posts + ' posts · ' + u.followers + ' followers')) + '</div></div>';
          drop.appendChild(a);
        }
      }
      slot.appendChild(drop);
      input.setAttribute('aria-expanded', 'true');
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
