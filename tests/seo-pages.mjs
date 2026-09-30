/* The pages' search heads, read straight from the files: every static page's <title>, description, robots, canonical,
   Open Graph and Twitter tags and JSON-LD against the SEO standard, plus robots.txt and the static sitemap. The per-entity
   heads the server builds (/u/<name>, community.html?id=N, the dynamic sitemaps) are covered by seo-server.mjs; this suite
   needs no server and ignores the port it is handed. */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const ORIGIN = 'https://sendrh.com';
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

const INDEXABLE_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1';
/* The fixed titles and robots values, one row per page in public/. A page added to public/ without a row here fails the
   first check, so a new page cannot ship without a decided head. */
const PAGES = {
  'index.html':       ['$SEND (SEND IT) Memecoin on Robinhood Chain — Just Send It', 'index'],
  'about.html':       ['What Is $SEND? The SEND IT Community Guide — $Send', 'index'],
  'whitepaper.html':  ['$SEND White Paper — How Just Send It Works', 'index'],
  'wall.html':        ['The Send Wall — $SEND Meme Community Feed', 'index'],
  'newpairs.html':    ['Robinhood Chain Token Scanner & New Pairs — $Send', 'index'],
  'tracker.html':     ['Robinhood Chain Wallet Tracker: Holdings & PNL — $Send', 'index'],
  'arcade.html':      ['Arcade: Rocket Run & Competitions — $Send', 'index'],
  'communities.html': ['Token Communities on Robinhood Chain — $Send', 'index'],
  'support.html':     ['Support Board: Ask & Answer Questions — $Send', 'index'],
  'privacy.html':     ['Privacy Policy — $Send', 'index'],
  'terms.html':       ['Terms of Service — $Send', 'noindex, follow'],
  'data.html':        ['Data API — $Send', 'noindex, follow'],
  'profile.html':     ['My Profile — $Send', 'noindex, follow'],
  'watchlist.html':   ['My Watchlist — $Send', 'noindex, follow'],
  'squad.html':       ['Send Squad — $Send', 'noindex, follow'],
  'admin.html':       ['Moderation — $Send', 'noindex, nofollow'],
  'gate.html':        ['Get Your Ticket — Just Send It', 'noindex, follow'],
  'u.html':           ['Sender Profile — $Send', 'noindex, follow'],
  'community.html':   ['Community — $Send', 'noindex, follow'],
};
const PAGE_TYPE = { 'about.html': 'AboutPage', 'communities.html': 'CollectionPage', 'wall.html': 'CollectionPage', 'whitepaper.html': 'TechArticle' };
const isIndexable = (f) => PAGES[f] && PAGES[f][1] === 'index';
const urlOf = (f) => ORIGIN + '/' + (f === 'index.html' ? '' : f);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', times: '×', middot: '·', rarr: '→', larr: '←', copy: '©' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (NAMED[e.toLowerCase()] ?? m));
const textOf = (h) => decode(h.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|[\u{1F1E6}-\u{1F1FF}]/u;
const len = (s) => [...s].length;
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));

