/* ===== Global "post to your Send Wall from anywhere" FAB + composer =====
 * Loaded on every page (after auth.js). Posts via window.api; attaches photos/GIFs/videos via window.prepMedia.
 * Never reassigns window.onAuthReady — listens to the auth:change event instead. */
(function () {
  let modal, fab, card, pendingImg = null, composeBusy = false, pendingCompose = false, pendingTimer = null, releaseTrap = null, lastFocus = null;
  let mode = 'post';   // 'post' → the Send Wall · 'call' → a Send Call on a pasted contract address

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function build() {
    fab = document.createElement('button');
    fab.id = 'compose-fab';
    fab.type = 'button';
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-controls', 'compose-modal');
    fab.setAttribute('aria-label', 'Post to your Send Wall');
    /* aria-label is this control's NAME. tips.js only falls back to a name when there is no visible text,
       and this one prints "Send it", so without a data-tip the most travelled button on the site — it is
       fixed on every page — would be the one control with no description at all. */
    fab.setAttribute('data-tip', 'Opens the composer to post to the Wall or make a Send Call');
    fab.innerHTML = '<span class="fab-ico" aria-hidden="true">✏️</span><span class="fab-label">Send it</span>';
    document.body.appendChild(fab);

    modal = document.createElement('div');
    modal.id = 'compose-modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML =
      '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="compose-title">' +
        '<button class="modal-x" data-close aria-label="Close composer" data-tip="Closes the composer without posting anything">✕</button>' +
        '<h2 id="compose-title" class="display" style="color:var(--green-bright); text-align:center; font-size:1.5rem;">Send it to the Wall 🧱</h2>' +

        '<div id="compose-in" hidden>' +
          '<div class="cmp-modes" role="tablist" aria-label="What are you sending?">' +
            '<button class="cmp-mode is-on" type="button" role="tab" id="cmp-mode-post" aria-selected="true" aria-controls="compose-post-pane" data-tip="Switches to writing a plain post for the wall">🧱 Post</button>' +
            '<button class="cmp-mode" type="button" role="tab" id="cmp-mode-call" aria-selected="false" aria-controls="compose-call-pane" data-tip="Switches to making a permanent call on a token — public, or private to one of your squads">📣 Send Call</button>' +
          '</div>' +
          '<p class="modal-note" style="text-align:center; margin-top:0;">Posting as <b>@<span id="compose-handle"></span></b></p>' +

          '<div id="compose-post-pane" role="tabpanel" aria-labelledby="cmp-mode-post">' +
            '<label class="sr-only" for="compose-text">Write your post</label>' +
            '<textarea id="compose-text" maxlength="500" placeholder="What are you sending? 🚀 Paste a contract address → it becomes a clickable $TICKER (no scams, no seed phrases — ever)"></textarea>' +
            '<div id="compose-nudge" class="cmp-nudge" hidden></div>' +
            '<div id="compose-preview" class="media-preview" hidden aria-label="Attached media preview"></div>' +
            '<div class="composer-bar">' +
              '<label class="file-label" for="compose-img">🖼 Photo / GIF / Video<input type="file" id="compose-img" accept="image/*,video/mp4,video/webm" class="sr-only" aria-label="Attach a photo, GIF, or video"></label>' +
              '<button class="file-label voice-btn" type="button" id="compose-voice" data-tip="Records a voice memo to post — press once to start, once to stop">🎤 Voice memo</button>' +
              '<button class="btn btn-primary btn-sm" id="compose-send" data-tip="Posts this publicly to the wall and your profile" title="Posts this publicly to the wall and your profile" disabled>Send it 🚀</button>' +
              '<span class="hint" id="compose-count" aria-hidden="true">500</span>' +
            '</div>' +
            '<p class="modal-note">Public on the Wall and your profile. 🎉 Entertainment only — never post a seed phrase or password.</p>' +
          '</div>' +

          '<div id="compose-call-pane" role="tabpanel" aria-labelledby="cmp-mode-call" hidden>' +
            // Where the call lands: the public Send Wall, or privately inside one of the person's verified Send
            // Squads (filled from /api/squads/mine each time the modal opens; signed-out → the public option only).
            '<label class="f-label" for="compose-call-target" style="margin-top:0;">Where does this call go?</label>' +
            '<select class="ab-select" id="compose-call-target" data-tip="Chooses whether this call goes to the public Send Wall or privately to one of your Send Squads"><option value="">🌐 Public — the Send Wall</option></select>' +
            '<p class="modal-note" id="compose-call-target-note" hidden>🛡️ A squad call is <b>private to that squad</b> — only its verified members see it — and <b>every point it earns goes to the squad</b>, not to you.</p>' +
            '<label class="f-label" for="compose-call-addr">Token contract address</label>' +
            '<input class="addr-input" id="compose-call-addr" type="text" spellcheck="false" autocomplete="off" inputmode="text" placeholder="Paste 0x… contract address" aria-describedby="compose-call-help">' +
            '<div id="compose-call-preview" class="cmp-call-preview" role="status" aria-live="polite"></div>' +
            '<label class="sr-only" for="compose-call-note">Why are you calling it? (optional)</label>' +
            '<textarea id="compose-call-note" maxlength="280" placeholder="Why this one? (optional)"></textarea>' +
            // Publishing your wallet address next to your username is a real, permanent disclosure, so it
            // is a choice you make rather than something the call does to you. Off unless ticked.
            '<label class="cmp-call-share"><input type="checkbox" id="compose-call-wallet"> <span>Show my wallet on this call <small>— anyone can then see and track this address. Off by default; you can remove it later.</small></span></label>' +
            '<div class="composer-bar">' +
              '<button class="btn btn-primary btn-sm" id="compose-call-go" data-tip="Posts a permanent scored call on this token — it cannot be deleted" title="Posts a permanent scored call on this token — it cannot be deleted" disabled>📣 Make the call</button>' +
              '<span class="hint" id="compose-call-left"></span>' +
            '</div>' +
            '<p class="modal-note" id="compose-call-help">A Send Call posts a <b>live scorecard</b> to your wall that tracks how far this token runs, forever. It is <b>public, timestamped and permanent — calls can never be deleted</b>. Needs a real pool (≥&nbsp;$2,000 liquidity). 🎉 Entertainment only, never advice.</p>' +
          '</div>' +

          '<p class="modal-note" id="compose-status" role="status" aria-live="polite"></p>' +
        '</div>' +

        '<div id="compose-out" hidden style="text-align:center;">' +
          '<p class="modal-note">Grab your free @handle to post, react 🔥, and start your own wall.</p>' +
          '<button class="btn btn-primary" id="compose-signin" data-tip="Opens sign-in, then brings this box back">Sign in / Create account 🚪</button>' +
          '<p class="modal-note">We never touch your funds and never ask for your seed phrase.</p>' +
        '</div>' +

        '<div id="compose-done" hidden style="text-align:center;">' +
          '<div style="font-size:2.6rem;" aria-hidden="true" id="compose-done-ico">🚀</div>' +
          '<p style="font-weight:800; color:var(--green-bright); font-size:1.1rem;" id="compose-done-msg">Sent to the Wall!</p>' +
          '<div style="display:flex; gap:0.6rem; justify-content:center; flex-wrap:wrap; margin-top:0.9rem;">' +
            '<a class="btn btn-primary btn-sm" id="compose-view" href="/wall.html" data-tip="Closes this and shows your new post on the wall">View on the Wall →</a>' +
            '<button class="btn btn-ghost btn-sm" id="compose-again" type="button" data-tip="Returns to the empty composer to send another">Post another ✏️</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    card = modal.querySelector('.modal-card');
  }

  function showPanel(id) {
    ['compose-in', 'compose-out', 'compose-done'].forEach(p => { modal.querySelector('#' + p).hidden = (p !== id); });
  }
  function setStatus(msg) { modal.querySelector('#compose-status').textContent = msg || ''; }

  function showForAuth() {
    if (window.AUTH && AUTH.user) {
      const ch = modal.querySelector('#compose-handle'); ch.textContent = AUTH.user.username;
      if (AUTH.user.og && window.ogBadge) ch.insertAdjacentHTML('afterend', ogBadge(AUTH.user.og));
      showPanel('compose-in');
      paintAllowance();
      loadSquads();
      setTimeout(() => { const t = modal.querySelector(mode === 'call' ? '#compose-call-addr' : '#compose-text'); if (t) t.focus(); }, 30);
    } else {
      showPanel('compose-out');
      setTimeout(() => { const b = modal.querySelector('#compose-signin'); if (b) b.focus(); }, 30);
    }
  }

  function open() {
    lastFocus = document.activeElement;
    modal.removeAttribute('hidden');
    if (window.lockScroll) lockScroll(); else document.body.style.overflow = 'hidden';
    setStatus('');
    showForAuth();
    releaseTrap = window.trapFocus ? window.trapFocus(card) : null;
    document.dispatchEvent(new CustomEvent('jsi:modalopen'));
  }
  function close() {
    modal.setAttribute('hidden', '');
    pendingSquad = null; setCallTarget(null);   // a squad chosen for one call never carries over to the next opening
    pendingToken = null; detailSeenFor = null;  // nor does a token another page handed over
    if (window.unlockScroll) unlockScroll(); else document.body.style.overflow = '';
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
    if (lastFocus) { try { lastFocus.focus(); } catch {} }
    document.dispatchEvent(new CustomEvent('jsi:modalclose'));
  }

  function resetForm() {
    const t = modal.querySelector('#compose-text'); if (t) t.value = '';
    pendingImg = null; composeBusy = false;
    window.setMediaPreview(modal.querySelector('#compose-preview'), null);
    modal.querySelector('#compose-img').value = '';
    const countEl = modal.querySelector('#compose-count');
    countEl.textContent = '500';
    countEl.setAttribute('aria-hidden', 'true'); // back to "not low" — don't leave it exposed to SR
    gate(modal.querySelector('#compose-send'), true);
    const nudge = modal.querySelector('#compose-nudge'); if (nudge) { nudge.hidden = true; nudge.innerHTML = ''; }
    // Send Call side
    const addrReset = modal.querySelector('#compose-call-addr'); addrReset.value = ''; addrReset.removeAttribute('aria-invalid');
    modal.querySelector('#compose-call-note').value = '';
    const shareBox = modal.querySelector('#compose-call-wallet'); if (shareBox) shareBox.checked = false; // never carries over to the next call
    callPreview(''); setCallReady(false); callLookupSeq++; viewedDetail = false;
    pendingSquad = null; setCallTarget(null);   // back to the public wall — a squad is chosen per call
    pendingToken = null; detailSeenFor = null;
    setStatus('');
  }

  /* ===== Send Call mode: paste a contract address and post a live call scorecard =====
   * Same button, second job: 🧱 Post writes to the Send Wall, 📣 Send Call goes on the record for a token. */
  const ADDR_RE = /0x[0-9a-fA-F]{40}/;
  const MIN_CALL_LIQ = 2000;                // mirrors the server's MIN_CALL_LIQ so we can warn before the round-trip
  let callTok = null;                       // { addr, symbol, name, liq } once a pasted address resolves
  let callLookupSeq = 0, callLookupTimer = null, viewedDetail = false;
  /* ---- Send Squads: a call can be made "to a squad" instead of to the public wall ----
     pendingSquad = { id, name } asked for by COMPOSE.openCall (a squad page's "Call a token to this squad")
     — it is kept selected even when /api/squads/mine has not answered yet, or answers without it. */
  let pendingSquad = null, squadsSeq = 0;
  /* A token handed over by another page (the Scanner's "Send Call" buttons): filled in and looked up when the
     composer opens, kept through a sign-in detour like the squad. `detailSeenFor` is the one token whose full on-chain
     detail the caller already had on screen — only that token's call is not flagged "made without DYOR". */
  let pendingToken = null, detailSeenFor = null;
  function targetEl() { return modal.querySelector('#compose-call-target'); }
  const HELP_PUBLIC = 'A Send Call posts a <b>live scorecard</b> to your wall that tracks how far this token runs, forever. It is <b>public, timestamped and permanent — calls can never be deleted</b>. Needs a real pool (≥&nbsp;$2,000 liquidity). 🎉 Entertainment only, never advice.';
  const HELP_SQUAD = 'A squad call posts the same <b>live scorecard</b>, but <b>private to that squad</b> — only its verified members ever see it, on the squad’s Calls tab. It is timestamped and permanent, and <b>every point it earns goes to the squad, not to you</b>. Needs a real pool (≥&nbsp;$2,000 liquidity). 🎉 Entertainment only, never advice.';
  function squadNote() {
    const on = !!(targetEl() && targetEl().value);
    const n = modal.querySelector('#compose-call-target-note'); if (n) n.hidden = !on;
    const h = modal.querySelector('#compose-call-help'); if (h) h.innerHTML = on ? HELP_SQUAD : HELP_PUBLIC;   // the help says where the call goes
  }
  // one <option> per squad; adds the option when the list does not carry it yet (openCall before /mine answers)
  function ensureSquadOption(id, name) {
    const sel = targetEl(); if (!sel || !(id > 0)) return null;
    let opt = sel.querySelector('option[value="' + id + '"]');
    if (!opt) { opt = document.createElement('option'); opt.value = String(id); opt.textContent = '🛡️ ' + String(name || 'Squad #' + id).slice(0, 40); sel.appendChild(opt); }
    return opt;
  }
  function setCallTarget(id) {
    const sel = targetEl(); if (!sel) return;
    sel.value = id > 0 && sel.querySelector('option[value="' + id + '"]') ? String(id) : '';
    squadNote();
  }
  // the public option + one per VERIFIED squad the person belongs to; a 401 (signed out) leaves only the public one
  async function loadSquads() {
    const sel = targetEl(); if (!sel) return;
    const seq = ++squadsSeq;
    let list = [];
    try { const j = await window.api('/api/squads/mine'); list = (j && j.squads) || []; }
    catch (e) { if (!(e && e.status === 401)) return; }   // signed out → public only; any other failure keeps what is shown
    if (seq !== squadsSeq || !modal) return;
    const keep = Number(sel.value) || (pendingSquad && pendingSquad.id) || 0;
    sel.querySelectorAll('option[value]:not([value=""])').forEach(o => o.remove());
    list.filter(s => s && s.verified && s.id > 0).forEach(s => ensureSquadOption(s.id, s.name));
    if (pendingSquad) ensureSquadOption(pendingSquad.id, pendingSquad.name);
    setCallTarget(keep);
  }
  /* Open the composer in call mode — squad.js with its squad chosen; the Scanner with the scanned token filled in
     (o.token), public or to a squad (o.squadId), and o.viewedDetail when the caller has the token's full detail open. */
  function openCall(o) {
    if (!modal) return;
    o = o || {};
    const id = Number(o.squadId);
    pendingSquad = id > 0 ? { id, name: String(o.squadName || '') } : null;
    const tok = /^0x[0-9a-fA-F]{40}$/.test(String(o.token || '')) ? String(o.token).toLowerCase() : null;
    pendingToken = tok;
    detailSeenFor = tok && o.viewedDetail ? tok : null;
    setMode('call');
    if (modal.hasAttribute('hidden')) open(); else showForAuth();
    // a Wall button always lands on the public Wall, even when the box was left on a squad from an earlier call
    if (pendingSquad) ensureSquadOption(pendingSquad.id, pendingSquad.name);
    setCallTarget(pendingSquad ? pendingSquad.id : null);
    if (tok) fillCallToken(tok);
  }
  // put a handed-over token in the address box and read it, then leave the cursor on the note
  function fillCallToken(tok) {
    const inp = modal.querySelector('#compose-call-addr'); if (!inp) return;
    inp.value = tok; inp.removeAttribute('aria-invalid');
    clearTimeout(callLookupTimer);
    lookupCallToken(tok);
    if (window.AUTH && AUTH.user) setTimeout(() => { const n = modal.querySelector('#compose-call-note'); if (n) try { n.focus(); } catch {} }, 60);
  }

  function money(n) {
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
    if (a >= 1) return '$' + n.toFixed(2);
    return a > 0 ? '$' + Number(n).toPrecision(3) : '$0';
  }
  function setMode(m) {
    mode = m === 'call' ? 'call' : 'post';
    const isCall = mode === 'call';
    modal.querySelector('#compose-title').textContent = isCall ? 'Make a Send Call 📣' : 'Send it to the Wall 🧱';
    modal.querySelector('#compose-post-pane').hidden = isCall;
    modal.querySelector('#compose-call-pane').hidden = !isCall;
    modal.querySelector('#cmp-mode-post').classList.toggle('is-on', !isCall);
    modal.querySelector('#cmp-mode-call').classList.toggle('is-on', isCall);
    modal.querySelector('#cmp-mode-post').setAttribute('aria-selected', String(!isCall));
    modal.querySelector('#cmp-mode-call').setAttribute('aria-selected', String(isCall));
    setStatus('');
    paintAllowance();
    const focusEl = modal.querySelector(isCall ? '#compose-call-addr' : '#compose-text');
    if (focusEl) setTimeout(() => { try { focusEl.focus(); } catch {} }, 20);
  }
  // how many calls are left today (the server is authoritative; this is the same number the dashboard shows)
  function paintAllowance() {
    const el = modal.querySelector('#compose-call-left'); if (!el) return;
    const a = window.AUTH && AUTH.user && AUTH.user.callAllowance;
    if (!a) { el.textContent = ''; return; }
    el.textContent = a.remaining > 0 ? a.remaining + ' of ' + a.limit + ' calls left today' : 'no calls left right now';
  }
  function callPreview(html) { modal.querySelector('#compose-call-preview').innerHTML = html || ''; }
  // A disabled <button> receives no pointer events, so tips.js can never show its data-tip on one; the
  // native title is the only description that still renders there. Mirror it in only while disabled —
  // tips.js strips titles from enabled controls, so an enabled one would otherwise show two bubbles.
  function gate(btn, off) { btn.disabled = off; if (off) btn.setAttribute('title', btn.getAttribute('data-tip') || ''); else btn.removeAttribute('title'); }
  function setCallReady(on) { gate(modal.querySelector('#compose-call-go'), !on); }

  async function lookupCallToken(addr) {
    const seq = ++callLookupSeq;
    callTok = null; setCallReady(false);
    viewedDetail = !!detailSeenFor && detailSeenFor === String(addr).toLowerCase();   // the Scanner showed this very token's full detail
    callPreview('<p class="modal-note" style="margin:0;">🔎 Reading that token on-chain…</p>');
    try {
      const j = await window.api('/api/pairs/lookup?token=' + encodeURIComponent(addr));
      if (seq !== callLookupSeq) return;                      // a newer paste won
      if (j.notFound || !j.pair) { callPreview('<p class="modal-note cmp-call-warn" style="margin:0;">⚠️ ' + esc(j.message || 'No trading pair found for that address.') + '</p>'); return; }
      const p = j.pair, t = p.token || {}, mk = p.market || {};
      const liq = mk.liquidityUsd == null ? 0 : Number(mk.liquidityUsd);
      const sym = String(t.symbol || '?').slice(0, 16), name = String(t.name || 'Token').slice(0, 60);
      const img = p.brand && p.brand.imageUrl;
      const thin = !(liq >= MIN_CALL_LIQ);
      callTok = { addr: addr.toLowerCase(), symbol: sym, name, liq };
      callPreview(
        '<div class="cmp-call-tok">' +
          (img ? '<img class="cmp-call-logo" src="' + esc(img) + '" alt="" width="40" height="40" loading="lazy">' : '<span class="cmp-call-logo cmp-call-logo-none" aria-hidden="true">🪙</span>') +
          '<div class="cmp-call-id"><b>$' + esc(sym) + '</b><span class="cmp-call-name">' + esc(name) + '</span></div>' +
          '<div class="cmp-call-stats">' +
            '<span>💰 <b>' + money(mk.marketCap != null ? mk.marketCap : mk.fdv) + '</b> MC</span>' +
            '<span>💧 <b>' + money(liq) + '</b> liquidity</span>' +
          '</div>' +
        '</div>' +
        (thin
          ? '<p class="modal-note cmp-call-warn">⚠️ Too thin to call — a pool needs <b>$' + MIN_CALL_LIQ.toLocaleString('en-US') + '+</b> of liquidity (this one has ' + esc(money(liq)) + '). Thin pools are easy to manipulate.</p>'
          : viewedDetail
            ? '<p class="modal-note">✅ You had its full on-chain detail on screen — this call is not flagged as made without looking.</p>'   // said only for the token a full detail card (or the Scanner) handed over
            : (window.TokenModal && window.NPCard)
              ? '<p class="modal-note">📖 <button class="linklike" type="button" id="compose-call-detail" data-tip="Opens the full on-chain detail and records that you looked">See the full on-chain detail first</button> — calls made without looking are flagged on your wall.</p>'
              : '<p class="modal-note">📖 <button class="linklike" type="button" id="compose-call-detail" data-tip="Opens this token in the Scanner in a new tab. This page cannot see what you read there, so a call made here stays flagged — use the Send Call button on the Scanner instead">Scan it first</button> — calls made without looking are flagged on your wall; one made from the Scanner is not.</p>')
      );
      setCallReady(!thin);
      if (window.decorateTokenCommunities) window.decorateTokenCommunities(modal.querySelector('#compose-call-preview'));
    } catch (e) {
      if (seq !== callLookupSeq) return;
      callPreview('<p class="modal-note cmp-call-warn" style="margin:0;">⚠️ ' + esc((e && e.message) || 'Could not read that token — try again.') + '</p>');
    }
  }

  async function makeCall() {
    if (!callTok) { setStatus('Paste a token contract address first 🤌'); return; }
    const btn = modal.querySelector('#compose-call-go');
    const note = modal.querySelector('#compose-call-note').value.trim();
    gate(btn, true); setStatus('Calling it… 📣');
    try {
      const shareWallet = !!(modal.querySelector('#compose-call-wallet') || {}).checked;
      const sel = targetEl();
      const squadId = sel && Number(sel.value) > 0 ? Number(sel.value) : null;
      const squadName = squadId ? String((sel.options[sel.selectedIndex] || {}).textContent || '').replace(/^🛡️\s*/, '') : '';
      const body = { token: callTok.addr, note, viewedDetail, shareWallet };
      if (squadId) body.squadId = squadId;
      const j = await window.api('/api/calls', { method: 'POST', body });
      // a call that tripped the anti-spam guard comes back with a fresh restriction — surface the banner immediately
      if (j.restriction && window.AUTH) {
        AUTH.user.restriction = j.restriction; AUTH.user.probation = null;
        if (AUTH.renderRestrictBanner) AUTH.renderRestrictBanner();
        if (AUTH.renderProbationBanner) AUTH.renderProbationBanner();
      }
      if (window.AUTH && AUTH.user && AUTH.user.callAllowance && AUTH.user.callAllowance.remaining > 0) {
        AUTH.user.callAllowance.remaining--; AUTH.user.callAllowance.used++;
      }
      resetForm();
      modal.querySelector('#compose-done-ico').textContent = squadId ? '🛡️' : '📣';
      modal.querySelector('#compose-done-msg').textContent = squadId
        ? 'Squad call posted on $' + callTok.symbol + ' — ' + squadName + ' earned the points!'
        : 'Send Call posted on $' + callTok.symbol + '!';
      modal.querySelector('#compose-again').textContent = 'Call another 📣';
      showPanel('compose-done');
      setTimeout(() => { const v = modal.querySelector('#compose-view'); if (v) v.focus(); }, 30);
      if (window.sendToast) {
        // the squad's points come back as squadPoints; only a number the server sent is ever shown
        const sp = squadId && typeof j.squadPoints === 'number' && j.squadPoints > 0 ? ' +' + j.squadPoints.toLocaleString('en-US') + ' Send Power to the squad.' : '';
        sendToast(squadId
          ? '🛡️ Squad call live on $' + callTok.symbol + ' — the squad earned the points, not you.' + sp
          : '📣 Send Call live on $' + callTok.symbol + ' — your Xs track from here.');
      }
      const r = fab.getBoundingClientRect();
      if (window.sendConfetti) sendConfetti(r.left + r.width / 2, r.top, { count: 50, emojiRatio: 0.5 });
      if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top);
      /* A squad call's post is private to the squad: post:created would prepend it into the public wall /
         profile feed on this screen, so it gets its own event instead (squad.html can refresh its Calls tab). */
      if (j.post && !squadId) document.dispatchEvent(new CustomEvent('post:created', { detail: j.post }));
      if (squadId) document.dispatchEvent(new CustomEvent('squad:call', { detail: { squadId, post: j.post || null, squadPoints: j.squadPoints == null ? null : j.squadPoints } }));
      const view = modal.querySelector('#compose-view');
      if (view) {
        if (squadId) {
          view.href = '/squad.html?id=' + squadId + '#calls';
          view.textContent = 'View in the squad →';
          view.setAttribute('data-tip', 'Closes this and opens the Calls tab of that squad');
        } else {
          view.href = (j.post && j.post.id) ? '/wall.html#p' + j.post.id : '/wall.html';
          view.textContent = 'View on the Wall →';
          view.setAttribute('data-tip', 'Closes this and shows your new post on the wall');
        }
      }
      callTok = null;
    } catch (err) {
      setStatus('⚠️ ' + ((err && err.message) || 'could not make that call'));
      gate(btn, false);
    }
  }

  async function send() {
    const text = modal.querySelector('#compose-text').value.trim();
    if (composeBusy) { setStatus('Hang on — still uploading your media ⏳'); return; }
    if (!text && !pendingImg) { setStatus('Say something or drop a meme first 🤌'); return; }
    const btn = modal.querySelector('#compose-send');
    gate(btn, true); setStatus('Sending… 🚀');
    try {
      const j = await window.api('/api/posts', { method: 'POST', body: { text, image: pendingImg } });
      resetForm();
      modal.querySelector('#compose-done-ico').textContent = '🚀';
      modal.querySelector('#compose-done-msg').textContent = 'Sent to the Wall!';
      modal.querySelector('#compose-again').textContent = 'Post another ✏️';
      showPanel('compose-done');
      setTimeout(() => { const v = modal.querySelector('#compose-view'); if (v) v.focus(); }, 30);
      if (window.sendToast) sendToast('SENT! 🚀');
      const r = fab.getBoundingClientRect();
      if (window.sendConfetti) sendConfetti(r.left + r.width / 2, r.top, { count: 40, emojiRatio: 0.5 });
      if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top);
      document.dispatchEvent(new CustomEvent('post:created', { detail: j.post }));
      // point "View on the Wall" at the new post — never yank the user off the page they chose to post from
      const view = modal.querySelector('#compose-view');
      if (view) {
        view.href = (j.post && j.post.id) ? '/wall.html#p' + j.post.id : '/wall.html';
        view.textContent = 'View on the Wall →';   // a squad call before this may have pointed it at the squad
        view.setAttribute('data-tip', 'Closes this and shows your new post on the wall');
      }
    } catch (err) {
      setStatus('⚠️ ' + (err.message || 'could not post'));
      gate(btn, false);
    }
  }

  function wire() {
    // on a community page you've joined, the FAB posts HERE (focus the wall's own composer) — not silently to the Send Wall
    const commComposer = document.getElementById('comm-composer');
    const commReady = () => !!(commComposer && !commComposer.hidden);
    const syncFabLabel = () => {
      fab.setAttribute('aria-label', commReady() ? 'Post to this community' : 'Post to your Send Wall, or make a Send Call');
      if (commReady()) { fab.removeAttribute('aria-haspopup'); fab.removeAttribute('aria-controls'); }
      else { fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-controls', 'compose-modal'); }
    };
    if (commComposer && window.MutationObserver) { try { new MutationObserver(syncFabLabel).observe(commComposer, { attributes: true, attributeFilter: ['hidden'] }); } catch {} }
    syncFabLabel();
    fab.addEventListener('click', () => {
      if (commReady()) {
        commComposer.scrollIntoView({ behavior: (window.prefersReduced && prefersReduced()) ? 'auto' : 'smooth', block: 'center' });
        const t = document.getElementById('comm-c-text'); if (t) setTimeout(() => { try { t.focus(); } catch {} }, 250);
        return;
      }
      open();
    });

    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    modal.querySelector('#compose-view').addEventListener('click', () => close()); // on wall.html the link is a same-document #p<id> hash change — the dialog must not stay open over it
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    const textEl = modal.querySelector('#compose-text');
    const countEl = modal.querySelector('#compose-count');
    const sendBtn = modal.querySelector('#compose-send');
    textEl.addEventListener('input', () => {
      const left = 500 - textEl.value.length;
      countEl.textContent = left;
      countEl.setAttribute('aria-hidden', left > 20 ? 'true' : 'false'); // only announce when running low
      gate(sendBtn, !(textEl.value.trim() || pendingImg));
      // pasted a contract address into a plain post? offer the Send Call instead — same paste, bigger move
      const hit = ADDR_RE.exec(textEl.value);
      const nudge = modal.querySelector('#compose-nudge');
      if (hit && !nudge.dataset.addr) {
        nudge.dataset.addr = hit[0];
        nudge.innerHTML = '<span>📣 That’s a token address.</span> <button class="btn btn-ghost btn-sm" type="button" id="compose-nudge-go" data-tip="Moves that pasted address into a Send Call">Make it a Send Call →</button>';
        nudge.hidden = false;
        modal.querySelector('#compose-nudge-go').addEventListener('click', () => {
          const addr = nudge.dataset.addr;
          setMode('call');
          const inp = modal.querySelector('#compose-call-addr');
          inp.value = addr; lookupCallToken(addr);
        });
      } else if (!hit && nudge.dataset.addr) { nudge.hidden = true; nudge.innerHTML = ''; delete nudge.dataset.addr; }
    });
    sendBtn.addEventListener('click', send);

    // ---- mode switch + Send Call controls ----
    modal.querySelector('#cmp-mode-post').addEventListener('click', () => setMode('post'));
    modal.querySelector('#cmp-mode-call').addEventListener('click', () => setMode('call'));
    const addrEl = modal.querySelector('#compose-call-addr');
    addrEl.addEventListener('input', () => {
      const v = addrEl.value.trim();
      clearTimeout(callLookupTimer);
      callTok = null; setCallReady(false);
      if (!v) { callLookupSeq++; callPreview(''); addrEl.removeAttribute('aria-invalid'); return; }
      const hit = ADDR_RE.exec(v);                      // tolerate a pasted explorer URL or stray spaces
      addrEl.setAttribute('aria-invalid', String(!hit)); // the warning below is only visual — this is what the field itself reports
      if (!hit) { callLookupSeq++; callPreview('<p class="modal-note cmp-call-warn" style="margin:0;">Paste a full <b>0x…</b> contract address (40 hex characters).</p>'); return; }
      callLookupTimer = setTimeout(() => lookupCallToken(hit[0].toLowerCase()), 350);
    });
    modal.querySelector('#compose-call-go').addEventListener('click', makeCall);
    const targetSel = targetEl();
    if (targetSel) targetSel.addEventListener('change', squadNote);
    modal.querySelector('#compose-call-note').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !modal.querySelector('#compose-call-go').disabled) makeCall();
    });
    // "see the full on-chain detail" — opens the same popup as everywhere else and clears the no-DYOR flag
    modal.querySelector('#compose-call-preview').addEventListener('click', e => {
      if (!e.target.closest('#compose-call-detail') || !callTok) return;
      /* only a popup that really opened with the full detail clears the flag. A page without one opens the Scanner in a
         new tab — the draft stays put, and the call stays flagged, since this page cannot see what was read there */
      if (window.TokenModal && window.NPCard) { viewedDetail = true; TokenModal.open(callTok.addr, { symbol: callTok.symbol, name: callTok.name }); }
      else window.open('newpairs.html?scan=' + encodeURIComponent(callTok.addr), '_blank', 'noopener');
    });

    const clearComposeMedia = () => { pendingImg = null; const ci = modal.querySelector('#compose-img'); ci._attachGen = (ci._attachGen || 0) + 1; ci.value = ''; window.setMediaPreview(modal.querySelector('#compose-preview'), null); gate(sendBtn, !modal.querySelector('#compose-text').value.trim()); };
    /* The SAME recorder the Send Wall and the profile composer use — one microphone implementation for
       the whole site. It attaches through attachMedia, exactly as a photo does, so everything downstream
       (preview, upload, progress, the ✕ that removes it) already works without knowing what it is. */
    if (window.VoiceMemo) VoiceMemo.wire({
      btn: modal.querySelector('#compose-voice'),
      previewEl: modal.querySelector('#compose-preview'),
      live: modal.querySelector('#compose-status'),
      onClear: () => clearComposeMedia(),
      onStatus: (m) => setStatus(m),
      onAttached: (url) => { pendingImg = url; gate(sendBtn, false); },
    });
    modal.querySelector('#compose-img').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      composeBusy = true; gate(sendBtn, true);
      const r = await window.guardedAttach(e.target, f, modal.querySelector('#compose-preview'), clearComposeMedia, m => setStatus(m));
      composeBusy = false;
      if (r && r.skip) { gate(sendBtn, !(modal.querySelector('#compose-text').value.trim() || pendingImg)); return; } // a flow was already running / it was cleared mid-upload
      setStatus('');
      if (!r) { clearComposeMedia(); return; }
      pendingImg = r.url; gate(sendBtn, false);
    });

    // signed-out gate → close composer, open sign-in, reopen composer once signed in
    modal.querySelector('#compose-signin').addEventListener('click', () => {
      const keepSquad = pendingSquad, keepToken = pendingToken, keepSeen = detailSeenFor;   // a squad page's "call to this squad", or the Scanner's token, survives the sign-in detour
      close();
      pendingSquad = keepSquad; pendingToken = keepToken; detailSeenFor = keepSeen;
      if (window.AUTH) AUTH.open();
      pendingCompose = true;
      /* Abandon the reopen if no successful sign-in follows, so a later unrelated login can't pop the composer open
         uninvited. The short window starts when the sign-in box CLOSES (success or cancel — it covers the async
         post-login refresh), not when it opens: typing a password or making an account takes longer than seconds.
         A sign-in box left open and walked away from gives up after ten minutes. */
      const abandon = () => { pendingCompose = false; pendingSquad = null; pendingToken = null; detailSeenFor = null; };
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(abandon, 10 * 60 * 1000);
      const onAuthClosed = () => { document.removeEventListener('jsi:modalclose', onAuthClosed); if (pendingCompose) { clearTimeout(pendingTimer); pendingTimer = setTimeout(abandon, 8000); } };
      setTimeout(() => document.addEventListener('jsi:modalclose', onAuthClosed), 0);   // after this composer's own close has fired
    });
    modal.querySelector('#compose-again').addEventListener('click', () => { showForAuth(); });

    document.addEventListener('auth:change', e => {
      if (pendingCompose && e.detail) {
        pendingCompose = false; clearTimeout(pendingTimer);
        const tok = pendingToken;
        open();
        if (pendingSquad || tok) setMode('call');
        if (pendingSquad) { ensureSquadOption(pendingSquad.id, pendingSquad.name); setCallTarget(pendingSquad.id); }
        if (tok) fillCallToken(tok);
      }
      else if (!modal.hasAttribute('hidden')) showForAuth();
    });

    // one gentle first-time nudge, then never (CSS gates it under reduced-motion)
    document.addEventListener('jsi:entered', () => {
      fab.classList.add('nudge');
      setTimeout(() => fab.classList.remove('nudge'), 1600);
    }, { once: true });

    // on the wall page, hide the FAB while the inline composer is on screen (avoid duplicate affordance)
    const inline = document.getElementById('composer-card');
    if (inline && 'IntersectionObserver' in window) {
      new IntersectionObserver(ents => { fab.style.display = ents[0].isIntersecting ? 'none' : ''; }, { threshold: 0.05 })
        .observe(inline);
    }
  }

  function init() { build(); wire(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  /* ===== Send Call buttons for any view of a token =====
     The Scanner's result and the detail card under every token — the radar, the token popup, the watchlist, a
     call's own detail — end in the same pair: 📣 to the public Send Wall, and 🛡️ to a Send Squad, a button that
     only exists when the reader is a VERIFIED member of one (the most recently joined is chosen; the composer's
     picker lists them all). Both open this composer in call mode with the token filled in and read. A row marked
     data-viewed (the full detail card writes its rows that way, and so does the Scanner once its detail rendered)
     says the full on-chain detail is on screen, so that call is not flagged "made without DYOR" — for that token
     only; a lighter card (the watchlist's) is not marked, and the composer offers the full detail first.
     callRowHTML(token, { viewed, cls }) writes a row; rows are given their squad button as they appear. */
  let mySquads = null, mySquadsFor = null, mySquadsAt = 0, mySquadsP = null;   // the reader's verified squads, whose, when read (kept a minute)
  function verifiedSquads() {
    const uid = window.AUTH && AUTH.user && AUTH.user.username;   // the signed-in account (the page is not given its numeric id)
    if (!uid || !window.api) return Promise.resolve([]);
    if (mySquads && mySquadsFor === uid && Date.now() - mySquadsAt < 60e3) return Promise.resolve(mySquads);
    if (mySquadsP) return mySquadsP;
    mySquadsP = window.api('/api/squads/mine')
      .then((j) => { mySquads = ((j && j.squads) || []).filter((q) => q && q.verified && q.id > 0); mySquadsFor = uid; mySquadsAt = Date.now(); return mySquads; })
      .catch(() => [])                                            // could not tell: no squad button rather than a wrong one
      .finally(() => { mySquadsP = null; });
    return mySquadsP;
  }
  function callRowHTML(token, opts) {
    const tok = String(token || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(tok)) return '';
    opts = opts || {};
    return '<div class="call-row' + (opts.cls ? ' ' + opts.cls : '') + '" data-call-row data-tok="' + tok + '"' + (opts.viewed ? ' data-viewed="1"' : '') + '>' +
      '<button class="btn btn-primary btn-sm" type="button" data-call-go="wall" data-tip="Opens a Send Call on this token for the public Send Wall — a permanent, live scorecard that starts at today’s price">📣 Send Call to the Wall</button>' +
    '</div>';
  }
  async function paintCallRows(root) {
    const rows = Array.from((root || document).querySelectorAll('[data-call-row]'));
    if (!rows.length) return;
    const list = await verifiedSquads();
    // on a squad's own page, a squad you are verified in there is the one the button calls to
    const ctx = /\/squad(\.html)?$/.test(location.pathname) ? Number(new URLSearchParams(location.search).get('id')) || 0 : 0;
    const q = (ctx && list.find((s) => s.id === ctx)) || list[0], one = list.length === 1 || !!(ctx && q && q.id === ctx);
    for (const row of rows) {
      if (!row.isConnected) continue;
      const old = row.querySelector('[data-call-go="squad"]');
      if (!list.length) { if (old) old.remove(); continue; }   // not in a squad: there is no squad button
      if (old && Number(old.dataset.squadId) === q.id && old.dataset.n === String(list.length) && old.dataset.one === String(one)) continue;
      if (old) old.remove();
      row.insertAdjacentHTML('beforeend',
        '<button class="btn btn-ghost btn-sm" type="button" data-call-go="squad" data-squad-id="' + Number(q.id) + '" data-squad-name="' + esc(q.name) + '" data-n="' + list.length + '" data-one="' + one + '" data-tip="' +
          (one ? 'Opens a Send Call on this token for ' + esc(q.name) + ' — private to the squad, and its points go to the squad'
               : 'Opens a Send Call on this token for one of your Send Squads — pick which one in the box; private to that squad, and its points go to it') + '">' +
          '🛡️ Send Call to ' + (one ? esc(q.name) : 'your Squad') + '</button>');
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-call-go]'); if (!b) return;
    const row = b.closest('[data-call-row]'); if (!row) return;
    e.preventDefault();
    const squad = b.dataset.callGo === 'squad';
    const viewed = row.dataset.viewed === '1';   // written only where the full on-chain detail of this token is on screen
    // a row inside the token popup: close the popup so the composer is not opened underneath it
    if (row.closest('#token-modal, .token-modal') && window.TokenModal && TokenModal.close) { try { TokenModal.close(); } catch {} }
    openCall({ token: row.dataset.tok, viewedDetail: viewed, squadId: squad ? Number(b.dataset.squadId) : 0, squadName: squad ? b.dataset.squadName : '' });
  });
  /* Rows arrive with every detail card and every scan: each gets its squad button as it appears. One paint at a time,
     and one more if rows arrived meanwhile — not tied to animation frames, which a background tab barely runs. */
  let painting = false, paintAgain = false;
  async function queuePaint() {
    if (painting) { paintAgain = true; return; }
    painting = true;
    try { do { paintAgain = false; await paintCallRows(document); } while (paintAgain); } catch {} finally { painting = false; }
  }
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && (n.matches('[data-call-row]') || n.querySelector('[data-call-row]'))) { queuePaint(); return; }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  const repaintCallRows = () => { mySquads = null; mySquadsFor = null; mySquadsAt = 0; if (document.querySelector('[data-call-row]')) paintCallRows(document); };
  document.addEventListener('auth:change', repaintCallRows);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mySquadsAt && Date.now() - mySquadsAt > 60e3) repaintCallRows(); });   // back from joining or leaving a squad in another tab

  // COMPOSE.openCall({ squadId, squadName, token, viewedDetail }) opens the composer in call mode; callRowHTML /
  // paintCallRows give any view of a token its Send Call buttons
  window.COMPOSE = { openCall, callRowHTML, paintCallRows };
})();
