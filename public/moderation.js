/* ===== moderation.js — user-side mutes: window.MUTES + a global decorator for muted senders =====
 * The server already drops muted authors from the Send Wall feed, community walls and comment lists for the
 * signed-in viewer. This module covers the rest of the UI:
 *   • window.MUTES  = { has, list, mute, unmute, refresh } — keeps AUTH.user.mutes in sync, fires 'mutes:change'
 *   • u.html        — "🛡️ Moderation ▾" menu button on someone else's public wall (mute / unmute) + red header
 *   • everywhere    — a debounced MutationObserver paints muted @names red with a 🔇 flag (popdown: unmute / keep)
 *                     and hides post cards / comments a muted user authored (except on that user's own wall)
 * CSP-safe (addEventListener only). Every user-controlled string is esc()'d before it touches innerHTML, and no
 * selector is ever built from a username — names are read from href/text and compared in JS. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (n) => String(n == null ? '' : n).trim().replace(/^@/, '').toLowerCase();
  const signedIn = () => !!(window.AUTH && AUTH.user);
  const toast = (m) => { if (window.sendToast) sendToast(m); };
  const say = (m) => { if (window.announce) announce(m); };

  /* ---------------- state: window.MUTES ---------------- */
  let set = new Set();
  function sync() {
    const arr = (signedIn() && Array.isArray(AUTH.user.mutes)) ? AUTH.user.mutes : [];
    set = new Set(arr.map(norm));
  }
  function fire() { document.dispatchEvent(new CustomEvent('mutes:change', { detail: { mutes: MUTES.list() } })); }
  async function setMute(name, on) {
    if (!signedIn()) { if (window.AUTH && AUTH.open) AUTH.open(); throw new Error('Sign in to mute senders'); }
    const j = await window.api('/api/mutes/' + encodeURIComponent(String(name).replace(/^@/, '')), { method: on ? 'POST' : 'DELETE' });
    if (AUTH.user) AUTH.user.mutes = Array.isArray(j.mutes) ? j.mutes : [];
    sync(); fire();
    return j;
  }
  const MUTES = {
    has(name) { return set.has(norm(name)); },
    list() { return (signedIn() && Array.isArray(AUTH.user.mutes)) ? AUTH.user.mutes.slice() : []; },
    mute(name) { return setMute(name, true); },
    unmute(name) { return setMute(name, false); },
    async refresh() {
      if (!signedIn()) { sync(); fire(); return []; }
      try { const j = await window.api('/api/mutes'); AUTH.user.mutes = Array.isArray(j.mutes) ? j.mutes : []; } catch {}
      sync(); fire();
      return MUTES.list();
    },
  };
  window.MUTES = MUTES;

  /* ---------------- helpers ---------------- */
  // the username a /u/<name> link points at (null for anything else)
  function nameFromLink(a) {
    const m = /^\/u\/([^/?#]+)/.exec(a.getAttribute('href') || '');
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
  }
  // whose public wall is this page? (u.html is served for /u/<name>; upage.js also accepts ?u=)
  function pageProfile() {
    const fromPath = (location.pathname.split('/u/')[1] || '').split('/')[0];
    let n = fromPath || new URLSearchParams(location.search).get('u') || '';
    try { n = decodeURIComponent(n); } catch {}
    return norm(n);
  }
  const isUPage = () => !!document.getElementById('pub-username');
  function flagHTML(name) {
    return '<button type="button" class="mute-flag" data-mute-name="' + esc(name) + '" aria-haspopup="dialog" aria-expanded="false" aria-label="You muted @' + esc(name) + ' — options">🔇</button>';
  }

  /* ---------------- shared popdown (one per page) ---------------- */
  let pop = null, popFor = null, popScope = null;
  function buildPop() {
    pop = document.createElement('div');
    pop.className = 'mute-pop'; pop.id = 'mute-pop';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false'); pop.setAttribute('aria-labelledby', 'mute-pop-title');
    pop.hidden = true;
    document.body.appendChild(pop);
    pop.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pop-act]'); if (!b) return;
      const name = pop.dataset.name || '';
      if (b.dataset.popAct === 'keep') { closePop(true); say('Kept @' + name + ' muted.'); return; }
      b.disabled = true;
      const link = popFor && popFor.previousElementSibling; // the @name link the flag sits next to — usually survives the re-paint
      try {
        await MUTES.unmute(name); // → mutes:change → redecorate() (closes the popdown, strips flags, repaints)
        closePop(false); // the flag we'd restore focus to is gone by now
        // restore focus to that link — or, if its row was re-rendered meanwhile (live call widget), to the fresh link for the same @name
        const again = (link && link.isConnected) ? link
          : [...document.querySelectorAll('a[href^="/u/"]')].find(a => a.getAttribute('aria-hidden') !== 'true' && norm(nameFromLink(a)) === norm(name));
        if (again && typeof again.focus === 'function') again.focus();
        toast('🔊 Unmuted @' + name);
        say('Unmuted @' + name + '. Their posts show again the next time a feed loads.');
      } catch (err) { b.disabled = false; toast('⚠️ ' + ((err && err.message) || 'Could not unmute')); }
    });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
      if (e.key === 'Tab') { // two controls: keep Tab inside so the popdown behaves like a tiny dialog
        const items = [...pop.querySelectorAll('button:not([disabled])')]; if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('click', (e) => { if (pop && !pop.hidden && !pop.contains(e.target) && !(popFor && popFor.contains(e.target))) closePop(false); });
    document.addEventListener('keydown', (e) => { if (pop && !pop.hidden && (e.key === 'Escape' || e.key === 'Esc')) closePop(true); });
    window.addEventListener('resize', () => { if (pop && !pop.hidden && popFor) placePop(); });
  }
  function placePop() {
    if (!popFor || !popFor.isConnected) { closePop(false); return; }
    const r = popFor.getBoundingClientRect();
    const pw = pop.offsetWidth || 240;
    const maxLeft = Math.max(8, document.documentElement.clientWidth - pw - 8);
    const left = Math.min(Math.max(8, r.left + window.scrollX), maxLeft + window.scrollX);
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
    pop.style.left = left + 'px';
  }
  function openPop(flag) {
    if (!pop) buildPop();
    const name = flag.dataset.muteName || '';
    if (!pop.hidden && popFor === flag) { closePop(true); return; }
    if (popFor) popFor.setAttribute('aria-expanded', 'false');
    popFor = flag; pop.dataset.name = name;
    // remember the container so we can re-anchor if a live widget re-renders this row under the open dialog
    popScope = flag.closest('.sc-widget, article.post, .comment, .comm-cmt, .comm-members-list, .gboard, .wall-feed') || null;
    pop.innerHTML =
      '<p class="mute-pop-title" id="mute-pop-title">🔇 You muted <b>@' + esc(name) + '</b></p>' +
      '<p class="mute-pop-sub">Their posts, calls and comments stay hidden. They are never told.</p>' +
      '<div class="mute-pop-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-pop-act="unmute">🔊 Unmute @' + esc(name) + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-pop-act="keep">Keep muted</button>' +
      '</div>';
    pop.hidden = false;
    flag.setAttribute('aria-expanded', 'true');
    placePop();
    const first = pop.querySelector('button'); if (first) first.focus();
  }
  function closePop(restoreFocus) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    const f = popFor; popFor = null; popScope = null;
    if (f) { f.setAttribute('aria-expanded', 'false'); if (restoreFocus && f.isConnected) f.focus(); }
  }
  document.addEventListener('click', (e) => {
    const flag = e.target.closest('.mute-flag'); if (!flag) return;
    e.preventDefault(); e.stopPropagation();
    openPop(flag);
  });

  /* ---------------- global decorator ---------------- */
  const LINK_SEL = 'a[href^="/u/"]:not([data-mute-seen])';
  const CARD_SEL = 'article.post:not([data-mute-seen]), .comment:not([data-mute-seen]), .comm-cmt:not([data-mute-seen])';
  function paintLink(a, name) {
    const nameEl = a.classList.contains('search-hit') ? a.querySelector('.h-name') : null;
    if (nameEl) { // a listbox option: a button inside/after it would break the option semantics → paint the name + static marker
      nameEl.classList.add('is-muted');
      nameEl.insertAdjacentHTML('beforeend', ' <span class="mute-mark" aria-hidden="true">🔇</span><span class="sr-only mute-sr"> (muted)</span>');
      return;
    }
    a.classList.add('is-muted');
    if (a.getAttribute('aria-hidden') === 'true') return; // avatar links: colour only, no second control
    if (a.closest('.nav-profile-menu')) return; // the nav account menu links to your own wall — never muted
    a.insertAdjacentHTML('afterend', flagHTML(name));
  }
  function hideCard(el) { el.classList.add('mute-hidden'); el.hidden = true; el.setAttribute('data-mute-hidden', '1'); }
  // A live widget (Send Call rows refresh every 25 s) can replace the row the open popdown is anchored to.
  // Re-anchor to the freshly painted flag for the same @name instead of yanking a focused dialog out from under the user.
  function reanchorPop() {
    if (!popFor || popFor.isConnected) return;
    const name = popFor.dataset.muteName || '';
    const scope = (popScope && popScope.isConnected) ? popScope : document;
    const fresh = [...scope.querySelectorAll('.mute-flag')].find(f => norm(f.dataset.muteName || '') === norm(name));
    if (fresh) {
      popFor.setAttribute('aria-expanded', 'false');
      popFor = fresh; fresh.setAttribute('aria-expanded', 'true');
      placePop();
      if (!pop.contains(document.activeElement)) { const b = pop.querySelector('button:not([disabled])'); if (b) b.focus(); }
    } else {
      closePop(false);
      say('Mute options closed — that list refreshed.');
    }
  }
  function scan() {
    // Nothing muted (the common case, and every signed-out visitor): do NOTHING. The old code walked the whole
    // document twice per pass just to stamp data-mute-seen — bookkeeping that reset() throws away the moment the
    // mute list changes, so it bought nothing and cost two full-document selector matches on every DOM mutation.
    if (!set.size) return;
    const owner = isUPage() ? pageProfile() : '';
    // cards first (a hidden card's links still get painted, so they're right if the card is ever revealed)
    document.querySelectorAll(CARD_SEL).forEach(card => {
      card.setAttribute('data-mute-seen', '1');
      const who = card.matches('article.post') ? card.querySelector('.post-head .who a[href^="/u/"]') : card.querySelector('a.c-who[href^="/u/"]');
      const name = who ? nameFromLink(who) : null;
      if (!name || !MUTES.has(name)) return;
      if (owner && norm(name) === owner) return; // you opened their wall on purpose — their own cards stay
      hideCard(card);
    });
    document.querySelectorAll(LINK_SEL).forEach(a => {
      a.setAttribute('data-mute-seen', '1');
      const name = nameFromLink(a);
      if (name && MUTES.has(name)) paintLink(a, name);
    });
    reanchorPop(); // AFTER repainting, so a fresh flag for the same name exists to re-anchor to
  }
  // undo everything so a mute/unmute/login re-paints from a clean slate
  function reset() {
    closePop(false);
    document.querySelectorAll('.mute-flag, .mute-mark, .mute-sr').forEach(el => {
      const prev = el.previousSibling; // the ' ' we inserted ahead of the 🔇 — drop it too so the name text is byte-identical again
      if (el.classList.contains('mute-mark') && prev && prev.nodeType === 3 && !prev.nodeValue.trim()) prev.remove();
      el.remove();
    });
    document.querySelectorAll('.is-muted').forEach(el => el.classList.remove('is-muted'));
    document.querySelectorAll('[data-mute-hidden]').forEach(el => { el.classList.remove('mute-hidden'); el.hidden = false; el.removeAttribute('data-mute-hidden'); });
    document.querySelectorAll('[data-mute-seen]').forEach(el => el.removeAttribute('data-mute-seen'));
  }
  let scheduled = false;
  function schedule() {
    if (scheduled) return; scheduled = true;
    const run = () => { scheduled = false; scan(); };
    if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 100);
  }
  function redecorate() { reset(); scan(); paintHeader(); }
  function startObserver() {
    scan();
    if (!window.MutationObserver) return;
    const obs = new MutationObserver(schedule);
    try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  }

  /* ---------------- u.html: Moderation menu button + header state ---------------- */
  const wrap = document.getElementById('mod-wrap');
  const trg = document.getElementById('mod-trigger');
  const menu = document.getElementById('mod-menu');
  const note = document.getElementById('mod-note');
  // true once AUTH.ready has resolved (or when there is no AUTH promise to wait for)
  let authSettled = !(window.AUTH && AUTH.ready && typeof AUTH.ready.then === 'function');
  function profileName() { // what the page shows once loaded (server-cased), else the URL
    const el = document.getElementById('pub-username');
    const t = el ? el.textContent.trim() : '';
    if (t && t !== '…') return t;
    const p = (location.pathname.split('/u/')[1] || '').split('/')[0] || new URLSearchParams(location.search).get('u') || '';
    try { return decodeURIComponent(p); } catch { return p; }
  }
  function isOwnWall() { return signedIn() && norm(AUTH.user.username) === pageProfile(); }
  function paintHeader() {
    if (!isUPage()) return;
    const line = document.getElementById('pub-name-line'); if (!line) return;
    const name = profileName();
    const muted = !!pageProfile() && MUTES.has(pageProfile());
    line.classList.toggle('is-muted', muted);
    const old = line.querySelector('.mute-mark'); if (old) old.remove();
    const oldSr = line.querySelector('.mute-sr'); if (oldSr) oldSr.remove();
    if (muted) line.insertAdjacentHTML('beforeend', ' <span class="mute-mark" aria-hidden="true">🔇</span><span class="sr-only mute-sr"> (muted)</span>');
    if (note) {
      note.hidden = !muted;
      note.innerHTML = muted ? '🔇 You muted <b>@' + esc(name) + '</b> — you’re seeing this profile because you opened it. Their posts are hidden everywhere else.' : '';
    }
    renderMenu();
  }
  function menuItems() { return menu ? [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')] : []; }
  function setOpen(open) {
    if (!wrap || !menu || !trg) return;
    wrap.classList.toggle('open', open);
    menu.hidden = !open;
    trg.setAttribute('aria-expanded', String(open));
    if (open) { // keep the menu on-screen at 320px: measure, then shift it right by exactly what pokes past the left edge
      menu.style.left = ''; menu.style.right = '';
      const wr = wrap.getBoundingClientRect(), r = menu.getBoundingClientRect();
      if (r.left < 8) { menu.style.right = 'auto'; menu.style.left = (8 - wr.left) + 'px'; }
    }
  }
  function renderMenu() {
    if (!wrap || !menu || !trg || !isUPage()) return;
    const target = pageProfile();
    const hero = document.getElementById('who-hero');
    const un = document.getElementById('pub-username');
    const loaded = !!un && un.textContent.trim() !== '' && un.textContent.trim() !== '…'; // upage.js filled the real name (never on a 404)
    // stay hidden until /api/me has answered — otherwise your own wall flashes a "Moderation" button that opens sign-in
    const show = authSettled && loaded && !!target && !isOwnWall() && !(hero && hero.hidden);
    wrap.hidden = !show;
    if (!show) { setOpen(false); return; }
    const name = profileName();
    const muted = MUTES.has(target);
    // signed out: the same control, but the tap opens sign-in (no menu to show yet)
    trg.setAttribute('aria-haspopup', signedIn() ? 'menu' : 'dialog');
    menu.innerHTML =
      '<button type="button" class="mod-item' + (muted ? ' mod-item-unmute' : ' mod-item-mute') + '" role="menuitem" tabindex="-1" data-mod-act="' + (muted ? 'unmute' : 'mute') + '" aria-describedby="mod-hint">' +
        '<span class="mod-ico" aria-hidden="true">' + (muted ? '🔊' : '🔇') + '</span> ' + (muted ? 'Unmute' : 'Mute') + ' @' + esc(name) + '</button>' +
      '<p class="mod-hint" id="mod-hint" role="none">' + (muted
        ? 'Unmuting shows @' + esc(name) + '’s posts, calls and comments again.'
        : 'You won’t see @' + esc(name) + '’s posts, calls or comments anywhere. They are never told. You can undo this any time.') + '</p>';
  }
  async function actMenu(btn) {
    const name = profileName();
    if (!signedIn()) { setOpen(false); if (window.AUTH && AUTH.open) AUTH.open(); return; }
    const on = btn.dataset.modAct === 'mute';
    btn.disabled = true;
    try {
      if (on) await MUTES.mute(name); else await MUTES.unmute(name);
      setOpen(false); trg.focus();
      toast(on ? '🔇 Muted @' + name : '🔊 Unmuted @' + name);
      say(on ? 'Muted @' + name + '. Their posts are hidden everywhere else.' : 'Unmuted @' + name + '.');
    } catch (err) { btn.disabled = false; toast('⚠️ ' + ((err && err.message) || 'Could not update')); }
  }
  function wireMenu() {
    if (!wrap || !menu || !trg) return;
    trg.addEventListener('click', () => {
      if (!signedIn()) { toast('Sign in to mute senders 🛡️'); if (window.AUTH && AUTH.open) AUTH.open(); return; }
      const open = !wrap.classList.contains('open');
      setOpen(open);
      if (open) { const it = menuItems()[0]; if (it) it.focus(); }
    });
    trg.addEventListener('keydown', (e) => {
      if (!signedIn()) return; // Enter/Space → click → sign-in
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); const it = menuItems()[0]; if (it) it.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); const its = menuItems(); if (its.length) its[its.length - 1].focus(); }
    });
    menu.addEventListener('keydown', (e) => {
      const items = menuItems(); if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); setOpen(false); trg.focus(); }
      else if (e.key === 'Tab') { setOpen(false); } // APG: Tab leaves and closes the menu
    });
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mod-act]'); if (b) actMenu(b); });
    document.addEventListener('click', (e) => { if (wrap.classList.contains('open') && !wrap.contains(e.target)) setOpen(false); });
    // upage.js fills #pub-username after its own fetch (it loads after us) — re-render once the real name lands
    const un = document.getElementById('pub-username');
    if (un && window.MutationObserver) { try { new MutationObserver(() => paintHeader()).observe(un, { childList: true, characterData: true, subtree: true }); } catch {} }
    const hero = document.getElementById('who-hero');
    if (hero && window.MutationObserver) { try { new MutationObserver(() => renderMenu()).observe(hero, { attributes: true, attributeFilter: ['hidden'] }); } catch {} }
  }

  /* ---------------- boot ---------------- */
  function boot() {
    sync();
    wireMenu();
    startObserver();
    paintHeader();
  }
  document.addEventListener('auth:change', () => { sync(); redecorate(); });
  document.addEventListener('mutes:change', redecorate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  if (!authSettled) AUTH.ready.then(() => { authSettled = true; sync(); redecorate(); }, () => { authSettled = true; sync(); redecorate(); });
})();
