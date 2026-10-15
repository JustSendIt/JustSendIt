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
  /* The tab bar is sticky under the nav, so anything scrolled to inside a panel (Edit profile's #sec-account, #sec-security)
     has to land below both, not under them: its height is published as --dtabs-h for styles.css (.dpanel [id]). */
  const fitBar = () => { try { document.documentElement.style.setProperty('--dtabs-h', Math.round(list.getBoundingClientRect().height) + 'px'); } catch {} };
  fitBar();
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitBar).observe(list); else addEventListener('resize', fitBar);
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
    const el = document.getElementById(h.slice(1));   // not querySelector: "#1" is a valid id but throws as a selector
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
    /* The address stays the page's name (owner, 2026-10-15: "every page is just their name and not ... a # in front of it"):
       a tab is not written into it. A refresh comes back to the same tab from what is remembered on this device; a #tab-…
       link someone followed is honoured, then tidied away. A hash that points INSIDE a panel (#sec-account) is left for
       the code that answers it. */
    if (/^#tab-/.test(location.hash)) { try { history.replaceState(history.state, '', location.pathname + location.search); } catch {} }
    if (o.focus === 'tab') tab.focus();
    document.dispatchEvent(new CustomEvent('dash:tab', { detail: { tab: name } }));
    return true;
  }

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

  /* ---------- the reader keeps their place ----------
     Owner, 2026-10-14: "When users are changing their info in settings do not time them out and do not take them to any
     other page like the dashboard overview mid them changing their info." Only the reader — a tab, a link or quest they
     follow — or the URL moves the panel. Two things used to move it under them:
       · a re-render elsewhere that draws its sections open: the dashboard redraws after a save refreshes the account, and the
         browser fires "toggle" for every <details open> it draws, which read as "show the Overview". A <details> drawn open is
         drawn, not opened: its toggle is ignored.
       · script reaching into another panel while they work. While the reader is working in the panel on screen — focus in one
         of its fields, or typing or clicking there in the last 90 s — nothing else switches it unless they just pressed
         something (the last 1.5 s: their own click on a quest or a link). */
  const drawnAt = new WeakMap();
  new MutationObserver((ms) => {
    const t = performance.now();
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'DETAILS') drawnAt.set(n, t);
      if (n.querySelectorAll) n.querySelectorAll('details').forEach((d) => drawnAt.set(d, t));
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  let workedAt = -Infinity, pressedAt = -Infinity;
  const panelNow = () => { const t = tabs.find((x) => x.dataset.tab === current); return t ? panelOf(t) : null; };
  document.addEventListener('input', (e) => { const p = panelNow(); if (e.isTrusted && p && p.contains(e.target)) workedAt = performance.now(); }, true);
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (!e.isTrusted) return;
    pressedAt = performance.now();
    const p = panelNow(); if (p && p.contains(e.target)) workedAt = pressedAt;
  }, true));
  function working() {
    const p = panelNow(); if (!p) return false;
    const a = document.activeElement;
    return !!(a && p.contains(a) && a.matches('input, textarea, select, [contenteditable="true"]')) || performance.now() - workedAt < 90e3;
  }
  const mayMove = () => !working() || performance.now() - pressedAt < 1500;

  /* ---------- 2. a <details> opening inside a hidden panel ---------- */
  document.addEventListener('toggle', (e) => {
    const d = e.target; if (!d || d.tagName !== 'DETAILS' || !d.open) return;
    const at = drawnAt.get(d); if (at !== undefined && performance.now() - at < 250) return;   // drawn open by a render, not opened
    const t = ownerOf(d); if (t && t !== current && mayMove()) show(t);
  }, true);   // toggle does not bubble

  /* ---------- 3. scrollIntoView / focus into a hidden panel ----------
     Wrapped rather than patched at each call site, so the six existing callers and any future one all
     behave: reveal the panel, then do what was asked. Scoped to elements inside a panel; everything else
     goes straight to the native method. */
  const nativeSIV = Element.prototype.scrollIntoView, nativeFocus = HTMLElement.prototype.focus;
  // an element in another panel: reveal that panel if the reader may be moved; if not, leave them where they are and do nothing
  Element.prototype.scrollIntoView = function () { const t = ownerOf(this); if (t && t !== current) { if (!mayMove()) return; show(t); } return nativeSIV.apply(this, arguments); };
  HTMLElement.prototype.focus = function () { const t = ownerOf(this); if (t && t !== current) { if (!mayMove()) return; show(t); } return nativeFocus.apply(this, arguments); };

  /* initial: the hash wins, then the remembered tab, then Overview */
  const fromHash = tabForHash(location.hash);
  let remembered = null; try { remembered = localStorage.getItem(KEY); } catch {}
  show(fromHash || (NAMES.includes(remembered) ? remembered : 'overview'), { hash: false });

  window.dashTabs = { show, current: () => current, ownerOf };
})();
