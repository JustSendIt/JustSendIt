/* ===== The rain ====================================================================================
   A fixed canvas under everything: green glyphs falling in columns, the "matrix coder" half of the
   site's synthwave world (the horizon grid and scanlines on body::before/::after are the other half).

   It is decoration and it behaves like decoration:
     - pointer-events:none, aria-hidden, z-index below the page (the ambient stack lives at z <= -1;
       #fx-canvas confetti is 300, the tip bubble 9990 — see styles.css) — it can never sit over anything;
     - off under prefers-reduced-motion, prefers-contrast: more, forced-colors, and html.motion-off (the
       ⏸ in the nav), and it stops drawing while the tab is hidden;
     - throttled to ~12 frames a second and drawn at device-pixel-ratio 1, because a full-screen canvas at
       60fps on a phone is a heater, not a vibe;
     - colours come from the page's own tokens at start-up (--green / --green-bright), read once, so it
       follows the theme editor on the next load and never paints a literal the palette does not own. */
(function () {
  const root = document.documentElement;
  const mq = (q) => { try { return matchMedia(q).matches; } catch { return false; } };
  const blocked = () => mq('(prefers-reduced-motion: reduce)') || mq('(prefers-contrast: more)') || mq('(forced-colors: active)') || root.classList.contains('motion-off');
  if (mq('(prefers-reduced-motion: reduce)') || mq('(prefers-contrast: more)') || mq('(forced-colors: active)')) return;   // never even mount

  const cv = document.createElement('canvas');
  cv.id = 'matrix-rain'; cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;opacity:0.16;';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d', { alpha: true });
  const cs = getComputedStyle(root);
  const green = (cs.getPropertyValue('--green') || '#a8ce00').trim();
  const bright = (cs.getPropertyValue('--green-bright') || '#c6f000').trim();
  const GLYPHS = '01$SENDIT<>/{}[]=+-*#@%&アイウエオカキクケコサシスセソ';
  const CELL = 18;
  let cols = 0, drops = [], w = 0, h = 0;

  function size() {
    w = cv.width = Math.floor(window.innerWidth); h = cv.height = Math.floor(window.innerHeight);
    cols = Math.ceil(w / CELL);
    drops = Array.from({ length: cols }, (_, i) => drops[i] || (Math.random() * -h / CELL));
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  }
  size();
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); }, { passive: true });

  let last = 0, raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 83) return;           // ~12fps
    last = t;
    if (document.hidden || blocked()) { return; }
    // fade the previous frame instead of clearing: that is the trail
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * CELL;
      if (y > 0) {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        ctx.fillStyle = Math.random() < 0.08 ? bright : green;
        ctx.fillText(ch, i * CELL, y);
      }
      // reset a column once it has run off the bottom, at a random moment so the sheet never lines up
      if (y > h && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  }
  raf = requestAnimationFrame(frame);

  // clear the trail when paused so a stale sheet is not left frozen behind the page
  const clear = () => { ctx.clearRect(0, 0, w, h); };
  new MutationObserver(() => { if (root.classList.contains('motion-off')) clear(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
})();
