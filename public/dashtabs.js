/* ===== Dashboard tabs ==============================================================================
   Five panels instead of one long scroll. The panels are the same markup that was there before, so every
   id anything targets still exists; this file's job is REACHABILITY — making sure that when something
   wants an element inside a panel that is not showing, the panel shows first. Four things want that:
     1. a hash in the URL (#sec-security, #claim, #invites, #connected-wallet, #rekt-h …)
     2. script opening a <details> inside a panel (profile.js openSecurity, gamify.js quest rows)
     3. script scrolling an element into view
     4. the user, with a pointer or the keyboard
   Runs before profile.js and gamify.js so their DOMContentLoaded work lands on a visible panel. */
(function () {
  const KEY = 'send.dash.tab';
  const list = document.getElementById('dtabs');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panelOf = (t) => document.getElementById(t.getAttribute('aria-controls'));
  const NAMES = tabs.map((t) => t.dataset.tab);

  /* Where an existing deep-link lands. These hashes were all in use before the tabs existed and keep
     their meaning; #tab-<name> is the only new one. */
  function tabForHash(h) {
    if (!h) return null;
    const m = /^#tab-([a-z]+)$/.exec(h);
    if (m && NAMES.includes(m[1])) return m[1];
    if (/^#(sec-|claim$|totp|twofa|pw2fa|add-email|theme|pref-|wl-|pf-)/.test(h)) return 'settings';
    if (/^#invites?$|^#inv-/.test(h)) return 'invites';
    if (/^#(connected-wallet|cw-)/.test(h)) return 'wallet';
    if (/^#(rekt-|rec-h|arena|gamify|loot|quest)/.test(h)) return 'overview';
    const el = document.querySelector(h.replace(/[^#\w-]/g, ''));
    return el ? ownerOf(el) : null;
  }
  function ownerOf(el) {
    const p = el && el.closest && el.closest('.dpanel');
    if (!p) return null;
    const t = tabs.find((x) => x.getAttribute('aria-controls') === p.id);
    return t ? t.dataset.tab : null;
  }

  let current = null;
  function show(name, opts) {
    const o = opts || {};
    const tab = tabs.find((t) => t.dataset.tab === name); if (!tab) return false;
    if (current === name) return true;
    current = name;
    let lostFocus = false;
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const p = panelOf(t); if (p) { if (!on && p.contains(document.activeElement)) lostFocus = true; p.hidden = !on; }
    });
    if (lostFocus) tab.focus({ preventScroll: true });   // the control that asked for the switch just vanished under the reader; land them on the tab
    try { localStorage.setItem(KEY, name); } catch {}
    if (o.hash !== false && !tabForHashIsSpecific(location.hash)) {
      try { history.replaceState(null, '', '#tab-' + name); } catch {}
    }
    if (o.focus === 'tab') tab.focus();
    document.dispatchEvent(new CustomEvent('dash:tab', { detail: { tab: name } }));
    return true;
  }
  // a hash that points at something INSIDE a panel is more specific than the tab — leave it alone
  const tabForHashIsSpecific = (h) => !!h && !/^#tab-/.test(h) && tabForHash(h) !== null;

  /* ---------- 4. the user ---------- */
  list.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) show(t.dataset.tab); });
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault(); show(tabs[j].dataset.tab, { focus: 'tab' });
  });

  /* ---------- 1. hashes ---------- */
  function route() { const t = tabForHash(location.hash); if (t) show(t, { hash: false }); }
  addEventListener('hashchange', route);

  /* ---------- 2. a <details> opening inside a hidden panel ---------- */
  document.addEventListener('toggle', (e) => {
    const d = e.target; if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    const t = ownerOf(d); if (t && t !== current) show(t);
  }, true);   // toggle does not bubble

  /* ---------- 3. scrollIntoView / focus into a hidden panel ----------
     Wrapped rather than patched at each call site, so the six existing callers and any future one all
     behave: reveal the panel, then do what was asked. Scoped to elements inside a panel; everything else
     goes straight to the native method. */
  const nativeSIV = Element.prototype.scrollIntoView, nativeFocus = HTMLElement.prototype.focus;
  Element.prototype.scrollIntoView = function () { const t = ownerOf(this); if (t && t !== current) show(t); return nativeSIV.apply(this, arguments); };
  HTMLElement.prototype.focus = function () { const t = ownerOf(this); if (t && t !== current) show(t); return nativeFocus.apply(this, arguments); };

  /* initial: the hash wins, then the remembered tab, then Overview */
  const fromHash = tabForHash(location.hash);
  let remembered = null; try { remembered = localStorage.getItem(KEY); } catch {}
  show(fromHash || (NAMES.includes(remembered) ? remembered : 'overview'), { hash: false });

  window.dashTabs = { show, current: () => current, ownerOf };
})();
