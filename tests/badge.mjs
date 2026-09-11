/* The badge renderer, pulled out of wall.js and driven directly — the browser pane never ticks, and a real
   post needs a real community, so this checks the markup for each kind of community. */
import { readFileSync } from 'node:fs';
import { ROOT } from './_paths.mjs';
const SRC = readFileSync(ROOT + '/public/wall.js', 'utf8');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m = SRC.match(/const comm = p\.community\n[\s\S]*?\n    : '';/);
if (!m) { console.error('could not extract the badge'); process.exit(1); }
const render = new Function('p', 'esc', 'encodeURIComponent', m[0] + '\nreturn comm;');
const results = []; const check = (n, ok, x) => results.push([n, !!ok, x === undefined ? '' : String(x)]);

const live = render({ community: { id: 1, symbol: 'SEND', name: 'SEND IT', image: 'https://cdn/x.png', status: 'live', demo: false } }, esc, encodeURIComponent);
const pend = render({ community: { id: 2, symbol: 'FOO', name: 'Foo', image: null, status: 'pending', demo: false } }, esc, encodeURIComponent);
const sbx  = render({ community: { id: 3, symbol: 'HOOD', name: 'Robinhood Markets', image: null, status: 'live', demo: true } }, esc, encodeURIComponent);
const none = render({ community: null }, esc, encodeURIComponent);

check('a live token community links to itself', /href="\/community\.html\?id=1"/.test(live));
check('and shows its logo', /post-comm-logo" src="https:\/\/cdn\/x.png"/.test(live));
check('and reads simply "community"', />community<\/span>/.test(live));
check('a pending community says it is not live yet', /not live yet/.test(pend));
check('and falls back to the house icon, never a borrowed logo', /post-comm-logo-none[^>]*>🏘️</.test(pend));

check('the sandbox gets the same badge and link', /post-comm-sandbox/.test(sbx) && /href="\/community\.html\?id=3"/.test(sbx));
check('in its own diamond-blue class, not the token green', /class="post-comm post-comm-sandbox"/.test(sbx));
check('it says anyone can join', /sandbox · anyone can join/.test(sbx));
check('it does NOT claim to be a token community', !/>community</.test(sbx));
check('it uses the flask, not a borrowed brand mark', /🧪/.test(sbx) && !/<img/.test(sbx));
check('a post with no community renders nothing at all', none === '');

const evil = render({ community: { id: 9, symbol: '<img src=x onerror=alert(1)>', name: 'x', image: 'javascript:alert(1)', status: 'live', demo: false } }, esc, encodeURIComponent);
check('a hostile symbol is escaped, not rendered', !/<img src=x/.test(evil) && /&lt;img/.test(evil));
check('the title attribute is escaped too', !/title="Go to the <</.test(evil));

let pass = 0;
for (const [n, ok, x] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  [' + x + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
