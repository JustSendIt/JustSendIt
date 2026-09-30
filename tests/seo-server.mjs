/* What a search engine is handed, checked against what the pages and the database actually hold.

   robots.txt lets crawlers fetch the public JSON the pages render from and nothing personal; every /api/ answer says
   noindex; a Send Wall and a community are served with a head built from the database — or a real 404 — and the
   robots meta, the JSON-LD and the sitemaps all use one predicate each, so they can never disagree. Throwaway rows
   only: every user, post, follow and community made here is deleted in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const SRC = readFileSync(SERVER_JS, 'utf8');
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = { users: [], comms: [] };
const tag = randomBytes(3).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const get = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { method: opts.method || 'GET', redirect: 'manual', headers: opts.headers || {} });
  const text = opts.method === 'HEAD' ? await r.text().catch(() => '') : await r.text();
  return { status: r.status, h: (k) => r.headers.get(k) || '', text, location: r.headers.get('location') };
};
const headOf = (html) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unesc = (s) => s == null ? s : s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const metaN = (h, n) => unesc((new RegExp('<meta name="' + reEsc(n) + '" content="([^"]*)">').exec(h) || [])[1]);
const metaP = (h, n) => unesc((new RegExp('<meta property="' + reEsc(n) + '" content="([^"]*)">').exec(h) || [])[1]);
const titleOf = (h) => unesc((/<title>([^<]*)<\/title>/.exec(h) || [])[1]);
const canonOf = (h) => (/<link rel="canonical" href="([^"]*)">/.exec(h) || [])[1];
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const cp = (s) => Array.from(String(s || '')).length;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sinceOf = (ms) => MON[new Date(ms).getUTCMonth()] + ' ' + new Date(ms).getUTCFullYear();
const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1';
const CSS = read('styles.css');
const BRAND = (/--green-bright:\s*(#[0-9a-fA-F]{6})/.exec(CSS) || [])[1];
const INK = (/--ink:\s*(#[0-9a-fA-F]{6})/.exec(CSS) || [])[1];
const LIVE_THRESHOLD = Number((/const LIVE_THRESHOLD = (\d+);/.exec(SRC) || [])[1]);

/* Google's robots.txt matching: the longest matching rule wins, Allow wins a tie; `*` is any run, `$` ends the URL. */
function robotsAllows(txt, url) {
  let best = null;
  for (const line of txt.split('\n')) {
    const m = /^(Allow|Disallow):\s*(\S*)\s*$/i.exec(line.trim());
    if (!m || !m[2]) continue;
    const pat = m[2], anchored = pat.endsWith('$'), body = anchored ? pat.slice(0, -1) : pat;
    const re = new RegExp('^' + body.split('*').map(reEsc).join('.*') + (anchored ? '$' : ''));
    const allow = /^allow$/i.test(m[1]);
    if (re.test(url) && (!best || pat.length > best.pat.length || (pat.length === best.pat.length && allow))) best = { pat, allow };
  }
  return !best || best.allow;
}

