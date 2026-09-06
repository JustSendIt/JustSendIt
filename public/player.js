/* ===== $Send music player =====
 * Honest autoplay handling (browsers block sound before a gesture):
 *  - returning listener (mp-on=1): resume on load, else on first interaction — no hint
 *  - brand-new visitor (mp-on=null): arm to the entry-dismiss gesture (jsi:firstgesture) and
 *    show a one-tap unmute hint; never render "playing" until an audio.play() promise resolves
 *  - opted-out (mp-on=0): stay silent forever, never nag
 * The intro/entry animation now lives in entry.js (homepage only). */
(function () {
  function initPlayer() {
    const wrap = document.createElement('div');
    wrap.id = 'music-player';
    wrap.innerHTML =
      '<button class="mp-btn" id="mp-toggle" aria-label="Play the Just Send It theme" aria-pressed="false">▶</button>' +
      '<div class="mp-title"><span class="eq" aria-hidden="true"><span>▮</span><span>▮</span><span>▮</span></span> Just $Send It</div>' +
      '<input type="range" id="mp-vol" min="0" max="100" value="70" aria-label="Music volume">' +
      '<button class="mp-hint" id="mp-hint" hidden>🔊 Tap for the theme</button>';
    document.body.appendChild(wrap);

    const audio = new Audio('/assets/justsendit-audio.m4a');
    audio.loop = true;
    audio.preload = 'none';
    try { audio.volume = Number(localStorage.getItem('mp-vol') ?? 70) / 100; } catch { audio.volume = 0.7; }
    try { const t = Number(localStorage.getItem('mp-pos') || 0); if (t > 0) audio.currentTime = t; } catch {}

    const btn = wrap.querySelector('#mp-toggle');
    const vol = wrap.querySelector('#mp-vol');
    const hint = wrap.querySelector('#mp-hint');
    vol.value = Math.round(audio.volume * 100);

    const get = () => { try { return localStorage.getItem('mp-on'); } catch { return null; } };
    const set = (v) => { try { localStorage.setItem('mp-on', v); } catch {} };
    const optedOut = () => get() === '0';

    function setUI(playing) {
      wrap.classList.toggle('playing', playing);
      btn.textContent = playing ? '⏸' : '▶';
      btn.setAttribute('aria-pressed', String(playing));
      btn.setAttribute('aria-label', playing ? 'Pause the Just Send It theme' : 'Play the Just Send It theme');
    }
    function showHint() {
      if (optedOut()) return;
      hint.hidden = false; btn.classList.add('wants');
    }
    function hideHint() { hint.hidden = true; btn.classList.remove('wants'); }

    // only render "playing" once the browser actually starts audio
    async function tryPlay() {
      try { await audio.play(); setUI(true); set('1'); hideHint(); return true; }
      catch { return false; }
    }

    btn.addEventListener('click', async () => {
      if (audio.paused) { if (!(await tryPlay()) && window.sendToast) sendToast('Browser blocked audio — tap again 🎵'); }
      else { audio.pause(); setUI(false); set('0'); hideHint(); }
    });
    hint.addEventListener('click', () => tryPlay());
    vol.addEventListener('input', () => {
      audio.volume = vol.value / 100;
      try { localStorage.setItem('mp-vol', vol.value); } catch {}
    });
    // remember the playback position: a 5s heartbeat while actually playing and visible, plus the moments that matter
    const savePos = () => { try { localStorage.setItem('mp-pos', String(audio.currentTime)); } catch {} };
    setInterval(() => { if (!audio.paused && !document.hidden) savePos(); }, 5000);
    audio.addEventListener('pause', savePos);
    addEventListener('pagehide', savePos);
    document.addEventListener('visibilitychange', () => { if (document.hidden && !audio.paused) savePos(); });

    const state = get();
    const resumeAllowed = window.__musicResume !== false;

    if (state === '0' || !resumeAllowed) {
      // CASE C: opted out (or resume disabled in prefs) — silent, no hint, no arming
    } else if (state === '1') {
      // CASE A: returning listener — resume now, or on the very first interaction if blocked
      tryPlay().then(ok => { if (!ok) armGeneric(); });
    } else {
      // CASE B: brand-new visitor — arm to the deliberate entry-dismiss gesture + invite with a hint
      document.addEventListener('jsi:firstgesture', () => { tryPlay().then(ok => { if (!ok) showHint(); }); }, { once: true });
      setTimeout(() => { if (audio.paused && !optedOut()) showHint(); }, 400);
      setTimeout(() => { if (audio.paused) hideHint(); }, 8400); // auto-calm — never nag
    }

    // returning listener whose resume was blocked: retry on the first real interaction (they already opted in)
    function armGeneric() {
      const fire = () => { cleanup(); tryPlay(); };
      const targets = [[document, 'pointerdown'], [document, 'keydown'], [window, 'scroll'], [document, 'touchstart']];
      const cleanup = () => targets.forEach(([t, e]) => t.removeEventListener(e, fire, true));
      targets.forEach(([t, e]) => t.addEventListener(e, fire, { capture: true, once: true, passive: true }));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPlayer);
  else initPlayer();
})();
