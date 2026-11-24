/* ===== The OG banners after the beta: Silver and Bronze need only $SEND, and the window open now is promoted (2026-11-17) =====
   The owner, the day the beta ended: "Moving forward after beta, only consider people who have bought Send for the silver OG and
   bronze OG badges and make a banner promoting the Silver OG like the Gold OG." Gold and Diamond still need both $SEND and $GWC;
   Silver and Bronze need $SEND alone, and /api/og/campaign serves that as `needs`. Gold was promoted in two places: the strip at
   the top of the home page ("Become an OG legend", with the window's countdown — removed that morning with the $SEND-only
   landing redo, since Gold needed both coins) and the rocket rail on the invite ticket ("🥇 Gold OG closes in"). Both promote the
   open window again: the home page's banner (public/index.html #lp-og, filled by home.js) while that window needs $SEND alone,
   and the ticket's rail always. This suite holds both to that.
     1. The copy (no browser): every page that states the OG rule states this one, and the scripts read the rule from the
        campaign (`needs`) rather than restating it — the dashboard card, its "Revoked, not drained" card, the rulebook, the
        Arcade's OG card (and its line for a revoked member), the About page's state line, the badge tooltips, the ticket, and
        the home page's banner.
     2. In a muted headless Chrome against the runner's throwaway server (the real calendar: the beta ended 2026-11-17):
          · the home page's banner, as a signed-out visitor: at 320 and 1280 px it is a strip (closed, one button at most
            64px tall from 760px and 110px on a phone; its head opens the details, owner 2026-11-24) and shows "OG Silver is open · 5× Send Power"
            in silver with the countdown to Silver's close, the beta line, no other coin named, its link at least 44px, every
            word at the text floor and nothing past the screen's edge; with the PAGE's clock moved (Date.now shifted; the
            server's stays real) it is hidden before the beta ended (Gold needed both coins), promotes Bronze in bronze
            halfway through Bronze (no beta line), and is hidden once every window has closed;
          · the ticket on /about, opened as a signed-out visitor: at 320 and 1280 px it says "🥈 Silver OG closes in <time>",
            in silver, with the 🚀 between 0 and 100% along a rail that runs from the beta's end to Silver's close (where it
            should be for this moment, to within half a percent), the screen-reader label saying the same, every word at the
            text floor and nothing past the screen's edge; with the page's clock moved: halfway through Silver the rocket is
            at 50%; halfway through Bronze it says "🥉 Bronze OG closes in" in bronze at 50%; after Bronze it says every
            window has closed.
   Without Chrome (a CI runner with none) the browser part is skipped and the run says so; on a machine that has one, a browser
   that will not start fails. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const DAY = 864e5;

/* ═══ 1. the copy ═══ */
const pub = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const GAM = pub('gamify.js'), CMP = pub('compete.js'), ABJ = pub('about.js'), APP = pub('app.js'), INV = pub('invite.js'), GCSS = pub('gate.css');
const ABOUT = pub('about.html'), WP = pub('whitepaper.html'), README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

check('the dashboard reads which coins a tier needs from the campaign (needs), and an older payload without it means both',
  /const n = c && c\.needs && c\.needs\[tier\];\s*return Array\.isArray\(n\) && n\.length \? n : \['SEND', 'GWC'\];/.test(GAM));