function mkUser(name, o = {}) {
  const id = Number(db.prepare('INSERT INTO users (username, created_at, avatar, bio, auto_named) VALUES (?,?,?,?,?)')
    .run(name, o.created_at || Date.now(), '🧪', o.bio || '', o.auto_named ? 1 : 0).lastInsertRowid);
  made.users.push(id);
  return id;
}
function mkPost(uid, o = {}) {
  return Number(db.prepare('INSERT INTO posts (user_id, text, created_at, community_id, private, squad_id, board) VALUES (?,?,?,?,?,?,?)')
    .run(uid, o.text || 'seo test post', o.created_at || Date.now(), o.community_id ?? null, o.private ? 1 : 0, o.squad_id ?? null, o.board ?? null).lastInsertRowid);
}
function mkComm(creator, o) {
  const addr = '0x' + randomBytes(20).toString('hex');
  const id = Number(db.prepare('INSERT INTO communities (creator_id, token_addr, pair_addr, symbol, name, status, demo, official, created_at, went_live_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(creator, addr, addr, o.symbol, o.name, o.status, o.demo ? 1 : 0, 0, o.created_at || Date.now(), o.went_live_at ?? null).lastInsertRowid);
  made.comms.push(id);
  return id;
}

try {
  /* ═══ 1. robots.txt: open the JSON pages render from, nothing personal, and no Disallow over a noindex ═══ */
  const robots = await get('/robots.txt');
  const R = robots.text;
  check('robots.txt is served, with one group for every crawler', robots.status === 200 && (R.match(/^User-agent:/gim) || []).length === 1 && /^User-agent: \*$/m.test(R), robots.status);
  check('  ...and names the sitemap at this origin', new RegExp('^Sitemap: ' + reEsc(BASE) + '/sitemap\\.xml$', 'm').test(R), (R.match(/^Sitemap:.*$/m) || [])[0]);
  const noindexPages = ['/profile.html', '/watchlist.html', '/gate.html', '/terms.html', '/admin.html', '/data.html', '/squad.html'];
  const blocked = noindexPages.filter((u) => !robotsAllows(R, u));
  check('no page that carries its own noindex is disallowed (a blocked crawler never reads the noindex)', blocked.length === 0, blocked.join(' '));
  const pageCalls = ['/api/config', '/api/og/campaign', '/api/beta', '/api/chain/pairs', '/api/posts', '/api/posts?sort=new', '/api/posts?board=support',
    '/api/posts?user=someone', '/api/posts/1/comments', '/api/users/someone', '/api/pins?user=someone', '/api/calls?user=someone', '/api/calls/leaderboard?window=all',
    '/api/calls/live?ids=1,2', '/api/communities', '/api/communities?status=live&sort=active', '/api/communities/weekly', '/api/communities/1',
    '/api/communities/1/members', '/api/communities/1/posts?wall=public', '/api/communities/1/proposals', '/api/competitions', '/api/scan/recent'];
  const shut = pageCalls.filter((u) => !robotsAllows(R, u));
  check('every public read a signed-out page makes while it renders is crawlable', shut.length === 0, shut.join(' '));
  const privateOrCostly = ['/api/me', '/api/presence?pid=x', '/api/gate/state', '/api/notifications', '/api/watchlist/ids', '/api/admin/reports',
    '/api/img?u=https%3A%2F%2Fcdn.dexscreener.com%2Fx.png', '/api/brand/0x' + '1'.repeat(40) + '/logo', '/api/pins/holding?user=x&token=0x1', '/api/pins/ids',
    '/api/pairs/lookup?token=0x1', '/api/pairs/contract?token=0x1', '/api/scan?address=0x1', '/api/token/snipers?token=0x1', '/api/chart?pair=0x1&token=0x2',
    '/api/price?pair=0x1&token=0x2', '/api/spot?pairs=x', '/api/chain/wallet?address=0x1', '/api/chain/pairs?x=1', '/api/chain/dex-tokens?addrs=0x1', '/api/squads',
    '/api/search?q=x', '/api/data/eligibility', '/api/sendy/ask', '/api/auth/google', '/api/competition'];
  const open = privateOrCostly.filter((u) => robotsAllows(R, u));
  check('  ...while personal, write-only and caller-chosen chain reads stay disallowed', open.length === 0, open.join(' '));
  check('  ...and the ticket card and the pages themselves are not blocked', robotsAllows(R, '/t/12.png') && robotsAllows(R, '/t/12') && robotsAllows(R, '/') && robotsAllows(R, '/u/someone') && robotsAllows(R, '/community.html?id=1'));

  // the JSON behind those Allow lines really is public (read before this suite makes a community, so no refresh is spent on a fake token)
  const anonOk = [];
  for (const u of ['/api/config', '/api/og/campaign', '/api/beta', '/api/posts', '/api/posts?board=support', '/api/communities', '/api/communities/weekly', '/api/competitions', '/api/scan/recent', '/api/calls/leaderboard?window=all']) {
    const r = await get(u);
    anonOk.push([u, r.status, r.h('x-robots-tag')]);
  }
  const notOk = anonOk.filter(([, s]) => s !== 200);
  check('each allowed read answers a signed-out visitor with 200', notOk.length === 0, notOk.map((x) => x.join(' ')).join(' | '));

  /* ═══ 2. every /api/ answer says noindex ═══ */
  const noTag = anonOk.filter(([, , t]) => !/noindex/.test(t));
  check('X-Robots-Tag: noindex on every /api/ JSON answer', noTag.length === 0, noTag.map((x) => x[0]).join(' '));
  const missing = await get('/api/users/__seo_nobody_' + tag), unknownRoute = await get('/api/no-such-route-' + tag), health = await get('/api/health');
  check('  ...errors included (a 404 profile, an unknown route) and the health probe', /noindex/.test(missing.h('x-robots-tag')) && missing.status === 404 && /noindex/.test(unknownRoute.h('x-robots-tag')) && /noindex/.test(health.h('x-robots-tag')),
    missing.status + ' ' + missing.h('x-robots-tag') + ' / ' + unknownRoute.h('x-robots-tag') + ' / ' + health.h('x-robots-tag'));
  check('  ...and the proxied images and the hand-written feeds carry it too: it is set once for the whole /api/ tree', /if \(p\.startsWith\('\/api\/'\)\) res\.setHeader\('X-Robots-Tag', 'noindex'\);/.test(SRC));

  /* the boot seeders make the site's own account (and, when the network allows, the sandbox) a moment after the
     server comes up — wait for them rather than race them */
  let sys = null, demo = null;
  for (let i = 0; i < 40 && !(sys && demo); i++) {
    sys = db.prepare('SELECT id, username FROM users WHERE system = 1 ORDER BY id LIMIT 1').get() || null;
    demo = db.prepare('SELECT id, name, symbol FROM communities WHERE demo = 1 ORDER BY id LIMIT 1').get() || null;
    if (!(sys && demo)) await sleep(500);
  }

  /* ═══ 3. a Send Wall ═══ */
  const joined = Date.UTC(2026, 8, 18, 12);
  const name = 'SeoWall_' + tag;
  const uid = mkUser(name, { created_at: joined });
  const t1 = Date.now() - 60000, t2 = Date.now() - 30000;
  mkPost(uid, { created_at: t1 });
  const lastWall = mkPost(uid, { created_at: t2 }) && t2;
  const fan = mkUser('SeoFan_' + tag);
  db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(fan, uid, Date.now());

  const cs = mkComm(uid, { symbol: 'SEOT', name: 'Seo Test Token', status: 'live', went_live_at: Date.now() - 1000 });
  mkPost(uid, { community_id: cs, private: 1, text: 'holders only — never counted in public' });   // not in the Posts stat
  mkPost(uid, { squad_id: 987654321, private: 1, text: 'squad only' });                             // nor this

  const unknown = await get('/u/__seo_nobody_' + tag);
  check('an unknown name is a real 404 (not a 200 "no sender" shell)', unknown.status === 404, unknown.status);
  check('  ...and the 404 page itself says noindex', /<meta name="robots" content="noindex">/.test(unknown.text));
  const lowered = await get('/u/' + name.toLowerCase() + '?from=x');
  check('another casing of the name is a 301 to the account\'s own capitals, query kept', lowered.status === 301 && lowered.location === '/u/' + name + '?from=x', lowered.status + ' ' + lowered.location);
  check('  ...that is never cached (a later re-casing would turn a cached one into a loop)', /no-store/.test(lowered.h('cache-control')), lowered.h('cache-control'));
  const legacy = await get('/u.html?u=' + name + '&x=1');
  check('the old /u.html?u=<name> form is a 301 to /u/<name>', legacy.status === 301 && legacy.location === '/u/' + name + '?x=1', legacy.status + ' ' + legacy.location);
  const bare = await get('/u.html');
  check('  ...and the bare template is a 404, not a page of its own', bare.status === 404, bare.status);

  const wall = await get('/u/' + name);
  const H = headOf(wall.text);
  const url = BASE + '/u/' + name;
  check('a wall with a public post is served 200', wall.status === 200, wall.status);
  check('  ...titled "@name — Send Wall Profile on $Send"', titleOf(H) === '@' + name + ' — Send Wall Profile on $Send', titleOf(H));
  check('  ...indexable', metaN(H, 'robots') === INDEX, metaN(H, 'robots'));
  check('  ...with its own canonical and og:url, in the stored capitals', canonOf(H) === url && metaP(H, 'og:url') === url, canonOf(H) + ' ' + metaP(H, 'og:url'));
  const desc = metaN(H, 'description');
  check('  ...a description with the wall\'s own figures: the public Posts count (holders-only and squad posts left out) and "sending since"',
    desc && desc.includes('2 posts') && desc.includes('sending since ' + sinceOf(joined)) && desc.startsWith('@' + name + ' on $Send: ') && desc.endsWith('Entertainment only.'), desc);
  check('  ...at most 160 characters, no longer than the title limit either', cp(desc) <= 160 && cp(titleOf(H)) <= 60, cp(desc) + ' / ' + cp(titleOf(H)));
  check('  ...og:type profile, the site card, and twitter tags that mirror og', metaP(H, 'og:type') === 'profile' && /\/assets\/logo-og\.png$/.test(metaP(H, 'og:image') || '')
    && metaN(H, 'twitter:title') === metaP(H, 'og:title') && metaN(H, 'twitter:description') === metaP(H, 'og:description') && metaP(H, 'og:image:width') === '1200' && metaP(H, 'og:image:height') === '630');
  check('  ...the brand colour and the manifest', metaN(H, 'theme-color') === BRAND && /<link rel="manifest" href="\/site\.webmanifest">/.test(H), metaN(H, 'theme-color') + ' vs ' + BRAND);
  let ld = null; try { ld = JSON.parse(ldOf(H)[0]); } catch {}
  const person = ld && ld.mainEntity;
  check('  ...and ProfilePage JSON-LD that parses', ldOf(H).length === 1 && ld && ld['@type'] === 'ProfilePage' && ld.url === url && person && person['@type'] === 'Person' && person.name === name, ldOf(H)[0] && ldOf(H)[0].slice(0, 160));
  const stat = (arr, t) => ((arr || []).find((x) => x.interactionType === 'https://schema.org/' + t) || {}).userInteractionCount;
  check('  ...whose figures are the wall\'s: 2 posts, 1 follower, 0 following — and nothing the wall does not show', person && stat(person.agentInteractionStatistic, 'WriteAction') === 2
    && stat(person.interactionStatistic, 'FollowAction') === 1 && stat(person.agentInteractionStatistic, 'FollowAction') === 0 && !('sameAs' in person) && !('dateCreated' in (ld || {})) && !JSON.stringify(ld).includes('rank'), JSON.stringify(person));
  check('  ...the name is in the <h1> before any script runs', wall.text.includes('<span id="pub-username">' + name + '</span>'));
  check('  ...and the rest of the page is the real wall', wall.text.includes('<script src="/upage.js"></script>') || /<script src="\/upage\.js\?v=[^"]+"><\/script>/.test(wall.text));

  // 304 on a repeat, compared weakly (Cloudflare turns a strong ETag weak when it compresses)
  const etag = wall.h('etag');
  const again = await get('/u/' + name, { headers: { 'If-None-Match': etag } });
  const weak = await get('/u/' + name, { headers: { 'If-None-Match': 'W/' + etag } });
  check('a repeat with If-None-Match is a 304 (also for the weak form of the same tag)', !!etag && again.status === 304 && weak.status === 304 && again.text === '', etag + ' ' + again.status + ' ' + weak.status);
  const headReq = await get('/u/' + name, { method: 'HEAD' });
  check('  ...and HEAD answers 200 with no body', headReq.status === 200 && headReq.text === '' && headReq.h('etag') === etag, headReq.status);

  // a bio full of markup, quotes and a right-to-left override
  const evilName = 'SeoEvil_' + tag;
  const evil = mkUser(evilName, { bio: 'hi <script>alert(1)</script> "dq" \'sq\' ‮evil​ end' });
  mkPost(evil);
  const ev = await get('/u/' + evilName);
  const EH = headOf(ev.text);
  check('a bio with <script>, quotes and a bidi override is escaped in the head', ev.status === 200 && !/<script>alert/.test(ev.text) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(EH) && /&quot;dq&quot;/.test(EH) && /&#39;sq&#39;/.test(EH), ev.status);
  check('  ...the override and the zero-width space are gone', !EH.includes('‮') && !EH.includes('​'));
  let eld = null; try { eld = JSON.parse(ldOf(EH)[0]); } catch {}
  check('  ...and the JSON-LD cannot close its own script: no raw < in it, and it still parses to the bio', ldOf(EH).length === 1 && !/</.test(ldOf(EH)[0]) && eld && eld.mainEntity && /<script>alert\(1\)<\/script>/.test(eld.mainEntity.description) && !/‮/.test(eld.mainEntity.description),
    eld && eld.mainEntity && eld.mainEntity.description);

  // walls that are not indexed: nothing public posted, an auto-made name, the site's own account
  const quiet = 'SeoQuiet_' + tag, quietId = mkUser(quiet);
  mkPost(quietId, { community_id: cs, private: 1 });                 // only a holders-only post
  const auto = 'sender_' + tag, autoId = mkUser(auto, { auto_named: true });
  mkPost(autoId);
  for (const [who, label] of [[quiet, 'a wall with no public post'], [auto, 'an auto-made sender_ name'], ...(sys ? [[sys.username, 'the site\'s own account']] : [])]) {
    const r = await get('/u/' + encodeURIComponent(who));
    const h = headOf(r.text);
    check(label + ' is served noindex, with no canonical and no JSON-LD', r.status === 200 && metaN(h, 'robots') === 'noindex, follow' && !canonOf(h) && !metaP(h, 'og:url') && ldOf(h).length === 0, r.status + ' ' + metaN(h, 'robots'));
  }
  if (!sys) check('the site\'s own account exists by now (the boot seeder makes it)', false, 'no system account after waiting');

  // an erased account: its old name is gone, but its tombstone stays a page (its Send Calls survive and are linked),
  // served noindex with no canonical or JSON-LD even though it still has a public post
  const gone = 'SeoGone_' + tag, goneId = mkUser(gone);
  mkPost(goneId);
  db.prepare('UPDATE users SET username = ?, deleted_at = ? WHERE id = ?').run('deleted-' + goneId, Date.now(), goneId);
  const g1 = await get('/u/deleted-' + goneId), g2 = await get('/u/' + gone);
  const GH = headOf(g1.text);
  check('an erased account: its old name is a 404, its tombstone a noindex page with no canonical or JSON-LD',
    g2.status === 404 && g1.status === 200 && metaN(GH, 'robots') === 'noindex, follow' && !canonOf(GH) && ldOf(GH).length === 0, g1.status + ' ' + g2.status + ' ' + metaN(GH, 'robots'));

  // a video avatar is not a picture of the person: it never becomes Person.image (a still one does)
  const vid = 'SeoVid_' + tag, vidId = mkUser(vid); mkPost(vidId);
  const png = 'SeoPng_' + tag, pngId = mkUser(png); mkPost(pngId);
  db.prepare('UPDATE users SET avatar_img = ? WHERE id = ?').run(randomBytes(12).toString('hex') + '.mp4', vidId);
  db.prepare('UPDATE users SET avatar_img = ? WHERE id = ?').run(randomBytes(12).toString('hex') + '.png', pngId);
  const personOf = async (n) => { try { return JSON.parse(ldOf(headOf((await get('/u/' + n)).text))[0]).mainEntity; } catch { return null; } };
  const pv = await personOf(vid), pp = await personOf(png);
  check('a video avatar is left out of Person.image, a still avatar is kept', pv && !('image' in pv) && pp && /\/uploads\/[0-9a-f]{24}\.png$/.test(pp.image || ''), JSON.stringify([pv && pv.image, pp && pp.image]));

  /* ═══ 4. a community ═══ */
  const cNone = await get('/community.html?id=987654321'), cBad = await get('/community.html?id=abc'), cBare = await get('/community.html');
  check('an unknown community id is a 404, and so is a malformed one', cNone.status === 404 && cBad.status === 404, cNone.status + ' ' + cBad.status);
  check('  ...and the template with no id is a 301 to the list', cBare.status === 301 && cBare.location === '/communities.html', cBare.status + ' ' + cBare.location);
  const live = await get('/community.html?id=' + cs + '&utm_source=x');
  const LH = headOf(live.text), curl = BASE + '/community.html?id=' + cs;
  check('a live community is served 200, indexable, titled "{name} ($SYM) Community — $Send"', live.status === 200 && metaN(LH, 'robots') === INDEX && titleOf(LH) === 'Seo Test Token ($SEOT) Community — $Send', live.status + ' ' + titleOf(LH) + ' ' + metaN(LH, 'robots'));
  check('  ...with the id-only canonical (tracking parameters fold into it) and og:url', canonOf(LH) === curl && metaP(LH, 'og:url') === curl, canonOf(LH));
  const cdesc = metaN(LH, 'description');
  check('  ...a description with no market figure and no member count', cdesc && cp(cdesc) <= 160 && !/\d/.test(cdesc.replace(/SEOT/g, '')) && /Entertainment only\.$/.test(cdesc), cdesc);
  let cld = null; try { cld = JSON.parse(ldOf(LH)[0]); } catch {}
  const graph = (cld && cld['@graph']) || [];
  const page = graph.find((n) => n['@type'] === 'CollectionPage'), crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
  check('  ...and CollectionPage + BreadcrumbList JSON-LD (Home › Communities › the community)', page && page.url === curl && crumbs && crumbs.itemListElement.map((i) => i.name).join(' > ') === 'Home > Communities > Seo Test Token ($SEOT)'
    && crumbs.itemListElement[1].item === BASE + '/communities.html' && crumbs.itemListElement[2].item === curl, JSON.stringify(crumbs));

  const pend = mkComm(uid, { symbol: 'SEOP', name: 'Seo Pending', status: 'pending' });
  const pr = await get('/community.html?id=' + pend), PH = headOf(pr.text);
  check('a community that is not live yet keeps its title but is noindex, with no canonical or JSON-LD', pr.status === 200 && titleOf(PH) === 'Seo Pending ($SEOP) Community — $Send' && metaN(PH, 'robots') === 'noindex, follow' && !canonOf(PH) && ldOf(PH).length === 0, titleOf(PH) + ' ' + metaN(PH, 'robots'));
  check('  ...and says it goes live at ' + LIVE_THRESHOLD + ' verified holder slots, the server\'s own number', (metaN(PH, 'description') || '').includes(LIVE_THRESHOLD + ' verified holder slots'), metaN(PH, 'description'));

  const longName = 'An Extremely Long Token Name <b>"Bold"</b> ‮ That Goes On And On';
  const longC = mkComm(uid, { symbol: 'LONGSYMBOL123456', name: longName, status: 'live', went_live_at: Date.now() });
  const lr = await get('/community.html?id=' + longC), LRH = headOf(lr.text);
  check('a long community name is cut so the title stays within 60 characters, markup escaped', cp(titleOf(LRH)) <= 60 && /…/.test(titleOf(LRH)) && /\(\$LONGSYMBOL123456\) Community — \$Send$/.test(titleOf(LRH)) && !/<b>/.test(LRH) && !LRH.includes('‮'), titleOf(LRH) + ' (' + cp(titleOf(LRH)) + ')');

  if (!demo) {   // the network did not let the boot seeder make the sandbox: stand one in
    const id = mkComm(uid, { symbol: 'DEMO', name: 'Seo Sandbox Co', status: 'live', demo: true });
    demo = { id, name: 'Seo Sandbox Co', symbol: 'DEMO' };
  }
  const sb = await get('/community.html?id=' + demo.id), SH = headOf(sb.text);
  check('the open sandbox is "Open Sandbox Community — $Send", noindex, with no canonical and no JSON-LD', sb.status === 200 && titleOf(SH) === 'Open Sandbox Community — $Send' && metaN(SH, 'robots') === 'noindex, follow' && !canonOf(SH) && ldOf(SH).length === 0, titleOf(SH) + ' ' + metaN(SH, 'robots'));
  check('  ...and its head never carries the company name or ticker it is branded with', !SH.includes(demo.name) && !SH.includes('$' + demo.symbol), demo.name);

  /* ═══ 5. sitemaps ═══ */
  const idx = await get('/sitemap.xml');
  const locs = (x) => [...x.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => unesc(m[1]));
  check('/sitemap.xml is a sitemap index served as XML', idx.status === 200 && /^application\/xml/.test(idx.h('content-type')) && /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(idx.text), idx.status + ' ' + idx.h('content-type'));
  check('  ...listing the static pages, the communities and the profiles', ['/sitemap-pages.xml', '/sitemap-communities.xml', '/sitemap-profiles.xml'].every((k) => locs(idx.text).includes(BASE + k)), locs(idx.text).join(' '));
  const again304 = await get('/sitemap.xml', { headers: { 'If-None-Match': idx.h('etag') } });
  check('  ...and answers a repeat with a 304', !!idx.h('etag') && again304.status === 304, idx.h('etag') + ' ' + again304.status);

  const pagesMap = await get('/sitemap-pages.xml');
  const want = ['/', '/about.html', '/wall.html', '/communities.html', '/newpairs.html', '/support.html', '/tracker.html', '/arcade.html', '/whitepaper.html', '/privacy.html'].map((p) => BASE + p);
  check('the static pages sitemap lists exactly the ten indexable pages, with no invented lastmod or priority', pagesMap.status === 200 && JSON.stringify(locs(pagesMap.text).sort()) === JSON.stringify(want.slice().sort()) && !/<lastmod>|<priority>|<changefreq>/.test(pagesMap.text), locs(pagesMap.text).join(' '));
  check('  ...and public/sitemap.xml is gone (the index is built by the server)', !existsSync(path.join(PUB, 'sitemap.xml')));

  const prof = await get('/sitemap-profiles.xml'), pl = locs(prof.text);
  check('the profiles sitemap lists the indexable wall, with its latest public post as lastmod', prof.status === 200 && pl.includes(url) && new RegExp('<loc>' + reEsc(url) + '</loc><lastmod>' + reEsc(new Date(lastWall).toISOString().replace(/\.\d{3}Z$/, 'Z')) + '</lastmod>').test(prof.text), prof.status);
  check('  ...and none of the walls that are noindex (no public post, auto-named, the site account, erased)', ![quiet, auto, ...(sys ? [sys.username] : []), gone, 'deleted-' + goneId].some((n) => pl.includes(BASE + '/u/' + encodeURIComponent(n))));
  const wrongP = pl.filter((l) => {
    const n = decodeURIComponent(l.slice((BASE + '/u/').length));
    const u = db.prepare('SELECT id, system, deleted_at, auto_named FROM users WHERE username = ?').get(n);
    const wallN = u ? db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id = ? AND community_id IS NULL AND squad_id IS NULL AND board IS NULL AND private = 0').get(u.id).n : 0;
    return !u || u.system || u.deleted_at || u.auto_named || !wallN;
  });
  check('  ...every wall it lists qualifies (same predicate as the robots meta)', wrongP.length === 0, wrongP.join(' '));
  const comm = await get('/sitemap-communities.xml'), cl = locs(comm.text);
  check('the communities sitemap lists the live community', comm.status === 200 && cl.includes(curl), comm.status);
  const liveIds = db.prepare("SELECT id FROM communities WHERE status = 'live' AND demo = 0").all().map((r) => BASE + '/community.html?id=' + r.id).sort();
  check('  ...and exactly the live, non-sandbox ones: no pending community, no sandbox', JSON.stringify(cl.slice().sort()) === JSON.stringify(liveIds) && !cl.includes(BASE + '/community.html?id=' + pend) && !cl.includes(BASE + '/community.html?id=' + demo.id), cl.join(' '));
  check('  ...no squad, ticket, scanner or fragment URL anywhere in them', ![...pl, ...cl, ...locs(pagesMap.text)].some((l) => /squad|\/t\/|scan=|#/.test(l)));

  /* ═══ 6. one address per page ═══ */
  const ih = await get('/index.html'), iq = await get('/index.html?ref=abc'), cap = await get('/About.html?x=1');
  check('/index.html is a 301 to /, query kept', ih.status === 301 && ih.location === '/' && iq.status === 301 && iq.location === '/?ref=abc', ih.status + ' ' + ih.location + ' / ' + iq.location);
  check('a page asked for in capitals is a 301 to its lowercase name', cap.status === 301 && cap.location === '/about.html?x=1', cap.status + ' ' + cap.location);

  /* ═══ 7. the ticket page, the 404, the icon, the fonts, the manifest ═══ */
  db.prepare('UPDATE users SET ticket_public = 1 WHERE id = ?').run(uid);
  const tk = await get('/t/' + uid), TH = headOf(tk.text);
  check('a shared ticket page is noindex, follow', tk.status === 200 && metaN(TH, 'robots') === 'noindex, follow', tk.status + ' ' + metaN(TH, 'robots'));
  check('  ...and keeps every tag its unfurl needs', new RegExp('property="og:image" content="[^"]*/t/' + uid + '\\.png"').test(TH) && metaN(TH, 'twitter:card') === 'summary_large_image' && !!metaP(TH, 'og:title') && !!metaN(TH, 'twitter:title') && !canonOf(TH));
  const fav = await get('/favicon.ico');
  check('/favicon.ico is the site icon as a PNG, cacheable', fav.status === 200 && fav.h('content-type') === 'image/png' && /max-age=\d+/.test(fav.h('cache-control')) && !/no-cache/.test(fav.h('cache-control')), fav.status + ' ' + fav.h('content-type') + ' ' + fav.h('cache-control'));
  const fontCss = read('fonts/fonts.css');
  const font = (/url\(([^)]+\.woff2)\)/.exec(fontCss) || [])[1];
  const fr = font ? await get('/fonts/' + font) : { status: 0, h: () => '' };
  check('a content-hashed font is cached for a year, immutable', fr.status === 200 && /max-age=31536000/.test(fr.h('cache-control')) && /immutable/.test(fr.h('cache-control')), font + ' ' + fr.h('cache-control'));
  const man = await get('/site.webmanifest');
  let mj = null; try { mj = JSON.parse(man.text); } catch {}
  check('/site.webmanifest is served as a manifest and parses', man.status === 200 && /^application\/manifest\+json/.test(man.h('content-type')) && !!mj, man.status + ' ' + man.h('content-type'));
  check('  ...Just Send It / $Send, starting at /, in the browser, in the brand colour on the page background', mj && mj.name === 'Just Send It' && mj.short_name === '$Send' && mj.start_url === '/' && mj.display === 'browser'
    && mj.theme_color === BRAND && mj.background_color === INK, JSON.stringify(mj && { theme: mj.theme_color, bg: mj.background_color, brand: BRAND, ink: INK }));
  const iconsOk = mj && Array.isArray(mj.icons) && mj.icons.length === 3 && mj.icons.every((i) => {
    const f = path.join(PUB, i.src.replace(/^\//, ''));
    if (!existsSync(f) || i.type !== 'image/png') return false;
    const b = readFileSync(f);
    return i.sizes === b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
  });
  check('  ...its icons exist, at the sizes it says', iconsOk, JSON.stringify(mj && mj.icons));
  const home = await get('/');
  const csp = home.h('content-security-policy');
  check('  ...and the page policy lets it load (manifest-src falls back to default-src \'self\')', /default-src 'self'/.test(csp) && (!/manifest-src/.test(csp) || /manifest-src 'self'/.test(csp)), csp);

  /* ═══ 8. the fallbacks on disk fail closed ═══ */
  for (const [f, title] of [['u.html', 'Sender Profile — $Send'], ['community.html', 'Community — $Send']]) {
    const s = read(f), i = s.indexOf('<!--seo-->'), j = s.indexOf('<!--/seo-->'), blk = i >= 0 && j > i ? s.slice(i, j) : '';
    check(f + ' has the <!--seo--> block the server swaps, and what is in it is a noindex fallback titled "' + title + '"', !!blk && titleOf(blk) === title && metaN(blk, 'robots') === 'noindex, follow' && !canonOf(blk) && !/og:url/.test(blk) && ldOf(blk).length === 0 && !/name="keywords"/.test(s), f);
    check('  ...' + f + ' links the manifest, in the brand colour', /<link rel="manifest" href="\/site\.webmanifest">/.test(s) && metaN(blk, 'theme-color') === BRAND && cp(metaN(blk, 'description')) >= 120 && cp(metaN(blk, 'description')) <= 160, cp(metaN(blk, 'description')));
  }
  const ch = read('community.html');
  check('community.html says a community goes live at ' + LIVE_THRESHOLD + ' verified holder slots — LIVE_THRESHOLD, and not members', LIVE_THRESHOLD > 0 && ch.includes('goes live at ' + LIVE_THRESHOLD + ' verified holder slots') && !/live at \d+ members/i.test(ch), LIVE_THRESHOLD);
  check('  ...and that its members are ranked by member level (the list is ORDER BY conviction_xp), not community level', /Ranked by <b>member level<\/b>/.test(ch) && /aria-label="Community members ranked by member level"/.test(ch) && !/ranked by community level/i.test(ch) && /ORDER BY cm\.conviction_xp DESC/.test(SRC));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  for (const id of made.comms) { try { db.prepare('DELETE FROM posts WHERE community_id = ?').run(id); db.prepare('DELETE FROM community_members WHERE community_id = ?').run(id); db.prepare('DELETE FROM communities WHERE id = ?').run(id); } catch {} }
  for (const id of made.users) {
    for (const t of ['posts', 'sessions', 'notifications', 'points_events']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id = ?').run(id); } catch {}
  }
  const leftU = made.users.length ? db.prepare('SELECT COUNT(*) n FROM users WHERE id IN (' + made.users.join(',') + ')').get().n : 0;
  const leftC = made.comms.length ? db.prepare('SELECT COUNT(*) n FROM communities WHERE id IN (' + made.comms.join(',') + ')').get().n : 0;
  console.log('cleanup — throwaway users left:', leftU, '· communities left:', leftC);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
