#!/usr/bin/env node
/* ===== node scripts/indexnow.mjs https://sendrh.com (--since <date> | --all | <url> …) [--dry-run] ==========
 * IndexNow: tells Bing (and through it ChatGPT search, Copilot and DuckDuckGo), Yandex, Seznam, Naver, Yep and the
 * Internet Archive which public pages are new or changed, so they are crawled now rather than whenever the crawler comes
 * round. Google does not take part (it reads /sitemap.xml, submitted in Search Console).
 *
 * The key is the name of the one 32-hex-digit .txt file in public/, whose content is the key itself; the search engines
 * fetch it from the site to check that a submission really comes from the site's owner. It is public on purpose.
 *
 * IndexNow asks for changed URLs only ("Do not resubmit unchanged URLs"), so a run names what changed:
 *   --since 2026-10-15   the walls and communities in the live sitemaps whose <lastmod> is on or after that moment
 *                        (the static pages carry no lastmod: name the ones a deploy changed, as URLs)
 *   <url> <url> …        exactly these pages (each must be in the live sitemaps: only indexable pages are sent)
 *   --all                every URL in the sitemaps — once, for the first submission or after a site-wide change
 * --dry-run lists what would be sent and sends nothing. Read-only for the site.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const ORIGIN = String(args[0] || '').replace(/\/+$/, '');
const DRY = args.includes('--dry-run'), ALL = args.includes('--all');
const sinceAt = args.indexOf('--since'), SINCE = sinceAt > 0 ? Date.parse(args[sinceAt + 1]) : null;
const named = args.slice(1).filter((a, i, all) => /^https:\/\//.test(a) && all[i - 1] !== '--since');
const usage = () => { console.error('usage: node scripts/indexnow.mjs https://your.domain (--since <ISO date> | --all | <url> …) [--dry-run]'); process.exit(2); };
if (!/^https:\/\/[^/]+$/.test(ORIGIN)) usage();
if (sinceAt > 0 && !Number.isFinite(SINCE)) { console.error('--since needs a date, e.g. --since 2026-10-15 or --since 2026-10-15T12:00:00Z'); process.exit(2); }
if (!ALL && SINCE == null && !named.length) usage();
const HOST = new URL(ORIGIN).host;
const PUB = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'public');
const keyFile = readdirSync(PUB).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) { console.error('no IndexNow key file (32 hex digits + .txt) in public/'); process.exit(1); }
const key = keyFile.slice(0, -4);
if (readFileSync(path.join(PUB, keyFile), 'utf8').trim() !== key) { console.error(keyFile + ' must contain exactly its own name'); process.exit(1); }

const get = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'JustSendIt-indexnow' }, signal: AbortSignal.timeout(20000) }); return { status: r.status, text: await r.text() }; };
const entries = (xml) => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => {
  const loc = (/<loc>([^<]+)<\/loc>/.exec(m[1]) || [])[1], lm = (/<lastmod>([^<]+)<\/lastmod>/.exec(m[1]) || [])[1];
  return { loc: loc ? loc.replace(/&amp;/g, '&').trim() : null, lastmod: lm ? Date.parse(lm) : null };
}).filter((e) => e.loc);

// the key file must be live before the engines are asked to check it
const live = await get(ORIGIN + '/' + keyFile);
if (live.status !== 200 || live.text.trim() !== key) { console.error('the key file is not live at ' + ORIGIN + '/' + keyFile + ' (' + live.status + ') — deploy first'); process.exit(1); }

// every URL the site lets search engines index, from the live sitemap index and its children
const index = await get(ORIGIN + '/sitemap.xml');
if (index.status !== 200) { console.error('sitemap.xml: ' + index.status); process.exit(1); }
const all = new Map();
for (const child of [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())) {
  const c = await get(child);
  if (c.status !== 200) { console.error(child + ': ' + c.status); process.exit(1); }
  for (const e of entries(c.text)) if (new URL(e.loc).host === HOST) all.set(e.loc, e);
}
let urlList;
if (ALL) urlList = [...all.keys()];
else {
  const notIndexable = named.filter((u) => !all.has(u));
  if (notIndexable.length) { console.error('not in the sitemaps (not an indexable page, or not this host): ' + notIndexable.join(' ')); process.exit(1); }
  urlList = [...new Set([...named, ...(SINCE == null ? [] : [...all.values()].filter((e) => e.lastmod != null && e.lastmod >= SINCE).map((e) => e.loc))])];
}
console.log(urlList.length + ' URL(s) to send (' + all.size + ' in the sitemaps)');
if (!urlList.length) { console.error('nothing to send: nothing changed in that window'); process.exit(1); }
if (DRY) { for (const u of urlList) console.log('  ' + u); process.exit(0); }
const why = { 200: 'received', 202: 'received; the key is being checked', 400: 'bad request', 403: 'key not valid (is the key file live?)', 422: 'a URL is not on this host', 429: 'too many requests — try later' };
let failed = 0;
for (let i = 0; i < urlList.length; i += 10000) {   // IndexNow takes up to 10,000 URLs a request
  const part = urlList.slice(i, i + 10000);
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ host: HOST, key, keyLocation: ORIGIN + '/' + keyFile, urlList: part }),
  });
  console.log('IndexNow (' + part.length + ' URLs): ' + r.status + ' ' + (why[r.status] || '') + ' ' + (await r.text()).slice(0, 200));
  if (r.status !== 200 && r.status !== 202) failed++;
}
process.exit(failed ? 1 : 0);
