'use strict';
/* ===== Page routes: sendrh.com/about, not sendrh.com/about.html =========================================
   Owner, 2026-10-15: "Fix all the domain page routes so they just say their name in the website domain so its
   sendrh.com/about not sendrh.com/about.html ... make sure every page is just their name and not the . file name or
   a # [symbol] in front of it but make sure all functionality and page routes still work as they currently do".

   One table, used by the server (what a path serves or where it redirects) and by scripts/check.mjs (which links on
   the site resolve), so the check passes exactly the links the server answers.
   - Every page is /<name> (public/<name>.html on disk; the files keep their names). The home page is /.
   - The home page's sections are addresses of their own: /guide (how to buy), /swap, /tokens, /beta. They serve the
     home page, which scrolls to the section; its canonical stays /.
   - Every old form redirects (301) to the clean one in a single hop, its query kept: /about.html, /About, /about/,
     /index, /index.html, /community.html?id=5 → /community?id=5. The part after # is the browser's and survives the
     redirect, so an old /profile.html#sec-account still lands on the Account card.
   - Never a page at a nested or slash-ended path: every page links its styles and scripts relatively, and at /about/
     those would resolve to /about/styles.css. Those paths redirect instead.
   - u.html is the template for /u/<name> and admin.html is behind the admin gate (server.js): neither is a page here. */
const fs = require('fs');
const path = require('path');

const HOME_SECTIONS = ['guide', 'swap', 'tokens', 'beta'];
// never a page name: real paths of their own (/u/<name>, /p/<id>, /t/<n>, /uploads, /assets, /fonts, /api)
const RESERVED = new Set(['u', 'p', 't', 'uploads', 'assets', 'fonts', 'api', 'admin']);

function pageNames(publicDir) {
  return new Set(fs.readdirSync(publicDir).filter((f) => /^[a-z0-9-]+\.html$/.test(f)).map((f) => f.slice(0, -5))
    .filter((n) => !RESERVED.has(n)));
}

/* What a request path is. `pages` = pageNames(); `p` = the URL's pathname, not decoded (as the server sees it).
   Returns { page: name } to serve public/<name>.html (name 'index' is the home page, at /),
   { section: name } to serve the home page at a section's own path, { redirect: '/clean' } (the caller adds the
   query), or null when it is not a page path at all (an asset, an API, an unknown name: the caller's business). */
function resolve(pages, p) {
  // normalise the way the static fallback does: resolve dot segments, drop the trailing separators, lower-case the name
  const norm = path.posix.normalize('/' + String(p || '/')).replace(/\/+$/, '') || '/';
  if (norm === '/') return p === '/' ? { page: 'index' } : { redirect: '/' };
  const m = /^\/([A-Za-z0-9-]+)(\.html)?$/i.exec(norm);   // /ABOUT.HTML too
  if (!m) return null;
  const name = m[1].toLowerCase();
  if (name === 'index') return { redirect: '/' };
  const want = '/' + name;
  if (HOME_SECTIONS.includes(name) && !m[2]) return p === want ? { section: name } : { redirect: want };
  if (!pages.has(name)) return null;
  return p === want ? { page: name } : { redirect: want };
}

// the clean address for a page file name ('about.html' → '/about', 'index.html' → '/')
const cleanPath = (file) => (file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, ''));

module.exports = { HOME_SECTIONS, RESERVED, pageNames, resolve, cleanPath };
