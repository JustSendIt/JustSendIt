'use strict';
/* ===== Google Analytics 4: the admin page's numbers =======================================================
   Owner, 2026-10-17: "add in google analytic and add analytics api data to the admin page".

   The site's tag (public/ga.js) sends page views to the operator's GA4 property. This file is the other half: the server
   reads that property's reports through the Google Analytics Data API (v1beta) with a service account, so the admin
   page can show them without anyone signing in to Google there. Read-only (analytics.readonly); nothing is written.

   Set up by the operator (server.js reads these from the environment; nothing here is a default):
     GA_MEASUREMENT_ID  the property's web stream id (G-…)        → turns the page tag on
     GA_PROPERTY_ID     the property's numeric id                   → which property the reports come from
     GA_KEY_FILE        path to a service account's JSON key file   → who reads them (Viewer on the property)
   The key file is read when a token is needed and never logged, copied or sent anywhere but Google's token endpoint.

   Every figure shown is the API's own: a report that fails is said to have failed, with Google's reason, and never
   shown as zero. */
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://analyticsdata.googleapis.com/v1beta';
const ADMIN_BASE = 'https://analyticsadmin.googleapis.com';   // the Admin API, read-only here: is enhanced measurement off?
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function parseKey(json) {
  let k;
  try { k = JSON.parse(json); } catch { throw new Error('the key file is not JSON'); }
  if (!k || k.type !== 'service_account' || !k.client_email || !k.private_key) throw new Error('the key file is not a Google service account key');
  return { email: String(k.client_email), key: String(k.private_key) };
}
// a signed JWT the token endpoint swaps for an access token (RFC 7523), good for an hour
function signedAssertion(sa, nowSec, tokenUrl) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: sa.email, scope: SCOPE, aud: tokenUrl || TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(sa.key);
  return head + '.' + body + '.' + b64u(sig);
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// one report's rows as plain objects: { dimensionName: value, metricName: number }
function rowsOf(rep) {
  const dims = ((rep && rep.dimensionHeaders) || []).map((h) => h.name), mets = ((rep && rep.metricHeaders) || []).map((h) => h.name);
  return ((rep && rep.rows) || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = r.dimensionValues && r.dimensionValues[i] ? r.dimensionValues[i].value : null; });
    mets.forEach((m, i) => { o[m] = r.metricValues && r.metricValues[i] ? num(r.metricValues[i].value) : null; });
    return o;
  });
}

const TOTALS = ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'];
/* Google leaves a day with no visits out of the daily report. Every one of the 28 days ending "today" in the property's
   own time zone is put back, a missing one as a true zero, so the chart's bars stand for days and never close up. */
function fillDays(rows, timeZone, nowMs) {
  let today;
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs)); } catch { today = new Date(nowMs).toISOString().slice(0, 10); }
  const last = rows.reduce((m, r) => (r.date > m ? r.date : m), today.replace(/-/g, ''));
  const end = Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)) - 1, Number(last.slice(6, 8)));
  const by = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(end - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    out.push(by.get(d) || { date: d, activeUsers: 0, sessions: 0, views: 0 });
  }
  return out;
}
// the reports the admin page shows (one batch of five, plus devices and the last 30 minutes)
function reportRequests() {
  return {
    batch: [
      { dateRanges: [{ startDate: 'today', endDate: 'today', name: 'today' }, { startDate: '6daysAgo', endDate: 'today', name: 'd7' }, { startDate: '27daysAgo', endDate: 'today', name: 'd28' }], metrics: TOTALS.map((name) => ({ name })) },
      { dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 40 },
      { dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 15 },
      { dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 },
      { dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'country' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 10 },
    ],
    devices: { dateRanges: [{ startDate: '27daysAgo', endDate: 'today' }], dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 5 },
    realtime: { metrics: [{ name: 'activeUsers' }], minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }] },
  };
}

/* The client: a cached access token, three API calls per refresh. `fetch` and `now` are passed in (the server's own,
   and stubs in tests); `readKey()` returns the key file's text each time a token is needed. */
/* Google's "enhanced measurement" records more than page views by itself — outbound link clicks WITH the link's address
   (an explorer link can carry a visitor's own wallet), site-search words, form use, file downloads, video and scroll
   events — and it is ON by default for a new web stream. A page tag cannot switch it off; only the stream's settings can.
   The privacy page promises page views only, so the admin page reads these settings and names any extra that is on. */
const EXTRAS = [['outboundClicksEnabled', 'outbound link clicks (with the link\'s address)'], ['pageChangesEnabled', 'page views on in-page address changes (sent with the full address, ?query included)'],
  ['siteSearchEnabled', 'site search'], ['formInteractionsEnabled', 'form interactions'], ['fileDownloadsEnabled', 'file downloads'], ['videoEngagementEnabled', 'video engagement'], ['scrollsEnabled', 'scrolls']];
