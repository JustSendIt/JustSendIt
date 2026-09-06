/* ===== tokentext.js — tokens as social objects =====
 * 1) window.richText(text, tokens) → SAFE HTML for post / comment text: every $TICKER the server resolved (plus $SEND /
 *    $GWC always) becomes a <button class="tok-chip"> that opens the shared token-detail popup; any raw 0x… address the
 *    server could NOT resolve is shown shortened in <code> with a copy button (app.js handles data-copy).
 * 2) window.tokenCommunityTag(addr, info, sym)   → the small 🏘️ Community / ＋ Start community tag (HTML).
 *    window.tokenCommunityPanel(addr, info, sym) → the fuller section used inside the token-detail popup (HTML).
 *    window.tokenCommunitySlot(addr, sym, variant) → an empty placeholder that decorateTokenCommunities() fills in.
 *    window.decorateTokenCommunities(root) → batch-resolves every slot (and [data-token]/[data-addr] hosts you pass)
 *    through POST /api/communities/lookup, with a 60 s in-memory cache; runs automatically for newly rendered markup.
 *    window.tokenCommunityLookup(addr) → Promise<info|null> (single, cached). window.tokenCommunityPrime(addr, info).
 * CSP-safe: no inline handlers; one delegated (capture-phase) click handler for the chips that lets the event keep
 * bubbling (outside-click closers keep working). Lookups distinguish "no community" (server said so) from "unknown"
 * (rate-limited / offline) — the UI never asserts a state the server didn't confirm.
 * Every user-controlled string is escaped before it touches innerHTML. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ADDR_RE = /^0x[0-9a-f]{40}$/;
  var KNOWN = { // $SEND / $GWC are always chippable, even when a row carries no tokens[] (older posts, offline previews)
    SEND: { addr: '0xa40a9c0e2e9bf7a3b9deb9ebed2b59e77d01e105', symbol: 'SEND', name: 'Send It' },
    GWC: { addr: '0x61339f11384dde4b2dc3a33e75b4dc23cc620f22', symbol: 'GWC', name: 'Generational Wealth Coin' },
  };
  function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function normAddr(a) { a = String(a || '').toLowerCase().trim(); return ADDR_RE.test(a) ? a : ''; }

  /* ---------- rich text ---------- */
  function symbolMap(tokens) {
    var map = {};
    Object.keys(KNOWN).forEach(function (k) { map[k] = KNOWN[k]; });
    (Array.isArray(tokens) ? tokens : []).forEach(function (t) {
      if (!t) return;
      var sym = String(t.symbol || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16), addr = normAddr(t.addr);
      if (sym && addr) map[sym.toUpperCase()] = { addr: addr, symbol: sym, name: String(t.name || '').slice(0, 60) };
    });
    return map;
  }
  function chipHTML(t) {
    var sym = '$' + esc(t.symbol);
    return '<button type="button" class="tok-chip" data-addr="' + esc(t.addr) + '" data-symbol="' + esc(t.symbol) + '"' + (t.name ? ' data-name="' + esc(t.name) + '"' : '') +
      ' aria-label="' + sym + ' — view token details">' + sym + '</button>';
  }
  function addrHTML(a) {
    var lower = a.toLowerCase(), shortA = shortAddr(a);
    return '<code class="tok-addr" title="' + esc(a) + '">' + esc(shortA) + '</code>' +
      '<button type="button" class="tok-copy" data-copy="' + esc(lower) + '" aria-label="Copy address ' + esc(shortA) + '">📋</button>';
  }
  // One pass over the ALREADY-ESCAPED text: a $WORD or a 0x address is swapped for markup, everything else is left as-is.
  // Single pass means generated markup (which contains addresses / $SYMBOLs itself) is never re-scanned.
  var TOKEN_RE = /0x[0-9a-fA-F]{40}|\$[A-Za-z0-9_]{1,16}/g;
  var WORD = /[A-Za-z0-9_$]/;
  function richText(text, tokens) {
    var src = esc(text);
    if (!src) return '';
    var map = symbolMap(tokens);
    return src.replace(TOKEN_RE, function (m, offset) {
      var before = offset > 0 ? src.charAt(offset - 1) : '', after = src.charAt(offset + m.length);
      if (WORD.test(before)) return m;                             // part of a longer word (e.g. "0xabc…" inside a hash, "US$SEND")
      if (m.charAt(0) === '$') {
        if (after && /[A-Za-z0-9_]/.test(after)) return m;         // can't happen with a greedy match, kept for safety
        var t = map[m.slice(1).toUpperCase()];
        return t ? chipHTML(t) : m;
      }
      if (after && /[0-9a-zA-Z]/.test(after)) return m;            // longer hex blob, not an address
      return addrHTML(m);
    });
  }
  window.richText = richText;

  /* ---------- community tags ---------- */
  var cache = new Map();      // addr → { info, at }   (info === null means the server SAID there is no community)
  var inflight = new Map();   // addr → Promise
  var failed = new Map();     // addr → time of the last failed lookup (429 / 5xx / network) — short back-off, never cached as "none"
  var TTL = 60 * 1000, FAIL_TTL = 5 * 1000;
  function cached(addr) { var c = cache.get(addr); return c && (Date.now() - c.at) < TTL ? c : null; }
  function recentlyFailed(addr) { var t = failed.get(addr); return !!t && (Date.now() - t) < FAIL_TTL; }
  function prime(addr, info) { addr = normAddr(addr); if (!addr) return; failed.delete(addr); cache.set(addr, { info: info && info.id ? info : null, at: Date.now() }); }
  // Resolves to { addr → info | null | undefined }: null = the server answered "no community", undefined = we DON'T KNOW
  // (rate-limited, server error, offline). Callers must never render undefined as "no community".
  function lookupMany(addrs) {
    addrs = addrs.map(normAddr).filter(Boolean);
    var need = [], waits = [];
    addrs.forEach(function (a) {
      if (cached(a) || recentlyFailed(a)) return;
      if (inflight.has(a)) { waits.push(inflight.get(a)); return; }
      need.push(a);
    });
    if (need.length) {
      var uniq = Array.from(new Set(need));
      for (var i = 0; i < uniq.length; i += 200) {
        (function (chunk) {
          var p = fetch('/api/communities/lookup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: chunk }) })
            .then(function (r) { if (!r.ok) throw new Error('lookup ' + r.status); return r.json(); })
            .then(function (j) { var m = (j && j.map) || {}; chunk.forEach(function (a) { prime(a, m[a] || null); }); })
            .catch(function () { var now = Date.now(); chunk.forEach(function (a) { failed.set(a, now); }); }) // unknown, NOT "none" → retried after the back-off
            .then(function () { chunk.forEach(function (a) { inflight.delete(a); }); });
          chunk.forEach(function (a) { inflight.set(a, p); });
          waits.push(p);
        })(uniq.slice(i, i + 200));
      }
    }
    return Promise.all(waits).then(function () { var out = {}; addrs.forEach(function (a) { var c = cached(a); out[a] = c ? c.info : undefined; }); return out; });
  }

  function memberTxt(info) { var n = Number(info.memberCount) || 0; return n + ' member' + (n === 1 ? '' : 's'); }
  function tagHTML(addr, info, sym) {
    addr = normAddr(addr); var symTxt = sym ? '$' + String(sym) : 'Token';
    if (info && info.id) {
      var live = info.status === 'live';
      var label = symTxt + ' community — ' + (live ? 'live' : 'forming') + ' · ' + memberTxt(info) + (info.official ? ' · official' : '');
      return '<a class="tok-comm has' + (live ? '' : ' forming') + (info.official ? ' official' : '') + '" href="/community.html?id=' + encodeURIComponent(info.id) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">🏘️ Community' + (live ? '' : ' · forming') + (info.official ? ' · official' : '') + '</a>';
    }
    if (!addr) return '';
    // accessible name starts with the visible text ("Start community") so voice control / label-in-name (WCAG 2.5.3) match
    return '<a class="tok-comm none" href="/communities.html?start=' + esc(addr) + '" aria-label="Start community — ' + esc(symTxt) + '" title="No ' + esc(symTxt) + ' community yet — start one">＋ Start community</a>';
  }
  function panelHTML(addr, info, sym) {
    addr = normAddr(addr); var symTxt = sym ? '$' + esc(sym) : 'This token';
    var inner;
    if (info && info.id) {
      var live = info.status === 'live', q = Number(info.qualCount) || 0;
      inner = '<p class="tok-comm-txt"><b>' + symTxt + ' has a community</b> — ' + (live ? '<span class="tok-comm-live">🟢 LIVE</span>' : '<span class="tok-comm-forming">⏳ forming</span>') +
        ' · ' + memberTxt(info) + (q ? ' (' + q + ' verified holder' + (q === 1 ? '' : 's') + ')' : '') + (info.official ? ' · <span class="tok-comm-offtxt">official</span>' : '') + '</p>' +
        '<div class="tok-comm-acts"><a class="btn btn-sm btn-primary" href="/community.html?id=' + encodeURIComponent(info.id) + '">🏘️ Open community →</a></div>';
    } else if (addr) {
      inner = '<p class="tok-comm-txt">No ' + symTxt + ' community yet.</p>' +
        '<div class="tok-comm-acts"><a class="btn btn-sm btn-ghost" href="/communities.html?start=' + esc(addr) + '">＋ Start a community</a></div>';
    } else inner = '<p class="tok-comm-txt">Community info isn’t available for this token.</p>';
    return '<section class="tok-comm-panel" aria-label="Community"><h3 class="tok-comm-h">🏘️ Community</h3>' + inner +
      '<p class="tok-comm-note">Communities are holder-run hangouts on $Send — not an endorsement of the token.</p></section>';
  }
  function slotHTML(addr, sym, variant) {
    addr = normAddr(addr); if (!addr) return '';
    var full = variant === 'panel';
    return (full ? '<div' : '<span') + ' class="tok-comm-slot' + (full ? ' tok-comm-slot-panel' : '') + '" data-tok-comm="' + esc(addr) + '"' + (sym ? ' data-sym="' + esc(String(sym).slice(0, 16)) + '"' : '') + (full ? ' data-variant="panel"' : '') + '>' +
      (full ? '<section class="tok-comm-panel" aria-label="Community"><h3 class="tok-comm-h">🏘️ Community</h3><p class="tok-comm-txt tok-comm-loading">Checking for a community…</p></section>' : '') +
      (full ? '</div>' : '</span>');
  }
  // info === undefined → the lookup FAILED (rate-limit / outage): we don't know, so never assert "no community". The small
  // tag stays empty; the popup panel shows a neutral "couldn't check" line. data-tok-done is NOT set so a later pass retries.
  function fill(slot, info) {
    var addr = slot.getAttribute('data-tok-comm'), sym = slot.getAttribute('data-sym') || '';
    var panel = slot.getAttribute('data-variant') === 'panel';
    if (info === undefined) {
      if (slot.getAttribute('data-tok-done')) return;   // keep whatever real answer we already rendered
      if (panel && !slot.querySelector('.tok-comm-unknown')) {
        slot.innerHTML = '<section class="tok-comm-panel" aria-label="Community"><h3 class="tok-comm-h">🏘️ Community</h3>' +
          '<p class="tok-comm-txt tok-comm-unknown">Couldn’t check for a community right now — try again in a moment.</p></section>';
      }
      return;
    }
    var key = info && info.id ? (info.id + ':' + info.status + ':' + (info.memberCount | 0) + ':' + (info.qualCount | 0) + ':' + (info.official ? 1 : 0)) : 'none';
    if (slot.getAttribute('data-tok-done') === key) return;
    slot.setAttribute('data-tok-done', key);
    slot.innerHTML = panel ? panelHTML(addr, info, sym) : tagHTML(addr, info, sym);
  }
  // Collect slots under root (plus any [data-token]/[data-addr] hosts passed as root itself), fill from cache NOW
  // (no flash on re-renders), then batch-fetch the misses and fill when they land.
  function decorate(root) {
    root = root || document;
    var slots = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll('[data-tok-comm]') : []);
    if (root.nodeType === 1 && root.hasAttribute && root.hasAttribute('data-tok-comm')) slots.push(root);
    if (!slots.length) return Promise.resolve();
    var miss = [];
    slots.forEach(function (s) {
      var a = normAddr(s.getAttribute('data-tok-comm')); if (!a) return;
      var c = cached(a);
      if (c) fill(s, c.info); else miss.push(a);
    });
    if (!miss.length) return Promise.resolve();
    return lookupMany(miss).then(function (m) {
      // m[a] === undefined means the server never answered for that address → fill() renders the neutral "unknown" state
      slots.forEach(function (s) { var a = normAddr(s.getAttribute('data-tok-comm')); if (a && s.isConnected && (a in m)) fill(s, m[a]); });
    });
  }
  // any markup rendered later (feeds, lists, popups) gets decorated automatically — debounced to one pass per frame
  function arm() {
    if (!window.MutationObserver || !document.body) return;
    var scheduled = false;
    var obs = new MutationObserver(function (muts) {
      var relevant = false;
      for (var i = 0; i < muts.length && !relevant; i++) { var n = muts[i].addedNodes; for (var k = 0; k < n.length; k++) { if (n[k].nodeType === 1) { relevant = true; break; } } }
      if (!relevant || scheduled) return;
      scheduled = true;
      var run = function () { scheduled = false; decorate(document); };
      if (window.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 60);
    });
    try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    decorate(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm); else arm();

  /* ---------- clicks: one delegated, capture-phase handler ---------- */
  // Capture phase so the chip opens even when a card handler would otherwise swallow the click — but the event is NOT
  // stopped: the site's bubble-phase "outside click" closers (🔔 notifications panel, profile menu, search suggestions)
  // must still see it, and the feed / row handlers only dispatch on their own data-* selectors (a chip is a no-op there).
  // The 🏘️ tag is a plain link; the row handlers that could hijack it (runner rows, pin chips) already exclude .tok-comm.
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var chip = t.closest('.tok-chip');
    if (!chip) return;
    e.preventDefault();
    e._tokChip = true; // marker for any row handler that wants to ignore chip clicks explicitly
    var addr = normAddr(chip.getAttribute('data-addr')); if (!addr) return;
    try { chip.focus(); } catch (_) {} // Safari/iOS don't focus a <button> on click — focus it so the popup restores focus HERE, not <body>
    if (window.TokenModal && window.TokenModal.open) TokenModal.open(addr, { symbol: chip.getAttribute('data-symbol') || '', name: chip.getAttribute('data-name') || '' });
    else if (window.sendToast) sendToast('Token detail isn’t available on this page.');
  }, true);
  window.tokenCommunitySlot = slotHTML;
  window.decorateTokenCommunities = decorate;
  window.tokenCommunityPrime = prime;
})();
