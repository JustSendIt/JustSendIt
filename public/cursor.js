/* ===== Rocket cursor 🚀 — the site's one pointer, with fading explosion trails + a click burst =====
 * On a mouse or trackpad the browser's own arrow, hand and text beam are hidden on every page from the first frame
 * (html.rk-on, cursor.css), and the rocket is the pointer. It shows only while the pointer is on the page: it goes
 * when the pointer leaves the window and comes back where the pointer is. A click through to the next page starts
 * the rocket where the pointer already is (the new page is told nothing until the pointer moves).
 * Loaded in each page's <head>, straight after cursor.css: the arrow is gone before the first paint, and every move
 * made while the rest of the page loads is heard.
 * Only on precise pointers (mouse), and disabled for reduced-motion users (they keep the native cursor).
 * Purely decorative: the layer + rocket are pointer-events:none, so real clicks/hover are unaffected.
 *
 * A few things draw the browser's own pointer, and no page can hide it there: a frame from another site (an outside
 * chart), a video or voice memo's player, a scroll bar, a text box's resize corner, a menu or picker the browser opens,
 * a drag, full screen. The rocket steps aside for those until the pointer moves back onto the page, so there is never
 * a second pointer frozen beside the real one. */
(function () {
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  if (!window.matchMedia || !mq('(pointer: fine)')) return;                                              // no touch/coarse pointers
  if (mq('(prefers-reduced-motion: reduce)')) return;                            // respect reduced motion
  const root = document.documentElement;
  // no cursor.css on this page (it is linked just above this script, so it has loaded by now): leave the browser's pointer alone —
  // without it the rocket would be an emoji at the foot of the page, and the visitor would have no pointer at all
  if (![].some.call(document.styleSheets || [], (sh) => /\/cursor\.css(\?|$)/.test(sh.href || ''))) return;
  const KEY = 'send.rk';                    // sessionStorage "x,y,ms,path": where the pointer was when that page went
  const PICKER = 'input[type="file"], input[type="color"], input[type="date"], input[type="time"], input[type="datetime-local"], input[type="month"], input[type="week"]';

  const layer = document.createElement('div'); layer.className = 'rk-layer'; layer.setAttribute('aria-hidden', 'true');
  const rocket = document.createElement('div'); rocket.className = 'rk-cursor'; rocket.textContent = '🚀'; rocket.setAttribute('aria-hidden', 'true');
  rocket.style.opacity = '0';                                                    // nothing to show until we know where the pointer is
  const frames = document.getElementsByTagName('iframe');                        // live: the outside charts come and go

  let x = 0, y = 0, tx = 0, ty = 0, vx = 0, vy = 0, raf = null, lastTrail = 0, shown = false, seen = false, quiet = 0;
  // Windows middle-button autoscroll: the browser draws its own pan cursor from the press until the next press (or until the
  // release, when the button was held and dragged). macOS and Linux browsers do not autoscroll by default.
  const WIN = /win/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  let pan = null;
  function place() {
    // the box's CENTRE sits on the pointer (translate -50%), and it turns about that same centre, so the
    // middle of the rocket is exactly where a click lands
    rocket.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%, -50%) rotate(-90deg)';
  }
  function loop() {
    x += (tx - x) * 0.35; y += (ty - y) * 0.35;                                    // gentle easing → a flying feel
    place();
    // park the loop once the rocket has caught up with the pointer — an always-on rAF would keep writing
    // styles 60×/s on every page for as long as the tab lives, for no visible change. A move restarts it.
    if (Math.abs(tx - x) < 0.5 && Math.abs(ty - y) < 0.5) { x = tx; y = ty; place(); raf = null; return; }   // land exactly on it, then rest
    raf = requestAnimationFrame(loop);
  }
  const fullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function menuOpen() {                                                          // a <select>'s list is the browser's, with the browser's arrow
    const a = document.activeElement;
    if (!a || a.tagName !== 'SELECT') return false;
    try { return a.matches(':open'); } catch (e) { return false; }               // a browser that cannot say: the press already hid the rocket
  }
  function show(cx, cy) {
    tx = cx; ty = cy; seen = true;
    if (pan || fullscreen() || menuOpen()) { hide(); return; }
    if (!shown) { shown = true; vx = vy = 0; x = tx; y = ty; place(); rocket.style.opacity = ''; return; }   // appear where the pointer IS, never fly in from where it left
    if (!raf) loop();
  }
  function hide() {
    clearTimeout(quiet);
    if (!shown) return;
    shown = false; rocket.style.opacity = '0';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }
  // a whole element whose pointer the browser draws: a frame, or a video or voice memo's player (cursor.css gives it back there)
  const browserDrawn = (el) => !!el && (el.tagName === 'IFRAME' || ((el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && !!el.controls));
  // Is the pointer where the browser draws its own, whatever the page says? A frame, a player, the page's scroll bar, a
  // box's scroll bar, a text box's resize corner.
  function native(e) {
    const t = e.target;
    if (!t || t.nodeType !== 1) return false;
    if (browserDrawn(t)) return true;
    if (e.clientX >= root.clientWidth || e.clientY >= root.clientHeight) return true;   // the page's bar (a classic bar takes room; an overlay bar takes none, and cannot be told apart)
    if (t === root || t === document.body || !(t instanceof HTMLElement)) return false;  // (an SVG part has no bar, nor an offsetWidth)
    const cw = t.clientWidth, ch = t.clientHeight;
    if (!cw || !ch) return false;                                                // an inline box has no bar
    const xr = t.offsetWidth - cw - t.clientLeft, yr = t.offsetHeight - ch - t.clientTop;   // right border + bar, bottom border + bar
    const box = t.tagName === 'TEXTAREA';
    if (xr <= 2 && yr <= 2 && !box) return false;                                // the usual case: no bar, a hairline border at most
    const cs = getComputedStyle(t), r = t.getBoundingClientRect();
    const bw = Math.max(0, xr - (parseFloat(cs.borderRightWidth) || 0)), bh = Math.max(0, yr - (parseFloat(cs.borderBottomWidth) || 0));
    const ox = e.clientX - r.left - t.clientLeft, oy = e.clientY - r.top - t.clientTop;      // from the padding box's top left
    if (ox < 0 || oy < 0 || ox >= cw + bw || oy >= ch + bh) return false;        // on the border, or outside (a captured drag)
    if (ox >= cw || oy >= ch) return true;                                       // on a bar, or the corner between two
    return box && cs.resize !== 'none' && ox >= cw + bw - 16 && oy >= ch + bh - 16;
  }
  // Chrome tells a page nothing when the pointer crosses into a frame from another site (an outside chart): the moves
  // just stop. So moves that stop with the frame one step ahead have gone in, and the frame shows its own pointer. One step
  // (a quarter more for a speeding hand), not more: a pointer that stops on the chart's own buttons just above it is still here.
  function wentIntoFrame() {
    const v = Math.hypot(vx, vy);
    if (!shown || v < 2) return;                                                 // a pointer easing to a stop near a chart is still on the page
    const step = Math.max(v * 1.25, 4) / v;
    const el = document.elementFromPoint(tx + vx * step, ty + vy * step);
    if (el && el.tagName === 'IFRAME') hide();
  }
  function particle(px, py, cls, glyph) {
    const s = document.createElement('span');
    s.className = 'rk-p ' + cls; s.textContent = glyph;
    s.style.left = px + 'px'; s.style.top = py + 'px';
    layer.appendChild(s);
    return s;
  }

  function wire() {
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || native(e)) { hide(); return; }            // a finger has no pointer to draw
      const was = shown, dx = e.clientX - tx, dy = e.clientY - ty;
      show(e.clientX, e.clientY);
      if (!shown) return;
      if (was) { vx = dx; vy = dy; }
      if (frames.length) { clearTimeout(quiet); quiet = setTimeout(wentIntoFrame, 80); }
      const t = performance.now();
      if (t - lastTrail > 24) {                                                    // leave a fading spark trail
        lastTrail = t;
        const p = particle(e.clientX, e.clientY, 'rk-trail', '💥');
        setTimeout(() => p.remove(), 220);                                         // fades to 0 opacity in 0.2s (CSS)
      }
    }, { passive: true });
    // also sent, without a move, when the page shifts under a still pointer (a scroll, a layout change): it says where the
    // pointer is now, and what is under it (a frame from this site says so this way)
    addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      if (native(e)) { hide(); return; }
      show(e.clientX, e.clientY);
    }, { passive: true });
    addEventListener('mousedown', (e) => {   // (the mouse event: a page that cancels it has stopped the autoscroll too)
      if (pan) { pan = null; show(e.clientX, e.clientY); return; }                  // any press ends an autoscroll, a middle one too
      if (!WIN || e.button !== 1 || e.defaultPrevented) return;
      const t = e.target;
      if (t && t.closest && t.closest('a[href], input, textarea, select, [contenteditable="true"]')) return;   // a link opens a tab; a field pastes
      pan = { x: e.clientX, y: e.clientY }; hide();
    });
    addEventListener('pointerup', (e) => {   // a held, dragged middle button: the autoscroll ends with the release
      if (pan && e.button === 1 && Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 6) { pan = null; show(e.clientX, e.clientY); }
    }, { passive: true });
    addEventListener('pointerdown', (e) => {
      const t = e.target;
      clearTimeout(quiet);                                                           // a press: the pointer is resting on what it pressed
      if (e.pointerType === 'touch' || native(e)) { hide(); return; }
      if (t && t.tagName === 'SELECT' && !t.multiple && !(t.size > 1)) { hide(); return; }   // it opens the browser's own menu
      show(e.clientX, e.clientY);
      if (!shown) return;
      for (let i = 0; i < 8; i++) {                                                 // a little explosion on click
        const ang = (Math.PI * 2 / 8) * i, dist = 18 + Math.random() * 16;
        const p = particle(e.clientX, e.clientY, 'rk-burst', i % 2 ? '💥' : '✨');
        p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
        p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
        setTimeout(() => p.remove(), 480);
      }
    }, { passive: true });
    // a file, colour or date picker is the browser's too (a label's click, or a script's, arrives here as well)
    addEventListener('click', (e) => { const t = e.target; if (t && t.matches && t.matches(PICKER)) hide(); }, true);
    addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) hide(); });   // the right-click menu
    addEventListener('dragstart', hide);                                             // the drag image carries the browser's pointer
    root.addEventListener('mouseleave', hide);                                       // off the page (window's own mouseleave never fires)
    addEventListener('blur', () => { pan = null; hide(); });                         // another app, tab or dialog has the pointer now
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
    // the scroll moves the page under a still pointer: an outside chart may slide under it
    addEventListener('scroll', () => { if (shown && seen) { const el = document.elementFromPoint(tx, ty); if (browserDrawn(el)) hide(); } }, { capture: true, passive: true });
    // full screen sits above every layer of the page, the rocket's included, so the browser's pointer comes back there
    const onFull = () => { const f = fullscreen(); root.classList.toggle('rk-on', !f); if (f) hide(); else if (seen) show(tx, ty); };   // back: where the last move left it
    document.addEventListener('fullscreenchange', onFull);
    document.addEventListener('webkitfullscreenchange', onFull);
    addEventListener('pagehide', () => {
      try { if (shown) sessionStorage.setItem(KEY, Math.round(tx) + ',' + Math.round(ty) + ',' + Date.now() + ',' + location.pathname + location.search); else sessionStorage.removeItem(KEY); } catch (e) {}
    });
    // Back to a page kept in memory: the pointer is most likely on the browser's own Back button, so no rocket until it moves
    addEventListener('pageshow', (e) => { if (e.persisted) { pan = null; hide(); } });
  }
  /* Where the pointer was when the last page went, for a page that has heard nothing yet. Only for a click (or a script)
     straight through from that very page within a few seconds: Back, Forward, a reload or a typed address leave the pointer
     on the browser's own bar, and a stale spot is worse than none. */
  function restore() {
    let v = null;
    try { v = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
    const m = /^(\d+),(\d+),(\d+),(\/.*)$/.exec(v || '');
    if (!m || seen) return;
    let nav = 'navigate';
    try { const n = performance.getEntriesByType('navigation')[0]; if (n && n.type) nav = n.type; } catch (e) {}
    if (nav !== 'navigate' || document.referrer !== location.origin + m[4]) return;
    const cx = +m[1], cy = +m[2], age = Date.now() - +m[3];
    if (age < 0 || age > 5000 || cx >= root.clientWidth || cy >= root.clientHeight) return;
    if (browserDrawn(document.elementFromPoint(cx, cy))) return;
    show(cx, cy);
  }
  function mount() { document.body.appendChild(layer); document.body.appendChild(rocket); }
  root.classList.add('rk-on');                                                     // before the first paint: no arrow, ever
  wire();                                                                          // and every move from here on is heard
  restore();
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
