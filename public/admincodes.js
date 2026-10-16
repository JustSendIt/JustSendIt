/* ===== Admin invite codes =====
   Owner, 2026-10-16: "Generate me 100 active admin codes that are shown on the admin page similar to how the invite codes
   are shown on someone's profile, but only for the admin to give out to people. Still track who uses the code and the user
   names that sign up under the codes, and across the platform if a user signs up under a code and sets up a profile make
   that user name in that code sign up a hyperlink that take the user to that new user's profile page."
   Admin-only, like admin.js: the server answers 404 for this file to anyone whose id is not in ADMIN_USER_IDS. A thin face
   on one route:
     GET  /api/admin/codes                     the codes and what became of each (the first visit makes the first 100)
     POST /api/admin/codes {confirm: 'MINT'}   100 more (needs "confirm it's you": auth.js's api() opens that step)
   Every code, state, number and name is the server's. */
(function () {
  const sec = document.getElementById('adm-codes');
  if (!sec) return;
  const body = document.getElementById('adm-codes-body'), people = document.getElementById('adm-codes-people');
  const sum = document.getElementById('adm-codes-sum'), status = document.getElementById('adm-codes-status'), mint = document.getElementById('adm-codes-mint');
  const showBtns = Array.from(sec.querySelectorAll('[data-codes-show]'));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 6e4)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const call = (path, opts) => (window.api ? window.api(path, opts) : fetch(path, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'request failed (' + r.status + ')'); return j; }));
  let data = null, show = 'unused', shownFor = null, armed = null;

  /* The account a code let in: a link to its profile once that profile is set up (it picked a name of its own); before
     that, its name as it stands and why it is not a link yet; an erased account is said to be gone. */
  function who(by) {
    if (!by) return 'signed up';
    if (by.deleted) return '<span class="adm-codes-gone">an account since deleted</span>';
    if (by.link) return '<a href="' + esc(by.link) + '" data-tip="Opens their profile">@' + esc(by.username) + '</a>';
    return '@' + esc(by.username) + ' <small>(profile not set up yet)</small>';
  }
  function item(c) {
    if (c.state === 'unused') {
      const label = c.freed ? 'copy · freed again (a sign-up was never finished)' : 'copy';
      return '<li><button class="adm-code" type="button" data-c="' + esc(c.code) + '" data-label="' + esc(label) + '" data-tip="Copies this unused code so you can give it to someone">' +
        '<span class="adm-code-chars">' + esc(c.code) + '</span><span class="adm-code-tag">' + esc(label) + '</span></button></li>';
    }
    if (c.state === 'pending') {
      return '<li><span class="adm-code is-pending"><span class="adm-code-chars">' + esc(c.code) + '</span>' +
        '<span class="adm-code-tag">entered ' + esc(ago(c.usedAt)) + ' · sign-up not finished (it frees up after ' + esc(data.reclaimMinutes) + ' min)</span></span></li>';
    }
    return '<li><span class="adm-code is-used"><span class="adm-code-chars">' + esc(c.code) + '</span><span class="adm-code-tag">used · ' + who(c.by) + '</span></span></li>';
  }
  function render() {
    for (const b of showBtns) b.setAttribute('aria-pressed', String(b.getAttribute('data-codes-show') === show));   // the choice shows at once, even while the list is still on its way
    if (!data) return;
    const k = data.counts, full = k.total >= data.max;
    for (const s of sec.querySelectorAll('[data-codes-n]')) s.textContent = '(' + num(k[s.getAttribute('data-codes-n')]) + ')';
    const list = data.codes.filter((c) => show === 'all' || c.state === show);
    const none = { unused: full ? 'Every code has been used.' : 'Every code has been used — make more below.', used: 'Nobody has signed up with one of these yet.', pending: 'No sign-up is in progress right now.', all: 'No admin codes yet.' };
    // the one line a screen reader hears: the grid itself is not a live region (it would read out every code on each redraw)
    sum.textContent = num(k.unused) + ' of ' + num(k.total) + ' unused · ' + num(k.used) + ' signed up' + (k.pending ? ' · ' + num(k.pending) + ' in progress' : '') + ' · showing ' + num(list.length);
    body.innerHTML = list.length ? '<ul class="adm-code-list">' + list.map(item).join('') + '</ul>' : '<p class="modal-note">' + none[show] + '</p>';
    // who signed up with them, newest first: the record of people, each name a way to their profile
    const used = data.codes.filter((c) => c.state === 'used').sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
    people.innerHTML = used.length
      ? '<div class="adm-codes-table"><table><thead><tr><th scope="col">Signed up as</th><th scope="col">With code</th><th scope="col">Code entered</th><th scope="col">Joined</th></tr></thead><tbody>' +
        used.map((c) => '<tr><td>' + who(c.by) + '</td><td class="adm-codes-mono">' + esc(c.code) + '</td><td>' + esc(when(c.usedAt)) + '</td><td>' + (c.by && c.by.joinedAt ? esc(when(c.by.joinedAt)) : '') + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<p class="modal-note">Nobody has signed up with an admin code yet. When someone does, their name shows here — a link to their profile once they have set it up.</p>';
    disarm();
    mint.disabled = full;
    if (full) { mint.textContent = 'Make more'; mint.title = 'There are ' + num(k.total) + ' admin codes, the most there can be.'; status.textContent = 'There are ' + num(k.total) + ' admin codes, the most there can be.'; }
    else mint.removeAttribute('title');
  }
  function clear() {
    data = null; shownFor = null;
    body.innerHTML = ''; people.innerHTML = ''; sum.textContent = ''; status.textContent = '';
    for (const s of sec.querySelectorAll('[data-codes-n]')) s.textContent = '';
  }
  async function load() {
    sum.textContent = 'Reading the codes…';
    try { data = await call('/api/admin/codes'); render(); }
    catch (e) { sum.textContent = '⚠️ ' + ((e && e.message) || 'could not read the codes'); }
  }
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('.adm-code[data-c]'); if (!b) return;
    const tag = b.querySelector('.adm-code-tag');
    try { await navigator.clipboard.writeText(b.dataset.c); tag.textContent = 'copied ✓'; if (window.SFX) SFX.play('copy'); }
    catch {   // clipboard refused (http, or permission): select it instead, so ⌘C or a long-press still works
      const r = document.createRange(); r.selectNodeContents(b.querySelector('.adm-code-chars'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      tag.textContent = 'selected — copy it';
    }
    clearTimeout(b._back); b._back = setTimeout(() => { tag.textContent = b.dataset.label; }, 2200);   // back to its own label, however often it is tapped
  });
  for (const b of showBtns) b.addEventListener('click', () => { show = b.getAttribute('data-codes-show'); render(); });
  document.getElementById('adm-codes-refresh').addEventListener('click', load);

  /* Making codes cannot be undone and each one counts toward the ceiling, so it takes two taps: the first asks, the second
     (within five seconds) makes them. The server still wants "confirm it's you" when that has not been done lately. */
  const n = () => (data ? Math.min(data.batch, Math.max(0, data.max - data.counts.total)) : 100);
  function disarm() {
    clearTimeout(armed); armed = null;
    mint.textContent = 'Make ' + n() + ' more';
    mint.setAttribute('data-tip', 'Makes ' + n() + ' more admin codes: tap twice to be sure (and confirm it\'s you, if you have not lately)');
  }
  mint.addEventListener('click', async () => {
    if (!armed) {
      mint.textContent = 'Tap again to make ' + n() + ' codes';
      mint.setAttribute('data-tip', 'Tap again within five seconds to make them — or leave it and nothing happens');
      armed = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    mint.disabled = true; status.textContent = 'Making more codes…';
    try {
      data = await call('/api/admin/codes', { method: 'POST', body: { confirm: 'MINT' } });
      status.textContent = 'Done — ' + num(data.counts.total) + ' admin codes in all.';
      if (window.SFX) SFX.play('success');
      show = 'unused'; render();
    } catch (e) {
      status.textContent = e && e.message === 'cancelled' ? '' : '⚠️ ' + ((e && e.message) || 'could not make more codes');
      mint.disabled = !!(data && data.counts.total >= data.max);
    }
  });

  // shown to an admin only, read once a visit (auth:change fires for the same sign-in too); signing out takes every code off the page
  function boot() {
    const u = window.AUTH && AUTH.user, ok = !!(u && u.admin);
    sec.hidden = !ok;
    if (!ok) { clear(); return; }
    const id = u.id || u.username;
    if (shownFor === id) return;
    shownFor = id; load();
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
