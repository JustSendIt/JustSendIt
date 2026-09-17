/* ===== voicememo.js — record a voice memo and post it to the Send Wall ============================
 *
 * One recorder, shared by every composer on the site: the 🎤 button in the site-wide composer, the one
 * on the Send Wall, and the one on somebody's profile. Written once because three copies of a thing
 * that asks for a microphone is three chances to leak a microphone.
 *
 * THE WHOLE INTERACTION IS TWO TAPS. Tap to start, tap to stop, and the memo is attached and ready to
 * send. Everything else — the timer, the level meter, the re-record — is there for the moment somebody
 * changes their mind, not as a step they have to complete.
 *
 * WHAT A BROWSER WILL ACTUALLY GIVE YOU
 * MediaRecorder's output format is the browser's choice, not ours: Chrome and Firefox produce Opus in a
 * WebM container, Safari and iOS produce AAC in an MP4. There is no common format to ask for, so we ask
 * what each one supports and take the first it admits to. Both are accepted by the server.
 *
 * THE MICROPHONE IS RELEASED THE MOMENT RECORDING STOPS
 * Every track is stopped explicitly, on every exit path — finished, cancelled, errored, or the page
 * being hidden. A live getUserMedia track keeps the browser's recording indicator lit, and a site that
 * leaves it lit after you have stopped talking has done something inexcusable regardless of intent.
 */
