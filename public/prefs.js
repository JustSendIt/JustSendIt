/* ===== Site preferences: user-chosen site accent, effects, motion =====
 * Cached in localStorage for instant paint, authoritative copy on the server
 * (users.site_prefs via /api/profile). */
(function () {
  const DEFAULTS = { siteAccent: '', confetti: true, ticker: true, musicResume: true };

  function readCache() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('site-prefs') || '{}')) }; }
    catch { return { ...DEFAULTS }; }
  }
  function writeCache(p) { try { localStorage.setItem('site-prefs', JSON.stringify(p)); } catch {} }

  function shade(hex, f) {
    // f<1 darkens, f>1 lightens toward white
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f <= 1) { r *= f; g *= f; b *= f; }
    else { r += (255 - r) * (f - 1); g += (255 - g) * (f - 1); b += (255 - b) * (f - 1); }
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }

  function apply(p) {
    const root = document.documentElement;
    if (p.siteAccent && /^#[0-9a-fA-F]{6}$/.test(p.siteAccent)) {
      root.style.setProperty('--green', p.siteAccent);
      root.style.setProperty('--green-bright', shade(p.siteAccent, 1.25));
      root.style.setProperty('--green-dark', shade(p.siteAccent, 0.6));
    } else {
      root.style.removeProperty('--green');
      root.style.removeProperty('--green-bright');
      root.style.removeProperty('--green-dark');
    }
    window.__confettiEnabled = p.confetti !== false;
    document.querySelectorAll('.ticker').forEach(t => { t.style.display = p.ticker === false ? 'none' : ''; });
    window.__musicResume = p.musicResume !== false;
  }

  const cached = readCache();
  window.SITE_PREFS = cached;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(cached));
  else apply(cached);

  window.applySitePrefs = function (p, persist) {
    const merged = { ...readCache(), ...p };
    window.SITE_PREFS = merged;
    writeCache(merged);
    apply(merged);
    if (persist && window.api) window.api('/api/profile', { method: 'POST', body: { site_prefs: merged } }).catch(() => {});
  };

  // apply the signed-in user's server-stored prefs (called on load AND after any auth change,
  // e.g. a modal sign-in that doesn't reload the page). Falls back to defaults when signed out.
  function applyFromUser() {
    const sp = (window.AUTH && AUTH.user && AUTH.user.site_prefs) || null;
    if (!sp || !Object.keys(sp).length) return; // no server prefs → leave current (cache/defaults)
    const merged = { ...DEFAULTS, ...sp };
    window.SITE_PREFS = merged;
    writeCache(merged);
    apply(merged);
  }
  window.syncSitePrefs = applyFromUser;

  const sync = () => {
    if (window.AUTH && AUTH.ready) AUTH.ready.then(applyFromUser).catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
