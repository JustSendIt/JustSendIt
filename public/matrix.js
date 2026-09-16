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
  // read on demand, not once at start-up: prefs.js applies a custom accent after this script runs
  let green = '#a8ce00', bright = '#c6f000';
  const readTokens = () => { const cs = getComputedStyle(root); green = (cs.getPropertyValue('--green') || green).trim(); bright = (cs.getPropertyValue('--green-bright') || bright).trim(); };
  readTokens();
  document.addEventListener('DOMContentLoaded', readTokens);
  document.addEventListener('site-prefs', readTokens);
  /* What the rain says. Read a column top to bottom and it spells the site's one instruction, over and
     over; a few columns carry code-noise so the sheet still reads as a matrix and not as a marquee. Nobody
     is meant to notice on purpose — that is the point. */
  const PHRASE = 'JUST SEND IT! ';
  const NOISE = '01$<>/{}[]=+-*#@%&アイウエオカキクケコサシスセソ';
  const CELL = 18;
  let cols = 0, drops = [], pos = [], noisy = [], w = 0, h = 0;

  function size() {
    w = cv.width = Math.floor(window.innerWidth); h = cv.height = Math.floor(window.innerHeight);
    cols = Math.ceil(w / CELL);
    // start each column somewhere in the sheet, not all above it: the first pass used a negative start
    // for every column, so at twelve frames a second nothing reached the viewport for about four seconds
    drops = Array.from({ length: cols }, (_, i) => drops[i] || (Math.random() * 2 - 1) * (h / CELL));
    pos = Array.from({ length: cols }, (_, i) => pos[i] || ((Math.random() * PHRASE.length) | 0));   // each column starts mid-phrase, so the sheet never lines up
    noisy = Array.from({ length: cols }, (_, i) => noisy[i] != null ? noisy[i] : Math.random() < 0.18);
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  }
  size();
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); }, { passive: true });

  let last = 0, raf = 0;
  function draw() {
    // fade the previous frame instead of clearing: that is the trail
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * CELL;
      if (y > 0) {
        const ch = noisy[i] ? NOISE[(Math.random() * NOISE.length) | 0] : PHRASE[pos[i]];
        pos[i] = (pos[i] + 1) % PHRASE.length;   // the next glyph down this column is the next letter
        ctx.fillStyle = Math.random() < 0.08 ? bright : green;
        ctx.fillText(ch, i * CELL, y);
      }
      // reset a column once it has run off the bottom, at a random moment so the sheet never lines up
      if (y > h && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 83) return;           // ~12fps
    last = t;
    if (document.hidden || blocked()) return;
    draw();
  }
  /* one seed frame at mount, whatever the tab's visibility: a page opened in a background tab (or an
     embedded view that never reports itself visible) shows the sheet the instant it is looked at, instead
     of a blank ground until the loop's first unthrottled tick. A single frame costs nothing. */
  if (!blocked()) for (let k = 0; k < 6; k++) draw();
  raf = requestAnimationFrame(frame);

  // clear the trail when paused so a stale sheet is not left frozen behind the page
  const clear = () => { ctx.clearRect(0, 0, w, h); };
  new MutationObserver(() => { if (root.classList.contains('motion-off')) clear(); }).observe(root, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
})();
