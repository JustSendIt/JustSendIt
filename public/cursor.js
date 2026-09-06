/* ===== Rocket cursor 🚀 — a fun animated cursor with fading explosion trails + a click burst =====
 * Only on precise pointers (mouse), and disabled for reduced-motion users (they keep the native cursor).
 * Purely decorative: the layer + rocket are pointer-events:none, so real clicks/hover are unaffected. */
(function () {
  if (!window.matchMedia || !matchMedia('(pointer: fine)').matches) return;      // no touch/coarse pointers
  if (window.prefersReduced && window.prefersReduced()) return;                    // respect reduced motion

  const layer = document.createElement('div'); layer.className = 'rk-layer'; layer.setAttribute('aria-hidden', 'true');
  const rocket = document.createElement('div'); rocket.className = 'rk-cursor'; rocket.textContent = '🚀'; rocket.setAttribute('aria-hidden', 'true');
  let mounted = false;
  function mount() { if (mounted || !document.body) return; document.body.appendChild(layer); document.body.appendChild(rocket); document.body.classList.add('rk-on'); mounted = true; }

  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, raf = null, lastTrail = 0;
  function loop() {
    x += (tx - x) * 0.35; y += (ty - y) * 0.35;                                    // gentle easing → a flying feel
    rocket.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(-90deg)';
    // park the loop once the rocket has caught up with the pointer — an always-on rAF would keep writing
    // styles 60×/s on every page for as long as the tab lives, for no visible change. mousemove restarts it.
    if (Math.abs(tx - x) < 0.5 && Math.abs(ty - y) < 0.5) { x = tx; y = ty; raf = null; return; }
    raf = requestAnimationFrame(loop);
  }
  function particle(px, py, cls, glyph) {
    const s = document.createElement('span');
    s.className = 'rk-p ' + cls; s.textContent = glyph;
    s.style.left = px + 'px'; s.style.top = py + 'px';
    layer.appendChild(s);
    return s;
  }
  addEventListener('mousemove', (e) => {
    mount();
    tx = e.clientX; ty = e.clientY;
    if (!raf) loop();
    const t = performance.now();
    if (t - lastTrail > 24) {                                                       // leave a fading spark trail
      lastTrail = t;
      const p = particle(e.clientX, e.clientY, 'rk-trail', '💥');
      setTimeout(() => p.remove(), 220);                                            // fades to 0 opacity in 0.2s (CSS)
    }
  }, { passive: true });
  addEventListener('mousedown', (e) => {
    mount();
    for (let i = 0; i < 8; i++) {                                                    // a little explosion on click
      const ang = (Math.PI * 2 / 8) * i, dist = 18 + Math.random() * 16;
      const p = particle(e.clientX, e.clientY, 'rk-burst', i % 2 ? '💥' : '✨');
      p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      setTimeout(() => p.remove(), 480);
    }
  });
  addEventListener('mouseleave', () => { rocket.style.opacity = '0'; });
  addEventListener('mouseenter', () => { rocket.style.opacity = ''; });
})();
