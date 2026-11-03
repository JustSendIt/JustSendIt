/* ===== Settings → Apps you've signed in to (Sign in with Send; lib/oidc.js) =====
   Owner, 2026-11-03: members sign in to apps built around Send with their Send account "in a similar more decentralised and
   secure and private fashion that does not data farm them". This is where a member sees every app they allowed, what each
   one can see and since when, and takes it back. A thin face on two routes; every word about an app is the server's:
     GET    /api/oauth/grants              { grants: [{ clientId, name, homepage, redirectHosts, reviewed, disabled, shares, grantedAt, signedInUntil }] }
     DELETE /api/oauth/grants/<clientId>   Revoke: its tokens end now, and what was allowed is forgotten
   The consent page links here as /profile#sec-apps: that opens the Settings tab (dashtabs.js) and this card. */
(function () {
  const card = document.getElementById('sec-apps');
  if (!card) return;
  const list = document.getElementById('grant-list'), note = document.getElementById('grant-note'), state = document.getElementById('apps-state');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (t) => { try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const when = (t) => { try { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  let grants = null, loadedFor = null, armed = null, loadedAt = 0;

  // the visible word, and the app's name for a screen reader (several Revoke buttons in a row must say which is which)
  const label = (word, name) => word + '<span class="sr-only"> ' + esc(name) + '</span>';
  function row(g) {
    const hp = String(g.homepage || '').replace(/^https:\/\//, '').replace(/\/$/, '');
    const hosts = (g.redirectHosts || []).filter((h) => h && h !== hp);
    const live = g.signedInUntil
      ? 'Signed in until ' + esc(when(g.signedInUntil)) + ', unless you revoke it.'
      : 'Not signed in right now. Because you allowed it, it can sign you in again for the same things without asking; revoke it to make it ask.';
    return '<li class="grant-row" data-client="' + esc(g.clientId) + '">' +
      '<div class="grant-head"><b class="grant-name">' + esc(g.name) + '</b>' +
        '<a class="grant-home" href="' + esc(g.homepage) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(hp) + '</a>' +
        (g.disabled ? '<span class="grant-chip is-warn">Switched off by Just Send It</span>' : g.reviewed ? '<span class="grant-chip is-ok">Reviewed by Just Send It</span>' : '<span class="grant-chip">Not reviewed by Just Send It</span>') +
      '</div>' +
      '<p class="grant-line">It can see:</p><ul class="grant-sees">' + (g.shares || []).map((s) => '<li>' + esc(s.label) + '</li>').join('') + '</ul>' +
      '<p class="grant-line grant-when">Allowed on ' + esc(day(g.grantedAt)) + (g.updatedAt && g.updatedAt !== g.grantedAt ? ', last changed ' + esc(day(g.updatedAt)) : '') + '. ' + live +
        (hosts.length ? ' It sends you back to ' + hosts.map(esc).join(', ') + '.' : '') + '</p>' +
      '<button class="btn btn-ghost btn-sm grant-revoke" type="button" data-revoke="' + esc(g.clientId) + '" data-tip="Ends this app\'s sign-in at once and forgets what you allowed it to see (tap twice)">' + label('Revoke', g.name) + '</button>' +
      '</li>';
  }
  function render() {
    if (armed) { clearTimeout(armed.t); armed = null; }
    // a redraw must not drop the reader: focus on a Revoke button comes back to that app's new one
    const had = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-revoke');
    const n = grants.length;
    if (state) state.textContent = n ? n + (n === 1 ? ' app' : ' apps') : '';
    list.innerHTML = grants.map(row).join('');
    note.textContent = n ? '' : 'You have not signed in to any app with your Send account yet. When you do, it shows here.';
    if (had) { const b = list.querySelector('[data-revoke="' + (window.CSS && CSS.escape ? CSS.escape(had) : had) + '"]'); if (b) { try { b.focus({ preventScroll: true }); } catch {} } }
  }
  async function load() {
    try {
      const j = await window.api('/api/oauth/grants');
      loadedAt = Date.now();
      grants = Array.isArray(j.grants) ? j.grants : [];
      render();
    } catch (err) {
      if (err && err.status === 401) return;
      note.textContent = 'Your apps could not be read just now: ' + ((err && err.message) || 'try again in a minute') + '.';
    }
  }
  function boot() {
    const u = window.AUTH && AUTH.user;
    if (!u) { loadedFor = null; grants = null; list.innerHTML = ''; note.textContent = ''; if (state) state.textContent = ''; return; }
    if (loadedFor === u.username) return;
    loadedFor = u.username;
    load();
  }
  // opened again later: read it fresh (an app may have been allowed in another tab since)
  card.addEventListener('toggle', () => { if (card.open && loadedFor && !armed && Date.now() - loadedAt > 5000) load(); });

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revoke]'); if (!b) return;
    const id = b.getAttribute('data-revoke'), g = (grants || []).find((x) => x.clientId === id); if (!g) return;
    // two taps: the first says what the second does
    if (!armed || armed.b !== b) {
      if (armed) { clearTimeout(armed.t); armed.b.innerHTML = label('Revoke', armed.name); }
      b.innerHTML = label('Tap again to revoke', g.name);
      note.textContent = 'Press Revoke again within five seconds to revoke ' + g.name + '.';
      armed = { b, name: g.name, t: setTimeout(() => { armed = null; b.innerHTML = label('Revoke', g.name); note.textContent = ''; }, 5000) };
      if (window.SFX) SFX.play('warn');
      return;
    }
    clearTimeout(armed.t); armed = null;
    b.disabled = true; b.innerHTML = label('Revoking', g.name);
    try {
      const j = await window.api('/api/oauth/grants/' + encodeURIComponent(id), { method: 'DELETE' });
      grants = Array.isArray(j.grants) ? j.grants : grants.filter((x) => x.clientId !== id);
      render();
      note.textContent = g.name + ' is revoked: its sign-in has ended, and it gets nothing more from your account unless you sign in to it again.';
      try { note.setAttribute('tabindex', '-1'); note.focus({ preventScroll: true }); } catch {}   // the button that had focus is gone
      if (window.SFX) SFX.play('remove');
      if (window.sendToast) sendToast('Revoked ' + g.name);
    } catch (err) {
      b.disabled = false; b.innerHTML = label('Revoke', g.name);
      note.textContent = '⚠️ ' + ((err && err.message) || 'it could not be revoked just now');
    }
  });

  /* /profile#sec-apps (the consent page's link): open this card once the signed-in page is up, then tidy the address */
  function fromLink() {
    if (location.hash !== '#sec-apps' || !(window.AUTH && AUTH.user)) return;
    setTimeout(() => {
      if (typeof window.openCard === 'function') window.openCard('sec-apps', true); else { card.open = true; try { card.scrollIntoView({ block: 'start' }); } catch {} }
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch {}
    }, 80);
  }
  addEventListener('hashchange', fromLink);
  const start = () => { boot(); fromLink(); };
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(start, start); else start();
  document.addEventListener('auth:change', boot);
})();
