/* ===== Sign in with Send: the few things the sign-in and consent pages do in the browser (lib/oidc.js renders them) =====
   No inline script (the CSP), and nothing here talks to anyone but this site. Without it the pages still work: Allow and
   Cancel are a plain form. What it adds:
     · the sign-in page: "Sign in" opens the site's own sign-in (auth.js — the same wallet, burn and email sign-in, with
       two-factor, as everywhere else), and the moment a session exists the page carries on to the same request, by its id —
       including when the member signed in in another tab and comes back to this one;
     · the consent page: "Tick all" (shown only when this script runs) and "Use another account" (signs out here, then opens
       the same request again, which asks for a sign-in). */
(function () {
  var root = document.getElementById('oa-root');
  if (!root) return;
  var id = root.getAttribute('data-pending') || '';
  var going = false;
  function carryOn() {
    if (going || !id) return;
    going = true;
    location.replace('/oauth/authorize?pending=' + encodeURIComponent(id));
  }

  var signin = document.getElementById('oa-signin');
  if (signin) {
    signin.addEventListener('click', function () { if (window.AUTH && typeof AUTH.open === 'function') AUTH.open(); });
    document.addEventListener('auth:change', function (e) { if (e && e.detail) carryOn(); });
    var asking = false;
    var recheck = function () {
      if (document.hidden || asking || going) return;
      asking = true;
      fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.user) carryOn(); }).catch(function () {}).then(function () { asking = false; });
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
  }

  var all = document.getElementById('oa-tickall');
  if (all) {
    all.hidden = false;
    all.addEventListener('click', function () {
      var boxes = root.querySelectorAll('.oa-scope input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
    });
  }

  var sw = document.getElementById('oa-switch');
  if (sw) {
    sw.addEventListener('click', function () {
      sw.disabled = true;
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(carryOn);
    });
  }
})();