(function () {
  'use strict';

  var MAX_MS = 120000;          // two minutes. Long enough to say something, short enough to listen to.
  var WARN_AT = 15000;          // start counting down with this much left

  /* Ask the browser what it can encode rather than assuming. The order is preference: Opus is smaller
     and better at voice, MP4/AAC is what Apple gives us, OGG is a fallback nothing modern needs. */
  var CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < CANDIDATES.length; i++) {
      try { if (MediaRecorder.isTypeSupported(CANDIDATES[i])) return CANDIDATES[i]; } catch (e) {}
    }
    return '';
  }

  /* The container the SERVER is told about, which is not always the string the recorder was given:
     "audio/webm;codecs=opus" is a codec-qualified type, and the upload route matches on the bare one. */
  function baseMime(m) { return String(m || '').split(';')[0].trim().toLowerCase() || 'audio/webm'; }

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== 'undefined' && pickMime());
  }

  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* Why the microphone was refused, in words a person can act on. A bare "permission denied" leaves
     somebody tapping the same button forever; "your browser is blocking the microphone for this site"
     at least points at where the fix lives. */
  function reasonFor(err) {
    var n = (err && (err.name || err.message)) || '';
    if (/NotAllowed|Permission|denied/i.test(n)) return 'Your browser is blocking the microphone for this site — allow it in the address bar, then tap 🎤 again';
    if (/NotFound|Devices/i.test(n)) return 'No microphone found on this device 🎤';
    if (/NotReadable|Track|AbortError/i.test(n)) return 'Something else is using the microphone right now — close it and try again';
    if (/Secure|secure context/i.test(n)) return 'Recording needs a secure (https) connection';
    return 'Could not start recording — ' + (n || 'unknown reason');
  }

  /* ---------------------------------------------------------------------------------------------
     start(opts) -> a handle with stop() and cancel().
       opts.onTick(ms)      — every 200ms while recording, for a timer
       opts.onDone(blob, mime, ms) — the finished memo
       opts.onError(message) — already-human text, ready to show
     --------------------------------------------------------------------------------------------- */
  function start(opts) {
    opts = opts || {};
    var chunks = [], stream = null, rec = null, t0 = 0, tick = null, cap = null, done = false;

    function release() {
      if (tick) { clearInterval(tick); tick = null; }
      if (cap) { clearTimeout(cap); cap = null; }
      // the indicator goes out here, and nowhere else
      if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} stream = null; }
    }

    function fail(err) {
      if (done) return; done = true;
      release();
      if (typeof opts.onError === 'function') opts.onError(reasonFor(err));
    }

    var handle = {
      stop: function () { try { if (rec && rec.state === 'recording') rec.stop(); else release(); } catch (e) { release(); } },
      cancel: function () { done = true; try { if (rec && rec.state === 'recording') rec.stop(); } catch (e) {} release(); },
      get elapsed() { return t0 ? Date.now() - t0 : 0; },
    };

    navigator.mediaDevices.getUserMedia({
      /* Voice, not music: the browser's own cleanup is far better than anything we could do to the
         samples afterwards, and it is what makes a phone recording in a noisy room listenable. */
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(function (s) {
      if (done) { try { s.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} return; }  // cancelled while the prompt was up
      stream = s;
      var mime = pickMime();
      try { rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s); }
      catch (e) { try { rec = new MediaRecorder(s); } catch (e2) { return fail(e2); } }

      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { fail((e && e.error) || new Error('recorder failed')); };
      rec.onstop = function () {
        if (done) { release(); return; }
        done = true;
        var ms = t0 ? Date.now() - t0 : 0;
        release();
        var type = baseMime(rec && rec.mimeType) || baseMime(mime);
        var blob = new Blob(chunks, { type: type });
        /* A recording with no bytes is a recording that did not happen — usually a tap so quick the
           encoder never produced a frame. Saying so beats attaching silence. */
        if (!blob.size) { if (typeof opts.onError === 'function') opts.onError('That was too short to hear — hold on a moment longer 🎤'); return; }
        if (typeof opts.onDone === 'function') opts.onDone(blob, type, ms);
      };

      t0 = Date.now();
      rec.start();                                   // one blob at the end; no timeslice needed for a memo
      if (typeof opts.onTick === 'function') {
        opts.onTick(0);
        tick = setInterval(function () { opts.onTick(Date.now() - t0); }, 200);
      }
      // stops ITSELF at the cap rather than letting somebody record something nobody will listen to
      cap = setTimeout(function () { handle.stop(); }, MAX_MS);
    }).catch(fail);

    return handle;
  }

  /* ---------------------------------------------------------------------------------------------
     wire(opts) — turn one button into the whole feature.

     Every composer on the site calls this with its own button, preview box and status line, so the
     behaviour is identical in all three and the microphone handling exists once. The button is the
     entire interface: press to record, press to stop. It relabels itself and counts up so nobody has to
     wonder whether it is listening, and it announces the same thing to a screen reader, because "the
     button changed colour" is not a state a blind person can observe.
     --------------------------------------------------------------------------------------------- */
  function wire(opts) {
    var btn = opts && opts.btn; if (!btn) return;
    var live = opts.live || null;                 // an aria-live element to speak state into
    var say = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    var rec = null;

    /* A browser that cannot record should not offer to. Hiding it outright beats a button that
       apologises when pressed — and the photo/video attach beside it still works. */
    if (!supported()) { btn.hidden = true; return; }
    /* THE FEATURE SWITCH. The server decides whether voice memos exist at all (VOICE_MEMOS), and the
       answer arrives asynchronously — so the button starts HIDDEN and is only revealed once the config
       says the feature is on. Hidden-by-default is the safe order: a recorder that flashes into view and
       then disappears is worse than one that never appears, and the upload route refuses audio anyway. */
    btn.hidden = true;
    featureOn(function (on) { if (on) { btn.hidden = false; arm(); } });
    function arm() {

    var IDLE = '🎤 Voice memo';
    function announce(msg) { if (live) live.textContent = msg; }
    function toIdle() {
      rec = null;
      btn.classList.remove('is-recording');
      btn.textContent = IDLE;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('data-tip', 'Records a voice memo to post — press once to start, once to stop');
    }
    toIdle();

    btn.addEventListener('click', function () {
      if (rec) { rec.stop(); return; }            // second press = stop. The whole interaction.
      btn.classList.add('is-recording');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('data-tip', 'Stops recording and attaches the memo to your post');
      btn.textContent = '⏹ Stop · 0:00';
      announce('Recording started');
      rec = start({
        onTick: function (ms) {
          var left = MAX_MS - ms;
          btn.textContent = left <= WARN_AT
            ? '⏹ Stop · ' + fmt(left) + ' left'
            : '⏹ Stop · ' + fmt(ms);
          // spoken once, near the end, rather than every tick — a countdown read aloud 300 times is noise
          if (left <= WARN_AT && left > WARN_AT - 250) announce('Fifteen seconds left');
        },
        // say('') first: at every call site onStatus writes to the SAME node as `live`, so clearing it
        // after announce() left the live region empty by the time a screen reader looked at it
        onError: function (msg) { toIdle(); say(''); announce(msg); if (window.sendToast) sendToast('⚠️ ' + msg); },
        onDone: function (blob, mime, ms) {
          toIdle();
          announce('Recording stopped, ' + fmt(ms) + '. Attaching.');
          /* Straight into the SAME pipeline a photo goes through — prepMedia validates it, the preview
             box gets a player to listen back on, and uploadMedia streams it. A voice memo is not a
             special kind of attachment, it is an attachment. */
          Promise.resolve(window.attachMedia(blob, opts.previewEl, opts.onClear, say)).then(function (r) {
            if (r && r.url) { announce('Voice memo attached — ' + fmt(ms) + '. Ready to send.'); if (typeof opts.onAttached === 'function') opts.onAttached(r.url); }
            else announce('That memo could not be attached');
          });
        },
      });
    });

    /* Leaving the page mid-recording must not leave the microphone open. */
    document.addEventListener('visibilitychange', function () { if (document.hidden && rec) { rec.stop(); } });
    window.addEventListener('pagehide', function () { if (rec) rec.cancel(); });
    }
  }

  /* One config read for the page, however many composers ask. A config we cannot read is treated as OFF:
     the recorder stays hidden rather than offering something the server would refuse. */
  var _feat = null, _featWaiting = [];
  function featureOn(cb) {
    if (_feat !== null) { cb(_feat); return; }
    _featWaiting.push(cb);
    if (_featWaiting.length > 1) return;
    fetch('/api/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _feat = !!(j && j.features && j.features.voiceMemos); })
      .catch(function () { _feat = false; })
      .then(function () { var q = _featWaiting; _featWaiting = []; q.forEach(function (f) { try { f(_feat); } catch (e) {} }); });
  }

  /* THE BACKSTOP. wire() hides its own button, but a composer whose script ran before this one never
     called wire() at all — so the switch cannot depend on it. Every .voice-btn on the page is hidden as
     soon as the config answers, whoever wired it and whoever did not. */
  featureOn(function (on) {
    if (on) return;
    var hideAll = function () {
      var els = document.querySelectorAll('.voice-btn');
      for (var i = 0; i < els.length; i++) els[i].hidden = true;
    };
    hideAll();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideAll);
  });

  window.VoiceMemo = { start: start, wire: wire, featureOn: featureOn, supported: supported, MAX_MS: MAX_MS, WARN_AT: WARN_AT, fmt: fmt, pickMime: pickMime, baseMime: baseMime };
})();
