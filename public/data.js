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
    const b = e.burn, pct = b && b.usd != null ? Math.min(100, b.usd / e.threshold * 100) : 0;
    let h = '';
    if (e.error) h += '<p class="dk-note">⚠️ ' + esc(e.error) + '</p>';
    if (b && !b.wallets) h += '<p class="dk-note">No wallet is linked to this account yet. Link the wallet you burn from on your <a href="profile.html">dashboard</a>.</p>'; // only when the chain was actually read and found none — a failed read says so above instead
    if (b) {
      h += '<div class="dk-stat"><span>Linked wallets read</span><b>' + b.wallets + '</b></div>' +
        '<div class="dk-stat"><span>$SEND sent to the burn address</span><b>' + tok(b.tokens) + ' SEND</b></div>' +
        '<div class="dk-stat"><span>$SEND price now</span><b>' + (b.priceUsd != null ? '$' + Number(b.priceUsd).toPrecision(4) : 'unavailable') + '</b></div>' +
        '<div class="dk-stat"><span>Burn value at that price</span><b>' + (b.usd != null ? usd(b.usd) : '—') + ' of ' + usd(e.threshold) + '</b></div>' +
        (b.usd != null
          ? '<div class="dk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="Progress to the $' + e.threshold + ' burn"><span style="width:' + pct.toFixed(1) + '%"></span></div>'
          : '<p class="dk-note">The $SEND price can\'t be read right now, so the burn can\'t be valued yet — nothing is assumed. Re-check in a minute.</p>');
    }
    if (e.key) {
      h += '<p class="dk-note">🔑 <b>You have a live key</b>, minted ' + esc(new Date(e.key.mintedAt).toUTCString().slice(0, 16)) + (e.key.lastUsedAt ? ', last used ' + esc(new Date(e.key.lastUsedAt).toUTCString().slice(0, 16)) : ', never used yet') + '. It is not stored anywhere readable, so it cannot be shown again — mint a new one to replace it (the old one stops working).</p>';
    }
    h += '<div class="dk-actions">' +
      (e.eligible ? '<button class="btn btn-sm btn-primary" id="dk-mint" type="button">' + (e.key ? 'Mint a replacement key' : 'Mint my key') + '</button>' : '<button class="btn btn-sm btn-primary" type="button" disabled title="Reach the $' + e.threshold + ' burn first">Mint my key</button>') +
      (e.key ? '<button class="btn btn-sm btn-ghost" id="dk-revoke" type="button">Revoke key</button>' : '') +
      '<button class="btn btn-sm btn-ghost" id="dk-retry" type="button">Re-check the chain</button></div>';
    card.innerHTML = h; wire();
  }
  function wire() {
    const m = document.getElementById('dk-mint'), rv = document.getElementById('dk-revoke'), rt = document.getElementById('dk-retry');
    if (rt) rt.addEventListener('click', () => { card.innerHTML = '<p class="dk-note">Reading the chain…</p>'; load(true); });
    if (rv) rv.addEventListener('click', async () => { rv.disabled = true; const r = await J('/api/data/key/revoke', { method: 'POST', body: '{}' }); say(r.ok ? 'Key revoked' : 'Could not revoke'); load(); });
    if (m) m.addEventListener('click', async () => {
      m.disabled = true; m.textContent = 'Reading the chain…';
      const r = await J('/api/data/key', { method: 'POST', body: '{}' });
      if (!r.ok || !r.j || !r.j.key) { say('⚠️ ' + ((r.j && r.j.error) || 'could not mint')); load(); return; }
      card.innerHTML = '<p><b>Your key — shown once.</b> Copy it now; it is stored only as a hash and cannot be shown again.</p>' +
        '<div class="dk-key" id="dk-keytext">' + esc(r.j.key) + '</div>' +
        '<div class="dk-actions"><button class="btn btn-sm btn-primary" id="dk-copy" type="button">Copy key</button><button class="btn btn-sm btn-ghost" id="dk-done" type="button">I have saved it</button></div>' +
        '<p class="dk-note">Minted against a burn worth ' + usd(r.j.burnedUsd) + ' at $' + Number(r.j.priceUsd).toPrecision(4) + ' per $SEND. Anyone holding this key can read your own private data — treat it like a password.</p>';
      document.getElementById('dk-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.j.key); say('Key copied'); } catch { say('Select the key and copy it manually'); } });
      document.getElementById('dk-done').addEventListener('click', load);
      say('Key minted — it is shown once');
    });
  }
  load();
})();