function makeClient({ readKey, propertyId, fetch, now, tokenUrl, apiBase, adminBase, measurementId }) {
  if (!/^\d{1,20}$/.test(String(propertyId || ''))) throw new Error('GA_PROPERTY_ID must be the property\'s numeric id');
  let token = null;   // { value, until }
  async function accessToken() {
    if (token && now() < token.until - 60000) return token.value;
    const sa = parseKey(await readKey());
    const assertion = signedAssertion(sa, Math.floor(now() / 1000), tokenUrl);
    const res = await fetch(tokenUrl || TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error('Google refused the service account: ' + String(j.error_description || j.error || ('HTTP ' + res.status)).slice(0, 200));
    token = { value: j.access_token, until: now() + (Number(j.expires_in) || 3600) * 1000 };
    return token.value;
  }
  async function getJson(url) {
    const t = await accessToken();
    const res = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + t } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { if (res.status === 401) token = null; throw new Error('the Analytics Admin API answered ' + res.status + ': ' + String((j.error && j.error.message) || '').slice(0, 200)); }
    return j;
  }
  // the web stream behind the site's measurement id, and which of Google's automatic extras it records
  async function streamCheck() {
    if (!measurementId) return { checked: false, why: 'no measurement id is set, so there is no stream to check' };
    const base = adminBase || ADMIN_BASE;
    const list = await getJson(base + '/v1beta/properties/' + propertyId + '/dataStreams?pageSize=50');
    const s = (list.dataStreams || []).find((x) => x.webStreamData && String(x.webStreamData.measurementId || '').toUpperCase() === measurementId);
    if (!s) return { checked: true, found: false };
    const em = await getJson(base + '/v1alpha/' + s.name + '/enhancedMeasurementSettings');
    // Google's JSON leaves out a false boolean: the master switch is on only when it says so, and while it is off the
    // per-extra flags keep their stored values without doing anything
    const on = em.streamEnabled !== true ? [] : EXTRAS.filter(([k]) => em[k] === true).map(([, say]) => say);
    return { checked: true, found: true, stream: s.displayName || s.name, extrasOn: on };
  }
  async function call(method, body) {
    const t = await accessToken();
    const res = await fetch((apiBase || API_BASE) + '/properties/' + propertyId + ':' + method, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { if (res.status === 401) token = null; throw new Error('the Analytics Data API answered ' + res.status + ': ' + String((j.error && j.error.message) || '').slice(0, 200)); }
    return j;
  }
  /* Everything the admin page shows. A part that fails carries its error instead of figures; the rest still show. */
  async function report() {
    const q = reportRequests();
    const out = { at: now(), propertyId: String(propertyId), errors: {} };
    try {
      const b = await call('batchRunReports', { requests: q.batch });
      const reps = b.reports || [];
      const tot = rowsOf(reps[0]);
      out.totals = {};
      for (const name of ['today', 'd7', 'd28']) {
        const r = tot.find((x) => x.dateRange === name);
        // a range with no visits has no row: its counts ARE zero, but a rate over no visits does not exist ('—', never 0)
        out.totals[name] = r ? Object.fromEntries(TOTALS.map((m) => [m, r[m]])) : Object.fromEntries(TOTALS.map((m) => [m, m === 'engagementRate' || m === 'averageSessionDuration' ? null : 0]));
      }
      out.daily = fillDays(rowsOf(reps[1]).map((r) => ({ date: r.date, activeUsers: r.activeUsers, sessions: r.sessions, views: r.screenPageViews })), (reps[1] && reps[1].metadata && reps[1].metadata.timeZone) || 'UTC', now());
      out.pages = rowsOf(reps[2]).map((r) => ({ path: r.pagePath, views: r.screenPageViews, users: r.activeUsers }));
      out.sources = rowsOf(reps[3]).map((r) => ({ source: r.sessionSource, sessions: r.sessions, users: r.activeUsers }));
      out.countries = rowsOf(reps[4]).map((r) => ({ country: r.country, users: r.activeUsers }));
    } catch (e) { out.errors.reports = String(e.message || e); }
    try { out.devices = rowsOf(await call('runReport', q.devices)).map((r) => ({ device: r.deviceCategory, users: r.activeUsers })); }
    catch (e) { out.errors.devices = String(e.message || e); }
    try { const rt = rowsOf(await call('runRealtimeReport', q.realtime)); out.realtime = { activeUsers: rt.length ? rt[0].activeUsers : 0 }; }
    catch (e) { out.errors.realtime = String(e.message || e); }
    try { out.stream = await streamCheck(); }
    catch (e) { out.stream = { checked: false, why: String(e.message || e) }; }
    return out;
  }
  return { report, accessToken };
}

module.exports = { makeClient, parseKey, signedAssertion, rowsOf, reportRequests, fillDays, EXTRAS, TOKEN_URL, API_BASE, ADMIN_BASE, SCOPE };