check('  ...the open-window card says "$Send" alone for a tier that needs only $SEND, and still says "Not a reason to buy"',
  /ogNeeds\(c, c\.tierNow\)\.length > 1/.test(GAM) && /A wallet that bought <b>\$Send<\/b> before it shuts/.test(GAM) && /\$GWC isn’t needed\. '\s*\+ 'Sell out of \$Send and it’s gone for good\. Not a reason to buy\.'/.test(GAM));
check('  ...a Silver or Bronze badge holder is told they bought $Send and to keep holding $Send',
  /You bought <b>' \+ \(both \? 'both \$Send and \$GWC' : '\$Send'\) \+ '<\/b> '/.test(GAM) && /Keep holding <b>\$Send<\/b> — this tier doesn’t need \$GWC/.test(GAM));
check('  ...the boost strip pays OG while the coins the TIER needs are held (Silver/Bronze: $SEND alone), as the server\'s ogSoldOut does',
  /const ogHeld = ogNeeds\(g\.ogCampaign, Number\(g\.ogTier \|\| g\.og\) \|\| 0\)\.every\(/.test(GAM) && !/\(h\.sendTok \|\| 0\) > 0 && \(h\.gwcTok \|\| 0\) > 0\); \/\/ OG pays only while/.test(GAM));
check('  ...the rulebook: Gold and Diamond needed both, Silver and Bronze need only $Send since the beta ended, and a $Send buy from the beta is Silver, never Gold',
  /<b>Gold and Diamond needed both \$Send and \$GWC<\/b>; since the beta ended, <b>Silver and Bronze need only \$Send<\/b>/.test(GAM) && /without \$GWC it is Silver, never Gold/.test(GAM)
  && /<li><b>Sell out entirely of \$Send, ever, and the badge is revoked for good\.<\/b> Sell out of \$GWC alone and a Gold or Diamond badge drops to Silver — what the \$Send it was earned on, bought before the beta ended, earns on its own/.test(GAM));
// since the owner's "Drop to Silver" (2026-11-17): selling $SEND ends a badge for good, selling $GWC alone drops a Gold or Diamond
check('  ...and the "Revoked, not drained" card says the same — $SEND ends a badge for good, $GWC alone drops Gold and Diamond to Silver, unlinking only pauses — keeping the old line only for a payload without `needs`',
  /'<b>Sell out entirely of \$SEND and your OG badge is revoked for good\.<\/b> Sell out of \$GWC alone and a Gold or Diamond badge drops to Silver on \$SEND alone/.test(GAM)
  && /Unlinking a wallet is not a sale: it pauses what your other wallets can’t show, and relinking it brings that back \(Gold or Diamond only with \$GWC held without a break meanwhile\)\./.test(GAM)
  && /\(ogSendOnlyTiers\(g\.ogCampaign\)\s*\? '<b>Sell out entirely of \$SEND and your OG badge/.test(GAM)
  && !/either \$SEND or \$GWC for Gold and Diamond/.test(GAM));
check('the Arcade\'s OG card reads o.needs (and falls back to both), and words the ladder and the "how" by it',
  /const n = o\.needs && o\.needs\[t\]; return Array\.isArray\(n\) && n\.length \? n : \['SEND', 'GWC'\];/.test(CMP) && /'\$SEND only'/.test(CMP) && /Since the beta ended, Silver and Bronze need only <b>\$SEND<\/b>/.test(CMP));
check('  ...a revoked member is told the badge is gone for good, never invited to earn one in the open window (the server never re-grants a revoked account)',
  /else if \(o\.mine && o\.mine\.revoked\) me = '<b>OG status removed\.<\/b> This account’s linked wallets were found holding no \$SEND, which every badge needs, so the badge and its Send Power bonus are gone — and can’t be reclaimed, whichever window is open\.';/.test(CMP)
  && CMP.indexOf('o.mine && o.mine.revoked') < CMP.indexOf("window goes to wallets that bought <b>$SEND</b>"));
check('the About page\'s state line says when the open window needs only $SEND, read from the campaign',
  /const need = c\.needs && c\.needs\[c\.tierNow\];/.test(ABJ) && /it needs only \$SEND\./.test(ABJ));
check('the OG badge tooltip: Diamond and Gold "BOTH $Send and $GWC" (dropping to Silver on a $GWC sell-out), Silver and Bronze "$Send" alone, and every tier lost only by selling out of $Send',
  /4: \{ name: 'Diamond', mult: 20, both: true,/.test(APP) && /3: \{ name: 'Gold', mult: 10, both: true,/.test(APP) && /2: \{ name: 'Silver', mult: 5, both: false,/.test(APP) && /1: \{ name: 'Bronze', mult: 3, both: false,/.test(APP)
  && /\+ \(t\.both \? 'Drops to Silver if they sell out of \$GWC; lost if they sell out of their \$Send\.' : 'Lost if they sell out of their \$Send\.'\);/.test(APP));
check('the ticket builds its rail words from the campaign (no fixed "Gold OG closes in"), with Silver\'s rail starting at the beta\'s end',
  !/Gold OG closes in/.test(INV) && /w\.medal \+ ' ' \+ w\.name \+ ' OG closes in'/.test(INV) && /Number\(c\.betaEndsAt\)/.test(INV) && /'🏅 Every OG window has closed'/.test(INV));
check('  ...and gate.css colours the rail by the window: the site\'s silver and bronze tokens, never literals in the rules',
  /--g-silver:\s+var\(--silver, #cfd6e4\);/.test(GCSS) && /--g-bronze:\s+var\(--bronze, #e2a465\);/.test(GCSS)
  && /\.tk-launch\[data-og="silver"\] \{ --tk-c: var\(--g-silver\); \}/.test(GCSS) && /\.tk-launch\[data-og="bronze"\] \{ --tk-c: var\(--g-bronze\); \}/.test(GCSS)
  && !/rgba\(255,179,64/.test(GCSS.slice(GCSS.indexOf('/* the rocket countdown rail'), GCSS.indexOf('.tk-stub-n'))));
check('About: Silver and Bronze need only $SEND; Diamond and Gold needed both; the $100 floor is summed across linked wallets',
  /<b>Diamond and Gold needed both \$SEND and \$GWC<\/b>; since the beta ended, <b>Silver and Bronze need only \$SEND<\/b>/.test(ABOUT)
  && /🥈 Silver — 5×\.<\/b> Bought <b>\$SEND<\/b> — no \$GWC needed —/.test(ABOUT) && /🥉 Bronze — 3×\.<\/b> Bought <b>\$SEND<\/b> — no \$GWC needed —/.test(ABOUT)
  && !/Bought both in the 90 days after the beta ended/.test(ABOUT) && /counted across all your linked wallets/.test(ABOUT));
check('White Paper: the same rule',
  /Silver &mdash; 5&times;\.<\/strong> You bought \$SEND any time before Silver closes/.test(WP) && /Bronze &mdash; 3&times;\.<\/strong> You bought \$SEND after Silver closed/.test(WP)
  && /Silver and Bronze are lost only by selling out of \$SEND/.test(WP) && !/You bought both in the ninety days after the beta ended/.test(WP));
check('README §3.11: the table says which coins each tier needs, and the rail\'s Silver banner is described',
  /\| 🥈 Silver \| \*\*5×\*\* \| \*\*\$Send only\*\* \|/.test(README) && /\| 🥉 Bronze \| \*\*3×\*\* \| \*\*\$Send only\*\* \|/.test(README) && /\| 🥇 Gold \| \*\*10×\*\* \| both coins \|/.test(README)
  && /\*\*"🥈 Silver OG closes in"\*\*/.test(README) && /capped at Silver/.test(README));
/* The owner's two decisions the same day: "Drop to Silver" (a Gold or Diamond that sells out of $GWC but keeps $SEND keeps a
   badge on $SEND alone; only selling out of $SEND ends one for good) and "Re-check and restore" (badges already lost that way
   are re-checked once). Every page that states the rule states these, and the dashboard and the Arcade say when an account
   is waiting on either. */
/* 2026-11-18 review (finding 11): a Gold or Diamond drop is ALWAYS Silver (its own pre-beta $SEND buy proves it — ogDropPick), so no
   page may promise "Silver or Bronze" for it, nor a drop that might end the badge */
check('the drop is stated wherever the rule is: About, the White Paper, README §3.11, the Arcade\'s OG card — $SEND ends a badge, $GWC alone drops Gold and Diamond to Silver (never "Silver or Bronze")',
  /<b>Sell out entirely of \$SEND, ever, and it's revoked for good\.<\/b> Sell out of \$GWC alone and a Diamond or Gold badge <b>drops to Silver<\/b> — what the \$SEND it was earned on, bought before the beta ended, earns on its own/.test(ABOUT)
  && /Sell out entirely of \$SEND, at any time, and the badge is revoked for good\. Sell out of \$GWC alone while still holding \$SEND and a Diamond or Gold badge is not revoked: it drops to Silver at once/.test(WP)
  && /\*\*Losing it\.\*\* Sell out entirely of \*\*\$Send\*\*, at any time, and the badge is revoked \*\*for good\*\* — whatever the tier\. Sell out of \*\*\$GWC alone\*\* while still holding \$Send and a Diamond or Gold badge \*\*drops to Silver\*\* instead/.test(README)
  && /sell out of \$GWC alone and a Gold or Diamond drops to Silver on \$SEND alone/.test(CMP)
  && ![ABOUT, WP, CMP, README, GAM, APP].some((t) => /drops? (them |it )?to Silver or Bronze|Drops to Silver or Bronze/.test(t))
  && !/either coin for (Gold and Diamond|Diamond and Gold), \$SEND for Silver and Bronze/.test(ABOUT + WP + CMP + README));
check('  ...and the restore: About, the White Paper and README say a badge lost before the rule is re-checked once, and nobody who sold out of $SEND is restored',
  /Badges removed before this rule \(when selling either coin ended any tier\) are re-checked on-chain once, on the wallets that were linked when they were removed/.test(ABOUT) && /Nobody who sold out of \$SEND is restored\./.test(WP)
  && /reading only the wallets that were linked when the badge was removed/.test(WP) && /reading \*\*only the wallets that were linked when the badge was removed\*\*/.test(README)
  && /\*\*Badges lost before this rule are re‑checked once\*\*/.test(README) && /nobody who sold out of \$Send is restored/.test(README));
check('the dashboard says when a Gold or Diamond is being re-decided on $Send alone (ogRequal, paid nothing meanwhile) and when a removed badge waits for its one re-check (ogRestorePending); the Arcade card says the second too',
  /if \(g\.ogRequal\) return '<div class="og-block/.test(GAM) && /No OG bonus is paid until that’s done; you’ll get a notification\./.test(GAM) && /ogHeld && !g\.ogRequal\);/.test(GAM)
  && /if \(g\.ogRevoked && g\.ogRestorePending\) return/.test(GAM) && /else if \(o\.mine && o\.mine\.revoked && o\.mine\.recheck\) me = '<b>OG status removed — being re-checked once\.<\/b>/.test(CMP));
/* 2026-11-18 review: the states the server now serves are each said as they are — the pending re-decision with no bonus (findings 6+9,
   also on the Arcade card), a re-checked removal that never claims a $SEND sale (11), the one re-check promised only on the wallets
   linked when it was removed (12), and a pause by unlinking that never reads as a sale (10) */
check('the Arcade card shows a Gold or Diamond waiting on its drop as that, with no bonus — before the "You hold OG … ×" line',
  /else if \(o\.mine && o\.mine\.og && o\.mine\.tier && o\.mine\.requal\) me = '<b>OG ' \+ esc\(o\.mine\.name\) \+ ' — moving to Silver\.<\/b>/.test(CMP) && /No OG bonus is paid until it’s written\./.test(CMP)
  && CMP.indexOf('o.mine.requal) me =') < CMP.indexOf("me = 'You hold <b>OG '"));
check('  ...a removal re-checked and not restored never says $SEND was sold, on the card or the dashboard (ogRechecked / o.mine.rechecked)',
  /else if \(o\.mine && o\.mine\.revoked && o\.mine\.rechecked\) me = '<b>OG status removed\.<\/b> It was removed under the old rule/.test(CMP)
  && /if \(g\.ogRevoked && g\.ogRechecked\) return '<div class="og-block og-block-lost">/.test(GAM)
  && !/\bsold\b/i.test(GAM.slice(GAM.indexOf('if (g.ogRevoked && g.ogRechecked)'), GAM.indexOf('</div></div>', GAM.indexOf('if (g.ogRevoked && g.ogRechecked)'))))
  && !/\bsold\b/i.test(CMP.slice(CMP.indexOf('o.mine.rechecked) me ='), CMP.indexOf('\n', CMP.indexOf('o.mine.rechecked) me =')))));
check('  ...the one re-check is promised only on the wallets linked when the badge was removed (a wallet linked since doesn\'t count)',
  /it is being re-checked on-chain, on the wallets that were linked when it was removed \(a wallet linked since doesn’t count\)/.test(GAM) && /A wallet linked since doesn’t count\./.test(CMP));
check('  ...and a badge paused by unlinking is said as a pause — on the dashboard, the Arcade card, the record and the unlink toast — never as a sale',
  /if \(Number\(g\.ogPausedTier\) > 0\) \{/.test(GAM) && /is paused:<\/b> the wallet holding its \$GWC was unlinked, which is not a sale/.test(GAM)
  && /else if \(o\.mine && o\.mine\.paused\) me = 'Your <b>OG '/.test(CMP) && /o\.mine\.paused > o\.mine\.tier \?/.test(CMP)
  && /j\.ogPaused === 'gwc' \? ' — it holds your \$GWC, so your OG badge is paused at Silver until you relink it'/.test(pub('profile.js')));
check('  ...and selling out of $SEND while a badge is paused ends it for good: the dashboard, the Arcade card, About, the White Paper and README say so',
  /<b>Sell out of \$Send while it is paused and it ends for good<\/b>/.test(GAM) && /Sell out of \$SEND while it’s paused and it ends for good\./.test(CMP)
  && /selling out of \$SEND while a badge is paused ends it for good/.test(ABOUT) && /Selling out of \$SEND while a badge is paused is selling out/.test(WP) && /never re‑granted after its \*\*\$Send\*\* was sold out while paused \(`ogPauseHeld`\)/.test(README));
check('  ...and none of the new copy tells anyone to buy', !/\b(buy now|you should buy|go buy|buy more|buy \$GWC again to)\b/i.test(GAM + CMP + ABOUT.slice(ABOUT.indexOf('id="og-rules"'), ABOUT.indexOf('id="og-rules"') + 9000)));

/* ═══ 2. in a browser ═══ */
function findChrome() {
  const c = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}
const CHROME = findChrome();
let ws = null, session = null, seq = 0, chromeProc = null, profile = null, clockScript = null;
const pend = new Map(), errors = [];
const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function until(expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(100); }
  return null;
}
async function startChrome() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jsi-ogbanner-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', '--hide-scrollbars', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  chromeProc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let err = ''; chromeProc.stderr.on('data', (d) => { err += d; });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100);
  if (!fs.existsSync(portFile)) throw new Error('Chrome did not open its debugging port: ' + err.slice(0, 300));
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('could not connect to Chrome')); });
  ws.onmessage = (m) => {
    const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
    if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text || '').split('\n')[0]);
  };
  const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
  session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  // a returning visitor who has answered the 18+ question, seen the intro and skipped the tour: nothing over the page but the ticket
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.clear(); localStorage.setItem('jsi-tour-v1', 'skipped'); sessionStorage.setItem('intro-seen', '1'); } catch (e) {}" });
  await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });
}
/* The page's clock, moved by `shift` ms: Date.now() only, which is what the ticket's rail reads. The server's clock stays real,
   so the campaign it serves is the real one and only the reader's moment moves through it. */
async function setClock(shift) {
  if (clockScript) { await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript }); clockScript = null; }
  if (!shift) return;
  clockScript = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = Date.now.bind(Date), off = ${Math.round(shift)}; Date.now = () => real() + off; })();` })).identifier;
}
// the ticket, as a signed-out visitor meets it on /about
async function openTicket(width, shift) {
  await setClock(shift);
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 760 : 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Page.navigate', { url: BASE + '/about' });
  await until('document.readyState === "complete" && window.AUTH && AUTH.openInvite', 15000);
  await ev('AUTH.openInvite({ step: "step-ticket" }), true');   // open sign-up (2026-11-24): the ticket is asked for by name
  if (!await until('document.querySelector("#invite-overlay[data-open] #step-ticket[data-active]")', 10000)) throw new Error('the ticket did not open');
  if (!await until('!!document.querySelector("#invite-overlay #tk-launch[data-og]")', 10000)) throw new Error('the rail was never painted from the campaign');
  await sleep(800);   // the rocket's 600ms glide to where it belongs
}
const LOOK = `(() => {
  const $ = (id) => document.getElementById(id);
  const ov = $('invite-overlay'), box = $('tk-launch'), k = $('tk-launch-k'), v = $('tk-launch-v'), rocket = $('tk-rocket'), btn = $('ticket');
  const tok = (name, prop) => { const p = document.createElement('span'); p.style[prop] = 'var(' + name + ')'; box.appendChild(p); const val = getComputedStyle(p)[prop]; p.remove(); return val; };
  const floor = parseFloat(tok('--text-floor', 'fontSize'));
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const out = [], small = [];
  for (const el of $('step-ticket').querySelectorAll('*')) {
    if (!el.getClientRects().length || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > innerWidth + 1 || r.left < -1) out.push(desc(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < floor - 0.5) small.push(desc(el) + ' ' + cs.fontSize);
  }
  const rail = box.querySelector('.tk-rail').getBoundingClientRect(), rr = rocket.getBoundingClientRect();
  return { floor, k: k.textContent, v: v.textContent, og: box.getAttribute('data-og'), left: parseFloat(rocket.style.left),
    drawn: rail.width ? ((rr.left + rr.width / 2) - rail.left) / rail.width * 100 : null,
    kColor: getComputedStyle(k).color, vColor: getComputedStyle(v).color, silver: tok('--g-silver', 'color'), bronze: tok('--g-bronze', 'color'), gold: tok('--g-gold', 'color'), dim: tok('--g-dim', 'color'),
    label: btn.getAttribute('aria-label'), now: Date.now(), out: out.slice(0, 6), small: small.slice(0, 6),
    doc: document.documentElement.scrollWidth, iw: innerWidth, ovSW: ov.scrollWidth, ovCW: ov.clientWidth };
})()`;
const fits = (L) => !L.out.length && !L.small.length && L.doc <= L.iw && L.ovSW <= L.ovCW + 1;
/* the home page's banner, as a signed-out visitor meets it: loaded, and the campaign's answer has arrived and been painted */
async function openHome(width, shift) {
  await setClock(shift);
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await cdp('Page.navigate', { url: BASE + '/' });
  await until('document.readyState === "complete" && !!document.getElementById("lp-og")', 15000);
  if (!await until('performance.getEntriesByType("resource").some((e) => /\\/api\\/og\\/campaign$/.test(e.name) && e.responseEnd > 0)', 10000)) throw new Error('the home page never asked for the campaign');
  await sleep(300);
}
const HOME_LOOK = `(() => {
  const $ = (id) => document.getElementById(id);
  const box = $('lp-og'), go = box.querySelector('.lp-og-go'), head = $('lp-og-head'), more = $('lp-og-more');
  // the strip as it first stands (closed; a visit that left it open finds it open, so close it first), then opened by its head
  if (head.getAttribute('aria-expanded') === 'true') head.click();
  const closed = { h: Math.round(box.getBoundingClientRect().height), more: more.hidden, exp: head.getAttribute('aria-expanded'), text: box.innerText, tip: head.getAttribute('data-tip') || '', hh: Math.round(head.getBoundingClientRect().height) };
  head.click();
  const opened = { more: !more.hidden, exp: head.getAttribute('aria-expanded') };
  const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
  const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
  const tok = (name) => { const p = document.createElement('span'); p.style.color = 'var(' + name + ')'; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v; };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
  const out = [], small = [];
  for (const el of box.querySelectorAll('*')) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > innerWidth + 1 || r.left < -1) out.push(desc(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < floor - 0.5) small.push(desc(el) + ' ' + cs.fontSize);
  }
  const g = go.getBoundingClientRect();
  return { shown: !box.hidden && box.getClientRects().length > 0, og: box.getAttribute('data-og'), medal: $('lp-og-medal').textContent, name: $('lp-og-name').textContent, mult: $('lp-og-mult').textContent,
    left: $('lp-og-left').textContent, beta: !$('lp-og-beta').hidden, text: box.innerText, color: getComputedStyle($('lp-og-left')).color, silver: tok('--silver'), bronze: tok('--bronze'),
    go: { w: Math.round(g.width), h: Math.round(g.height), href: go.getAttribute('href'), tip: go.getAttribute('data-tip') || '' }, closed, opened, floor, out: out.slice(0, 6), small: small.slice(0, 6),
    doc: document.documentElement.scrollWidth, iw: innerWidth };
})()`;
const fitsWhy = (L) => JSON.stringify({ out: L.out, small: L.small, doc: L.doc, iw: L.iw, ovSW: L.ovSW, ovCW: L.ovCW, floor: L.floor });

let camp = null;
try { camp = await (await fetch(BASE + '/api/og/campaign')).json(); } catch (e) { check('the campaign clock answers (GET /api/og/campaign)', false, e.message); }
const C = camp && camp.closes;
const betaEnd = camp && (Number(camp.betaEndsAt) || (C && C.gold));
check('the campaign says which coins each tier needs: both for Diamond and Gold, $SEND alone for Silver and Bronze',
  !!camp && !!camp.needs && ['4', '3'].every((t) => JSON.stringify(camp.needs[t]) === '["SEND","GWC"]') && ['2', '1'].every((t) => JSON.stringify(camp.needs[t]) === '["SEND"]'), camp && JSON.stringify(camp.needs));

if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser walk: no Chrome or Chromium on this runner (set CHROME_PATH to run it)');
  else check('a Chrome or Chromium to open the ticket in (set CHROME_PATH)', false, 'none found');
} else if (C && C.gold && C.silver && C.bronze) {
  let up = false;
  try { await startChrome(); up = true; }
  catch (e) {
    if (process.env.CI) notes.push('skipping the browser walk: Chrome would not start here (' + e.message.slice(0, 160) + ')');
    else check('headless Chrome starts and takes commands', false, e.message);
  }
  if (up) {
    const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
    const expect = (now, from, to) => Math.min(100, Math.max(0, (now - from) / (to - from) * 100));
    const real = Date.now();
    /* — the home page's banner — */
    const COUNT = /^(\d+d \d+h \d+m|\d+h \d+m|\d+m)$/;
    if (real > C.gold && real < C.silver) {
      for (const w of [320, 1280]) {
        try {
          await openHome(w, 0);
          const H = await ev(HOME_LOOK);
          check(w + 'px: the home page\'s banner promotes Silver now the beta has ended: "OG Silver is open · 5× Send Power", 🥈, the countdown to Silver\'s close, in silver',
            H.shown && H.og === 'silver' && H.medal === '🥈' && H.name === 'Silver' && H.mult === camp.mult[2] + '×' && COUNT.test(H.left) && H.color === H.silver,
            JSON.stringify({ shown: H.shown, og: H.og, name: H.name, mult: H.mult, left: H.left, color: H.color, silver: H.silver }));
          check('  ...a strip, not a billboard: closed it is one button ' + (w >= 760 ? 'at most 64px tall' : 'at most 110px tall') + ' (name, "on $SEND alone", countdown), the details hidden; its head (a 44px target with a tip) opens them',
            H.closed.more && H.closed.exp === 'false' && H.closed.h <= (w >= 760 ? 64 : 110) && H.closed.hh >= 44 && H.closed.tip.length >= 8 && /OG Silver is open · \d+× Send Power/.test(H.closed.text.replace(/\s+/g, ' ')) && /on \$SEND alone/.test(H.closed.text) && /closes in \d/i.test(H.closed.text.replace(/\s+/g, ' ')) && !/Not a reason to buy/.test(H.closed.text) && H.opened.more && H.opened.exp === 'true',
            JSON.stringify({ closed: H.closed, opened: H.opened }));
          check('  ...on $SEND alone (no other coin named), with the beta line (a $SEND buy from during the beta counts as Silver) and "Not a reason to buy"',
            H.beta && /on \$SEND alone/.test(H.text) && /during the beta counts as Silver too/.test(H.text) && /Not a reason to buy\./.test(H.text) && !/gwc|generational/i.test(H.text), H.text);
          check('  ...its one way on is the OG rules, a 44px target with a tip', H.go.href === '/about#og-rules' && H.go.h >= 44 && H.go.w >= 44 && H.go.tip.length >= 8, JSON.stringify(H.go));
          check('  ...every word at the text floor (' + H.floor + 'px), nothing past the screen\'s edge, no sideways scroll', !H.out.length && !H.small.length && H.doc <= H.iw, JSON.stringify({ out: H.out, small: H.small, doc: H.doc, iw: H.iw }));
        } catch (e) { check('the home banner at ' + w + 'px ran to the end', false, e && e.message); }
      }
    } else notes.push('the server\'s calendar is not inside Silver (BETA_END moved?): the home banner\'s "now" walk is skipped; the moved-clock walks still run');
    try {
      await openHome(390, C.gold - 2 * DAY - Date.now());
      const H = await ev(HOME_LOOK);
      check('before the beta ended (the page\'s clock moved): no banner — the open window, Gold, needed both coins, and this page is about $SEND alone', !H.shown, JSON.stringify({ shown: H.shown, og: H.og }));
    } catch (e) { check('the before-the-beta home walk ran to the end', false, e && e.message); }
    for (const w of [320, 1280]) {
      try {
        await openHome(w, C.silver + (C.bronze - C.silver) / 2 - Date.now());
        const H = await ev(HOME_LOOK);
        check(w + 'px, halfway through Bronze: once Silver has closed the banner promotes Bronze, 🥉 in bronze, ' + camp.mult[1] + '×, without the beta line',
          H.shown && H.og === 'bronze' && H.medal === '🥉' && H.name === 'Bronze' && H.mult === camp.mult[1] + '×' && !H.beta && COUNT.test(H.left) && H.color === H.bronze,
          JSON.stringify({ shown: H.shown, og: H.og, name: H.name, mult: H.mult, beta: H.beta, left: H.left, color: H.color, bronze: H.bronze }));
        check('  ...at the floor, inside the screen', !H.out.length && !H.small.length && H.doc <= H.iw, JSON.stringify({ out: H.out, small: H.small, doc: H.doc, iw: H.iw }));
      } catch (e) { check('the mid-Bronze home walk at ' + w + 'px ran to the end', false, e && e.message); }
    }
    try {
      await openHome(320, C.bronze + DAY - Date.now());
      const H = await ev(HOME_LOOK);
      check('after Bronze has closed: no banner (every window has closed, and it never states one it was not given)', !H.shown, JSON.stringify({ shown: H.shown, og: H.og }));
    } catch (e) { check('the after-Bronze home walk ran to the end', false, e && e.message); }
    /* — the ticket — */
    if (real > C.gold && real < C.silver) {
      /* — now: the beta has ended, Silver is open — */
      for (const w of [320, 1280]) {
        try {
          await openTicket(w, 0);
          const L = await ev(LOOK);
          const want = expect(L.now, betaEnd, C.silver);
          check(w + 'px: the ticket promotes Silver now the beta has ended: "🥈 Silver OG closes in ' + L.v + '"',
            L.og === 'silver' && L.k === '🥈 Silver OG closes in' && /^(\d+d \d+h|\d+h \d+m|\d+m)$/.test(L.v), JSON.stringify({ og: L.og, k: L.k, v: L.v }));
          check('  ...the rocket is between 0 and 100% along a rail from the beta\'s end to Silver\'s close, where this moment puts it (' + L.left + '% vs ' + want.toFixed(2) + '%)',
            L.left >= 0 && L.left <= 100 && near(L.left, want, 0.5) && near(L.drawn, L.left, 3), JSON.stringify({ left: L.left, want, drawn: L.drawn }));
          check('  ...in silver: the words wear the site\'s silver (' + L.silver + '), not gold', L.kColor === L.silver && L.vColor === L.silver && L.silver !== L.gold, JSON.stringify({ k: L.kColor, v: L.vColor, silver: L.silver, gold: L.gold }));
          check('  ...the screen-reader name says the same', (L.label || '').includes(' Silver OG closes in ' + L.v + '.'), L.label);
          check('  ...every word at the text floor (' + L.floor + 'px), nothing past the screen\'s edge, no sideways scroll', fits(L), fitsWhy(L));
        } catch (e) { check('the ticket at ' + w + 'px ran to the end', false, e && e.message); }
      }
    } else notes.push('the server\'s calendar is not inside Silver (BETA_END moved?): the "now" walk is skipped; the moved-clock walks still run');

    /* — the page's clock moved: halfway through Silver, halfway through Bronze, after Bronze — */
    const midSilver = betaEnd + (C.silver - betaEnd) / 2, midBronze = C.silver + (C.bronze - C.silver) / 2;
    try {
      await openTicket(390, midSilver - Date.now());
      const L = await ev(LOOK);
      check('halfway through Silver (the page\'s clock moved): "🥈 Silver OG closes in", the rocket at 50%', L.og === 'silver' && L.k === '🥈 Silver OG closes in' && near(L.left, 50, 0.5), JSON.stringify({ og: L.og, k: L.k, left: L.left }));
    } catch (e) { check('the mid-Silver walk ran to the end', false, e && e.message); }
    for (const w of [320, 1280]) {
      try {
        await openTicket(w, midBronze - Date.now());
        const L = await ev(LOOK);
        check(w + 'px, halfway through Bronze: once Silver has closed the ticket promotes Bronze, in bronze, the rocket at 50% of Silver\'s close → Bronze\'s',
          L.og === 'bronze' && L.k === '🥉 Bronze OG closes in' && near(L.left, 50, 0.5) && L.kColor === L.bronze && (L.label || '').includes(' Bronze OG closes in ' + L.v + '.'),
          JSON.stringify({ og: L.og, k: L.k, left: L.left, color: L.kColor, bronze: L.bronze, label: L.label }));
        check('  ...at the floor, inside the screen', fits(L), fitsWhy(L));
      } catch (e) { check('the mid-Bronze walk at ' + w + 'px ran to the end', false, e && e.message); }
    }
    try {
      await openTicket(320, C.bronze + DAY - Date.now());
      const L = await ev(LOOK);
      check('after Bronze has closed: the ticket says every OG window has closed (no countdown), dimmed, and so does its screen-reader name',
        L.og === 'closed' && L.k === '🏅 Every OG window has closed' && L.v === '' && L.kColor === L.dim && (L.label || '').endsWith(' Every OG window has closed.'),
        JSON.stringify({ og: L.og, k: L.k, v: L.v, color: L.kColor, dim: L.dim, label: L.label }));
      check('  ...at the floor, inside the screen', fits(L), fitsWhy(L));
    } catch (e) { check('the after-Bronze walk ran to the end', false, e && e.message); }
    await setClock(0);
    check('no script error on any load', errors.length === 0, errors.slice(0, 4).join(' | '));
  }
}

try { if (ws) ws.close(); } catch {}
if (chromeProc) { try { process.kill(-chromeProc.pid, 'SIGKILL'); } catch {} try { chromeProc.kill('SIGKILL'); } catch {} await sleep(300); }
if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
for (const n of notes) console.log('NOTE ' + n);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
