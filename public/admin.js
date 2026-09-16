/* ===== Moderation queue (X01) =====
   Operator-only: the server answers 404 to anyone whose id is not in ADMIN_USER_IDS, and /api/me carries
   `admin: true` for those who are. Everything here is a thin face on four routes:
     GET  /api/admin/reports?all=1      the queue
     POST /api/admin/takedown            {kind: post|comment|upload, id|name, note}
     POST /api/admin/restrict            {userId, days, reason} or {userId, lift: true}
     POST /api/admin/resolve             {id, action}
   Nothing is computed here; every number and name is the server's. */
(function () {
  const gate = document.getElementById('adm-gate'), tools = document.getElementById('adm-tools');
  const list = document.getElementById('adm-list'), count = document.getElementById('adm-count');
  const allBox = document.getElementById('adm-all');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('request failed (' + r.status + ')'));
    return j;
  }

  function row(r) {
    const t = r.target;
    let what = '';
    if (!t) what = '<p class="modal-note">The reported ' + esc(r.kind) + ' no longer exists.</p>';
    else if (r.kind === 'post') what = '<p><b>Post #' + t.id + '</b> by @' + esc(t.username) + (t.call ? ' <span class="privacy-chip">Send Call — text and media can be removed, the call stays</span>' : '') + '</p>' +
      (t.text ? '<blockquote class="adm-quote">' + esc(t.text) + '</blockquote>' : '') +
      (t.image ? '<p><a href="' + esc(t.image) + '" target="_blank" rel="noopener">attached media ↗</a></p>' : '');
    else if (r.kind === 'comment') what = '<p><b>Comment #' + t.id + '</b> by @' + esc(t.username) + ' on post #' + t.postId + '</p>' + (t.text ? '<blockquote class="adm-quote">' + esc(t.text) + '</blockquote>' : '');
    else what = '<p><b>@' + esc(t.username) + '</b> (user #' + t.id + ')' + (t.deleted ? ' — account deleted' : t.restrictLevel ? ' — currently restricted' + (t.restrictedUntil ? ' until ' + when(t.restrictedUntil) : '') : '') + '</p>';
    const open = !r.resolved_at;
    const actions = !open ? '<p class="modal-note">Resolved ' + when(r.resolved_at) + ' — ' + esc(r.action || '') + '</p>' :
      '<div class="adm-actions">' +
        (t && r.kind === 'post' ? '<button class="btn btn-sm btn-primary" data-act="takedown" data-kind="post" data-id="' + t.id + '" data-tip="Removes the post (or its text and media, for a Send Call) and tells the author">Take down post</button>' : '') +
        (t && r.kind === 'comment' ? '<button class="btn btn-sm btn-primary" data-act="takedown" data-kind="comment" data-id="' + t.id + '" data-tip="Removes the comment and tells the author">Take down comment</button>' : '') +
        (t && t.userId ? '<button class="btn btn-sm" data-act="restrict" data-uid="' + t.userId + '" data-tip="Puts the author in read-only mode for 7 days">Restrict author 7d</button>' : '') +
        '<button class="btn btn-sm btn-ghost" data-act="dismiss" data-rid="' + r.id + '" data-tip="Closes the report with no action">Dismiss</button>' +
      '</div>';
    return '<article class="post adm-report" data-rid="' + r.id + '">' +
      '<div class="post-head"><span class="privacy-chip">' + esc(r.kind) + '</span> reported by @' + esc(r.reporter) + ' · ' + when(r.created_at) + (open ? '' : ' · <b>resolved</b>') + '</div>' +
      (r.reason ? '<p class="adm-reason">“' + esc(r.reason) + '”</p>' : '<p class="modal-note">No reason given.</p>') +
      what + actions + '<p class="modal-note adm-status" role="status" aria-live="polite"></p></article>';
  }

  async function load() {
    list.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch('/api/admin/reports' + (allBox.checked ? '?all=1' : ''), { credentials: 'same-origin' });
      if (r.status === 404) { tools.hidden = true; gate.textContent = 'This page is for the site operators. If that is you, your user id has to be in ADMIN_USER_IDS on the server.'; return; }
      const j = await r.json();
      const rows = j.reports || [];
      count.textContent = j.open + ' open';
      list.innerHTML = rows.length ? rows.map(row).join('') : '<p class="empty-wall">Nothing reported' + (allBox.checked ? '' : ' and open') + '. 🎉</p>';
    } catch (e) { list.innerHTML = '<p class="empty-wall">⚠️ ' + esc(e.message || 'could not load the queue') + '</p>'; }
    finally { list.removeAttribute('aria-busy'); }
  }

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const art = b.closest('.adm-report'), st = art.querySelector('.adm-status');
    b.disabled = true; st.textContent = '…';
    try {
      if (b.dataset.act === 'takedown') {
        const note = window.prompt('Note for the author (optional, shown in their notification):') ;
        if (note === null) { b.disabled = false; st.textContent = ''; return; }
        await post('/api/admin/takedown', { kind: b.dataset.kind, id: Number(b.dataset.id), note });
      } else if (b.dataset.act === 'restrict') {
        const reason = window.prompt('Reason (the person sees it):', 'breaking the community rules');
        if (reason === null) { b.disabled = false; st.textContent = ''; return; }
        await post('/api/admin/restrict', { userId: Number(b.dataset.uid), days: 7, reason });
      } else if (b.dataset.act === 'dismiss') {
        await post('/api/admin/resolve', { id: Number(b.dataset.rid), action: 'dismissed' });
      }
      st.textContent = 'Done.';
      load();
    } catch (err) { b.disabled = false; st.textContent = '⚠️ ' + err.message; }
  });

  document.getElementById('adm-refresh').addEventListener('click', load);
  allBox.addEventListener('change', load);
  document.getElementById('adm-restrict').addEventListener('click', async () => {
    const st = document.getElementById('adm-restrict-status');
    try { await post('/api/admin/restrict', { userId: Number(document.getElementById('adm-uid').value), days: Number(document.getElementById('adm-days').value), reason: document.getElementById('adm-reason').value }); st.textContent = 'Restricted.'; load(); }
    catch (e) { st.textContent = '⚠️ ' + e.message; }
  });
  document.getElementById('adm-lift').addEventListener('click', async () => {
    const st = document.getElementById('adm-restrict-status');
    try { await post('/api/admin/restrict', { userId: Number(document.getElementById('adm-uid').value), lift: true }); st.textContent = 'Lifted.'; load(); }
    catch (e) { st.textContent = '⚠️ ' + e.message; }
  });

  function boot() {
    if (!(window.AUTH && AUTH.user)) { gate.textContent = 'Sign in first.'; tools.hidden = true; return; }
    if (!AUTH.user.admin) { gate.textContent = 'This page is for the site operators. If that is you, your user id has to be in ADMIN_USER_IDS on the server.'; tools.hidden = true; return; }
    gate.textContent = 'Signed in as @' + AUTH.user.username + ' (operator).';
    tools.hidden = false;
    load();
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
