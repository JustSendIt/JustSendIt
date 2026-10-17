/* ===== Restore a member's data =====
   Owner, 2026-10-17: "make sure all data is always cached so errors like this never happen and we can restore user's data
   if we need to from the admin page." The server keeps the earlier version of a member's data on every change and
   deletion (server.js "Data history"); this is the admin's face on it:
     GET  /api/admin/history?user=<name>                      what is kept for that member, newest first
     POST /api/admin/history/restore {id, confirm: 'RESTORE'}  put one entry back (needs "confirm it's you": auth.js's api())
   Admin-only, like admin.js: the server answers 404 for this file to anyone else. Every value shown is the server's. */
(function () {
  const sec = document.getElementById('adm-hist');
  if (!sec) return;
  const form = document.getElementById('adm-hist-form'), input = document.getElementById('adm-hist-user');
  const sum = document.getElementById('adm-hist-sum'), list = document.getElementById('adm-hist-list');
  const kindSel = document.getElementById('adm-hist-kind'), olderBtn = document.getElementById('adm-hist-older');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };
  const day = (t) => { try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  const usd = (n) => (n == null || !isFinite(n) ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : n >= 1 ? '$' + Number(n).toFixed(2) : '$' + Number(n).toPrecision(4));
  // long text is shortened at a word boundary, never through a word
  const clip = (t, n) => { const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const cut = s.slice(0, n).replace(/\s+\S*$/, ''); return (cut || s.slice(0, n)) + ' …'; };
  const call = (path, opts) => (window.api ? window.api(path, opts) : fetch(path, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'request failed (' + r.status + ')'); return j; }));
  let who = '', armed = null, more = null, shown = 0;

  /* What an entry was, in words: the kept version, set against what is there now when that helps. */
  function describe(e) {
    const o = e.old || {}, gone = e.op === 'delete';
    switch (e.tbl) {
      case 'pinned_tokens': return 'Conviction Play $' + esc(o.symbol || '?') + (gone ? ' removed' : ' changed') + ' — it ran from <b>' + esc(day(o.added_at)) + '</b> at ' + esc(usd(o.pin_price)) + (o.pin_mc ? ' (market cap ' + esc(usd(o.pin_mc)) + ')' : '') +
        (e.now ? ' · now: from ' + esc(day(e.now.added_at)) + ' at ' + esc(usd(e.now.pin_price)) : gone ? '' : ' · it no longer exists');
      case 'posts': return 'Post #' + esc(o.id) + (o.call_id ? ' (a Send Call)' : '') + (gone ? ' deleted' : ' edited') + ' — it read “' + esc(clip(o.text, 160)) + '”' + (o.image ? ' with a picture' : '');
      case 'comments': case 'hop_comments': return esc(e.what[0].toUpperCase() + e.what.slice(1)) + ' #' + esc(o.id) + (gone ? ' deleted' : ' edited') + ' — it read “' + esc(clip(o.text, 160)) + '”';
      case 'calls': return 'Send Call #' + esc(o.id) + ' on $' + esc(o.symbol || '?') + (gone ? ' deleted' : ' changed') + ' — entry ' + esc(usd(o.entry_price)) + (o.entry_mc ? ' (market cap ' + esc(usd(o.entry_mc)) + ')' : '') + ' on ' + esc(day(o.created_at));
      case 'users': {
        const keys = ['username', 'bio', 'avatar', 'avatar_img', 'header_img', 'bg_img', 'accent', 'wall_bg', 'twitter_handle', 'ig_handle'];
        const changed = keys.filter((k) => !e.now || String(e.now[k] == null ? '' : e.now[k]) !== String(o[k] == null ? '' : o[k]));
        return 'Profile changed — it was ' + (changed.length ? changed.map((k) => esc(k.replace(/_/g, ' ')) + ' “' + esc(clip(o[k], 60)) + '”').join(', ') : 'as it is now');
      }
      case 'holder_state': return 'Diamond Hands streak changed — it ran from <b>' + esc(o.streak_start ? day(o.streak_start) : 'no streak') + '</b>' + (e.now ? ' · now from ' + esc(e.now.streak_start ? day(e.now.streak_start) : 'no streak') : '');
      case 'community_members': return 'Membership of the ' + esc(e.ctx || 'community') + ' ended — a member since ' + esc(day(o.joined_at)) + (o.qualified ? ', verified' : '');
      case 'squad_members': return 'Membership of the Send Squad ' + esc(e.ctx || '') + ' ended — a member since ' + esc(day(o.joined_at));
      case 'watchlist': { let sym = ''; try { const sn = JSON.parse(o.snapshot || 'null'); sym = sn && sn.token && sn.token.symbol ? '$' + sn.token.symbol + ' ' : ''; } catch {}
        return 'Watchlist entry ' + esc(sym) + 'ended (token ' + esc(o.token_addr) + ') — on it since ' + esc(day(o.added_at)); }
      case 'follows': return 'Follow of ' + esc(e.ctx || 'someone') + ' ended — followed since ' + esc(day(o.created_at));
      case 'alerts': return 'Post alerts for ' + esc(e.ctx || 'someone') + ' ended — on since ' + esc(day(o.created_at));
      default: return esc(e.what) + (gone ? ' deleted' : ' changed');
    }
  }
  function row(e) {
    const btn = e.restorable
      ? '<button class="btn btn-sm" type="button" data-hist-id="' + esc(e.id) + '" data-tip="Puts this ' + esc(e.what) + ' back as it was — a second tap confirms">' + (e.restoredAt ? 'Restore again' : 'Restore') + '</button>'
      : '<span class="adm-hist-no">cannot be put back: ' + esc(e.blocked || 'not this kind') + '</span>';
    return '<li class="adm-hist-row"><div class="adm-hist-what">' + describe(e) + '</div>' +
      '<div class="adm-hist-meta"><span>' + esc(when(e.at)) + '</span>' + (e.restoredAt ? '<span class="adm-hist-done">✓ put back ' + esc(when(e.restoredAt)) + '</span>' : '') + btn + '</div></li>';
  }
  async function load(name, older) {
    if (!older) { who = String(name || '').trim().replace(/^@/, ''); more = null; shown = 0; }
    if (!who) { sum.textContent = 'Type a member\'s username.'; list.innerHTML = ''; olderBtn.hidden = true; return; }
    if (!older) { sum.textContent = 'Reading what is kept for @' + who + '…'; list.innerHTML = ''; }
    olderBtn.disabled = true;
    try {
      const q = '/api/admin/history?user=' + encodeURIComponent(who) + (kindSel.value ? '&kind=' + encodeURIComponent(kindSel.value) : '') + (older && more ? '&before=' + more : '');
      const j = await call(q);
      who = j.user.username; more = j.more; shown += j.entries.length;
      if (!older) {   // the kinds this member has, for the filter, keeping the one chosen
        const pick = kindSel.value;
        kindSel.innerHTML = '<option value="">everything</option>' + j.kinds.map((k) => '<option value="' + esc(k.kind) + '">' + esc(k.what) + ' (' + k.n + ')</option>').join('');
        kindSel.value = j.kinds.some((k) => k.kind === pick) ? pick : '';
      }
      sum.textContent = '@' + j.user.username + (j.user.deleted ? ' (account deleted)' : '') + ': ' + j.total.toLocaleString('en-US') + ' kept ' + (j.total === 1 ? 'version' : 'versions') + (kindSel.value ? ' of this kind' : '') + (j.total > shown ? ', the newest ' + shown.toLocaleString('en-US') + ' shown' : '') + '.';
      const html = j.entries.map(row).join('');
      if (older) { const ul = list.querySelector('.adm-hist-list'); if (ul) ul.insertAdjacentHTML('beforeend', html); }
      else list.innerHTML = j.entries.length ? '<ul class="adm-hist-list">' + html + '</ul>' : '<p class="modal-note">Nothing has been changed or deleted for this member yet' + (kindSel.value ? ' of this kind' : '') + '.</p>';
      olderBtn.hidden = !more;
    } catch (e) { sum.textContent = '⚠️ ' + ((e && e.message) || 'could not read it'); }
    olderBtn.disabled = false;
  }
  kindSel.addEventListener('change', () => { if (who) load(who); });
  olderBtn.addEventListener('click', () => load(who, true));
  form.addEventListener('submit', (e) => { e.preventDefault(); load(input.value); });
  /* Putting data back changes a member's account, so it takes two taps (the first asks, and lapses after five seconds)
     and the server wants "confirm it's you" when that has not been done lately. */
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hist-id]'); if (!b) return;
    if (armed !== b) {
      if (armed) { armed.textContent = armed._label; }
      armed = b; b._armedAt = Date.now(); b._label = b.textContent; b.textContent = 'Put it back?';
      clearTimeout(b._t); b._t = setTimeout(() => { if (armed === b) { b.textContent = b._label; armed = null; } }, 5000);
      return;
    }
    if (e.detail > 1 || Date.now() - (b._armedAt || 0) < 600) return;   // the second half of a double-click is not an answer
    clearTimeout(b._t); armed = null; b.disabled = true; b.textContent = 'Putting it back…';
    try {
      const j = await call('/api/admin/history/restore', { method: 'POST', body: { id: Number(b.getAttribute('data-hist-id')), confirm: 'RESTORE' } });
      if (window.SFX) SFX.play('success');
      await load(who);
      sum.textContent = '✓ Put back: ' + j.restored.what + (j.note ? ' — ' + j.note : '') + '. ' + sum.textContent;
    } catch (err) {
      b.disabled = false; b.textContent = b._label || 'Restore';
      if (!(err && err.message === 'cancelled')) sum.textContent = '⚠️ ' + ((err && err.message) || 'could not put it back');
    }
  });

  function boot() {
    const u = window.AUTH && AUTH.user, ok = !!(u && u.admin);
    sec.hidden = !ok;
    if (!ok) { list.innerHTML = ''; sum.textContent = ''; who = ''; more = null; olderBtn.hidden = true; }
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
