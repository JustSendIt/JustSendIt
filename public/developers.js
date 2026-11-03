/* ===== /developers: Sign in with Send for app builders — the copy buttons, and "Your apps" =====
   The protocol and every rule are lib/oidc.js's; this page is a thin face on its JSON, and every limit, check and refusal
   it shows is the server's own words:
     GET    /api/oauth/apps                      your apps, and how many one member may have
     POST   /api/oauth/apps                      register one → { app, clientSecret? }: the secret is shown once, here
     POST   /api/oauth/apps/<clientId>           change the name, homepage, redirect addresses or description → { app, reviewCleared }
     POST   /api/oauth/apps/<clientId>/secret    a new secret for a confidential app → { app, clientSecret }
     DELETE /api/oauth/apps/<clientId>           delete it, with every member's sign-in to it
   A secret lives in this page's memory only while its panel is open: "I have saved it", a reload or leaving drops it, and
   the server keeps only its hash, so nothing can show it again. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (t) => { try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const toast = (t) => { if (window.sendToast) sendToast(t); };

  /* ---------- copying: a code block, a client ID, a secret ---------- */
  async function copyText(text, what, from) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied ' + what);
      if (window.SFX) SFX.play('copy');
      return true;
    } catch {
      // no clipboard (plain http, or the browser said no): select it instead, so a keyboard copy or a long-press still works
      if (from) { const r = document.createRange(); r.selectNodeContents(from); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      toast('Selected: copy it with your keyboard or a long-press');
      return false;
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dv-copy]');
    if (b) { const el = $(b.getAttribute('data-dv-copy')); if (el) copyText(el.textContent, b.getAttribute('data-dv-what') || 'it', el); return; }
    const v = e.target.closest('[data-dv-copy-value]');
    if (v) { const row = v.closest('.dv-copy-row'); copyText(v.getAttribute('data-dv-copy-value'), v.getAttribute('data-dv-what') || 'it', row && row.querySelector('code')); }
  });

  /* ---------- Your apps ---------- */
  const body = $('dv-apps-body'), status = $('dv-apps-status');
  if (!body) return;
  const say = (t) => { if (status) status.textContent = t; };
  let apps = null, max = 5, shown = null, editing = null, draft = null, loadedFor = null;
  const armed = new Map();   // button → timer, for the two-tap actions (a new secret, delete)

  // the label, then what the field takes, then the field (each field names its help with aria-describedby)
  const field = (id, label, control, help) => '<label class="f-label" for="' + id + '">' + label + '</label><p class="dv-help" id="' + id + '-h">' + help + '</p>' + control;
  const HELP = {
    name: '3 to 40 characters: letters, numbers, spaces and . - _ \' &amp; ! ? : + ( ). Members see it on the sign-in page, so make it the name they know your app by.',
    home: 'Where members can find out about your app: an https address.',
    redirects: 'One per line, up to five. Matched exactly, character for character: https, or http://localhost and http://127.0.0.1 on any port while you build. No wildcards and no #fragment.',
    desc: 'Optional, up to 300 characters. Members see it on the sign-in page.',
  };
  function fields(pre, a) {
    return field(pre + 'name', 'Name', '<input class="addr-input" id="' + pre + 'name" maxlength="40" autocomplete="off" spellcheck="false" required aria-describedby="' + pre + 'name-h" value="' + esc(a ? a.name : '') + '">', HELP.name) +
      field(pre + 'home', 'Homepage', '<input class="addr-input" id="' + pre + 'home" type="url" inputmode="url" maxlength="300" placeholder="https://your.app" autocomplete="off" spellcheck="false" required aria-describedby="' + pre + 'home-h" value="' + esc(a ? a.homepage : '') + '">', HELP.home) +
      field(pre + 'redirects', 'Redirect addresses', '<textarea class="addr-input" id="' + pre + 'redirects" rows="3" spellcheck="false" autocomplete="off" placeholder="https://your.app/callback" required aria-describedby="' + pre + 'redirects-h">' + esc(a ? a.redirectUris.join('\n') : '') + '</textarea>', HELP.redirects) +
      field(pre + 'desc', 'Description', '<textarea class="addr-input dv-desc" id="' + pre + 'desc" rows="2" maxlength="300" aria-describedby="' + pre + 'desc-h">' + esc(a ? a.description : '') + '</textarea>', HELP.desc);
  }
  function newForm() {
    return '<form class="dv-form" id="dv-new" novalidate>' +
      '<h3 class="dv-h3">Register an app</h3>' + fields('dv-n-', null) +
      '<fieldset class="dv-kinds"><legend class="f-label">What kind of app it is</legend>' +
        '<label class="dv-kind"><input type="radio" name="dv-kind" value="public" checked><span><b>Public</b><small>A browser or mobile app. It gets no secret, because anyone could read one out of it: PKCE proves each sign-in.</small></span></label>' +
        '<label class="dv-kind"><input type="radio" name="dv-kind" value="confidential"><span><b>Confidential</b><small>A server that can keep a secret. You get a client secret, shown once.</small></span></label>' +
      '</fieldset>' +
      '<div class="dk-actions"><button class="btn btn-primary btn-sm" type="submit" id="dv-n-go" data-tip="Registers the app and shows its client ID, and its secret once">Register the app</button></div>' +
      '<p class="modal-note" id="dv-n-status" role="status" aria-live="polite"></p></form>';
  }
  function editForm(a) {
    const pre = 'dv-e-' + a.clientId + '-';
    return '<form class="dv-form dv-edit" data-app="' + esc(a.clientId) + '" novalidate>' +
      '<h4 class="dv-h3">Change ' + esc(a.name) + '</h4>' + fields(pre, a) +
      '<p class="dv-help">Its kind cannot change: register a new app for the other kind.' + (a.reviewed ? ' Changing the name, homepage or an address clears its review.' : '') + '</p>' +
      '<div class="dk-actions"><button class="btn btn-primary btn-sm" type="submit" data-tip="Saves these changes to the app">Save the changes</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-dv-act="cancel" data-tip="Closes the form and keeps the app as it was">Cancel</button></div>' +
      '<p class="modal-note dv-edit-status" role="status" aria-live="polite"></p></form>';
  }
  function appItem(a) {
    const hp = String(a.homepage || '').replace(/^https:\/\//, '').replace(/\/$/, '');
    const review = a.reviewed ? '<span class="dv-chip is-ok">Reviewed ' + esc(day(a.reviewedAt)) + '</span>' : '<span class="dv-chip">Not reviewed yet</span>';
    const kind = a.kind === 'confidential'
      ? 'Confidential: it has a secret' + (a.secretRotatedAt ? ', made on ' + esc(day(a.secretRotatedAt)) : '') + '. Only its hash is kept.'
      : 'Public: no secret; PKCE proves each sign-in.';
    return '<li class="dv-app' + (a.disabled ? ' is-off' : '') + '" data-app="' + esc(a.clientId) + '">' +
      '<div class="dv-app-head"><h3 class="dv-app-name">' + esc(a.name) + '</h3>' + review + (a.disabled ? '<span class="dv-chip is-warn">Switched off</span>' : '') + '</div>' +
      '<dl class="dv-dl">' +
        '<div><dt>Client ID</dt><dd><span class="dv-copy-row"><code>' + esc(a.clientId) + '</code><button class="btn btn-ghost btn-sm" type="button" data-dv-copy-value="' + esc(a.clientId) + '" data-dv-what="the client ID" data-tip="Copies this app\'s client ID, which your app sends with every sign-in">Copy</button></span></dd></div>' +
        '<div><dt>Kind</dt><dd>' + kind + '</dd></div>' +
        '<div><dt>Homepage</dt><dd><a href="' + esc(a.homepage) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(hp) + '</a></dd></div>' +
        '<div><dt>Sends members back to</dt><dd><ul>' + a.redirectUris.map((u) => '<li><code>' + esc(u) + '</code></li>').join('') + '</ul></dd></div>' +
        (a.description ? '<div><dt>Description</dt><dd>' + esc(a.description) + '</dd></div>' : '') +
        '<div><dt>Members who allowed it</dt><dd>' + Number(a.members || 0).toLocaleString('en-US') + '</dd></div>' +
        '<div><dt>Registered</dt><dd>' + esc(day(a.createdAt)) + '</dd></div>' +
      '</dl>' +
      (a.disabled ? '<p class="dv-off">Switched off by Just Send It on ' + esc(day(a.disabledAt)) + (a.disabledReason ? ': ' + esc(a.disabledReason) : '') + '. It cannot sign anyone in, and its tokens stopped working. Write to SendRH@Atomicmail.io about it.</p>' : '') +
      (editing === a.clientId ? editForm(a) :
        '<div class="dk-actions">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-dv-act="edit" data-tip="Opens a form to change the name, homepage, redirect addresses or description">Edit</button>' +
          (a.kind === 'confidential' ? '<button class="btn btn-ghost btn-sm" type="button" data-dv-act="secret" data-tip="Makes a new client secret and shows it once; the old one stops working at once (tap twice)">New secret</button>' : '') +
          '<button class="btn btn-ghost btn-sm" type="button" data-dv-act="delete" data-tip="Deletes the app and ends every member\'s sign-in to it (tap twice)">Delete</button>' +
        '</div>') +
      '<p class="modal-note dv-app-status" role="status" aria-live="polite"></p></li>';
  }
  function secretPanel(s) {
    const a = s.app;
    return '<div class="dv-secret" id="dv-secret" tabindex="-1" role="group" aria-labelledby="dv-secret-h">' +
      '<h3 id="dv-secret-h">' + (s.kind === 'new' ? 'Registered: ' + esc(a.name) : 'A new secret for ' + esc(a.name)) + '</h3>' +
      '<p class="dk-note">Client ID, which your app sends with every sign-in:</p>' +
      '<div class="dv-copy-row"><code id="dv-secret-id">' + esc(a.clientId) + '</code><button class="btn btn-ghost btn-sm" type="button" data-dv-copy-value="' + esc(a.clientId) + '" data-dv-what="the client ID" data-tip="Copies the client ID">Copy the ID</button></div>' +
      (s.secret
        ? '<p class="dv-once">The client secret, shown once.</p><p class="dk-note">It is kept here only as a hash, so nobody can show it to you again. Copy it now and keep it on your server, never in a browser or an app people download. If it is lost, make a new one.' + (s.kind === 'rotated' ? ' The old secret stopped working just now.' : '') + '</p>' +
          '<div class="dv-copy-row"><code id="dv-secret-val">' + esc(s.secret) + '</code><button class="btn btn-primary btn-sm" type="button" data-dv-copy-value="' + esc(s.secret) + '" data-dv-what="the client secret" data-tip="Copies the client secret: it is not shown again">Copy the secret</button></div>'
        : '<p class="dk-note">A public app has no secret: it sends its client ID alone, and PKCE proves each sign-in.</p>') +
      '<div class="dk-actions"><button class="btn btn-ghost btn-sm" type="button" id="dv-secret-done" data-tip="' + (s.secret ? 'Closes this panel and forgets the secret on this page' : 'Closes this panel') + '">' + (s.secret ? 'I have saved it' : 'Done') + '</button></div></div>';
  }

  // what is typed in "Register an app" survives a redraw (an edit or a delete elsewhere on the page never wipes it)
  function keepDraft() {
    const f = $('dv-new'); if (!f) return;
    const k = f.querySelector('input[name="dv-kind"]:checked');
    draft = { name: $('dv-n-name').value, home: $('dv-n-home').value, redirects: $('dv-n-redirects').value, desc: $('dv-n-desc').value, kind: k ? k.value : 'public' };
  }
  function putDraft() {
    const f = $('dv-new'); if (!f || !draft) return;
    $('dv-n-name').value = draft.name; $('dv-n-home').value = draft.home; $('dv-n-redirects').value = draft.redirects; $('dv-n-desc').value = draft.desc;
    const k = f.querySelector('input[name="dv-kind"][value="' + draft.kind + '"]'); if (k) k.checked = true;
  }
  function render() {
    keepDraft();
    for (const t of armed.values()) clearTimeout(t);
    armed.clear();
    const n = apps.length, full = n >= max;
    body.innerHTML = (shown ? secretPanel(shown) : '') +
      '<p class="dk-note dv-count" id="dv-count" tabindex="-1">' + (n ? 'You have ' + n + ' of ' + max + ' apps.' : 'You have no apps yet. Register one below: it takes a minute.') + '</p>' +
      (n ? '<ul class="dv-app-list" aria-label="Your apps">' + apps.map(appItem).join('') + '</ul>' : '') +
      (full ? '<p class="dk-note">' + max + ' apps is the most one member can have: delete one to register another.</p>' : newForm());
    putDraft();
  }
  function signedOutView() {
    body.innerHTML = '<p class="dk-note">Sign in to register an app, see the ones you have and get their client IDs.</p>' +
      '<div class="dk-actions"><button class="btn btn-primary btn-sm" type="button" id="dv-signin" data-tip="Opens the Just Send It sign-in; your apps show here once you are in">Sign in</button></div>';
  }
  async function load() {
    try {
      const j = await window.api('/api/oauth/apps');
      apps = Array.isArray(j.apps) ? j.apps : []; max = j.max || 5;
      render();
    } catch (err) {
      if (err && err.status === 401) { apps = null; signedOutView(); return; }
      body.innerHTML = '<p class="dk-note">Your apps could not be read just now: ' + esc(err && err.message) + '</p>' +
        '<div class="dk-actions"><button class="btn btn-ghost btn-sm" type="button" id="dv-retry" data-tip="Asks the server for your apps again">Try again</button></div>';
    }
  }
  function boot() {
    const u = window.AUTH && AUTH.user;
    if (!u) { loadedFor = null; apps = null; shown = null; editing = null; signedOutView(); return; }
    if (loadedFor === u.username) return;
    loadedFor = u.username; shown = null; editing = null; draft = null;
    load();
  }

  /* which field a refusal is about, so it is marked and the reader is put there */
  function markField(msg, pre, form) {
    const m = String(msg || '').toLowerCase();
    const which = /redirect/.test(m) ? 'redirects' : /homepage/.test(m) ? 'home' : /description/.test(m) ? 'desc' : /name/.test(m) ? 'name' : null;
    if (!which) return;
    const el = $(pre + which); if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    try { el.focus(); } catch {}
    if (form && !form._clears) { form._clears = true; form.addEventListener('input', (e) => { if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid'); }); }
  }
  const linesOf = (v) => String(v || '').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  function valuesOf(pre) {
    return { name: $(pre + 'name').value.trim(), homepage: $(pre + 'home').value.trim(), redirectUris: linesOf($(pre + 'redirects').value), description: $(pre + 'desc').value.trim() };
  }

  async function create(f) {
    const st = $('dv-n-status'), go = $('dv-n-go');
    const k = f.querySelector('input[name="dv-kind"]:checked');
    const payload = Object.assign(valuesOf('dv-n-'), { kind: k ? k.value : 'public' });
    for (const el of f.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    go.disabled = true; st.textContent = 'Registering the app.';
    try {
      const j = await window.api('/api/oauth/apps', { method: 'POST', body: payload });
      shown = { app: j.app, secret: j.clientSecret || null, kind: 'new' };
      apps.push(j.app); draft = null;
      const f2 = $('dv-new'); if (f2) f2.reset();
      render();
      say(j.app.name + ' is registered.' + (j.clientSecret ? ' Its secret is shown once, above: copy it now.' : ''));
      if (window.SFX) SFX.play('success');
      const p = $('dv-secret'); if (p) { try { p.focus(); p.scrollIntoView({ block: 'nearest' }); } catch {} }
    } catch (err) {
      go.disabled = false;
      st.textContent = err && err.message === 'cancelled' ? '' : '⚠️ ' + ((err && err.message) || 'the app could not be registered');
      markField(err && err.message, 'dv-n-', f);
    }
  }
  async function saveEdit(f) {
    const id = f.getAttribute('data-app'), pre = 'dv-e-' + id + '-', st = f.querySelector('.dv-edit-status');
    for (const el of f.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const go = f.querySelector('button[type="submit"]'); go.disabled = true; st.textContent = 'Saving.';
    try {
      const j = await window.api('/api/oauth/apps/' + encodeURIComponent(id), { method: 'POST', body: valuesOf(pre) });
      apps = apps.map((a) => (a.clientId === id ? j.app : a)); editing = null;
      render();
      say('Saved ' + j.app.name + '.' + (j.reviewCleared ? ' Its review was cleared, because members would now see a different name, homepage or address: it shows "Not reviewed" until an admin looks again.' : ''));
      focusIn(id, '[data-dv-act="edit"]');
    } catch (err) {
      go.disabled = false;
      st.textContent = err && err.message === 'cancelled' ? '' : '⚠️ ' + ((err && err.message) || 'the changes could not be saved');
      markField(err && err.message, pre, f);
    }
  }
  function focusIn(id, sel) {
    const li = body.querySelector('[data-app="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    const el = li && li.querySelector(sel);
    if (el) { try { el.focus(); } catch {} }
  }
  /* A new secret and a delete cannot be undone, so each takes two taps: the first says what the second will do. */
  function arm(b, label, tip) {
    if (armed.has(b)) { clearTimeout(armed.get(b)); armed.delete(b); return true; }
    b.dataset.label = b.textContent; b.dataset.tipWas = b.getAttribute('data-tip');
    b.textContent = label; b.setAttribute('data-tip', tip);
    armed.set(b, setTimeout(() => { armed.delete(b); b.textContent = b.dataset.label; b.setAttribute('data-tip', b.dataset.tipWas); }, 5000));
    if (window.SFX) SFX.play('warn');
    return false;
  }
  async function act(b) {
    const what = b.getAttribute('data-dv-act'), li = b.closest('[data-app]'), id = li && li.getAttribute('data-app');
    const a = apps && apps.find((x) => x.clientId === id); if (!a && what !== 'cancel') return;
    const st = li && li.querySelector('.dv-app-status');
    if (what === 'edit') { editing = id; render(); const n = $('dv-e-' + id + '-name'); if (n) n.focus(); return; }
    if (what === 'cancel') { editing = null; render(); focusIn(id, '[data-dv-act="edit"]'); return; }
    if (what === 'secret') {
      if (!arm(b, 'Tap again for a new secret', 'Tap again within five seconds: the old secret stops working at once')) return;
      b.disabled = true; if (st) st.textContent = 'Making a new secret.';
      try {
        const j = await window.api('/api/oauth/apps/' + encodeURIComponent(id) + '/secret', { method: 'POST' });
        apps = apps.map((x) => (x.clientId === id ? j.app : x));
        shown = { app: j.app, secret: j.clientSecret, kind: 'rotated' };
        render(); say('A new secret for ' + j.app.name + ' is shown once, above. The old one stopped working.');
        const p = $('dv-secret'); if (p) { try { p.focus(); p.scrollIntoView({ block: 'nearest' }); } catch {} }
      } catch (err) { b.disabled = false; if (st) st.textContent = err && err.message === 'cancelled' ? '' : '⚠️ ' + ((err && err.message) || 'no new secret was made'); }
      return;
    }
    if (what === 'delete') {
      if (!arm(b, 'Tap again to delete', 'Tap again within five seconds: the app and every member\'s sign-in to it go for good')) return;
      b.disabled = true; if (st) st.textContent = 'Deleting.';
      try {
        await window.api('/api/oauth/apps/' + encodeURIComponent(id), { method: 'DELETE' });
        apps = apps.filter((x) => x.clientId !== id);
        if (shown && shown.app.clientId === id) shown = null;
        if (editing === id) editing = null;
        render(); say(a.name + ' is deleted, and every sign-in to it has ended.');
        const c = $('dv-count'); if (c) { try { c.focus(); } catch {} }
        if (window.SFX) SFX.play('remove');
      } catch (err) { b.disabled = false; if (st) st.textContent = err && err.message === 'cancelled' ? '' : '⚠️ ' + ((err && err.message) || 'the app could not be deleted'); }
    }
  }

  body.addEventListener('submit', (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.id === 'dv-new') create(f);
    else if (f.classList.contains('dv-edit')) saveEdit(f);
  });
  body.addEventListener('click', (e) => {
    if (e.target.closest('#dv-signin')) { if (window.AUTH && typeof AUTH.open === 'function') AUTH.open(); return; }
    if (e.target.closest('#dv-retry')) { load(); return; }
    if (e.target.closest('#dv-secret-done')) { shown = null; render(); say('The secret is gone from this page.'); const c = $('dv-count'); if (c) { try { c.focus(); } catch {} } return; }
    const b = e.target.closest('[data-dv-act]');
    if (b) act(b);
  });
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