function headOf(f) {
  const s = read(f);
  const head = s.slice(0, s.search(/<\/head>/i));
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (k) => metas.filter((a) => a.name === k || a.property === k).map((a) => decode(a.content ?? ''));
  const titles = [...head.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => decode(m[1]));
  const ld = [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  return { s, head, metas, links, meta, titles, ld };
}
const nodesOf = (j) => (Array.isArray(j['@graph']) ? j['@graph'] : [j]);

/* robots.txt the way Google reads it: the `User-agent: *` group, the longest matching pattern wins, and Allow wins a tie. */
function robotsAllows(txt, p) {
  let inStar = false, lastWasUA = false;
  const rules = [];
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { inStar = lastWasUA ? inStar || v === '*' : v === '*'; lastWasUA = true; continue; }
    lastWasUA = false;
    if (inStar && (k === 'allow' || k === 'disallow') && v) rules.push({ allow: k === 'allow', pat: v });
  }
  let best = null;
  for (const r of rules) {
    const anchored = r.pat.endsWith('$');
    const body = anchored ? r.pat.slice(0, -1) : r.pat;
    const re = new RegExp('^' + body.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
    if (!re.test(p)) continue;
    if (!best || r.pat.length > best.pat.length || (r.pat.length === best.pat.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

try {
  const files = readdirSync(PUB).filter((f) => f.endsWith('.html')).sort();
  const heads = Object.fromEntries(files.map((f) => [f, headOf(f)]));
  check('every page in public/ has a decided title and robots value (a row in this suite)', files.every((f) => PAGES[f]) && Object.keys(PAGES).every((f) => files.includes(f)),
    files.filter((f) => !PAGES[f]).concat(Object.keys(PAGES).filter((f) => !files.includes(f))).join(','));

  /* ═══ title, description, robots ═══ */
  const bad = (fn) => files.filter((f) => PAGES[f]).filter((f) => { try { return !fn(f, heads[f]); } catch { return true; } });
  let b;
  b = bad((f, h) => h.titles.length === 1 && h.titles[0] === PAGES[f][0]);
  check('every page has exactly one <title>, equal to the spec table', !b.length, b.map((f) => f + '=' + JSON.stringify(heads[f].titles)).join(' | '));
  b = bad((f, h) => !EMOJI.test(h.titles[0]) && len(h.titles[0]) <= 60);
  check('  ...with no emoji and at most 60 characters', !b.length, b.join(','));
  b = bad((f, h) => h.meta('description').length === 1 && len(h.meta('description')[0]) >= 120 && len(h.meta('description')[0]) <= 160).filter(isIndexable);
  check('every indexable page has one description of 120-160 characters', !b.length, b.map((f) => f + ':' + heads[f].meta('description').map(len)).join(','));
  b = bad((f, h) => h.meta('description').length === 1 && len(h.meta('description')[0]) >= 120 && len(h.meta('description')[0]) <= 160).filter((f) => !isIndexable(f));
  check('  ...and so does every noindex page', !b.length, b.map((f) => f + ':' + heads[f].meta('description').map(len)).join(','));
  b = bad((f, h) => !EMOJI.test(h.meta('description')[0]));
  check('  ...with no emoji in any description', !b.length, b.join(','));
  const descs = files.map((f) => heads[f].meta('description')[0]);
  check('  ...and no two pages share a description', new Set(descs).size === descs.length);
  b = bad((f, h) => h.meta('robots').length === 1 && h.meta('robots')[0] === (isIndexable(f) ? INDEXABLE_ROBOTS : PAGES[f][1]));
  check('every page has one robots meta with the value from the table', !b.length, b.map((f) => f + '=' + JSON.stringify(heads[f].meta('robots'))).join(' | '));
  b = bad((f, h) => h.meta('theme-color').length === 1 && h.meta('theme-color')[0] === '#c6f000');
  check('every page has theme-color #c6f000', !b.length, b.join(','));
  b = files.filter((f) => heads[f].metas.some((a) => (a.name || '').toLowerCase() === 'keywords'));
  check('no page carries <meta name="keywords">', !b.length, b.join(','));

  /* ═══ canonical and og:url ═══ */
  const canon = (h) => h.links.filter((a) => a.rel === 'canonical').map((a) => a.href);
  b = bad((f, h) => !isIndexable(f) || (canon(h).length === 1 && canon(h)[0] === urlOf(f) && h.meta('og:url').length === 1 && h.meta('og:url')[0] === canon(h)[0]));
  check('every indexable page has one canonical on the https://sendrh.com placeholder origin, and og:url equals it', !b.length, b.map((f) => f + '=' + canon(heads[f]) + '/' + heads[f].meta('og:url')).join(' | '));
  b = bad((f, h) => isIndexable(f) || (f === 'gate.html'
    ? canon(h).length === 1 && canon(h)[0] === ORIGIN + '/' && h.meta('og:url')[0] === ORIGIN + '/'
    : canon(h).length === 0 && h.meta('og:url').length === 0));
  check('noindex pages carry no canonical and no og:url (gate.html keeps its canonical to /, with og:url equal to it)', !b.length, b.join(','));
  b = bad((f, h) => h.links.filter((a) => a.rel === 'manifest').length === 1 && h.links.some((a) => a.rel === 'manifest' && a.href === '/site.webmanifest'));
  check('every page links /site.webmanifest, once', !b.length, b.join(','));
  let manifestOk = false; try { const m = JSON.parse(read('site.webmanifest')); manifestOk = !!(m.name && m.start_url && Array.isArray(m.icons) && m.icons.length); } catch {}
  check('  ...and public/site.webmanifest is valid JSON with a name, a start_url and icons', manifestOk);

  /* ═══ Open Graph and Twitter ═══ */
  const one = (h, k, v) => h.meta(k).length === 1 && (v === undefined ? h.meta(k)[0].trim() !== '' : h.meta(k)[0] === v);
  const withOg = files.filter((f) => heads[f].metas.some((a) => (a.property || '').startsWith('og:')));
  check('every page has Open Graph tags', withOg.length === files.length, files.filter((f) => !withOg.includes(f)).join(','));
  const IMG = ORIGIN + '/assets/logo-og.png';
  b = withOg.filter((f) => { const h = heads[f]; return !(one(h, 'og:site_name', '$Send — Just Send It') && one(h, 'og:locale', 'en_US') && one(h, 'og:title') && one(h, 'og:description')
    && one(h, 'og:image', IMG) && one(h, 'og:image:type', 'image/png') && one(h, 'og:image:width', '1200') && one(h, 'og:image:height', '630') && one(h, 'og:image:alt')); });
  check('og:site_name, og:locale, og:title, og:description, og:image and its type, width, height and alt are each present once', !b.length, b.join(','));
  b = withOg.filter((f) => { const h = heads[f]; return !(one(h, 'twitter:card', 'summary_large_image') && one(h, 'twitter:site', '@sendrh_') && one(h, 'twitter:title') && one(h, 'twitter:description')
    && one(h, 'twitter:image') && one(h, 'twitter:image:alt')); });
  check('twitter:card, site, title, description, image and image:alt are each present once', !b.length, b.join(','));
  b = withOg.filter((f) => { const h = heads[f]; return !(h.meta('twitter:title')[0] === h.meta('og:title')[0] && h.meta('twitter:description')[0] === h.meta('og:description')[0]
    && h.meta('twitter:image')[0] === h.meta('og:image')[0] && h.meta('twitter:image:alt')[0] === h.meta('og:image:alt')[0]); });
  check('  ...and the Twitter values are the Open Graph values', !b.length, b.join(','));
  b = withOg.filter((f) => len(heads[f].meta('og:description')[0] || '') > 160 || ((heads[f].meta('og:title')[0] || '').match(/\p{Extended_Pictographic}/gu) || []).length > 1);
  check('  ...with og:description at most 160 characters and at most one emoji in og:title', !b.length, b.join(','));
  b = withOg.filter((f) => heads[f].meta('og:type')[0] !== (f === 'whitepaper.html' ? 'article' : f === 'u.html' ? 'profile' : 'website'));
  check('og:type is article on the white paper, profile on the wall template, website everywhere else', !b.length, b.map((f) => f + '=' + heads[f].meta('og:type')).join(','));
  const dup = files.filter((f) => { const k = heads[f].metas.map((a) => a.name || a.property).filter(Boolean); return new Set(k).size !== k.length; });
  check('no page repeats a meta name or property', !dup.length, dup.join(','));
  const ORDER = ['title', 'description', 'robots', 'theme-color', 'canonical', 'manifest', 'og:type', 'og:site_name', 'og:locale', 'og:url', 'og:title', 'og:description',
    'og:image', 'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt', 'twitter:card', 'twitter:site', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt', 'ld+json'];
  b = files.filter((f) => {
    const seen = [...heads[f].head.matchAll(/<title>|<(?:meta|link)\b[^>]*>|<script type="application\/ld\+json">/gi)].map((m) => {
      if (m[0] === '<title>') return 'title';
      if (/ld\+json/.test(m[0])) return 'ld+json';
      const a = attrs(m[0]); return a.rel === 'canonical' || a.rel === 'manifest' ? a.rel : (a.name || a.property);
    }).filter((k) => ORDER.includes(k)).map((k) => ORDER.indexOf(k));
    return seen.some((v, i) => i && v <= seen[i - 1]);
  });
  check('every head keeps the standard order (title → description → robots → … → twitter:image:alt → JSON-LD)', !b.length, b.join(','));
  const leak = files.filter((f) => /localhost|127\.0\.0\.1/.test(heads[f].head));
  check('no head names a local address (absolute URLs use the placeholder origin)', !leak.length, leak.join(','));

  /* ═══ JSON-LD ═══ */
  const parsed = {};
  const unparsable = [];
  for (const f of files) parsed[f] = heads[f].ld.map((t) => { try { return JSON.parse(t); } catch (e) { unparsable.push(f + ': ' + e.message); return null; } });
  check('every ld+json block on every page is valid JSON', !unparsable.length, unparsable.join(' | '));
  b = files.filter((f) => isIndexable(f) ? parsed[f].length !== 1 : parsed[f].length !== 0);
  check('every indexable page has exactly one JSON-LD block, and no noindex page has any', !b.length, b.map((f) => f + ':' + parsed[f].length).join(','));
  b = files.filter(isIndexable).filter((f) => {
    const j = parsed[f][0]; if (!j) return true;
    const nodes = nodesOf(j), url = urlOf(f), t = PAGES[f][0], d = heads[f].meta('description')[0];
    const pg = nodes.find((n) => n['@type'] === (PAGE_TYPE[f] || 'WebPage'));
    if (j['@context'] !== 'https://schema.org' || !pg) return true;
    if ((pg.name || pg.headline) !== t || pg.description !== d || pg.inLanguage !== 'en') return true;
    if (!pg.isPartOf || pg.isPartOf['@id'] !== ORIGIN + '/#website') return true;
    if (f === 'index.html') return !(pg['@id'] === url + '#webpage' && pg.url === url);
    const bc = nodes.find((n) => n['@type'] === 'BreadcrumbList');
    const items = bc && bc.itemListElement;
    return !(bc && bc['@id'] === url + '#breadcrumb' && Array.isArray(items) && items.length === 2
      && items[0].position === 1 && items[0].name === 'Home' && items[0].item === ORIGIN + '/'
      && items[1].position === 2 && items[1].name && items[1].item === url);
  });
  check('each indexable page\'s graph has its page node (right @type, name = title, description = meta, inLanguage en, isPartOf the site) and a Home → page breadcrumb', !b.length, b.join(','));
  b = files.filter(isIndexable).filter((f) => f !== 'index.html' && f !== 'whitepaper.html').filter((f) => {
    const pg = nodesOf(parsed[f][0] || {}).find((n) => n['@type'] === PAGE_TYPE[f] || n['@type'] === 'WebPage');
    return !(pg && pg['@id'] === urlOf(f) + '#webpage' && pg.url === urlOf(f) && pg.breadcrumb && pg.breadcrumb['@id'] === urlOf(f) + '#breadcrumb');
  });
  check('  ...and the page node carries @id URL#webpage, url and a link to the breadcrumb', !b.length, b.join(','));

  const home = nodesOf(parsed['index.html'][0] || {});
  const types = (nodes) => nodes.flatMap((n) => [].concat(n['@type']));
  check('the home page has no FAQPage (its questions are not on the page)', !types(home).includes('FAQPage') && !/FAQPage/.test(heads['index.html'].s));
  const org = home.find((n) => n['@type'] === 'Organization');
  check('  ...its Organization.sameAs is exactly the site\'s own X account', !!org && JSON.stringify(org.sameAs) === JSON.stringify(['https://x.com/sendrh_']), org && JSON.stringify(org.sameAs));
  const app = home.find((n) => n['@type'] === 'WebApplication');
  check('  ...and its WebApplication makes no price offer', !app || !('offers' in app));
  check('  ...and it names the WebSite and the Organization the other pages point at', home.some((n) => n['@type'] === 'WebSite' && n['@id'] === ORIGIN + '/#website') && !!org && org['@id'] === ORIGIN + '/#organization');

  /* about.html's FAQPage mirrors the visible FAQ: every question, in order, with the same answer text. */
  const A = heads['about.html'].s;
  const faqAt = A.indexOf('<div class="faq">'), faqEnd = A.indexOf('</section>', faqAt);
  const visible = faqAt < 0 ? [] : [...A.slice(faqAt, faqEnd).matchAll(/<details class="reassure"><summary>([\s\S]*?)<\/summary><div class="reassure-body">([\s\S]*?)<\/div><\/details>/g)]
    .map((m) => ({ q: textOf(m[1]), a: textOf(m[2]) }));
  const faq = nodesOf(parsed['about.html'][0] || {}).find((n) => n['@type'] === 'FAQPage');
  const ldQ = faq && Array.isArray(faq.mainEntity) ? faq.mainEntity.map((q) => ({ q: q.name, a: String(q.acceptedAnswer && q.acceptedAnswer.text || '').replace(/\s+/g, ' ').trim() })) : [];
  check('about.html\'s FAQPage questions equal the visible FAQ summaries, all of them, in order', visible.length >= 5 && JSON.stringify(ldQ.map((x) => x.q)) === JSON.stringify(visible.map((x) => x.q)),
    visible.length + ' visible / ' + ldQ.length + ' in JSON-LD');
  const wrongA = visible.filter((v, i) => !ldQ[i] || ldQ[i].a !== v.a).map((v) => v.q);
  check('  ...and each answer is the visible answer\'s text', visible.length > 0 && !wrongA.length, wrongA.join(' | '));
  check('  ...and every entry is a Question with an Answer', !!faq && faq.mainEntity.every((q) => q['@type'] === 'Question' && q.acceptedAnswer && q.acceptedAnswer['@type'] === 'Answer'));

  /* ═══ the static sitemap and robots.txt ═══ */
  const SM = read('sitemap-pages.xml');
  const locs = [...SM.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const want = files.filter(isIndexable).map(urlOf);
  check('sitemap-pages.xml lists exactly the indexable static pages, once each', locs.length === want.length && new Set(locs).size === locs.length && want.every((u) => locs.includes(u)),
    'extra: ' + locs.filter((u) => !want.includes(u)).join(',') + ' missing: ' + want.filter((u) => !locs.includes(u)).join(','));
  check('  ...and it is a sitemaps.org urlset', /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(SM) && /<\/urlset>\s*$/.test(SM));
  const RB = read('robots.txt');
  const pagePath = (f) => f === 'index.html' ? '/' : '/' + f;
  b = files.filter(isIndexable).filter((f) => !robotsAllows(RB, pagePath(f)));
  check('robots.txt disallows none of the indexable pages', !b.length, b.join(','));
  b = files.filter((f) => !isIndexable(f)).filter((f) => !robotsAllows(RB, pagePath(f)));
  check('robots.txt disallows none of the noindex pages (a blocked page\'s noindex is never read)', !b.length, b.join(','));
  check('  ...nor a wall, a community, or the sitemaps', ['/u/someone', '/community.html?id=1', '/sitemap.xml', '/sitemap-pages.xml'].every((p) => robotsAllows(RB, p)));
  check('  ...but it still keeps crawlers out of /api/ reads for an address the caller picks', !robotsAllows(RB, '/api/scan?address=0x1') && !robotsAllows(RB, '/api/me') && !robotsAllows(RB, '/api/chain/wallet'));
  check('robots.txt points at the sitemap index on the placeholder origin', /^Sitemap: https:\/\/sendrh\.com\/sitemap\.xml$/m.test(RB));

  /* ═══ the two templates the server fills ═══ */
  b = ['u.html', 'community.html'].filter((f) => {
    const h = heads[f].head, a = h.indexOf('<!--seo-->'), z = h.indexOf('<!--/seo-->');
    return !(a > 0 && z > a && h.split('<!--seo-->').length === 2 && h.split('<!--/seo-->').length === 2 && h.indexOf('<title>') > a && h.indexOf('<title>') < z
      && h.indexOf('name="robots"') > a && h.indexOf('name="robots"') < z);
  });
  check('u.html and community.html carry one <!--seo--> … <!--/seo--> block holding their title and robots', !b.length, b.join(','));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
