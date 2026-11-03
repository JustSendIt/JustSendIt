/* ===== The Arcade's sendy.gg card (owner, 2026-11-03: "Preview play now on Sendy.GG on the Arcade page on SendRH.com") =====
   sendy.gg is the owner's 3D game, Send: Diamond Forge (also called Sendy's Metaverse). It cannot be framed (it sends
   X-Frame-Options: DENY and frame-ancestors 'none'), so the Arcade previews it with one still, served from this site, and
   links out. The game's welcome video is NOT here, in git or on the site, until the game re-renders it from a public save and
   re-voices it: its narration is a macOS system voice, which Apple licenses for personal, non-commercial use only, and this
   repository is a CC0 release (.gitignore: "you cannot waive rights you do not hold").

   1. The files: the card is the Arcade's featured game (owner, 2026-11-03: "Make Sendy.gg the first Game promoted on the arcade
      page"): the first card in <main>, before Rocket Run, the slot machine and the competitions, its heading labelled
      "Featured game", the hero and the page's title, description and social cards leading with it, and the first skip link
      going to it and saying it goes to the preview on this page; the one link is absolute https://sendy.gg/, opens a new tab with rel="noopener", is
      described (data-tip) and says it goes to another site; the preview is one still (no <video>, <audio>, <track> or frame),
      the title card of the game's guide with its emoji tile painted out (an Apple Color Emoji rocket, which this CC0 repo
      cannot give away); nothing in the card points at another host but that link; the copy says only what the game's own
      docs and code bear out (moves are calls to the contract, signing up is 18+ and free with no wallet, a shared practice
      world with free play money, a guest look-around, a separate site this site's operator also runs, no real money,
      entertainment only), under both of the game's names (the Sign in with Send consent page shows the other one), and
      nothing they do not (no "Sign in with Send" there, which is off on sendy.gg; no privacy notice, none being found there;
      no "buy"; no Robinhood or testnet) — read from every word the card shows or says, alt text and tips included. The video
      and its captions are in neither git nor public/assets; the still is in both. The Terms' "we do not control" linked
      sites names sendy.gg as the exception, and their version moved with the server's.
   2. The runner's server: /arcade carries the card with the still versioned (?v=); the still is image/jpeg and its versioned
      copy cached for good; the video and its captions are not served (404).
   3. A muted headless Chrome at 320, 390, 1280 and 1920 px: no sideways scroll, nothing in the card past the screen's edge,
      no text under the floor, the link at least 44 px, stacked on a phone and side by side on a wide screen; nothing loads
      from another host and no video is asked for; scrolled to, the still loads from this site at 1280x720, with its emoji
      tile gone. Without a Chrome (a CI runner) the browser part is skipped and says so.
   Screenshots of the card at each width go to $ARCADE_SHOTS when it names a folder. */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PORT = process.argv[2], BASE = `http://localhost:${PORT}`;
