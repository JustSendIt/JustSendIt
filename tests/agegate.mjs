/* The age gate, and the referral gate's rules and branding.

   The 18+ question is asked once, before the site opens, on every page (agegate.js). It is the ONLY
   thing it asks: the invite code and the $100 wallet check belong to the referral gate, which opens when
   someone tries to join. The server records the answer on an account and will not make one without it.
   Throwaway accounts only; removed in the finally block. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DB_PATH, ROOT, SERVER_JS } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const db = new DatabaseSync(DB_PATH);
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const made = [];
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const SRC = readFileSync(SERVER_JS, 'utf8');
const AGE = read('agegate.js'), INVITE = read('invite.js'), ENTRY = read('entry.js'), AUTH = read('auth.js'), TOUR = read('tour.js');
const GATE_CSS = read('gate.css'), INVITE_CSS = read('invite.css'), STYLES = read('styles.css');

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j, setCookie: r.headers.get('set-cookie') || '' };
}
function mkUser(name, extra = {}) {
  db.prepare('INSERT INTO users (username, created_at, avatar, holder_verified_at, holder_state, age_at, ticket_public) VALUES (?,?,?,?,?,?,?)')
    .run(name, Date.now(), '🧪', Date.now(), 'ok', extra.ageAt == null ? null : extra.ageAt, extra.ticketPublic ? 1 : 0);
  const id = db.prepare('SELECT id FROM users WHERE username=?').get(name).id;
  made.push(id);
  const raw = 'tok_' + name + '_' + Math.random().toString(16).slice(2);
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, hashed) VALUES (?,?,?,?,1)')
    .run(createHash('sha256').update(raw).digest('hex'), id, Date.now(), Date.now() + 864e5);
  return { id, sid: 'sid=' + raw };
}

try {
  /* ═══ the server's half ═══ */
  const none = await api('/api/age', { method: 'POST', body: {} });
  check('an unticked box is refused', none.status === 400, none.status);
  const young = await api('/api/age', { method: 'POST', body: { confirm: true, age: 17 } });
  check('  ...and so is any age but the one asked about', young.status === 400, young.status);
  const yes = await api('/api/age', { method: 'POST', body: { confirm: true, age: 18 } });
  check('a ticked box is accepted', yes.status === 200 && yes.j && yes.j.ok === true, yes.status);
  check('  ...and sets jsi_age=18 for the whole site', /jsi_age=18;/.test(yes.setCookie) && /Path=\//.test(yes.setCookie), yes.setCookie);
  check('  ...for a year', /Max-Age=31536000/.test(yes.setCookie), yes.setCookie);
  check('  ...readable by the page, which has to decide before it paints', !/HttpOnly/i.test(yes.setCookie), yes.setCookie);
  check('  ...and SameSite=Lax, so an OAuth return still carries it', /SameSite=Lax/i.test(yes.setCookie), yes.setCookie);

  const u = mkUser('__ag_signedin__');
  await api('/api/age', { method: 'POST', cookie: u.sid, body: { confirm: true, age: 18 } });
  const stamped = db.prepare('SELECT age_at FROM users WHERE id=?').get(u.id).age_at;
  check('a signed-in answer is recorded on the account', !!stamped && Math.abs(stamped - Date.now()) < 60000, stamped);
  db.prepare('UPDATE users SET age_at = 1000 WHERE id=?').run(u.id);
  await api('/api/age', { method: 'POST', cookie: u.sid, body: { confirm: true, age: 18 } });
  check('  ...once: answering again does not move the date', db.prepare('SELECT age_at FROM users WHERE id=?').get(u.id).age_at === 1000);

  const st0 = await api('/api/gate/state');
  check('the gate state says the question is unanswered', st0.j && st0.j.ageConfirmed === false && st0.j.ageMin === 18, JSON.stringify(st0.j && { a: st0.j.ageConfirmed, m: st0.j.ageMin }));
  const st1 = await api('/api/gate/state', { cookie: 'jsi_age=18' });
  check('  ...and answered once the cookie is there', st1.j && st1.j.ageConfirmed === true);

  // (with no code and no answer the invite is asked for first — gatetest's first sign-up covers that live,
  // and a sign-up here would spend one of the ten an hour the whole run shares)
  check('the age check is the LAST refusal, after the invite, the terms and a spent code', /code: 'code_spent' \};\n[\s\S]{0,160}if \(!ageOk\(req\)\) return \{[^}]*code: 'need_age' \}/.test(SRC));
  check('every door that makes an account records the answer', /function claimInvite[\s\S]{0,700}if \(ageOk\(req\)\) db\.prepare\('UPDATE users SET age_at = \? WHERE id = \? AND age_at IS NULL'\)/.test(SRC));
  check('an OAuth sign-up refused for age comes back to the age question, not the ticket', /e\.code === 'need_age' \? '&needage=1' : '&needinvite=1'/.test(SRC) && /q\.get\('needage'\) === '1'[\s\S]{0,80}AGE\.reopen\(\)/.test(AUTH));
  check('a need_age refusal on the page reopens the question', /code === 'need_age' && window\.AGE\) \{ AGE\.reopen\(\)/.test(AUTH));

  /* ═══ the referral gate's rules come from the constants the check enforces ═══ */
  const minUsd = Number((/const MIN_HOLD_USD = (\d+);/.exec(SRC) || [])[1]);
  const r = st0.j && st0.j.rules;
  check('the gate state carries the entry rules', !!r, JSON.stringify(r));
  check('  ...the hold floor is MIN_HOLD_USD', r && r.holdMinUsd === minUsd, r && r.holdMinUsd + ' vs ' + minUsd);
  check('  ...the coin is $SEND', r && Array.isArray(r.coins) && r.coins.includes('$SEND'), r && r.coins);
  check('  ...and the sell window is the one the check uses', r && r.sellWindowHours === 24 && /const PROOF_SELL_WINDOW_MS = DAY_MS;/.test(SRC), r && r.sellWindowHours);
  const medianHours = Number((/const PRICE_MEDIAN_HOURS = (\d+)/.exec(SRC) || [])[1]);
  check('  ...and the price median window the valuation uses', r && r.priceMedianHours === medianHours && medianHours > 0, r && r.priceMedianHours);
  check('the ticket says reading is free for adults, matching the age gate', /Reading the site is free for everyone 18 and over/.test(INVITE) && !/free and open to everyone/.test(INVITE));
  check('the gate state no longer hands out a coin\'s banner art', st0.j && st0.j.brand === undefined && !/coinBrandUrls/.test(SRC));
  const rules = (/function rulesHtml\(\) \{[\s\S]*?\n  \}/.exec(INVITE) || [''])[0];
  check('the referral gate states how to get in', /How to get in/.test(rules) && /Redeem an invite code/.test(rules));
  check('the rules say how the bag is valued (lower of the current price and the median), not "priced live"', /Valued at the lower of the current price and its <span data-rule="median">\d+-hour<\/span> median/.test(rules) && !/Priced live/.test(INVITE));
  check('  ...connect a wallet, read-only', /Connect your wallet — read-only/.test(rules) && /moves nothing, approves nothing and costs no gas/.test(rules));
  check('  ...and hold the floor in $SEND for full access', /Hold <span data-rule="min">\$\d+<\/span> of <span data-rule="coin">\$SEND<\/span>/.test(rules) && /full access/.test(rules));
  check('  ...and that under it the account is read-only until it holds enough', /stays <b>read-only<\/b> until your wallets hold/.test(rules));
  const literals = [...INVITE.matchAll(/data-rule="min">\$(\d+)</g)].map(m => Number(m[1]));
  check('  ...every placeholder figure matches the server until the live one replaces it', literals.length >= 4 && literals.every(n => n === minUsd), literals.join(','));
  check('  ...and the live one does replace it', /function paintRules\(\)/.test(INVITE) && /paintRules\(\);\n\s+paintTicket\(\);/.test(INVITE));
  check('the ticket is shown the rules on step one, before a code is typed', /tk-cta[^\n]*\n\s+rulesHtml\(\) \+/.test(INVITE));

  /* ═══ the question itself ═══ */
  check('the gate is one checkbox and a button that says what it does', /<input type="checkbox" id="age-yes">/.test(AGE) && /I confirm I am <b>18 years of age or older<\/b>/.test(AGE) && /Enter the site/.test(AGE));
  check('  ...the button is aria-disabled, not disabled, so it can still explain itself', /id="age-enter" type="button" aria-disabled="true"/.test(AGE) && !/id="age-enter"[^>]*\sdisabled[\s>]/.test(AGE));
  check('  ...clicking it unticked says why nothing happened', /Tick the box to confirm you are 18 or older\./.test(AGE));
  check('  ...it stores exactly what the server reads', /COOKIE = 'jsi_age', MIN = 18/.test(AGE) && /const AGE_COOKIE = 'jsi_age';/.test(SRC) && /const AGE_MIN = 18;/.test(SRC));
  check('  ...and tells the server', /fetch\('\/api\/age'/.test(AGE) && /confirm: true, age: MIN/.test(AGE));
  check('  ...an under-18 answer keeps the site closed for the tab', /SS_NO/.test(AGE) && /Come back when you\\'re 18/.test(AGE));
  check('  ...nothing but an answer closes it (Escape is swallowed in the capture phase, whatever has focus)', /if \(e\.key === 'Escape' \|\| e\.key === 'Esc'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); return; \}/.test(AGE) && /document\.addEventListener\('keydown', onKey, true\)/.test(AGE));
  check('  ...it closes once: a second Enter during the fade does nothing', /function finish\(quiet\) \{\n\s+if \(!isOpen \|\| !el\) return;/.test(AGE) && /gone\.inert = true;/.test(AGE));
  check('  ...focus never falls to <body> when it closes', /var main = document\.getElementById\('main'\);/.test(AGE));
  check('  ...a page restored from the back-forward cache after an answer closes it quietly', /addEventListener\('pageshow', function \(e\) \{ if \(e\.persisted && isOpen && answered\(\)\) finish\(true\); \}\)/.test(AGE));
  check('  ...a reason given on reopen is announced and read with the dialog', /aria-describedby', 'age-desc age-err'/.test(AGE) && /setTimeout\(function \(\) \{ err\.textContent = msg/.test(AGE));
  check('  ...and a printed page (the whitepaper PDF, built from a local file) never carries it', /if \(location\.protocol === 'file:'\)/.test(AGE) && /@media print \{\n  #age-gate, html\.age-pending::after \{ display: none !important; \}/.test(STYLES));
  check('  ...the page behind is inert, including anything added while it is up', /n\.inert = true/.test(AGE) && /new MutationObserver/.test(AGE));
  check('  ...and it says reading is free', /Reading the site is free for everyone 18 and over/.test(AGE));
  const ageText = AGE.replace(/\/\*[\s\S]*?\*\//g, '');
  check('the age gate asks about age ONLY — no $100, no wallet, no invite code', !/\$\d/.test(ageText) && !/wallet/i.test(ageText) && !/invite/i.test(ageText));
  check('the referral gate no longer asks the age question', !/inv-age/.test(INVITE) && !/age18/.test(INVITE) && !/18 or older/.test(INVITE));

  /* ═══ right after the loading screen ═══ */
  check('the homepage loading screen holds the question until it ends', /if \(AGE && AGE\.needed && document\.body && document\.body\.dataset\.intro\) AGE\.hold\(\);/.test(ENTRY));
  check('  ...opens it the moment the intro is dismissed', /const asking = !!\(AGE && AGE\.needed\);[\s\S]{0,600}if \(asking\) AGE\.open\(\);/.test(ENTRY));
  check('  ...and walks in only after the answer', /afterAge\(\(\) => \{ if \(asking\) \{ if \(fromGesture\) gesture\(\); burst\(\); \} enter\(true\); focusMain\(\); \}\)/.test(ENTRY));
  check('no music starts under the question: the intro gesture is passed on from the answer', /if \(fromGesture && !asking\) gesture\(\);/.test(ENTRY));
  const PLAYER = read('player.js');
  check('  ...a returning listener resumes only after the answer', /afterAge\(\(\) => tryPlay\(\)\.then\(ok => \{ if \(!ok\) armGeneric\(\); \}\)\)/.test(PLAYER));
  check('  ...and asking again pauses whatever is playing', /document\.addEventListener\('jsi:age-open', \(\) => \{ if \(!audio\.paused\) audio\.pause\(\); \}\)/.test(PLAYER) && /dispatchEvent\(new CustomEvent\('jsi:age-open'\)\)/.test(AGE));
  check('an invite link opens the ticket only after the answer', /if \(window\.AGE && AGE\.needed\) AGE\.whenOk\(openInvite\); else openInvite\(\);/.test(AUTH));
  check('  ...with a backstop if the loading screen never opens it', /HOLD_BACKSTOP_MS = \d+/.test(AGE) && /setTimeout\(open, HOLD_BACKSTOP_MS\)/.test(AGE));
  check('the tour waits for the answer', /window\.AGE && AGE\.needed\) return true;/.test(TOUR));
  check('the cover sits under the loading screen (999), the question over every modal and under the cursor', /html\.age-pending::after \{[^}]*z-index: 998;/.test(STYLES) && /#age-gate \{[^}]*z-index: 9960;/.test(STYLES));

  /* ═══ on every page, in <head> ═══ */
  const pages = readdirSync(PUB).filter(f => f.endsWith('.html'));
  const withStyles = pages.filter(f => /href="\/?styles\.css"/.test(read(f)));
  const missing = withStyles.filter(f => { const h = read(f); const head = h.slice(0, h.indexOf('</head>')); return !/<script src="\/?agegate\.js"><\/script>/.test(head) || head.indexOf('agegate.js') < head.indexOf('styles.css'); });
  check('every site page loads the age gate in <head>, after the stylesheet', withStyles.length >= 15 && !missing.length, missing.join(', ') || withStyles.length + ' pages');
  const home = await (await fetch(BASE + '/')).text();
  check('  ...and the served homepage carries it, versioned', /<script src="agegate\.js\?v=[^"]+"><\/script>/.test(home));
  for (const open of ['/privacy.html', '/terms.html']) {
    const h = await (await fetch(BASE + open)).text();
    check('  ...but ' + open + ' stays readable without answering', !/agegate\.js/.test(h));
  }

  /* ═══ the ticket wears the site's brand ═══ */
  check('the referral gate title is "Ticket to Send" with a rocket', /<h2 class="inv-title">Ticket to <span class="hl">Send<\/span> <span aria-hidden="true">🚀<\/span><\/h2>/.test(INVITE));
  check('  ...and "$GWC is your ticket" is gone everywhere', !/is your ticket/i.test(INVITE) && !/IS YOUR TICKET/.test(SRC));
  check('the ticket carries the site mark and the $Send wordmark', /class="tk-logo" src="\/assets\/logo-mark-sm\.png"/.test(INVITE) && /<span class="tk-brand">\$Send<\/span>/.test(INVITE));
  check('  ...no coin banner, no $GWC on its face', !/gwcHeader|paintBand|tk-brand">\$GWC/.test(INVITE) && /Just Send It · Robinhood Chain · Entertainment only/.test(INVITE));
  const synth = /#ff2e88|#38e8ff|#070312|#1b1036|#2a1250|255,\s*46,\s*136|56,\s*232,\s*255|--g-cyan|--g-magenta|--g-violet/;
  const LEGAL = read('privacy.html') + read('terms.html');
  const synthLegal = /#0b0618|#ded3f4|255,\s*46,\s*136|--g-cyan|--g-magenta|--g-violet/;
  check('  ...and none of the old synthwave palette is left', !synth.test(GATE_CSS) && !synth.test(INVITE_CSS) && !synth.test(INVITE), (GATE_CSS.match(synth) || INVITE_CSS.match(synth) || INVITE.match(synth) || [''])[0]);
  check('  ...including on the privacy and terms pages, whose links still have a colour', !synthLegal.test(LEGAL) && /\.t-toc a \{ color: var\(--g-green-hi\)/.test(LEGAL), (LEGAL.match(synthLegal) || [''])[0]);
  const usedTokens = [...new Set([...LEGAL.matchAll(/var\((--g-[a-z0-9-]+)\)/g)].map(m => m[1]))];
  check('  ...and every gate token those pages use is still defined', usedTokens.every(t => new RegExp('\\n\\s*' + t + ':').test(GATE_CSS)), usedTokens.filter(t => !new RegExp('\\n\\s*' + t + ':').test(GATE_CSS)).join(','));
  check('button labels on the ticket use the fixed label ink, not the reader\'s background', /--g-on:\s+var\(--ctl-ink, #020301\);/.test(GATE_CSS) && !/color: var\(--g-ink[,)]/.test(GATE_CSS + INVITE_CSS));
  check('the downloaded picture says "Ticket to Send 🚀" under the $Send lockup', /c\.fillText\('Ticket to Send 🚀', 64, 206\)/.test(INVITE) && /c\.fillText\('\$Send', wordX, 86\)/.test(INVITE));
  check('the shared card draws the site mark from the file the nav uses', /assets', 'logo-mark-sm\.png'/.test(SRC) && /function decodePng\(buf\)/.test(SRC));
  const owner = mkUser('__ag_card__', { ticketPublic: true });
  const card = await fetch(BASE + '/t/' + owner.id + '.png');
  const buf = Buffer.from(await card.arrayBuffer());
  check('  ...and the card still renders', card.status === 200 && buf.slice(1, 4).toString() === 'PNG' && buf.readUInt32BE(16) === 1200, card.status);
  // the mark sits at (56,46)-(184,174): its green must be there, on a card that is otherwise near-black at that spot
  const zlib = await import('node:zlib');
  const chunks = []; let off = 8;
  while (off < buf.length) { const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8); if (type === 'IDAT') chunks.push(buf.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const at = (x, y) => { const i = y * (1200 * 4 + 1) + 1 + x * 4; return [raw[i], raw[i + 1], raw[i + 2]]; };
  let greenish = 0;
  for (let y = 60; y < 160; y += 4) for (let x = 70; x < 170; x += 4) { const [rr, gg, bb] = at(x, y); if (gg > 150 && gg > bb + 60) greenish++; }
  check('  ...with the mark actually painted into it', greenish > 60, greenish + ' green samples');

  /* ═══ the landing page ═══ */
  const idx = read('index.html');
  check('the Certified Send Moments section is hidden', /<section class="alt-bg-2" id="moments" hidden>\s*<div class="wrap">\s*<h2 class="section-title display">Certified Send Moments/.test(idx));

  /* ═══ the privacy page says what the cookie is ═══ */
  const priv = read('privacy.html');
  check('the privacy page lists the age cookie', /<code>jsi_age<\/code>/.test(priv) && /When you confirmed you are 18 or older/.test(priv));
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n')[1]);
} finally {
  for (const id of made) {
    for (const t of ['sessions', 'points_events', 'notifications']) { try { db.prepare(`DELETE FROM ${t} WHERE user_id=?`).run(id); } catch {} }
    try { db.prepare('DELETE FROM invite_codes WHERE owner_id=? OR user_id=?').run(id, id); } catch {}
    try { db.prepare('DELETE FROM users WHERE id=?').run(id); } catch {}
  }
  const left = db.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE '\\_\\_ag\\_%' ESCAPE '\\'").get().n;
  console.log('\ncleanup — throwaway users left:', left);
  db.close();
}
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
