/* The Wallet Tracker page shell: tracker.html, trackerpage.js, tracker.css, the two lines profile.html shares with
   it, and the tracker words Sendy says. Checked from the source and, for the wallet list's saved-history fields,
   against the suite's server. The page's pure helpers (the stage words, the ETA words, the clamp that keeps an ETA
   from rising, the one-line progress text, the ?wid=/?lid= resolver) are lifted from trackerpage.js between its two
   markers and run in a vm — the browser pane never ticks, and these need no DOM. Throwaway rows only; deleted in
   the finally block. A server that predates `lastRead` / `lid` is reported as a skip, not a failure. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { ROOT, DB_PATH } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Wallet } = require('ethers');

const PORT = process.argv[2], BASE = 'http://localhost:' + PORT;
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const HTML = read('tracker.html'), JS = read('trackerpage.js'), CSS = read('tracker.css'), PROFILE = read('profile.html'), RESP = read('responsive.css'), SENDY = read('sendy.js');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
let db = null;

const api = async (p, opts = {}) => {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.sid ? { Cookie: 'sid=' + opts.sid } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
/* past the participation gate on purpose (holder_verified_at set): this suite is about the page, not the gate */
function mkUser(name) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state) VALUES (?,?,?,?,?)').run(name, Date.now(), '🧪', Date.now(), 'ok');
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed, sudo_until) VALUES (?,?,?,?,1,?)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5, Date.now() + 3600e3);
  return { id, sid: raw };
}
async function link(sid, w) {
  const addr = w.address.toLowerCase();
  const n = await api('/api/auth/wallet/nonce?purpose=link&address=' + addr, { sid });
  if (!n.j || !n.j.message) return { status: n.status, j: n.j };
  const signature = await w.signMessage(n.j.message);
  return api('/api/auth/wallet/verify', { method: 'POST', sid, body: { address: addr, signature } });
}
/* every control the reader takes for a button carries a data-tip — the same net scripts/check.mjs casts */
function untipped(src) {
  const out = [];
  const s = src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
  for (const m of s.matchAll(/<button\b([^>]*)>/gi)) if (!/\bdata-tip\s*=/.test(m[1])) out.push('button@' + s.slice(0, m.index).split('\n').length);
  for (const m of s.matchAll(/<a\b([^>]*)>/gi)) {
    const cls = (/\bclass\s*=\s*"([^"]*)"/.exec(m[1]) || [])[1] || '';
    if (cls.split(/\s+/).some((t) => t === 'btn' || t.endsWith('-btn')) && !/\bdata-tip\s*=/.test(m[1])) out.push('a@' + s.slice(0, m.index).split('\n').length);
  }
  return out;
}
const order = (src, ...names) => { const at = names.map((n) => src.indexOf(n)); return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]); };

