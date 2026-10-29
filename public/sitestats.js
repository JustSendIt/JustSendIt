/* ===== sitestats.js — the site's numbers, over time =====
 * Owner, 2026-10-29: "When users click on this section pull up a popup that shows a graph over time of all three of these
 * stats in a simple to understand graphic that quickly shows the data to the users."
 *
 * nav.js fetches this file on the first press of the "● 3 Sending it · ✓ 6 verified · 2.8K views" pill (or of 📊 Site numbers
 * in the pop-down menu, where the bar has no room for the pill) and calls SiteStats.open({ opener }). It opens in FullView
 * (app.js) as a centred sheet: a labelled modal dialog that takes focus, keeps Tab inside, and closes on ✕, Esc, the dimmed
 * edge and Back, with focus back on what opened it. It is filled from GET /api/site-stats (siteStats in server.js): three
 * cards, in the pill's order, each with its title, the number now, one sentence saying what it counts, a chart drawn here as
 * SVG (no library), and every day's number in a table — for exact reading, and for a screen reader.
 *
 * Honest by construction: every figure is the server's, read from the site's own records. A day before counting began is not
 * drawn at all (each chart starts on its first counted day, and the card says when that was); a day with no record is marked
 * as one, never as 0; today's bar says it is today so far; the verified line says what it is — today's verified members, each
 * on the day their wallet last passed the check — and never that it is the count on past days.
 * CSP-safe: no inline script, no on…= attribute; every style lives in styles.css (.ss-…). */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var known = function (n) { return typeof n === 'number' && isFinite(n) && n >= 0; };
  var whole = function (n) { return known(n) ? n.toLocaleString('en-US') : '—'; };
  // 'YYYY-MM-DD' (a UTC day, which is what the server counts in) → '28 Oct', or '13 Oct 2026' with the year
  function day(d, year) {
    try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', year ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
    catch (e) { return d; }
  }
  var word = function (n, one, many) { return n === 1 ? one : many; };

  /* One chart. A column a day, the SVG's viewBox stretched to the card's width (10 units a day, 100 high), the top of the scale
     at the highest value — labelled on the y side, 0 at the faint baseline — and the first and last days under it, all from
     that one scale. The labels are HTML beside the SVG, so they keep the text floor at any width. kind 'bars': a bar a day;
     'steps': the running total as a step line over a light fill. Every day is a column with its own <title> ("28 Oct: 214
     views"), so a pointer anywhere over it reads it, however short its bar; the bar itself carries the same title. o.title(v)
     words a day's number where "N views" would say something untrue: a day of the step line is not the count on that day.
     A date, and "today so far", never break inside: the x labels wrap only between them. */
  function chart(o) {
    var days = o.days, n = days.length, W = n * 10, H = 100;
    var vals = days.map(function (d) { return d[1]; }).filter(known);
    var top = vals.length ? Math.max.apply(null, vals) : 0;
    var y = function (v) { return (H - (top > 0 ? v / top * H : 0)).toFixed(2); };
    var marks = [], hits = [], line = '', area = '';
    for (var i = 0; i < n; i++) {
      var d = days[i][0], v = days[i][1], x = i * 10, isToday = d === o.today;
      var when = day(d) + (isToday ? ' (today so far)' : '');
      var t = '<title>' + esc(known(v) ? when + ': ' + (o.title ? o.title(v) : whole(v) + ' ' + word(v, o.one, o.many)) : when + ': no record — the site counted nothing that day') + '</title>';
      if (o.kind === 'steps') {
        var yy = y(known(v) ? v : 0);
        line += (i ? 'V' + yy : 'M0 ' + yy) + 'H' + (x + 10);
      } else if (known(v)) {
        marks.push('<rect class="ss-bar' + (isToday ? ' is-today' : '') + '" x="' + (x + 1.5) + '" y="' + y(v) + '" width="7" height="' + (H - y(v)).toFixed(2) + '">' + t + '</rect>');
      } else {
        marks.push('<rect class="ss-bar is-none" x="' + (x + 1.5) + '" y="' + (H - 3) + '" width="7" height="3">' + t + '</rect>');
      }
      hits.push('<rect class="ss-hit' + (isToday ? ' is-today' : '') + '" x="' + x + '" y="0" width="10" height="' + H + '">' + t + '</rect>');
    }
    if (o.kind === 'steps' && n) { area = '<path class="ss-area" d="' + line + 'V' + H + 'H0Z"/>'; marks.push('<path class="ss-line" d="' + line + '" vector-effect="non-scaling-stroke"/>'); }
    var first = days[0][0], last = days[n - 1][0];
    return '<figure class="ss-chart">' +
      '<div class="ss-y" aria-hidden="true"><span>' + whole(top) + '</span><span>0</span></div>' +
      '<svg class="ss-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" focusable="false" aria-label="' + esc(o.label) + '">' +
        '<line class="ss-top" x1="0" y1="0" x2="' + W + '" y2="0" vector-effect="non-scaling-stroke"/>' + area + marks.join('') +
        '<line class="ss-base" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '" vector-effect="non-scaling-stroke"/>' + hits.join('') +
      '</svg>' +
      '<div class="ss-x" aria-hidden="true">' + (n > 1 ? '<span><span class="ss-nb">' + esc(day(first)) + '</span></span>' : '') +
        '<span><span class="ss-nb">' + esc(day(last)) + '</span>' + (last === o.today ? ' · <span class="ss-nb">today so far</span>' : '') + '</span></div>' +
    '</figure>';
  }
  // every day's number, newest first: the chart's exact reading
  function table(o) {
    var rows = o.days.slice().reverse().map(function (r) {
      return '<tr><th scope="row">' + esc(day(r[0], true)) + (r[0] === o.today ? ' (today so far)' : '') + '</th><td>' + (known(r[1]) ? whole(r[1]) : 'no record') + '</td></tr>';
    }).join('');
    return '<details class="ss-table"><summary data-tip="Shows the number for every day in the chart, newest first">Show the numbers</summary>' +
      '<div class="ss-tbl" role="region" tabindex="0" aria-label="' + esc(o.caption) + '"><table><caption class="sr-only">' + esc(o.caption) + ', newest first</caption>' +
      '<thead><tr><th scope="col">Day (UTC)</th><th scope="col">' + esc(o.col) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
  }
  // the chart's summary, read in place of the picture
  function summary(title, days, today, many) {
    var counted = days.filter(function (r) { return known(r[1]); });
    var best = counted.reduce(function (a, r) { return !a || r[1] > a[1] ? r : a; }, null);
    var last = days[days.length - 1];
    return title + ', ' + day(days[0][0]) + ' to ' + day(last[0], true) + ': ' +
      (best ? 'highest ' + whole(best[1]) + ' ' + many + ' on ' + day(best[0]) + (last[0] === today && known(last[1]) ? '; today so far ' + whole(last[1]) : '') : 'nothing counted in these days') + '. Every day’s number is in the table below.';
  }
  // the days shown are the last maxDays at most: said when the chart starts later than the series does
  var isCut = function (s) { return !!(s.days && s.days.length && s.since && s.days[0][0] > s.since); };
  function meta(bits) {
    var t = bits.filter(Boolean).join(' · ');
    return t ? '<p class="ss-meta">' + t.charAt(0).toUpperCase() + t.slice(1) + '.</p>' : '';   // a sentence, whichever part leads it
  }

  // a card: what it is and the number now (.ss-text), then its chart and its table (.ss-graph) — beside each other on a wide screen
  function card(id, o) {
    return '<section class="ss-card ss-card--' + id + '" aria-labelledby="ss-h-' + id + '">' +
      '<div class="ss-text"><h3 class="ss-name" id="ss-h-' + id + '">' + (o.dot ? '<span class="ss-dot" aria-hidden="true"></span>' : '') + esc(o.title) + '</h3>' +
        '<p class="ss-big"><b class="ss-num' + (o.numClass ? ' ' + o.numClass : '') + '">' + o.num + '</b> <span class="ss-unit">' + esc(o.unit) + '</span></p>' +
        '<p class="ss-what">' + o.what + '</p></div>' +
      '<div class="ss-graph">' + o.body + '</div></section>';
  }

  function render(box, j) {
    var now = j.now || {}, max = j.maxDays || 90;
    var vis = j.visitors || {}, vws = j.views || {}, ver = j.verified || {};
    var lastN = 'the last ' + max + ' days shown';
    var began = function (s) { return esc(day(s, true)) + ', when the site began counting'; };
    var win = known(now.activeWindowSec) && now.activeWindowSec > 90 ? 'the last ' + Math.round(now.activeWindowSec / 60) + ' minutes' : 'the last minute or so';
    var none = '<p class="ss-empty">Nothing counted yet: the site counts from the first page somebody opens.</p>';

    // 1. Sending it: people on the site right now; the chart, the different people who opened a page each day
    var c1 = vis.days && vis.days.length
      ? chart({ days: vis.days, today: vis.today, kind: 'bars', one: 'person', many: 'people', label: summary('People on the site each day', vis.days, vis.today, 'people') }) +
        meta(['Since ' + began(vis.since), 'once per network and browser a day (a phone that changes network counts twice), bots left out', isCut(vis) && lastN]) +
        table({ days: vis.days, today: vis.today, caption: 'People on the site each day', col: 'People' })
      : none;
    var w1 = 'Right now counts the people with the site open in ' + win + '; the chart counts the different people who opened a page each day.';

    // 2. Verified members: today's members, each on the day their wallet last passed — never the count on past days
    var lastV = ver.days && ver.days.length ? ver.days[ver.days.length - 1] : null;
    var c2 = (lastV
      ? chart({ days: ver.days, today: ver.today, kind: 'steps', title: function (v) { return whole(v) + ' of today’s verified members had last passed the check by then'; }, label: 'Verified members, each counted from the day their wallet last passed the check, ' + day(ver.days[0][0]) + ' to ' + day(lastV[0], true) + ': ' + whole(lastV[1]) + ' by today. Every day’s number is in the table below.' }) +
        meta(['So the line shows today’s members by that day — it is not a record of the count on past days', isCut(ver) && lastN]) +
        table({ days: ver.days, today: ver.today, caption: 'Verified members by the day their wallet last passed the check', col: 'Of today’s verified members, passed by this day' })
      : '<p class="ss-empty">No member’s wallet has passed the check yet, so there is no line to draw.</p>') +
      (ver.undated > 0 ? '<p class="ss-undated">' + whole(ver.undated) + ' verified ' + word(ver.undated, 'member has', 'members have') + ' no recorded day and ' + word(ver.undated, 'is', 'are') + ' not in the line.</p>' : '');
    var w2 = 'Members whose wallet passed the on-chain holder check (the check that lets an account post). On the line, each is counted from the day their wallet last passed it.';

    // 3. Views: every page opened by a person since counting began; the chart, the views each day
    var c3 = vws.days && vws.days.length
      ? chart({ days: vws.days, today: vws.today, kind: 'bars', one: 'view', many: 'views', label: summary('Page views each day', vws.days, vws.today, 'views') }) +
        meta([isCut(vws) && lastN]) +
        table({ days: vws.days, today: vws.today, caption: 'Page views each day', col: 'Views' })
      : none;
    var w3 = now.viewsSince
      ? 'Pages opened by people since ' + began(now.viewsSince) + ' — bots left out; the chart shows the views each day.'
      : 'Pages opened by people, bots left out — counted from the first page somebody opens.';

    box.removeAttribute('aria-busy');
    box.innerHTML = '<div class="ss-cards">' +
        card('live', { title: 'Sending it', dot: true, num: known(now.active) ? whole(now.active) : '—', numClass: 'ss-live-num', unit: known(now.active) ? 'right now' : 'not known just now', what: w1, body: c1 }) +
        card('verified', { title: 'Verified members', num: known(now.verified) ? whole(now.verified) : '—', numClass: 'ss-ver-num', unit: known(now.verified) ? 'now' : 'not known just now', what: w2, body: c2 }) +
        card('views', { title: 'Views', num: known(now.views) ? whole(now.views) : '—', numClass: 'ss-views-num', unit: known(now.views) ? (now.viewsSince ? 'since ' + day(now.viewsSince, true) : 'in all') : 'not counted yet', what: w3, body: c3 }) +
      '</div>' +
      '<div class="ss-foot"><a class="ss-wall" href="/wall">See who’s posting on the Wall →</a>' +
        '<p class="ss-note">Counted by this site from its own records — no tracker, no third party. Days are UTC days; the charts are read every few minutes, and “right now” is live.</p></div>';
  }

  /* again: the reader pressed Try again. The button goes with the old message, so focus moves first to the dialog itself (as
     FullView does on opening) — never to the page under it — and onto the new Try again if that fails too. */
  function load(box, alive, again) {
    var dlg = again && box.closest && box.closest('[role="dialog"]');
    if (dlg && box.contains(document.activeElement)) { try { dlg.focus({ preventScroll: true }); } catch (e) {} }
    box.setAttribute('aria-busy', 'true');
    box.innerHTML = '<p class="ss-wait" role="status">Reading the numbers…</p>';
    fetch('/api/site-stats', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 429) throw new Error('Too many asks from your connection just now — try again in a minute.');
        if (!r.ok) throw new Error('The numbers could not be read just now (' + r.status + ').');
        return r.json();
      })
      .then(function (j) { if (alive()) render(box, j); })
      .catch(function (e) {
        if (!alive()) return;
        box.removeAttribute('aria-busy');
        box.innerHTML = '<p class="ss-err" role="alert">⚠️ ' + esc(e && e.message && /^(Too many|The numbers)/.test(e.message) ? e.message : 'The numbers could not be read just now.') + '</p>' +
          '<p><button class="btn btn-ghost btn-sm ss-retry" type="button" data-tip="Asks the server for the numbers again">Try again</button></p>';
        var b = box.querySelector('.ss-retry');
        if (b) {
          b.addEventListener('click', function () { load(box, alive, true); });
          if (again && dlg && document.activeElement === dlg) { try { b.focus({ preventScroll: true }); } catch (e) {} }
        }
      });
  }

  function open(o) {
    o = o || {};
    if (!window.FullView) { location.href = '/wall'; return false; }   // no pop-up on this page: where the pill used to go
    return FullView.open({ title: 'Just Send It, in numbers', size: 'sheet', closeLabel: 'Close the numbers', opener: o.opener, fill: function (stage) {
      var box = document.createElement('div');
      box.className = 'ss';
      stage.appendChild(box);
      var shown = true;
      load(box, function () { return shown && box.isConnected; });
      // while it is open, the numbers now follow the bar's own poll (nav.js), so the pill and the pop-up never disagree for long
      var onPresence = function (e) {
        var j = e.detail || {};
        [['.ss-live-num', j.active], ['.ss-ver-num', j.verified], ['.ss-views-num', j.views]].forEach(function (p) {
          var el = box.querySelector(p[0]);
          if (el && known(p[1])) el.textContent = whole(p[1]);
        });
      };
      document.addEventListener('jsi:presence', onPresence);
      return function () { shown = false; document.removeEventListener('jsi:presence', onPresence); };
    } });
  }
  window.SiteStats = { open: open };
})();
