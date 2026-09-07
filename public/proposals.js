/* ===== proposals.js — community proposals and two-round voting =====
 *
 * THE COUNTING RULE, restated here because the UI must never imply anything else:
 *   decisive = yes + no. Abstains are excluded from the threshold and counted toward quorum.
 *   Round 1 promotes at >=50% of decisive votes. Round 2 passes at >=75%.
 *
 * INVARIANT — do not break this: the three ballot buttons ARM a choice, they never cast it.
 * app.js's shared radiogroup handler both focuses AND clicks as you arrow across a group, so if a
 * choice ever cast directly, arrow-key navigation would silently cast votes. Casting is a separate,
 * two-press confirm on its own button.
 *
 * CSP-safe: addEventListener only, no inline JS. esc() before every innerHTML. */
(function () {
  'use strict';
  const list = document.getElementById('comm-props-list');
  if (!list) return;

  const sec = document.getElementById('comm-props');
  const empty = document.getElementById('prop-empty');
  const newBtn = document.getElementById('prop-new');
  const form = document.getElementById('prop-form');
  const titleEl = document.getElementById('prop-title');
  const bodyEl = document.getElementById('prop-body');
  const statusEl = document.getElementById('prop-status');
  const countEl = document.getElementById('prop-count');

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (t) => { if (window.announce) window.announce(t); };
  let CID = null, cache = [];

  function cid() {
    if (CID) return CID;
    const q = new URLSearchParams(location.search).get('id');
    CID = q && /^\d+$/.test(q) ? q : null;
    return CID;
  }

  /* ---------- time ---------- */
  function left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }

  const STATE = {
    draft:    { cls: 'prop-pill-draft',    txt: '📝 Draft' },
    open:     { cls: 'prop-pill-open',     txt: '🗳️ Round 1' },
    round2:   { cls: 'prop-pill-open',     txt: '🗳️ Round 2' },
    passed:   { cls: 'prop-pill-passed',   txt: '✅ Passed' },
    rejected: { cls: 'prop-pill-rejected', txt: '❌ Rejected' },
    expired:  { cls: 'prop-pill-expired',  txt: '⌛ Expired' },
  };
  // Plain-English endings. The reason codes are internal; a reader should never see one.
  const WHY = {
    draft_never_opened: 'The author never opened it for voting.',
    r1_no_quorum: 'Not enough members voted in round 1.',
    r2_no_quorum: 'Not enough members voted in round 2.',
    r1_no_decisive: 'Everybody abstained, so there was nothing to decide.',
    r2_no_decisive: 'Everybody abstained, so there was nothing to decide.',
    r1_below_50: 'Fewer than half of the yes-and-no votes were in favour.',
    r2_below_75: 'It needed 75% in round 2 and did not reach it.',
    passed: 'It cleared 50% in round 1 and 75% in round 2.',
  };

  function resultBar(t, needPct, label) {
    const dec = t.yes + t.no;
    const pct = dec ? Math.round(t.yes / dec * 100) : 0;
    return '<div class="prop-result">' +
      '<div class="prop-result-h"><span>' + esc(label) + '</span><b>' + pct + '% in favour</b></div>' +
      '<div class="prop-bar-wrap">' +
        '<div class="prop-bar" role="img" aria-label="' + pct + ' percent in favour. ' +
          t.yes + ' yes, ' + t.no + ' no, ' + t.abstain + ' abstained.">' +
          '<span class="prop-seg-yes" style="transform:scaleX(' + (pct / 100) + ')"></span>' +
        '</div>' +
        '<i class="prop-threshold" style="left:' + needPct + '%" aria-hidden="true"><b>' + needPct + '%</b></i>' +
      '</div>' +
      '<p class="prop-counts"><span class="prop-c-yes">👍 ' + t.yes + ' yes</span> · ' +
        '<span class="prop-c-no">👎 ' + t.no + ' no</span> · ' +
        '<span class="prop-c-abs">🤷 ' + t.abstain + ' abstained (not counted in the ' + needPct + '%)</span></p>' +
    '</div>';
  }

  function ballotHTML(p) {
    if (!p.canVote) {
      return '<p class="prop-gate comm-gate-msg" role="status" aria-live="polite">' + esc(p.gate || '') + '</p>';
    }
    const id = 'prop-t-' + p.id;
    return '<div class="prop-vote" data-pid="' + p.id + '">' +
      '<div class="prop-ballot" role="radiogroup" aria-labelledby="' + id + '">' +
        '<button class="sort-btn prop-choice" type="button" role="radio" aria-checked="false" tabindex="0"  data-choice="yes">👍 Yes</button>' +
        '<button class="sort-btn prop-choice" type="button" role="radio" aria-checked="false" tabindex="-1" data-choice="no">👎 No</button>' +
        '<button class="sort-btn prop-choice" type="button" role="radio" aria-checked="false" tabindex="-1" data-choice="abstain">🤷 Abstain</button>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm prop-cast" type="button" disabled>Cast my vote</button>' +
      '<p class="prop-gate comm-gate-msg" role="status" aria-live="polite" hidden></p>' +
    '</div>';
  }

  function rowHTML(p) {
    const st = STATE[p.status] || STATE.draft;
    const live = p.status === 'open' || p.status === 'round2';
    const need = p.status === 'round2' ? 75 : 50;
    let inner = '';

    if (live) {
      const q = p.quorumNow || 0, b = p.ballots || 0;
      const qpct = q ? Math.min(100, Math.round(b / q * 100)) : 100;
      inner += '<div class="prop-quorum">' +
        '<div class="gxp prop-gxp" role="progressbar" aria-valuemin="0" aria-valuemax="' + q + '" aria-valuenow="' + Math.min(b, q) + '"' +
          ' aria-valuetext="' + b + ' of ' + q + ' ballots needed' + (b >= q ? ', quorum met' : ', quorum not yet met') + '">' +
          '<span class="gxp-fill" style="width:' + qpct + '%"></span></div>' +
        '<p class="prop-quorum-t">' + b + ' of ' + q + ' ballots needed' + (b >= q ? ' — quorum met ✅' : '') +
          (p.endsAt ? ' · closes in ' + left(p.endsAt - Date.now()) : '') + '</p>' +
        // Saying this out loud avoids the obvious "why can't I see the score" support question.
        '<p class="prop-sealed">The running split stays hidden until the round closes, so late voters cannot play the count.</p>' +
      '</div>';
      inner += ballotHTML(p);
      if (p.myVote) inner += '<p class="prop-mine">Your vote: <b>' + esc(p.myVote) + '</b>. Votes are final.</p>';
    }
    if (p.r1) inner += resultBar(p.r1, 50, 'Round 1');
    if (p.r2) inner += resultBar(p.r2, 75, 'Round 2');
    if (p.reason && WHY[p.reason]) inner += '<p class="prop-why">' + esc(WHY[p.reason]) + '</p>';
    if (p.status === 'draft' && p.isMine) {
      inner += '<div class="prop-draft-actions">' +
        '<button class="btn btn-primary btn-sm prop-open" type="button" data-pid="' + p.id + '">Open for voting</button>' +
        '<button class="btn btn-ghost btn-sm prop-del" type="button" data-pid="' + p.id + '">Delete</button>' +
        '<p class="prop-note">Opening freezes who may vote, so it cannot be undone.</p></div>';
    }

    return '<li class="prop-item" data-pid="' + p.id + '">' +
      '<div class="prop-head">' +
        '<span class="comm-pill ' + st.cls + '">' + st.txt + '</span>' +
        '<h3 class="prop-title" id="prop-t-' + p.id + '">' + esc(p.title) + '</h3>' +
      '</div>' +
      (p.body ? '<p class="prop-body">' + esc(p.body) + '</p>' : '') +
      '<p class="prop-by">by @' + esc(p.author ? p.author.username : '—') +
        (p.electorate ? ' · ' + p.electorate + ' verified holders on the roll' : '') + '</p>' +
      inner +
    '</li>';
  }

  function render() {
    if (!cache.length) { list.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    list.innerHTML = cache.map(rowHTML).join('');
    if (window.decorateTokenCommunities) decorateTokenCommunities(list);
  }

  async function load() {
    if (!cid()) return;
    try {
      const j = await window.api('/api/communities/' + cid() + '/proposals');
      cache = j.proposals || [];
      sec.hidden = false;
      render();
      const me = window.AUTH && AUTH.user;
      // Only a verified holder can start one, so only they are offered the button.
      newBtn.hidden = !(me && cache.every(p => !(p.isMine && p.status === 'draft')));
    } catch { sec.hidden = true; }
  }

  /* ---------- compose ---------- */
  newBtn.addEventListener('click', () => { form.hidden = false; newBtn.hidden = true; titleEl.focus(); });
  document.getElementById('prop-cancel').addEventListener('click', () => { form.hidden = true; newBtn.hidden = false; statusEl.textContent = ''; newBtn.focus(); });
  bodyEl.addEventListener('input', () => { countEl.textContent = String(2000 - bodyEl.value.length); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Saving…';
    try {
      await window.api('/api/communities/' + cid() + '/proposals', { method: 'POST', body: { title: titleEl.value, body: bodyEl.value } });
      titleEl.value = ''; bodyEl.value = ''; form.hidden = true;
      statusEl.textContent = 'Draft saved. Open it when you are ready — that starts the clock.';
      say('Proposal draft saved.');
      load();
    } catch (err) {
      statusEl.textContent = '⚠️ ' + (err.message || 'Could not save');
      say('Proposal not saved. ' + (err.message || ''));
    }
  });

  /* ---------- ballot ---------- */
  list.addEventListener('click', async (e) => {
    const choice = e.target.closest('.prop-choice');
    if (choice) {
      // ARM ONLY — never cast here. See the invariant at the top of this file.
      const group = choice.closest('.prop-ballot');
      group.querySelectorAll('.prop-choice').forEach(b => {
        const on = b === choice;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.classList.toggle('is-on', on);
      });
      const cast = choice.closest('.prop-vote').querySelector('.prop-cast');
      cast.disabled = false;
      cast.dataset.choice = choice.dataset.choice;
      cast.textContent = 'Cast my vote';
      cast._armed = false;
      return;
    }

    const cast = e.target.closest('.prop-cast');
    if (cast) {
      const wrap = cast.closest('.prop-vote'), pid = wrap.dataset.pid, pick = cast.dataset.choice;
      if (!pick) return;
      if (!cast._armed) {
        // A vote is final and cannot be changed, so it takes a deliberate second press. 6s, not 4s:
        // a screen-reader or switch user needs time to hear the changed label before re-activating.
        cast._armed = true;
        cast.textContent = '⚠️ Tap again — votes are final';
        cast.setAttribute('aria-label', 'Confirm your ' + pick + ' vote. Votes are final and cannot be changed.');
        say('Press again to confirm your ' + pick + ' vote. This cannot be undone.');
        clearTimeout(cast._t);
        cast._t = setTimeout(() => { cast._armed = false; cast.textContent = 'Cast my vote'; cast.removeAttribute('aria-label'); }, 6000);
        return;
      }
      clearTimeout(cast._t);
      cast.disabled = true; cast.textContent = 'Recording…';
      try {
        await window.api('/api/communities/' + cid() + '/proposals/' + pid + '/vote', { method: 'POST', body: { choice: pick } });
        say('Your ' + pick + ' vote is recorded.');
        if (window.sendToast) sendToast('🗳️ Vote recorded — ' + pick);
        load();
      } catch (err) {
        // Both surfaces, deliberately: the toast zone is a live region but the in-place message is
        // what a screen-reader user is actually focused near, and a silent failure is unacceptable.
        const gate = wrap.querySelector('.prop-gate');
        if (gate) { gate.hidden = false; gate.textContent = '⚠️ ' + (err.message || 'Vote not recorded'); }
        say('Vote not recorded. ' + (err.message || ''));
        cast.disabled = false; cast.textContent = 'Cast my vote'; cast._armed = false;
      }
      return;
    }

    const open = e.target.closest('.prop-open');
    if (open) {
      open.disabled = true;
      try { await window.api('/api/communities/' + cid() + '/proposals/' + open.dataset.pid + '/open', { method: 'POST' });
            say('Voting is open.'); if (window.sendToast) sendToast('🗳️ Voting is open'); load(); }
      catch (err) { open.disabled = false; say('Could not open. ' + (err.message || '')); if (window.sendToast) sendToast('⚠️ ' + err.message); }
      return;
    }
    const del = e.target.closest('.prop-del');
    if (del) {
      if (!del._armed) { del._armed = true; del.textContent = 'Tap again to delete'; setTimeout(() => { del._armed = false; del.textContent = 'Delete'; }, 5000); return; }
      try { await window.api('/api/communities/' + cid() + '/proposals/' + del.dataset.pid, { method: 'DELETE' }); load(); } catch {}
    }
  });

  document.addEventListener('auth:change', load);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  window.reloadProposals = load;
})();