try {
  /* ═══ what the two pages load, in the order the scripts need ═══ */
  check('tracker.html loads tracker.css, then trackerdash.css (the dashboard), then responsive.css last', order(HTML, 'href="tracker.css"', 'href="trackerdash.css"', 'href="responsive.css"'));
  check('  ...and tracker.js, then walletchart.js (the chart), before trackerpage.js', order(HTML, 'src="tracker.js"', 'src="walletchart.js"', 'src="trackerpage.js"'));
  check('profile.html loads trackerdash.css before responsive.css', order(PROFILE, 'href="trackerdash.css"', 'href="responsive.css"'));
  check('  ...and tracker.js, then walletchart.js, before profile.js', order(PROFILE, 'src="tracker.js"', 'src="walletchart.js"', 'src="profile.js"'));
  check('the head is unchanged: the SEO title, one canonical, the breadcrumb', /<title>Robinhood Chain Wallet Tracker: Holdings &amp; PNL — \$Send<\/title>/.test(HTML) && (HTML.match(/<link rel="canonical"/g) || []).length === 1 && /BreadcrumbList/.test(HTML));

  /* ═══ the words ═══ */
  check('the hero says Track, not Follow', /Track any wallet on Robinhood Chain/.test(HTML) && !/Follow any wallet/.test(HTML + PROFILE + SENDY));
  check('  ...and tells the truth about a first read: an hour or more on the public node (measured 2026-09-30), you can leave, it keeps its place and keeps reading, it is saved, a notification, later refreshes read what is new in seconds', /On the public node a wallet's first read can take an hour or more\. You can leave: it keeps its place in line, keeps reading, is saved, and you get a notification when it is ready — or when the node refuses it for so long that it stops; it goes on from where it stopped when you come back\. Later refreshes read only what is new and take seconds\./.test(HTML) && !/first read takes a few minutes/.test(HTML + PROFILE + SENDY + JS));
  check('  ...keeping the inline hero margins (the SEO pass set them)', /<h1 class="section-title display green" style="margin-bottom:0\.35rem;">/.test(HTML) && /<p class="section-sub" style="margin-bottom:0\.5rem;">Track any wallet/.test(HTML));
  const so = HTML.slice(HTML.indexOf('id="trk-signedout"'), HTML.indexOf('id="trk-layout"'));
  check('the signed-out explainer keeps five points and swaps "Instant reopen" for the saved-history truth', (so.match(/<li>/g) || []).length === 5 && !/Instant reopen/.test(so) && /<b>Saved history<\/b> — on the public node a wallet's first read can take an hour or more/.test(so) && /you get a notification when it is ready, and later refreshes read only what is new and take seconds/.test(so));
  check('  ...the address field is live signed out (no disabled), its submit reads "Sign in to track →" with a data-tip, and the note says why sign-in comes first', /<input class="addr-input" id="trk-so-addr"(?![^>]*\bdisabled\b)[^>]*>/.test(so) && /<button class="btn btn-primary trk-so-btn" type="submit" id="trk-so-btn" data-tip="[^"]+">Sign in to track →<\/button>/.test(so) && /Sign in first — reading a wallet spends the site's chain budget/.test(so));
  check('  ...nothing in the page tells anyone to buy, promises safety, or claims an affiliation', !/\b(you should buy|buy now|great investment|guaranteed|risk-free)\b/i.test(HTML) && /Not affiliated with Robinhood Markets, Inc\./.test(HTML));
  check('every control on tracker.html has a data-tip', untipped(HTML).length === 0, untipped(HTML).join(', '));
  check('every control trackerpage.js builds has one too', [...JS.replace(/(^|\s)\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').matchAll(/<button\b([^>]*)>/g)].every((m) => /data-tip=/.test(m[1])) && /btn\.setAttribute\('data-tip', 'Shows or hides what this figure means'\)/.test(JS));

  /* ═══ the progress block ═══ */
  check('the visible progress block is a line, a progressbar and the "you can leave" note; the spoken copy is its own sr-only status region', /<div class="trk-progress" id="trk-progress" hidden>/.test(HTML) && /<p class="trk-prog-line" id="trk-prog-line"><\/p>/.test(HTML) && /<div class="trk-prog-bar" id="trk-prog-bar" role="progressbar" aria-label="Progress of this step" aria-valuemin="0" aria-valuemax="100" hidden>/.test(HTML) && /id="trk-prog-note" hidden>On the public node a first read can take an hour or more\. You can leave this page — the read keeps its place in line, keeps reading, is saved, and you get a notification when it is ready, or when the node refuses it for so long that it stops \(it goes on from where it stopped when you come back\)\.<\/p>/.test(HTML) && /<p class="sr-only" id="trk-prog-live" role="status" aria-live="polite"><\/p>/.test(HTML) && !/id="trk-progress" role="status"/.test(HTML));
  check('  ...the page keeps the step and the stage out of nothing and the percent and ETA out of the spoken diff', /function progressSpoken\(info\)/.test(JS) && /speak\(progressSpoken\(info\)\)/.test(JS) && !/progressSpoken[\s\S]{0,600}etaWords/.test(JS.slice(JS.indexOf('function progressSpoken'), JS.indexOf('function resolveDeepLink'))));
  check('  ...the live region re-speaks on a stage change or every 20 s, never per poll', /text !== liveLast\.text \|\| t - liveLast\.at > 20000/.test(JS));
  check('  ...the ETA is clamped per stage (a new stage starts from null) and queueFull shows the plain copy', /if \(stage !== pg\.stage\) \{ pg\.stage = stage; pg\.etaEnd = null; \}/.test(JS) && /pg\.etaEnd = etaEndAt\(pg\.etaEnd, Date\.now\(\), info\.eta\)/.test(JS) && /const QUEUE_FULL_COPY = 'The chain reader has a long line right now — try again in a while\.';/.test(JS));
  check('  ...the "you can leave" note shows on a first read only (a completed saved history hides it; a partial one or a rebuild keeps it)', /progNote\.hidden = !!info\.queueFull \|\| info\.stage === 'throttled' \|\| !!\(lr && !lr\.partial && !state\.rebuilding\[addr\]\)/.test(JS));

  /* ═══ the pure helpers, lifted and run ═══ */
  const a = JS.indexOf('/* ---- pure helpers'), b = JS.indexOf('/* ---- end pure helpers ---- */');
  const qf = /const QUEUE_FULL_COPY = '[^']+';/.exec(JS);
  check('the helpers sit between the two markers, with no DOM in them', a > 0 && b > a && !!qf && !/document\.|reportEl|state\./.test(JS.slice(a, b)));
  const H = vm.runInNewContext(qf[0] + '\n' + JS.slice(JS.indexOf('\n', a) + 1, b) + '\n({ stageWords, etaWords, etaEndAt, ordinal, retryCopy, progressLine, progressSpoken, resolveDeepLink })', { URLSearchParams });
  const words = {
    'reading every token transfer': 'Reading every token transfer this wallet ever made',
    'reading 41 tokens': 'Reading 41 tokens\' balances',
    'dating 312 blocks': 'Dating 312 blocks',
    'finding markets for 41 tokens': 'Finding markets',
    'reading 57 of its transactions': 'Reading 57 transactions\' receipts',
    'waiting for a turn': 'Waiting for a free reader',
    'resuming': 'Resuming from the saved transfers',
  };
  const wrong = Object.entries(words).filter(([k, v]) => H.stageWords(k) !== v).map(([k]) => k + '→' + H.stageWords(k));
  check('all seven server stage strings map to the words on the page', wrong.length === 0, wrong.join(' | '));
  check('  ...the account stage and an unknown one come out readable, never blank', H.stageWords('reading the account') === 'Reading the account' && H.stageWords('pricing 12 tokens') === 'Pricing 12 tokens' && H.stageWords('') === '');
  check('ETA words: 45 s → "under a minute", 130 s → "about 2 min", 61 s → "about 1 min", 150 min → hours and minutes, unknown → nothing', H.etaWords(45e3) === 'under a minute' && H.etaWords(130e3) === 'about 2 min' && H.etaWords(61e3) === 'about 1 min' && H.etaWords(150 * 60e3) === 'about 2 h 30 min' && H.etaWords(null) === '' && H.etaWords(-5) === '');
  const e1 = H.etaEndAt(null, 0, 130e3), e2 = H.etaEndAt(e1, 10e3, 200e3), e3 = H.etaEndAt(e2, 20e3, null), e4 = H.etaEndAt(e3, 30e3, 60e3);
  check('an ETA never rises: a later, larger estimate keeps the earlier end; no estimate keeps the countdown; a smaller one lowers it', e1 === 130e3 && e2 === 130e3 && e3 === 130e3 && e4 === 90e3);
  check('the line: "Step 2 of 5 · Reading 41 tokens\' balances · 63% · about 2 min for this step"', H.progressLine({ stage: 'reading 41 tokens', done: 26, total: 41, stageOf: { n: 2, of: 5 } }, 125e3) === 'Step 2 of 5 · Reading 41 tokens\' balances · 63% · about 2 min for this step', H.progressLine({ stage: 'reading 41 tokens', done: 26, total: 41, stageOf: { n: 2, of: 5 } }, 125e3));
  check('  ...no step, no total, no ETA: just the stage words', H.progressLine({ stage: 'reading every token transfer', done: 0, total: 0 }, null) === 'Reading every token transfer this wallet ever made');
  check('  ...queued: "3rd in line · about 25 min" with an ETA, "in line (2 ahead)" without', H.progressLine({ stage: 'waiting for a turn', ahead: 2 }, 25 * 60e3) === '3rd in line · about 25 min' && H.progressLine({ stage: 'waiting for a turn', ahead: 2 }, null) === 'in line (2 ahead)' && H.progressLine({ stage: 'waiting for a turn', ahead: 0 }, 50e3) === '1st in line · under a minute');
  check('  ...a full queue says so plainly, whatever else the 202 carries', H.progressLine({ stage: 'waiting for a turn', ahead: 7, queueFull: true }, 9e5) === 'The chain reader has a long line right now — try again in a while.');
  // the server waiting out the node's refusals (throttled: ms so far): said, the step's countdown left out; under a minute, no figure
  const thr = H.progressLine({ stage: 'reading every token transfer', done: 120, total: 5100, stageOf: { n: 1, of: 5 }, throttled: 150e3 }, 30 * 60e3);
  check('  ...a read waiting out the node\'s refusals says so with the whole minutes so far (2:30 is "2 min", never rounded up), and drops the step\'s countdown', thr === 'Step 1 of 5 · Reading every token transfer this wallet ever made · 2% · the chain node is refusing reads — waiting it out (2 min so far)' && /\(3 min so far\)$/.test(H.progressLine({ stage: 'reading every token transfer', done: 120, total: 5100, stageOf: { n: 1, of: 5 }, throttled: 180e3 }, null)), thr);
  check('  ...under a minute of waiting: no figure', H.progressLine({ stage: 'reading every token transfer', done: 120, total: 5100, stageOf: { n: 1, of: 5 }, throttled: 20e3 }, null) === 'Step 1 of 5 · Reading every token transfer this wallet ever made · 2% · the chain node is refusing reads — waiting it out');
  // the page's own retry stage ("throttled"): worded by what the server said — why it failed, and whether a checkpoint is there to go on from
  const rc = (reason, resumable) => H.progressLine({ stage: 'throttled', throttled: 1, reason, resumable }, null);
  check('  ...the retry copy says a refusal or a timeout, and "goes on from where it stopped" only when the server says a checkpoint is on file — "starts over" otherwise', rc('throttled', true) === 'The chain node refused the read for too long — asking again in a minute (it goes on from where it stopped)' && rc('throttled', false) === 'The chain node refused the read for too long — asking again in a minute (it starts over)' && rc('timeout', true) === 'The chain read timed out — asking again in a minute (it goes on from where it stopped)' && rc('timeout', false) === 'The chain read timed out — asking again in a minute (it starts over)', rc('timeout', false));
  check('  ...a complete saved history with no checkpoint: "reads on from the saved history — only what is new"', H.retryCopy({ reason: 'throttled', resumable: false, saved: 'complete' }) === 'The chain node refused the read for too long — asking again in a minute (it reads on from the saved history — only what is new)' && H.retryCopy({ reason: 'throttled', resumable: true, saved: 'checkpoint' }) === 'The chain node refused the read for too long — asking again in a minute (it goes on from where it stopped)');
  check('  ...spoken the same', H.progressSpoken({ stage: 'throttled', throttled: 1, reason: 'throttled', resumable: true }) === rc('throttled', true) && H.retryCopy({ reason: 'timeout', resumable: false }) === rc('timeout', false));
  check('  ...the "you can leave this page" note is hidden during the page\'s own retry wait (no read is running), and a wait on the node starts the step\'s estimate afresh', /progNote\.hidden = !!info\.queueFull \|\| info\.stage === 'throttled' \|\| !!\(lr && !lr\.partial && !state\.rebuilding\[addr\]\)/.test(JS) && /if \(info\.throttled > 0\) pg\.etaEnd = null;/.test(JS));
  check('  ...and the saved-history line is asked for again after a failed read too (a checkpoint may be on file now), whichever wallet is selected by then', /\} catch \(e\) \{\s*\n\s*refreshWalletMeta\(\);[^\n]*\n\s*if \(run !== state\.runId\) return;/.test(JS));
  check('  ...a checkpoint the chain has moved too far past is said as that — "too far back to go on from — the next read starts over" — never promised away', /if \(lr\.walking\) return 'history part-read ' \+ ago\(lr\.updatedAt\) \+ \(lr\.stale \? ' · the transfer walk stopped part-way, too far back to go on from — the next read starts over' : ' · the transfer walk stopped part-way — the next read goes on from there'\);/.test(JS) && /lr\.partial \? \(lr\.stale \? ' · partial, too far back to go on from — the next read starts over' : ' · partial'\) : ''/.test(JS));
  check('  ...spoken: the step and stage, then "waiting for the chain node" while it waits — never the minutes', H.progressSpoken({ stage: 'reading every token transfer', stageOf: { n: 1, of: 5 }, throttled: 150e3 }) === 'Step 1 of 5: Reading every token transfer this wallet ever made — waiting for the chain node');
  check('  ...the spoken line carries the step and the stage, never a percent or a time', H.progressSpoken({ stage: 'reading 41 tokens', done: 26, total: 41, stageOf: { n: 2, of: 5 }, eta: 125e3 }) === 'Step 2 of 5: Reading 41 tokens\' balances' && H.progressSpoken({ stage: 'waiting for a turn', ahead: 2, eta: 9e5 }) === '3rd in line' && !/%|min/.test(H.progressSpoken({ stage: 'dating 9 blocks', done: 5, total: 9, eta: 60e3 })));
  check('ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 103rd', ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd'].every((s) => H.ordinal(parseInt(s, 10)) === s));
  const list = [{ id: 3, address: '0xaaa', lid: null }, { id: null, lid: 7, address: '0xbbb' }, { id: 9, lid: 2, address: '0xccc' }];
  check('?wid= resolves a tracked row, ?lid= a linked wallet, and a wallet no longer in the list is null', H.resolveDeepLink(list, new URLSearchParams('wid=3')).address === '0xaaa' && H.resolveDeepLink(list, new URLSearchParams('lid=7')).address === '0xbbb' && H.resolveDeepLink(list, new URLSearchParams('wid=9&lid=7')).address === '0xccc' && H.resolveDeepLink(list, new URLSearchParams('wid=4')) === null && H.resolveDeepLink(list, new URLSearchParams('lid=3')) === null && H.resolveDeepLink(list, new URLSearchParams('')) === null);
  check('  ...the page honours the link once, on the first list load, and says when the wallet is gone', /if \(!state\.deepLinkDone\) \{\n\s+state\.deepLinkDone = true;/.test(JS) && /resolveDeepLink\(state\.wallets, params\)/.test(JS) && /That wallet is no longer in your list — it was untracked or unlinked/.test(JS));

  /* ═══ signed out: the address is kept across sign-in ═══ */
  check('the signed-out submit stashes the address as sessionStorage trk:pending and opens sign-in', /const PENDING_KEY = 'trk:pending';/.test(JS) && /sessionStorage\.setItem\(PENDING_KEY, addr\)/.test(JS) && /function signInToTrack\(address\)[\s\S]{0,300}stashPending\(address\.toLowerCase\(\)\);[\s\S]{0,80}AUTH\.open\(\);/.test(JS) && /soForm\.addEventListener\('submit'[\s\S]{0,400}signInToTrack\(v\);/.test(JS));
  check('  ...the signed-in form does the same when the session is gone', /if \(!\(window\.AUTH && AUTH\.user\)\) \{ signInToTrack\(/.test(JS));
  check('  ...and the stash is taken once the list has loaded: an address already tracked is selected, a new one is added, a refusal leaves it in the form', /const pending = takePending\(\);/.test(JS) && /if \(walletByAddr\(pending\)\) \{ select\(pending, true\); return; \}/.test(JS) && /addrIn\.value = pending;/.test(JS) && /sessionStorage\.removeItem\(PENDING_KEY\)/.test(JS));

  /* ═══ refresh vs rebuild; the saved-history line; the banner ═══ */
  check('Refresh reads incrementally (fresh=1); "Rebuild from scratch" is a second button, two taps, fresh=2', /refresh\(state\.selected, \+\+state\.runId, 1\)/.test(JS) && /refresh\(state\.selected, \+\+state\.runId, 2\)/.test(JS) && /rebuildBtn\.classList\.add\('is-armed'\); rebuildBtn\.textContent = 'Sure\? Rebuild';/.test(JS) && /state\.rebuildT = setTimeout\(clearRebuild, 4000\)/.test(JS) && /<button class="btn btn-ghost btn-sm trk-rebuild" id="trk-rebuild" type="button" hidden data-tip="[^"]*tap twice[^"]*">Rebuild from scratch<\/button>/.test(HTML));
  check('  ...the number reaches trackerReport as fresh: 2 (tracker.js must send it as &fresh=2)', /trackerReport\(addr, relay\(addr\), \{ fresh: fresh === 2 \? 2 : !!fresh \}\)/.test(JS));
  check('the selected-wallet line: label, the whole address in <code>, copy, explorer, the linked badge, and the saved-history words', /<code class="trk-sel-addr">/.test(JS) && /trk-w-badge">your linked wallet<\/span>/.test(JS.slice(JS.indexOf('function updateSelectedLine'))) && /function lastReadWords\(w\)/.test(JS) && /'history read ' \+ ago\(lr\.updatedAt\) \+ \(lr\.readTo != null \? ' · to block ' \+ Number\(lr\.readTo\)\.toLocaleString\('en-US'\) : ''\) \+ \(lr\.partial \? \(lr\.stale \? ' · partial, too far back to go on from — the next read starts over' : ' · partial'\) : ''\)/.test(JS) && /\.trk-sel-addr \{[^}]*word-break: break-all;/.test(CSS));
  check('  ...and claims nothing on a server that predates lastRead', /if \(!w \|\| !\('lastRead' in w\)\) return '';/.test(JS));
  check('  ...a transfer walk stopped part-way (lastRead.walking) is said as that — never "to block N", which a walk checkpoint has no claim to', /if \(lr\.walking\) return 'history part-read ' \+ ago\(lr\.updatedAt\) \+ \(lr\.stale \? [^\n]*' · the transfer walk stopped part-way — the next read goes on from there'\);/.test(JS) && !/to block[^\n]*walking/.test(JS));
  check('an incremental refresh shows "Updating from block N…" and the result says what was read — or that nothing was new (readFrom null), never "block 0"', /Updating from block <b>' \+ esc\(from\.toLocaleString\('en-US'\)\) \+ '<\/b>…/.test(JS) && /rep\.readFrom != null \? ' · read from block '/.test(JS) && /' · nothing new on the chain since the saved read'/.test(JS) && !/rep\.readFrom \|\| 0/.test(JS) && /function incrementalFrom\(addr\)/.test(JS));
  check('rerenderKeepingPlace is gone (the renderer keeps its own place); the live result is rendered straight', !/rerenderKeepingPlace/.test(JS) && /renderReport\(rep\);   \/\/ renderTracker keeps its own place/.test(JS));
  check('cache-first then live, the combined totals and the saved-report trimming all stay', /\/api\/tracker\/cache\?address=/.test(JS) && /function runCombined\(\)/.test(JS) && /function postCache\(addr, rep\)/.test(JS) && /const CAP = 380 \* 1024/.test(JS));

  /* ═══ ⓘ explainers ═══ */
  check('ⓘ is attached in exactly two places: a stat tile\'s label and a heading row (a sibling of its h3) — never inside a heading', /reportEl\.querySelectorAll\('\.hstat'\)/.test(JS) && /reportEl\.querySelectorAll\('\.trk-h-row'\)/.test(JS) && !/querySelectorAll\('\.trk-h'\)/.test(JS) && /addInfo\(row, row, key, def\)/.test(JS) && /if \(row\.querySelector\('\.trk-info'\)\) return;/.test(JS));
  check('  ...the key ignores a label\'s unit span, so "Portfolio value (USD)" finds its definition', /function labelKey\(el\)/.test(JS) && /!n\.classList\.contains\('unit'\)/.test(JS));
  const defs = /const DEFS = \{([\s\S]*?)\n  \};/.exec(JS)[1];
  check('  ...DEFS carries Token transactions, Tokens traded, Account and Value over time (its words as specified)', ['Token transactions', 'Tokens traded', 'Account', 'Value over time', 'Transactions sent', 'Portfolio value'].every((k) => new RegExp("'" + k + "': '").test(defs)) && /'Value over time': 'Token holdings valued at each pool\\'s own on-chain price, USD at today\\'s ETH price; the ETH balance is not included/.test(defs));
  check('  ...every definition states its simplification, never a guarantee', !/\b(guarantee|exact|always right)\b/i.test(defs) && /today\\'s ETH price/.test(defs));
  check('the heading row and the stat label lay out as flex rows; the row\'s panel sits under it', /\.trk-report \.hstat \.lbl, \.trk-report \.trk-h-row \{ display: flex; align-items: center; gap: 0\.3rem; flex-wrap: wrap; \}/.test(CSS) && /\.trk-report \.trk-h-row \+ \.trk-info-panel \{ margin: -0\.2rem 0 0\.6rem; \}/.test(CSS) && !/\.trk-report \.trk-h \+ \.trk-info-panel/.test(CSS));
  check('the ⓘ disc is sized from --ava (28px; 44px under a finger, keyed on the pointer, not the width) and the glyph from the disc', /\.trk-report \.trk-info \{[^}]*width: var\(--ava, 28px\); height: var\(--ava, 28px\);/.test(CSS) && !/\.trk-report \.trk-info \{ width: 36px/.test(CSS) && /@media \(pointer: coarse\) \{ html \.trk-report \.trk-info \{ --ava: 44px; \} \}/.test(RESP) && !/@media \(max-width: 560px\) \{ html \.trk-report \.trk-info \{ --ava: 36px; \} \}/.test(RESP) && /html \.trk-report \.trk-info \{ --ava: 28px; font-size: calc\(var\(--ava\) \* 0\.6\); \}/.test(RESP));

  /* ═══ the shell's own styles ═══ */
  check('tracker.css still carries the shell trackerpage.js depends on', ['.trk-layout', '.trk-side', '.trk-main', '.trk-w ', '.trk-add', '.trk-comb', '.trk-skel'].every((s) => CSS.includes(s)));
  check('  ...the progress bar honours reduced motion and forced colours; nothing in the new rules is a bare font-size', /@media \(prefers-reduced-motion: reduce\) \{ \.trk-prog-fill \{ transition: none; \} \}/.test(CSS) && /@media \(forced-colors: active\) \{ \.trk-prog-fill \{ background: Highlight; \}/.test(CSS) && [...CSS.matchAll(/font-size\s*:\s*([^;}]+)/g)].every((m) => /^max\(var\(--text-floor\)/.test(m[1].trim()) || /--ava\b/.test(m[1])));
  check('  ...numbers in the progress line are tabular, words wrap, no ellipsis anywhere in the shell', /\.trk-prog-line \{[^}]*font-variant-numeric: tabular-nums;/.test(CSS) && /\.trk-prog-line \{[^}]*overflow-wrap: anywhere;/.test(CSS) && !/\.trk-sel-read \{[^}]*text-overflow/.test(CSS));

  /* ═══ what Sendy says about the tracker ═══ */
  check('Sendy\'s tracker tips say Track, carry the first-read tip, and reopen from the saved report rather than "instantly"', /'On the public node a first read can take an hour or more — leave the page: it keeps its place in line, keeps reading, is saved, and you get a notification when it is ready \(or when the node refuses it for so long that it stops; it goes on from where it stopped when you come back\)\. Later refreshes take seconds\.'/.test(SENDY) && /On the public node a wallet\\'s first read can take an hour or more\. You can leave: it keeps its place in line, keeps reading, is saved, and you get a notification when it is ready \(or when the node refuses it for so long that it stops — it goes on from where it stopped when you come back\)\. Later refreshes read only what is new and take seconds\./.test(SENDY) && /tips: \['Track any wallet:/.test(SENDY) && !/reopens instantly/.test(SENDY) && /tracks any wallet on Robinhood Chain/.test(SENDY));

  /* ═══ the list the page reads, against the server ═══ */
  db = new DatabaseSync(DB_PATH); db.exec('PRAGMA busy_timeout = 5000');   // the server writes meanwhile: wait a moment, never fail with "database is locked"
  const u = mkUser('__tp_user__');
  const watched = '0x' + 'ab'.repeat(20);
  const add = await api('/api/wallets', { method: 'POST', sid: u.sid, body: { address: watched, label: 'Page test' } });
  check('a throwaway member can track a wallet', add.status === 200 && add.j && add.j.wallet && add.j.wallet.id > 0, add.status + ' ' + JSON.stringify(add.j && add.j.error || ''));
  const list1 = await api('/api/wallets', { sid: u.sid });
  const row = (list1.j && list1.j.wallets || []).find((w) => w.address === watched);
  check('  ...the list carries it with its id (what ?wid= resolves)', !!row && row.id === add.j.wallet.id && row.mine === false);
  if (row && 'lastRead' in row) check('  ...with lastRead null before any history is saved', row.lastRead === null, JSON.stringify(row.lastRead));
  else check('  ...with lastRead (skipped: this server predates it)', true, 'skipped');
  const w1 = Wallet.createRandom();
  const linked = await link(u.sid, w1);
  const list2 = await api('/api/wallets', { sid: u.sid });
  const mine = (list2.j && list2.j.wallets || []).find((w) => w.address === w1.address.toLowerCase());
  check('a linked wallet is listed as yours', linked.status === 200 && !!mine && mine.mine === true && mine.id === null, linked.status + ' ' + JSON.stringify(mine));
  if (mine && 'lid' in mine) {
    const idRow = db.prepare("SELECT id FROM identities WHERE user_id = ? AND type = 'wallet'").get(u.id);
    check('  ...with lid = its identities row id (what ?lid= resolves)', !!idRow && mine.lid === idRow.id, JSON.stringify(mine.lid) + ' vs ' + JSON.stringify(idRow && idRow.id));
  } else check('  ...with lid (skipped: this server predates it)', true, 'skipped');
  check('the unsigned list is refused (the page shows the signed-out explainer on it)', (await api('/api/wallets')).status === 401);
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
  check('the suite ran to the end', false, e.message);
} finally {
  if (db) {
    for (const id of made) {
      for (const t of ['tracked_wallets', 'tracker_cache', 'wallet_hist', 'identities', 'sessions', 'points_events', 'notifications', 'holder_state'])
        { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
      try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
    }
    db.close();
  }
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
