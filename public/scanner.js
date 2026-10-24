/* ===== The Scanner page: two tabs over /newpairs =========================================
 *   🔎 Scan an address — paste any token or pool on Robinhood Chain and read its full on-chain profile as a
 *                        dashboard, the same view the site opens for every coin (NPCard.dashboardHTML: the
 *                        chart, the contract read, the community slot). Open to everyone.
 *   📡 New Pairs       — the live radar, for members. The panel shows a locked card until the reader is
 *                        signed in; the radar itself (newpairs.js) starts the first time the tab is open
 *                        for a member, and is parked while the other tab shows.
 *
 * URL: ?scan=0x… runs a scan on load and is kept in the address bar so a scan can be shared — with ?chain= naming the
 * chain the answer CAME from, so the link reloads to the same profile on any device (a link without one is read as Auto,
 * never through this device's chain chooser); ?tab=new opens the radar tab. The chooser applies only to what the reader
 * types or pastes: every chip, name-search row and link carries its own chain. "Recent scans on this device" is
 * localStorage, never sent; "Scanned by the
 * community" is the server's scan store (/api/scan/recent — the token, when, how many times; never who).
 * Every scan re-reads the chain and rewrites the stored snapshot; when the upstreams are down the server
 * answers with the last snapshot and says so (scan.stale + scan.readAt), and the page repeats it plainly.
 * CSP-safe: addEventListener only. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tabScan = $('sc-tab-scan'), tabNew = $('sc-tab-new'), panScan = $('sc-scan'), panNew = $('sc-new');
  if (!tabScan || !tabNew || !panScan || !panNew) return;
  const form = $('sc-form'), input = $('sc-addr'), go = $('sc-go'), status = $('sc-status'), result = $('sc-result');
  const recentBox = $('sc-recent'), recentList = $('sc-recent-list'), locked = $('sc-locked'), radar = $('sc-radar'), lock = $('sc-lock');
  /* An address on one of the chains the Scanner reads (owner, 2026-10-23: Ethereum and Solana too): 0x and 40 hex on the EVM
     chains; 32–44 base58 characters on Solana, whose case is part of the address and is never lowered. */
  const ADDR = /^0x[0-9a-fA-F]{40}$/, SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const isAddr = (s) => ADDR.test(s) || SOL_ADDR.test(s);
  const normAddr = (s) => ADDR.test(s) ? s.toLowerCase() : s;
  const CHAIN_META = (window.NPCard && NPCard.CHAIN_META) || {};
  const chainName = (slug) => (CHAIN_META[slug] && CHAIN_META[slug].name) || (slug === 'ethereum' ? 'Ethereum' : slug === 'solana' ? 'Solana' : 'Robinhood Chain');
  // the chain chooser: Auto (the address decides; a 0x address is tried on Robinhood Chain, then Ethereum) or one chain
  let chainPick = (function () { try { const v = localStorage.getItem('sc:chain'); return ['auto', 'robinhood', 'ethereum', 'solana'].includes(v) ? v : 'auto'; } catch { return 'auto'; } })();
  const chainBtns = () => [...document.querySelectorAll('.sc-chain[data-chain]')];
  function paintChains() { chainBtns().forEach((b) => { const on = b.dataset.chain === chainPick; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.sc-chain[data-chain]'); if (!b) return;
    chainPick = b.dataset.chain; try { localStorage.setItem('sc:chain', chainPick); } catch {}
    paintChains();
    if (window.announce) announce(chainPick === 'auto' ? 'The chain is read from the address.' : 'Scanning on ' + chainName(chainPick) + '.');
  });
  paintChains();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const signedIn = () => !!(window.AUTH && AUTH.user);
  let clockOffset = 0;   // server clock − this browser's clock, from the last answer that carried `now`; a skewed device clock must not age a fresh read
  const ago = (t) => { const s = Math.max(0, (Date.now() + clockOffset - Number(t || 0)) / 1000); if (s < 5) return 'just now'; if (s < 60) return Math.round(s) + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
  // a relative time that keeps counting: "read 3s ago" is repainted every 15 s, not left to go quietly false
  const agoEl = (t) => '<time class="sc-ago" data-t="' + Number(t || 0) + '" datetime="' + esc(new Date(Number(t || 0)).toISOString()) + '">' + esc(ago(t)) + '</time>';
  setInterval(() => { document.querySelectorAll('.sc-ago[data-t]').forEach((el) => { const v = ago(el.getAttribute('data-t')); if (el.textContent !== v) el.textContent = v; }); }, 15000);
  const clock = (t) => { try { return new Date(Number(t)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  let current = 'scan', seq = 0, lastPair = null;   // lastPair: the pair the scan on screen shows (its ☆ saves this)

  /* ---------- tabs ---------- */
  function show(which, opts) {
    opts = opts || {};
    const toNew = which === 'new';
    current = toNew ? 'new' : 'scan';
    tabScan.classList.toggle('is-on', !toNew); tabNew.classList.toggle('is-on', toNew);
    tabScan.setAttribute('aria-selected', String(!toNew)); tabNew.setAttribute('aria-selected', String(toNew));
    tabScan.tabIndex = toNew ? -1 : 0; tabNew.tabIndex = toNew ? 0 : -1;
    panScan.hidden = toNew; panNew.hidden = !toNew;
    document.body.classList.toggle('sc-on-radar', toNew);
    if (toNew) gateRadar(); else if (window.NPRadar) NPRadar.suspend();
    try {
      const u = new URL(location.href);
      if (toNew) u.searchParams.set('tab', 'new'); else u.searchParams.delete('tab');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch {}
    if (!opts.quiet && window.announce) announce(toNew ? 'New Pairs tab.' : 'Scanner tab.');
  }
  tabScan.addEventListener('click', () => show('scan'));
  tabNew.addEventListener('click', () => show('new'));

  /* ---------- the members' door on the radar ---------- */
  function gateRadar() {
    const ok = signedIn();
    if (locked) locked.hidden = ok;
    if (radar) radar.hidden = !ok;
    if (lock) lock.hidden = ok;
    if (ok && current === 'new' && window.NPRadar) NPRadar.start();
  }
  const signin = $('sc-signin');
  if (signin) signin.addEventListener('click', () => { if (window.AUTH && AUTH.open) AUTH.open(); });
  document.addEventListener('auth:change', () => { if (lock) lock.hidden = signedIn(); if (current === 'new') gateRadar(); });
  if (lock) lock.hidden = signedIn();

  /* ---------- recent scans (this browser only) ---------- */
  const RECENT_KEY = 'sc:recent', RECENT_MAX = 6;
  const recent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((r) => r && isAddr(r.addr || '')) : []; } catch { return []; } };
  function remember(addr, sym, chain) {
    try {
      const a = normAddr(addr), ch = chain && chain !== 'robinhood' ? chain : null;
      const list = [{ addr: a, sym: String(sym || '').slice(0, 16), ...(ch ? { chain: ch } : {}) }].concat(recent().filter((r) => !(r.addr === a && (r.chain || null) === ch))).slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {}
    paintRecent();
  }
  function paintRecent() {
    if (!recentBox || !recentList) return;
    const list = recent();
    recentBox.hidden = !list.length;
    /* Every chip names its chain, the home chain included (a stored row without one is a home-chain scan — remember() keeps
       the chain only when it is not Robinhood's). A chip that carried none was scanned through the chain chooser, so with
       the chooser left on Ethereum a $SEND chip went looking for $SEND on Ethereum. */
    recentList.innerHTML = list.map((r) => '<button class="np-chip" type="button" data-scan="' + esc(r.addr) + '" data-scan-chain="' + esc(r.chain || 'robinhood') + '" data-tip="Scans this address again on ' + esc(chainName(r.chain || 'robinhood')) + '">' + (r.sym ? '$' + esc(r.sym) : esc(shortAddr(r.addr))) + (r.chain ? ' <small>' + esc((CHAIN_META[r.chain] && CHAIN_META[r.chain].emoji) || chainName(r.chain)) + '</small>' : '') + '</button>').join(' ');
  }
  paintRecent();

  /* ---------- scanned by the community (kept on the server: the token, the time, the count — never who) ---------- */
  const commBox = $('sc-community'), commList = $('sc-community-list');
  async function paintCommunity() {
    if (!commBox || !commList) return;
    try {
      const r = await fetch('/api/scan/recent', { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      const list = (r.ok && Array.isArray(j.scans)) ? j.scans.filter((x) => x && isAddr(x.token || '') && x.symbol) : [];
      commBox.hidden = !list.length;
      // every chip names its chain (the server sends one per entry; a missing one is the home chain's), so a chip never scans through the chooser
      commList.innerHTML = list.map((x) => '<button class="np-chip" type="button" data-scan="' + esc(x.token) + '" data-scan-chain="' + esc(x.chain || 'robinhood') + '" data-tip="' + esc((x.name || x.symbol) + (x.chain && x.chain !== 'robinhood' ? ' on ' + chainName(x.chain) : '') + ' — scanned ' + x.count + (x.count === 1 ? ' time' : ' times') + ', last ' + ago(x.lastAt) + '; pulls up the latest read') + '">$' + esc(x.symbol) + '<span class="sc-chip-meta">' + (x.kind === 'pool' ? '🏊 ' : '') + esc(ago(x.lastAt)) + (x.count > 1 ? ' · ×' + Number(x.count) : '') + '</span></button>').join(' ');
    } catch { /* the strip is optional — a failed read leaves it hidden */ }
  }
  paintCommunity();

  /* ---------- the scan ---------- */
  function setStatus(text, kind) {
    if (!status) return;
    status.textContent = text || '';
    status.className = 'sc-status' + (kind ? ' is-' + kind : '');
  }
  /* A NAME instead of an address (owner, 2026-10-14: "search a token by it's name also and pull up all tokens with that name
     even if there is no volume, show the market cap, the volume, and the holder count"): every token on the chain whose name
     or symbol holds the words, traded or not, each with its market cap, 24-hour volume and holders — and a scan away. */
  async function names(q, heard) {
    const my = ++seq;
    if (heard && window.SFX) SFX.play('scan');
    lastPair = null;
    if (input && input.value !== q) { input.value = q; input.dispatchEvent(new Event('input')); }
    try { const u = new URL(location.href); u.searchParams.set('scan', q); u.searchParams.delete('tab'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}   // shareable, like an address scan
    setStatus('Looking for tokens named “' + q + '”…', 'busy');
    result.innerHTML = '<section class="np-named" aria-label="Tokens by name"><h3 class="np-named-h">Tokens named “' + esc(q) + '” on Robinhood Chain</h3><p class="np-named-none">Searching…</p></section>';
    const j = await TokenNames.ask(q);
    if (my !== seq) return;
    const box = result.querySelector('.np-named'); if (!box) return;
    box.innerHTML = TokenNames.blockHTML(j, q);
    const f = TokenNames.facts(j, q), n = f.items.length;
    setStatus(n ? (f.count.startsWith('first') ? 'The first ' + n : String(n)) + (n === 1 ? ' token' : ' tokens') + ' named “' + q + '” — pick one to scan it.' + (f.partialLine ? ' ' + f.partialLine : '') : f.empty, n ? (f.partialLine ? 'err' : 'ok') : 'err');
    if (j.retryAfter) setTimeout(() => { if (my === seq) names(q, false); }, j.retryAfter * 1000);   // too many searches: once more, after the wait
    else if (j.pending) TokenNames.follow(q, () => my === seq, (k) => TokenNames.refill(box, k));   // holders, in place
  }
  async function scan(raw, heard, chainWant) {   // heard: the visitor asked for this scan in this tab (a deep link on load scans quietly); chainWant: a chip's, row's or link's own chain ('auto' = the address decides); none = typed or pasted, which the chooser governs
    const addr = String(raw || '').trim();
    if (/^[0-9a-f]{40}$/i.test(addr)) return scan('0x' + addr, heard, chainWant);   // an address pasted without its 0x
    if (!isAddr(addr) && window.TokenNames && TokenNames.isNameQuery(addr)) { names(TokenNames.normQ(addr), heard); return; }   // a name: list the tokens called that (a Solana address is an address first)
    if (!isAddr(addr)) { setStatus('That is not an address. A 0x address is 42 characters long; a Solana address is 32 to 44 letters and digits — or type a token\u2019s name to list every token called that.', 'err'); if (input) input.focus(); if (window.SFX) SFX.play('error'); return; }
    /* Which chain. A Solana address is Solana's whatever anyone chose. Otherwise a chip's, a row's or a link's own chain wins,
       and its 'auto' means the address decides (the server tries the home chain, then Ethereum) — NOT the chooser. The chooser
       governs only what the reader typed or pasted, which arrives with no chainWant at all. It used to be the fallback for every
       chip and link that named no chain, so with the chooser left on Ethereum the $SEND chip, every home-chain recent, a
       name-search row and a shared link all went looking on Ethereum. */
    const chainQ = SOL_ADDR.test(addr) && !ADDR.test(addr) ? 'solana' : (chainWant ? (chainWant === 'auto' ? '' : chainWant) : (chainPick !== 'auto' ? chainPick : ''));
    if (chainQ === 'solana' && ADDR.test(addr)) { setStatus('That is a 0x address, which Solana does not use — pick Robinhood Chain, Ethereum or Auto.', 'err'); if (window.SFX) SFX.play('error'); return; }
    const my = ++seq;
    if (heard && window.SFX) SFX.play('scan');   // the radar ping: a read of the chain has started
    lastPair = null;                                                   // the ☆ saves only the pair on screen, never the one before
    if (input) { input.value = addr; input.dispatchEvent(new Event('input')); }   // shows the ✕ for a chip or deep-link scan too
    if (go) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); }
    const where = chainQ ? chainName(chainQ) : 'the chain';
    setStatus('Reading ' + where + ' for ' + shortAddr(addr) + '…', 'busy');
    result.innerHTML = '<p class="tm-loading"><span class="np-live-dot" aria-hidden="true"></span> Reading ' + esc(where) + ' for the latest on-chain detail…</p>';
    try { const u = new URL(location.href); u.searchParams.set('scan', normAddr(addr)); if (chainQ) u.searchParams.set('chain', chainQ); else u.searchParams.delete('chain'); u.searchParams.delete('tab'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
    try {
      const r = await fetch('/api/scan?address=' + encodeURIComponent(normAddr(addr)) + (chainQ ? '&chain=' + encodeURIComponent(chainQ) : ''), { credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (my !== seq) return;
      if (r.ok && j.pair) {
        const p = j.pair, tok = (p.token && p.token.address) || normAddr(addr);
        const chainSlug = j.chain || p.chain || 'robinhood', cm = j.chainMeta || CHAIN_META[chainSlug] || null;
        if (cm && !p.chain) p.chain = chainSlug;   // the dashboard reads the chain from the profile
        /* The address bar now names the chain the answer CAME from. An Auto scan of a 0x address the home chain had nothing
           for is answered from Ethereum (j.note says so); the link written before the fetch carried no chain, so copied and
           opened elsewhere it would run the Auto scan again — on a device whose home chain is reachable, a different profile. */
        try { const u = new URL(location.href); u.searchParams.set('scan', normAddr(addr)); u.searchParams.set('chain', chainSlug); u.searchParams.delete('tab'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
        lastPair = p;
        const sym = (p.token && p.token.symbol) || '';
        const sc = Object.assign({ readAt: Date.now(), stale: false, kept: false }, j.scan || {});
        if (typeof sc.now === 'number' && Math.abs(sc.now - Date.now()) > 2000) clockOffset = sc.now - Date.now(); else if (typeof sc.now === 'number') clockOffset = 0;
        // the holder figures are read on their own cadence (GoPlus caches them for minutes): say so when they are older than the scan
        const hAt = p.holders && p.holders.readAt;
        const holdersNote = (hAt && sc.readAt - hAt > 60000) ? '<span class="sc-hit-note">👥 Holder figures as of ' + agoEl(hAt) + ' — the price feed and the pool were read ' + agoEl(sc.readAt) + '.</span>' : '';
        if (window.tokenCommunityPrime && Object.prototype.hasOwnProperty.call(j, 'community')) tokenCommunityPrime(tok, j.community);
        /* What this scan was — a token, or a pool that resolved to one — and how old the read is. The rest of
           the page is the token's dashboard (newpairs.js: NPCard.dashboardHTML): the chart in the middle, every
           figure one click from its detail, and the Send Call pair — 📣 to the Wall, 🛡️ to a Send Squad the
           reader is a verified member of — marked as made with the full detail on screen, for this token only.
           Everything a call needs (sign-in, the $SEND check, today's allowance, enough liquidity) is still
           asked by the composer and the server, exactly as for any other call. */
        const kicker = j.kind === 'pool' ? '🏊 Pool <code>' + esc(shortAddr(j.pool)) + '</code> ' + (j.poolVerified === true ? 'prices this token' : 'says it prices this token') : '🪙 Token';
        // a 0x address the home chain had nothing for, read on Ethereum instead: the answer says so, and so does the page
        const chainNote = j.note ? '<span class="sc-hit-note sc-chain-note">' + esc((cm && cm.emoji ? cm.emoji + ' ' : '') + j.note) + '</span>' : '';
        const meta =
          '<p class="sc-hit-s">' + chainNote + (sc.stale ? 'Last read ' : 'Read ') + agoEl(sc.readAt) + ' · 🔁 ' + (!sc.kept ? 'This scan could not be kept just now — nothing was stored for others.'
                                          : (sc.count > 1 ? 'Scanned ' + Number(sc.count) + ' times by the community · first ' + agoEl(sc.firstAt) : 'First scan of this address on record — it is kept now, so it pulls up for everyone')) +
            holdersNote +
            (sc.stale ? '<span class="sc-stale">⏳ ' + (sc.busy ? 'Lots of scans are running right now' : 'The price feed and the chain could not be reached just now') + ' — this is the last snapshot, read ' + agoEl(sc.readAt) + ' (' + esc(clock(sc.readAt)) + '). Nothing on it is live. Scan again in a moment.</span>' : '') +
            // any contract can answer token0()/token1(); only the factory or the price feed can confirm it is really this token's pool
            (j.kind === 'pool' && j.poolVerified !== true ? '<span class="sc-stale">⚠️ This address answers like a pool of ' + (sym ? '$' + esc(sym) : 'this token') + ', but ' + (j.poolVerified === false ? 'neither the chain’s main factory nor the price feed knows it as one — treat the pool itself as unverified. ' : 'that could not be confirmed with the factory just now. ') + 'The profile below is the token’s, not this address’s.</span>' : '') +
          '</p>';
        result.innerHTML = (window.NPCard && NPCard.dashboardHTML) ? NPCard.dashboardHTML(p, { kicker, meta }) : '<p class="tm-msg">Full detail isn’t available here.</p>';
        if (window.NPCard && NPCard.mountDashboard) NPCard.mountDashboard(result);   // ring, chart, community slot, the contract read, the ☆ state
        setStatus(sc.stale ? 'Showing the last snapshot of ' + ((p.token && p.token.name) || shortAddr(tok)) + (sym ? ' $' + sym : '') + ' — read ' + ago(sc.readAt) + ', not live.' : 'Scanned ' + ((p.token && p.token.name) || shortAddr(tok)) + (sym ? ' $' + sym : '') + ' — read ' + ago(sc.readAt) + '.', sc.stale ? 'busy' : 'ok');
        if (heard && window.SFX) { if (sc.stale) SFX.play('warn'); else SFX.play('success'); }   // the profile landed (a last snapshot is a caution, not a live read)
        remember(tok, sym, chainSlug);
        paintCommunity();
        const h = result.querySelector('.tkd-h'); if (h) { try { h.focus({ preventScroll: false }); } catch {} }
      } else if (!r.ok || (j && j.unavailable)) {
        // "we could not check" is never dressed up as a fact about the address
        result.innerHTML = '';
        setStatus('⏳ ' + ((j && (j.message || j.error)) || 'We couldn’t check this address just now — nothing here is a judgement about it. Try again in a moment.'), 'err');
        if (heard && window.SFX) SFX.play('error');
      } else if (j && j.notFound) {
        result.innerHTML = '';
        setStatus('🤷 ' + (j.message || 'No token or pool found at this address on ' + chainName(j.chain || chainQ || 'robinhood') + '.'), 'err');
        if (heard && window.SFX) SFX.play('error');
      } else {
        result.innerHTML = '';
        setStatus('⏳ We couldn’t read this address just now. Try again in a moment.', 'err');
        if (heard && window.SFX) SFX.play('error');
      }
    } catch {
      if (my !== seq) return;
      result.innerHTML = '';
      setStatus('⏳ Couldn’t reach the site just now — check your connection and try again.', 'err');
      if (heard && window.SFX) SFX.play('error');
    } finally {
      if (my === seq && go) { go.disabled = false; go.removeAttribute('aria-disabled'); }
    }
  }
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); scan(input && input.value, true); });
  // the ☆ on the dashboard: saves this pair to the watchlist (or takes it off)
  result.addEventListener('click', (e) => {
    // a token from a name search: scan it here (a new-tab click keeps its new tab). The name search reads Robinhood Chain alone
    // (/api/search/tokens), so its rows are home-chain tokens and say so — never the chooser's chain
    const nr = e.target.closest('.np-named-row[data-token]');
    if (nr && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); scan(nr.dataset.token, true, 'robinhood'); return; }
    const w = e.target.closest('.np-watch[data-wpair]');
    if (!w || !lastPair || !lastPair.pair || !window.Watchlist) return;
    if (String(w.dataset.wpair).toLowerCase() !== String(lastPair.pair.address).toLowerCase()) return;
    e.preventDefault();
    Watchlist.toggle(lastPair);
  });
  /* ---------- clearing the box: the ✕ inside it, or Esc while typing in it ---------- */
  const clearBtn = $('sc-clear');
  const syncClear = () => { if (clearBtn) clearBtn.hidden = !(input && input.value); };
  function clearBox() {
    if (!input) return;
    input.value = '';
    syncClear();
    setStatus('', '');
    try { const u = new URL(location.href); u.searchParams.delete('scan'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash); } catch {}
    input.focus();
  }
  if (input) {
    input.addEventListener('input', syncClear);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); clearBox(); } });
    syncClear();
  }
  if (clearBtn) clearBtn.addEventListener('click', clearBox);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-scan]');
    if (!b || !panScan.contains(b)) return;
    show('scan', { quiet: true });
    scan(b.getAttribute('data-scan'), true, b.getAttribute('data-scan-chain') || null);   // a chip carries its chain (a recent scan, a community scan, an example)
  });
  // a pasted address scans straight away — nobody pastes one to look at it
  if (input) input.addEventListener('paste', () => { setTimeout(() => { if (isAddr(input.value.trim())) scan(input.value, true); }, 0); });

  /* ---------- deep links ---------- */
  const q = new URLSearchParams(location.search);
  const fromHash = /^#0x[0-9a-fA-F]{40}$/.test(location.hash) ? location.hash.slice(1) : '';
  const want = q.get('scan') || fromHash;
  // ?chain= names the chain a shared scan was read on; a link without one is read as Auto (the address decides) — never through
  // this device's chooser, which the person who shared the link knows nothing about
  const wantChain = ['robinhood', 'ethereum', 'solana'].includes(q.get('chain')) ? q.get('chain') : 'auto';
  if (q.get('tab') === 'new') show('new', { quiet: true }); else show('scan', { quiet: true });
  if (want && want.trim().length >= 2) scan(want, false, wantChain);   // an address scans; a name lists the tokens called that
  // the sign-in state arrives after the page (AUTH.ready): re-run the gate once it is known
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(() => { if (lock) lock.hidden = signedIn(); if (current === 'new') gateRadar(); }).catch(() => {});
})();
