/* ===== Google Analytics on the admin page =====
   Owner, 2026-10-17: "add in google analytic and add analytics api data to the admin page". The server reads the site's
   GA4 property through the Google Analytics Data API (lib/ga.js) and this draws it:
     GET /api/admin/analytics              what is set up, and the reports (kept 10 minutes on the server)
     GET /api/admin/analytics?refresh=1    the same, read from Google now
   Admin-only, like admin.js: the server answers 404 for this file and that route to anyone else. Every figure is
   Google's own; a part Google could not answer says so, with its reason, and is never drawn as zero. */
(function () {
  const sec = document.getElementById('adm-ga');
  if (!sec) return;
  const sum = document.getElementById('adm-ga-sum'), body = document.getElementById('adm-ga-body'), refresh = document.getElementById('adm-ga-refresh');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const int = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  const pct = (n) => (n == null ? '—' : (n * 100).toFixed(1) + '%');
  const dur = (s) => { if (s == null) return '—'; const t = Math.round(s), m = Math.floor(t / 60), r = t % 60; return m ? m + ' min ' + r + ' s' : r + ' s'; };
  const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };
  const day = (d) => (d && d.length === 8 ? d.slice(6, 8) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(4, 6)) - 1] : esc(d));
  const call = (url) => (window.api ? window.api(url) : fetch(url, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'request failed (' + r.status + ')'); return j; }));

  // what is not set up yet, and exactly what the operator does about it
  function setupHTML(s) {
    const bad = s.invalid || [];
    const wrong = (k, how) => (bad.includes(k) ? ' <b class="adm-ga-bad">' + k + ' is set but not valid — ' + how + '.</b>' : '');
    const rows = [
      ['The page tag', s.tag, s.tag ? 'On — measurement id ' + esc(s.measurementId) + '. It starts only after the 18+ question is answered yes; visitors who send Global Privacy Control or Do Not Track, or turned it off on the privacy page, are not counted.' : 'Off. Set <code>GA_MEASUREMENT_ID</code> (the web stream’s id, G-…) in the server’s environment and restart it.' + wrong('GA_MEASUREMENT_ID', 'it must look like G-ABC123XYZ')],
      ['The reports on this page', s.api, s.api ? 'On — property ' + esc(s.propertyId) + '.' : 'Off. Set <code>GA_PROPERTY_ID</code> (the property’s number) and <code>GA_KEY_FILE</code> (the path to a Google Cloud service account’s JSON key, kept off this page and out of the repository), give that service account’s email <b>Viewer</b> access to the property in Google Analytics, turn on the Google Analytics Data API and Admin API in its Cloud project, and restart the server. Then, in Google Analytics → Admin → Data streams → Enhanced measurement, turn off everything but page views — including “Page changes based on browser history events” under Page views’ advanced settings (the privacy page promises page views only; this page checks it).' + wrong('GA_PROPERTY_ID', 'use the property’s number, such as 123456789')],
    ];
    return '<ul class="adm-ga-setup">' + rows.map(([k, on, say]) => '<li class="' + (on ? 'is-on' : 'is-off') + '"><b>' + (on ? '✔ ' : '○ ') + esc(k) + '</b> — ' + say + '</li>').join('') + '</ul>';
  }
  function tile(label, value, note) { return '<div class="adm-ga-tile"><b>' + value + '</b><span>' + esc(label) + '</span>' + (note ? '<i>' + esc(note) + '</i>' : '') + '</div>'; }
  // the last 28 days of visitors as bars, drawn to one scale, with the busiest day named
  function chartHTML(daily) {
    if (!daily || !daily.length) return '<p class="modal-note">No visits recorded in the last 28 days.</p>';
    const max = Math.max(1, ...daily.map((d) => d.activeUsers || 0)), W = 560, H = 140, gap = 2, bw = Math.max(2, (W - gap * (daily.length - 1)) / daily.length);
    const bars = daily.map((d, i) => { const h = Math.round((d.activeUsers || 0) / max * (H - 18)); return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h) + '" width="' + bw.toFixed(1) + '" height="' + h + '" rx="1.5"><title>' + day(d.date) + ': ' + int(d.activeUsers) + ' visitors, ' + int(d.sessions) + ' visits, ' + int(d.views) + ' page views</title></rect>'; }).join('');
    const top = daily.reduce((a, d) => ((d.activeUsers || 0) > (a.activeUsers || 0) ? d : a), daily[0]);
    return '<figure class="adm-ga-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Visitors a day for the last ' + daily.length + ' days; the busiest was ' + day(top.date) + ' with ' + int(top.activeUsers) + '" preserveAspectRatio="none">' + bars + '</svg>' +
      '<figcaption><span>' + day(daily[0].date) + '</span><span>busiest: ' + day(top.date) + ', ' + int(top.activeUsers) + ' visitors</span><span>' + day(daily[daily.length - 1].date) + '</span></figcaption></figure>';
  }
  function tableHTML(title, head, rows) {
    if (!rows) return '';
    return '<div class="adm-ga-tbl"><h3>' + esc(title) + '</h3>' + (rows.length
      ? '<div class="adm-dau-table"><table><thead><tr>' + head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c, i) => '<td>' + (i === 0 ? esc(c == null || c === '' ? '(not set)' : c) : int(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      : '<p class="modal-note">None in the last 28 days.</p>') + '</div>';
  }
  function reportHTML(r, s) {
    const e = r.errors || {}, t = r.totals || null;
    let h = '';
    if (t) h += '<div class="adm-ga-tiles">' +
      tile('on the site right now', r.realtime ? int(r.realtime.activeUsers) : '—', r.realtime ? 'the last 30 minutes' : 'not answered') +
      tile('visitors today', int(t.today.activeUsers)) + tile('visitors, last 7 days', int(t.d7.activeUsers)) + tile('visitors, last 28 days', int(t.d28.activeUsers), int(t.d28.newUsers) + ' of them new') +
      tile('visits, last 28 days', int(t.d28.sessions)) + tile('page views, last 28 days', int(t.d28.screenPageViews)) +
      tile('engaged visits, last 28 days', pct(t.d28.engagementRate)) + tile('average visit, last 28 days', dur(t.d28.averageSessionDuration)) +
    '</div>';
    if (t) h += chartHTML(r.daily);
    h += '<div class="adm-ga-tbls">' +
      tableHTML('Top pages, last 28 days', ['Page', 'Views', 'Visitors'], r.pages ? r.pages.map((x) => [x.path, x.views, x.users]) : null) +
      tableHTML('Where visits came from', ['Source', 'Visits', 'Visitors'], r.sources ? r.sources.map((x) => [x.source, x.sessions, x.users]) : null) +
      tableHTML('Countries', ['Country', 'Visitors'], r.countries ? r.countries.map((x) => [x.country, x.users]) : null) +
      tableHTML('Devices', ['Device', 'Visitors'], r.devices ? r.devices.map((x) => [x.device, x.users]) : null) +
    '</div>';
    /* the privacy page promises page views only: Google's automatic extras must be off in the stream's settings */
    const st = r.stream;
    if (st && st.checked && st.found && st.extrasOn && st.extrasOn.length) h += '<p class="adm-ga-err adm-ga-warn">⚠️ <b>Google’s enhanced measurement is recording more than page views</b> on the stream “' + esc(st.stream) + '”: ' + st.extrasOn.map(esc).join(', ') + '. The privacy page promises page views only — turn these off in Google Analytics → Admin → Data streams → ' + esc(st.stream) + ' → Enhanced measurement (outbound clicks can carry a visitor’s own wallet address).</p>';
    else if (st && st.checked && st.found) h += '<p class="modal-note">✔ Google’s enhanced measurement extras are off on the stream “' + esc(st.stream) + '”: it records page views only, as the privacy page says.</p>';
    else if (st && st.checked && !st.found) h += '<p class="adm-ga-err">⚠️ No web stream in this property has the measurement id the site uses — the tag and the reports point at different places.</p>';
    else if (st && !st.checked && s.tag) h += '<p class="adm-ga-err">⚠️ Could not check Google’s enhanced measurement settings (' + esc(st.why) + '). The privacy page promises page views only: make sure outbound clicks, site search, form interactions, file downloads, video and scroll events, and “Page changes based on browser history events”, are off in Google Analytics → Admin → Data streams → Enhanced measurement. (Reading them needs the Google Analytics Admin API turned on in the key’s Cloud project.)</p>';
    const errs = Object.entries(e);
    if (errs.length) h += '<p class="adm-ga-err">⚠️ Google could not answer part of this: ' + errs.map(([k, v]) => '<b>' + esc(k) + '</b> — ' + esc(v)).join('; ') + '. Those parts are left out, never shown as zero.</p>';
    return h;
  }
  let busy = false;
  async function load(force) {
    if (busy) return;
    busy = true; refresh.disabled = true;
    sum.textContent = force ? 'Asking Google Analytics…' : 'Reading…';
    try {
      const j = await call('/api/admin/analytics' + (force ? '?refresh=1' : ''));
      const s = j.setup || {};
      let h = (!s.tag || !s.api) ? setupHTML(s) : '';
      if (j.report) h += reportHTML(j.report, s);
      body.innerHTML = h;
      sum.textContent = j.error ? '⚠️ ' + j.error + (j.report ? ' — showing the figures from ' + when(j.cachedAt) + '.' : '')
        : j.report ? 'From Google Analytics, ' + when(j.report.at) + '. Property ' + (s.propertyId || '') + '.' + (j.throttled ? ' Refreshed too often — these are the figures kept from then; try again in a minute.' : '')
        : s.tag && !s.api ? 'The page tag is on and counting visitors; the reports here are not set up yet — see below.'
        : !s.api ? 'Not set up yet — see below.' : 'No figures yet.';
      refresh.hidden = !s.api;
    } catch (e) { sum.textContent = '⚠️ ' + ((e && e.message) || 'could not read it'); }
    busy = false; refresh.disabled = false;
  }
  refresh.addEventListener('click', () => load(true));
  let shown = false;
  function boot() {
    const u = window.AUTH && AUTH.user, ok = !!(u && u.admin);
    sec.hidden = !ok;
    if (!ok) { body.innerHTML = ''; sum.textContent = ''; shown = false; return; }
    if (!shown) { shown = true; load(false); }
  }
  if (window.AUTH && AUTH.ready && AUTH.ready.then) AUTH.ready.then(boot, boot); else boot();
  document.addEventListener('auth:change', boot);
})();
