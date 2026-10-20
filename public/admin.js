/* ===== The admin page: overview + moderation queue (X01) =====
   Admin-only: the server answers 404 for this page, its script and every /api/admin route to anyone whose id is not in ADMIN_USER_IDS, and /api/me carries
   `admin: true` for those who are. Everything here is a thin face on four routes:
     GET  /api/admin/reports?all=1      the queue
     POST /api/admin/takedown            {kind: post|comment|upload, id|name, note}
     POST /api/admin/restrict            {userId, days, reason} or {userId, lift: true}
     POST /api/admin/resolve             {id, action}
     POST /api/admin/keys/rotate         {confirm: 'ROTATE', scope: data|all, compromised} (needs "confirm it's you")
     GET  /api/admin/activity            daily visitors (counted from 2026-10-13) and daily active members (from the records)
   Nothing is computed here; every number and name is the server's. */
(function () {
  const gate = document.getElementById('adm-gate'), tools = document.getElementById('adm-tools');
  const list = document.getElementById('adm-list'), count = document.getElementById('adm-count');
  const allBox = document.getElementById('adm-all');
  const ov = document.getElementById('adm-overview'), ovBody = document.getElementById('adm-ov-body');
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
    else if (r.kind === 'hopcomment') what = '<p><b>Comment #' + t.id + '</b> by @' + esc(t.username) + ' under @' + esc(t.sender) + '’s Sent It on Send Call #' + t.callId + '</p>' + (t.text ? '<blockquote class="adm-quote">' + esc(t.text) + '</blockquote>' : '');
    else what = '<p><b>@' + esc(t.username) + '</b> (user #' + t.id + ')' + (t.deleted ? ' — account deleted' : t.restrictLevel ? ' — currently restricted' + (t.restrictedUntil ? ' until ' + when(t.restrictedUntil) : '') : '') + '</p>';
    const open = !r.resolved_at;
    const actions = !open ? '<p class="modal-note">Resolved ' + when(r.resolved_at) + ' — ' + esc(r.action || '') + '</p>' :
      '<div class="adm-actions">' +
        (t && r.kind === 'post' ? '<button class="btn btn-sm btn-primary" data-act="takedown" data-kind="post" data-id="' + t.id + '" data-tip="Removes the post (or its text and media, for a Send Call) and tells the author">Take down post</button>' : '') +
        (t && (r.kind === 'comment' || r.kind === 'hopcomment') ? '<button class="btn btn-sm btn-primary" data-act="takedown" data-kind="' + r.kind + '" data-id="' + t.id + '" data-tip="Removes the comment and tells the author">Take down comment</button>' : '') +
        (t && t.userId ? '<button class="btn btn-sm" data-act="restrict" data-uid="' + t.userId + '" data-tip="Puts the author in read-only mode for 7 days">Restrict author 7d</button>' : '') +
        '<button class="btn btn-sm btn-ghost" data-act="dismiss" data-rid="' + r.id + '" data-tip="Closes the report with no action">Dismiss</button>' +
      '</div>';
    return '<article class="post adm-report" data-rid="' + r.id + '">' +
      '<div class="post-head"><span class="privacy-chip">' + esc(r.kind) + '</span> reported by @' + esc(r.reporter) + ' · ' + when(r.created_at) + (open ? '' : ' · <b>resolved</b>') + '</div>' +
      (r.reason ? '<p class="adm-reason">“' + esc(r.reason) + '”</p>' : '<p class="modal-note">No reason given.</p>') +
      what + actions + '<p class="modal-note adm-status" role="status" aria-live="polite"></p></article>';
  }

  /* ----- the overview: counts and names from GET /api/admin/overview, nothing personal ----- */
  const bytes = (n) => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' kB' : n + ' B';
  const span = (sec) => { const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return (d ? d + ' d ' : '') + (d || h ? h + ' h ' : '') + m + ' min'; };
  const stat = (label, value) => '<div class="dk-stat"><span>' + label + '</span><b>' + value + '</b></div>';
  const KEY_WORDS = { env: 'from the server environment', file: '✅ its own file, on a separate volume', 'file-same-volume': '⚠️ its own file, but on the database\'s volume', 'data-dir': '⚠️ beside the database', generated: '⚠️ generated at start (development only)' };
  async function loadOverview() {
    ovBody.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch('/api/admin/overview', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('could not load the overview (' + r.status + ')');
      const o = await r.json(), m = o.members, inv = o.invites, sv = o.server, st = o.storage;
      const newest = st.backups && st.backups[0];
      ovBody.innerHTML =
        '<div class="adm-ov-grid">' +
          '<div><h3 class="adm-h3">Members</h3>' +
            stat('Members', m.total) + stat('Joined in the last 7 days', m.joinedLast7Days) +
            '<p class="modal-note adm-ov-sub">Newest</p><ol class="adm-ov-list">' +
            (m.latest.length ? m.latest.map((u) => '<li><a href="/u/' + encodeURIComponent(u.username) + '">@' + esc(u.username) + '</a> · Send ID #' + esc(u.sendId) + ' · ' + esc(when(u.joinedAt)) + '</li>').join('') : '<li>No members yet.</li>') + '</ol></div>' +
          '<div><h3 class="adm-h3">Invites</h3>' +
            stat('Member codes not used yet', inv.memberUnused) + stat('Member codes mid sign-up', inv.memberPending) + stat('Member codes used', inv.memberUsed) +
            stat('Codes each member gets', inv.perMember) +
            stat('Seed codes', inv.seedCodesOpen ? 'open (no members yet)' : 'closed — only member codes admit anyone') +
          '<h3 class="adm-h3">Moderation</h3>' + stat('Open reports', o.reports.open) + '</div>' +
          '<div><h3 class="adm-h3">Server</h3>' +
            stat('Node', esc(sv.node)) + stat('Code version', esc(sv.commit || 'unknown') + (sv.checkoutCommit && sv.commit && sv.checkoutCommit !== sv.commit ? ' (⚠️ ' + esc(sv.checkoutCommit) + ' pulled, not running yet: restart)' : '')) + stat('Running for', span(sv.uptimeSeconds)) +
            stat('Health', sv.health && sv.health.ok ? '✅ database and disk OK' : '⚠️ ' + esc(JSON.stringify(sv.health))) + '</div>' +
          '<div><h3 class="adm-h3">Storage</h3>' +
            stat('Database', bytes(st.dbBytes)) + stat('Encryption key', KEY_WORDS[st.keySource] || esc(st.keySource)) +
            stat('Backups folder', esc(st.backupDir)) + stat('Backups on their own volume', st.backupsOutsideDataDir ? '✅ yes' : '⚠️ no — on the database\'s volume') +
            stat('Backups kept', st.backupsKept) + stat('Newest backup', newest ? esc(newest.file) + ' · ' + bytes(newest.bytes) + ' · ' + esc(when(newest.at)) : '⚠️ none found') + '</div>' +
          keysPanel(st.keys) +
        '</div>';
    } catch (e) { ovBody.innerHTML = '<p class="empty-wall">⚠️ ' + esc(e.message || 'could not load the overview') + '</p>'; }
    finally { ovBody.removeAttribute('aria-busy'); }
  }
  /* ----- key rotation: ids, ages and counts from the server (never a key), and the two "rotate now" buttons ----- */
  const ageOf = (t) => { if (!t) return ''; const h = (Date.now() - t) / 3600e3; return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago'; };
  const until = (t) => { if (!t) return '—'; const h = (t - Date.now()) / 3600e3; return h <= 0 ? 'due now' : h < 1 ? 'in ' + Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? 'in ' + Math.round(h) + ' h' : 'in ' + Math.round(h / 24) + ' days'; };
  function keysPanel(k) {
    if (!k) return '';
    const cur = (k.keys || []).find((x) => x.current) || {};
    const old = (k.keys || []).filter((x) => !x.current);
    const lm = k.lastMaintenance;
    const files = lm ? lm.files || [] : [];
    const failed = files.filter((f) => f.status === 'failed'), foreign = files.filter((f) => f.status === 'foreign');
    const blocked = lm ? lm.blocked || [] : [];
    const unreadCols = lm ? Object.entries(lm.unreadableLive || {}) : [];
    const unreadLive = unreadCols.reduce((a, [, n]) => a + n, 0), unreadFiles = lm ? lm.unreadableInBackups || 0 : 0;
    const unreadSinceBoot = Object.values(k.unreadable || {}).reduce((a, b) => a + b, 0);
    const ring = k.mode === 'keyring', owner = ring && k.owner;
    return '<div><h3 class="adm-h3">Key rotation</h3>' +
      stat('Mode', ring ? (k.paused ? '⚠️ keyring, ' + (owner ? 'paused' : 'read only') + ': ' + esc(k.paused) : '✅ keyring, rotating') : '⚠️ ' + esc(k.paused || 'single fixed key')) +
      (ring ? stat('Current data key', '#' + esc(k.currentKey) + (cur.addedAt ? ' · made ' + esc(ageOf(cur.addedAt)) : '')) +
        stat('Next data key', k.schedule.dataEveryHours ? esc(until(k.nextDataAt)) + ' (every ' + esc(k.schedule.dataEveryHours) + ' h)' : 'off') +
        stat('Index key', 'epoch ' + esc(k.indexEpoch) + (k.indexRotatedAt ? ' · moved ' + esc(ageOf(k.indexRotatedAt)) : ' · never moved')) +
        stat('Next index key', k.schedule.indexEveryDays ? esc(until(k.nextIndexAfter)) + ', at ' + esc(k.schedule.atHour) + ':00 server time (restarts the site for about 10 s)' : 'off') +
        stat('Old data keys still held', old.length ? old.map((x) => '#' + esc(x.id)).join(', ') + ' — dropped once nothing needs them' : 'none') +
        stat('Keys dropped so far', esc(k.droppedKeys) + (k.lastDroppedAt ? ' · last ' + esc(ageOf(k.lastDroppedAt)) : '')) +
        stat('Escrow copy of the keyring', k.escrow.configured ? '✅ set up' + (k.escrow.lastSealedAt ? ' · last sealed ' + esc(ageOf(k.escrow.lastSealedAt)) : '') : (k.escrow.allowedWithout ? '⚠️ not set up — the key volume is the only copy' : '⚠️ not set up — rotation paused')) +
        (k.indexFlipFailed ? stat('Last index rotation', '⚠️ did not run, ' + esc(ageOf(k.indexFlipFailed.at)) + ': ' + esc(k.indexFlipFailed.why) + ' — tried again tomorrow') : '') +
        stat('Backup files on the current key', lm ? (files.length - failed.length - foreign.length) + ' of ' + files.length + (failed.length || blocked.length ? '' : ' ✅') +
          (failed.length ? ' · ⚠️ could not check: ' + failed.map((f) => esc(f.file) + ' (' + esc(f.why || '') + ')').join('; ') : '') +
          (foreign.length ? ' · left alone (no key here opens them): ' + foreign.map((f) => esc(f.file)).join(', ') : '') : 'not checked yet') +
        (blocked.length ? stat('Backup places not reachable', '⚠️ ' + blocked.map((b) => esc(b.path) + ' — ' + esc(b.why)).join('; ') + ' · no old key is dropped until these can be checked') : '') +
        (lm && lm.waiting && lm.waiting.length ? stat('Waiting', esc(lm.waiting.join(' · '))) : '') +
        stat('Last check', lm ? esc(ageOf(lm.at)) + (lm.dropped && lm.dropped.length ? ' · dropped ' + esc(lm.dropped.join(', ')) : '') : '—') : '') +
      stat('Values no key opens', unreadLive || unreadFiles ? '⚠️ ' + unreadLive + ' in the live database' + (unreadCols.length ? ' (' + unreadCols.map(([c, n]) => esc(c) + ': ' + n).join(', ') + ')' : '') + ', ' + unreadFiles + ' in backups — kept as they are; they hold no key back' : lm ? '✅ none' : (unreadSinceBoot ? '⚠️ ' + unreadSinceBoot + ' read since the server started' : 'not checked yet')) +
      (k.lastError ? '<p class="modal-note">⚠️ ' + esc(k.lastError) + '</p>' : '') +
      (ring && owner ? '<div class="adm-actions">' +
        '<button class="btn btn-sm" type="button" data-keyrot="data" data-tip="Makes a new data key, re-encrypts the database and every backup under it, and drops the old key an hour later. The site stays up.">Rotate the data key now</button>' +
        '<button class="btn btn-sm btn-primary" type="button" data-keyrot="compromised" data-tip="For a key that may have been copied: new data key AND new index key, old keys dropped as soon as nothing needs them. Restarts the site for about 10 seconds.">Key may be stolen: rotate everything</button>' +
      '</div><p class="modal-note" id="adm-keyrot-status" role="status" aria-live="polite"></p>' : '') +
      '</div>';
  }
  ovBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-keyrot]'); if (!btn) return;
    const compromised = btn.dataset.keyrot === 'compromised';
    if (!window.confirm(compromised ? 'Rotate every key now and drop the old ones as soon as nothing needs them? The site restarts for about 10 seconds.' : 'Rotate the data key now? The site stays up.')) return;
    const say = (m) => { const el = document.getElementById('adm-keyrot-status'); if (el) el.textContent = m; };
    for (const b of ovBody.querySelectorAll('[data-keyrot]')) b.disabled = true;
    say('Rotating…');
    try {
      const j = await window.api('/api/admin/keys/rotate', { method: 'POST', body: { confirm: 'ROTATE', scope: compromised ? 'all' : 'data', compromised } });
      if (window.SFX) SFX.play('success');
      if (j.restarting) { say('Done with the data key. The server is restarting for the index key — this panel reads again in 20 seconds.'); setTimeout(loadOverview, 20000); }
      else { say('Done: data key #' + j.keys.currentKey + ' is current' + (j.report && j.report.error ? ' — ⚠️ ' + j.report.error : '') + '.'); loadOverview(); }
    } catch (e) {
      say(e && e.message === 'cancelled' ? 'Not rotated.' : '⚠️ ' + ((e && e.message) || 'could not rotate'));
      if (window.SFX && !(e && e.message === 'cancelled')) SFX.play('error');
      for (const b of ovBody.querySelectorAll('[data-keyrot]')) b.disabled = false;
    }
  });
  document.getElementById('adm-ov-refresh').addEventListener('click', loadOverview);

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
        if (window.SFX) SFX.play('remove');
      } else if (b.dataset.act === 'restrict') {
        const reason = window.prompt('Reason (the person sees it):', 'breaking the community rules');
        if (reason === null) { b.disabled = false; st.textContent = ''; return; }
        await post('/api/admin/restrict', { userId: Number(b.dataset.uid), days: 7, reason });
        if (window.SFX) SFX.play('off');
      } else if (b.dataset.act === 'dismiss') {
        await post('/api/admin/resolve', { id: Number(b.dataset.rid), action: 'dismissed' });
        if (window.SFX) SFX.play('close');
      }
      st.textContent = 'Done.';
      load();
    } catch (err) { b.disabled = false; st.textContent = '⚠️ ' + err.message; if (window.SFX) SFX.play('error'); }
  });

  document.getElementById('adm-refresh').addEventListener('click', load);
  allBox.addEventListener('change', load);
  document.getElementById('adm-restrict').addEventListener('click', async () => {
    const st = document.getElementById('adm-restrict-status');
    try { await post('/api/admin/restrict', { userId: Number(document.getElementById('adm-uid').value), days: Number(document.getElementById('adm-days').value), reason: document.getElementById('adm-reason').value }); st.textContent = 'Restricted.'; load(); if (window.SFX) SFX.play('off'); }
    catch (e) { st.textContent = '⚠️ ' + e.message; if (window.SFX) SFX.play('error'); }
  });
  document.getElementById('adm-lift').addEventListener('click', async () => {
    const st = document.getElementById('adm-restrict-status');
    try { await post('/api/admin/restrict', { userId: Number(document.getElementById('adm-uid').value), lift: true }); st.textContent = 'Lifted.'; load(); if (window.SFX) SFX.play('on'); }
    catch (e) { st.textContent = '⚠️ ' + e.message; if (window.SFX) SFX.play('error'); }
  });

  /* ----- daily active users: two bar charts and the table under them, every figure from GET /api/admin/activity ----- */
  const dau = document.getElementById('adm-activity'), dauBody = document.getElementById('adm-dau-body');
  let dauData = null, dauRange = '30';
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-US');
  const short = (d) => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch { return d; } };
  function niceMax(m) { if (m <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function chart(rows, key, cls, title, sub, word, today) {
    const counted = rows.filter((r) => r[key] != null);
    const top = niceMax(Math.max(1, ...counted.map((r) => r[key])));
    const best = counted.reduce((a, r) => (r[key] > (a ? a[key] : -1) ? r : a), null);
    const last = rows[rows.length - 1];
    const bars = rows.map((r) => {
      const v = r[key];
      if (v == null) return '<span class="adm-bar is-none" title="' + esc(r.day) + ': not counted — the site did not count visits before ' + esc(dauData.trackingSince || dauData.today) + '"></span>';
      return '<span class="adm-bar' + (v === 0 ? ' is-zero' : '') + (r.day === today ? ' is-today' : '') + '" style="--h:' + (v / top * 100).toFixed(2) + '%" title="' + esc(r.day) + (r.day === today ? ' (today, so far)' : '') + ': ' + num(v) + ' ' + esc(word) + '"></span>';
    }).join('');
    const label = title + ', ' + short(rows[0].day) + ' to ' + short(last.day) + ': ' + (counted.length ? 'highest ' + num(best[key]) + ' on ' + short(best.day) + '; today so far ' + num(last[key] == null ? 0 : last[key]) : 'nothing counted in these days') + '.';
    const mid = rows[Math.floor((rows.length - 1) / 2)];
    // drawn once from the numbers, so the full-screen view (ChartFull, app.js) shows a copy of it, bars and day tips included
    // the ⤢ sits beside the caption, not in it (a caption names the figure; the button's words are not part of that name). The
    // pointer to the table is said only on the page: the full-screen copy has no table under it, so it leaves the note out
    const note = 'adm-tblnote-' + key;
    return '<figure class="adm-chart ' + cls + '" data-cf-unit="clone" data-cf-title="' + esc(title) + '"><figcaption>' + esc(title) + ' <small>' + esc(sub) + '</small></figcaption>' +
      '<button class="cf-open" type="button" data-cf-open aria-haspopup="dialog" aria-label="Show the ' + esc(title.toLowerCase()) + ' chart full screen" data-tip="Opens this chart full screen — Close or Esc brings it back"><i class="cf-ico" aria-hidden="true"></i></button>' +
      '<span class="sr-only" id="' + note + '" data-cf-drop>Every day’s number is in the table below.</span>' +
      '<div class="adm-chart-plot"><div class="adm-chart-y" aria-hidden="true"><span>' + num(top) + '</span><span>' + num(top / 2) + '</span><span>0</span></div>' +
      '<div class="adm-chart-bars" role="img" aria-label="' + esc(label) + '" aria-describedby="' + note + '">' + bars + '</div></div>' +
      '<div class="adm-chart-x" aria-hidden="true"><span>' + esc(short(rows[0].day)) + '</span>' + (rows.length > 2 ? '<span>' + esc(short(mid.day)) + '</span>' : '') + '<span>' + esc(short(last.day)) + (last.day === today ? ' (today)' : '') + '</span></div></figure>';
  }
  function renderDau() {
    const d = dauData; if (!d) return;
    const rows = dauRange === 'all' ? d.days : d.days.slice(-Number(dauRange));
    const t = d.days[d.days.length - 1], wk = d.days.slice(-7);
    const avg = (k) => (wk.reduce((a, r) => a + (r[k] || 0), 0) / wk.length).toFixed(1);
    const visitWk = wk.filter((r) => r.visitors != null);
    const tt = d.totals;
    const COLS = [['visitors', 'Visitors'], ['membersVisiting', 'Members among them'], ['views', 'Page views'], ['bots', 'Bots left out'], ['activeMembers', 'Active members'], ['joined', 'Joined'], ['entered', 'Codes used at the gate'], ['signins', 'Sign-ins on record'], ['posts', 'Posts'], ['comments', 'Comments'], ['reactions', 'Reactions'], ['checkins', 'Check-ins'], ['calls', 'Send Calls'], ['flights', 'Rocket Run flights'], ['ghosts', 'Ghosts found']];
    dauBody.innerHTML =
      '<div class="adm-dau-today">' +
        '<div>' + stat('Visitors today (so far)', t.visitors == null ? 'not counted yet' : num(t.visitors)) + stat('Members among them', t.membersVisiting == null ? '—' : num(t.membersVisiting)) + stat('Page views today', t.views == null ? '—' : num(t.views)) + '</div>' +
        '<div>' + stat('Active members today', num(t.activeMembers)) + stat('Active members, 7-day average', avg('activeMembers')) + (visitWk.length ? stat(visitWk.length < 7 ? 'Visitors, average of the ' + visitWk.length + ' counted ' + (visitWk.length === 1 ? 'day' : 'days') : 'Visitors, 7-day average', (visitWk.reduce((a, r) => a + r.visitors, 0) / visitWk.length).toFixed(1)) : stat('Visitors, 7-day average', 'not counted yet')) + '</div>' +
        '<div>' + stat('Members', num(tt.members) + (tt.membersEver !== tt.members ? ' (' + num(tt.membersEver - tt.members) + ' deleted)' : '')) + stat('Codes used at the gate, ever', num(tt.entered)) + stat('First record', esc(d.firstRecord)) + stat('Visitors counted since', d.trackingSince ? esc(d.trackingSince) : 'the next page anyone opens') + '</div>' +
      '</div>' +
      chart(rows, 'visitors', 'adm-chart--visitors', 'Visitors per day', '— people who opened a page, one per device and day; bots left out', 'visitors', d.today) +
      chart(rows, 'activeMembers', 'adm-chart--members', 'Active members per day', '— members who joined, signed in, posted, commented, reacted, voted, followed, checked in, called, flew or found a ghost', 'active members', d.today) +
      '<ul class="adm-dau-notes">' +
        '<li><b>Visitors</b> are counted from ' + esc(d.trackingSince || 'today') + ', when a page is opened. No IP address or browser is stored: each UTC day gets a fresh key, a visitor is a one-way fingerprint made with it, and the key and the fingerprints are deleted when the day ends, so only the totals stay and nobody can be followed from one day to the next. A phone that changes network counts twice. <b>Before ' + esc(d.trackingSince || 'today') + ' the site counted no visits at all</b> (the striped days), and nothing can recover them.</li>' +
        '<li><b>Active members</b> come from the records the site has always kept, so they reach back to the first member on ' + esc(d.firstRecord) + '. Points the server works out by itself (holding a call, decay, a reaction someone else gave) do not make anyone active. Sign-ins only count while the session is still on record.</li>' +
        '<li>Totals since the first record: ' + num(tt.posts) + ' posts, ' + num(tt.comments) + ' comments, ' + num(tt.calls) + ' Send Calls, ' + num(tt.flights) + ' Rocket Run flights; ' + num(tt.views) + ' page views and ' + num(tt.bots) + ' bot requests since visits were first counted.</li>' +
      '</ul>' +
      '<details class="setting-card adm-dau-more"><summary>Every day’s numbers (' + rows.length + ' days)</summary><div class="adm-dau-table"><table><caption class="sr-only">Daily visitors and activity, newest first</caption><thead><tr><th scope="col">Day (UTC)</th>' +
        COLS.map(([, h]) => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.slice().reverse().map((r) => '<tr><th scope="row">' + esc(r.day) + (r.day === d.today ? ' (today)' : '') + '</th>' + COLS.map(([k]) => '<td>' + num(r[k]) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div></details>';
  }
  async function loadActivity() {
    dauBody.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch('/api/admin/activity', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('could not load the day counts (' + r.status + ')');
      dauData = await r.json();
      renderDau();
    } catch (e) { dauBody.innerHTML = '<p class="empty-wall">⚠️ ' + esc(e.message || 'could not load the day counts') + '</p>'; }
    finally { dauBody.removeAttribute('aria-busy'); }
  }
  dau.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dau-range]'); if (!b) return;
    dauRange = b.dataset.dauRange;
    for (const x of dau.querySelectorAll('[data-dau-range]')) x.setAttribute('aria-pressed', String(x === b));
    renderDau();
  });
  document.getElementById('adm-dau-refresh').addEventListener('click', loadActivity);

  function boot() {
    if (!(window.AUTH && AUTH.user)) { gate.textContent = 'Sign in first.'; tools.hidden = true; ov.hidden = true; dau.hidden = true; return; }
    if (!AUTH.user.admin) { gate.textContent = 'This page is for the site operators. If that is you, your user id has to be in ADMIN_USER_IDS on the server.'; tools.hidden = true; ov.hidden = true; dau.hidden = true; return; }
    gate.textContent = 'Signed in as @' + AUTH.user.username + ' (admin).';
    tools.hidden = false; ov.hidden = false; dau.hidden = false;
    loadOverview(); loadActivity(); load();
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
