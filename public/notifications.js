/* ===== notifications.js — header bell dropdown of app-wide updates (Send Power, watchlist, wallets…) =====
 * Mounts into #nav-notif when signed in. CSP-safe (addEventListener only). Simple UX: a badge, a dropdown,
 * clear-one (✕) and clear-all. */
(function () {
  'use strict';
  const mount = document.getElementById('nav-notif'); if (!mount) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ago(t) { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); if (s < 60) return s + 's ago'; const m = Math.round(s / 60); if (m < 60) return m + 'm ago'; const h = Math.round(m / 60); if (h < 24) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; }
  const signedIn = () => !!(window.AUTH && AUTH.user);
  let items = [], open = false, poll = null, loaded = false;
  let pending = null;   // rows a poll fetched while the reader was inside the panel — applied once they leave it
  const bellLabel = (n) => 'Notifications' + (n ? ', ' + n + ' in your list' : '');
  const badgeHTML = (n) => n ? '<span class="notif-badge" aria-hidden="true"><span class="notif-badge-n">' + (n > 9 ? '9+' : n) + '</span></span>' : '';

  function render() {
    if (!signedIn()) { mount.innerHTML = ''; return; }
    const n = items.length;
    mount.innerHTML =
      /* No aria-haspopup="true": that announces a MENU, and this is a list of links with a dismiss
         button each — a menuitem cannot hold a nested focusable control. aria-expanded + aria-controls
         describe a disclosure, which is what it is. The badge is decorative and hidden: the count is in
         the button's own name, so a screen reader hears it as part of the control rather than as a
         number floating beside it, and arrivals are announced once through the shared polite region. */
      '<button class="notif-bell" id="notif-bell" type="button" data-tip="Shows or hides your list of recent updates" aria-controls="notif-panel" aria-expanded="' + open + '" aria-label="' + bellLabel(n) + '">🔔' + badgeHTML(n) + '</button>' +
      /* role="list", not role="menu". A menu is a set of commands and traps the arrow keys; this is a list
         of rows, some of which are links and each of which has its own dismiss button. Calling it a menu
         made a screen reader promise menu keyboard behaviour that was never implemented. */
      '<div class="notif-panel' + (open ? ' open' : '') + '" id="notif-panel" tabindex="-1" aria-label="Notifications"' + (open ? '' : ' hidden') + '>' +
        '<div class="notif-head"><span id="notif-head-title">🔔 Notifications</span>' + (n ? '<button class="notif-clearall" id="notif-clearall" type="button" data-tip="Removes every notification from your list for good">Clear all</button>' : '') + '</div>' +
        '<ul class="notif-list" role="list" aria-labelledby="notif-head-title">' + (n ? items.map(it => {
          /* A link ONLY for a server-built, site-relative path. The href is validated again here rather
             than trusted from the payload: this string is about to be interpolated into innerHTML, so a
             value carrying a scheme or a quote would be an injection and an open redirect at once. The
             server already refuses those; agreeing twice costs one regex. */
          const href = (typeof it.href === 'string' && /^\/[A-Za-z0-9/_\-.~%?#=&+]*$/.test(it.href) && !it.href.startsWith('//')) ? it.href : null;
          const body = '<span class="notif-ico" aria-hidden="true">' + esc(it.icon || '🔔') + '</span>' +
            '<span class="notif-body"><span class="notif-text">' + esc(it.text) + '</span><span class="notif-time">' + ago(it.created_at) + '</span></span>';
          return '<li class="notif-item' + (href ? ' is-link' : '') + '" data-id="' + it.id + '">' +
            (href ? '<a class="notif-go" href="' + esc(href) + '">' + body + '</a>' : '<span class="notif-go notif-go-static">' + body + '</span>') +
            '<button class="notif-x" type="button" data-tip="Removes this one notification from your list for good" data-clear="' + it.id + '" aria-label="Clear: ' + esc(it.text) + '">✕</button></li>';
        }).join('') : '<li class="notif-empty">🎉 You\'re all caught up.</li>') + '</ul>' +
      '</div>';
  }
  async function load() {
    if (!signedIn()) { render(); return; }
    try {
      const r = await fetch('/api/notifications', { credentials: 'same-origin' });
      /* A definite 401 means this session is gone — signed out in another tab, or ended from Security on
         another device. Keeping the previous person's list on screen for whoever sits down next is the one
         thing the poll must not do, so it empties the bell and stops asking; a transient failure changes nothing. */
      if (r.status === 401) {
        items = []; pending = null; open = false; render();
        if (poll) { clearInterval(poll); poll = null; }
        if (window.AUTH && AUTH.refresh) AUTH.refresh().catch(() => {});
        return;
      }
      if (!r.ok) return;
      const j = await r.json();
      const next = j.items || [];
      /* Rebuilding innerHTML detaches whatever the reader is focused on and drops focus to <body>, which
         on a 25-second poll means a keyboard user can be interrupted mid-row. Hold the new rows in `pending`
         until the panel is closed or focus leaves it — `items` stays as rendered, so the arrivals are still
         counted (and announced) against what was on screen when they do land. The bell alone is repainted in
         place, since it stays attached and its count is otherwise frozen for as long as the reader lingers. */
      if (open && mount.contains(document.activeElement)) {
        pending = next; loaded = true;
        const bell = document.getElementById('notif-bell');
        if (bell) { bell.setAttribute('aria-label', bellLabel(next.length)); bell.innerHTML = '🔔' + badgeHTML(next.length); }
        return;
      }
      applyItems(next);
    } catch {}
  }
  function applyItems(next) {
    const before = new Set(items.map(x => x.id));
    const fresh = next.filter(x => !before.has(x.id)).length;
    const first = !items.length && !loaded;
    // a flush can run one tick after Escape handed focus to the bell; render() rebuilds that bell, so put focus back on the new one
    const hadBell = document.activeElement && (document.activeElement.id === 'notif-bell' || mount.contains(document.activeElement));
    pending = null; items = next; loaded = true; render();
    if (hadBell) { const b = document.getElementById('notif-bell'); if (b) b.focus(); }
    /* Say it once, politely, and only for rows that actually arrived while the page was open — not for
       the first load, which would read the whole backlog at somebody the moment they signed in. */
    if (fresh && !first && window.announce) announce(fresh === 1 ? 'One new notification.' : fresh + ' new notifications.');
  }
  // the held rows land once the reader is out of the panel; deferred a tick so the click or focus change
  // that got them out is fully over before the rows it was on are rebuilt
  function flushPending() { if (pending && !(open && mount.contains(document.activeElement))) { const p = pending; setTimeout(() => { if (pending === p) applyItems(p); }, 0); } }
  // open/close WITHOUT rebuilding innerHTML — a rebuild would detach the just-clicked bell and make the
  // outside-click handler immediately re-close the panel. Data re-renders happen only in load().
  function applyOpen() {
    const panel = document.getElementById('notif-panel'), bell = document.getElementById('notif-bell');
    if (panel) { panel.classList.toggle('open', open); panel.hidden = !open; }
    if (bell) bell.setAttribute('aria-expanded', String(open));
  }
  function toggle(o) { open = (o == null ? !open : o); applyOpen(); if (!open) flushPending(); }
  mount.addEventListener('focusout', () => setTimeout(flushPending, 0));   // focus has moved by the next tick
  // defer the re-render past the current click so the outside-click handler doesn't see a detached target and close the panel
  // optimistic, but honest: a clear the server refused puts the rows back and says so (F171)
  async function clearAll() {
    const keep = items; items = []; pending = null; setTimeout(render, 0);
    let ok = false; try { ok = (await fetch('/api/notifications', { method: 'DELETE', credentials: 'same-origin' })).ok; } catch {}
    if (!ok) { items = keep; setTimeout(render, 0); if (window.sendToast) sendToast('Could not clear notifications — try again'); }
  }
  async function clearOne(id) {
    const keep = items; items = items.filter(x => String(x.id) !== String(id)); pending = null; setTimeout(render, 0);
    let ok = false; try { ok = (await fetch('/api/notifications/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })).ok; } catch {}
    if (!ok) { items = keep; setTimeout(render, 0); if (window.sendToast) sendToast('Could not clear that notification — try again'); }
  }

  mount.addEventListener('click', e => {
    if (e.target.closest('#notif-bell')) {
      toggle(); if (open) load();
      // opened from the keyboard (a click with no pointer): take focus into the list, which can be a screen away from
      // the bell, so a magnifier that follows focus shows it
      if (open && e.detail === 0) { const p = document.getElementById('notif-panel'); if (p) p.focus(); }
      return;
    }
    if (e.target.closest('#notif-clearall')) { clearAll(); return; }
    const x = e.target.closest('[data-clear]'); if (x) { clearOne(x.dataset.clear); return; }
    /* A followed link leaves the panel open behind the navigation, and on a same-page hash it would stay
       open over the post it just scrolled to. Close it and let the browser do the rest — no
       preventDefault, so middle-click, cmd-click and "open in new tab" all still work. */
    if (e.target.closest('.notif-go[href]')) { toggle(false); return; }
  });
  document.addEventListener('click', e => { if (open && !mount.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => {
    if (!open || (e.key !== 'Escape' && e.key !== 'Esc')) return;
    // closing must put focus somewhere deliberate; leaving it on a detached row drops it to <body>
    const inside = mount.contains(document.activeElement);
    toggle(false);
    if (inside) { const b = document.getElementById('notif-bell'); if (b) b.focus(); }
  });
  /* No hover-away close. The panel opens on the left of the screen, so from a bell on the right the pointer crosses the
     bar to reach it and crosses back to close it; a timer on leaving closed the list on the way and turned the click on
     the bell into a reopen. (Chrome never ran it anyway: a clicked bell holds focus.) The panel closes on the bell, an
     outside click, Esc, or a followed link. */
  document.addEventListener('auth:change', () => { items = []; pending = null; open = false; render(); load(); startPoll(); });
  document.addEventListener('points:changed', () => { if (signedIn()) setTimeout(load, 900); }); // catch level-ups / gains soon after
  function startPoll() { if (poll) clearInterval(poll); if (signedIn()) poll = setInterval(() => { if (!document.hidden) load(); }, 25000); }

  if (window.AUTH && AUTH.ready) AUTH.ready.then(() => { render(); load(); startPoll(); });
  else render();
})();
