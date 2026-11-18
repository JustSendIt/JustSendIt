/* ===== $Send music player =====
 * Honest autoplay handling (browsers block sound before a gesture):
 *  - returning listener (mp-on=1): resume on load, else on first interaction — no hint
 *  - brand-new visitor (mp-on=null): arm to the entry-dismiss gesture (jsi:firstgesture) and
 *    show a one-tap unmute hint; never render "playing" until an audio.play() promise resolves
 *  - opted-out (mp-on=0): stay silent forever, never nag
 * The intro/entry animation now lives in entry.js (homepage only).
 * The songs (owner, 2026-11-17: "SEND IT 🚀" by @WisdomPrime123 beside the theme): /api/config lists the ones on this server
 * (media.tracks, server.js PLAYLIST). With no song picked every song plays in order and the list starts again; ♫ lists them, and a
 * song picked there plays on repeat. A song's maker is named under it and in the list, linked to their page. */
(function () {
  /* X04/F120: the song files ship outside git and may be absent on a deploy. /api/config lists the ones that are here
     (media.tracks); when none is, no player is drawn at all — a play button that plays nothing is worse than none. An
     older answer without the list says only whether the theme is here (media.audio). */
  const THEME = { id: 'theme', src: '/assets/justsendit-audio.m4a', title: 'Just $Send It', note: 'the site’s theme', by: null };
  const okTrack = (t) => !!t && typeof t.id === 'string' && typeof t.title === 'string' && /^\/assets\/[\w.-]+\.m4a$/.test(String(t.src || ''));
  const okBy = (b) => (b && typeof b.name === 'string' && /^https:\/\/x\.com\/\w{1,15}$/.test(String(b.url || '')) ? { name: b.name, url: b.url } : null);
  async function songsHere() {
    try {
      const r = await fetch('/api/config', { credentials: 'same-origin' }); const j = await r.json(), m = j && j.media;
      if (m && Array.isArray(m.tracks)) return m.tracks.filter(okTrack).map((t) => ({ id: t.id, src: t.src, title: t.title, note: typeof t.note === 'string' ? t.note : '', by: okBy(t.by) }));
      return m && m.audio === false ? [] : [THEME];
    } catch { return [THEME]; }   // the config being unreachable is not evidence about the files: the theme is tried, and its error takes the player away
  }
  const escH = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function initPlayer(tracks) {
    const wrap = document.createElement('div');
    wrap.id = 'music-player';
    // ♫ when there is a choice, or a maker to credit: on a phone the title is folded away, and the list is where a song's maker is named
    const listed = (ts) => ts.length > 1 || ts.some((t) => t.by), many = listed(tracks);
    wrap.innerHTML =
      '<button class="mp-btn" id="mp-toggle" data-tip="Plays the music, or pauses it and keeps it off" aria-label="Play the music" aria-pressed="false"><span class="mp-ico" aria-hidden="true"></span></button>' +
      // ♫ sits right beside ▶: the player unfolds (title, volume) as a pointer reaches it, and a ♫ at the far end moved out from under it
      (many ? '<button class="mp-btn mp-songs" id="mp-songs" type="button" aria-expanded="false" aria-controls="mp-menu" aria-label="Songs" data-tip="Lists the songs: play them all in order, or pick one to play on repeat"><span aria-hidden="true">♫</span></button>' +
        '<div class="mp-menu" id="mp-menu" role="group" aria-labelledby="mp-menu-h" hidden><p class="mp-menu-h" id="mp-menu-h">Songs</p><div class="mp-opts"></div></div>' : '') +
      '<div class="mp-title"><span class="eq" aria-hidden="true"><span></span><span></span><span></span></span><span class="mp-now"><span class="mp-name"></span><a class="mp-by" id="mp-by" target="_blank" rel="noopener noreferrer" hidden></a></span></div>' +   // the bars are drawn (styles.css), not typed
      '<input type="range" id="mp-vol" min="0" max="100" value="70" aria-label="Music volume">' +
      '<button class="mp-hint" id="mp-hint" data-tip="Turns the music on and hides this nudge" hidden>🔊 Tap for the music</button>';
    // right after the skip link (before it, on a page without one): the pause control is the second tab stop,
    // not the last one behind the whole document while the theme is already playing (WCAG 1.4.2 guidance)
    const skip = document.querySelector('.skip-link');
    if (skip && skip.parentNode === document.body) skip.after(wrap); else document.body.prepend(wrap);

    const keep = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const keepSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
    /* which song: 'all' (the default — every song in order, then round again) or one song's id (that song on repeat). The
       song playing and where in it are kept per browser (mp-track, mp-pos), as the theme's place always was. */
    const idx = (id) => tracks.findIndex((t) => t.id === id);
    let pick = keep('mp-pick') || 'all';
    if (pick !== 'all' && idx(pick) < 0) pick = 'all';
    let cur = pick !== 'all' ? idx(pick) : Math.max(0, idx(keep('mp-track') || 'theme'));

    const audio = new Audio();
    audio.preload = 'none';
    let want = false;   // the music was asked for (a press, a resume): a song that will not load then hands on to the next one, playing
    try { audio.volume = Number(localStorage.getItem('mp-vol') ?? 70) / 100; } catch { audio.volume = 0.7; }

    const btn = wrap.querySelector('#mp-toggle');
    const vol = wrap.querySelector('#mp-vol');
    const hint = wrap.querySelector('#mp-hint');
    const nameEl = wrap.querySelector('.mp-name'), byEl = wrap.querySelector('#mp-by');
    const songsBtn = wrap.querySelector('#mp-songs'), menu = wrap.querySelector('#mp-menu');
    vol.value = Math.round(audio.volume * 100);

    function paintNow() {
      const t = tracks[cur];
      nameEl.textContent = t.title;
      if (t.by) { byEl.textContent = 'by ' + t.by.name; byEl.href = t.by.url; byEl.setAttribute('data-tip', 'Opens ' + t.by.name + '’s page on X in a new tab'); byEl.hidden = false; }
      else { byEl.hidden = true; byEl.removeAttribute('href'); }
      setUI(!audio.paused);   // which also draws the open list again
    }
    // a song by its place in the list; t: where in it to start (the place kept from the last visit)
    function load(i, t) {
      cur = i;
      audio.src = tracks[i].src;
      audio.loop = pick !== 'all' || tracks.length === 1;
      // always set, 0 too: with nothing loaded the browser keeps a seek as the start of whatever loads next (the last song's place)
      try { audio.currentTime = t > 0 ? t : 0; } catch {}
      keepSet('mp-track', tracks[i].id); keepSet('mp-pos', String(t > 0 ? t : 0));   // the place kept is always this song's
      paintNow();
    }
    // a song that 404s or will not decode leaves the list; with none left the control goes, said once, rather than spin forever
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      const was = want || btn.classList.contains('is-playing'), gone = tracks[cur];
      tracks = tracks.filter((t) => t !== gone);
      if (!tracks.length) { wrap.remove(); if (window.sendToast) sendToast('The music is not available right now.'); return; }
      if (pick === gone.id) pick = 'all';   // for this page only: the choice kept stays the visitor's (the file may load next time)
      if (menu && !listed(tracks)) { openMenu(false, false); songsBtn.remove(); menu.remove(); }
      load(Math.min(cur, tracks.length - 1), 0);
      if (was && !wallSongOn() && !(window.AGE && AGE.isOpen)) { setUI(true); audio.play().then(() => { setUI(true); set('1'); }).catch(() => setUI(false)); }
    });
    // every song in order: the next one starts when one ends, and the last hands back to the first
    audio.addEventListener('ended', () => {
      if (audio.loop) return;
      load((cur + 1) % tracks.length, 0);
      setUI(true);   // ⏸ while the next song loads: a press then is a pause, as it looks
      audio.play().then(() => setUI(true)).catch(() => setUI(false));
    });
    // the place kept belongs to the song mp-track names (a visit from before the list kept the theme's place, with no name)
    load(cur, (keep('mp-track') || 'theme') === tracks[cur].id ? Number(keep('mp-pos') || 0) : 0);

    const get = () => { try { return localStorage.getItem('mp-on'); } catch { return null; } };
    const set = (v) => { try { localStorage.setItem('mp-on', v); } catch {} };
    const optedOut = () => get() === '0';

    function setUI(playing) {
      wrap.classList.toggle('playing', playing);
      btn.classList.toggle('is-playing', playing);   // the ▶ / ⏸ is drawn by CSS (.mp-ico), centred in the circle on every device
      btn.setAttribute('aria-pressed', String(playing));
      const t = tracks[cur], what = t ? t.title + (t.by ? ' by ' + t.by.name : '') : 'the music';
      btn.setAttribute('aria-label', playing ? 'Pause the music: ' + what : 'Play the music: ' + what);
      if (menu && !menu.hidden) paintMenu();   // its "· playing" mark follows
    }

    /* ♫ — the list of songs: "Play all" (the default) and each song, the one playing marked; a song's maker is a link of its own
       beside it (a link cannot sit inside a button). Picking plays: a press there is the visitor choosing music. */
    function paintMenu() {
      const box = menu.querySelector('.mp-opts'), had = menu.contains(document.activeElement) ? document.activeElement : null;
      const back = had ? (had.dataset.mpPick ? '[data-mp-pick="' + had.dataset.mpPick + '"]' : had.classList.contains('mp-by') ? '.mp-row:nth-child(' + (Array.prototype.indexOf.call(box.children, had.closest('.mp-row')) + 1) + ') .mp-by' : null) : null;
      const opt = (id, label, tip) => '<button class="np-chip mp-opt" type="button" data-mp-pick="' + escH(id) + '" aria-pressed="' + String(pick === id) + '" data-tip="' + escH(tip) + '">' + label + '</button>';
      const playing = btn.classList.contains('is-playing');
      box.innerHTML = (tracks.length > 1 ? opt('all', '🔁 Play all, in order', 'Plays every song in order, then starts again from the first') : '') +
        tracks.map((t, i) => '<div class="mp-row">' + opt(t.id, escH(t.title) + (t.note ? ' <small>' + escH(t.note) + '</small>' : '') + (i === cur && playing ? ' <small class="mp-on">· playing</small>' : ''), tracks.length > 1 ? 'Plays only ' + t.title + ', on repeat' : 'Plays ' + t.title + ', on repeat') +
          (t.by ? '<a class="mp-by" href="' + escH(t.by.url) + '" target="_blank" rel="noopener noreferrer" data-tip="Opens ' + escH(t.by.name) + '’s page on X in a new tab">by ' + escH(t.by.name) + '</a>' : '') + '</div>').join('');
      const again = back && box.querySelector(back); if (again) again.focus({ preventScroll: true });
    }
    /* keys: opened from the keyboard, the chosen song takes the focus; opened with a pointer the focus stays on ♫ — a focus moved
       into the list brings up that song's description (tips.js), which sat over the songs above it and caught the next press */
    function openMenu(open, focusBack, keys) {
      if (!menu) return;
      menu.hidden = !open; songsBtn.setAttribute('aria-expanded', String(open));
      if (open) { hideHint(); paintMenu(); const on = menu.querySelector('[aria-pressed="true"]'); if (on && keys) on.focus(); }
      else if (focusBack) songsBtn.focus();
    }
    async function pickSong(id, keys) {
      pick = id; keepSet('mp-pick', id);
      if (id !== 'all' && idx(id) !== cur) load(idx(id), 0);
      audio.loop = pick !== 'all' || tracks.length === 1;
      if (audio.paused) await playChosen(); else paintNow();
      openMenu(false, keys || (menu.contains(document.activeElement)));
    }
    if (menu) {
      songsBtn.addEventListener('click', (e) => openMenu(menu.hidden, false, e.detail === 0));   // detail 0: Enter or Space, not a press
      menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mp-pick]'); if (b) pickSong(b.dataset.mpPick, e.detail === 0); });
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); openMenu(false, true); } });
      // a press elsewhere closes it — not one on a description bubble (tips.js puts it over the songs; its own click puts it away)
      document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !wrap.contains(e.target) && !(e.target.closest && e.target.closest('#tip-bubble'))) openMenu(false, false); });
      // and so does the keyboard leaving the player (Tab past the songs): an open list is never left over the page with no way to close it
      wrap.addEventListener('focusout', (e) => { if (!menu.hidden && e.relatedTarget && !wrap.contains(e.relatedTarget) && e.relatedTarget.id !== 'tip-bubble') openMenu(false, false); });
    }
    /* The nudge shows itself once and then leaves. It is a fixed bubble over page content, so a nudge
       that never goes away is a nudge that permanently covers a link somebody wanted. */
    var hintTimer = null;
    /* A personal wall's song is the sound on that page, whether or not it has managed to start. The theme
       must not begin over it: the player often finishes loading after the wall has already asked, and a
       later tap (the age answer, a returning listener's first click) would start both. */
    function wallSongOn() {
      const box = document.getElementById('wall-song');
      const song = document.getElementById('wall-song-audio');
      return !!(song && song.getAttribute('src') && box && !box.hidden);
    }
    function showHint() {
      if (optedOut() || wallSongOn()) return;
      hint.hidden = false; btn.classList.add('wants');
      clearTimeout(hintTimer);
      hintTimer = setTimeout(hideHint, 12000);   // said once, then out of the way
    }
    function hideHint() { clearTimeout(hintTimer); hint.hidden = true; btn.classList.remove('wants'); }

    // only render "playing" once the browser actually starts audio
    async function tryPlay() {
      if (wallSongOn()) { if (!audio.paused) { audio.pause(); setUI(false); } hideHint(); return false; }
      want = true;
      try {
        await audio.play();
        /* The wall song can arrive while this play() is still settling. Stop, and do not remember this
           page as the listener having started the theme. */
        if (wallSongOn()) { audio.pause(); setUI(false); hideHint(); return false; }
        setUI(true); set('1'); hideHint(); return true;
      } catch { return false; }
    }

    /* A press on ▶ (or on the nudge) is the visitor choosing the theme — on a wall with a song too: the song pauses and the
       theme plays. Only the starts nobody pressed for (a returning listener's resume, the first-gesture arming) give way to a
       wall song (tryPlay). The song starting again quiets the theme (jsi:wall-song, below). */
    async function playChosen() {
      const song = document.getElementById('wall-song-audio');
      if (song && !song.paused) song.pause();
      want = true;
      try { await audio.play(); setUI(true); set('1'); hideHint(); return true; }
      catch (e) { return e && e.name === 'NotSupportedError' ? null : false; }   // null: the file would not load — the next song is already on its way (above)
    }
    btn.addEventListener('click', async () => {
      if (audio.paused || !btn.classList.contains('is-playing')) { if ((await playChosen()) === false && window.sendToast) sendToast('Browser blocked audio — tap again 🎵'); }
      else { want = false; audio.pause(); setUI(false); set('0'); hideHint(); }
    });
    hint.addEventListener('click', () => playChosen());
    vol.addEventListener('input', () => {
      audio.volume = vol.value / 100;
      try { localStorage.setItem('mp-vol', vol.value); } catch {}
    });
    // remember the playback position (in the song mp-track names): a 5s heartbeat while actually playing and visible, plus the moments that matter
    const savePos = () => { try { localStorage.setItem('mp-pos', String(audio.currentTime)); localStorage.setItem('mp-track', tracks[cur].id); } catch {} };
    setInterval(() => { if (!audio.paused && !document.hidden) savePos(); }, 5000);
    audio.addEventListener('pause', savePos);
    addEventListener('pagehide', savePos);
    document.addEventListener('visibilitychange', () => { if (document.hidden && !audio.paused) savePos(); });

    const state = get();
    const resumeAllowed = window.__musicResume !== false;
    /* Nothing plays while the 18+ question is up: the player is inert under it, so a track started there would
       have no reachable pause (WCAG 1.4.2). Arming waits for the answer, and a question asked again pauses. */
    const AGE = window.AGE;
    const afterAge = (fn) => { if (AGE && AGE.needed) AGE.whenOk(fn); else fn(); };
    document.addEventListener('jsi:age-open', () => { if (!audio.paused) audio.pause(); });
    document.addEventListener('jsi:age-open', () => { want = false; setUI(false); });
    /* Pause the theme when the wall song claims the page. Do not mark the theme opted out, so the next
       page without a wall song can resume it. tryPlay also refuses while a song is up, including when
       this event was dispatched before the player had finished loading. */
    document.addEventListener('jsi:wall-song', () => { if (!audio.paused) { audio.pause(); setUI(false); } hideHint(); });
    document.addEventListener('jsi:wall-song', () => { want = false; });

    if (state === '0' || !resumeAllowed) {
      // CASE C: opted out (or resume disabled in prefs) — silent, no hint, no arming
    } else if (state === '1') {
      // CASE A: returning listener — resume now, or on the very first interaction if blocked
      afterAge(() => tryPlay().then(ok => { if (!ok) armGeneric(); }));
    } else {
      // CASE B: brand-new visitor — arm to the deliberate entry-dismiss gesture + invite with a hint
      document.addEventListener('jsi:firstgesture', () => { tryPlay().then(ok => { if (!ok) showHint(); }); }, { once: true });
      afterAge(() => {
        setTimeout(() => { if (audio.paused && !optedOut()) showHint(); }, 400);
        setTimeout(() => { if (audio.paused) hideHint(); }, 8400); // auto-calm — never nag
      });
    }

    // returning listener whose resume was blocked: retry on the first real interaction (they already opted in)
    function armGeneric() {
      const fire = () => { cleanup(); tryPlay(); };
      const targets = [[document, 'pointerdown'], [document, 'keydown'], [window, 'scroll'], [document, 'touchstart']];
      const cleanup = () => targets.forEach(([t, e]) => t.removeEventListener(e, fire, true));
      targets.forEach(([t, e]) => t.addEventListener(e, fire, { capture: true, once: true, passive: true }));
    }
  }

  const boot = () => { songsHere().then((tracks) => { if (tracks.length) initPlayer(tracks); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
