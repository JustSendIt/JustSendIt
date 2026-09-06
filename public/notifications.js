/* ===== notifications.js — header bell dropdown of app-wide updates (Send Power, watchlist, wallets…) =====
 * Mounts into #nav-notif when signed in. CSP-safe (addEventListener only). Simple UX: a badge, a dropdown,
 * clear-one (✕) and clear-all. */
(function () {
  'use strict';
  const mount = document.getElementById('nav-notif'); if (!mount) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ago(t) { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return s + 's ago'; const m = Math.round(s / 60); if (m < 60) return m + 'm ago'; const h = Math.round(m / 60); if (h < 24) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; }
  const signedIn = () => !!(window.AUTH && AUTH.user);
  let items = [], open = false, poll = null;

  function render() {
    if (!signedIn()) { mount.innerHTML = ''; return; }
    const n = items.length;
    mount.innerHTML =
      '<button class="notif-bell" id="notif-bell" type="button" aria-haspopup="true" aria-expanded="' + open + '" aria-label="Notifications' + (n ? ' (' + n + ')' : '') + '">🔔' + (n ? '<span class="notif-badge">' + (n > 9 ? '9+' : n) + '</span>' : '') + '</button>' +
      '<div class="notif-panel' + (open ? ' open' : '') + '" id="notif-panel" role="menu" aria-label="Notifications"' + (open ? '' : ' hidden') + '>' +
        '<div class="notif-head"><span>🔔 Notifications</span>' + (n ? '<button class="notif-clearall" id="notif-clearall" type="button">Clear all</button>' : '') + '</div>' +
        '<div class="notif-list">' + (n ? items.map(it =>
          '<div class="notif-item" data-id="' + it.id + '"><span class="notif-ico" aria-hidden="true">' + esc(it.icon || '🔔') + '</span>' +
          '<div class="notif-body"><div class="notif-text">' + esc(it.text) + '</div><div class="notif-time">' + ago(it.created_at) + '</div></div>' +
          '<button class="notif-x" type="button" data-clear="' + it.id + '" aria-label="Clear this notification">✕</button></div>'
        ).join('') : '<div class="notif-empty">🎉 You\'re all caught up.</div>') + '</div>' +
      '</div>';
  }
  async function load() {
    if (!signedIn()) { render(); return; }
    try { const r = await fetch('/api/notifications', { credentials: 'same-origin' }); if (!r.ok) return; const j = await r.json(); items = j.items || []; render(); } catch {}
  }
  // open/close WITHOUT rebuilding innerHTML — a rebuild would detach the just-clicked bell and make the
  // outside-click handler immediately re-close the panel. Data re-renders happen only in load().
  function applyOpen() {
    const panel = document.getElementById('notif-panel'), bell = document.getElementById('notif-bell');
    if (panel) { panel.classList.toggle('open', open); panel.hidden = !open; }
    if (bell) bell.setAttribute('aria-expanded', String(open));
  }
  function toggle(o) { open = (o == null ? !open : o); applyOpen(); }
  // defer the re-render past the current click so the outside-click handler doesn't see a detached target and close the panel
  async function clearAll() { items = []; setTimeout(render, 0); try { await fetch('/api/notifications', { method: 'DELETE', credentials: 'same-origin' }); } catch {} }
  async function clearOne(id) { items = items.filter(x => String(x.id) !== String(id)); setTimeout(render, 0); try { await fetch('/api/notifications/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }); } catch {} }

  mount.addEventListener('click', e => {
    if (e.target.closest('#notif-bell')) { toggle(); if (open) load(); return; }
    if (e.target.closest('#notif-clearall')) { clearAll(); return; }
    const x = e.target.closest('[data-clear]'); if (x) { clearOne(x.dataset.clear); return; }
  });
  document.addEventListener('click', e => { if (open && !mount.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => { if (open && (e.key === 'Escape' || e.key === 'Esc')) toggle(false); });
  // hover-away closes it (mouse only — the whole bell+panel is inside #nav-notif, so moving bell→panel doesn't leave;
  // keyboard/touch users keep click + Esc + outside-click). A short grace avoids closing on a stray flick.
  let hoverTimer = null;
  const finePointer = () => window.matchMedia && matchMedia('(pointer: fine)').matches;
  mount.addEventListener('mouseleave', () => { if (open && finePointer()) hoverTimer = setTimeout(() => toggle(false), 350); });
  mount.addEventListener('mouseenter', () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } });
  document.addEventListener('auth:change', () => { items = []; open = false; render(); load(); startPoll(); });
  document.addEventListener('points:changed', () => { if (signedIn()) setTimeout(load, 900); }); // catch level-ups / gains soon after
  function startPoll() { if (poll) clearInterval(poll); if (signedIn()) poll = setInterval(() => { if (!document.hidden) load(); }, 25000); }

  if (window.AUTH && AUTH.ready) AUTH.ready.then(() => { render(); load(); startPoll(); });
  else render();
})();
