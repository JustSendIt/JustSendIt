/* ===== Admin: Sign in with Send — the registered apps and the signing keys (lib/oidc.js) =====
   Admin-only, like admin.js: the server answers 404 for this file and for every /api/admin route to anyone whose id is not
   in ADMIN_USER_IDS. A thin face on four routes; every app, number and state is the server's:
     GET  /api/admin/oauth/apps                    every app (with its owner, members and live tokens) and the keys
     POST /api/admin/oauth/apps/<clientId>         { reviewed: true|false } or { disabled: true|false, reason }
     POST /api/admin/oauth/keys/rotate             a new signing key: published now, signing a day later
   Reviewing changes one line on an app's sign-in page. Switching an app off stops its sign-ins and kills its tokens at
   once; members' consents are kept, so switching it back on does not make them answer again. */
(function () {
  const sec = document.getElementById('adm-apps');
  if (!sec) return;
  const body = document.getElementById('adm-apps-body'), sum = document.getElementById('adm-apps-sum');
  const keysEl = document.getElementById('adm-apps-keys'), keyStatus = document.getElementById('adm-apps-keys-status'), rotate = document.getElementById('adm-apps-rotate');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { try { return t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch { return ''; } };
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const call = (path, opts) => (window.api ? window.api(path, opts) : Promise.reject(new Error('the page has not finished loading')));
  let data = null, shownFor = null, armed = null;
  const STATE_WORDS = { next: 'waiting: published, signs from its start', signing: 'signing now', retired: 'retired: still published, signs nothing' };

  function owner(o) {
    if (!o) return 'none: set up by the operator';
    if (!o.username) return '<span class="adm-codes-gone">an account since deleted</span>';
    return '<a href="/u/' + encodeURIComponent(o.username) + '" data-tip="Opens the developer\'s Send Wall">@' + esc(o.username) + '</a>' + (o.sendId ? ' · Send ID #' + esc(o.sendId) : '') + ' · user ' + esc(o.id);
  }
  function appRow(a) {
    const hp = String(a.homepage || '').replace(/^https:\/\//, '').replace(/\/$/, '');
    const rid = 'adm-app-why-' + a.clientId;
    return '<article class="adm-app' + (a.disabled ? ' is-off' : '') + '" data-app="' + esc(a.clientId) + '">' +
      '<div class="adm-app-head"><h4 class="adm-app-name">' + esc(a.name) + '</h4>' +
        '<span class="adm-app-chip">' + (a.kind === 'confidential' ? 'confidential' : 'public') + '</span>' +
        (a.reviewed ? '<span class="adm-app-chip is-ok">reviewed ' + esc(when(a.reviewedAt)) + '</span>' : '<span class="adm-app-chip">not reviewed</span>') +
        (a.disabled ? '<span class="adm-app-chip is-warn">switched off</span>' : '') + '</div>' +
      '<dl class="adm-app-dl">' +
        '<div><dt>Client ID</dt><dd><code>' + esc(a.clientId) + '</code></dd></div>' +
        '<div><dt>Registered by</dt><dd>' + owner(a.owner) + '</dd></div>' +
        '<div><dt>Homepage</dt><dd><a href="' + esc(a.homepage) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(hp) + '</a></dd></div>' +
        '<div><dt>Sends members back to</dt><dd><ul>' + (a.redirectUris || []).map((u) => '<li><code>' + esc(u) + '</code></li>').join('') + '</ul></dd></div>' +
        (a.description ? '<div><dt>It says</dt><dd>' + esc(a.description) + '</dd></div>' : '') +
        '<div><dt>Members</dt><dd>' + num(a.members) + ' allowed it · ' + num(a.liveTokens) + ' live token' + (a.liveTokens === 1 ? '' : 's') + '</dd></div>' +
        '<div><dt>Registered</dt><dd>' + esc(when(a.createdAt)) + (a.updatedAt && a.updatedAt !== a.createdAt ? ' · changed ' + esc(when(a.updatedAt)) : '') + '</dd></div>' +
        (a.disabled ? '<div><dt>Switched off</dt><dd>' + esc(when(a.disabledAt)) + (a.disabledReason ? ': ' + esc(a.disabledReason) : '') + '</dd></div>' : '') +
      '</dl>' +
      '<div class="adm-actions">' +
        (a.reviewed
          ? '<button class="btn btn-sm" type="button" data-app-act="unreview" data-tip="Takes the review back: its sign-in page says Not reviewed by Just Send It again">Mark not reviewed</button>'
          : '<button class="btn btn-sm btn-primary" type="button" data-app-act="review" data-tip="Its sign-in page then says Reviewed by Just Send It, with today\'s date">Mark reviewed</button>') +
        (a.disabled
          ? '<button class="btn btn-sm" type="button" data-app-act="enable" data-tip="Lets it sign members in again; those who allowed it are not asked again">Switch back on</button>'
          : '<span class="adm-app-why"><label class="f-label" for="' + esc(rid) + '">Why (its developer sees this)</label><input class="addr-input" id="' + esc(rid) + '" maxlength="200" placeholder="misleading name, phishing" autocomplete="off"></span>' +
            '<button class="btn btn-sm" type="button" data-app-act="disable" data-tip="Stops its sign-ins and ends its tokens now (tap twice)">Switch off</button>') +
      '</div><p class="modal-note adm-app-status" role="status" aria-live="polite"></p></article>';
  }
  // one card per key (a list, not a wide table: it fits a phone without scrolling sideways)
  function keyRows(keys) {
    if (!keys || !keys.length) return '<p class="modal-note">No signing key yet: the first is made when the first sign-in or the published keys ask for one.</p>';
    return '<ul class="adm-keys" aria-label="Signing keys">' + keys.map((k) => '<li class="adm-key"><dl class="adm-app-dl">' +
      '<div><dt>Key ID</dt><dd><code>' + esc(k.kid) + '</code></dd></div>' +
      '<div><dt>State</dt><dd>' + esc(STATE_WORDS[k.state] || k.state) + '</dd></div>' +
      '<div><dt>Made</dt><dd>' + esc(when(k.createdAt)) + '</dd></div>' +
      '<div><dt>Signs from</dt><dd>' + esc(when(k.activeFrom)) + '</dd></div>' +
      '<div><dt>Published until</dt><dd>' + (k.publishedUntil ? esc(when(k.publishedUntil)) : 'while it signs') + '</dd></div>' +
      '<div><dt>Private half</dt><dd>' + (k.hasPrivate ? 'kept, encrypted' : 'dropped') + '</dd></div>' +
      '</dl></li>').join('') + '</ul>';
  }
  function render() {
    if (!data) return;
    const apps = data.apps || [];
    const off = apps.filter((a) => a.disabled).length, rev = apps.filter((a) => a.reviewed).length;
    sum.textContent = apps.length ? num(apps.length) + ' app' + (apps.length === 1 ? '' : 's') + ' · ' + num(rev) + ' reviewed · ' + num(off) + ' switched off' : 'No app has been registered yet.';
    body.innerHTML = apps.map(appRow).join('');
    keysEl.innerHTML = keyRows(data.keys);
  }
  async function load() {
    sum.textContent = 'Reading the apps.';
    try { data = await call('/api/admin/oauth/apps'); render(); }
    catch (e) { sum.textContent = '⚠️ ' + ((e && e.message) || 'could not read the apps'); }
  }
  async function change(art, payload, done) {
    const st = art.querySelector('.adm-app-status'), id = art.getAttribute('data-app');
    for (const b of art.querySelectorAll('button')) b.disabled = true;
    st.textContent = 'Saving.';
    try {
      const j = await call('/api/admin/oauth/apps/' + encodeURIComponent(id), { method: 'POST', body: payload });
      data.apps = data.apps.map((a) => (a.clientId === id ? Object.assign({}, a, j.app, { liveTokens: payload.disabled ? 0 : a.liveTokens }) : a));
      render();
      const again = body.querySelector('[data-app="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      if (again) { again.querySelector('.adm-app-status').textContent = done; const b = again.querySelector('button'); if (b) b.focus(); }
    } catch (e) {
      for (const b of art.querySelectorAll('button')) b.disabled = false;
      st.textContent = e && e.message === 'cancelled' ? '' : '⚠️ ' + ((e && e.message) || 'that did not save');
    }
  }
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-app-act]'); if (!b) return;
    const art = b.closest('[data-app]'), what = b.getAttribute('data-app-act');
    if (what === 'review') return change(art, { reviewed: true }, 'Marked reviewed: its sign-in page says so now.');
    if (what === 'unreview') return change(art, { reviewed: false }, 'The review is taken back.');
    if (what === 'enable') return change(art, { disabled: false }, 'Switched back on: it can sign members in again.');
    if (what === 'disable') {
      if (!armed || armed.b !== b) {
        if (armed) { clearTimeout(armed.t); armed.b.textContent = 'Switch off'; }
        b.textContent = 'Tap again to switch off';
        armed = { b, t: setTimeout(() => { armed = null; b.textContent = 'Switch off'; }, 5000) };
        return;
      }
      clearTimeout(armed.t); armed = null;
      const why = art.querySelector('.adm-app-why input');
      return change(art, { disabled: true, reason: why ? why.value.trim() : '' }, 'Switched off: its sign-ins stopped and its tokens ended.');
    }
  });

  let rotArmed = null;
  rotate.addEventListener('click', async () => {
    if (!rotArmed) {
      rotate.textContent = 'Tap again to rotate';
      rotArmed = setTimeout(() => { rotArmed = null; rotate.textContent = 'Rotate the signing key'; }, 5000);
      return;
    }
    clearTimeout(rotArmed); rotArmed = null; rotate.textContent = 'Rotate the signing key';
    rotate.disabled = true; keyStatus.textContent = 'Making a new key.';
    try {
      const j = await call('/api/admin/oauth/keys/rotate', { method: 'POST' });
      if (data) { data.keys = j.keys; render(); }
      keyStatus.textContent = (j.rotated && j.rotated.already ? 'A new key was already waiting: it signs from ' : 'A new key is published now and signs from ') + when(j.rotated && j.rotated.activeFrom) + '.';
    } catch (e) { keyStatus.textContent = e && e.message === 'cancelled' ? '' : '⚠️ ' + ((e && e.message) || 'no new key was made'); }
    rotate.disabled = false;
  });
  document.getElementById('adm-apps-refresh').addEventListener('click', load);

  // shown to an admin only, read once a visit; signing out takes it all off the page
  function boot() {
    const u = window.AUTH && AUTH.user, ok = !!(u && u.admin);
    sec.hidden = !ok;
    if (!ok) { data = null; shownFor = null; body.innerHTML = ''; keysEl.innerHTML = ''; sum.textContent = ''; return; }
    const id = u.id || u.username;
    if (shownFor === id) return;
    shownFor = id; load();
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
