/* ===== Sign in with Send: the few things the sign-in and consent pages do in the browser (lib/oidc.js renders them) =====
   No inline script (the CSP), and nothing here talks to anyone but this site. Without it the pages still work: Allow and
   Cancel are a plain form. What it adds:
     · the sign-in page: "Sign in" opens the site's own sign-in (auth.js — the same wallet, burn and email sign-in, with
       two-factor, as everywhere else), and the moment a session exists the page carries on to the same request, by its id —
       including when the member signed in in another tab and comes back to this one;
     · the consent page: "Tick all" (shown only when this script runs) and "Use another account" (signs out here, then opens
       the same request again, which asks for a sign-in) — the second on the page without boxes too (a fresh proof, or which
       account, for an app the member has answered), whose button is Continue rather than Allow;
     · "Confirm it's you" on the consent page: "Sign with wallet" asks the wallet (the site's wallet.js) for the same free
       management signature every security change takes, and puts it in the form for Allow to send; "Sign in again" signs
       out here and opens the same request, whose sign-in is then the proof. The password and the code are plain fields. */
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

  var signOutAndBack = function (btn) {
    btn.disabled = true;
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(carryOn);
  };
  var sw = document.getElementById('oa-switch');
  if (sw) sw.addEventListener('click', function () { signOutAndBack(sw); });
  var again = document.getElementById('oa-again');
  if (again) again.addEventListener('click', function () { signOutAndBack(again); });

  var wb = document.getElementById('oa-wallet');
  if (wb) {
    var form = wb.closest('form'), status = document.getElementById('oa-wallet-status');
    var say = function (t) { if (status) status.textContent = t; };
    wb.addEventListener('click', function () {
      if (!window.WALLET || typeof WALLET.connect !== 'function') { say('The wallet part of this page did not load: reload it and try again.'); return; }
      wb.disabled = true; say('Choose the wallet.');
      var address = '';
      WALLET.connect({ choose: true }).then(function (w) {
        address = String(w.address || '').toLowerCase();
        return fetch('/api/auth/wallet/nonce?purpose=manage&address=' + encodeURIComponent(address), { credentials: 'same-origin' })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.message) throw new Error(j.error || 'the site could not make a message to sign'); return { w: w, message: j.message }; }); });
      }).then(function (x) {
        say('Approve the signature in your wallet.');
        return WALLET.sign(x.w.provider, address, x.message);
      }).then(function (signature) {
        form.querySelector('input[name="address"]').value = address;
        form.querySelector('input[name="signature"]').value = signature;
        wb.textContent = 'Signed by the wallet ending ' + address.slice(-4);
        var go = form.querySelector('button[name="decision"][value="allow"]');
        say('Signed. Press ' + (go ? go.textContent : 'Allow') + ' to let the app in.');
      }).catch(function (e) {
        wb.disabled = false;
        say(e && e.message === 'cancelled' ? '' : 'The wallet did not sign: ' + ((e && e.message) || 'try again') + '.');
      });
    });
  }
})();
