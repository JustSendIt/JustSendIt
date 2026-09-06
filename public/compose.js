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
    fab.innerHTML = '<span class="fab-ico" aria-hidden="true">✏️</span><span class="fab-label">Send it</span>';
    document.body.appendChild(fab);

    modal = document.createElement('div');
    modal.id = 'compose-modal';
    modal.setAttribute('hidden', '');
    modal.innerHTML =
      '<div class="modal-backdrop" data-close></div>' +
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="compose-title">' +
        '<button class="modal-x" data-close aria-label="Close composer">✕</button>' +
        '<h2 id="compose-title" class="display" style="color:var(--green-bright); text-align:center; font-size:1.5rem;">Send it to the Wall 🧱</h2>' +

        '<div id="compose-in" hidden>' +
          '<div class="cmp-modes" role="tablist" aria-label="What are you sending?">' +
            '<button class="cmp-mode is-on" type="button" role="tab" id="cmp-mode-post" aria-selected="true" aria-controls="compose-post-pane">🧱 Post</button>' +
            '<button class="cmp-mode" type="button" role="tab" id="cmp-mode-call" aria-selected="false" aria-controls="compose-call-pane">📣 Send Call</button>' +
          '</div>' +
          '<p class="modal-note" style="text-align:center; margin-top:0;">Posting as <b>@<span id="compose-handle"></span></b></p>' +

          '<div id="compose-post-pane" role="tabpanel" aria-labelledby="cmp-mode-post">' +
            '<label class="sr-only" for="compose-text">Write your post</label>' +
            '<textarea id="compose-text" maxlength="500" placeholder="What are you sending? 🚀 Paste a contract address → it becomes a clickable $TICKER (no scams, no seed phrases — ever)"></textarea>' +
            '<div id="compose-nudge" class="cmp-nudge" hidden></div>' +
            '<div id="compose-preview" class="media-preview" hidden aria-label="Attached media preview"></div>' +
            '<div class="composer-bar">' +
              '<label class="file-label" for="compose-img">🖼 Photo / GIF / Video<input type="file" id="compose-img" accept="image/*,video/mp4,video/webm" class="sr-only" aria-label="Attach a photo, GIF, or video"></label>' +
              '<button class="btn btn-primary btn-sm" id="compose-send" disabled>Send it 🚀</button>' +
              '<span class="hint" id="compose-count" aria-hidden="true">500</span>' +
            '</div>' +
            '<p class="modal-note">Public on the Wall and your profile. 🎉 Entertainment only — never post a seed phrase or password.</p>' +
          '</div>' +

          '<div id="compose-call-pane" role="tabpanel" aria-labelledby="cmp-mode-call" hidden>' +
            '<label class="f-label" for="compose-call-addr" style="margin-top:0;">Token contract address</label>' +
            '<input class="addr-input" id="compose-call-addr" type="text" spellcheck="false" autocomplete="off" inputmode="text" placeholder="Paste 0x… contract address" aria-describedby="compose-call-help">' +
            '<div id="compose-call-preview" class="cmp-call-preview" role="status" aria-live="polite"></div>' +
            '<label class="sr-only" for="compose-call-note">Why are you calling it? (optional)</label>' +
            '<textarea id="compose-call-note" maxlength="280" placeholder="Why this one? (optional)"></textarea>' +
            '<div class="composer-bar">' +
              '<button class="btn btn-primary btn-sm" id="compose-call-go" disabled>📣 Make the call</button>' +
              '<span class="hint" id="compose-call-left"></span>' +
            '</div>' +
            '<p class="modal-note" id="compose-call-help">A Send Call posts a <b>live scorecard</b> to your wall that tracks how far this token runs, forever. It is <b>public, timestamped and permanent — calls can never be deleted</b>. Needs a real pool (≥&nbsp;$500 liquidity). 🎉 Entertainment only, never advice.</p>' +
          '</div>' +

          '<p class="modal-note" id="compose-status" role="status" aria-live="polite"></p>' +
        '</div>' +

        '<div id="compose-out" hidden style="text-align:center;">' +
          '<p class="modal-note">Grab your free @handle to post, react 🔥, and start your own wall.</p>' +
          '<button class="btn btn-primary" id="compose-signin">Sign in / Create account 🚪</button>' +
          '<p class="modal-note">We never touch your funds and never ask for your seed phrase.</p>' +
        '</div>' +

        '<div id="compose-done" hidden style="text-align:center;">' +
          '<div style="font-size:2.6rem;" aria-hidden="true" id="compose-done-ico">🚀</div>' +
          '<p style="font-weight:800; color:var(--green-bright); font-size:1.1rem;" id="compose-done-msg">Sent to the Wall!</p>' +
          '<div style="display:flex; gap:0.6rem; justify-content:center; flex-wrap:wrap; margin-top:0.9rem;">' +
            '<a class="btn btn-primary btn-sm" id="compose-view" href="/wall.html">View on the Wall →</a>' +
            '<button class="btn btn-ghost btn-sm" id="compose-again" type="button">Post another ✏️</button>' +
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
      setTimeout(() => { const t = modal.querySelector(mode === 'call' ? '#compose-call-addr' : '#compose-text'); if (t) t.focus(); }, 30);
    } else {
      showPanel('compose-out');
      setTimeout(() => { const b = modal.querySelector('#compose-signin'); if (b) b.focus(); }, 30);
    }
  }

  function open() {
    lastFocus = document.activeElement;
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    setStatus('');
    showForAuth();
    releaseTrap = window.trapFocus ? window.trapFocus(card) : null;
    document.dispatchEvent(new CustomEvent('jsi:modalopen'));
  }
  function close() {
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
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
    modal.querySelector('#compose-send').disabled = true;
    const nudge = modal.querySelector('#compose-nudge'); if (nudge) { nudge.hidden = true; nudge.innerHTML = ''; }
    // Send Call side
    modal.querySelector('#compose-call-addr').value = '';
    modal.querySelector('#compose-call-note').value = '';
    callPreview(''); setCallReady(false); callLookupSeq++; viewedDetail = false;
    setStatus('');
  }

  /* ===== Send Call mode: paste a contract address and post a live call scorecard =====
   * Same button, second job: 🧱 Post writes to the Send Wall, 📣 Send Call goes on the record for a token. */
  const ADDR_RE = /0x[0-9a-fA-F]{40}/;
  const MIN_CALL_LIQ = 500;                 // mirrors the server's MIN_CALL_LIQ so we can warn before the round-trip
  let callTok = null;                       // { addr, symbol, name, liq } once a pasted address resolves
  let callLookupSeq = 0, callLookupTimer = null, viewedDetail = false;

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
  function setCallReady(on) { modal.querySelector('#compose-call-go').disabled = !on; }

  async function lookupCallToken(addr) {
    const seq = ++callLookupSeq;
    callTok = null; setCallReady(false); viewedDetail = false;
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
          ? '<p class="modal-note cmp-call-warn">⚠️ Too thin to call — a pool needs <b>$' + MIN_CALL_LIQ + '+</b> of liquidity (this one has ' + esc(money(liq)) + '). Thin pools are easy to manipulate.</p>'
          : '<p class="modal-note">📖 <button class="linklike" type="button" id="compose-call-detail">See the full on-chain detail first</button> — calls made without looking are flagged on your wall.</p>')
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
    btn.disabled = true; setStatus('Calling it… 📣');
    try {
      const j = await window.api('/api/calls', { method: 'POST', body: { token: callTok.addr, note, viewedDetail } });
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
      modal.querySelector('#compose-done-ico').textContent = '📣';
      modal.querySelector('#compose-done-msg').textContent = 'Send Call posted on $' + callTok.symbol + '!';
      modal.querySelector('#compose-again').textContent = 'Call another 📣';
      showPanel('compose-done');
      setTimeout(() => { const v = modal.querySelector('#compose-view'); if (v) v.focus(); }, 30);
      if (window.sendToast) sendToast('📣 Send Call live on $' + callTok.symbol + ' — your Xs track from here.');
      const r = fab.getBoundingClientRect();
      if (window.sendConfetti) sendConfetti(r.left + r.width / 2, r.top, { count: 50, emojiRatio: 0.5 });
      if (j.pointsEarned && window.showPoints) showPoints(j.pointsEarned, r.left, r.top);
      if (j.post) document.dispatchEvent(new CustomEvent('post:created', { detail: j.post }));
      const view = modal.querySelector('#compose-view');
      if (view) view.href = (j.post && j.post.id) ? '/wall.html#p' + j.post.id : '/wall.html';
      callTok = null;
    } catch (err) {
      setStatus('⚠️ ' + ((err && err.message) || 'could not make that call'));
      btn.disabled = false;
    }
  }

  async function send() {
    const text = modal.querySelector('#compose-text').value.trim();
    if (composeBusy) { setStatus('Hang on — still uploading your media ⏳'); return; }
    if (!text && !pendingImg) { setStatus('Say something or drop a meme first 🤌'); return; }
    const btn = modal.querySelector('#compose-send');
    btn.disabled = true; setStatus('Sending… 🚀');
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
      if (view && j.post && j.post.id) view.href = '/wall.html#p' + j.post.id;
    } catch (err) {
      setStatus('⚠️ ' + (err.message || 'could not post'));
      btn.disabled = false;
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
      sendBtn.disabled = !(textEl.value.trim() || pendingImg);
      // pasted a contract address into a plain post? offer the Send Call instead — same paste, bigger move
      const hit = ADDR_RE.exec(textEl.value);
      const nudge = modal.querySelector('#compose-nudge');
      if (hit && !nudge.dataset.addr) {
        nudge.dataset.addr = hit[0];
        nudge.innerHTML = '<span>📣 That’s a token address.</span> <button class="btn btn-ghost btn-sm" type="button" id="compose-nudge-go">Make it a Send Call →</button>';
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
      if (!v) { callLookupSeq++; callPreview(''); return; }
      const hit = ADDR_RE.exec(v);                      // tolerate a pasted explorer URL or stray spaces
      if (!hit) { callLookupSeq++; callPreview('<p class="modal-note cmp-call-warn" style="margin:0;">Paste a full <b>0x…</b> contract address (40 hex characters).</p>'); return; }
      callLookupTimer = setTimeout(() => lookupCallToken(hit[0].toLowerCase()), 350);
    });
    modal.querySelector('#compose-call-go').addEventListener('click', makeCall);
    modal.querySelector('#compose-call-note').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !modal.querySelector('#compose-call-go').disabled) makeCall();
    });
    // "see the full on-chain detail" — opens the same popup as everywhere else and clears the no-DYOR flag
    modal.querySelector('#compose-call-preview').addEventListener('click', e => {
      if (!e.target.closest('#compose-call-detail') || !callTok) return;
      viewedDetail = true;
      if (window.TokenModal) TokenModal.open(callTok.addr, { symbol: callTok.symbol, name: callTok.name });
      else if (window.sendToast) sendToast('Open this token from New Pairs to see its full detail');
    });

    const clearComposeMedia = () => { pendingImg = null; const ci = modal.querySelector('#compose-img'); ci._attachGen = (ci._attachGen || 0) + 1; ci.value = ''; window.setMediaPreview(modal.querySelector('#compose-preview'), null); sendBtn.disabled = !modal.querySelector('#compose-text').value.trim(); };
    modal.querySelector('#compose-img').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      composeBusy = true; sendBtn.disabled = true;
      const r = await window.guardedAttach(e.target, f, modal.querySelector('#compose-preview'), clearComposeMedia, m => setStatus(m));
      composeBusy = false;
      if (r && r.skip) { sendBtn.disabled = !(modal.querySelector('#compose-text').value.trim() || pendingImg); return; } // a flow was already running / it was cleared mid-upload
      setStatus('');
      if (!r) { clearComposeMedia(); return; }
      pendingImg = r.url; sendBtn.disabled = false;
    });

    // signed-out gate → close composer, open sign-in, reopen composer once signed in
    modal.querySelector('#compose-signin').addEventListener('click', () => {
      close();
      if (window.AUTH) AUTH.open();
      pendingCompose = true;
      // abandon the reopen if no successful sign-in follows shortly, so a later unrelated
      // login can't pop the composer open uninvited (covers the async post-login refresh)
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pendingCompose = false; }, 8000);
    });
    modal.querySelector('#compose-again').addEventListener('click', () => { showForAuth(); });

    document.addEventListener('auth:change', e => {
      if (pendingCompose && e.detail) { pendingCompose = false; clearTimeout(pendingTimer); open(); }
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
})();
