/* A signed-out visitor's page loads without a red line in the console. Every page asks /api/me as it loads;
   with no session cookie at all the answer is { user: null } (200), so nothing prints "Failed to load
   resource: 401" on every page for every visitor. A session cookie that no longer names a session still
   answers 401: that is how a page learns it was signed out elsewhere, and it must keep learning it. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';
const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const get = async (p, cookie) => { const r = await fetch(BASE + p, { headers: cookie ? { cookie } : {} }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {} return { status: r.status, j, cc: r.headers.get('cache-control') || '' }; };

const anon = await get('/api/me');
check('no session cookie: /api/me answers 200 with user null', anon.status === 200 && anon.j && anon.j.user === null, anon.status + ' ' + JSON.stringify(anon.j));
check('  ...and is not cached', /no-store/.test(anon.cc), anon.cc);
const other = await get('/api/me', 'theme=dark; jsi_age=18');
check('other cookies but no sid: still a plain signed-out answer', other.status === 200 && other.j && other.j.user === null, other.status);
const dead = await get('/api/me', 'sid=' + 'f'.repeat(64));
check('a session cookie that names no session: 401, so an open page signs itself out', dead.status === 401, dead.status);
const AUTHJS = readFileSync(path.join(ROOT, 'public', 'auth.js'), 'utf8');
check('auth.js treats { user: null } as a definite sign-out, like a 401', /AUTH\.user = AUTH\._normMe\(\(await api\('\/api\/me'\)\)\.user\) \|\| null; lastMeStatus = AUTH\.user \? 200 : 401;/.test(AUTHJS));
const DATAJS = readFileSync(path.join(ROOT, 'public', 'data.js'), 'utf8');
check('data.js does not ask for eligibility when the visitor is definitely signed out (and still asks when /api/me merely failed)', /if \(window\.AUTH && AUTH\.ready\) \{ try \{ await AUTH\.ready; \} catch \{\} if \(AUTH\.signedOut\) \{ card\.innerHTML = SIGN_IN_NOTE; return; \} \}/.test(DATAJS));
check('auth.js says signed out only on a definite answer (a 401, or { user: null })', /AUTH\.signedOut = lastMeStatus === 401;/.test(AUTHJS));

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
