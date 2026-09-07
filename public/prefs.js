/* ===== Site preferences: user-chosen site accent, effects, motion =====
 * Cached in localStorage for instant paint, authoritative copy on the server
 * (users.site_prefs via /api/profile). */
(function () {
  // `colors` is the new full-theme map; siteAccent is kept for backward compatibility with every
  // profile saved before theming existed, and is folded into colors.accent on read.
  const DEFAULTS = { siteAccent: '', colors: {}, confetti: true, ticker: true, musicResume: true };

  /* ===== Contrast =====================================================================
     Relative luminance and ratio per WCAG 2.x. These exist so a user cannot pick a
     combination that makes the site unreadable — which is the whole difference between
     "choose any colour" as a feature and as a trap. */
  const hex2rgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r) => '#' + r.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function lum(hex) {
    const c = hex2rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));

  // Nudge a foreground toward white or black until it clears `need` against every background it is
  // painted on. Iterates to a fixpoint rather than adjusting once, because a single step routinely
  // undershoots on saturated hues.
  function fixFg(fg, bgs, need) {
    if (!isHex(fg)) return fg;
    const worst = (c) => bgs.reduce((m, b) => Math.min(m, ratio(c, b)), Infinity);
    if (worst(fg) >= need) return fg;
    // Push in whichever direction the backgrounds allow, judged on their MEAN luminance — a single
    // light surface in the ramp must not flip the decision for the whole set. Try the other way if
    // the first cannot get there, and keep the better result rather than the last one.
    const mean = bgs.reduce((s, b) => s + lum(b), 0) / bgs.length;
    const run = (up) => {
      let c = fg;
      for (let i = 0; i < 80 && worst(c) < need; i++) {
        const rgb = hex2rgb(c);
        c = rgb2hex(up ? rgb.map(v => v + (255 - v) * 0.06) : rgb.map(v => v * 0.94));
      }
      return c;
    };
    const first = run(mean < 0.35);
    if (worst(first) >= need) return first;
    const second = run(mean >= 0.35);
    return worst(second) > worst(first) ? second : first;
  }

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

  /* Which user-facing control drives which tokens. People think in "accent" and "background",
     not in CSS variables, so the picker exposes five named controls and derives the rest. */
  const GROUPS = {
    accent:     ['--green', '--green-bright', '--green-dark'],
    highlight:  ['--gold', '--gold-deep'],
    rare:       ['--diamond', '--diamond-deep'],
    background: ['--ink', '--ink-2', '--ink-3', '--ink-4', '--void'],
    text:       ['--text', '--text-dim', '--text-mute'],
  };
  // Backgrounds are clamped dark on purpose. Around forty shadows and overlays in styles.css are
  // painted with fixed dark rgba values that do not invert, so at mid or high luminance there is no
  // palette where text, buttons and focus rings all stay readable. The picker says this out loud
  // rather than offering a choice that quietly breaks the site.
  const BG_MAX_LUM = 0.10;

  function themeFrom(colors) {
    const out = {};
    const acc = isHex(colors.accent) ? colors.accent : null;
    const bgBase = isHex(colors.background) ? colors.background : null;

    let bg = bgBase;
    if (bg && lum(bg) > BG_MAX_LUM) {                       // darken until it is a legal ground
      for (let i = 0; i < 60 && lum(bg) > BG_MAX_LUM; i++) bg = rgb2hex(hex2rgb(bg).map(v => v * 0.9));
    }
    if (bg) {
      out['--void'] = shade(bg, 0.62);
      out['--ink'] = bg;
      out['--ink-2'] = shade(bg, 1.07);   // shade(x, f>1) moves (f-1) of the way to WHITE,
      out['--ink-3'] = shade(bg, 1.14);   // so anything at or above 2 is pure white. These are
      out['--ink-4'] = shade(bg, 1.24);   // deliberately small steps, not a doubling.

    }
    const surfaces = [out['--ink'] || '#0b0818', out['--ink-2'] || '#14102a', out['--ink-3'] || '#1d1740', out['--ink-4'] || '#2e2560'];

    if (acc) {
      // The accent may be lightened so buttons and focus outlines stay visible on the chosen
      // ground. When that happens the UI shows the value actually applied — see profile.js.
      let a = acc, bright = shade(a, 1.25);
      for (let i = 0; i < 40 && ratio(bright, surfaces[0]) < 4.5; i++) { a = rgb2hex(hex2rgb(a).map(v => v + (255 - v) * 0.05)); bright = shade(a, 1.25); }
      out['--green'] = a; out['--green-bright'] = bright; out['--green-dark'] = shade(a, 0.6);
      out['--on-green'] = lum(a) > 0.35 ? '#0a1204' : '#f3ffe0';   // ink that reads on the fill itself
    }
    if (isHex(colors.highlight)) { out['--gold'] = fixFg(colors.highlight, surfaces, 4.5); out['--gold-deep'] = shade(out['--gold'], 0.7); }
    if (isHex(colors.rare)) { out['--diamond'] = fixFg(colors.rare, surfaces, 4.5); out['--diamond-deep'] = shade(out['--diamond'], 0.55); }
    if (isHex(colors.text)) {
      // 7:1 (AAA) is the aim, but at the darkest permitted background even pure white only reaches
      // ~7.0:1 against the base surface and less against the lighter ones in the ramp, so AAA is not
      // always reachable. 4.5:1 (AA) is the actual requirement for body text and is always met.
      out['--text'] = fixFg(colors.text, surfaces, 7);
      out['--text-dim'] = fixFg(shade(out['--text'], 0.78), surfaces, 4.5);
      out['--text-mute'] = fixFg(shade(out['--text'], 0.62), surfaces, 4.5);
    }
    return out;
  }
  window.themeFrom = themeFrom;
  window.themeContrast = { lum, ratio, BG_MAX_LUM };

  function apply(p) {
    const root = document.documentElement;
    // legacy siteAccent folds into colors.accent so an old saved profile keeps working
    const colors = Object.assign({}, p.colors || {});
    if (!colors.accent && isHex(p.siteAccent)) colors.accent = p.siteAccent;
    const all = [].concat(...Object.values(GROUPS), ['--on-green']);
    all.forEach(t => root.style.removeProperty(t));
    const solved = themeFrom(colors);
    Object.keys(solved).forEach(t => root.style.setProperty(t, solved[t]));
    window.__confettiEnabled = p.confetti !== false;
    document.querySelectorAll('.ticker').forEach(t => { t.style.display = p.ticker === false ? 'none' : ''; });
    window.__musicResume = p.musicResume !== false;
  }

  const cached = readCache();
  window.SITE_PREFS = cached;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply(cached));
  else apply(cached);

  window.applySitePrefs = function (p, persist) {
    const cur = readCache();
    // colors: null means "replace with empty" (the reset path); an object merges. A plain deep
    // merge would make every reset a silent no-op, which is how the old logout reset only
    // appeared to work — it relied on localStorage being cleared first.
    const colors = (p && p.colors === null) ? {} : Object.assign({}, cur.colors || {}, (p && p.colors) || {});
    const merged = Object.assign({}, cur, p, { colors });
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