const PUB = path.join(ROOT, 'public');
const read = (f) => readFileSync(path.join(PUB, f), 'utf8');
const results = [], notes = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)(?:\s*=\s*"([^"]*)")?/g)].slice(1).map((m) => [m[1].toLowerCase(), m[2] === undefined ? '' : m[2]]));
const NAMED = { amp: '&', rsquo: '’', lsquo: '‘', nbsp: ' ', mdash: '—', ndash: '–', quot: '"', '#39': "'" };
const ent = (h) => h.replace(/&(#?\w+);/g, (m, e) => NAMED[e] ?? m);
const textOf = (h) => ent(h.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const JPG = 'assets/sendygg-welcome.jpg', MP4 = 'assets/sendygg-welcome.mp4', VTT = 'assets/sendygg-welcome.vtt';
// where the poster's emoji tile was (x0, y0, x1, y1): an Apple Color Emoji rocket in a lit box, every pixel of it brighter than 40
const TILE = [56, 178, 151, 273];

/* ═══ 1. the files ═══ */
const HTML = read('arcade.html'), SRV = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ACSS = read('arcade.css'), RESP = read('responsive.css'), TERMS = read('terms.html');
const cardAt = HTML.indexOf('<section class="card sgg-card" id="sendygg"');
const cardEnd = cardAt < 0 ? -1 : HTML.indexOf('</section>', cardAt);
const CARD = cardAt < 0 ? '' : HTML.slice(cardAt, cardEnd + 10);
const CARD_TEXT = textOf(CARD);
// every word the card shows or says: its text, and the words in its attributes (alt, data-tip, aria-label, title)
const CARD_WORDS = [CARD_TEXT, ...[...CARD.matchAll(/\s(?:alt|data-tip|aria-label|title)="([^"]*)"/g)].map((m) => ent(m[1]))].join(' ');
try {
  check('the Arcade has a sendy.gg card, labelled by its heading', cardAt > 0 && /aria-labelledby="sendygg-h"/.test(CARD) && /<h2 class="arc-game-h" id="sendygg-h">💎 Send: Diamond Forge <span class="sgg-badge">⭐ Featured game<\/span><\/h2>/.test(CARD), CARD.slice(0, 200));
  const MAIN = HTML.indexOf('<main id="main"'), firstSection = HTML.indexOf('<section', MAIN);
  check('  ...the first game on the page: the first card in <main>, before Rocket Run, the slot machine and the competitions', MAIN > 0 && firstSection === cardAt && cardAt < HTML.indexOf('<section class="card arc-game" id="arc-game"') && cardAt < HTML.indexOf('<section class="card slot-card" id="slots"') && cardAt < HTML.indexOf('<section class="cmp" id="cmp"'));
  check('  ...its badge rides the text floor and is styled once, in arcade.css', /\.sgg-badge \{[^}]*font-size: max\(var\(--text-floor\), [^}]*\}/.test(readFileSync(path.join(ROOT, 'public', 'arcade.css'), 'utf8')));
  const skipM = [...HTML.matchAll(/<a class="skip-link" href="#([^"]+)">([^<]+)<\/a>/g)];
  const skips = skipM.map((m) => m[1]), skipText = (skipM[0] || [])[2] || '';
  check('  ...and the skip links follow the page: the featured game (the top of <main>), Rocket Run, the slot machine, the competitions', skips.join(' ') === 'main arc-game slots cmp', skips.join(' '));
  check('  ...the card\'s skip link says it goes to the preview on this page, not that it leaves for sendy.gg', /preview/i.test(skipText) && !/sendy\.gg/i.test(skipText), skipText);
  check('  ...and the hero names it first, linking to the card', /<header class="np-hero">[\s\S]*?<p class="section-sub"[^>]*>First, the featured game: <a href="#sendygg"><b>Send: Diamond Forge<\/b><\/a>/.test(HTML));
  const metaOf = (re) => ((HTML.match(re) || [])[1] || '');
  check('  ...and so do the page\'s title, description and social cards', /^Arcade: Diamond Forge,/.test(metaOf(/<title>([^<]*)<\/title>/)) && /^Send: Diamond Forge/.test(metaOf(/<meta name="description" content="([^"]*)"/)) && /Send: Diamond Forge on sendy\.gg first/.test(metaOf(/<meta property="og:title" content="([^"]*)"/)) && /^Send: Diamond Forge/.test(metaOf(/<meta name="twitter:description" content="([^"]*)"/)));

  // the one way to the game: an absolute, outside, described link that opens a new tab
  const links = [...CARD.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  const out = links.filter((l) => /sendy\.gg/i.test(attrs(l.slice(0, l.indexOf('>') + 1)).href || ''));
  const a = out.length === 1 ? attrs(out[0].slice(0, out[0].indexOf('>') + 1)) : {};
  check('one link to the game: href exactly https://sendy.gg/, a new tab, rel="noopener"', out.length === 1 && a.href === 'https://sendy.gg/' && a.target === '_blank' && /(^|\s)noopener(\s|$)/.test(a.rel || ''), out.join(' | '));
  check('  ...a control (class btn) with a description of 8+ characters that says it opens another site in a new tab', /(^|\s)btn(\s|$)/.test(a.class || '') && (a['data-tip'] || '').length >= 8 && /new tab/i.test(a['data-tip'] || '') && /sendy\.gg/.test(a['data-tip'] || ''), a['data-tip']);
  check('  ...reading "Play now on sendy.gg", marked as an outside link (↗, and the words for a screen reader)', out.length === 1 && /Play now on sendy\.gg ↗/.test(textOf(out[0])) && /<span class="sr-only">[^<]*separate site[^<]*new tab[^<]*<\/span>/.test(out[0]), out[0]);
  check('  ...and the page says so in words beside it: an outside link, a separate site', /outside link/i.test(CARD_TEXT) && /separate site/i.test(CARD_TEXT));

  // the preview: one still from this site, and no video, sound, captions or frame
  const imgs = [...CARD.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]), im = imgs.length === 1 ? attrs(imgs[0]) : {};
  check('the preview is one still from this site (an <img>), sized 1280x720 so the page does not jump when it arrives', imgs.length === 1 && im.src === JPG && im.width === '1280' && im.height === '720' && /(^|\s)sgg-shot(\s|$)/.test(im.class || ''), imgs.join(' | '));
  check('  ...described in words for a screen reader (alt names Sendy and the title card), and loaded at once (it opens the page)', (im.alt || '').length >= 20 && /Sendy/.test(im.alt || '') && /title card/.test(im.alt || '') && im.loading === undefined && im.fetchpriority === 'high', im.alt);
  check('  ...and there is no video, sound, caption track or frame in the card (the welcome video stays out until the game re-renders and re-voices it)', !/<(video|audio|source|track|iframe|object|embed)\b/i.test(CARD) && !/\.(mp4|m4v|webm|mov|vtt|m4a|mp3|ogg|wav)\b/i.test(CARD), (CARD.match(/<(video|audio|source|track|iframe|object|embed)\b[^>]*>/i) || [''])[0]);
  const sggNames = [...new Set([...HTML.matchAll(/sendygg-[\w.-]+/g)].map((m) => m[0]))];
  check('  ...nor anywhere else on the page (its only sendygg- names are the heading\'s id and the still)', sggNames.every((n) => n === 'sendygg-h' || n === 'sendygg-welcome.jpg') && sggNames.includes('sendygg-welcome.jpg'), sggNames.join(' '));
  const refs = [...CARD.matchAll(/\b(?:src|href|poster|srcset)="([^"]+)"/g)].map((m) => m[1]).filter((u) => u !== 'https://sendy.gg/');
  check('  ...and nothing else in the card points at another host (the still is its only other reference)', refs.length === 1 && refs[0] === JPG, refs.join(' '));
  check('  ...its caption says what the still is, without claiming a length or captions it does not have', /title card that opens the game’s own guide/.test(CARD_TEXT) && !/seconds|captions on|plays from this site/i.test(CARD_TEXT), CARD_TEXT.slice(0, 300));

  // the copy: what the game's own docs and code bear out, and nothing they do not
  check('the copy says what it is: Sendy\'s 3D game, one smart contract with a world inside it, every move you make there a real call to it', /3D game/.test(CARD_TEXT) && /one smart contract with a whole world inside it/.test(CARD_TEXT) && /every move you make there is a real call to that contract/.test(CARD_TEXT));
  check('  ...not that every button is a call (the title, map, guide and chat make none, and a guest\'s move only offers "Sign up")', !/every button/i.test(CARD_WORDS), CARD_WORDS);
  const seedName = ent(((/OIDC\.seedFirstParty\(\{ clientId: 'sendy\.gg', name: '((?:[^'\\]|\\.)*)'/.exec(SRV) || [])[1] || '').replace(/\\'/g, '’'));
  check('  ...under both of the game\'s names: its title (Send: Diamond Forge) and the name Sign in with Send shows on its consent page', seedName.length > 3 && /Send: Diamond Forge/.test(CARD_TEXT) && CARD_TEXT.includes(seedName), seedName + ' | ' + CARD_TEXT.slice(0, 160));
  check('  ...that you sign up to play (18 or over; free, no wallet) a shared practice world with free play money, or look round as a guest', /you can sign up \(18 or over; free, no wallet\) and play the shared practice world/.test(CARD_TEXT) && /free play money/.test(CARD_TEXT) && /as a guest without an account/.test(CARD_TEXT));
  check('  ...not that anyone can play (playing needs a sign-up; a guest only looks around)', !/anyone can play/i.test(CARD_WORDS), CARD_WORDS);
  check('  ...that it is one world for everyone, so other players see your moves (PUBLIC.md: "anyone can see your moves")', /other players can see your moves/.test(CARD_TEXT));
  check('  ...a separate site this site\'s operator runs too, play money only, no real money, entertainment only', /separate site, not part of this one, though this site’s operator runs it too/.test(CARD_TEXT) && /no real money/.test(CARD_TEXT) && /Entertainment only/.test(CARD_TEXT), CARD_TEXT);
  check('  ...and nothing the live game does not do, in any word the card shows or says (alt text and tips too): no "Sign in with Send" there (off on sendy.gg), no privacy notice (none found there), no buying, no Robinhood, no testnet, no game on your own computer',
    CARD_WORDS.length > CARD_TEXT.length && !/sign in with/i.test(CARD_WORDS) && !/privacy/i.test(CARD_WORDS) && !/\bbuy/i.test(CARD_WORDS) && !/robinhood/i.test(CARD_WORDS) && !/testnet/i.test(CARD_WORDS) && !/this computer|your (own )?computer/i.test(CARD_WORDS), CARD_WORDS);

  // the media: the still is here and kept; the video and its captions are neither here nor in git
  check('the still is here', existsSync(path.join(PUB, JPG)));
  const jpg = readFileSync(path.join(PUB, JPG)); let jw = 0, jh = 0;
  for (let i = 2; i < jpg.length - 9;) { if (jpg[i] !== 0xff) break; const mk = jpg[i + 1], ln = jpg.readUInt16BE(i + 2); if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { jh = jpg.readUInt16BE(i + 5); jw = jpg.readUInt16BE(i + 7); break; } i += 2 + ln; }
  check('  ...a 1280x720 JPEG', jpg[0] === 0xff && jpg[1] === 0xd8 && jw === 1280 && jh === 720, jw + 'x' + jh);
  const onDisk = readdirSync(path.join(PUB, 'assets')).filter((f) => /^sendygg/i.test(f));
  check('  ...and it is the only sendy.gg file in public/assets: no video, no captions (nothing for the server to hand out)', onDisk.length === 1 && onDisk[0] === 'sendygg-welcome.jpg' && !existsSync(path.join(PUB, MP4)) && !existsSync(path.join(PUB, VTT)), onDisk.join(' '));
  let tracked = null;
  try { tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'public/assets'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((f) => /sendygg/i.test(f)); } catch { tracked = null; }
  if (tracked === null) notes.push('git is not here (not a checkout): the tracked-files check is skipped');
  else check('  ...git tracks the still and nothing else of the game\'s (git ls-files: no sendygg-welcome.mp4, no .vtt)', tracked.length === 1 && tracked[0] === 'public/' + JPG, tracked.join(' '));
  const GI = readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), DI = readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
  const kept = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  check('  ...neither git nor Docker leaves the still out (and the three rights-held files stay out of git, as before)',
    kept(GI).concat(kept(DI)).every((l) => !/sendygg|\.jpg$|^public\/assets\/?$|^public\/?$|^assets/.test(l) || /^public\/assets\/(justsendit-full\.mp4|full-send-poster\.jpg|justsendit-audio\.m4a)$/.test(l))
    && ['public/assets/justsendit-full.mp4', 'public/assets/full-send-poster.jpg', 'public/assets/justsendit-audio.m4a'].every((f) => kept(GI).includes(f)));

  // the Terms: "we do not control" linked sites, except the one this card links to
  const s34 = (/<section class="t-sec" id="s34">[\s\S]*?<\/section>/.exec(TERMS) || [''])[0];
  check('the Terms\' outside-links clause names sendy.gg as the exception to "we do not control them": a separate site, but we run it too', /We do not control them, do not endorse them/.test(s34) && /<p>The one exception to “we do not control them” is sendy\.gg, the game linked from the Arcade: it is a separate site, but we run it too\.<\/p>/.test(s34), s34.slice(-400));
  const tv = (/const TOS_VERSION = '([^']+)';/.exec(SRV) || [])[1];
  check('  ...and the Terms\' version moved with the server\'s (2026-11-03)', tv === '2026-11-03' && /<p class="t-meta">Version 2026-11-03 · /.test(TERMS) && /\/\/ 2026-11-03: §34 says we run sendy\.gg too/.test(SRV), tv);

  // the look
  check('the link is a full-width button at least 44 px tall (56 here), in the page font and the floor', /\.sgg-play \{[^}]*min-height: 56px;/.test(ACSS) && /\.sgg-play \{[^}]*font-size: max\(var\(--text-floor\)/.test(ACSS));
  check('  ...the still fills its column at 16:9 with the card\'s rounded frame', /\.sgg-shot \{[^}]*width: 100%; height: auto; aspect-ratio: 16 \/ 9;/.test(ACSS) && !/sgg-video/.test(ACSS + RESP));
  check('  ...and on a wide screen the still and the words sit side by side, the title over both with the house hairline', /\.arc-wrap > #sendygg \{[^}]*display: grid; grid-template-columns: var\(--arc-split\);/.test(RESP) && /\.arc-wrap > #sendygg > \.arc-game-h::after/.test(RESP) && /#sendygg > \.sgg-preview \{ grid-column: 1; grid-row: 3 \/ 7;/.test(RESP) && /#sendygg > \.sgg-side \{ display: contents; \}/.test(RESP) && /#sendygg \.sgg-what \{ grid-column: 2;/.test(RESP) && /#sendygg \.sgg-play \{ grid-column: 2;/.test(RESP));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the file checks ran to the end', false, e && e.message);
}

/* ═══ 2. the runner's server ═══ */
let servedVer = null;
try {
  const page = await fetch(BASE + '/arcade', { headers: { Cookie: 'jsi_age=18' } });
  const html = await page.text(), csp = page.headers.get('content-security-policy') || '';
  const m = new RegExp('src="' + JPG + '\\?v=([^"]+)"').exec(html); servedVer = m ? m[1] : null;
  check('/arcade is served with the card, its still versioned (?v=)', page.status === 200 && html.includes('id="sendygg"') && !!servedVer, page.status);
  check('  ...under a CSP that loads images only from this site (img-src \'self\', no other host)', /(^|; )default-src 'self'(;|$)/.test(csp) && /(^|; )img-src 'self' data: blob:(;|$)/.test(csp), csp);
  const j = await fetch(BASE + '/' + JPG, { method: 'HEAD' });
  check('the still is image/jpeg', j.status === 200 && j.headers.get('content-type') === 'image/jpeg', j.status + ' ' + j.headers.get('content-type'));
  const jv = servedVer ? await fetch(BASE + '/' + JPG + '?v=' + servedVer, { method: 'HEAD' }) : null;
  check('  ...and the page\'s versioned copy is cached for good', jv && jv.status === 200 && /immutable/.test(jv.headers.get('cache-control') || ''), jv && jv.headers.get('cache-control'));
  const gone = [];
  for (const r of [MP4, VTT]) { const x = await fetch(BASE + '/' + r, { method: 'HEAD' }); gone.push(r + ' ' + x.status); }
  check('the welcome video and its captions are not served (404)', gone.every((g) => / 404$/.test(g)), gone.join(', '));
} catch (e) {
  console.error('ERROR', e && e.stack);
  check('the server checks ran to the end', false, e && e.message);
}

/* ═══ 3. in a muted headless Chrome ═══ */
const CHROME = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find((p) => p && existsSync(p));
const SHOTS = process.env.ARCADE_SHOTS || '';
if (!CHROME) {
  if (process.env.CI) notes.push('skipping the browser checks: no Chrome or Chromium on this runner (set CHROME_PATH)');
  else check('a Chrome or Chromium to look at the card in (set CHROME_PATH)', false, 'none found');
} else {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'jsi-arcadesendy-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--lang=en-US', 'about:blank'];
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let ws = null, session = null, seq = 0; const pend = new Map(), errors = []; let reqs = [], resps = [];
  const cdp = (method, params = {}, sid = session) => new Promise((ok, bad) => { const id = ++seq; pend.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await ev(expr); if (v) return v; } catch {} await sleep(80); } return null; };
  // the card as a reader meets it: the floor, the edges, the targets, where the still sits
  const LOOK = `(() => {
    const probe = document.createElement('span'); probe.style.fontSize = 'var(--text-floor)'; document.body.appendChild(probe);
    const floor = parseFloat(getComputedStyle(probe).fontSize); probe.remove();
    const card = document.getElementById('sendygg'); if (!card) return { missing: true };
    const small = [], out = [];
    for (const el of card.querySelectorAll('*')) {
      if (!el.getClientRects().length || el.closest('.sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
      if ([...el.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < floor - 0.5) small.push((el.className || el.tagName) + ' ' + getComputedStyle(el).fontSize);
    }
    const a = card.querySelector('a.sgg-play'), im = card.querySelector('img.sgg-shot'), side = card.querySelector('.sgg-what');
    const ar = a.getBoundingClientRect(), ir = im.getBoundingClientRect(), sr = side.getBoundingClientRect();
    return { floor, doc: document.documentElement.scrollWidth, iw: innerWidth, small: small.slice(0, 5), out: out.slice(0, 5),
      link: { w: Math.round(ar.width), h: Math.round(ar.height), href: a.href, target: a.target, rel: a.rel },
      shot: { w: Math.round(ir.width), h: Math.round(ir.height) }, media: card.querySelectorAll('video, audio, track, source, iframe').length,
      beside: ir.right <= sr.left + 1 && sr.top < ir.bottom, below: sr.top >= ir.bottom - 1 };
  })()`;
  // scrolled to: the still has loaded from this site, its size, and what is left in the box the emoji tile was in
  const SHOT = `(async () => {
    const im = document.querySelector('#sendygg img.sgg-shot'); im.scrollIntoView({ block: 'center' });
    const end = Date.now() + 8000; while (!(im.complete && im.naturalWidth) && Date.now() < end) await new Promise((r) => setTimeout(r, 80));
    if (!im.naturalWidth) return { loaded: false, src: im.currentSrc };
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const [x0, y0, x1, y1] = ${JSON.stringify(TILE)}; const d = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data; let lit = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l > 40) lit++; if (l > max) max = l; }
    return { loaded: true, src: im.currentSrc, nw: im.naturalWidth, nh: im.naturalHeight, lit, max: Math.round(max) };
  })()`;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error('Chrome did not open its debugging port');
    const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
    ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('could not connect to Chrome')); });
    ws.onmessage = (m) => {
      const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.bad(new Error(JSON.stringify(d.error))) : p.ok(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') errors.push(((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text || '').split('\n')[0]);
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error ' + (d.params.args || []).map((x) => x.value || x.description || '').join(' ').slice(0, 160));
      else if (d.method === 'Network.requestWillBeSent') reqs.push({ url: d.params.request.url });
      else if (d.method === 'Network.responseReceived') resps.push({ url: d.params.response.url, status: d.params.response.status, type: d.params.response.mimeType });
    };
    const t = await cdp('Target.createTarget', { url: 'about:blank' }, null);
    session = (await cdp('Target.attachToTarget', { targetId: t.targetId, flatten: true }, null)).sessionId;
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Network.setCacheDisabled', { cacheDisabled: true });   // every width loads as a first visit, so every request is seen
    await cdp('Network.setCookie', { name: 'jsi_age', value: '18', url: BASE });   // the 18+ answer, so the age question does not cover the page
    await cdp('Page.navigate', { url: BASE + '/robots.txt' }); await until('document.readyState === "complete"');
    await ev("localStorage.setItem('jsi-tour-v1', 'done'); true");   // the visitor tour stays out of the way, as for anyone who has seen it
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    const looks = {};
    for (const w of [320, 390, 1280, 1920]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 760 : 1000, deviceScaleFactor: 1, mobile: w < 768 });
      await cdp('Emulation.setTouchEmulationEnabled', w < 768 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      reqs = []; resps = [];
      await cdp('Page.navigate', { url: BASE + '/arcade' });
      await until('document.readyState === "complete" && !!document.getElementById("sendygg") && document.fonts.status === "loaded"', 12000);
      await sleep(1200);   // late fetches (the boards, the nav's numbers) are in by now
      const L = await ev(LOOK);
      const S = await ev(SHOT);
      await sleep(400);    // the still's own request, once scrolled to, is in the log
      looks[w] = { L, S, reqs: reqs.slice(), resps: resps.slice() };
      if (SHOTS) {
        const box = await ev('(() => { const c = document.getElementById("sendygg"); c.scrollIntoView({ block: "start" }); const r = c.getBoundingClientRect(); return { x: 0, y: Math.round(r.top + scrollY) - 8, width: innerWidth, height: Math.round(r.height) + 16 }; })()');
        await sleep(300);
        const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } });
        writeFileSync(path.join(SHOTS, 'sendygg-card-' + w + '.png'), Buffer.from(shot.data, 'base64'));
      }
    }
    const W = Object.keys(looks);
    const fail = (fn, k = 'L') => W.filter((w) => { try { return looks[w].L.missing || !fn(looks[w][k]); } catch { return true; } }).map((w) => w + ': ' + JSON.stringify(looks[w][k]).slice(0, 300)).join(' | ');
    check('at 320, 390, 1280 and 1920 px the card is there and the page never scrolls sideways', W.length === 4 && !fail((L) => !L.missing && L.doc <= L.iw), fail((L) => !L.missing && L.doc <= L.iw));
    check('  ...nothing in the card runs past the screen\'s edge', !fail((L) => !L.out.length), fail((L) => !L.out.length));
    check('  ...no text in it under the floor', !fail((L) => !L.small.length), fail((L) => !L.small.length));
    check('  ...the link is at least 44 px each way, absolute to sendy.gg, a new tab, noopener', !fail((L) => L.link.h >= 44 && L.link.w >= 44 && L.link.href === 'https://sendy.gg/' && L.link.target === '_blank' && /noopener/.test(L.link.rel)), fail((L) => L.link.h >= 44 && L.link.w >= 44 && L.link.href === 'https://sendy.gg/'));
    check('  ...no video, sound, track or frame in the card, and the still holds its 16:9 place', !fail((L) => L.media === 0 && L.shot.w > 200 && Math.abs(L.shot.w / L.shot.h - 16 / 9) < 0.06), fail((L) => L.media === 0 && L.shot.w > 200));
    check('  ...stacked on a phone (the words under the still), side by side on a wide screen', W.length === 4 && !W.some((w) => looks[w].L.missing) && looks[320].L.below && looks[390].L.below && looks[1280].L.beside && looks[1920].L.beside, W.map((w) => w + ':' + (looks[w].L.beside ? 'beside' : looks[w].L.below ? 'below' : '?')).join(' '));
    check('scrolled to, the still loads from this site at 1280x720', !fail((S) => S.loaded && S.nw === 1280 && S.nh === 720 && S.src.startsWith(BASE + '/' + JPG + '?v='), 'S'), fail((S) => S.loaded && S.nw === 1280, 'S'));
    check('  ...with the emoji tile painted out: nothing in its old box is brighter than the frame\'s grid', !fail((S) => S.loaded && S.lit === 0 && S.max <= 40, 'S'), fail((S) => S.lit === 0, 'S'));
    check('  ...served as image/jpeg', W.every((w) => looks[w].resps.some((r) => r.url.startsWith(BASE + '/' + JPG) && r.status === 200 && r.type === 'image/jpeg')), W.map((w) => w + ':' + looks[w].resps.filter((r) => r.url.includes('sendygg')).map((r) => r.status + ' ' + r.type).join(',')).join(' '));
    const off = W.flatMap((w) => looks[w].reqs.filter((r) => !/^(http:\/\/localhost:|http:\/\/127\.0\.0\.1:|data:|about:|blob:)/.test(r.url)).map((r) => w + ': ' + r.url.slice(0, 100)));
    check('loading the page asks no other host for anything (sendy.gg included)', W.length === 4 && off.length === 0 && W.every((w) => looks[w].reqs.length > 10), off.slice(0, 5).join(' | ') || W.map((w) => looks[w].reqs.length).join(','));
    const vid = W.flatMap((w) => looks[w].reqs.filter((r) => /sendygg-welcome\.(mp4|vtt)/.test(r.url)).map((r) => w + ': ' + r.url));
    check('  ...and asks this site for no video or captions either', vid.length === 0, vid.join(' | '));
    check('no script error on the page at any width', errors.length === 0, errors.slice(0, 5).join(' | '));
  } catch (e) {
    if (process.env.CI) notes.push('skipping the browser checks: ' + e.message.slice(0, 160));
    else check('the browser checks ran', false, e.message);
  } finally {
    try { ws && ws.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    await sleep(200);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

for (const n of notes) console.log('note: ' + n);
let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok || !extra ? '' : '  [' + extra + ']')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
