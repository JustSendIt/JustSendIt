/* ===== Data API page: your eligibility, and the one place a key is ever shown ===== */
(function () {
  const card = document.getElementById('dk-card'), sr = document.getElementById('dk-sr');
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const tok = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const say = t => { if (sr) sr.textContent = t; if (window.sendToast) sendToast(t); };
  const J = (p, opt) => fetch(p, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opt || {})).then(async r => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => null) }));

  async function load(fresh) {
    const r = await J('/api/data/eligibility' + (fresh ? '?fresh=1' : ''));
    if (r.status === 401) { card.innerHTML = '<p class="dk-note">Sign in and link the wallet you burn from, then come back — your burn is read from your linked wallets.</p>'; return; }
    if (!r.ok || !r.j) { card.innerHTML = '<p class="dk-note">Could not check right now. <button class="btn btn-sm btn-ghost" id="dk-retry" type="button">Try again</button></p>'; wire(); return; }
    render(r.j);
  }
  function render(e) {
    const b = e.burn, pct = b && b.availableUsd != null && e.threshold > 0 ? Math.min(100, b.availableUsd / e.threshold * 100) : 0;
    let h = '';
    // the price of a year, for THIS account
    if (e.free) h += '<p class="dk-note">👑 <b>OG Gold: your key is free and never expires</b> — for as long as you stay Gold. No burn needed.</p>';
    else if (e.discountPct) h += '<p class="dk-note">🏅 <b>OG ' + esc(e.tierName) + ': ' + e.discountPct + '% off</b> — a year costs a <b>' + usd(e.threshold) + '</b> burn instead of ' + usd(e.baseThreshold) + '.</p>';
    else h += '<p class="dk-note">A year costs a <b>' + usd(e.threshold) + '</b> burn of $SEND; renewing takes another ' + usd(e.threshold) + ' and adds a year to your current expiry.</p>';
    if (e.error) h += '<p class="dk-note">⚠️ ' + esc(e.error) + '</p>';
    if (b && !b.wallets) h += '<p class="dk-note">No wallet is linked to this account yet. Link the wallet you burn from on your <a href="profile.html">dashboard</a>.</p>'; // only when the chain was actually read and found none — a failed read says so above instead
    if (b) {
      h += '<div class="dk-stat"><span>Linked wallets read</span><b>' + b.wallets + '</b></div>' +
        '<div class="dk-stat"><span>$SEND sent to the burn address</span><b>' + tok(b.tokens) + ' SEND</b></div>' +
        '<div class="dk-stat"><span>$SEND price now</span><b>' + (b.priceUsd != null ? '$' + Number(b.priceUsd).toPrecision(4) : 'unavailable') + '</b></div>' +
        '<div class="dk-stat"><span>Already spent on earlier keys</span><b>' + tok(b.tokens - b.availableTokens) + ' SEND</b></div>' +
        '<div class="dk-stat"><span>Unspent burn, at that price</span><b>' + (b.availableUsd != null ? usd(b.availableUsd) : '—') + ' of ' + usd(e.threshold) + '</b></div>' +
        (b.availableUsd != null
          ? '<div class="dk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="Unspent burn toward the ' + usd(e.threshold) + ' needed"><span style="width:' + pct.toFixed(1) + '%"></span></div>'
          : '<p class="dk-note">The $SEND price can\'t be read right now, so the burn can\'t be valued yet — nothing is assumed. Re-check in a minute.</p>');
    }
    if (e.key) {
      const when = esc(new Date(e.key.mintedAt).toUTCString());
      const exp = e.key.expiresAt == null ? null : esc(new Date(e.key.expiresAt).toUTCString());
      const life = e.key.source === 'og_gold'
        ? (e.free ? 'It never expires while you stay OG Gold.' + (exp ? ' If the badge ever goes, the time you had already paid for (until ' + exp + ') still counts.' : '')
                  : (e.key.live ? 'It was free with OG Gold; that badge has gone, and it now runs on the time you had paid for, <b>until ' + exp + '</b>.' : 'It was free with OG Gold, and <b>stopped working when that badge went</b>.'))
        : e.key.live ? 'It <b>expires ' + exp + '</b> (' + e.key.daysLeft + ' full day' + (e.key.daysLeft === 1 ? '' : 's') + ' left). Renewing adds a year to that date.'
        : 'It <b>expired ' + exp + '</b> — mint again to start a new year.';
      h += '<p class="dk-note">🔑 <b>' + (e.key.live ? 'You have a live key' : 'Your key is no longer active') + '</b>, minted ' + when + (e.key.lastUsedAt ? ', last used ' + esc(new Date(e.key.lastUsedAt).toUTCString().slice(0, 16)) : ', never used yet') + '. ' + life + ' It is not stored anywhere readable, so it cannot be shown again. <b>If it leaks, rotate it</b> — a new secret, same expiry, nothing spent. Revoking a key does not refund a spent burn.</p>';
    }
    const goldHoldsPaid = e.free && e.key && e.key.live && e.key.source === 'burn';
    const mintLabel = e.free ? (goldHoldsPaid ? 'Switch to my free Gold key (paid time kept)' : e.key && e.key.live ? 'Mint a replacement key' : 'Mint my free key') : (e.key && e.key.live ? 'Renew — +1 year for ' + usd(e.threshold) : 'Mint my key — 1 year for ' + usd(e.threshold));
    h += '<div class="dk-actions">' +
      (e.eligible ? '<button class="btn btn-sm btn-primary" id="dk-mint" type="button">' + mintLabel + '</button>' : '<button class="btn btn-sm btn-primary" type="button" disabled title="Reach ' + usd(e.threshold) + ' of unspent burn first">' + mintLabel + '</button>') +
      (e.key && e.key.rotatable ? '<button class="btn btn-sm btn-ghost" id="dk-rotate" type="button" title="New secret, same expiry, nothing spent">Rotate key</button>' : '') +
      (e.key ? '<button class="btn btn-sm btn-ghost" id="dk-revoke" type="button">Revoke key</button>' : '') +
      '<button class="btn btn-sm btn-ghost" id="dk-retry" type="button">Re-check the chain</button></div>';
    card.innerHTML = h; wire();
  }
  function wire() {
    const m = document.getElementById('dk-mint'), rv = document.getElementById('dk-revoke'), rt = document.getElementById('dk-retry'), ro = document.getElementById('dk-rotate');
    if (ro) ro.addEventListener('click', async () => {
      ro.disabled = true;
      const r = await J('/api/data/key/rotate', { method: 'POST', body: '{}' });
      if (!r.ok || !r.j || !r.j.key) { say('⚠️ ' + ((r.j && r.j.error) || 'could not rotate')); load(); return; }
      showKey(r.j.key, 'Rotated. The old secret is dead; this one keeps ' + (r.j.expiresAt ? 'your expiry, ' + esc(new Date(r.j.expiresAt).toUTCString()) : 'its no-expiry status') + ', and spent nothing.');
    });
    if (rt) rt.addEventListener('click', () => { card.innerHTML = '<p class="dk-note">Reading the chain…</p>'; load(true); });
    if (rv) rv.addEventListener('click', async () => { rv.disabled = true; const r = await J('/api/data/key/revoke', { method: 'POST', body: '{}' }); say(r.ok ? 'Key revoked' : 'Could not revoke'); load(); });
    if (m) m.addEventListener('click', async () => {
      m.disabled = true; m.textContent = 'Reading the chain…';
      const r = await J('/api/data/key', { method: 'POST', body: '{}' });
      if (!r.ok || !r.j || !r.j.key) { say('⚠️ ' + ((r.j && r.j.error) || 'could not mint')); load(); return; }
      showKey(r.j.key, (r.j.source === 'og_gold' ? 'Free with your OG Gold — it never expires while you stay Gold.' + (r.j.paidUntil ? ' The time you had already paid for (until ' + esc(new Date(r.j.paidUntil).toUTCString()) + ') is kept as a fallback if the badge ever goes.' : '') : 'Good until <b>' + esc(new Date(r.j.expiresAt).toUTCString()) + '</b>. It spent ' + tok(r.j.spentTokens) + ' SEND of your burn (' + usd(r.j.spentUsd) + ' at $' + Number(r.j.priceUsd).toPrecision(4) + ' per $SEND' + (r.j.discountPct ? ', with your ' + r.j.discountPct + '% OG discount' : '') + ').'));
    });
  }
  function showKey(key, note) {
    card.innerHTML = '<p><b>Your key — shown once.</b> Copy it now; it is stored only as a hash and cannot be shown again.</p>' +
      '<div class="dk-key" id="dk-keytext">' + esc(key) + '</div>' +
      '<div class="dk-actions"><button class="btn btn-sm btn-primary" id="dk-copy" type="button">Copy key</button><button class="btn btn-sm btn-ghost" id="dk-done" type="button">I have saved it</button></div>' +
      '<p class="dk-note">' + note + ' Anyone holding this key can read your own private data — treat it like a password.</p>';
    document.getElementById('dk-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(key); say('Key copied'); } catch { say('Select the key and copy it manually'); } });
    document.getElementById('dk-done').addEventListener('click', () => load());
    say('Key shown once — copy it now');
  }
  load();
})();
