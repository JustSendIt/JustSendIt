'use strict';
/* ===== Sendy's brain: everything public the site knows, and the answers built from it (owner, 2026-10-27) =============
   Owner's ask: "Fix sendy so he uses all the data collected by the platform and all the data on the platform already so he
   can answer any user's question about the platform, and make sure he is constantly learning as new data comes into the
   platform."

   Two halves in one module:
     · THE KNOWLEDGE. An in-memory keyword index (BM25, no dependency) over chunks of the site's own words — this README's
       §1-4, every public page, the white paper, the Terms' section titles (never their words: Sendy points to a section, he
       does not paraphrase law), the site map and the notes the chat has always carried (read from public/sendy.js itself,
       so the page's fallback and the server never drift) — and over the public rows people write: the Support board's
       questions with their answers, public Send Wall and community posts, public Send Calls, the communities, and Sendy's
       earlier answers that readers rated helpful. Beside it, TOOLS: small read-only functions over the live public data —
       Market Data's answers, the Scanner's readings, the boards, a member's public figures, the counts — that read it at
       the moment of the question. Every tool returns plain data with its source and when it was read, and an unknown is
       null with the reason, never 0.
     · THE ANSWERS. Without a model key (the live site today) a deterministic answerer: it recognises the common shapes of a
       question (a price, a market cap, the top tokens on a chain, a chain's TVL, the leaderboard, a member, the
       competitions, the counts, how a feature works, where something is), calls the tools and writes a short plain answer
       that quotes every figure with "about", its source and its age, and names the page to go to. Anything else is answered
       from the best passages of the index — quoted, never invented — and only when nothing relevant exists does it hand
       over to a person (the Support board, the email), keeping the question (never who asked) so the owner can see what
       people need. With a key, Claude answers through Anthropic's SDK with the same tools (askModel, below).

   WHAT SENDY MAY READ is what a signed-out visitor can see, and nothing else, ever: public posts only (private = 0 and no
   squad — the holders-only walls and the squads' walls are not his), public Send Calls only (no squad call, never the
   caller's wallet), the communities' public card columns, a member's public profile as /u/<name> shows it, the boards,
   Market Data, the Scanner's public readings. Never an email, an IP, a session, a linked wallet, a notification, a report,
   a moderation record, an API key, a burn proof, an encrypted column, or anything only an owner or an admin can see. Every
   read of the site's tables is in READ below with its filter beside it; a row is checked again before it is quoted, so a
   post taken down or deleted since the index read it is never repeated — and an answer of Sendy's that quoted a member is
   never reused (sendy_qa.reuse, see migrate), so it cannot live on there either. A member's words that push a trade
   (pushes()) are never in the index at all.

   "CONSTANTLY LEARNING", honestly: Sendy is not retrained. He keeps up. The index refreshes in the background (every
   SENDY_REFRESH_MS, a minute by default) from watermarks — only rows newer than the last ones read — and re-reads a site
   file when its modification time changes; every REBUILD_EVERY ticks the people-written part is rebuilt whole, so an edit,
   a takedown or a restore is caught too. The work is done in slices with the event loop let go between them, and the
   longest slice is measured (stats().refresh.maxSliceMs). The tools read the live data when the question is asked. A
   reader's rating changes what is reused at once (rated()). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Anthropic = require('@anthropic-ai/sdk').default;
const ROUTES = require('./routes.js');
const MD = require('./marketdata.js');   // its chain table: which GeckoTerminal network is which chain
const WORDS = require('./sendywords.js');   // a message as typed → the sentence it means (chat-speak, wrappers, spelling, several questions)

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DEFAULT_MODEL = 'claude-opus-5-5';
// the models that take the server-side fallback beta (a declined request is retried on the model Anthropic names for it)
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MODEL_ROUNDS = 4;            // a question gets at most this many model turns (tool calls in between)
const TOOL_RESULT_MAX = 8000;      // characters of one tool's answer sent to the model
const MISS_KEEP_MS = 90 * DAY, MISS_KEEP_ROWS = 5000;    // the questions Sendy could not answer: 90 days, the newest 5,000
const QA_UNRATED_KEEP_MS = 90 * DAY, QA_UNRATED_KEEP_ROWS = 20000;   // an answer not in use: 90 days; one nobody rated: also only the newest 20,000 (every answer is kept now)
const POSTS_MAX = 20000, CALLS_MAX = 5000;                // the newest public posts and calls in the index (memory has a ceiling)
const BATCH = 400;                 // rows read per slice; the loop is let go between slices
const REBUILD_EVERY = 15;          // ticks between full rebuilds of the people-written part

/* ----- words ----- */
const STOP = new Set(('a about above after again all also am an and any are as at be been being but by can could did do does doing '
  + 'for from get got had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off '
  + 'on once only or other our out over own please same she should so some such than that the their theirs them then there these they '
  + 'this those through to too under until up very was we were what when where which while who whom why will with would you your '
  + 'yours tell show give know want need im ive dont doesnt cant hey hi hello sendy site page use uses using used '
  + 'work works working mean means meaning '   // "how does X work", "what does X mean": the asking, not the topic
  + 'pls plz lol lmao bro bruh ser fam guys ok okay yeah yep yes really actually basically literally kinda sorta wondering wonder curious '
  + 'possible way trying able let thing things stuff something anything anyone someone somebody anybody thanks thank idea ideas see look now '
  + 'even explain else yet one ones recommend suggest like').split(' '));   // and the padding of a chat message
// one word as the index keeps it: lower case, a light stem so "calls", "called" and "calling" meet "call"
function stem(w) {
  if (w.length <= 3 || /^0x|\d/.test(w)) return w;
  if (w.endsWith("'s")) w = w.slice(0, -2);
  // "capped", "rugged", "running": the doubled letter goes with the ending ("called", "passed", "added" keep theirs)
  const undouble = (x) => (/([b-cg-km-rt-y])\1$/.test(x) ? x.slice(0, -1) : x);
  if (w.length > 5 && w.endsWith('ing')) return undouble(w.slice(0, -3));
  if (w.length > 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return undouble(w.slice(0, -2));
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
/* Real English words a slip away from a word Sendy corrects to (scripts/sendy-english.mjs builds the list from a dictionary):
   each one is a word in its own right — "lunch" is not "launch" — so spelling never touches it */
const ENGLISH = (() => { try { return new Set(fs.readFileSync(path.join(__dirname, 'sendy-english.txt'), 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); } })();
const words = (s) => String(s || '').toLowerCase().normalize('NFKC').match(/0x[0-9a-f]{6,64}|[a-z0-9À-ɏ]+(?:'s)?/g) || [];
const terms = (s) => words(s).filter((w) => !STOP.has(w) && !STOP.has(w.replace(/'s$/, '')) && w.length > 1).map(stem);
/* The words people use for what the site calls something else. A part of a question is its word OR any of these (a list is
   a phrase: all of its words), so "points" finds Send Power, "pfp" a profile picture, "max" a cap — and a passage that says it
   the site's way covers that part of the question as fully as one that says it the person's way. */
const ALIASES = Object.assign(Object.create(null), { mcap: [['market', 'cap']], marketcap: [['market', 'cap']], tvl: [['value', 'lock']], '2fa': [['two', 'factor']], pnl: ['profit'],
  dm: ['message'], pfp: [['profile', 'picture']], avatar: ['picture'], lp: [['liquidity', 'pool']], ca: [['contract', 'address']],
  point: [['send', 'power']], xp: [['send', 'power']], score: [['send', 'power']], pic: ['picture'], photo: ['picture'], image: ['picture'],
  handle: ['username'], nickname: ['username'], login: ['sign'], log: ['sign'], signin: ['sign'], signup: ['sign'], register: ['sign'], registration: ['sign'],
  group: ['community', 'squad'], club: ['community'], coin: ['token'], graph: ['chart'], trade: ['swap'], exchange: ['swap'],
  alert: ['notification'], bell: ['notification'], notif: ['notification'], dev: ['team'], developer: ['team'], mod: ['moderator'], admin: ['moderator'],
  invite: ['referral'], referral: ['invite'], color: ['colour'], colour: ['color'], rank: ['leaderboard'], ranking: ['leaderboard'],
  max: ['cap', 'maximum', 'limit'], maximum: ['cap', 'max'], limit: ['cap'], highest: ['cap'],
  liable: ['liability'], tos: ['term'] });
// the parts of a question: [[word, its other ways of being said…], …] — index.search reads each part as one
const queryTerms = (s) => { const out = new Map(); for (const t of terms(s)) if (!out.has(t)) out.set(t, [t].concat((ALIASES[t] || []).map((a) => (Array.isArray(a) ? a.map(stem) : stem(a))))); return [...out.values()]; };
// a part, as alternatives each a list of words; does a set of words hold one of them whole?
const alts = (g) => (Array.isArray(g) ? g : [g]).map((m) => (Array.isArray(m) ? m : [m]));
const covers = (set, g) => alts(g).some((m) => m.every((t) => set.has(t)));
// the passages that are the site's own words; every other kind was written by a member of the public
const DOC_KINDS = ['map', 'note', 'page', 'readme', 'whitepaper', 'terms'];
/* A member's words that push a trade or promise a price are never repeated in Sendy's voice, however they are phrased: a
   trade urged on someone ("Buy $X today", "tell people to buy", "you need to sell", "buy the dip"), bags, pumps and moons,
   multiples and dollar targets, guarantees. A question about trading ("how do I buy …?") and someone saying what they did
   ("I bought it but it doesn't show") are not pushes, so they are read past first. Broad on purpose — a plain answer that
   happens to say "pump" is lost too, and that is the side to be wrong on: the site never tells anyone to buy. */
const PUSH = [
  /(^|[.!?]\s+|["“(]\s*)(buy|sell|ape)\b|\b(to|should|must|gotta|go|all|everyone|everybody|y'?all|you|guys|just|pls|please)\s+(buy|sell|ape|accumulate)\b|\b(buy|sell|ape)(ing)?\s+(it|this|now|today|asap|more|the dip|before|early|some|a bag|bags)\b|\bape[sd]?\s+in(to)?\b|\baping\b/i,
  /\b(grab|grabbing|load|loading|fill|filling|stack|stacking)\b[^.?!]{0,12}\bbags?\b|\bload(s|ed|ing)? up on\b/i,
  /\b(pump(?!\.fun)|pumps|pumped|pumping|dump|dumps|dumped|dumping|moon\w*|explod\w*|skyrocket\w*|lambo\w*|gem|lfg|wagmi)\b|\b\d+(\.\d+)?\s?x\b|\b(hit|hits|hitting|reach|reaches|reaching|to|at|by|toward|towards|flip|flips)\s+\$\s?\d/i,
  /\b(guarantee\w*|risk[- ]?free|easy money|trust me|don'?t miss|last chance|get in (now|early|before)|nfa|financial advice|price target)\b|\bcan(no|')?t lose\b/i,
];
const ASKS_TO_TRADE = /\b(how|where|when|why|can|could|do|does|is it possible to)\b[^.?!]{0,40}?\b(buy|sell)\b/gi;
const SAYS_WHAT_I_DID = /\bi\s+(want|wanted|need|needed|tried|try|am trying|was trying|would like|'d like|just|have|had|did|didn'?t|can'?t|cannot|couldn'?t|will|'ll)?\s*(to\s+)?(buy|bought|sell|sold)\b/gi;
const pushes = (s) => { const t = String(s || '').replace(ASKS_TO_TRADE, ' ').replace(SAYS_WHAT_I_DID, ' '); return PUSH.some((re) => re.test(t)); };

/* ----- the site's text, in chunks ----- */
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", mdash: '—', ndash: '–', rarr: '→', larr: '←', times: '×', hellip: '…', middot: '·', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', minus: '−' };
const unEnt = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, n) => n[0] === '#' ? String.fromCodePoint(Math.min(0x10ffff, n[1] === 'x' || n[1] === 'X' ? parseInt(n.slice(2), 16) : +n.slice(1))) : (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m));
const tidy = (s) => unEnt(s.replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\n]+/g, ' ').trim();
/* A page as passages: a new passage at every heading, its anchor the nearest id on a section or a heading (so the answer can
   link /privacy#p8, /whitepaper#s12), long ones cut at paragraph ends. Scripts, styles, comments and the nav are not words. */
function htmlChunks(html, href, opts = {}) {
  const h = String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '');
  const out = [];
  let anchor = null, title = opts.title || '', buf = [];
  const flush = () => {
    const text = buf.join(' ').replace(/\s+/g, ' ').trim(); buf = [];
    if (text.length < 30) return;
    for (const piece of cut(text, 900)) out.push({ title, href: href + (anchor ? '#' + anchor : ''), text: piece });
  };
  const re = /<(section|h[1-4])\b([^>]*)>|<\/(p|li|h[1-4]|tr|div|blockquote|summary|details|section|dd|dt)>/gi;
  let last = 0, m;
  while ((m = re.exec(h))) {
    buf.push(tidy(h.slice(last, m.index))); last = re.lastIndex;
    if (m[1]) {
      const id = (/\bid="([A-Za-z][\w-]{0,40})"/.exec(m[2]) || [])[1];
      if (/^h/i.test(m[1])) {
        flush();
        const end = h.indexOf('</' + m[1], last);
        title = tidy(h.slice(last, end < 0 ? last : end)).slice(0, 120) || title;
        if (id) anchor = id;
      } else if (id) { flush(); anchor = id; }
    } else buf.push('\n');
  }
  buf.push(tidy(h.slice(last))); flush();
  return out;
}
// text cut into pieces of about n characters, at sentence ends where it can
function cut(text, n) {
  if (text.length <= n) return [text];
  const parts = [], sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || [text];
  let cur = '';
  for (const s of sentences) { if (cur && cur.length + s.length > n) { parts.push(cur.trim()); cur = ''; } cur += s; }
  if (cur.trim()) parts.push(cur.trim());
  return parts.flatMap((p) => (p.length > n * 1.6 ? p.match(new RegExp('.{1,' + n + '}(\\s|$)', 'g')).map((x) => x.trim()) : [p]));
}
// README §1-4 (the rest is for operators) as passages, one per heading; it is not a page, so it has no link of its own
function readmeChunks(md) {
  const i = md.indexOf('\n## 5.'), body = i > 0 ? md.slice(0, i) : md, out = [];
  let title = 'About the site', buf = [];
  const flush = () => { const t = buf.join(' ').replace(/\*\*|`|\|/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim(); buf = []; if (t.length > 40) for (const p of cut(t, 900)) out.push({ title, href: null, text: p }); };
  for (const line of body.split('\n')) {
    const hm = /^#{1,4}\s+(.*)$/.exec(line);
    if (hm) { flush(); title = hm[1].replace(/[*`]/g, '').trim().slice(0, 120); } else buf.push(line);
  }
  flush();
  return out;
}
// the Terms: the section titles only, each linked — Sendy sends people to the section and never says what it says
function termsChunks(html) {
  return [...String(html).matchAll(/<section class="t-sec" id="([^"]+)">\s*<h3>([^<]+)<\/h3>/g)].map((m) => ({ title: 'Terms of Service — ' + tidy(m[2]), href: '/terms#' + m[1], text: 'The Terms of Service section "' + tidy(m[2]) + '" is at /terms#' + m[1] + '.' }));
}
// the built-in notes, from the page's own file: the same object the chat falls back to when the server cannot be reached
function readNotes(src, email) {
  const a = src.indexOf('const knowledgeBase = {');
  if (a < 0) return [];
  const literal = objectAt(src, a + 'const knowledgeBase = '.length);
  if (!literal) return [];
  const kb = vm.runInNewContext('(' + literal + ')', { EMAIL: email }, { timeout: 200 });
  return Object.entries(kb).map(([key, e]) => ({ key, keywords: Array.isArray(e.keywords) ? e.keywords.map(String) : [], answer: String(e.answer || '') }));
}
/* The object literal that opens at src[i], to its matching brace: strings and comments are stepped over, so a "}" inside a
   note is not its end. The page's file is edited by hand, so this never leans on how it is indented. Null if it never closes. */
function objectAt(src, i) {
  if (src[i] !== '{') return null;
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if (c === '/' && src[j + 1] === '/') { const e = src.indexOf('\n', j); if (e < 0) return null; j = e; }
    else if (c === '/' && src[j + 1] === '*') { const e = src.indexOf('*/', j + 2); if (e < 0) return null; j = e + 1; }
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

/* ----- the index: BM25 over passages, added and removed one at a time ----- */
function createIndex() {
  const docs = new Map(), post = new Map(), fam = new Map();   // fam: an id's family (before the first ':') → its ids
  const famOf = (id) => String(id).slice(0, String(id).indexOf(':') >>> 0);
  // the words the site's own passages use, as typed and as stems, with how many passages each is in (for spelling)
  const vocab = new Map(), ownStems = new Map();
  let totalLen = 0, version = 0;
  const K1 = 1.2, B = 0.75, ALIAS_SCORE = 0.7;
  const own = (d) => DOC_KINDS.includes(d.kind);
  const bump = (m, k, by) => { const n = (m.get(k) || 0) + by; if (n > 0) m.set(k, n); else m.delete(k); };
  const typed = (d) => new Set(words(d.title + ' ' + d.text).filter((w) => /^[a-z]{3,24}$/.test(w)));
  function remove(id) {
    const d = docs.get(id); if (!d) return false;
    for (const t of d.tf.keys()) { const p = post.get(t); if (p) { p.delete(id); if (!p.size) post.delete(t); } }
    if (own(d)) { for (const t of d.tf.keys()) bump(ownStems, t, -1); for (const w of typed(d)) bump(vocab, w, -1); version++; }
    totalLen -= d.len; docs.delete(id); const f = fam.get(famOf(id)); if (f) f.delete(id); return true;
  }
  function add(doc) {
    remove(doc.id);
    const tf = new Map(), all = terms(doc.title).concat(terms(doc.title), terms(doc.text), terms(doc.extra || ''));   // a title counts twice
    for (const t of all) tf.set(t, (tf.get(t) || 0) + 1);
    const d = Object.assign({}, doc, { tf, len: all.length || 1 });
    docs.set(doc.id, d); totalLen += d.len;
    let f = fam.get(famOf(doc.id)); if (!f) fam.set(famOf(doc.id), (f = new Set())); f.add(doc.id);
    for (const [t, n] of tf) { let p = post.get(t); if (!p) post.set(t, (p = new Map())); p.set(doc.id, n); }
    if (own(d)) { for (const t of tf.keys()) bump(ownStems, t, 1); for (const w of typed(d)) bump(vocab, w, 1); version++; }
  }
  /* the best passages for a question: BM25, weighted by the passage's kind, with how much of the question each one covers —
     cover counts the question's parts, weight weighs them by how rare they are (a word no passage holds weighs the most),
     so a passage that shares only "people" and "wallet" with a question about something rare covers little of it. A part is
     a word, or a word and its other ways of being said (queryTerms): a passage has the part if it has any one of them whole,
     and scores and weighs as the best one it has — the part counts once, however many of its ways the passage says — and a
     passage in the person's own word scores above one that only says it another way (ALIAS_SCORE). */
  function search(qTerms, o = {}) {
    const N = docs.size; if (!N || !qTerms.length) return [];
    const avg = totalLen / N, score = new Map(), hit = new Map(), mass = new Map();
    const idfOf = (t) => { const p = post.get(t); return Math.log(1 + (N - (p ? p.size : 0) + 0.5) / ((p ? p.size : 0) + 0.5)); };
    let all = 0;
    for (const part of qTerms) {
      const best = new Map();   // passage → [score, weight] of the way of saying this part it has that scores best
      let gw = 0, firstW = null;
      for (const [ai, m] of alts(part).entries()) {
        const ps = m.map((t) => post.get(t)), w = m.reduce((s, t) => s + idfOf(t), 0) / m.length, k = ai ? ALIAS_SCORE : 1;
        if (firstW === null) firstW = w;
        if (ps.some((p) => !p)) continue;
        if (w > gw) gw = w;
        const [p0, ...rest] = ps.slice().sort((a, b) => a.size - b.size);
        for (const [id] of p0) {
          if (rest.some((p) => !p.has(id))) continue;
          const d = docs.get(id);
          if (o.kinds && !o.kinds.includes(d.kind)) continue;
          const s = k * m.reduce((acc, t) => { const n = post.get(t).get(id); return acc + idfOf(t) * (n * (K1 + 1)) / (n + K1 * (1 - B + B * d.len / avg)); }, 0) / m.length;
          const b = best.get(id); if (!b || s > b[0]) best.set(id, [s, w]);
        }
      }
      if (!gw) gw = firstW || 0;   // no passage says this part at all: it weighs as its own word does, the most
      all += gw;
      for (const [id, [s, w]] of best) { score.set(id, (score.get(id) || 0) + s); hit.set(id, (hit.get(id) || 0) + 1); mass.set(id, (mass.get(id) || 0) + Math.min(w, gw)); }
    }
    const out = [];
    for (const [id, s] of score) { const d = docs.get(id); out.push({ doc: d, score: s * (o.weight ? o.weight(d) : 1), cover: hit.get(id) / qTerms.length, weight: mass.get(id) / all }); }
    return out.sort((a, b) => b.score - a.score).slice(0, o.limit || 8);
  }
  return { add, remove, search, get: (id) => docs.get(id), has: (id) => docs.has(id), size: () => docs.size, ids: (family) => [...(family ? fam.get(family) || [] : docs.keys())],
    kinds: () => { const k = {}; for (const d of docs.values()) k[d.kind] = (k[d.kind] || 0) + 1; return k; },
    vocab: () => vocab, version: () => version, ownDf: (t) => ownStems.get(t) || 0, df: (t) => { const p = post.get(t); return p ? p.size : 0; } };
}

/* ----- how a figure is said ----- */
const trim0 = (s) => s.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
function usd(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + trim0((v / 1e9).toFixed(2)) + 'B';
  if (a >= 1e6) return '$' + trim0((v / 1e6).toFixed(2)) + 'M';
  if (a >= 1e4) return '$' + trim0((v / 1e3).toFixed(1)) + 'k';
  if (a >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a === 0) return '$0';
  return '$' + v.toFixed(Math.min(18, 2 - Math.floor(Math.log10(a)))).replace(/(\.\d*?[1-9])0+$/, '$1');   // three significant figures
}
const count = (v) => Math.round(v).toLocaleString('en-US');
const pct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + '%';
const FMT = { usd, count, pct, gwei: (v) => (v < 0.01 ? v.toPrecision(2) : v.toFixed(v < 1 ? 3 : 2)) + ' gwei', eth: (v) => count(v) + ' ETH', ms: (v) => (v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(1) + ' s') };
const SRC_NAME = { geckoterminal: 'GeckoTerminal', defillama: 'DefiLlama', l2beat: 'L2BEAT', growthepie: 'growthepie', dexscreener: 'Dexscreener', coingecko: 'CoinGecko',
  rpc: 'the chain itself', ethrpc: 'an Ethereum node', site: "this site's records", scanner: "the Scanner's reading", market: 'Market Data', scan: "the Scanner's reading", refresh: "the Scanner's reading" };
const srcName = (s) => SRC_NAME[s] || String(s || "this site's records");
function ago(at, t) {
  if (!Number.isFinite(at)) return 'when is not known';
  const s = Math.max(0, (t - at) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 48 * 3600) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
const isFig = (f) => f && typeof f === 'object' && 'v' in f;
// "about $1.2M", or "unknown (why)" — never a 0 for a figure nobody read
const val = (f, kind) => (!isFig(f) || f.v == null ? 'unknown' + (f && f.why ? ' (' + String(f.why).replace(/\.$/, '') + ')' : '') : 'about ' + FMT[kind || 'usd'](f.v));
// the figures, grouped by where and when they were read, each group closed by its source and age
function said(items, t) {
  const groups = [];
  for (const it of items) {
    if (!it || !isFig(it.f)) continue;
    const k = it.f.v == null ? 'null' : (it.f.src || 'site') + '|' + (it.f.at || '');
    let g = groups.find((x) => x.k === k); if (!g) groups.push((g = { k, f: it.f, parts: [] }));
    g.parts.push(it.label + ' ' + val(it.f, it.kind));
  }
  return groups.map((g) => g.parts.join(', ') + (g.k === 'null' ? '' : ' (' + srcName(g.f.src) + ', read ' + ago(g.f.at, t) + ')')).join('; ');
}
const F = (v, src, at, why) => (typeof v === 'number' && Number.isFinite(v) ? { v, src, at } : { v: null, src, at, why: why || 'not read' });
const sym = (s) => '$' + String(s || '?').replace(/^\$/, '');
const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const lc = (s) => String(s || '').toLowerCase();
const EVM_RE = /^0x[0-9a-f]{40}$/i, B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* ----- the chains a question can name ----- */
// "base" is also an ordinary word (a base asset, the base token), so Base is only Base with a capital or beside a chain word
const CHAIN_WORDS = [
  ['robinhood', /\brobin ?hood(?: chain| l2)?\b|\brh ?chain\b|\brhc\b|\bhood chain\b|\bthe chain\b|\b(?:on|of|in|for) rh\b/i],
  ['ethereum', /\bethereum\b|\beth mainnet\b|\b(?:on|of|for) eth\b(?! (?:to|for|from|into))|\beth(?: chain| network| tvl| defi| stats)\b/i], ['solana', /\bsolana\b|\b(?:on|of) sol\b|\bsol(?: chain| network| tvl)\b/i],
  // "the base fee" (gas) and "the base token" (a pair's) are not Base
  ['base', /\b(?:on|of|in|for|across|about) base\b|(?<!\b(?:the|a) )\bbase(?:'s| chain| network| tvl| tokens| volume| fees)\b|\bbase (?:vs|versus|or|and)\b/i], ['base', /\bBase\b(?! (?:fee|token)\b)/],
  ['bsc', /\bbsc\b|\bbnb chain\b|\bbinance smart chain\b/i], ['arbitrum', /\barbitrum\b/i], ['polygon', /\bpolygon\b/i], ['avalanche', /\bavalanche\b|\bavax\b/i], ['optimism', /\boptimism\b/i],
];
const CHAIN_NAMES = { robinhood: 'Robinhood Chain', ethereum: 'Ethereum', solana: 'Solana', base: 'Base', bsc: 'BNB Chain', arbitrum: 'Arbitrum', polygon: 'Polygon', avalanche: 'Avalanche', optimism: 'Optimism' };
const GT_KEYS = Object.keys(CHAIN_NAMES);   // the chains Market Data reads the pools of (lib/marketdata.js GT_TRACKED)

/* ===== the brain ===================================================================================================== */
function createSendyBrain(deps = {}) {
  const db = deps.db;
  if (!db) throw new Error('createSendyBrain needs a database');
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const root = deps.root || path.join(__dirname, '..');
  const MKT = deps.market || null;     // Market Data (lib/marketdata.js): its answers from what it has collected — never a vendor read on a question
  const R = deps.readers || {};        // the server's own public views: leaderboard(), member(name), competitions(), scans()
  const EMAIL = deps.email || 'SendRH@Atomicmail.io';
  const SITE_TOKENS = deps.siteTokens || {};   // { SEND: '0x…', GWC: '0x…' } — the site's own coins, read from the Scanner's cache
  const ai = deps.ai || null;          // an Anthropic client the server built (the key, the site's identity), or null: the brain answers alone
  const MODEL = deps.model || DEFAULT_MODEL;
  const REFRESH_MS = deps.refreshMs || MIN;
  const DEADLINE_MS = deps.deadlineMs || 40000;
  const index = createIndex();
  const wm = { post: 0, comment: 0, call: 0 };   // the newest public post, Support answer and public call the index has read
  const fileAt = new Map();            // a site file → the mtime its passages were read at
  const st = { loadedAt: null, ticks: 0, rebuilds: 0, lastTickAt: null, lastTickMs: null, maxSliceMs: 0, lastRebuildAt: null, prunedAt: null, answered: 0, lastAnswerMs: null, errors: 0 };
  let timer = null, busy = false, stopped = false;
  const yieldLoop = () => new Promise((r) => setImmediate(r));
  // a slice of work timed, so the refresh can say how long it ever held the loop
  const slice = (fn) => { const t0 = process.hrtime.bigint(); try { return fn(); } finally { const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms > st.maxSliceMs) st.maxSliceMs = ms; } };

  /* ----- READ: every read of the site's own tables, each with the filter that keeps it public ----- */
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a) || null; } catch { return null; } };
  const all = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return []; } };
  const PUBLIC_POST = 'p.private = 0 AND p.squad_id IS NULL';   // what a signed-out visitor's walls show (postVisible): no holders-only post, no squad post
  const LIVE_AUTHOR = 'u.deleted_at IS NULL AND u.system = 0';
  const READ = {
    postsAfter: (id, n) => all(`SELECT p.id, p.text, p.board, p.community_id, p.call_id, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.id > ? AND ${PUBLIC_POST} AND ${LIVE_AUTHOR} ORDER BY p.id ASC LIMIT ?`, id, n),
    postsBefore: (id, n) => all(`SELECT p.id, p.text, p.board, p.community_id, p.call_id, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.id < ? AND ${PUBLIC_POST} AND ${LIVE_AUTHOR} ORDER BY p.id DESC LIMIT ?`, id, n),
    post: (id) => one(`SELECT p.id, p.text, p.board, p.community_id, p.call_id, p.created_at, u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND ${PUBLIC_POST} AND ${LIVE_AUTHOR}`, id),
    // answers under a Support question (comments on a public support post; the board is public by construction)
    supportAnswers: (postId) => all(`SELECT c.id, c.text, c.created_at, u.username FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id
      WHERE c.post_id = ? AND p.board = 'support' AND ${PUBLIC_POST} AND ${LIVE_AUTHOR} ORDER BY c.created_at ASC LIMIT 5`, postId),
    commentsAfter: (id, n) => all(`SELECT c.id, c.post_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id > ? AND p.board = 'support' AND ${PUBLIC_POST} ORDER BY c.id ASC LIMIT ?`, id, n),
    maxComment: () => (one('SELECT MAX(id) m FROM comments') || {}).m || 0,
    // public Send Calls only (a squad call is the squad's), and never the caller's wallet column
    callsAfter: (id, n) => all(`SELECT c.id, c.symbol, c.name, c.token_addr, c.post_id, c.created_at, u.username FROM calls c JOIN users u ON u.id = c.user_id
      WHERE c.id > ? AND c.squad_id IS NULL AND ${LIVE_AUTHOR} ORDER BY c.id ASC LIMIT ?`, id, n),
    callsBefore: (id, n) => all(`SELECT c.id, c.symbol, c.name, c.token_addr, c.post_id, c.created_at, u.username FROM calls c JOIN users u ON u.id = c.user_id
      WHERE c.id < ? AND c.squad_id IS NULL AND ${LIVE_AUTHOR} ORDER BY c.id DESC LIMIT ?`, id, n),
    call: (id) => one(`SELECT c.id FROM calls c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.squad_id IS NULL AND ${LIVE_AUTHOR}`, id),
    callsOf: (tokenAddr) => all(`SELECT c.symbol, c.created_at, u.username FROM calls c JOIN users u ON u.id = c.user_id WHERE c.token_addr = ? AND c.squad_id IS NULL AND ${LIVE_AUTHOR} ORDER BY c.created_at DESC LIMIT 10`, tokenAddr),
    // the communities' card columns (communityCardView shows these to anyone); never the address one was made from, never who is in it
    communities: () => all('SELECT id, symbol, name, token_addr, status, official, demo, member_count, qual_count, c_price, c_mc, c_liq, c_holders, c_at, created_at, went_live_at FROM communities ORDER BY official DESC, qual_count DESC, member_count DESC, id ASC LIMIT 500'),
    counts: () => ({
      members: (one('SELECT COUNT(*) n FROM users WHERE system = 0 AND deleted_at IS NULL') || {}).n,
      calls: (one('SELECT COUNT(*) n FROM calls c JOIN users u ON u.id = c.user_id WHERE c.squad_id IS NULL AND ' + LIVE_AUTHOR) || {}).n,
      posts: (one('SELECT COUNT(*) n FROM posts p JOIN users u ON u.id = p.user_id WHERE ' + PUBLIC_POST + ' AND p.board IS NULL AND ' + LIVE_AUTHOR) || {}).n,
      support: (one('SELECT COUNT(*) n FROM posts p JOIN users u ON u.id = p.user_id WHERE ' + PUBLIC_POST + " AND p.board = 'support' AND " + LIVE_AUTHOR) || {}).n,
      squads: (one('SELECT COUNT(*) n FROM squads') || {}).n,
      liveCommunities: (one("SELECT COUNT(*) n FROM communities WHERE status = 'live'") || {}).n,
      pendingCommunities: (one("SELECT COUNT(*) n FROM communities WHERE status = 'pending'") || {}).n,
    }),
    // the site's own coins as the Scanner last read them (token_cache: the home page's reading)
    siteToken: (addr) => one('SELECT pair_json, updated_at FROM token_cache WHERE token_addr = ? AND found = 1', addr),
    cacheBySymbol: (s) => all('SELECT token_addr, pair_json, symbol, name, updated_at FROM token_cache WHERE found = 1 AND symbol = ? COLLATE NOCASE ORDER BY reads DESC LIMIT 5', s),
    cacheByAddr: (a) => one('SELECT token_addr, pair_json, symbol, name, updated_at FROM token_cache WHERE found = 1 AND token_addr = ?', a),
    cacheByName: (s) => all("SELECT token_addr, pair_json, symbol, name, updated_at FROM token_cache WHERE found = 1 AND LOWER(name) = ? ORDER BY reads DESC LIMIT 5", s),
    // Market Data's own scan store and the radar (public market data, never who scanned)
    scansBy: (where, args) => all('SELECT chain, address, symbol, name, price_usd, mcap, fdv, liquidity_usd, volume_24h, holders, at, read_at FROM mkt_scan WHERE ' + where + ' ORDER BY id DESC LIMIT 5', ...args),
    radarBy: (where, args) => all('SELECT token, symbol, name, price_usd, liquidity_usd, mcap, fdv, volume_24h, created_at, updated_at FROM mkt_radar WHERE token IS NOT NULL AND ' + where + ' ORDER BY updated_at DESC LIMIT 5', ...args),
    // a token's pools in its network's newest FINISHED batch (Market Data names the batch in mkt_state once its last page is in)
    poolsOf: (chainKey, addr) => {
      const ch = MD.CHAIN_BY_KEY.get(chainKey), st0 = ch && ch.gt ? one('SELECT value FROM mkt_state WHERE name = ?', 'pools:' + ch.gt) : null;
      let at = null; try { at = st0 ? JSON.parse(st0.value).at : null; } catch {}
      return Number.isFinite(at) ? all('SELECT pool, dex, quote_symbol, name, price_usd, reserve_usd, vol_h24, created_at FROM mkt_pool_snap WHERE network = ? AND at = ? AND base_addr = ? ORDER BY reserve_usd DESC LIMIT 10', ch.gt, at, addr) : [];
    },
    radarNewest: (n) => all("SELECT pair, token, symbol, name, liquidity_usd, mcap, volume_24h, created_at, first_seen, updated_at FROM mkt_radar WHERE symbol IS NOT NULL AND symbol NOT IN ('', '???') ORDER BY COALESCE(created_at, first_seen) DESC LIMIT ?", n),
    // Sendy's own two tables (no identity in either); only an answer kept as reusable (the site's own words) is ever reused
    rated: () => all("SELECT id, q, a, at, up, down FROM sendy_qa WHERE up - down >= 2 AND reuse = 1 AND a != '' ORDER BY (up - down) DESC, at DESC LIMIT 300"),
    qa: (id) => one('SELECT id, q, a, at, up, down, reuse FROM sendy_qa WHERE id = ?', id),
    /* The token symbols the site has read — its coins, the Scanner's cache and store, the radar, Market Data's newest pools,
       the communities, the public calls — and the members' names as every Send Wall shows them: so "gwc" and "pepe" typed as
       plain words are known for what they are, and spelling never "corrects" a symbol or a name into a word. Words only:
       nothing is quoted from these, and a squad's call is not read. */
    symbols: () => {
      const rows = all('SELECT symbol FROM token_cache WHERE found = 1 AND symbol IS NOT NULL LIMIT 5000')
        .concat(all('SELECT DISTINCT symbol FROM mkt_radar WHERE symbol IS NOT NULL LIMIT 5000'), all('SELECT DISTINCT symbol FROM communities LIMIT 2000'),
          all('SELECT DISTINCT symbol FROM calls WHERE squad_id IS NULL AND symbol IS NOT NULL LIMIT 5000'), all('SELECT DISTINCT symbol FROM (SELECT symbol FROM mkt_scan ORDER BY id DESC LIMIT 20000)'));
      for (const s of all("SELECT name, value FROM mkt_state WHERE name LIKE 'pools:%'")) {
        let at = null; try { at = JSON.parse(s.value).at; } catch {}
        if (Number.isFinite(at)) for (const r of all('SELECT DISTINCT base_symbol symbol FROM mkt_pool_snap WHERE network = ? AND at = ?', s.name.slice(6), at)) rows.push(r);
      }
      return rows.map((r) => r.symbol);
    },
    usernames: () => all('SELECT username FROM users WHERE deleted_at IS NULL AND system = 0 ORDER BY points DESC LIMIT 50000').map((r) => r.username),
  };

  /* ----- Sendy's own tables: the answers (sendy_qa, created with the site's schema) and the questions he could not answer ----- */
  function migrate() {
    db.exec(`CREATE TABLE IF NOT EXISTS sendy_misses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT NOT NULL,          -- the question as typed — no account, no address: nothing says who asked
  page TEXT,                -- the page it was asked on
  engine TEXT,              -- which answerer could not answer it: 'brain' (no model key) or 'model'
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sendy_misses_at ON sendy_misses(at);
-- every answer is kept in sendy_qa now (both answerers): the rated ones and the old unrated ones are read on a timer
CREATE INDEX IF NOT EXISTS idx_sendy_qa_rated ON sendy_qa(at) WHERE up - down >= 2;
CREATE INDEX IF NOT EXISTS idx_sendy_qa_at ON sendy_qa(at);`);
    /* reuse = 1 only for an answer made of the site's own words (passageAnswer and askModel say which): never one that
       quoted a member — a post, a Support answer, a community's name — since a takedown or a deletion would live on in it,
       and never one that said a reading (a price, a count, a board), which is only true when it is read. Every answer kept
       before this is 0. */
    try { db.exec('ALTER TABLE sendy_qa ADD COLUMN reuse INTEGER NOT NULL DEFAULT 0'); } catch {}   // already there
  }
  function miss(q, page, engine) {
    try { db.prepare('INSERT INTO sendy_misses (q, page, engine, at) VALUES (?, ?, ?, ?)').run(String(q).slice(0, 600), page || null, engine || 'brain', now()); } catch (e) { log('[sendy] a missed question could not be kept — ' + (e && e.message)); }
  }
  function prune() {
    try {
      db.prepare('DELETE FROM sendy_misses WHERE at < ?').run(now() - MISS_KEEP_MS);
      db.prepare('DELETE FROM sendy_misses WHERE id <= (SELECT id FROM sendy_misses ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MISS_KEEP_ROWS);
      // after 90 days only an answer in use stays (reusable and rated helpful): a rated one that may not be reused has no use
      // left, and may hold the words of a post taken down since
      db.prepare('DELETE FROM sendy_qa WHERE at < ? AND NOT (reuse = 1 AND up - down >= 2)').run(now() - QA_UNRATED_KEEP_MS);
      db.prepare('DELETE FROM sendy_qa WHERE up = 0 AND down = 0 AND id <= (SELECT id FROM sendy_qa WHERE up = 0 AND down = 0 ORDER BY id DESC LIMIT 1 OFFSET ?)').run(QA_UNRATED_KEEP_ROWS);
    } catch (e) { log('[sendy] prune — ' + (e && e.message)); }
  }
  // for the admin: the questions nobody could answer, the same question asked twice counted once with how often
  function misses(limit = 100) {
    const rows = all('SELECT q, page, engine, at FROM sendy_misses ORDER BY id DESC LIMIT 2000');
    const by = new Map();
    for (const r of rows) {
      const k = terms(r.q).sort().join(' ') || lc(r.q);
      const g = by.get(k); if (g) { g.n++; continue; }
      by.set(k, { q: r.q, page: r.page, engine: r.engine, at: r.at, n: 1 });
    }
    const total = (one('SELECT COUNT(*) n FROM sendy_misses') || {}).n || 0;
    return { total, keptDays: MISS_KEEP_MS / DAY, keptRows: MISS_KEEP_ROWS, rows: [...by.values()].slice(0, limit) };
  }

  /* ===== THE KNOWLEDGE: what goes into the index ===================================================================== */
  const PAGE_FILES = ['index', 'about', 'support', 'communities', 'newpairs', 'wall', 'watchlist', 'tracker', 'arcade', 'data', 'market', 'privacy', 'whitepaper', 'profile'];
  const FILES = [
    { key: 'readme', file: path.join(root, 'README.md'), read: (s) => readmeChunks(s).map((c) => Object.assign(c, { kind: 'readme' })) },
    { key: 'notes', file: path.join(root, 'public', 'sendy.js'), read: (s) => readNotes(s, EMAIL).map((n) => ({ kind: 'note', title: n.key, text: n.answer, extra: n.keywords.join(' ') + ' ' + n.keywords.join(' '), href: (/(?:^|[\s(])(\/[a-z]+)(?![\w/])/.exec(n.answer) || [])[1] || null, note: n.key })) },
    { key: 'terms', file: path.join(root, 'public', 'terms.html'), read: (s) => termsChunks(s).map((c) => Object.assign(c, { kind: 'terms' })) },
  ].concat(PAGE_FILES.map((f) => ({ key: 'page:' + f, file: path.join(root, 'public', f + '.html'),
    read: (s) => htmlChunks(s, ROUTES.cleanPath(f + '.html'), { title: f === 'whitepaper' ? 'The white paper' : '' }).map((c) => Object.assign(c, { kind: f === 'whitepaper' ? 'whitepaper' : 'page' })) })));
  function putFile(spec, text) {
    for (const id of index.ids('file')) if (id.startsWith('file:' + spec.key + ':')) index.remove(id);
    let chunks = [];
    try { chunks = spec.read(text); } catch (e) { log('[sendy] ' + spec.key + ' could not be read into the index — ' + (e && e.message)); }
    chunks.forEach((c, i) => index.add(Object.assign({ id: 'file:' + spec.key + ':' + i, at: null }, c)));
  }
  // the site map's lines (server.js SENDY_SITE_MAP): one passage per page, for "where is …" ("/a — x · /b — y" is two pages)
  function putSiteMap() {
    let n = 0;
    for (const line of String(deps.siteMap || '').split('\n')) {
      for (const seg of line.trim().split(/ · (?=\/)/)) {
        const m = /^(\/\S*)\s+—\s+(.+)$/.exec(seg);
        if (!m) continue;
        index.add({ id: 'map:' + n++, kind: 'map', title: 'the page ' + m[1], text: m[2], href: /[<>]/.test(m[1]) ? null : m[1], at: null });
      }
    }
  }
  async function readFiles(force) {
    for (const spec of FILES) {
      let s; try { s = await fs.promises.stat(spec.file); } catch { continue; }
      if (!force && fileAt.get(spec.key) === s.mtimeMs) continue;
      let text; try { text = await fs.promises.readFile(spec.file, 'utf8'); } catch { continue; }
      slice(() => putFile(spec, text));
      fileAt.set(spec.key, s.mtimeMs);
      await yieldLoop();
    }
  }
  /* the people-written passages. A post or an answer that pushes a trade (pushes()) is never one: it is not in the index, so
     neither the brain nor the model's search ever sees it, and Sendy cannot repeat it */
  const removed = (s) => /^\[(removed|deleted)/.test(s);
  const postDoc = (r) => {
    const t = clip(r.text, 1200);
    if (!t || removed(t) || pushes(t)) return null;
    if (r.board === 'support') return null;   // a Support question is its own passage, with its answers (supportDoc)
    return { id: 'post:' + r.id, kind: 'post', ref: r.id, title: '@' + r.username + (r.community_id ? ' in a community' : ' on the Send Wall'), text: t,
      href: r.community_id ? '/community?id=' + r.community_id + '#p' + r.id : '/u/' + encodeURIComponent(r.username) + '#p' + r.id, at: r.created_at, author: r.username };
  };
  function supportDoc(r) {
    const q = clip(r.text, 600);
    if (!q || removed(q) || pushes(q)) return null;
    const said0 = READ.supportAnswers(r.id).filter((a) => a.text && !removed(a.text)), answers = said0.filter((a) => !pushes(a.text));
    return { id: 'sq:' + r.id, kind: 'support', ref: r.id, title: q, text: q + ' ' + answers.map((a) => a.text).join(' '), href: '/support#p' + r.id, at: r.created_at,
      question: q, answers: answers.map((a) => ({ text: clip(a.text, 600), by: a.username, at: a.created_at })), held: said0.length - answers.length };
  }
  // a token's or a community's name is whatever its maker typed: one that pushes a trade is left out, and the symbol says which
  const nameOf = (s) => (s && !pushes(s) ? String(s) : '');
  const callDoc = (r) => ({ id: 'call:' + r.id, kind: 'call', ref: r.id, title: 'Send Call on ' + sym(r.symbol), text: '@' + r.username + ' made a Send Call on ' + sym(r.symbol) + (nameOf(r.name) ? ' (' + r.name + ')' : '') + ' on ' + new Date(r.created_at).toISOString().slice(0, 10) + '.',
    extra: r.symbol + ' ' + nameOf(r.name), href: r.post_id ? '/u/' + encodeURIComponent(r.username) + '#p' + r.post_id : '/u/' + encodeURIComponent(r.username), at: r.created_at, token: r.token_addr });
  const communityDoc = (c) => { const n = nameOf(c.name); return { id: 'comm:' + c.id, kind: 'community', ref: c.id, title: sym(c.symbol) + (n ? ' ' + n : '') + ' community', extra: c.symbol + ' ' + n + ' community',
    text: sym(c.symbol) + (n ? ' ' + n : '') + ' is a ' + (c.status === 'live' ? 'live' : 'pending') + ' community' + (c.official ? ' run by the site' : '') + (c.demo ? ' (the open sandbox)' : '') + ' with ' + (c.qual_count || 0) + ' verified member' + (c.qual_count === 1 ? '' : 's') + '.',
    href: '/community?id=' + c.id, at: c.went_live_at || c.created_at }; };
  /* an earlier answer readers rated, as a passage: only one kept as reusable (the site's own words, see migrate) is read at
     all. Its question helps it be found but is never shown or sent: a visitor may have typed something about themselves */
  const ratedDoc = (r) => ({ id: 'rated:' + r.id, kind: 'rated', ref: r.id, title: '', text: r.a, extra: r.q, answer: r.a, href: null, at: r.at });
  function putRows(rows, fn) { for (const r of rows) { const d = fn(r); if (d) index.add(d); } }
  async function readRows() {
    // new posts (the Support board's questions among them) and new answers under Support questions
    for (;;) {
      const rows = READ.postsAfter(wm.post, BATCH); if (!rows.length) break;
      slice(() => { putRows(rows, postDoc); putRows(rows.filter((r) => r.board === 'support'), supportDoc); wm.post = rows[rows.length - 1].id; });
      await yieldLoop(); if (rows.length < BATCH) break;
    }
    for (;;) {
      const rows = READ.commentsAfter(wm.comment, BATCH); if (!rows.length) break;
      slice(() => { for (const pid of new Set(rows.map((r) => r.post_id))) { const p = READ.post(pid); if (p) { const d = supportDoc(p); if (d) index.add(d); } } wm.comment = rows[rows.length - 1].id; });
      await yieldLoop(); if (rows.length < BATCH) break;
    }
    for (;;) {
      const rows = READ.callsAfter(wm.call, BATCH); if (!rows.length) break;
      slice(() => { putRows(rows, callDoc); wm.call = rows[rows.length - 1].id; });
      await yieldLoop(); if (rows.length < BATCH) break;
    }
    slice(() => {
      const cs = READ.communities(), seen = new Set(cs.map((c) => 'comm:' + c.id));
      for (const id of index.ids('comm')) if (!seen.has(id)) index.remove(id);
      putRows(cs, communityDoc);
    });
    putRated();
  }
  function putRated() {
    slice(() => {
      const rs = READ.rated(), keep = new Set();
      for (const r of rs) { const d = ratedDoc(r); if (d) { index.add(d); keep.add(d.id); } }
      for (const id of index.ids('rated')) if (!keep.has(id)) index.remove(id);
    });
  }
  /* The whole people-written part again, newest first up to its ceiling: an edit, a takedown, a deletion or a restore since
     the watermarks passed shows up here. Each row's passage replaces its old one as it is read, and whatever was not read
     again (taken down, deleted, made private, past the ceiling) is dropped at the end. */
  async function rebuildRows() {
    const keep = new Set();
    let before = Number.MAX_SAFE_INTEGER, n = 0, top = 0;
    while (n < POSTS_MAX) {
      const rows = READ.postsBefore(before, BATCH); if (!rows.length) break;
      slice(() => { for (const r of rows) { top = Math.max(top, r.id); const d = r.board === 'support' ? supportDoc(r) : postDoc(r); if (d) { index.add(d); keep.add(d.id); } } });
      n += rows.length; before = rows[rows.length - 1].id; await yieldLoop();
      if (rows.length < BATCH) break;
    }
    before = Number.MAX_SAFE_INTEGER; n = 0; let topCall = 0;
    while (n < CALLS_MAX) {
      const rows = READ.callsBefore(before, BATCH); if (!rows.length) break;
      slice(() => { for (const r of rows) { topCall = Math.max(topCall, r.id); const d = callDoc(r); index.add(d); keep.add(d.id); } });
      n += rows.length; before = rows[rows.length - 1].id; await yieldLoop();
      if (rows.length < BATCH) break;
    }
    slice(() => {
      for (const id of [...index.ids('post'), ...index.ids('sq'), ...index.ids('call')]) if (!keep.has(id)) index.remove(id);
      wm.post = Math.max(wm.post, top); wm.call = Math.max(wm.call, topCall); wm.comment = Math.max(wm.comment, READ.maxComment());
    });
    st.rebuilds++; st.lastRebuildAt = now();
  }
  async function load() {
    const t0 = Date.now();
    putSiteMap();
    await readFiles(true);
    await rebuildRows();
    await readRows();
    st.loadedAt = now(); st.lastTickMs = Date.now() - t0;
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true; const t0 = Date.now();
    try {
      if (!st.loadedAt) await load();
      else {
        await readFiles(false);
        if (++st.ticks % REBUILD_EVERY === 0) await rebuildRows();
        await readRows();
      }
      if (st.ticks % 5 === 0 || namesMemo.at === -Infinity) slice(() => names(true));   // the symbols and the members' names, every five ticks
      if (st.ticks % 10 === 0) { slice(prune); st.prunedAt = now(); }   // the first tick and every tenth: pruning by age needs no more often
      st.lastTickAt = now(); st.lastTickMs = Date.now() - t0;
    } catch (e) { st.errors++; log('[sendy] the index could not be refreshed — ' + (e && e.message)); }
    finally { busy = false; }
  }
  function start() {
    stopped = false;
    if (timer) return;
    setImmediate(() => { tick().catch(() => {}); });
    timer = setInterval(() => { tick().catch(() => {}); }, REFRESH_MS);
    if (timer.unref) timer.unref();
  }
  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  // a reader's thumb: the rated answers are read again at once, so what is reused changes for the next question
  function rated() { putRated(); }
  // a passage from a row is checked again before it is quoted: a post taken down or made private since is never repeated
  function stillPublic(d) {
    if (d.kind === 'post' || d.kind === 'support') {
      const r = READ.post(d.ref);
      const fresh = r && (d.kind === 'support' ? supportDoc(r) : postDoc(r));
      if (!fresh) { index.remove(d.id); return null; }
      if (fresh.text !== d.text) index.add(fresh);
      return fresh;
    }
    if (d.kind === 'call') { if (!READ.call(d.ref)) { index.remove(d.id); return null; } return d; }
    if (d.kind === 'rated') { const r = READ.qa(d.ref); if (!r || r.up - r.down < 2 || r.reuse !== 1) { index.remove(d.id); return null; } return d; }
    return d;
  }
  /* The Support board for the model's live block (server.js sendyLive): the questions the server picked, each read again at
     the moment of the question through the same filters as the index — a live author, nothing removed, nothing that pushes a
     trade — so a takedown or a deletion is never in it, not even for the minutes a memo would keep it. */
  function supportFor(ids) {
    const outs = [];
    for (const id of ids || []) { const r = READ.post(id), d = r && r.board === 'support' ? supportDoc(r) : null; if (d && d.answers.length) outs.push({ q: d.question, a: d.answers.slice(0, 2).map((x) => x.text) }); }
    return outs;
  }
  // the answers readers rated, for the same block: the reusable ones only, and only the answers (never the visitor's question)
  const ratedAnswers = (n) => READ.rated().slice(0, n).map((r) => r.a);

  /* ===== THE TOOLS: read-only, live, each with its source and read time ============================================== */
  const marketHref = (chain, token) => '/market?chain=' + encodeURIComponent(chain) + (token ? '&token=' + encodeURIComponent(token) : '');
  const scanHref = (chain, addr) => '/newpairs?scan=' + encodeURIComponent(addr) + '&chain=' + encodeURIComponent(chain);
  const notRead = (why, extra) => Object.assign({ ok: false, why }, extra || {});
  const pairOf = (row) => { try { return row && row.pair_json ? JSON.parse(row.pair_json) : null; } catch { return null; } };
  // one cached Scanner profile (token_cache) as figures
  function scannerFigures(p, at) {
    const m = (p && p.market) || {};
    return {
      priceUsd: F(m.priceUsd, 'scanner', at), mcap: F(m.marketCap != null ? m.marketCap : null, 'scanner', at, 'the Scanner has no market cap for it'), fdv: F(m.fdv, 'scanner', at),
      liquidity: F(m.liquidityUsd, 'scanner', at), volume24h: F(p && p.volume ? p.volume.h24 : null, 'scanner', at), change24h: F(p && p.priceChange ? p.priceChange.h24 : null, 'scanner', at),
      holders: F(p && p.holders ? p.holders.count : null, 'scanner', at, 'the holder count was not read'),
    };
  }
  const TOOLS = {
    site_tokens: {
      description: "The site's own coins, $SEND and $GWC on Robinhood Chain, as the Scanner last read them (the home page's reading): price, market cap, liquidity, 24 h volume and change, holders.",
      params: {},
      run: () => ({ ok: true, src: 'scanner', tokens: Object.entries(SITE_TOKENS).map(([s, addr]) => {
        const row = READ.siteToken(lc(addr)), p = pairOf(row);
        if (!p) return { symbol: s, address: lc(addr), chain: 'robinhood', why: 'the Scanner has no reading of it yet' };
        return Object.assign({ symbol: s, name: p.token && p.token.name, address: lc(addr), chain: 'robinhood', at: row.updated_at, href: scanHref('robinhood', lc(addr)) }, scannerFigures(p, row.updated_at));
      }) }),
    },
    find_token: {
      description: 'A token by its symbol ($PEPE or PEPE), its name, or its contract address, on any chain the site reads (Robinhood Chain, Ethereum, Solana, Base, BNB Chain, Arbitrum, Polygon, Avalanche, Optimism), from what the site has already read: Market Data\'s pool snapshots (with the token\'s pools in them), the Scanner\'s readings and the New Pairs radar. Nothing is fetched for the question; a token the site has not read is said so.',
      params: { query: { type: 'string', description: 'the symbol, name or address' }, chain: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'a chain to look on, or null for every chain' } },
      run: (a) => findToken(String(a.query || ''), a.chain ? chainKeyOf(String(a.chain)) : null),
    },
    market_tokens: {
      description: 'The top tokens of one chain, or of every chain the site reads (chain "all"), from Market Data: the most-traded pools on GeckoTerminal grouped by token, sorted by volume, liquidity, market cap, FDV or price change over a time frame.',
      params: { chain: { type: 'string', description: 'a chain (robinhood, ethereum, solana, base, bsc, arbitrum, polygon, avalanche, optimism) or "all"' },
        sort: { type: 'string', enum: ['volume', 'liquidity', 'mcap', 'fdv', 'change'] }, direction: { type: 'string', enum: ['desc', 'asc'] }, window: { type: 'string', enum: ['24h', '6h', '1h', '5m'] }, limit: { type: 'integer', description: '1 to 10' } },
      run: (a) => marketTokens(a.chain === 'all' ? 'all' : chainKeyOf(String(a.chain || 'robinhood')) || String(a.chain || ''), a.sort, a.direction, a.window, a.limit),
    },
    market_chains: {
      description: 'The top chains from Market Data (DefiLlama, L2BEAT): DeFi TVL, DEX volume, gas fees, stablecoins, DEX liquidity, own-token market cap, value secured.',
      params: { sort: { type: 'string', enum: ['tvl', 'volume', 'fees', 'stables', 'liquidity', 'mcap', 'tvs'] }, window: { type: 'string', enum: ['24h', '7d', '30d'] }, limit: { type: 'integer', description: '1 to 10' } },
      run: (a) => marketChains(a.sort, a.window, a.limit),
    },
    market_chain: {
      description: "One chain's figures from Market Data: DeFi TVL, DEX volume (24 h, 7 d, 30 d), gas and app fees, stablecoins, open interest, DEX liquidity, its own token's market cap, L2BEAT's value secured and stage, transactions and active addresses.",
      params: { chain: { type: 'string', description: 'the chain, by name or key' } },
      run: (a) => marketChain(chainKeyOf(String(a.chain || '')) || lc(a.chain)),
    },
    chain_pulse: {
      description: "Robinhood Chain's own pulse, read from the chain: the latest block, the block time, gas, pools created in the last 24 hours, WETH and USDG supply, and the ETH its canonical bridge holds on Ethereum.",
      params: {},
      run: () => pulse(),
    },
    new_pools: {
      description: 'The newest pools on a chain (Robinhood Chain: read from the chain itself; the others: GeckoTerminal), and on Robinhood Chain the New Pairs radar\'s newest named pairs.',
      params: { chain: { type: 'string', description: 'the chain, by name or key' }, limit: { type: 'integer', description: '1 to 10' } },
      run: (a) => newPools(chainKeyOf(String(a.chain || 'robinhood')) || 'robinhood', a.limit),
    },
    recent_scans: {
      description: 'The tokens people scanned most recently on the Scanner (which tokens and how often — never who).',
      params: {},
      run: () => recentScans(),
    },
    leaderboard: {
      description: 'The all-time leaderboard: members ranked by Send Power, with their level and title.',
      params: { limit: { type: 'integer', description: '1 to 20' } },
      run: (a) => leaderboard(a.limit),
    },
    member: {
      description: "One member's public profile, exactly as their Send Wall (/u/<name>) shows it to anyone: Send Power, level, title, rank, when they joined, public posts, followers. Nothing private.",
      params: { username: { type: 'string', description: 'the username, with or without @' } },
      run: (a) => member(String(a.username || '')),
    },
    communities: {
      description: 'The communities (holders-only walls around a token): which are live, which are still gathering members, their verified member counts; and how many Send Squads exist (squads are private, so only their number).',
      params: { query: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'a symbol or name to look for, or null for the list' } },
      run: (a) => communities(a.query ? String(a.query) : null),
    },
    competitions: {
      description: "The Arcade: this week's Biggest Sender race (standings, when it ends, the prize ladder, last week's winners), the weekly Send Calls board, the community race, and today's Rocket Run.",
      params: {},
      run: () => competitions(),
    },
    site_counts: {
      description: 'How many members, public Send Calls, public posts, Support questions, live and pending communities and Send Squads the site has right now.',
      params: {},
      run: () => ({ ok: true, src: 'site', at: now(), counts: READ.counts() }),
    },
    search_site: {
      description: "Searches everything public the site has written: every page, the white paper, the README's guide, the Terms' section titles, the Support board's questions and answers, public Send Wall and community posts, public Send Calls, the communities, and earlier answers readers rated helpful. Returns the best passages, each with its page.",
      params: { query: { type: 'string', description: 'what to look for' }, only: { type: 'string', enum: ['everything', 'docs', 'support', 'posts'] } },
      run: (a) => searchSite(String(a.query || ''), a.only || 'everything'),
    },
    note_unanswered: {
      description: 'Call this when neither the site text nor any tool holds the answer, before you tell the person so. It keeps the question (never who asked) so the site owner can see what people need.',
      params: { reason: { type: 'string', description: 'a few words: what was missing' } },
      run: (a, ctx) => { if (ctx && ctx.q && !ctx.missed) { ctx.missed = true; miss(ctx.q, ctx.page, 'model'); } return { ok: true, kept: true }; },
    },
  };
  // the same tools as the model sees them: strict JSON schemas, every property required (an optional one is nullable)
  const TOOL_DEFS = Object.entries(TOOLS).map(([name, t]) => ({
    name, description: t.description, strict: true,
    input_schema: { type: 'object', properties: t.params, required: Object.keys(t.params), additionalProperties: false },
  }));
  // a tool's input, checked against its schema before it runs (the model's JSON is untrusted, like any input)
  function validInput(name, input) {
    const t = TOOLS[name]; if (!t) return 'no such tool';
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'the input is not an object';
    for (const k of Object.keys(input)) if (!(k in t.params)) return 'unexpected field ' + k;
    for (const [k, p] of Object.entries(t.params)) {
      const v = input[k];
      if (v === undefined) return 'missing field ' + k;
      const types = p.anyOf ? p.anyOf.map((x) => x.type) : [p.type];
      const ok = types.some((ty) => (ty === 'null' ? v === null : ty === 'integer' ? Number.isInteger(v) && v >= 0 && v <= 1000 : ty === 'string' ? typeof v === 'string' && v.length <= 300 : typeof v === ty));
      if (!ok) return 'field ' + k + ' is not ' + types.join(' or ');
      if (p.enum && !p.enum.includes(v)) return 'field ' + k + ' is one of ' + p.enum.join(', ');
    }
    return null;
  }
  function runTool(name, input, ctx) {
    const bad = validInput(name, input);
    if (bad) return { error: bad };
    try { return TOOLS[name].run(input, ctx) || notRead('nothing came back'); }
    catch (e) { log('[sendy] tool ' + name + ' — ' + (e && e.message)); return { error: 'the tool could not read its data just now' }; }
  }

  // the chains Market Data lists beyond the nine it reads the pools of: their keys and names, read again once a minute
  let otherMemo = { at: 0, v: [] };
  function otherChains() {
    if (now() - otherMemo.at < MIN) return otherMemo.v;
    let rows = []; try { rows = MKT ? MKT.chains({ limit: 200 }).body.rows || [] : []; } catch {}
    otherMemo = { at: now(), v: rows.filter((r) => r.name && r.name.length > 3 && !CHAIN_NAMES[r.key]).map((r) => ({ key: r.key, name: lc(r.name), re: new RegExp('\\b' + lc(r.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b') })) };
    return otherMemo.v;
  }
  function chainKeyOf(s) {
    const t = lc(s).trim().replace(/[-_]/g, ' ');
    if (!t) return null;
    for (const [k, re] of CHAIN_WORDS) if (k === t || re.test(t) || lc(CHAIN_NAMES[k]) === t) return k;
    if (t === 'eth') return 'ethereum'; if (t === 'bnb' || t === 'binance') return 'bsc'; if (t === 'rh') return 'robinhood'; if (t === 'sol') return 'solana';
    const r = otherChains().find((x) => lc(x.key) === t || x.name === t);   // any other chain Market Data lists, by its key or its name
    return r ? r.key : null;
  }
  const mktRow = (r) => ({ chain: r.chain, chainName: CHAIN_NAMES[r.chain] || r.chainName || r.chain, symbol: r.symbol, name: r.name, address: r.address, priceUsd: r.priceUsd, mcap: r.mcap, fdv: r.fdv, liquidity: r.liquidity, volume: r.volume, change: r.change, flags: r.flags, href: marketHref(r.chain, r.address) });
  function marketTokens(chain, sort, dir, win, limit) {
    if (!MKT) return notRead('Market Data is not running here');
    const n = Math.min(10, Math.max(1, Number(limit) || 5));
    const r = MKT.tokens({ chain: chain || 'robinhood', sort: sort || 'volume', dir: dir || 'desc', window: win || '24h', limit: n });
    const b = r.body || {};
    if (r.status !== 200) return notRead(b.error || 'Market Data could not answer');
    if (!b.rows || !b.rows.length) return notRead(b.why || 'no tokens read for that chain yet', { chain: b.chain || chain, href: chain === 'all' ? '/market' : marketHref(chain) });
    return { ok: true, src: 'geckoterminal', at: b.at, chain: b.chain, sort: b.sort, dir: b.dir, window: b.window && b.window.label, basis: b.basis, notes: b.notes, rows: b.rows.map(mktRow), href: chain === 'all' ? '/market' : marketHref(chain) };
  }
  function marketChains(sort, win, limit) {
    if (!MKT) return notRead('Market Data is not running here');
    const n = Math.min(10, Math.max(1, Number(limit) || 5));
    const r = MKT.chains({ sort: sort || 'tvl', dir: 'desc', window: win || '24h', limit: n }), b = r.body || {};
    if (r.status !== 200) return notRead(b.error || 'Market Data could not answer');
    if (!b.rows || !b.rows.length) return notRead(b.why || 'the chain figures have not been read yet', { href: '/market' });
    return { ok: true, at: b.at, sort: b.sort, window: b.window && b.window.label, notes: b.notes, rows: b.rows.map((c) => ({ key: c.key, name: c.name, tvl: c.tvl, volume: c.volume, fees: c.fees, stables: c.stables, liquidity: c.liquidity, mcap: c.mcap, tvs: c.tvs, href: marketHref(c.key) })), href: '/market' };
  }
  function marketChain(key) {
    if (!MKT) return notRead('Market Data is not running here');
    if (!key) return notRead('no chain by that name in Market Data');
    const r = MKT.chain({ key }), b = r.body || {};
    if (r.status === 404) return notRead('Market Data does not list that chain', { chain: key });
    if (r.status !== 200 || !b.stats) return notRead(b.why || b.error || 'the chain figures have not been read yet', { chain: key, href: marketHref(key) });
    const s = b.stats;
    return { ok: true, chain: key, name: b.name, at: b.at, stats: { tvl: s.tvl, volume24h: s.volume24h, volume7d: s.volume7d, volume30d: s.volume30d, fees24h: s.fees24h, appFees24h: s.appFees24h, stables: s.stables, oi: s.oi, liquidity: s.liquidity, mcap: s.mcap, tvs: s.tvs, txcount24h: s.txcount24h, daa: s.daa, stage: s.stage },
      topTokens: ((b.topTokens && b.topTokens.rows) || []).slice(0, 5).map(mktRow), href: marketHref(key) };
  }
  function pulse() {
    if (!MKT) return notRead('Market Data is not running here');
    const p = MKT.pulseView();
    if (!p.now) return notRead(p.why || 'the chain has not been read yet', { href: marketHref('robinhood') });
    const n = p.now, pc = p.poolsCreated || {};
    return { ok: true, chain: 'robinhood', src: 'rpc', at: n.at,
      block: F(n.block, 'rpc', n.at), blockTimeMs: F(n.blockTimeMs, 'rpc', n.at, 'the block time needs two readings an hour apart'), gasGwei: F(n.gasGwei, 'rpc', n.at),
      wethSupply: F(n.wethSupply, 'rpc', n.suppliesAt, 'the supplies have not been read yet'), usdgSupply: F(n.usdgSupply, 'rpc', n.suppliesAt, 'the supplies have not been read yet'),
      bridgeEth: F(n.bridgeEth, 'ethrpc', n.bridgeAt, 'the bridge has not been read yet'),
      poolsCreated24h: pc.h24 ? { v2: pc.h24.v2, v3: pc.h24.v3, v4: pc.h24.v4, total: pc.h24.v2 + pc.h24.v3 + pc.h24.v4, src: 'rpc', at: n.at } : { v: null, src: 'rpc', why: pc.why || 'not counted yet' },
      labels: n.labels, href: marketHref('robinhood') };
  }
  function newPools(chain, limit) {
    if (!MKT) return notRead('Market Data is not running here');
    const n = Math.min(10, Math.max(1, Number(limit) || 5));
    const b = MKT.newPools({ chain, limit: n }).body || {};
    const radar = chain === 'robinhood' ? READ.radarNewest(n).map((r) => ({ symbol: r.symbol, name: r.name, token: r.token, liquidity: F(r.liquidity_usd, 'site', r.updated_at), mcap: F(r.mcap, 'site', r.updated_at), createdAt: r.created_at || r.first_seen, at: r.updated_at })) : [];
    return { ok: true, chain, src: b.src, label: b.label, pools: (b.rows || []).map((r) => ({ pool: r.pool, dex: r.dex, block: r.block, createdAt: r.createdAt || r.firstSeen, baseSymbol: r.baseSymbol, quoteSymbol: r.quoteSymbol, name: r.name })),
      radar, href: chain === 'robinhood' ? '/newpairs' : marketHref(chain) };
  }
  function recentScans() {
    const sc = (R.scans ? R.scans() : []).slice(0, 15);
    if (!sc.length) return notRead('nobody has scanned a token here recently', { href: '/newpairs' });
    return { ok: true, src: 'site', at: now(), scans: sc.map((s) => ({ symbol: s.symbol, name: s.name, chain: s.chain, token: s.token, count: s.count, lastAt: s.lastAt, href: scanHref(s.chain || 'robinhood', s.token) })), href: '/newpairs' };
  }
  function leaderboard(limit) {
    const n = Math.min(20, Math.max(1, Number(limit) || 5));
    const top = (R.leaderboard ? R.leaderboard() : []).slice(0, n);
    if (!top.length) return notRead('nobody has any Send Power yet', { href: '/arcade' });
    return { ok: true, src: 'site', at: now(), rows: top.map((u) => ({ rank: u.rank, username: u.username, sendPower: u.points, level: u.level, title: u.title, href: '/u/' + encodeURIComponent(u.username) })), href: '/arcade' };
  }
  function member(name) {
    const u = String(name).trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(u)) return notRead('that is not a username');
    const m = R.member ? R.member(u) : null;
    if (!m) return notRead('no member called @' + u, { username: u });
    return { ok: true, src: 'site', at: now(), member: m, href: '/u/' + encodeURIComponent(m.username) };
  }
  function communities(query) {
    const cs = READ.communities(), c = READ.counts();
    const card = (x) => ({ symbol: x.symbol, name: nameOf(x.name) || null, status: x.status, official: !!x.official, sandbox: !!x.demo, verifiedMembers: x.qual_count || 0, members: x.member_count || 0, mcap: F(x.c_mc, 'site', x.c_at, 'not read yet'), href: '/community?id=' + x.id });
    if (query) {
      const q = lc(query).replace(/^\$/, '');
      const hit = cs.filter((x) => lc(x.symbol) === q || lc(x.name) === q).concat(cs.filter((x) => lc(x.name).includes(q) && lc(x.symbol) !== q && lc(x.name) !== q)).slice(0, 5);
      if (!hit.length) return notRead('no community for ' + query, { href: '/communities', squads: c.squads });
      return { ok: true, src: 'site', at: now(), communities: hit.map(card), href: hit[0] ? '/community?id=' + hit[0].id : '/communities' };
    }
    return { ok: true, src: 'site', at: now(), live: cs.filter((x) => x.status === 'live').slice(0, 20).map(card), pending: c.pendingCommunities, squads: c.squads, href: '/communities' };
  }
  function competitions() {
    const h = R.competitions ? R.competitions() : null;
    if (!h) return notRead('the Arcade could not be read just now', { href: '/arcade' });
    const bs = h.biggestSender || {}, rr = h.rocketRun || {}, sc = h.sendCalls || {};
    return { ok: true, src: 'site', at: now(),
      biggestSender: { endsAt: bs.week && bs.week.endsAt, entrants: bs.entrants, top: (bs.top || []).slice(0, 5).map((r) => ({ rank: r.rank, username: r.username, sendPower: r.points })), prize: bs.prize ? { winners: bs.prize.winners, ladder: bs.prize.ladder } : null,
        lastWeek: bs.last ? { winners: (bs.last.winners || []).slice(0, 3).map((w) => ({ rank: w.rank, username: w.username, sendPower: w.points, boost: w.boost })) } : null },
      sendCalls: { entrants: sc.entrants, top: (sc.top || []).slice(0, 3).map((r) => ({ rank: r.rank, username: r.username, calls: r.calls, bestX: r.bestX })) },
      communities: ((h.communities && h.communities.board) || []).slice(0, 3).map((c) => ({ rank: c.rank, symbol: c.symbol, name: nameOf(c.name) || null, xpWeek: c.xpWeek })),
      rocketRun: { flightsToday: rr.flightsToday, cashedToday: rr.cashedToday, bestXToday: rr.bestXToday, resetsAt: rr.resetsAt, riders: (rr.riders || []).map((r) => ({ rank: r.rank, name: r.guest ? r.name : r.username, x: r.x })) },
      href: '/arcade' };
  }
  function searchSite(query, only) {
    const kinds = only === 'docs' ? DOC_KINDS : only === 'support' ? ['support'] : only === 'posts' ? ['post', 'call'] : null;
    const hits = index.search(queryTerms(query), { kinds, limit: 10, weight: kindWeight }).map((h) => ({ h, d: stillPublic(h.doc) })).filter((x) => x.d).slice(0, 5);
    if (!hits.length) return notRead('nothing on the site matches that');
    return { ok: true, src: 'site', at: now(), passages: hits.map(({ h, d }) => ({ kind: d.kind, title: d.kind === 'rated' ? 'An earlier answer readers rated helpful' : d.title,
      text: d.kind === 'support' ? 'Q: ' + d.question + (d.answers.length ? ' A: ' + d.answers.map((a) => a.text).join(' / ') : d.held ? ' (its answers push a trade, so they are left out)' : ' (no answer yet)') : d.kind === 'rated' ? d.answer : clip(d.text, 900), href: d.href, at: d.at, score: Math.round(h.score * 100) / 100 })) };
  }

  /* ----- a token from what the site has read ----- */
  // one message's lookups, kept while it is answered (its parts and follow-ups ask again for the same token: read once); and
  // whether the message as a whole lets a market figure be given (figureOnly over its parts), with the message as typed
  let lookups = null, figureBan = false, typedNow = '';
  function findToken(query, chain) {
    const key = lc(query) + '|' + (chain || '');
    if (lookups && lookups.has(key)) return lookups.get(key);
    const r = findTokenNow(query, chain);
    if (lookups) lookups.set(key, r);
    return r;
  }
  function findTokenNow(query, chain) {
    const raw = String(query).trim().replace(/^\$/, ''), q = lc(raw);
    if (!q || q.length > 80) return notRead('give a symbol, a name or an address');
    const isAddr = EVM_RE.test(raw) || B58_RE.test(raw);
    const found = [];
    // the site's own coins first, as the home page reads them
    for (const [s, addr] of Object.entries(SITE_TOKENS)) {
      if ((isAddr ? lc(addr) === q : lc(s) === q) && (!chain || chain === 'robinhood')) { const t = TOOLS.site_tokens.run().tokens.find((x) => x.symbol === s); if (t && !t.why) found.push(Object.assign({ from: 'scanner' }, t)); }
    }
    // Market Data's pool snapshots, every chain it reads
    if (MKT && found.length === 0) {
      for (const k of chain ? [chain] : GT_KEYS) {
        let rows = []; try { rows = (MKT.tokens({ chain: k, sort: 'liquidity', dir: 'desc', limit: 200 }).body || {}).rows || []; } catch {}
        for (const r of rows) {
          const hit = isAddr ? (k === 'solana' ? r.address === raw : lc(r.address) === q) : (lc(r.symbol) === q || lc(r.name) === q);
          if (hit) found.push(Object.assign({ from: 'market', at: r.priceUsd && r.priceUsd.at }, mktRow(r), { pools: READ.poolsOf(k, r.address).map((p) => ({ pool: p.pool, dex: p.dex, pair: p.name, quote: p.quote_symbol, reserveUsd: F(p.reserve_usd > 0 ? p.reserve_usd : null, 'geckoterminal', r.priceUsd && r.priceUsd.at, 'GeckoTerminal reports no reserve for it'), volume24h: F(p.vol_h24, 'geckoterminal', r.priceUsd && r.priceUsd.at) })) }));
        }
      }
    }
    // the Scanner's own records: its cache of profiles, its scan store and the radar
    if (!found.length && (!chain || chain === 'robinhood')) {
      const rows = isAddr ? [READ.cacheByAddr(q)].filter(Boolean) : READ.cacheBySymbol(raw).concat(READ.cacheByName(q));
      for (const row of rows) { const p = pairOf(row); if (p) found.push(Object.assign({ from: 'scanner', chain: 'robinhood', chainName: 'Robinhood Chain', symbol: row.symbol, name: row.name, address: row.token_addr, at: row.updated_at, href: scanHref('robinhood', row.token_addr) }, scannerFigures(p, row.updated_at))); }
    }
    if (!found.length) {
      const where = isAddr ? 'address = ?' + (chain ? ' AND chain = ?' : '') : '(symbol = ? COLLATE NOCASE OR LOWER(name) = ?)' + (chain ? ' AND chain = ?' : '');
      const args = isAddr ? [EVM_RE.test(raw) ? q : raw].concat(chain ? [chain] : []) : [raw, q].concat(chain ? [chain] : []);
      const seen = new Set();
      for (const r of READ.scansBy(where, args)) {
        const k = r.chain + '|' + r.address; if (seen.has(k)) continue; seen.add(k);
        const at = r.read_at || r.at;
        found.push({ from: 'scan', chain: r.chain, chainName: CHAIN_NAMES[r.chain] || r.chain, symbol: r.symbol, name: r.name, address: r.address, at, priceUsd: F(r.price_usd, 'scan', at), mcap: F(r.mcap, 'scan', at), fdv: F(r.fdv, 'scan', at), liquidity: F(r.liquidity_usd, 'scan', at), volume: F(r.volume_24h, 'scan', at), holders: F(r.holders, 'scan', at, 'the holder count was not read'), href: scanHref(r.chain, r.address) });
      }
    }
    if (!found.length && (!chain || chain === 'robinhood')) {
      for (const r of READ.radarBy(isAddr ? 'token = ?' : '(symbol = ? COLLATE NOCASE OR LOWER(name) = ?)', isAddr ? [q] : [raw, q])) {
        found.push({ from: 'radar', chain: 'robinhood', chainName: 'Robinhood Chain', symbol: r.symbol, name: r.name, address: r.token, at: r.updated_at, priceUsd: F(r.price_usd, 'site', r.updated_at), mcap: F(r.mcap, 'site', r.updated_at), fdv: F(r.fdv, 'site', r.updated_at), liquidity: F(r.liquidity_usd, 'site', r.updated_at), volume: F(r.volume_24h, 'site', r.updated_at), href: scanHref('robinhood', r.token) });
      }
    }
    if (!found.length) return notRead('the site has not read that token' + (chain ? ' on ' + (CHAIN_NAMES[chain] || chain) : '') + ' — the Scanner (/newpairs) reads any token on Robinhood Chain, Ethereum or Solana', { href: '/newpairs' });
    found.sort((a, b) => ((b.liquidity && b.liquidity.v) || 0) - ((a.liquidity && a.liquidity.v) || 0));
    for (const t of found) { const c = t.address ? READ.callsOf(lc(t.address)) : []; if (c.length) t.calls = { count: c.length, newest: c.slice(0, 3).map((x) => ({ by: x.username, at: x.created_at })) }; }
    return { ok: true, query: raw, tokens: found.slice(0, 5) };
  }

  /* ===== READING A MESSAGE: the names it may hold, and the words it may be a slip of =================================== */
  // the symbols and the members' names (READ.symbols, READ.usernames), read again every five minutes
  let namesMemo = { at: -Infinity, symbols: new Set(), users: new Map() };
  function names(fresh) {
    if (!fresh && namesMemo.at > -Infinity) return namesMemo;
    const symbols = new Set(), users = new Map();
    for (const s of READ.symbols()) if (s && /^[A-Za-z0-9][\w.-]{0,30}$/.test(s)) symbols.add(lc(s));
    for (const k of Object.keys(SITE_TOKENS)) symbols.add(lc(k));
    for (const u of READ.usernames()) if (u) users.set(lc(u), u);
    namesMemo = { at: now(), symbols, users };
    return namesMemo;
  }
  // the words Sendy's questions turn on: a slip of one of these is read as it even where the pages use it rarely
  const LEXICON = new Set(('price prices market cap liquidity volume holders holder change gainers losers movers trending leaderboard ranking rankings '
    + 'standings competition competitions contest race prize prizes winner winners winning community communities squad squads member members scanner '
    + 'scan scanned tracker wallet wallets profile picture username diamond hands power level rank arcade rocket biggest sender senders seed phrase '
    + 'private recovery affiliated official robinhood ethereum solana arbitrum polygon avalanche optimism base chain chains token tokens coin coins safe '
    + 'scam legit honeypot audited trustworthy dangerous risky sketchy prediction predict forecast invest investment guide support terms privacy '
    + 'whitepaper liability call calls send gas block bridge pool pools pair pairs launch launches listing listings radar supply stablecoins fees '
    + 'transactions addresses today week weekly followers posts questions accounts people users chart charts swap contract address verify verification '
    + 'burn email password sign notification notifications settings theme colour colours wall post comment reply follow follower multiplier explode '
    + 'looking checking').split(' '));
  /* Spelling. A word is known if the site's own pages use it or a form of it, if it is a symbol the site has read or a
     member's name, or if people here write it (three passages or more: their words, their slang) — a known word is never
     changed. An unknown word one slip from a word of the pages (two for a long word), with the same first letter (a slip is
     almost never there, and "zqsecret" is not "secret"), is read as that word: the nearest, then one of the words above, then
     the commonest; a four-letter word only as one of the words above (a short word has too many neighbours); never when two
     words are as near and about as common. */
  let lexMemo = { version: -1, at: 0, byLen: null };
  function targets() {
    if (lexMemo.byLen && (lexMemo.version === index.version() || now() - lexMemo.at < MIN)) return lexMemo.byLen;
    const byLen = new Map(), v = index.vocab();
    const put = (w, df, lex) => { if (!/^[a-z]{3,24}$/.test(w)) return; let b = byLen.get(w.length); if (!b) byLen.set(w.length, (b = [])); b.push({ w, df, lex }); };
    for (const w of LEXICON) put(w, v.get(w) || 0, true);
    for (const w of STOP) if (w.length >= 4 && !LEXICON.has(w)) put(w, v.get(w) || 0, true);
    for (const [w, df] of v) if (df >= 2 && !LEXICON.has(w) && !STOP.has(w)) put(w, df, false);
    lexMemo = { version: index.version(), at: now(), byLen };
    return byLen;
  }
  // the forms a word may be an inflection of ("polls" → "poll", "stories" → "story", "pinged" → "ping", "making" → "make")
  const baseForms = (w) => [w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, ''), w.replace(/ed$/, ''), w.replace(/d$/, ''), w.replace(/ing$/, ''), w.replace(/ing$/, 'e'), w.replace(/(.)\1(ed|ing)$/, '$1')].filter((b) => b !== w && b.length >= 3);
  const ahead = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  const LEX = {
    known: (w) => STOP.has(w) || LEXICON.has(w) || ENGLISH.has(w) || index.vocab().has(w) || index.ownDf(stem(w)) > 0 || names().symbols.has(w) || names().users.has(w) || index.df(stem(w)) >= 3
      || baseForms(w).some((b) => ENGLISH.has(b) || STOP.has(b) || LEXICON.has(b) || index.vocab().has(b)),
    best(w) {
      if (/in$/.test(w) && (index.vocab().has(w + 'g') || LEXICON.has(w + 'g'))) return w + 'g';   // "lookin", "trendin"
      if (w.length < 5) return null;   // a short word has too many neighbours: its slips are in the reader's own table (sned, gcw)
      const byLen = targets(), max = w.length >= 8 ? 2 : 1;
      let top = null, next = null;
      for (let L = w.length - max; L <= w.length + max; L++) for (const c of byLen.get(L) || []) {
        if (c.w[0] !== w[0]) continue;
        const d = WORDS.distance(w, c.w, max); if (d > max || (d === 2 && !c.lex)) continue;   // two slips: only to a word the questions turn on
        const k = [d, c.lex ? 0 : 1, -c.df];
        if (!top || ahead(k, top.k)) { next = top; top = { c, k }; } else if (!next || ahead(k, next.k)) next = { c, k };
      }
      if (!top || (!top.c.lex && top.c.df < 3)) return null;
      if (next && !top.c.lex && next.k[0] === top.k[0] && next.k[1] === top.k[1] && next.c.df * 2 > top.c.df) return null;
      return top.c.w;
    },
  };
  // the name in a pool a slip from a word (one letter for a short one, two for a long one) — for "did you mean"
  function nearest(word, pool, prefer) {
    const w = lc(word), max = w.length <= 4 ? 1 : 2;
    let best = null, bd = max + 1;
    for (const c of pool) {
      if (!c || c === w || Math.abs(c.length - w.length) > max) continue;
      const d = WORDS.distance(w, c, max);
      if (d < bd || (d === bd && prefer && prefer(c) && !prefer(best))) { bd = d; best = c; }
    }
    return bd <= max ? best : null;
  }
  const siteSym = (s) => Object.keys(SITE_TOKENS).some((k) => lc(k) === s);

  /* ===== THE ANSWERS WITHOUT A MODEL ================================================================================= */
  const kindWeight = (d) => ({ note: 1.3, map: 1.15, support: 1.2, rated: 1.15, page: 1, whitepaper: 1, readme: 0.9, terms: 0.7, community: 0.8, post: 0.55, call: 0.45 }[d.kind] || 1);
  const HAND_OVER = "I don't have an answer for that yet. Ask it on the Support board (/support), where the community and the team answer in public — or email " + EMAIL + " if it's private.";
  const ADVICE = "That's not something I — or anyone on this site — will ever say: nothing here tells anyone to buy, sell or hold, and nobody can predict a price. What I can do is show you the facts: read the token on the Scanner (/newpairs) — holders, liquidity, the contract — or on Market Data (/market), and decide for yourself. Everything here is entertainment, not financial advice, and the site is not affiliated with Robinhood.";
  // one already given away: whoever holds it holds the wallet, whatever is done next
  const GAVE = /\b(?:gave|given|sent|shared|showed|shown|told|typed|entered|pasted|dm'?e?d|leaked|exposed|stolen|stole|compromised|got (?:out|taken)|(?:someone|somebody|they|he|she|scammers?) (?:has|have|knows?|got))\b/i;
  const SECRETS_GAVE = 'If you have already given yours to someone, whoever holds it controls that wallet and it cannot be made safe again: make a new wallet with a new seed phrase, move what is left into it straight away, and report what happened on the Support board (/support).';
  const SECRETS = 'Never share a seed phrase, a private key or a password with anyone — not me, not a moderator, not a DM. This site never asks for them: signing in with a wallet is a free signature, never a transaction. If something asked you for one, report it, or email ' + EMAIL + '.';
  // the About page's own words (public/about.html, its "safe" section) and the Terms' first section, pointed to, never paraphrased
  const AFFILIATED = 'No. In the About page\'s words: “Independent community project, not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. "Robinhood Chain" is just the public network\'s name.” That is on /about#safe, and section 1 of the Terms (/terms#s1) says who runs the site.';
  const WHO = 'Just Send It (sendrh.com) is a fan-built, independent community site about $SEND and $GWC on Robinhood Chain — not affiliated with Robinhood Markets, Inc. Who runs it and how to reach them is section 1 of the Terms (/terms#s1); the team answers in public on the Support board (/support), and in private at ' + EMAIL + '.';
  // a question about whether a token is safe gets no figures (a figure beside "safe" reads like a yes) — only where to read it
  const safety = (t) => 'Nobody can promise that — not me, and not the Scanner. ' + (t && t.href
    ? 'The Scanner reads ' + sym(t.symbol) + "'s public chain data — holders, liquidity, the contract — at " + t.href + '; '
    : t ? 'The site has not read ' + sym(t.symbol) + ' yet: paste its address into the Scanner (/newpairs), which reads holders, liquidity and the contract from the chain; '
      : "Paste the token's address into the Scanner (/newpairs), which reads holders, liquidity and the contract from the chain; ")
    + "it is a reading of public chain data, not an audit, and nothing on it is a promise. Read it and decide for yourself — everything here is entertainment, not financial advice.";
  /* The shapes of a question, read on the plain sentence (lib/sendywords.js) — the guard rails (advice, a target, a seed
     phrase, Robinhood) on the message as typed too. Each says it the ways people do: "wen moon", "r u a bot", "whos #1",
     "how big is this place", "is gwc legit", "what token clubs can i join". */
  const RX = {
    advice: /\b((?<!\bhow )should i (buy|sell|hold|ape|get in|get out|invest|dump)|(is|are) (it|this|they|\$?\w+) (a )?(good|great|smart|bad) (buy|investment|bet|time to buy)|good (buy|investment|time to buy)|worth (buying|investing in)|buy or sell|sell or hold|hold or sell|financial advice|invest(ing)? in\b|ape in(to)?\b|will (it|this|they|\$?\w+) (go up|go down|rise|fall|pump|moon|dump|crash|recover|100x|10x)|going to (moon|pump|go up|go down|crash|zero|die|explode)|to the moon|price prediction|predict(ion)?s?\b|forecast|next (gem|100x|10x|moonshot)|when (should i|to) (buy|sell)|what should i buy|which (token|coin) should i|best (token|coin) to buy)/i,
    // the same asked in a chat's words: wen moon, is X a buy, should i ape, hold or dump, will it 10x, nfa, my rent money
    advice2: /\b(wh?en|wen) (moon|lambo|pump|10x|100x|binance)\b|\bmoon soon\b|\b(is|are) (?!there\b|the\b)(it|this|they|that|\$?[a-z0-9]+) (a )?(buy|sell|hold)\b(?!\s*(button|page|tab|guide|link|box|order|side|or sell\?? ?button))|\bgood entry\b|\bentry (point|price)\b|\b(should|shall|shud|shld) i (grab|ape|load|exit|bail|dump|cash out|take profits?|sell|hold|buy|invest|put|get in|get out|wait|fomo)\b|\bhold or (dump|sell|fold|buy)\b|\bdump or hold\b|\b(will|gonna|going to)\b[^.?!]{0,30}\b\d+ ?x\b|\b(can|could|might) (it|this|they|\$?[a-z0-9]+) (do |go |hit |make )?(a )?\d+ ?x\b|\b(gonna|going to) (pump|moon|dump|crash|go up|go down|explode|rip|run|recover)\b|\b(undervalued|overvalued|bullish|bearish|a good bet|a safe bet)\b|\bnfa\b|\bnot financial advice\b|\b(put|invest|bet|throw) (my|all my|our|all of my) (rent|savings|money|life savings|paycheck|salary)\b|\bwhich (one )?(is|would be) (a )?better (buy|investment|bet|hold|pick)\b|\bbetter (buy|investment|bet)\b|\bwhat (coin|token)s? (to|should i|do i) (buy|get|ape)\b|\b(buy|sell) the dip\b|\b(can|could|will|would|might)\s+\$?[a-z0-9]+\s+(flip|overtake|pass|beat|catch up (to|with))\s+\$?[a-z0-9]+|\bwhich (coin|token)s? (do |should |can )?i (buy|get|pick)\b|\b(make|get|earn) (a )?(big |huge |quick |fast |easy )?(profits?|gains|money)\b|\bget rich\b|\bdo (you|u) think (it|this|they|\$?[a-z0-9]+) (will )?(recovers?|bounces?|goes up|go up|pumps?|moons?|dumps?|comes back|survives?|makes it)\b|\bcut (my )?loss(es)?\b|\b(should|shall|shud) i (just |still |really |even )(sell|hold|buy|get out|exit|dump|wait|ape)\b|\btoo late (to (buy|get in|ape))?\b(?=[^.?!]*\b(it|this|\$?[a-z0-9]+)\b)/i,
    // a price target or the timing of a trade asks for a prediction or for advice too, however it is put
    target: /\b(will|can|could|would|is|might)\b[^.?!]{0,40}\b(hit|reach|get to|go to|going to|goes to|touch|break|pass|flip|cross|be worth|go back to)\b[^.?!]{0,24}(\$\s?\d|\d[\d,.]*\s?(cents?|c|dollars?|usd|x|k|m|b|mil(lion)?|bil(lion)?)\b|\b(a|one) (dollar|penny|cent|billion|million)\b|\bath\b|all[- ]time highs?|new highs?|the moon\b|zero\b)|\b(good|right|best|bad|great) time to (buy|get in|enter|invest|ape|sell|cash out|take profits?)\b|\bget in (now|before it)\b|\btoo late to (buy|get in|ape)\b|\bhow (high|far) (will|can|could) (it|this|they|\$?[a-z0-9]+) (go|pump|moon|reach|rise)\b|\bwhen (will|does) (it|this|they|\$?[a-z0-9]+) (pump|moon)\b|^\s*(and |so |what about |how about )?\$?[a-z0-9]+\s+to\s+(\$\s?\d[\d.,]*|\d[\d.,]*\s?(cents?|dollars?|k|m|b)\b|the moon|zero|one dollar|a dollar)\s*[?!.]*\s*$/i,
    secrets: /\b(seed[ -]?phrases?|recovery[ -]?phrases?|priv(?:ate)?[ -]?keys?|secret[ -]?phrases?|mnemonic)\b|\bwhat(?:'s| is) my (?:seed|wallet|recovery|secret|metamask|phantom|rabby|trust|coinbase|ledger)? ?(?:phrase|words|keys?|seed)\b|\b(?:metamask|phantom|rabby|trust wallet|coinbase|ledger|trezor|wallet'?s?) (?:seed |recovery |secret )?(?:phrase|words)\b|\b(seed|recovery|secret|backup) (words?|phrases?)\b|\b(my|your|wallet'?s?|recovery|seed|secret|backup) (12|24|twelve|twenty[- ]four)[- ](secret )?words?\b(?! (?:limit|minimum|maximum|max|min|long|post|bio))|\b(12|24|twelve|twenty[- ]four)[- ]words? (phrase|seed|recovery)\b|\bwallet password\b|\b(give|share|send|paste|enter|type|tell|show)\b[^.?!]{0,20}\b(my |your |the )?seeds?\b|\b(send|sent|share|shared|give|gave|given|show|showed|shown|tell|told|dm|dmed|dm'd|enter|entered|type|typed|paste|pasted|verify|verified|leaked)\b[^.?!]{0,25}\b(my|your|his|her|their) (seed |recovery |secret |wallet )?(phrase|words|keys?)\b(?!\s+(?:points?|features?|differences?|takeaways?|dates?|numbers?|stats?|facts?|terms?|metrics?|figures?|insights?|parts?|ideas?|info))|\bseeds?\b[^.?!]{0,20}\b(fix|support|admin|mod|unlock|recover|restore)\b/i,
    // "is this run by Robinhood?" — about the company; "Robinhood Chain" alone is the network, and a question about the chain
    affiliated: /\brobinhood\b(?! chain)[^.?!]{0,60}\b(affiliat\w*|endors\w*|sponsor\w*|partner\w*|official|own|owns|owned|run|runs|behind|connected|part of|made|built|involved)\b|\b(affiliat\w*|endors\w*|sponsor\w*|partner\w*|official|owned|run|behind|connected|part of|made|built|involved)\b[^.?!]{0,40}\brobinhood\b(?! chain)/i,
    affiliated2: /\b(are you|are you guys|r u|you are|you're|is (this|it|the site|this site|sendrh|this place)|this is|you guys)\b[^.?!]{0,25}\brobin ?hood(?:'?s)?\b(?!\s*chain)|\brobin ?hood(?:'?s)? (?:own |real |actual )?(site|website|app|project|platform|team|staff|people|employees?|company)\b|\b(from|by|with|for|work for|employees? of|part of|related to|linked to|tied to|associated with) robin ?hood\b(?!\s*chain)|\brobin ?hood\b(?!\s*chain)[^.?!]{0,40}\bnothing to do with\b|\bnothing to do with\b[^.?!]{0,30}\brobin ?hood\b(?!\s*chain)|\brobin ?hood the company\b/i,
    // "is robinhood ur owner", "owned by robinhood", "robinhood funds this": the company, asked any way
    affiliated3: /\brobin ?hood(?:'?s)?\b(?!\s*chain)[^.?!]{0,30}\b(?:your|ur|the site'?s|this site'?s|this|its)\s+(?:owner|parent|boss|creator|backer|funder|sponsor|company|team|maker)s?\b|\b(?:your|ur|the site'?s|its) (?:owner|parent|boss|creator|backer|funder|sponsor|company|maker)s?\b[^.?!]{0,30}\brobin ?hood\b(?!\s*chain)|\b(?:owned|backed|funded|run|supported|made|built|created|sponsored) by robin ?hood\b(?!\s*chain)|\brobin ?hood (?:own|owns|run|runs|fund|funds|back|backs|made|built|sponsor|sponsors) (?:this|it|you|sendrh|the site)\b|\b(?:is|are) (?:you|this|it|the site) (?:from|with|part of|a part of|owned by) robin ?hood\b(?!\s*chain)/i,
    // "did robinhood create this", "is robinhood paying you", "is this rh official", "is gwc a robinhood coin"
    affiliated4: /\b(?:did|does|do|is|are|has|have) robin ?hood\b(?!\s*chain)[^.?!]{0,25}\b(?:create|created|make|made|support|supports|pay|paying|paid|know|knows|launch|launched|approve|approved|back|backs|fund|funds|invest|invested|endorse|run|own|sponsor)\w*\b|\b(?:is|are) (?:this|it|you|u|sendrh|the site) (?:an? )?(?:rh|robin ?hood)(?:'?s)? (?:official|site|app|product|project)?\b|\b(?:are|r) (?:you|u) (?:guys )?rh\b|\brh (?:owns?|runs?|made|official)\b|\b(?:is|are) (?:\$?[a-z0-9]+ )?(?:an? )?robin ?hood(?:'?s)? (?:token|coin|product|crypto)\b|\b\$?[a-z0-9]+ (?:is )?robin ?hood(?:'?s)? (?:token|coin)\b|\bdid robin ?hood (?:launch|make|create|issue) \$?[a-z0-9]+\b|^\s*robin ?hood official\s*\??\s*$/i,
    // "is robinhood chain made by robinhood": the network's makers
    affiliated5: /(?:\brobin ?hood\b|\brh\b)(?!\s*(?:chain|wallet))[^.?!]{0,30}\b(?:affiliat\w*|endors\w*|partner\w*|sponsor\w*|involved|behind|team|parent|official|approved?|support(?:s|ed)?|help|related|relation|connection|connected|anything to do|owners?|owns?|thing)\b|\b(?:affiliat\w*|endors\w*|partner\w*|sponsor\w*|involved|run by|made by|approved by|related to|relation to|connection (?:to|with)|connected (?:to|with)|anything to do with|parent company|backed by|owned by)\b[^.?!]{0,30}(?:\brobin ?hood\b|\brh\b)(?!\s*(?:chain|wallet))/i,
    chainWho: /\brobin ?hood chain\b[^.?!]{0,30}\b(?:made|built|owned|run|created|operated|launched|official|product|backed)\b[^.?!]{0,25}\brobin ?hood\b|\bwho (?:made|built|runs|owns|created|operates|launched) robin ?hood chain\b/i,
    whoRuns: /\bwho\b[^.?!]{0,25}\b(made|built|runs?|owns?|created|started|behind|operates|founded|maintains)\b[^.?!]{0,25}\b(site|website|platform|project|sendrh|just ?send ?it)\b|\bwho(?:'s| is)? (?:behind|running|in charge of) (?:this|it|the site|sendrh(?:\.com)?|just send it|this site|this place|the project)\b|\bwho (?:are|is) the (?:devs?|developers?|team|owners?|founders?|admins?|creators?|people behind)\b|\bwho (?:made|built|created|owns|runs|run|operates|started) (?:this|it)\b|\bis (?:it|this|there) a real team\b|\bwho (?:is|'s|are) responsible for\b[^.?!]{0,25}\b(?:site|website|this|it|platform)\b|\bwho (?:is|are) in charge\b/i,
    safety: /\b(safe|safety|scam(?!mer|med|ming)\w*|rug\w*|legit(?!\w*(?: \$?\w+)? (?:contract|address|site|link|page|app|wallet|support|url|ca))\w*|honey ?p\w*|trust(?! ?wallet)\w*|risky|dangerous|audit\w*|sketch\w*|shady|fraud\w*|ponzi\w*|sus|dodgy)\b|\b(real|fake) or (fake|real)\b|\bis (it|this|that|\$?[a-z0-9]+) (real|fake)\b/i,
    hello: /^\s*(h+i+|he+y+|hello+|helo|yo+|gm+|gn|sup|wassup|whats? up|what is up|what is good|hiya|heya|howdy|hola|ello|good (morning|afternoon|evening|day)|how (is|are) (it going|you|u|ya|things)(\s+(doing|today|going|tonight))*|how you doing|how is life)\b[\s!.?,]*((there|sendy|ser|fam|bro|guys|mate|everyone|all|friend|fren)\b[\s!.?,]*)*$/i,
    thanks: /^\s*(thanks?|thank (you|u)|thx|ty|cheers|awesome|cool|great|nice|perfect|got it|ok(ay)?|alright|appreciate (it|you|that|ya)|you are (the best|awesome|great|a legend|amazing|a star)|your (the best|awesome|great|a legend|amazing)|legend|gg|nice one|sweet|helpful|that help(s|ed)|good bot|good job|well done)\b(\s+(so much|very much|a lot|a ton|heaps|loads|mate|man|ser|fam|bro|sendy|again|you|u))*[\s!.?,]*((sendy|ser|fam|bro|mate|man|that (helps|helped)( a (lot|ton|bunch))?|you are the best|your the best|you're the best)\b[\s!.?,]*)*$/i,
    whoami: /\bwho are you\b|\bwhat are you\b|\b(what|who) is (you|u)\b|\bare you (a |an )?(bot|robot|human|ai|real|person|chat ?gpt|gpt|claude|machine|program)\b|\bis this (a |an )?(bot|ai|robot|real person|human|chat ?gpt|gpt|claude)\b|\b(am i|are we) (talking|speaking|chatting) (to|with) (a |an )?(bot|human|person|real person|ai|robot)\b|\bwho is this\b|\bwhat is your name\b|\bwho am i talking to\b|\b(human|person) or (a |an )?(bot|ai|robot)\b|\b(bot|ai|robot) or (a )?(human|person)\b/i,
    // "how does … work" asks for an explanation, not a reading — unless it also asks who, how many or what right now
    explain: /^\s*(how (does|do|can|is|are|to)|what (is|are|does|do)\b(?! (trending|hot|moving|new))|what's an? |explain|why|when (does|do|is))\b/i,
    nowWords: /\b(who|winning|standings?|leaders?|top|this week|today|right now|now|current(ly)?|latest|winners?|ends?|end|how many|how much)\b/i,
    leaderboard: /\bleader ?boards?\b|\btop (\d+ )?(senders|members|players|users|people|accounts)\b|\b(most|highest) send power\b|\bwho(?:'s| is) (#1|number one|number 1|first|on top|top|the top|leading|in the lead|ahead|the best)\b|\brankings?\b|\bstandings\b|\bhigh ?scores?\b|\bhall of fame\b|\bwho (has|got|have) the (most|highest) (points|send power|xp|score|level)\b|\b(most|highest) (points|xp|score|level)\b|\bbest (players?|senders?|members?)\b|\btop sender\b|\btop dog\b|\b(number (1|one)|#1) (sender|member|player)\b|\bmvp\b|\b(?:on|of|top of|atop) the board\b/i,
    // the week's race, not the all-time board
    weekly: /\b(this week'?s?|weekly|today'?s?|race|competitions?|contests?|comps?|tournaments?|biggest sender)\b/i,
    competitions: /\bcompetitions?\b|\bbiggest sender\b|\bweekly (race|competition|board|prize|contest|comp)|\bthis week'?s (race|winner|leader|prize|competition|contest|comp)|\bprizes?\b|\brocket run\b|\barcade\b|\brocket riders\b|\bwho(?:'s| is) (winning|leading|ahead)\b|\bcontests?\b|\bcomps?\b|\btournaments?\b|\bthe race\b|\bwhat (do|does|can|will) (you|i|u|one|the winner|winners) (win|get)\b|\b(come|finish|place) first\b|\bwhat (do|does) (the )?winners? (win|get)\b/i,
    counts: /\bhow many (members|users|people|accounts|senders|calls|send calls|posts|questions|support questions|communities|squads?|send squads?|sign ?ups|folks|humans)\b(?! (are )?(hold|holding|own|owning|bought|in the race|have \$))(?!.*\b(holders?|holding)\b)|\b(member|user) count\b|\bnumber of (members|users|people|calls|posts|communities|squads|accounts)\b|\bhow (big|popular|active) is (this|the) (site|place|community|platform|app)\b|\btotal (members|users|accounts|posts|calls)\b|\buser ?base\b/i,
    squads: /\bsquads?\b/i,
    communitiesList: /\b(which|list|all|live|biggest|largest|top|any)\b.*\bcommunit(y|ies)\b|\bwhat communities\b|\bcommunit(y|ies)\b.*\b(are (there|live)|exist|list|live|biggest|largest|members)\b|^\s*communit(y|ies)\s*\??\s*$|\b(which|what|list|all|live|any)\b.*\b(groups?|clubs?)\b|\b(groups?|clubs?)\b.*\b(can i join|on here|are there|exist|live)\b/i,
    pulse: /\bgas( price| fees?)?\b|\bhow (expensive|much|costly) (is it )?to (send|make|do) a (transaction|tx|transfer|swap)\b|\b(transaction|tx) (fees?|costs?)\b(?! on (base|ethereum|solana|arbitrum|polygon|optimism|avalanche|bnb))|\bblock ?time\b|\b(latest|current|last) block\b|\bblock (number|height)\b|\bbridge (holds|balance)\b|\bpulse\b|\bpools? (were )?created\b|\bchain (status|health|stats)\b|\bis (?:the |robinhood |rh )?chain (up|down|working|live|ok|alive|running)\b|\bwhat block\b|\bblock (are we|is it) on\b|\bhow fast (is|are) (the )?(chain|blocks)\b|\btps\b|\bbase fee\b/i,
    newPools: /\bnew(est)? (pools?|pairs?|tokens?|coins?|launch(es)?|listings?)\b|\bjust launched\b|\blatest (pools?|pairs?|launches|coins|tokens)\b|\bradar\b|\b(launched|listed) (lately|recently|today|this week)\b|\bfresh (pairs?|launches|tokens?|coins?)\b|\banything new\b|\brecent (launches|pairs|listings)\b|\bnewly (launched|listed)\b/i,
    scans: /\b(recent(ly)?|latest|popular|most) scan(s|ned)?\b|\b(people|everyone|everybody|folks|others) (has |have )?been (scanning|looking up|checking out|checking|searching)\b|\b(tokens?|coins?) (has |have )?(everyone|everybody|people) been (checking|scanning|looking)\b|\bwhat (are|is) (people|everyone|folks) scanning\b|\bscanned (recently|lately|today)\b|\b(what|which) (are|is|tokens?|coins?) (people|everyone|folks|others) (scanning|checking|looking (at|up)|searching)\b|\bmost (scanned|searched|looked up)\b|\b(people|everyone|folks) (are |is )?(scanning|looking up|checking out|searching)\b/i,
    topChains: /\b(top|biggest|largest|leading|best|rank(ing)?|compare|most)\b.*\b(block)?chains\b|\b(top|biggest|largest|leading|best|rank(ing)?|compare|most)\b.*\bnetworks\b|\bwhich (block)?chains?\b|\bwhich networks?\b|\brank(ing)? of (the )?(block)?chains\b|\bchains? (by|with the (most|highest|biggest)|with|that have|got) the most\b|\bchains? (by|with the (most|highest|biggest))\b/i,
    topTokens: /\b(top|biggest|largest|best|worst|hottest|hot|trending|most[- ]traded|highest|lowest|smallest|deepest|gainers?|losers?|movers?|pumping|dumping)\b.*\b(tokens?|coins?|memecoins?|pairs?|pools?|stuff)\b|(?:^|\s)(?:#1|number (?:1|one)) (?:tokens?|coins?)\b|\bwhat(?:'s| is| are) (trending|hot|moving)\b|\btrending\b|\b(top|biggest) (gainers|losers|movers)\b|\b(best|worst|top|bottom) (performing|performers)\b|\bbiggest (movers|gainers|losers|dumps|drops|pumps)\b|\bmost (active|traded)\b|\bwhat(?:'s| is| are)? (pumping|popping|mooning|dumping|tanking|crashing)\b|\bwhat (coins|tokens) (are )?(pumping|dumping|moving|hot|tanking|crashing)\b|\b(which|what) (coins?|tokens?) (have |has )?(gone|went|go|going|moved) (up|down)\b|\b(gone|went) (up|down) the most\b/i,
    chainMetric: /\btvl\b|\bvalue locked\b|\blocked\b|\btraded\b|\btvs\b|\bvalue secured\b|\bstablecoins?\b|\bstables\b|\bfees?\b|\bdex volume\b|\bvolume\b|\bliquidity\b|\btransactions?\b|\bactive addresses\b|\bstage\b|\bopen interest\b|\bstats?\b|\bfigures?\b|\bdata\b|\bmarket ?cap\b|\bmcap\b/i,
    tokenInfo: /\b(what is|what's|tell me (more )?about|info(rmation)? (on|about)|look ?up|stats|data|figures|how is .{1,40} (doing|looking|performing)|details|what do you know about|anything (on|about)|update on|what is going on with|the deal with|everything (you )?(got|have|know) (on|about))\b/i,
    better: /\b(which|what)( one| coin| token)? (is|would be|'s) (the |a )?(better|best|safest|safer|smartest|smarter|top pick)\b|\b(better|safer) (buy|investment|bet|pick|hold)\b/i,
  };
  // a figure named outright leads over "how much is …" (the price is the figure only when nothing else is named)
  /* ===== THE GUARD RAILS: words, not shapes ==========================================================================
     Two review rounds showed what a list of advice shapes does: every round found wordings it missed ("rate it", "pt?",
     "moon gwc?", "fair price for send?") and plain questions it refused ("would you sell my data?", "what's the buy tax?").
     So the guard reads WORDS. RISK is the vocabulary of a decision, an opinion, a judgement of value and a price to come.
     First the words that are not that are taken out: a disclaimer ("nfa"), the site's own names for its parts ("the buy
     tax", "a sell button", "if I sell", "the 2x boost", "Rocket Run's cash-out"), a definition ("what does ape in mean"), a
     how-to ("how do I buy", "can I buy it with a card"), a support problem ("why can't I sell"). What is left decides:
       · advice (adviceAsked) — a RISK word about a token (named, "it" pointing back at one, "coins", or a short reply to a
         token's answer), or a decision asked bare ("should I buy?"), or a target — gets the refusal, never a figure;
       · a market figure (figuresOk) is given only where no RISK word is left — whatever the question's shape, so no wording
         can put a price beside "should I", "worth it", "tomorrow" or "moon". */
  const DISCLAIM = /\b(?:nfa|dyor|not (?:financial|investment) advice|no (?:financial|investment) advice|(?:i know )?(?:you )?(?:can'?t|cannot|won'?t|don'?t|do not) (?:give|offer) (?:any )?(?:financial |investment )?advice)\b[,.;:!]*/gi;
  const SITE_PHRASES = [
    /\bworth it to (?:verify|link|connect|sign|join|post|make|use|try|check|scan|read|wait|bother|set|add|claim)\b/gi,
    /\bis (?:it|this|that) (?:a|counted as a) (?:buy|sell)\b(?=[^.?!]*\b(?:if|when|tracker|counted|count|show|log|record)\b)/gi,
    /\b(?:hold|own|have)(?:ing)? (?:\$?[a-z0-9]+ |any |some |enough |both )?(?:to|for) (?:join|post|get|qualify|unlock|earn|enter|make|become|use|the|og|holder|community|diamond|badge)\b/gi,
    /\b(?:i(?:'ve| have)? been|i am|i'm|im|i(?:'ve| have)?|we(?:'ve| have)? been) (?:holding|hodling|bought|buying|sold|selling)\b(?! (?:and|but) (?:should|would))/gi,
    /\b(?:too late|late) (?:to (?:join|enter|sign up|claim|change|get the|register|apply|post|play)|for (?:the |my )?(?:og|badge|race|beta|community|competition|check-?in))\b/gi,
    /\b(?:buy|sell|hold|swap|trade|exit|entry)(?:ing)?\s+(?:tax(?:es)?|fees?|button|page|tab|filter|wall|order|side|transactions?|time|count|history|pressure|limit|streak|rules?|card|tour)\b/gi,
    /\b(?:tax(?:es)?|fees?)\b[^.?!]{0,20}\b(?:buys?|sells?|buying|selling)\b/gi,
    /\b(?:buys?|selling|sells?|buying)\s+(?:and|or|then)\s+(?:sells?|buys?|selling|buying)\b/gi,
    /\b(?:if|when|before|after|once|while)\s+(?:i|you|we|someone|they|people)\s+(?:\w+\s+)?(?:buy|sell|hold|swap|dump|transfer|move|cash out)\b/gi,
    /\b\d+ ?x\s+(?:boost|cash ?-?outs?|multiplier|bonus|diamond hands|send power|points)\b|\b(?:boost|multiplier|bonus|cash ?-?out)\b[^.?!]{0,15}\b\d+ ?x\b|\b\d+ ?x\b[^.?!]{0,25}\b(?:rocket run|the rocket|arcade|race|boost)\b/gi,
    /\b(?:hold(?:ing)?|own(?:ing)?)\s+(?:both|either|gwc or send|send or gwc)\b[^.?!]{0,30}\b(?:for|to)\b/gi,
    /\bhow many (?:people|ppl|peeps|folks|wallets|addresses|holders) (?:are |r )?(?:hold(?:ing)?|own(?:ing)?)\b|\bwho (?:is|are) holding\b|\b(?:top|biggest) holders\b|\bholding the most\b/gi,
    /\bentry price\b[^.?!]{0,25}\bcalls?\b|\bcalls?'?s? entry\b/gi,
    /\bexit (?:the |a |my )?(?:squad|community|tour|race|page|app|fee)\b/gi,
    /\bcash(?:ing)? ?-?out\b(?![^.?!]*(?:\$[a-z]|\b(?:gwc|send)\b))/gi,
    /\b(?:hold on|hold up|on hold|please hold|hold tight)\b/gi,
    /\bloads? up on (?:my|chrome|safari|firefox|desktop|mobile|phone|the)\b/gi,
    /\bsell (?:my|your|our|their) (?:data|info|information|details|emails?)\b/gi,
    /\b(?:would|will|do|does) (?:you|u|the site|sendy) (?:hold|keep|store) (?:my|your) (?:funds|money|keys|coins)\b/gi,
    /\bmy (?:buys?|sells?|holds?)\b/gi,
  ];
  const stripSite = (s) => SITE_PHRASES.reduce((x, re) => x.replace(re, ' '), lc(s).replace(DISCLAIM, ' '));
  const DEFINES = /\bwhat (?:does|do|did) [^?!.]{1,40}\b(?:mean|stand for)\b|\bmeaning of\b|\bexplain\b|\bdefin\w*|\bwhy (?:does|do) (?:every|people|everyone)\b[^?!.]{0,30}\b(?:say|write|post)\b|^\s*what(?:'s| is| are) (?:an?|the term) [^?!.]{1,30}[?!.]*\s*$/i;
  const HOWTO = /^\s*(?:how (?:do|does|did|can|could|would|should|to|long|much|many)\b(?! (?:will|would)\b)(?!(?: \w+)? (?:be worth|go up|go down))|how i\b|where\b|can (?:i|you|we|one)\b|could (?:i|you)\b|is (?:it|there) (?:possible|a way)\b|what(?:'s| is) the (?:best |easiest |right |safest )?way\b|steps?\b|guide\b|tutorial\b|walk me through)|\bhow (?:do|can|to) (?:i |you |we |one )?(?:buy|sell|swap|get|bridge|add|import|connect|move|send|trade)\b|\bhow (?:i (?:can |could |should )?)?(?:buy|sell|swap|get|bridge|add|connect)\b|\bwhy (?:can'?t|cannot|won'?t|doesn'?t|isn'?t|did|does|is) (?:i|my|it)\b|\b(?:can'?t|cannot|unable to|fail(?:s|ed)? to|won'?t let me) (?:buy|sell|swap|trade)\b/i;
  const DECIDE = /\b(?:if|whether) (?:i|we) (?:should|ought to)\b[^.?!]{0,25}\b(?:buy|sell|hold|ape|invest|dump|hodl|get in|get out|put)\b|\bwhether (?:or not )?to (?:buy|sell|hold|ape|invest|dump)\b|\bhow (?:much|many) [^.?!]{0,25}\bshould (?:i|we) (?:buy|invest|ape|put)\b(?![^.?!]*\b(?:to|for) (?:post|get|join|qualify|unlock|earn|enter|make|become|use|the|og|holder|community|diamond)\b)/i;
  const ALWAYS_PICK = /\b(?:wh?en|wen) (?:moon|lambo|pump|10x|100x|listing|binance)\b|\bmoon soon\b|\b(?:next|another) (?:\d+ ?x|gem|moonshot|100x|1000x)\b|\bnext gem\b|\btop pick\b|\b(?:what|which) (?:coin|token|crypto)s? (?:to|should i|do i|can i|i (?:should |can |must )?)(?:buy|get|ape|pick)\b|\bbest (?:coin|token|crypto|memecoin)s? (?:to (?:buy|invest)|right now)\b|\bwhat should i (?:buy|invest in)\b|\bshould i (?:buy|sell|hold|ape|invest|dump|hodl)\s*[?!.]*$/i;
  /* The refusal: a decision, a prediction, a target or a verdict asked in an unmistakable shape, about a token (tokenCtx).
     Anything vaguer about a token — slang, an opinion, a hunch — gets the neutral answer (where to read it, and that nothing here
     says whether to buy, sell or hold), which is right whatever was meant; and a market figure is given only where the whole
     message plainly asks for one (figureOnly), so no wording at all can put a price beside such a question. */
  const PRECISE = [
    /\b(?:should|shall|shud|shld|ought to)\s+(?:i|we)\s+(?:(?:just|still|really|even|actually|now|already|maybe|definitely|be|keep|go|or should i(?: not)?)\s+)*(?:buy|sell|hold|ape(?: in| into)?|invest(?: in)?|dump|hodl|get in|get out|exit|cash out|take profits?|double down|load up|fomo|accumulate|buying|selling|holding)\b(?!\s+(?:tax|fee|button|page|tab|order|side|limit|my (?:data|info|email)))(?![^.?!]*\b(?:to|for) (?:post|join|qualify|unlock|enter|get the|the og|og|holder boost|diamond hands|the community|a send call)\b)/i,
    /\bdo (?:i|we) (?:just |still |now )?(?:buy|sell|hold|dump|ape|hodl)(?: (?:it|this|that|them|more|\$?[a-z0-9]{2,12}))?(?: (?:now|rn|today|yet|here))?\s*[?!.]*$/i,
    /\bwould (?:you|u)\s+(?:(?:still|really|personally)\s+)?(?:buy|sell|hold|invest|ape|recommend|pick|choose)\b(?!\s+(?:my|our) (?:data|info|email|details))/i,
    /\b(?:will|gonna|going to|could|can|might|about to)\s+(?:\S+\s+){0,3}?(?:moon|pump|dump|10x|100x|1000x|\d+ ?x|go (?:up|down|higher|lower)|rise|crash|recover|double|triple|explode|skyrocket|rally|tank|zero|go to zero|die|make it|flip|run)\b/i,
    /\b(?:is|are) (?:it|this|that|\$?[a-z0-9]+) (?:still |even |really )?an? (?:buy|sell|hold)\b(?! (?:button|order|tax|fee|page|tab))/i,
    // ("why is gwc going down?" asks a reason, "is it going up or down today?" a fact)
    /(?<!\bwhy )\b(?:is|are) (?:it|the price|prices|\$?[a-z0-9]+(?:'s price)?) (?:going|headed|heading) (?:to )?(?:go )?(?:up|down|higher|lower)\b(?! or (?:up|down|higher|lower)\b)/i,
    /\b(?:would|will|is) it be (?:sensible|wise|smart|prudent|a good idea|a bad idea|ok|okay|reasonable|risky|dumb|stupid|foolish|crazy) (?:for (?:me|us) )?to (?:put|invest|buy|sell|hold|ape|move|spend|bet)\b|\bis it (?:sensible|wise|smart|prudent|a good idea|a bad idea|reasonable|dumb|stupid|foolish|crazy) (?:for (?:me|us) )?to (?:put|invest|buy|sell|hold|ape|bet)\b/i,
    /\bguaranteed?\b[^.?!]{0,25}\b(?:\d+ ?x|profits?|gains|returns?|moon|pump|to (?:go up|rise|double))\b|\b\d{2,} ?x\b(?! (?:boost|multiplier|send power|points|cash-?out))/i,
    /\b(?:put|invest|throw|sink|bet|gamble)\b[^.?!]{0,25}\b(?:savings|rent|paycheck|retirement|pension|student loans?|life savings|everything|it all|my house)\b/i,
    /\b(?:make|making|get|getting)\s+(?:big |huge |quick |fast |a lot of |lots of |some |easy )?(?:profits?|rich|gains)\b/i,
    /\bprice (?:prediction|target|forecast|projection)s?\b|\btarget price\b|\bpredict(?:ion)? (?:for|of|on) |\bforecast (?:for|of|on) /i,
    /\b(?:is|are) (?:it|this|that|\$?[a-z0-9]+) (?:a )?(?:good|great|smart|bad|safe|solid) (?:buy|investment|bet|entry|hold|pick|play)\b|\bworth (?:buying|investing|it|holding|getting|the risk)\b|\b(?:good|right|best|bad) time to (?:buy|sell|get in|enter|invest|ape|exit)\b|\b(?:undervalued|overvalued|overpriced|underpriced)\b/i,
    /\b(?:buy|sell|hold|dump|ape)\b[^.?!]{0,25}\bor (?:nah|not|no|sell|hold|buy|dump|wait)\b|\bhold or (?:dump|sell|fold)\b|\bkeep or (?:toss|sell|dump)\b|\bin or out\b|\bnow or wait\b|\byay or nay\b|\b[wl] or [wl]\b/i,
    /^(?![\s\S]*\b(?:swapped|swap|bought|sold|converted|traded|sent|transferred|bridged|paid|went|dropped|fell|got|received|lost|spent|cost|costs)\b)[\s\S]*(?<!\b(?:went|dropped|fell|reset|back|close|up|add|adds|cost|costs|paid|lost|down|was|were|dropping|falling)\s)\b(?:to|hit|hitting|reach|reaching|reaches)\s+(?:\$\s?\d[\d.,]*|\d[\d.,]*\s?(?:cents?|dollars?|bucks|k|m|b|mil(?:lion)?|bil(?:lion)?)\b|(?:a|one) (?:dollar|penny|cent|nickel|dime|buck)\b|zero\b|the moon\b)/i,
  ];
  const PRECISE_TARGET = PRECISE[PRECISE.length - 1];   // (the last: a price to reach)
  const BARE_DECISION = /^\s*(?:and\s+|so\s+|but\s+)?(?:will|could|would|can) (?:it|they)\s*[?!.]*$|^\s*(?:yes or no|y\/n)\s*[?!.]*$|^\s*(?:and |so |but |ok |okay )?(?:should|would|shall|do|must|shud|shld) (?:i|we|you|u)(?: (?:just|still|really|even|now|already|maybe|actually|be|keep))*(?: (?:buy|sell|hold|ape|invest|dump|hodl|get in|get out)(?: (?:now|rn|it|this|that|them|more|some))?)?\s*[?!.]*$|\bwhat (?:coins?|tokens?|crypto) (?:should|do|can) i (?:buy|invest in|ape|get)\b|\bwhat (?:to|should i) buy\b|^\s*(?:just )?send it\s*\?/i;
  const RISK = new RegExp([
    // a trade, as a decision
    '\\b(?:buy|buying|sell|selling|hold|holding|hodl\\w*|ape|aping|aped|invest|investing|investment|accumulate|double down|load(?:ing)? up|loading (?:my |up )?bags?|fomo\\w*|long it|short it|go long|go short|long or short|p ?& ?d|p ?n ?d|comprar|vender|kaufen|verkaufen|kopen|verkopen|acheter|vendre|comprare|vendere)\\b',
    // an opinion, a recommendation, a pick
    '\\b(?:opinion|thoughts?|recommend\\w*|rate it|rating|advice|advise|would (?:you|u) (?:buy|sell|hold|pick|do|invest|ape|get|choose)|do (?:you|u) think|you think|the play|your pick|top pick|would (?:you|u) pick|good or bad|better than|which (?:one )?is (?:the )?(?:better|best)|which (?:one )?(?:would|will) (?:you|u) (?:pick|choose)|best (?:coin|token|one|pick|play|buy|investment|crypto|memecoin)s?|is it time|should)\\b',
    // a judgement of value
    '\\b(?:worth (?:it|buying|getting|holding|investing|to buy|the risk|a (?:buy|shot|punt))|good price|fair price|good (?:entry|buy|bet|investment|pick|play|move|idea|time)|bad (?:entry|buy|bet|investment|pick|move|idea|time)|right time|too late|am i (?:too )?(?:early|late)|still early|early enough|bull(?:ish)?|bear(?:ish)?|upside|downside|profitable|undervalued|overvalued|overpriced|underpriced|cheap|expensive|bargain|gem|lambo)\\b',
    '\\bis (?:it|that|this) (?:like |really |kinda |actually |even )?(?:low|high|cheap|expensive|a lot|good|bad|too (?:much|high|low))\\b|\\bis \\$?[a-z0-9]+ worth\\s*[?!.]*$|\\b(?:put|invest|throw|sink)\\b[^.?!]{0,25}\\b(?:savings|rent|money|cash|paycheck|retirement|pension|everything|it all)\\b|\\bhow (?:much|high|low|far) will\\b',
    // a price to come
    '\\b(?:predict\\w*|forecast\\w*|targets?|pt|tp|stop ?loss|take profits?|entry|exit|tomorrow|future|later|eventually|someday|soon|wen|expect\\w*|likely|chances?|odds|possible|potential|imagine|hypothetic\\w*|what if|if (?:you|u) were|about to|halving|eoy|long[- ]term|(?:going to|gonna) do)\\b',
    '\\bnext (?:week|month|year|cycle|bull ?run|run|halving)\\b|\\b(?:will|be|going|gonna|could|might|would)\\b[^.?!]{0,30}\\bin (?:a|one|two|three|\\d+) (?:days?|weeks?|months?)\\b|\\bin (?:a|one|two|three|\\d+) (?:days?|weeks?|months?) from now\\b|\\bin (?:a|one|two|three|\\d+) years?\\b(?! ago)|\\bby (?:the )?end of\\b|\\bend of (?:the )?year\\b|\\bby (?:christmas|summer|winter|spring|fall|autumn|year ?end|next year)\\b|\\b20(?:2[7-9]|[3-9]\\d)\\b',
    // a move to come (what is moving now — "what's pumping today", "up or down today" — is a reading, not this)
    '\\b(?:will|gonna|going to|about to|could|can|might|wen|when|ever|to)\\b[^.?!]{0,25}\\b(?:moon|pump|dump|rally|crash|recover|bounce|rise|fall|drop|tank|go (?:up|down|higher|lower)|goes (?:up|down)|explode|skyrocket|flip|zero|die|be worth|be at|be (?:higher|lower)|\\d{2,} ?x)\\b',
    '^\\s*(?:moon|pump|dump)\\b[^.?!]{0,20}[?!.]*\\s*$|\\b(?:moon|pump|dump|lambo)(?:\\s+soon)?\\s*[?!.]*\\s*$|\\bmoon soon\\b|\\bto the moon\\b|\\b\\d{2,} ?x\\b|\\b(?:higher|lower) from here\\b|\\bgoing (?:higher|lower|up|down)\\b|\\bheaded (?:up|down|higher|lower)\\b',
    '\\bup or down\\b(?![^.?!]*\\b(?:today|so far|right now|rn|24 ?h|in the last|since)\\b)',
  ].join('|'), 'i');
  // where a question is about a token: one named, "coins" and their kin, or a pointer at (or a short reply to) a token's answer
  const COIN_WORDS = /\b(?:coins?|tokens?|memecoins?|crypto|altcoins?|shitcoins?|bags?|positions?|portfolio|it all|everything|the price|prices?)\b/i;
  const SITE_SUBJECT = /\b(?:called|calling|callers?|gas|fees?|tax(?:es)?|transactions?|txs?|bridge|swap|site|website|page|data|info|account|profile|username|picture|pfp|email|password|apps?|browsers?|extensions?|wallets?|call card|send calls?|calls?|squads?|communit(?:y|ies)|badges?|og|race|competitions?|boost|arcade|rocket run|check-?ins?|tracker|scanner|radar|market data|guide|tour|referrals?|invites?|support|admins?|mods?|points|send power|levels?|diamond hands)\b/i;
  function tokenCtx(t, history) {
    if (tokenMentions(t, true).some((x) => x.strong || x.known)) return true;
    if (COIN_WORDS.test(t) && !SITE_SUBJECT.test(t.replace(COIN_WORDS, ' '))) return true;
    // "it" after a question that named a token ("is $send safe?" → "its gonna go up tho right")
    if (PRONOUN.test(t) && tokenMentions(lastOf(history, 'user'), true).some((x) => x.strong || x.known)) return true;
    const tp = topicOf(lastOf(history, 'assistant'));
    if (!tp || !['token', 'tokens', 'community', 'communities'].includes(tp.kind)) return false;
    return (PRONOUN.test(t) || ORDINAL.test(t) || (terms(t).length <= 3 && !SITE_SUBJECT.test(t))) && !SITE_SUBJECT.test(t.replace(PRONOUN, ' '));
  }
  const DECISION_TAIL = /^\s*(?:and |so |but |ok |okay |then )?(?:(?:should|shall|shud|shld|must) (?:i|we)(?: (?:just|still|really|even|now|already|maybe|actually))*(?: (?:buy|sell|hold|ape|invest|dump|hodl|get in|get out)(?: (?:now|rn|it|this|that|them|more|some))?)?|(?:buy|sell|ape|hodl|dump|ape in)(?: (?:it|this|that|them|now|rn|more|some))?)\s*[?!.]*$/i;
  const CHOICE = new Set('or which one better best pick choose good i we should buy get ape into is are it the a now rn today tho though bro ser fam sendy'.split(' '));
  function adviceAsked(texts, history, whole) {
    for (const t0 of texts) {
      if (!t0) continue;
      const named = tokenMentions(t0, true).some((x) => x.strong || x.known);
      if (DEFINES.test(t0) && !named) continue;
      if (DECIDE.test(lc(t0))) return true;
      const t = stripSite(t0);
      if (HOWTO.test(t) || SUPPORT.test(t)) continue;
      if (ALWAYS_PICK.test(t)) return true;
      // "zqrh or zqmoon?": a choice between tokens, with nothing asked of them but which
      // (read in the whole message: "send or gwc, which has more holders?" asks a figure of both)
      const base = whole || t0;
      if (named && /\bor\b/i.test(base)) { const real = tokenMentions(base, true).filter((x) => x.strong || x.known); let r = lc(base); for (const x of real) r = r.replace(wordRe(x.w), (m, pre) => pre + ' '); if (real.length >= 2 && words(r).every((w) => CHOICE.has(w))) return true; }
      // a decision said alone after a token's question — "…? buy?", "…, should i?", "dump it?" after its price — is about that token
      if (DECISION_TAIL.test(t0.replace(DISCLAIM, ' ')) && (tokenCtx(t, history) || (whole && tokenCtx(stripSite(whole), history)))) return true;
      // (a bare "yes or no?", "will it?" is the whole message, never the tail of one: "does gwc have a tax, yes or no?" asks a fact)
      if ((!whole || lc(whole).replace(/[?!.\s]+$/, '') === lc(t0).replace(/[?!.\s]+$/, '')) && BARE_DECISION.test(t0.replace(DISCLAIM, ' ')) && (tokenCtx(t, history) || !SITE_SUBJECT.test(t))) return true;
      // (the token as typed counts too — "will SEND hit 1 cent?" — and the site's own coins beside a price to come: "send to $1??")
      if ((PRECISE.some((re) => re.test(t)) || RX.target.test(t)) && (tokenCtx(t, history) || tokenCtx(t0, history) || ((RX.target.test(t) || PRECISE_TARGET.test(t)) && /\$?\b(?:send|gwc)\b/i.test(t0)) || (whole && whole !== t0 && terms(t).length <= 3 && !SITE_SUBJECT.test(t) && tokenCtx(stripSite(whole), history)))) return true;
    }
    return false;
  }
  // a problem with a trade, not a question of whether to make one ("the sell keeps failing", "error when buying", "tried to buy")
  const SUPPORT = /\b(?:fail\w*|error\w*|stuck|pending|reverted|not (?:working|showing|going through|appearing)|doesn'?t (?:work|show)|didn'?t (?:work|go through|show)|won'?t (?:work|go through|let)|no route|tried to|trying to|keeps? (?:failing|saying)|says? (?:i'?m|it|no)|went wrong|wrong address|lost|stole\w*|stolen|drained|hacked|scammed|phish\w*|clicked|report|contact support|what (?:should|do|can) i do|what now|help me|recover)\b/i;
  /* A market figure is given only where the whole message plainly asks for one: every word of it — once the tokens, the chains,
     the numbers, the padding and the asking words are set aside — is a word of figures (FIG_WORDS); "worth", "hold", "up"/"down"
     and "trading" only in the shapes that read a figure ("how much is X worth", "how many hold", "up or down today", "trading
     at"). A word outside it — "take", "double", "steal", "fair", a hunch in any language — and the figure is not given. */
  const FIG_WORDS = new Set(('price prices priced cost costs mcap market cap caps marketcap fdv fully diluted valuation liquidity liq lp pool pools depth deep deepest '
    + 'volume vol traded trade change changed move moved moving movers gainers losers loser percent pct holders holder holding hold wallets addresses many much '
    + 'people accounts users unique supply circulating chart charts stats stat data figures figure numbers number info information details reading readings overview summary '
    + 'tvl value locked money tvs secured stablecoins stables fees fee gas gwei block blocks height speed fast transactions transaction txs tx active open interest stage '
    + 'bridge pulse status alive working top biggest largest highest lowest smallest most least worst hot hottest trending popular new newest latest recent recently lately '
    + 'fresh launched launches launch listed listings pairs pair tokens token coins coin memecoins ranking rank ranked list bigger smaller larger higher lower more less '
    + 'compare comparison vs versus performers performing performance doing cent cents dollar dollars usd today tonight worth '
    + 'currently current rn atm 24h 24 hour hours day days daily week weekly 7d 30d month far past last since yesterday ago total overall combined anywhere everywhere '
    + 'across together check show give tell gimme lookup count exactly roughly approx approximately quick real right whats wats hows each every all '
    + 'both up down sort sorted order ordered dex dexes defi hardest fastest wins winner capitalisation capitalization amount amounts present presently held gone went').split(' ').map(stem));
  const FIG_STOP = new Set(('a i about all also am an and any are as be been being but by can could did do does doing for from get got had has have having he her hers him his here how in is it '
    + 'its just me more most my of on only or other our please same she so some than that the their theirs them there these they this those to up was we were what '
    + 'when where which who whom will with would you your yours tell show give know hey hi hello sendy site page use uses using used work works working pls plz '
    + 'lol lmao bro bruh ser fam guys ok okay yeah yep yes really actually basically literally thing things stuff something anything thanks thank see '
    + 'look now one ones again q').split(' '));
  // (as typed, never stemmed: "is gwc pumping today" reads a figure, "pump gwc?" is a hunch)
  const FIG_EXACT = new Set('pumping dumping mooning popping tanking crashing'.split(' '));
  const ASKING = new Set(('question questions first second third fourth fifth sixth seventh eighth ninth tenth bottom wise em everything nah '
    + 'friend friends buddy pal mate dude man fren frens homie sir sis gm yo haha kindly asap quickly').split(' '));   // and the padding of a chat message
  const FIG_PAD = /\b(?:if (?:possible|you can)|for later|check back later|i(?:'ll| will) check back(?: later)?|asking for later|to compare later|not asking for (?:financial |investment )?advice|no advice(?: please)?|(?:i )?(?:do not|don't) want (?:any )?advice|just (?:the|tell me)|real quick|thank(?:s| you)(?: so much)?|please|pls|holding up|in (?:usd|dollars|eth)|yes or no|y\/n|as to|if (?:that|this|the|such) (?:information|info|data|figure|number) is available(?: to you)?|if (?:you have|you know|available)(?: it| that| one)?|(?:thank you|thanks) kindly|kind regards|many thanks|much appreciated)\b/gi;
  const NOW_WORDS = /\b(?:today|now|rn|atm|currently|so far|right now|24 ?h|24 hours|this (?:hour|morning)|past|last|since|yesterday|ago)\b/i;   // ("this week" may be one to come)
  const RISK_EMOJI = /[\u{1F680}\u{1F315}\u{1F319}\u{1F48E}\u{1F4C8}\u{1F4B0}\u{1F911}\u{1F4B8}\u{1F3B0}]/u;   // rocket, moon, gem, chart up, money: a hunch
  function figureOnly(text, typed) {
    if (!text) return true;
    if (typed && RISK_EMOJI.test(typed) && tokenMentions(text, true).some((x) => x.strong || x.known)) return false;
    let t = lc(text).replace(DISCLAIM, ' ').replace(FIG_PAD, ' ')
      // the small words said in full, and the shapes that read a figure ("trading at", "what's gwc at?", "over the last week")
      .replace(/n't\b/g, ' not').replace(/'m\b/g, ' am').replace(/'re\b/g, ' are').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will').replace(/'d\b/g, '')
      .replace(/\btrading at\b|\blook(?:ing)? at\b/g, ' ').replace(/\bat (?:the moment|present)\b/g, ' now ').replace(/\bover the (?=last|past)/g, ' the ').replace(/\bblock time\b/g, 'block')
      .replace(/^(\s*(?:what|where)(?:'s|\s+is|\s+are)?\b[^?!.]*?)\s+at(?=(?:\s+(?:right now|rn|now|today|atm|on \S+(?: chain)?))*\s*[?!.]*\s*$)/, '$1');
    // a word left hanging at the end ("priced in?", "all in?", "price at?") asks something else
    if (/\b(?:all|priced) in\b|\b(?:in|at|for|to|into|out|off|over|from)\s*[?!.]*\s*$/.test(t)) return false;
    if (/\bworth\b/.test(t) && !/\bhow much (?:is|are) (?:\d[\d,.]* )?\$?[a-z0-9]+ worth\b|\bwhat(?:'s| is) (?:\d[\d,.]* )?\$?[a-z0-9]+ worth\b/.test(t)) return false;
    if (/\bhold(?:ing|s)?\b/.test(t) && !/\b(?:how many|number of|count of|total|unique)\b[^.?!]{0,40}\bhold/.test(t)) return false;
    if (/\b(?:up|down|higher|lower)\b/.test(t) && !NOW_WORDS.test(t) && !/\b(?:top|biggest|most|gone|went|moved)\b/.test(t)) return false;
    if (/\btrading\b/.test(t) && !/\btrading (?:at|volume|for)\b/.test(t)) return false;
    const t2 = t.replace(/\b(?:can|could|would|will) (?:you|u)\s+(?:please\s+)?(?:show|tell|give|check|get|pull|look|find|list)\b/g, ' ');
    if (/\b(?:should|shoud|shud|would|could|will|wil|gonna|going to|might|must|ought|shall|recommend\w*|opinion|think|thoughts?|reckon|guess|feel|expect\w*|hope|wish|want|wanna|need|plan|planning|thinking|considering|wondering|curious|believe|bet|imagine|suppose)\b/.test(t2)) return false;
    if (/\bget (?:into|in|out)\b|\bworth (?:it|a)\b/.test(t2)) return false;
    // (a token the site has read, or one typed as a symbol, and its "-s" — never a word it might be: "fair price", "good price")
    for (const x of tokenMentions(text, true)) if (x.strong || x.known) t = t.replace(wordRe(x.w), (m, pre) => pre + ' ').replace(wordRe(x.w.replace(/^\$/, '') + 's'), (m, pre) => pre + ' ');
    // a year after a figure is a price to come ("gwc price 2030?"; "what was its price in 2025" is one gone by)
    if (/(?<![$\d.,])\b(?:20[2-9]\d|21\d\d)\b(?!\s?(?:k|m|b|x|%)|[.,]\d)/.test(t) && !/\b(?:was|were|did|had|back in|since|launched)\b/.test(t)) return false;
    // "first or second?", "this one or that one?": a choice, with no figure asked of either
    if (/\bor\b/.test(t) && !words(t).some((w) => FIG_WORDS.has(stem(w)) || FIG_EXACT.has(w))) return false;
    for (const [, re] of CHAIN_WORDS) t = t.replace(new RegExp(re.source, re.flags.replace('g', '') + 'g'), ' ');
    t = t.replace(/\b(?:chains?|networks?|blockchains?|l2|mainnet|rh|rhc|eth|ethereum|sol|solana|arb|arbitrum|bnb|bsc|matic|polygon|avax|avalanche|op|optimism|base|robinhood)\b/g, ' ').replace(/\$?\d[\d.,]*(?:\s?(?:k|m|b|bn|x|h|hr|hrs|d|w|wk|mo|y|yr)\b|%)?/g, ' ');
    // a purpose after the figure — "to watch", "to stack", "for gains", "for beginners" — is a reason, not a reading
    for (const m of t.matchAll(/\b(?:to|for|into)\s+([a-z]{2,})\b/g)) if (!FIG_WORDS.has(stem(m[1])) && !/^(?:the|a|an|last|past|date|now)$/.test(m[1])) return false;
    // and the small words it is asked in ("what's", "how many", "of", "in the last", "same question", "the second one") — not "too",
    // "if", "not", "out of", "at" a price to come, "why", "like"
    return words(t).every((w) => { const b = w.replace(/'s$/, ''); return STOP.has(b) || b.length === 1 ? FIG_STOP.has(b) : FIG_WORDS.has(stem(w)) || FIG_EXACT.has(w) || ASKING.has(b); });
  }
  // kept for the pulse and the chains: a question about gas or fees is a reading of the network whatever its words
  const figuresOk = (q, raw, typed) => figureOnly(q, typed) || (!tokenMentions(q, true).some((x) => x.strong || x.known) && /\b(?:gas|fees?|block|blocks|transactions?|txs?)\b/i.test(q) && !PRECISE.some((re) => re.test(q)));
  // a seed phrase or a key asked about — except what one IS ("what is a seed phrase"), which the pages explain — and any
  // message that offers to share one, however it calls it
  const SEED_WORD = /\b(?:seed|recovery|secret|backup|wallet) ?-?(?:phrase|words?)\b|\bse+d\b(?! (?:liquidity|round|funding|investors?|stage|sale|money|capital|pool|lp))|\bmnemonic\b|\bpriv(?:ate)? ?-?keys?\b|\bpk\b|\bpassphrase\b|\bkeystore\b|\bmy (?:phrase|keys?|words)\b(?!\s+(?:stats?|points?|features?|takeaways?|dates?|numbers?|facts?|metrics?|figures?|insights?|parts?|ideas?|info|for|to))|\byour (?:phrase|keys?)\b(?!\s+(?:stats?|points?|features?|takeaways?|dates?|numbers?|facts?|metrics?|figures?|insights?|parts?|ideas?|info))/i;
  const SHARE = /\b(?:share|send|give|gave|paste|type|enter|entered|show|dm|export|post|tell)\b[^.?!]{0,30}\b(?:mine|it|them|my|your|you|here)\b|\b(?:wants?|asked|asking|needs?|requested|request|know|knows|store|stores|storing|keep|reset|recover)\b[^.?!]{0,25}\b(?:my|your|mine|seed|phrase|words|keys?)\b|\b(?:leaked|stolen|stole|hacked|compromised|exposed|lost|got (?:out|taken))\b|\b(?:seed|phrase|words?)\s*:\s*(?:[a-z]+[\s,]+){8,}/i;
  // (typed fast: "seeed", "sid phrase", "frase", "12 wrds", "mnemonik", "keyphrase")
  const unslip = (s) => lc(s).replace(/(\w)\1{2,}/g, '$1$1').replace(/\bse+d\b|\bsid\b/g, 'seed').replace(/\bfrase\b/g, 'phrase').replace(/\bwrds?\b/g, 'words').replace(/\bmnemonik\b/g, 'mnemonic').replace(/\bkeyphrase\b/g, 'key phrase');
  const SECRETS_ASKED = (s0) => { const s = unslip(s0); return SECRETS_RAW(s); };
  const SECRETS_RAW = (s) => (RX.secrets.test(s) || (SEED_WORD.test(s) && SHARE.test(s)) || /\b(?:seed|phrase|words?)\s*:\s*(?:[a-z]+[\s,]+){8,}/i.test(s))
    && !(/^\s*(?:what|wat) (?:is|are|does) (?:a|an)\s+(?:seed|recovery|secret|backup|mnemonic|private)\b|^\s*(?:what|wat) (?:is|are) (?:mnemonics?|private keys?|seed phrases?|recovery phrases?)\s*[?!.]*\s*$|^\s*what does (?:a )?(?:seed|recovery) (?:phrase|words?) mean\b/i.test(s) && !SHARE.test(s));
  const METRIC_RX = [['mcap', /market ?cap|\bmcap\b|marketcap|(?<!diluted )valuation/i], ['fdv', /\bfdv\b|fully diluted/i], ['liquidity', /liquidity|\bliq\b|\blp\b|pool size/i],
    ['volume', /volume|\bvol\b|\btraded\b/i], ['change', /\bchange|\bgain|\blos(s|ing|er)|\bmoved?\b|%|percent|\bup or down\b|\b(?:pumping|dumping|mooning|tanking|crashing|popping)\b/i], ['holders', /\bholders?\b|\bholding\b|\bhow many (?:\w+ ){0,2}(?:people|ppl|wallets|addresses|accounts|users|members) (?:are |r )?(?:hold|own|have)/i],
    ['priceUsd', /\bprice|how much is|\bworth\b|\bcost\b|\btrading at\b|\bgoing for\b|\bwhat is \$?[a-z0-9]+ at\b/i]];
  const CHAIN_METRIC_RX = [['tvl', /\btvl\b|value locked|\b(money|value|funds|cash|capital) (is )?locked\b|\blocked\b/i], ['tvs', /\btvs\b|value secured/i], ['stables', /stablecoins?|\bstables\b/i], ['fees24h', /\bfees?\b|\bgas\b/i], ['volume24h', /volume|\btraded\b/i],
    ['liquidity', /liquidity/i], ['txcount24h', /transactions?|\btxs?\b/i], ['daa', /active addresses|\busers\b/i], ['mcap', /market ?cap|\bmcap\b/i], ['oi', /open interest/i]];
  const NOT_TOKENS = new Set(['the', 'a', 'an', 'it', 'this', 'that', 'my', 'your', 'our', 'their', 'token', 'tokens', 'coin', 'coins', 'chain', 'chains', 'power', 'call', 'calls', 'wall', 'site', 'market', 'gas', 'is', 'of', 'on', 'there', 'its', 'which', 'what', 'send power', 'every', 'each', 'any', 'all']);
  const CAPS_NOT_TOKENS = /^(TVL|TVS|FDV|DEX|USD|ETH|PNL|API|FAQ|NFT|LP|OG|ID|UTC|AI|DM|USDG|WETH|SOL|BSC|BNB|CEO|ATH|DYOR|FUD|FOMO|RPC|URL|CA|ROI|APR|APY|KYC|OK|IS|IT|I|A|PM|AM|UK|US|EU|HOW|WHAT|WHO|THE|AND|OR|NFA|TOS|XP|TPS|ELI5|LOL|GM|GN)$/;
  const CHAIN_BARE = new Set(['robinhood', 'ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism', 'rh', 'avax', 'bnb']);
  // a plain word that is also some token's symbol is a word first ("moon", "gas", "dog"); "send" is the site's coin unless it is the verb
  const COMMON = new Set(['base', 'chain', 'moon', 'gas', 'power', 'call', 'wall', 'site', 'market', 'token', 'coin', 'price', 'new', 'top', 'hot', 'pump', 'dump', 'safe', 'buy', 'sell', 'hold',
    'big', 'win', 'eth', 'sol', 'usd', 'usdc', 'usdt', 'usdg', 'weth', 'fee', 'pool', 'pair', 'swap', 'game', 'play', 'run', 'rocket', 'fun', 'love', 'life', 'king', 'gold', 'money', 'cash', 'bag', 'bags',
    'dev', 'team', 'real', 'fake', 'scam', 'rug', 'legit', 'one', 'two', 'ten', 'day', 'week', 'time', 'good', 'bad', 'best', 'less', 'down', 'high', 'low', 'dip', 'cap', 'liq', 'vol', 'chart', 'info',
    'stats', 'data', 'doing', 'trust', 'more', 'most', 'worth', 'today', 'rn', 'atm', 'holders', 'holder', 'volume', 'liquidity', 'trading', 'community', 'group', 'club', 'scan', 'scanner', 'dog', 'cat',
    'frog']);
  const SEND_VERB = /\b(?:to|can|could|i|you|we|they|please|then|just|should|would|will|do|did|cannot|can't|don't|not|lets|let's|let me|want to|need to|have to|trying to|able to|going to|how to|how do i|how can i)\s+send(?:ing)?\b(?!\s+(?:price|token|coin|market|holders|community|chart|rn|right now)\b)|^\s*send(?:ing)?\s+(?:me|it|to|them|him|her|us|eth|sol|usdc|usdt|usdg|btc|money|funds|over|back|out|\$\s?\d|\d|(?:tokens?|coins?) to)\b|\bsend(?:ing)?\s+(?:eth|sol|usdc|usdt|usdg|btc|money|funds)\b|\bsend(?:ing)? (?:it|them|tokens?|coins?) to\b|\bjust send it\b/i;
  /* the tokens a question names. Strong: a $SYMBOL, an address, a symbol in capitals — one the site has not read is said so.
     Weak: a plain word in a "price of X" / "X market cap" / "how is X doing" / "what is X at" phrase, or a symbol the site has
     read typed as a plain word in a question about a token ("is gwc legit", "pepe holders") — a weak one counts only if it is
     a token the site has read, so "biggest tokens by market cap" is not a question about a token called BY. loose: any symbol
     the site has read, wherever it stands (a follow-up: "and gwc?"). */
  const WEAK_NOT = new Set(['by', 'top', 'biggest', 'largest', 'highest', 'lowest', 'smallest', 'total', 'current', 'whats', 'average', 'daily', 'same', 'pool', 'dex', 'trading', 'buy', 'sell', 'chain']);
  function tokenMentions(q, loose) {
    const found = new Map(), syms = names().symbols;
    // known: a symbol the site has read — a weak word that is not one ("how MANY holders") never stands for a token in a follow-up
    const put = (w, strong) => {
      w = w.replace(/^\$/, '').replace(/'s$/, ''); const k = lc(w);
      if (NOT_TOKENS.has(k) || CHAIN_BARE.has(k) || (!strong && (STOP.has(k) || WEAK_NOT.has(k)))) return;
      if (!found.has(k) || strong) found.set(k, { w, strong, known: syms.has(k) });
    };
    for (const m of q.matchAll(/\$(?=[\w.-]*[A-Za-z])([A-Za-z0-9][\w.-]{0,30})/g)) put(m[1], true);   // "$10" is an amount
    for (const m of q.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) put(m[0], true);
    if (/[a-z]/.test(q)) for (const m of q.matchAll(/(?:^|[^\w$@])([A-Z][A-Z0-9]{1,11})(?![\w])/g)) if (!CAPS_NOT_TOKENS.test(m[1])) put(m[1], true);   // a question all in capitals is not a list of symbols
    // the site's own names are not the coin: Send Power, a Send Call, the Send Wall, a Send Squad, Just Send It
    const lq = q.toLowerCase().replace(/\bsend\s+(?:power|calls?|wall|squads?|ids?|api)\b|\bjust send it\b/g, ' ');
    for (const m of lq.matchAll(/\b(?:price|mcap|market ?cap|liquidity|volume|fdv|holders|chart)\s+(?:of|for|on)\s+\$?([a-z0-9][\w.-]{1,30})/g)) put(m[1], false);
    for (const m of lq.matchAll(/\b([a-z0-9][\w.-]{1,30})(?:'s)?\s+(?:price|mcap|market ?cap|liquidity|volume|fdv|holders)\b/g)) put(m[1], false);
    for (const m of lq.matchAll(/\bhow much is\s+(?:\d+\s+)?\$?([a-z0-9][\w.-]{1,30})/g)) put(m[1], false);
    for (const m of lq.matchAll(/\bhow(?:'s| is| are)\s+\$?([a-z0-9][\w.-]{1,30})\s+(?:doing|looking|performing|holding up|going)\b/g)) put(m[1], false);
    for (const m of lq.matchAll(/\bwhat(?:'s| is)\s+\$?([a-z0-9][\w.-]{1,30})\s+(?:at|trading at|going for|worth|sitting at)\b/g)) put(m[1], false);
    for (const m of lq.matchAll(/\b(?:info|information|stats|data|details|chart|update|news)\s+(?:on|for|about)\s+\$?([a-z0-9][\w.-]{1,30})/g)) put(m[1], false);
    for (const m of lq.matchAll(/\b(?:look ?up|check|tell me (?:more )?about|what do you know about|anything on)\s+\$?([a-z0-9][\w.-]{1,30})\b/g)) put(m[1], false);
    // a symbol the site has read, typed as a plain word ("sends" for send's), where the question is about a token
    if (loose || TOKENISH.test(lq)) {
      const sendVerb = SEND_VERB.test(lq) && !/\$send\b|\bSEND\b/.test(q);
      for (const m of lq.matchAll(/(?:^|[^\w$@/.-])([a-z][a-z0-9]{2,11})(?![\w@/-])/g)) {
        const w = syms.has(m[1]) ? m[1] : m[1].endsWith('s') && syms.has(m[1].slice(0, -1)) ? m[1].slice(0, -1) : null;
        // a plain English word that is also some token's symbol ("link", "bridge", "higher") is the word — the site's own coins excepted
        if (w && !COMMON.has(w) && !STOP.has(w) && !(w === 'send' && sendVerb) && (siteSym(w) || !plainWord(w))) put(w, false);
      }
    }
    return [...found.values()];
  }
  const plainWord = (w) => ENGLISH.has(w) || LEXICON.has(w) || STOP.has(w) || COMMON.has(w) || baseForms(w).some((b) => ENGLISH.has(b));
  // where a question is about a token: a figure, a move, a safety word, a comparison, a token's own parts
  const TOKENISH = /price|market ?cap|mcap|\bfdv\b|liquidity|\bliq\b|volume|\bholders?\b|\bholding\b|\bchart\b|\btrading at\b|\bworth\b|\bdoing\b|\bperforming\b|\bmoved?\b|\bchange\b|\bup or down\b|\bpump|\bdump|\bmoon|\bsafe\b|\bscam|\brug|\blegit|\bhoneypot|\btrust|\bsketchy|\bshady|\bfake\b|\bcontract\b|\btoken\b|\bcoin\b|\bbuy\b|\bsell\b|\bhold\b|\bvs\.?\b|\bversus\b|\bcompare|\bbigger\b|\bsmaller\b|\bat\b|\bstats\b|\binfo\b|\bcommunity\b|\bgroup\b|\bclub\b|fully diluted|valuation|\b24 ?h\b|%|percent|\bsupply\b|\beverything\b|\bflip\b|\brecover/;
  function chainIn(q) {
    for (const [k, re] of CHAIN_WORDS) if (re.test(q)) return k;
    const lq = q.toLowerCase();   // any other chain Market Data lists, by its full name
    for (const c of otherChains()) if (c.re.test(lq)) return c.key;
    return null;
  }
  // every chain a question names, in the order it names them ("base vs robinhood chain tvl")
  function chainsIn(q) {
    const at = new Map();
    for (const [k, re] of CHAIN_WORDS) { const m = new RegExp(re.source, re.flags.replace('g', '') + 'g'); for (const x of q.matchAll(m)) if (!at.has(k) || x.index < at.get(k)) at.set(k, x.index); }
    const lq = q.toLowerCase();
    for (const c of otherChains()) { const x = c.re.exec(lq); if (x && !at.has(c.key)) at.set(c.key, x.index); }
    return [...at.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  }
  // a chain by a short name ("eth", "sol", "rh", "arb") — only where a follow-up names nothing else
  const LOOSE_CHAIN = Object.assign(Object.create(null), { eth: 'ethereum', sol: 'solana', rh: 'robinhood', rhc: 'robinhood', bnb: 'bsc', bsc: 'bsc', arb: 'arbitrum', matic: 'polygon', poly: 'polygon', avax: 'avalanche', op: 'optimism', base: 'base' });
  const looseChain = (q) => { for (const w of words(q)) { const k = LOOSE_CHAIN[w] || chainKeyOf(w); if (k && CHAIN_NAMES[k]) return { key: k, word: w }; } return null; };
  const allChains = (q) => /\b(all|every|across|each) (the )?(chains?|networks?|blockchains?)\b|\bcross[- ]chain\b|\bacross chains\b|\beverywhere\b|\banywhere\b|\bcombined\b/i.test(q);
  const winIn = (q) => (/\b5 ?m(in(ute)?s?)?\b/i.test(q) ? '5m' : /\b1 ?h(ou)?r?\b|\blast hour\b|\bthis hour\b/i.test(q) ? '1h' : /\b6 ?h(ou)?rs?\b/i.test(q) ? '6h' : '24h');
  const chainWinIn = (q) => (/\b7 ?d(ays?)?\b|\bweek\b/i.test(q) ? '7d' : /\b30 ?d(ays?)?\b|\bmonth\b/i.test(q) ? '30d' : '24h');
  /* the members a question names: @name (an @ inside an email address is not one), "member alice", "alice's Send Power", "how
     many points does alice have", "what level is alice", "where does alice rank" — sure: a name asked for as a name, said so
     when nobody is called that — and a member's name typed as a plain word where the question is about a member ("zqbob
     xp?", "who has more points, alice or bob") */
  const MEMBERISH = /\b(send power|points?|xp|score|level|lvl|rank|ranked|ranking|profile|wall|followers?|posts?|joined|stats|who is|ahead|behind|above|below|more|most|stand|stands|compared?|vs\.?|versus|called|named|member|user)\b/i;
  function membersIn(q, loose) {
    const out = [], seen = new Set(), users = names().users;
    // a name asked for that is a word of the site's ("user count", "sender standings") is that word, not a member
    const word = (k) => LEXICON.has(k) || STOP.has(k) || index.vocab().has(k) || COMMON.has(k) || ENGLISH.has(k) || index.ownDf(stem(k)) > 0;
    // (an explicit "how many points does X have" asks for X as a name even when X is a word, if someone has it)
    const put = (name, sure, at) => { name = String(name).replace(/[.]+$/, ''); const k = lc(name); if (!k || seen.has(k) || /^(send|the|you|me|this|that|my|your|i|it|he|she|they|we|him|her|them|someone|anyone|everyone|people)$/.test(k) || STOP.has(k) || (!at && word(k) && !(sure && users.has(k)))) return; seen.add(k); out.push({ name, sure }); };
    for (const m of q.matchAll(/(?:^|[^\w.+-])@([A-Za-z0-9_.-]{2,40})/g)) put(m[1], true, true);
    const pats = [/\b(?:user|member|sender|profile of|wall of)\s+@?([A-Za-z0-9_.-]{3,40})\b/i, /\b([A-Za-z0-9_.-]{3,40})'s (?:send power|level|lvl|rank|profile|wall|points|followers|xp|score|stats)\b/i,
      /\b(?:send power|level|rank|points|xp|score) (?:of|for)\s+@?([A-Za-z0-9_.-]{3,40})\b/i, /\bhow (?:much|many) (?:send power|points|xp|score) (?:does|has|do|did)\s+@?([A-Za-z0-9_.-]{3,40})\b/i,
      /\bwhat (?:level|lvl|rank) is\s+@?([A-Za-z0-9_.-]{3,40})\b/i, /\bwhere (?:does|is)\s+@?([A-Za-z0-9_.-]{3,40}) (?:rank|ranked|stand|on the (?:leader)?board)\b/i,
      /\b(?:someone|anyone|somebody|anybody|(?:a |any )?(?:member|user|person|sender|account))\s+(?:called|named)\s+@?([A-Za-z0-9_.-]{3,40})\b/i];
    for (const re of pats) { const m = re.exec(q); if (m) put(m[1], true); }
    // "whats zqbobb score": a name nobody's pages use, before a member's figure — asked for as a name
    { const m = /\b([A-Za-z0-9_.-]{3,40}) (?:score|xp|send power|level|lvl|rank|points|stats)\b/i.exec(q); if (m && !LEX.known(lc(m[1]))) put(m[1], true); }
    if (loose || MEMBERISH.test(q)) { for (const w of lc(q).match(/[a-z0-9_.-]{3,40}/g) || []) { const u = users.get(w) || (w.endsWith('s') ? users.get(w.slice(0, -1)) : null); if (u && !COMMON.has(lc(u))) put(u, false); } }
    // a name asked for that turns out to be someone's plain name with an "s" ("zqbobs score"): that member
    return out.map((p) => (!names().users.has(lc(p.name)) && /s$/i.test(p.name) && names().users.has(lc(p.name.slice(0, -1))) ? { name: names().users.get(lc(p.name.slice(0, -1))), sure: p.sure } : p));
  }
  const memberIn = (q) => { const p = membersIn(q)[0]; return p ? p.name : null; };
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const plural = (n, one, many) => count(n) + ' ' + (n === 1 ? one : many || one + 's');

  // one answer: the words, and the sources it came from (site paths and the source names the site already shows)
  const out = (intent, answer, sources, extra) => Object.assign({ engine: 'brain', intent, answer, sources: (sources || []).filter(Boolean).slice(0, 4) }, extra || {});
  const srcOf = (label, href, at) => ({ label, href: href || null, at: Number.isFinite(at) ? at : null });

  function tokenAnswer(r, metric, t, asked, also) {
    if (!r.ok) {
      // a symbol a slip from one the site has read is asked about, never answered as if it were that one
      const near = asked ? nearest(asked, names().symbols, siteSym) : null;
      return out('token', "I couldn't find that one: " + r.why + '.' + (near ? ' Did you mean ' + sym(near.toUpperCase()) + '?' : ''), [srcOf('Scanner', '/newpairs')], { unknownToken: true });
    }
    const ts = r.tokens, first = ts[0];
    const asks = [metric].concat(also || []).filter(Boolean);   // every figure the question asks for leads, in the order asked
    const leads = (k) => { const i = asks.findIndex((m) => k === m || (m === 'volume' && k.startsWith('volume')) || (m === 'change' && k.startsWith('change'))); return i < 0 ? 0 : 10 - i; };
    const items = [['priceUsd', 'price', 'usd'], ['mcap', 'market cap', 'usd'], ['fdv', 'FDV', 'usd'], ['liquidity', 'liquidity', 'usd'], ['volume', '24 h volume', 'usd'], ['volume24h', '24 h volume', 'usd'], ['change', '24 h change', 'pct'], ['change24h', '24 h change', 'pct'], ['holders', 'holders', 'count']]
      .filter(([k]) => isFig(first[k])).sort((a, b) => leads(b[0]) - leads(a[0])).slice(0, metric ? Math.max(4, asks.length + 2) : 5);
    let a = sym(first.symbol) + (nameOf(first.name) ? ' (' + first.name + ')' : '') + ' on ' + (first.chainName || CHAIN_NAMES[first.chain] || first.chain) + ': ' + said(items.map(([k, label, kind]) => ({ label, f: first[k], kind })), t) + '.';
    if (first.pools && first.pools.length > 1) a += ' Those figures cover its ' + first.pools.length + ' pools among the most-traded the site keeps; the deepest is ' + (first.pools[0].pair || first.pools[0].dex) + '.';
    if (first.calls) a += ' ' + plural(first.calls.count, 'public Send Call') + ' on it, the newest by @' + first.calls.newest[0].by + '.';
    const scanner = ['robinhood', 'ethereum', 'solana'].includes(first.chain) ? scanHref(first.chain, first.address) : null;
    a += ' Its full read is at ' + first.href + (first.from === 'market' && scanner ? ', and the Scanner reads it at ' + scanner : '') + '.';
    if (ts.length > 1) a += ' The site has also read ' + ts.slice(1, 4).map((x) => sym(x.symbol) + ' on ' + (x.chainName || x.chain)).join(', ') + ' — say which chain you mean.';
    return out('token', a, [srcOf(first.from === 'market' ? 'Market Data · GeckoTerminal' : "The Scanner's reading", first.href, first.at), scanner && first.from === 'market' ? srcOf('Scanner', scanner, null) : null]);
  }
  function chainAnswer(r, metric, t) {
    if (!r.ok) return out('chain', 'I have no figures for that chain yet: ' + r.why + '.', [srcOf('Market Data', r.href || '/market')]);
    const s = r.stats;
    const items = [['tvl', 'DeFi TVL', 'usd'], ['volume24h', 'DEX volume (24 h)', 'usd'], ['fees24h', 'gas fees (24 h)', 'usd'], ['stables', 'stablecoins', 'usd'], ['liquidity', 'DEX liquidity', 'usd'], ['tvs', "L2BEAT's value secured", 'usd'], ['mcap', "its own token's market cap", 'usd'],
      ['txcount24h', 'transactions (last whole day)', 'count'], ['daa', 'active addresses (last whole day)', 'count'], ['oi', 'open interest', 'usd']];
    const want = metric ? items.filter(([k]) => k === metric) : [];
    const rest = items.filter(([k]) => k !== metric && isFig(s[k]) && (s[k].v != null || k === 'mcap')).slice(0, metric ? 2 : 5);
    let a = r.name + ': ' + said(want.concat(rest).map(([k, label, kind]) => ({ label, f: s[k], kind })), t) + '.';
    if (metric === 'tvl' && isFig(s.tvs)) a += " (DeFi TVL and L2BEAT's value secured are different measures; Market Data never mixes them.)";
    if (s.stage) a += ' L2BEAT stage: ' + s.stage + '.';
    a += ' More on ' + r.href + '.';
    return out('chain', a, [srcOf('Market Data · ' + r.name, r.href, r.at)]);
  }
  function listTokensAnswer(r, chainLabel, t) {
    if (!r.ok) return out('topTokens', 'I have no token list for ' + chainLabel + ' yet: ' + r.why + '.', [srcOf('Market Data', r.href || '/market')]);
    const by = { volume: 'DEX volume over the ' + (r.window || 'last 24 hours'), liquidity: 'liquidity', mcap: 'market cap', fdv: 'FDV', change: 'price change over the ' + (r.window || 'last 24 hours') }[r.sort] || r.sort;
    const [fk, kind] = { volume: ['volume', 'usd'], liquidity: ['liquidity', 'usd'], mcap: ['mcap', 'usd'], fdv: ['fdv', 'usd'], change: ['change', 'pct'] }[r.sort] || ['volume', 'usd'];
    const rows = r.rows.slice(0, 5).map((x, i) => (i + 1) + '. ' + sym(x.symbol) + (r.chain === 'all' ? ' on ' + x.chainName : '') + ' — ' + val(x[fk], kind) + ', price ' + val(x.priceUsd, 'usd'));
    const at = (r.rows[0] && r.rows[0][fk] && r.rows[0][fk].at) || r.at;
    const a = (r.dir === 'asc' ? 'Lowest' : 'Top') + ' tokens on ' + chainLabel + ' by ' + by + ' (GeckoTerminal via Market Data, read ' + ago(at, t) + '): ' + rows.join('; ') + '. That is among ' + (r.basis || 'the most-traded pools') + ' — not the whole chain, and never a tip. The full list is on ' + r.href + '.';
    return out('topTokens', a, [srcOf('Market Data · GeckoTerminal', r.href, at)]);
  }

  /* ----- what a message points back at: Sendy's last answer ----- */
  const lastOf = (history, role) => { for (let i = (history || []).length - 1; i >= 0; i--) if (history[i].role === role && history[i].content) return history[i].content; return ''; };
  // the entries of a list Sendy just gave — tokens, members, pairs, communities, chains — in order
  function listItems(a) {
    const at = [];
    for (const m of String(a).matchAll(/(?:^|\n\n)(\$[A-Za-z0-9][\w.-]{0,30}) \(/g)) at.push([m.index, m[1]]);   // tokens side by side
    for (const m of String(a).matchAll(/(?:^|[:;,]\s+)(?:#\d+\s+|\d+\.\s+)?(\$[A-Za-z0-9][\w.-]*|@[\w.-]+)(?=[^;:,—–(]*\s[—–(])/g)) at.push([m.index, m[1]]);
    for (const m of String(a).matchAll(/(?:^|[:;]\s+)\d+\.\s+([A-Z][A-Za-z]+(?: Chain)?)(?=\s[—–])/g)) at.push([m.index, m[1]]);
    const seen = new Set();
    return at.sort((x, y) => x[0] - y[0]).map((x) => x[1]).filter((x) => !seen.has(x) && seen.add(x));
  }
  // what Sendy's last answer was about: a token (and its chain), a community, a member, a chain, a list
  function topicOf(a) {
    a = String(a || '');
    let m = /^\$([A-Za-z0-9][\w.-]{0,30}) \([^)]*\) on ([^:]+):/.exec(a);
    if (m && (a.match(/(?:^|\n\n)\$[A-Za-z0-9][\w.-]{0,30} \(/g) || []).length < 2) return { kind: 'token', sym: m[1], chain: m[2] };
    if ((m = /^\$([A-Za-z0-9][\w.-]{0,30})\b[^.]{0,80}\bcommunity\b/.exec(a))) return { kind: 'community', sym: m[1] };
    if ((m = /\bThe Scanner reads \$([A-Za-z0-9][\w.-]{0,30})'s\b|\bThe site has not read \$([A-Za-z0-9][\w.-]{0,30})\b|^\$([A-Za-z0-9][\w.-]{0,30})'s readings — /.exec(a))) return { kind: 'token', sym: m[1] || m[2] || m[3] };
    if ((m = /^@([\w.-]+):/.exec(a))) return { kind: 'member', name: m[1] };
    if ((m = /^([A-Z][\w ]{1,40}?): (?:DeFi TVL|DEX volume|gas fees|stablecoins|DEX liquidity|L2BEAT|its own token|transactions|active addresses|open interest)/.exec(a))) return { kind: 'chain', name: m[1] };
    if ((m = /^(?:Top|Lowest) tokens on (.+?) by /.exec(a))) return { kind: 'tokens', chain: m[1] };
    if (/^(?:\d+ communit|No community is live)/.test(a)) return { kind: 'communities' };
    if ((a.match(/(?:^|\n\n)\$[A-Za-z0-9][\w.-]{0,30} \(/g) || []).length >= 2) return { kind: 'tokens' };   // two tokens side by side
    if (/^The all-time leaderboard/.test(a)) return { kind: 'leaderboard' };
    return null;
  }
  const ORDINAL = /\b(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last|top|bottom)\s+(?:one|token|coin|pair|pool|chain|member|community|sender|guy|person|player|user|entry|item|name)\b|\b(?:the\s+)?(?:who is |who's )?(2nd|3rd|4th|5th|second|third|fourth|fifth)(?:\s+(?:place|tho|though|then))?\s*[?!.]*$|(?:^|\s)(?:number|no\.|#)\s?([1-9])\b(?!\s*(?:sender|spot|place|on the|of the))/i;
  const ORD = { first: 1, '1st': 1, top: 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };
  const PRONOUN = /\b(?:it'?s|its|it|itself|that one|this one|(?:that|this|the|same) (?:token|coin|one|pair))\b|\b(?:and|about|is|was) (?:that|this)\b/i;
  const PRONOUN_MEMBER = /\b(?:he|she|him|her|his|hers|they|them|their)\b/i;
  const FOLLOW_LEAD = /^\s*(?:and also|and|what about|how about|also|same for|now do|now|then)\b[\s,]*/i;
  const pointsAlone = (s) => /^\s*(?:and |what about |how about |is |was )?(?:it|that|this|that one|this one)\s*[?!.]*\s*$/i.test(s);
  /* A message that points back — "the second one", "is it safe?", "whats its market cap", "and the fdv?", "whos ahead of
     him", "the base one" — said with what it points at, from Sendy's last answer: the token for "it", the entry of the list for
     "the second one", the token again for a figure asked alone, the chain for "the base one". A pointer at a list of several
     is asked back ("which one?"), never guessed. Returns { q } — or { clarify } with the question to ask. */
  function refer(q, history) {
    const a = lastOf(history, 'assistant'); if (!a) return { q };
    const topic = topicOf(a), items = listItems(a), asCommunity = !!topic && (topic.kind === 'community' || topic.kind === 'communities');
    let s = q;
    const om = ORDINAL.exec(s);
    if (om && items.length > 1 && !(om[3] && /\b(leader ?board|board|rank|place|spot)\b/i.test(s))) {
      const w = om[1] || om[2], o = w && w.toLowerCase(), n = o ? (o === 'last' || o === 'bottom' ? items.length : ORD[o]) : Number(om[3]);
      if (items[n - 1]) s = s.replace(om[0], (/^\s/.test(om[0]) ? ' ' : '') + items[n - 1] + (asCommunity && items[n - 1][0] === '$' ? ' community' : ''));
    }
    const tm = /\bthe (\$?[a-z0-9][\w.-]{1,20}) one\b/i.exec(s);
    if (tm && s === q) {
      const w = tm[1].replace(/^\$/, ''), ck = LOOSE_CHAIN[lc(w)] || chainKeyOf(w), hit = items.find((x) => lc(x.replace(/^[$@]/, '')) === lc(w));
      if (hit) s = s.replace(tm[0], hit + (asCommunity && hit[0] === '$' ? ' community' : ''));
      else if (asCommunity) s = s.replace(tm[0], '$' + w.toUpperCase() + ' community');
      else if (ck && CHAIN_NAMES[ck]) s = 'and ' + s.replace(tm[0], 'on ' + CHAIN_NAMES[ck]);
    }
    if (s !== q) return { q: s };
    const lone = /^\s*(?:and\s+|also\s+|then\s+|what about\s+|how about\s+)?(?:on\s+|for\s+)?(\$?[a-z][\w ]{0,24}?)\s*(?:both|too|as well|also|then|instead)?\s*[?!.]*$/i.exec(s);
    if (lone && topic && !/\bin\s+(?:eth|sol|usd|usdc|usdt|usdg|btc|dollars?)\b/i.test(s)) { const ck = LOOSE_CHAIN[lc(lone[1])] || chainKeyOf(lone[1]); if (ck && CHAIN_NAMES[ck]) return { q: 'and on ' + CHAIN_NAMES[ck] }; }
    const namedTok = tokenMentions(s, true).some((x) => x.strong || x.known);
    // "it", "its", "that one": the token of the last answer, where this question is about a token
    // ("is it safe to connect my wallet?", "is it possible to change my name?": that "it" points at nothing)
    const dummy = /\bit(?:'s| is)?\s+(?:possible|ok|okay|safe|free|hard|easy|normal|true|necessary|required|allowed|better|best|smart|wise|bad|worth|time|too late)\s+to\b/i.test(s);
    if (!namedTok && !dummy && PRONOUN.test(s) && (TOKENISH.test(lc(s)) || RX.tokenInfo.test(s) || RX.safety.test(s) || pointsAlone(s))) {
      const say = (tok) => s.replace(FOLLOW_LEAD, '').replace(/\bit'?s\b/i, tok + "'s").replace(PRONOUN, (m) => (/^(and|about|is|was) /i.test(m) ? m.split(' ')[0] + ' ' + tok : tok));
      if (topic && (topic.kind === 'token' || topic.kind === 'community')) {
        let r = say('$' + topic.sym);
        if (topic.chain && !chainIn(r) && !/\bcommunity\b/i.test(r)) r += ' on ' + topic.chain;
        return { q: r };
      }
      const toks = items.filter((x) => x[0] === '$');
      if (toks.length === 1) return { q: say(toks[0]) };
      if (toks.length > 1) return { clarify: 'Which one do you mean — ' + toks.slice(0, 5).join(', ') + '? Say its symbol and I will look it up.' };
    }
    // "where do i find it", "how does it work": what the last question was about, when that was a feature, not a token
    const prevQ = lastOf(history, 'user');
    const IT = /\bit\b|\b(?:that|this)(?=\s*[?!.]*$)/i;
    if (!namedTok && IT.test(s) && prevQ && (!topic || !['token', 'community', 'member', 'tokens', 'communities', 'leaderboard', 'chain'].includes(topic.kind)) && !/^That's not something I/.test(a) && terms(s).length <= 3) {
      const what = WORDS.read(prevQ, LEX).text.replace(/^\s*(?:what|where|how|who)\s+(?:is|are|does|do|was)\s+|^\s*(?:tell me about|explain)\s+/i, '').replace(/\s+(?:work|works|do|mean|for)\s*[?!.]*$|[?!.]+$/i, '').trim();
      if (what && !/^(?:I|you|we)\b/i.test(what) && !METRIC_RX.some(([, re]) => re.test(what)) && !CHAIN_METRIC_RX.some(([, re]) => re.test(what)) && !chainIn(what) && !tokenMentions(what, true).some((x) => x.strong || x.known) && terms(what).length && terms(what).length <= 4)
        return { q: s.replace(FOLLOW_LEAD, '').replace(IT, () => what) };
    }
    // "whos ahead of him": the member of the last answer
    if (topic && topic.kind === 'member' && PRONOUN_MEMBER.test(s) && MEMBERISH.test(s) && !membersIn(s).length) return { q: s.replace(PRONOUN_MEMBER, '@' + topic.name) };
    // a figure asked alone after a token ("and the fdv?", "volume?"), or after a chain ("and fees?")
    const bare = (x) => x.replace(FOLLOW_LEAD, '').replace(/[?!.\s]+$/, '');
    const defining = /\b(mean|means|meaning|stand for|stands for|defin\w*|explain)\b/i.test(s) || /^\s*what (?:is|are) (?:an?)\b/i.test(s);   // "what does fdv mean?" asks what it is
    if (topic && topic.kind === 'chain' && !chainIn(s) && /\b(there|over there|on it|on that one)\b/i.test(s)) return { q: s.replace(/\b(over there|there|on it|on that one)\b/i, 'on ' + topic.name) };
    if (topic && topic.kind === 'token' && !namedTok && !chainIn(s) && !defining && METRIC_RX.some(([, re]) => re.test(s)) && terms(s).length <= 4)
      return { q: bare(s) + ' of $' + topic.sym + (topic.chain ? ' on ' + topic.chain : '') };
    if (topic && topic.kind === 'chain' && !namedTok && !chainIn(s) && !defining && CHAIN_METRIC_RX.some(([, re]) => re.test(s)) && terms(s).length <= 4)
      return { q: bare(s) + ' on ' + topic.name };
    return { q };
  }

  /* A follow-up ("and on Base?", "what about $GWC?", "now do eth", "how bout gwc, same question", "what about zqalice"): the
     person's previous question, with what this one names in place of what that one named — the chain for the chain, the
     token for the token, the member for the member — answered once more. Null when it is not one. */
  async function followOn(q, page, history) {
    const prev = [...(history || [])].reverse().find((m) => m.role === 'user' && m.content && m.content !== q);
    if (!prev || terms(q).length > 4 || RX.explain.test(q)) return null;
    // (a question that got a guard rail's answer is not one to continue: "where do I buy it?" after a refusal is a how-to)
    if (/^(?:That's not something I|Never share a seed phrase|Nobody can promise that|No\. In the About page|Robinhood Chain is the public network)/.test(lastOf(history, 'assistant')) && HOWTO.test(q)) return null;
    let base = WORDS.read(prev.content, LEX).text;
    if (/\ball[- ]time\b(?! high)|\boverall\b|\bof all time\b|\bever\b/i.test(q) && (RX.competitions.test(base) || RX.weekly.test(base))) base = 'the all-time leaderboard';
    let rest = q.replace(FOLLOW_LEAD, '').replace(/\b(?:the )?same (?:question|thing|for)\b|\bsame\b|\bbut\b/gi, ' ');
    const named = chainIn(rest), ch = named ? { key: named } : /\bin (?:eth|sol|usd|usdc|usdt|usdg|btc|dollars?)\b/i.test(rest) ? null : looseChain(rest);
    if (ch) {
      for (const [, re] of CHAIN_WORDS) base = base.replace(new RegExp(re.source, re.flags.replace('g', '') + 'g'), ' ');
      if (!named) rest = removeWord(rest, ch.word) + ' on ' + CHAIN_NAMES[ch.key];
    }
    const real = (x) => x.strong || x.known, nowT = tokenMentions(rest, true).filter(real), prevT = tokenMentions(base, true).filter(real);
    if (nowT.length) {
      if (prevT.length === 1 && nowT.length === 1) { base = swapWord(base, prevT[0].w, '$' + nowT[0].w); rest = removeWord(rest, nowT[0].w); }
      else for (const p of prevT) base = removeWord(base, p.w);
    }
    const nowM = membersIn(rest, true), prevM = membersIn(base);
    // a word in the follow-up nobody uses where a name or a symbol stood ("what about zqcarl"): asked about as that name
    const odd = words(rest).find((w) => /^[a-z][a-z0-9_.-]{2,39}$/.test(w) && !LEX.known(w) && !CHAIN_BARE.has(w));
    if (nowM.length === 1 && prevM.length === 1) { base = swapWord(base, prevM[0].name, '@' + nowM[0].name); rest = removeWord(rest, nowM[0].name); }
    else if (!nowM.length && prevM.length === 1 && odd) { base = swapWord(base, prevM[0].name, '@' + odd); rest = removeWord(rest, odd); }
    else if (!nowT.length && prevT.length === 1 && odd && !prevM.length) { base = swapWord(base, prevT[0].w, '$' + odd); rest = removeWord(rest, odd); }
    const again = await answerBrain((base + ' ' + rest).replace(/\s+/g, ' ').trim(), page, [], true);
    return again.intent !== 'handover' && again.intent !== 'passage' ? again : null;
  }
  // a word of a question by itself — its $ or @, and its "'s", go with it
  const wordRe = (w) => new RegExp('(^|[^\\w$@])[$@]?' + String(w).replace(/^[$@]/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:'s)?(?![\\w])", 'gi');
  const swapWord = (s, w, to) => s.replace(wordRe(w), (m, pre) => pre + to);
  const removeWord = (s, w) => s.replace(wordRe(w), (m, pre) => pre + ' ');
  // which of two or three readings is the larger, as read — a fact, never a pick; an unknown one is said, never compared
  function compareLine(rows, label, kind, higher) {
    const known = rows.filter((x) => isFig(x.f) && x.f.v != null), unknown = rows.filter((x) => !isFig(x.f) || x.f.v == null);
    const unk = unknown.length ? ' ' + unknown.map((x) => x.name + "'s " + label).join(' and ') + (unknown.length === 1 ? ' is' : ' are') + ' unknown' + (known.length < 2 ? ', so they cannot be compared on it.' : '.') : '';
    if (known.length < 2) return unk;
    known.sort((a, b) => b.f.v - a.f.v);
    return ' Of ' + (known.length === 2 ? 'the two' : 'these') + ', ' + known[0].name + ' has the ' + (higher ? 'higher ' : 'larger ') + label + ' as read (' + val(known[0].f, kind) + ', against ' + known.slice(1).map((x) => val(x.f, kind) + ' for ' + x.name).join(' and ') + ').' + unk;
  }
  const COMPARING = /\b(vs\.?|versus|compared?|comparison|or|bigger|smaller|larger|higher|lower|more|less|deeper|which)\b/i;
  const joinAnswers = (intent, outs, extra) => out(intent, outs.map((x) => x.answer).join('\n\n') + (extra || ''), [].concat(...outs.map((x) => x.sources || [])));

  // the guard rails on a question, as tidied and as typed: the answer they give, or null
  function guardOf(q, raw, history, typed, whole) {
    const texts = [q, raw, typed].filter(Boolean);
    if (texts.some(SECRETS_ASKED)) return texts.some((x) => GAVE.test(x || '')) ? out('secrets', SECRETS + ' ' + SECRETS_GAVE, [srcOf('Privacy Policy', '/privacy'), srcOf('Support board', '/support')]) : out('secrets', SECRETS, [srcOf('Privacy Policy', '/privacy')]);
    // how to buy, in slang ("i wanna ape into $SEND how do i do that"): the guide, not the refusal
    const howTo = HOWTO.test(stripSite(q)) && !/\b(?:should|shall|shud|worth|moon|pump|good time|will it|gonna|opinion|recommend|better|best|dumb|stupid|smart|wise|crazy|good idea|bad idea|mistake|rent|savings)\b/i.test(texts.join(' '));
    if (adviceAsked(howTo ? [q] : texts, history, whole))
      return out('advice', ADVICE, [srcOf('Scanner', '/newpairs'), srcOf('Market Data', '/market')]);
    // Robinhood Chain's own makers: the network, which this site does not speak for — and the site, which is not Robinhood's
    if (texts.some((x) => RX.chainWho.test(x))) return out('affiliated', CHAIN_WHO, [srcOf('About', '/about#safe')]);
    if (texts.some((x) => (RX.affiliated.test(x) || RX.affiliated2.test(x) || RX.affiliated3.test(x) || RX.affiliated4.test(x) || RX.affiliated5.test(x)) && !/\brobin ?hood wallet\b/i.test(x))) return out('affiliated', AFFILIATED, [srcOf('About', '/about#safe'), srcOf('Terms', '/terms#s1')]);
    return null;
  }
  // "is it safe to join the gwc community", "is my gwc safe in metamask", "can I trust the price shown here": the site's own safety, for the pages
  const SAFE_SITE = /\bsafe to (?:use|join|scan|make|link|sign|connect|leave|store|keep|bridge|swap|post|share|click|open|enter|hold|disconnect)\b|\bis my \S+(?: call)? safe (?:in|after|if|on|from|when|with)\b|\b(?:safe|trust) (?:the|this) (?:\$?[a-z0-9]+ )?(?:price|prices|data|chart|figures|numbers|scanner|site|reading|page|readings)\b|\bsafe from (?:deletion|being deleted)\b|\b(?:site|page|scanner|swap|tracker|community|wall|call) (?:is )?safe\b/i;
  // the safety answer for the token named nearest the safety word ("whats the price of send and is gwc safe?" is about $GWC)
  function safetyFor(q, named) {
    const at = q.search(RX.safety), lq0 = lc(q), far = (x) => { const i = lq0.indexOf(lc(x.w)); return i < 0 ? 1e9 : Math.abs(i - at); };
    const tn = (named || []).slice().sort((a, b) => far(a) - far(b))[0], r = tn ? findToken(tn.w, chainIn(q)) : null, first = r && r.ok ? r.tokens[0] : null;
    const tok = first ? { symbol: first.symbol, href: ['robinhood', 'ethereum', 'solana'].includes(first.chain) ? scanHref(first.chain, first.address) : first.href } : tn ? { symbol: tn.w } : null;
    return out('safety', safety(tok), [srcOf('Scanner', (tok && tok.href) || '/newpairs')]);
  }
  const CHAIN_WHO = 'Robinhood Chain is the public network this site reads; who builds or runs it is for its own official pages to say, not this site. This site itself is independent — in the About page\'s words, “not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc.” (/about#safe).';
  const STANDING = 'I never give a figure beside a question of whether to buy, sell or hold, or of what a price will do — nothing here tells anyone to buy, sell or hold, and nobody can predict a price.';
  function neutralToken(w, chain, t) {
    const r = findToken(w, chain);
    if (!r.ok) return tokenAnswer(r, null, t, w);
    const f0 = r.tokens[0], name = sym(f0.symbol), scan = ['robinhood', 'ethereum', 'solana'].includes(f0.chain) ? scanHref(f0.chain, f0.address) : '/newpairs', mkt = f0.from === 'market' ? f0.href : marketHref(f0.chain || 'robinhood');
    return out('neutral', name + "'s readings — its price, market cap, liquidity and holders — are on the Scanner (" + scan + ') and on Market Data (' + mkt + '). Ask for one plainly — “what is ' + name + '\'s price?” — and I\'ll read it out. ' + STANDING, [srcOf('Scanner', scan), srcOf('Market Data', mkt)]);
  }
  function neutralMarket(chain) {
    const href = chain ? marketHref(chain) : '/market', where = chain ? (CHAIN_NAMES[chain] || chain) : 'every chain the site reads';
    return out('neutral', 'The figures for ' + where + ' — its top tokens, TVL, volume and fees — are on Market Data (' + href + '). Ask for one plainly — “top tokens on Base by volume”, “what is the TVL of Base?” — and I\'ll read it out; a list is never a tip. ' + STANDING, [srcOf('Market Data', href)]);
  }
  const SELF = "I can't see who is asking — I only read what is public, never an account. Your own Send Power, level and rank are on your dashboard (/profile) when you are signed in; to look yourself up here, ask with your name (@yourname).";

  async function answerBrain(q, page, history, followUp, raw) {
    const t = now();
    // the guard rails before anything else: before a follow-up is read, a name is looked up or a figure is fetched
    const guarded = guardOf(q, raw, history);
    if (guarded) return guarded;
    // "and my send power?", "what about mine?": the person asking, whom Sendy cannot see
    if (/\b(my|mine|myself)\b[^.?!]{0,20}\b(send power|points?|xp|score|level|lvl|rank|ranking|standing|place)\b|^\s*(and|what about|how about)\s+(me|mine|myself|my (send power|points|xp|score|level|rank))\s*[?!.]*\s*$|\bwhere (do|am) i (rank|stand|on the (leader)?board)\b|\bwhat (is|'s) my (rank|level|score|send power)\b/i.test(q) && !/\bhow (do|can|would) i\b/i.test(q))
      return out('self', SELF, [srcOf('Your dashboard', '/profile')]);
    // "and on Base?" — a follow-up is read as one before anything else, or "Base" alone would be a question about Base
    if (!followUp && /^\s*(and|what about|how about|also|same for|now do|(the )?same (thing|question|but|for|again))\b/i.test(q)) { const again = await followOn(q, page, history); if (again) return again; }
    // a question that asks for a figure ("what is the TVL of …") is a reading, whatever its first words
    const explaining = RX.explain.test(q) && !RX.nowWords.test(q) && !METRIC_RX.some(([, re]) => re.test(q)) && !CHAIN_METRIC_RX.some(([, re]) => re.test(q))
      && !/\bthe gas\b|\bgas (price|fees?|on|right now|now|today)\b|\bblock (number|height|time)\b/i.test(q);
    // a question names a handful of tokens at most: the rest of a long list is not read (each one is nine networks' lists)
    const named = tokenMentions(q).slice(0, 3), strongNamed = named.filter((x) => x.strong);
    if (/^\s*how (do|can|would) i\b/i.test(q)) q = q.replace(/\bape (in|into)\b/gi, 'buy');
    // "who made it?", "who is the dev?" about a token: the Scanner reads its contract; the site vouches for nobody
    const tp0 = topicOf(lastOf(history, 'assistant'));
    if (/\bwho (made|created|launched|deployed|owns|runs|is behind|built|started)\b|\bwho (is|are) the (devs?|developers?|team|creators?)\b/i.test(q) && (named.length || (tp0 && tp0.kind === 'token' && /\b(it|this|that|the token|the coin)\b/i.test(q)))) {
      const tn = named[0] ? named[0].w : tp0.sym, r = findToken(tn, null), first = r.ok ? r.tokens[0] : null;
      const href = first && ['robinhood', 'ethereum', 'solana'].includes(first.chain) ? scanHref(first.chain, first.address) : (first && first.href) || '/newpairs';
      return out('dev', 'Who is behind ' + sym(first ? first.symbol : tn) + ' is not something this site can say or vouch for. The Scanner reads its contract from the chain — who created it, what powers its owner keeps, who holds it — at ' + href + '. It is a reading, not an audit.', [srcOf('Scanner', href)]);
    }
    if (RX.whoRuns.test(q) && !/\b(most|top|highest|best|first|winning)\b/i.test(q)) return out('who', WHO, [srcOf('Terms', '/terms#s1'), srcOf('Support board', '/support')]);
    if (RX.hello.test(q)) return out('hello', "Hey! I'm Sendy 🚀 Ask me about prices and market caps, the top tokens on a chain, the leaderboard, communities, the competitions — or how anything on this site works.");
    if (RX.thanks.test(q)) return out('thanks', 'Any time! Anything else, just ask. 🚀');
    if (RX.whoami.test(q)) return out('whoami', "I'm Sendy, the site's rocket helper — a program, not a person. I answer from the site's own pages and its live public data, and I can't see or change anyone's account. For a person: the Support board (/support) or " + EMAIL + '.');

    // a member, by @name (or "alice's Send Power", "zqbob xp?") — two or three of them side by side, or the one just ahead
    const people = membersIn(q);
    if (people.length) {
      const got = [];
      for (const p of people.slice(0, 3)) { const r = member(p.name); if (r.ok && !got.some((x) => x.member.username === r.member.username)) got.push(r); }
      if (got.length) {
        let a = got.map((r) => { const m = r.member; return '@' + m.username + ': about ' + count(m.points) + ' Send Power, level ' + m.level + (m.title ? ' (' + m.title + ')' : '') + (m.rank ? ', #' + m.rank + ' on the all-time board' : '') + '; joined ' + day(m.joined)
          + '; ' + plural(m.posts, 'public post') + ', ' + plural(m.followers, 'follower') + (m.og ? '; an OG badge' : '') + " (this site's records, read just now). Their Send Wall: /u/" + encodeURIComponent(m.username) + '.'; }).join('\n\n');
        if (got.length >= 2) a += '\n\n' + compareLine(got.map((r) => ({ name: '@' + r.member.username, f: F(r.member.points, 'site', r.at) })), 'Send Power', 'count').trim();
        else {
          const m = got[0].member, up = /\b(ahead of|above|beat(s|ing)?|higher than|in front of|before)\b/i.test(q), down = /\b(behind|below|under|after|lower than)\b/i.test(q);
          if ((up || down) && m.rank) {
            const want = up ? m.rank - 1 : m.rank + 1, lb = want >= 1 && want <= 50 ? leaderboard(Math.min(50, want)) : null, n = lb && lb.ok ? lb.rows.find((u) => u.rank === want) : null;
            a += up && m.rank === 1 ? ' Nobody is ahead of them: they are #1 on the all-time board.' : n ? ' Just ' + (up ? 'ahead of' : 'behind') + ' them: #' + n.rank + ' @' + n.username + ' — about ' + count(n.sendPower) + ' Send Power.' : '';
          }
        }
        return out('member', a, got.map((r) => srcOf('@' + r.member.username + "'s Send Wall", r.href, r.at)));
      }
      const sure = people.find((p) => p.sure);
      if (sure) { const l0 = lc(sure.name), near = nearest(sure.name, [...names().users.keys()].filter((u) => u[0] === l0[0] && Math.abs(u.length - l0.length) <= 2)); return out('member', "I couldn't find a member called @" + clip(sure.name, 40) + ' — names are on the leaderboard (/arcade) and on every Send Wall.' + (near ? ' Did you mean @' + names().users.get(near) + '?' : ''), [srcOf('Arcade', '/arcade')]); }
    }
    const weekly = RX.weekly.test(q);   // "who is top this week" is the week's race, not the all-time board
    // a market figure only where no word of a decision, an opinion or a price to come is left in the message (figuresOk)
    const figs = !figureBan && figuresOk(q, raw, typedNow);
    const aboutMarket = /\b(block ?chains?|chains?|networks?|tokens?|coins?|pairs?|pools?)\b/i.test(q);
    if (RX.leaderboard.test(q) && !explaining && !weekly && !aboutMarket) {
      const n = Math.min(10, Number((/\btop (\d{1,2})\b/i.exec(q) || [])[1]) || 5), r = leaderboard(n);
      if (!r.ok) return out('leaderboard', 'The leaderboard is empty so far: ' + r.why + '.', [srcOf('Arcade', '/arcade')]);
      return out('leaderboard', "The all-time leaderboard (Send Power, this site's records, read just now): " + r.rows.map((u) => '#' + u.rank + ' @' + u.username + ' — about ' + count(u.sendPower) + ', level ' + u.level).join('; ') + '. The boards are on /arcade; how Send Power works is on /about.', [srcOf('Arcade', '/arcade', r.at)]);
    }
    // the competitions as they stand: asked who, how, when it ends, or just named ("the arcade?") — a question about a rule is for the pages
    // (Rocket Run's top is a rule of the game, for the pages: CONCEPTS)
    if ((RX.competitions.test(q) || (RX.leaderboard.test(q) && weekly)) && !(ROCKET.test(q) && TOP.test(q) && !/\b(today|this week|winning|best|leaders?)\b/i.test(q)) && (!explaining || /\b(prizes?|winners?|win)\b/i.test(q)) && (RX.nowWords.test(q) || terms(q).length <= 2 || weekly)) {
      const r = competitions();
      if (!r.ok) return out('competitions', 'I could not read the Arcade just now — it is all on /arcade.', [srcOf('Arcade', '/arcade')]);
      const b = r.biggestSender, rr = r.rocketRun;
      let a = "This week's Biggest Sender race" + (b.endsAt ? ' ends ' + new Date(b.endsAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '') + ': '
        + (b.top.length ? b.top.slice(0, 3).map((x) => '#' + x.rank + ' @' + x.username + ' (about ' + count(x.sendPower) + ' Send Power)').join(', ') + ' — ' + count(b.entrants || 0) + ' in the race' : 'nobody has scored yet this week') + '.';
      if (b.prize && b.prize.ladder && b.prize.ladder.length) a += ' The top ' + b.prize.winners + ' win a Send Power boost for the week after (' + b.prize.ladder[0] + '× for first).';
      if (b.lastWeek && b.lastWeek.winners.length) a += " Last week's winner: @" + b.lastWeek.winners[0].username + '.';
      a += " Today's Rocket Run: " + plural(rr.flightsToday || 0, 'flight') + (rr.bestXToday != null ? ', best cash-out ' + rr.bestXToday + '×' : '') + ". (This site's records, read just now.) Everything is on /arcade.";
      return out('competitions', a, [srcOf('Arcade', '/arcade', r.at)]);
    }
    if (RX.counts.test(q) && !(/\bcommunit/i.test(q) && /\blive\b/i.test(q))) {
      const c = READ.counts();
      return out('counts', 'Right now the site has ' + plural(c.members, 'member') + ', ' + plural(c.calls, 'public Send Call') + ', ' + plural(c.posts, 'public post') + ', ' + plural(c.support, 'Support question') + ', ' + count(c.liveCommunities) + ' live communit' + (c.liveCommunities === 1 ? 'y' : 'ies')
        + ' (' + count(c.pendingCommunities) + ' still gathering members) and ' + plural(c.squads, 'Send Squad') + " (this site's records, read just now).", [srcOf('Communities', '/communities', t)]);
    }
    if (RX.squads.test(q) && (!explaining || /\bhow many\b/i.test(q)) && !/\bhow (do|can|to|would)\b|\b(join|make|start|create)\b/i.test(q)) {
      const c = READ.counts();
      return out('squads', 'There ' + (c.squads === 1 ? 'is ' : 'are ') + plural(c.squads, 'Send Squad') + " right now (this site's records, read just now). A squad is a private, token-gated group, so its name, members and calls are for its members — sign in on /communities to browse them.", [srcOf('Communities', '/communities', t)]);
    }
    // "is $SEND safe?", "is GWC a rug?": never figures, only the Scanner and what it is not
    if (RX.safety.test(q) && !SAFE_SITE.test(q) && (named.length || (!explaining && /\b(tokens?|coins?|memecoins?|contracts?|pairs?|pools?)\b/i.test(q)))) return safetyFor(q, named);
    const commSym = (/\$?([A-Za-z0-9]{2,12})\s+(?:community|group|club)\b/i.exec(q) || [])[1];
    if (commSym && !/^(the|a|an|this|my|your|which|what|any|every|each|own|live|holders|only|sandbox|token|private|public|telegram|discord|whatsapp|squad)$/i.test(commSym)) {
      const r = communities(commSym);
      if (r.ok) { const c = r.communities[0]; return out('community', sym(c.symbol) + (c.name ? ' ' + c.name : '') + ' is a ' + c.status + ' community' + (c.official ? ' run by the site' : '') + (c.sandbox ? ' — the open sandbox, for trying the site out, not affiliated with Robinhood Markets —' : '') + ' with ' + plural(c.verifiedMembers, 'verified member') + " (this site's records, read just now). It is at " + c.href + '.', [srcOf(sym(c.symbol) + ' community', c.href, r.at)]); }
    }
    if (RX.communitiesList.test(q) && !explaining) {
      const r = communities(null), live = r.live || [];
      const a = (live.length ? plural(live.length, 'community is', 'communities are') + ' live: ' + live.slice(0, 6).map((c) => sym(c.symbol) + (c.name ? ' ' + c.name : '') + (c.official ? ' (official)' : '') + (c.sandbox ? ' (the open sandbox, for trying the site out — not affiliated with Robinhood Markets)' : '') + ' — ' + count(c.verifiedMembers) + ' verified').join('; ') + '.' : 'No community is live yet.')
        + (r.pending ? ' ' + count(r.pending) + ' more ' + (r.pending === 1 ? 'is' : 'are') + ' still gathering their first members.' : '') + " (This site's records, read just now.) Browse and join them on /communities.";
      return out('communities', a, [srcOf('Communities', '/communities', r.at)]);
    }
    if (RX.scans.test(q)) {
      const r = recentScans();
      if (!r.ok) return out('scans', 'Nobody has scanned a token here recently. Scan one on /newpairs.', [srcOf('Scanner', '/newpairs')]);
      return out('scans', 'Recently scanned on the Scanner: ' + r.scans.slice(0, 8).map((s) => sym(s.symbol) + (s.count > 1 ? ' (×' + count(s.count) + ')' : '')).join(', ') + " — this site's records (which tokens, never who). Open any of them on /newpairs.", [srcOf('Scanner', '/newpairs', r.at)]);
    }
    const chain = chainIn(q);
    if (figs && RX.pulse.test(q) && !explaining && (!chain || chain === 'robinhood') && !strongNamed.length) {
      const r = pulse();
      if (!r.ok) return out('pulse', "I have no reading of Robinhood Chain's pulse yet: " + r.why + '. It will be on /market?chain=robinhood.', [srcOf('Market Data', '/market?chain=robinhood')]);
      const pc = r.poolsCreated24h;
      let a = 'Robinhood Chain right now: ' + said([{ label: 'block', f: r.block, kind: 'count' }, { label: 'gas', f: r.gasGwei, kind: 'gwei' }, { label: 'a block every', f: r.blockTimeMs, kind: 'ms' }], t) + '.';
      a += pc.v === null ? ' Pools created in the last 24 hours: unknown (' + pc.why + ').' : ' Pools created in the last 24 hours: ' + count(pc.total) + ' (' + pc.v2 + ' v2, ' + pc.v3 + ' v3, ' + pc.v4 + ' v4).';
      a += ' ' + said([{ label: 'The canonical bridge holds', f: r.bridgeEth, kind: 'eth' }], t) + ' on Ethereum. More on /market?chain=robinhood.';
      return out('pulse', a, [srcOf('Market Data · the chain itself', r.href, r.at)]);
    }
    if (figs && RX.newPools.test(q) && !explaining && !strongNamed.length) {
      const k = chain || 'robinhood', r = newPools(k, 5);
      if (k === 'robinhood' && r.radar.length) return out('newPools', "The New Pairs radar's newest named pairs on Robinhood Chain: " + r.radar.slice(0, 5).map((x) => sym(x.symbol) + ' — liquidity ' + val(x.liquidity) + (x.createdAt ? ', created ' + ago(x.createdAt, t) : '')).join('; ') + " (the radar's reading, read " + ago(r.radar[0].at, t) + '). New is not the same as safe: open one on /newpairs and read it first.', [srcOf('New Pairs radar', '/newpairs', r.radar[0].at)]);
      if (r.pools.length) return out('newPools', 'The newest pools on ' + (CHAIN_NAMES[k] || k) + ' (' + (r.src === 'rpc' ? 'read from the chain itself' : 'GeckoTerminal') + '): ' + r.pools.slice(0, 5).map((x) => (x.name || (x.baseSymbol ? sym(x.baseSymbol) : (x.dex || 'a') + ' pool')) + (x.createdAt ? ', ' + ago(x.createdAt, t) : x.block ? ' at block ' + count(x.block) : '')).join('; ') + '. More on ' + r.href + '.', [srcOf('Market Data · new pools', r.href, r.pools[0].createdAt)]);
      return out('newPools', 'No new pools have been read for ' + (CHAIN_NAMES[k] || k) + ' yet. The radar is on /newpairs.', [srcOf('Scanner', '/newpairs')]);
    }
    if (figs && RX.topChains.test(q) && !/^\s*(how|why)\b/i.test(q) && !strongNamed.length && !RX.topTokens.test(q)) {
      const metric = (CHAIN_METRIC_RX.find(([, re]) => re.test(q)) || ['tvl'])[0];
      const sort = { tvl: 'tvl', volume24h: 'volume', fees24h: 'fees', stables: 'stables', liquidity: 'liquidity', mcap: 'mcap', tvs: 'tvs' }[metric] || 'tvl';
      const r = marketChains(sort, chainWinIn(q), 5);
      if (!r.ok) return out('topChains', 'I have no chain figures yet: ' + r.why + '. They will be on /market.', [srcOf('Market Data', '/market')]);
      const label = { tvl: 'DeFi TVL', volume: 'DEX volume (' + (r.window || 'last 24 hours') + ')', fees: 'gas fees (' + (r.window || 'last 24 hours') + ')', stables: 'stablecoins', liquidity: 'DEX liquidity', mcap: 'own-token market cap', tvs: "L2BEAT's value secured" }[sort];
      const f0 = r.rows[0] && r.rows[0][sort], at = (f0 && f0.at) || r.at;
      return out('topChains', 'Top chains by ' + label + ' (' + srcName((f0 && f0.src) || 'defillama') + ' via Market Data, read ' + ago(at, t) + '): ' + r.rows.map((c, i) => (i + 1) + '. ' + c.name + ' — ' + val(c[sort])).join('; ') + '. Every chain is on /market.', [srcOf('Market Data · chains', '/market', at)]);
    }
    if (figs && RX.topTokens.test(q) && !/^\s*(how|why)\b/i.test(q) && !strongNamed.length) {
      const every = allChains(q), k = every ? 'all' : (chain || 'robinhood');
      const sort = /market ?cap|mcap/i.test(q) ? 'mcap' : /liquidity|deepest/i.test(q) ? 'liquidity' : /\bfdv\b/i.test(q) ? 'fdv' : /\bvolume\b|\btraded\b/i.test(q) ? 'volume' : /gainers?|pumping|movers?|losers?|dumping|biggest (moves|change)|perform(ers?|ing|ance)|tanking|crashing|mooning|popping|(up|down) the most|\bdrops?\b|\bdumps\b/i.test(q) ? 'change' : 'volume';
      const dir = /\blosers?\b|\bdumping\b|\blowest\b|\bsmallest\b|\bworst\b|\bbottom\b|\btanking\b|\bcrashing\b|\bdown the most\b|\bdrops?\b|\bdumps\b/i.test(q) ? 'asc' : 'desc';
      const ans = listTokensAnswer(marketTokens(k, sort, dir, winIn(q), 5), every ? 'every chain the site reads' : CHAIN_NAMES[k] || k, t);
      if (/trending|\bhot\b|hottest/i.test(q) && ans.answer.startsWith('Top tokens')) {
        const sc = recentScans();
        ans.answer = 'There is no "trending" score here; the most-traded are the nearest thing. ' + ans.answer + (sc.ok ? ' What people scanned here lately: ' + sc.scans.slice(0, 5).map((s) => sym(s.symbol)).join(', ') + '.' : '');
      }
      return ans;
    }
    // a token by name: its figures, from what the site has read — when the question asks for a figure, or is about the token itself
    // (its tax is not a reading: the pages say what the site's own coins charge, so that question goes to them)
    // (two or three named: each one's reading, and which is the larger where that was asked)
    // ("what is X" / "tell me about X" is X itself only when it asks nothing else: "what is the story behind gwc" is for the pages)
    const onlyToken = terms(q).filter((x) => !named.some((n) => stem(lc(n.w)) === x || lc(n.w) === x)).length <= 1;
    const howTo = /^\s*(how (do|can|would|should) (i|you|we|one)|where (do|can|should) (i|you)|how to|can (i|you|we)|could (i|you)|is (it|there) (possible|a way))\b/i.test(q) && !/\bhow (much|many|high|big|deep)\b/i.test(q);
    const aboutSite = SITE_SUBJECT.test(q.replace(/\$?\b(?:send|gwc)\b/gi, ' ')) || /\b(dexscreener|coingecko|geckoterminal|listed|listing|trade it|trade)\b/i.test(q);
    if (figs && named.length && !howTo && !/\btax(es|ed)?\b|\bdifferen(ce|t)\b|\bdiffer\b/i.test(q) && (METRIC_RX.some(([, re]) => re.test(q)) || (RX.tokenInfo.test(q) && onlyToken) || (terms(q).length <= 2 && !aboutSite && !/^\s*(how|where|why|can|could|does|do|is|will)\b/i.test(q)) || (named.length >= 2 && COMPARING.test(q)))) {
      const metric = (METRIC_RX.find(([, re]) => re.test(q)) || [null])[0] || (/\b(bigger|smaller|larger)\b/i.test(q) ? 'mcap' : /\bdeeper\b/i.test(q) ? 'liquidity' : null);
      const got = [], missed = [];
      for (const tn of named) {
        const r = findToken(tn.w, chain);
        if (r.ok) { const f0 = r.tokens[0]; if (!got.some((x) => x.r.tokens[0].address === f0.address && x.r.tokens[0].chain === f0.chain)) got.push({ tn, r }); }
        else if (tn.strong) missed.push({ tn, r });
      }
      const also = METRIC_RX.filter(([k, re]) => k !== metric && re.test(q)).map(([k]) => k);
      if (got.length === 1 && !missed.length) return tokenAnswer(got[0].r, metric, t, null, also);
      if (got.length) {
        const outs = got.map((x) => tokenAnswer(x.r, metric, t, null, also)).concat(missed.map((x) => tokenAnswer(x.r, metric, t, x.tn.w)));
        const m0 = metric || 'mcap', key = { priceUsd: ['priceUsd'], mcap: ['mcap'], fdv: ['fdv'], liquidity: ['liquidity'], volume: ['volume', 'volume24h'], change: ['change', 'change24h'], holders: ['holders'] }[m0];
        const label = { priceUsd: 'price', mcap: 'market cap', fdv: 'FDV', liquidity: 'liquidity', volume: '24 h volume', change: '24 h change', holders: 'holder count' }[m0];
        const cmp = got.length >= 2 && (COMPARING.test(q) || metric) ? compareLine(got.map((x) => { const f0 = x.r.tokens[0]; return { name: sym(f0.symbol), f: f0[key.find((k) => isFig(f0[k])) || key[0]] }; }), label, m0 === 'holders' ? 'count' : m0 === 'change' ? 'pct' : 'usd', m0 === 'priceUsd' || m0 === 'change') : '';
        return joinAnswers('token', outs, cmp ? '\n\n' + cmp.trim() : '');
      }
      if (missed.length) return tokenAnswer(missed[0].r, metric, t, missed[0].tn.w);
    }
    // a chain by name, with a figure asked for (or just the chain)
    // (two or three named — "base vs robinhood chain tvl" — each one's figures, and which is the larger)
    const chains = chain ? chainsIn(q) : [];
    if (figs && named.length && chains.length >= 2 && !RX.chainMetric.test(q)) { const r = findToken(named[0].w, null); if (r.ok || named[0].strong) return tokenAnswer(r, null, t, named[0].w); }
    if (figs && chain && !explaining && (RX.chainMetric.test(q) || /^\s*(tell me about|what about|how is|how's|and)\b/i.test(q) || terms(q).length <= 2 || (chains.length >= 2 && COMPARING.test(q)))) {
      const metric = (CHAIN_METRIC_RX.find(([, re]) => re.test(q)) || [null])[0];
      if (chains.length < 2 || !RX.chainMetric.test(q) && !/\b(vs\.?|versus|compare)\b/i.test(q)) return chainAnswer(marketChain(chain), metric, t);
      const rs = chains.slice(0, 3).map((k) => marketChain(k)), key = metric || 'tvl';
      const label = { tvl: 'DeFi TVL', tvs: "L2BEAT's value secured", stables: 'stablecoins', fees24h: 'gas fees (24 h)', volume24h: 'DEX volume (24 h)', liquidity: 'DEX liquidity', txcount24h: 'transactions (last whole day)', daa: 'active addresses (last whole day)', mcap: "own token's market cap", oi: 'open interest' }[key];
      const ok = rs.filter((r) => r.ok), cmp = ok.length >= 2 ? compareLine(ok.map((r) => ({ name: r.name, f: r.stats[key] })), label, key === 'txcount24h' || key === 'daa' ? 'count' : 'usd') : '';
      return joinAnswers('chain', rs.map((r) => chainAnswer(r, metric, t)), cmp ? '\n\n' + cmp.trim() : '');
    }
    /* No market figure for this message (figureOnly): a question about a token, a list or a chain that is not a plain one gets where
       to read it, and — said every time — that nothing here says whether to buy, sell or hold; a question about the site that names
       a token ("does selling send reset my diamond hands?") goes on to the pages. */
    if (!figs) {
      const lq1 = q.replace(/\$?\b(?:send|gwc)\b/gi, ' ').replace(/\b(?:at|from) (?:these|those|this|current|today's) (?:levels?|prices?)\b/gi, ' ');
      // (a rule of the site's — "how much send should i hold to post on the wall", "does the radar predict pumps" — is for the pages)
      const siteRule = /\b(?:to|for)\s+(?:post|posting|get|join|qualify|unlock|earn|enter|make|become|use|the|og|holder|community|diamond)\b/i.test(q) && /\bhow (?:much|many)\b|\bneed\b|\benough\b/i.test(q)
        || /^\s*(?:does|do|did|can|could|will|would|is|are)\s+(?:the|your|this|a|an)\s+(?:radar|scanner|tracker|wallet tracker|site|website|market data|sendy|page|app|guide|arcade|leaderboard|swap|bridge|chart)\b/i.test(q);
      const hunch = RISK.test(stripSite(q)) && !SITE_SUBJECT.test(lq1) && !siteRule;
      const tn = named.find((x) => x.strong || x.known) || (hunch ? tokenMentions(q, true).find((x) => x.strong || x.known) : null);
      // ("is it time?", "is that low?" after a token's answer: that token)
      const tp = !tn && hunch && tokenCtx(q, history) ? topicOf(lastOf(history, 'assistant')) : null;
      if (tp && (tp.kind === 'token' || tp.kind === 'community') && tp.sym) return neutralToken(tp.sym, chain || null, t);
      if (tp && tp.kind === 'tokens') return neutralMarket(chain);
      if (tn && !howTo && !siteRule && (hunch || (METRIC_RX.some(([, re]) => re.test(q)) && !SITE_SUBJECT.test(lq1)) || (RX.tokenInfo.test(q) && !SITE_SUBJECT.test(lq1)) || (terms(q).length <= 2 && !SITE_SUBJECT.test(lq1) && !aboutSite))) return neutralToken(tn.w, chain, t);
      if (!tn && !howTo && !siteRule && (RX.topTokens.test(q) || RX.topChains.test(q) || (chain && (RX.chainMetric.test(q) || terms(q).length <= 2)) || RX.newPools.test(q) || (RX.pulse.test(q) && hunch))) return neutralMarket(chain);
    }
    // a short question that names nothing the brain recognised may still continue the one before it — a fragment ("volume?"),
    // a pointer ("and that?"), a follow-up's own lead; never a whole question of its own ("is it safe to connect my wallet?")
    const dummyIt = /\bit(?:'s| is)?\s+(?:possible|ok|okay|safe|free|hard|easy|normal|true|necessary|required|allowed)\s+to\b/i.test(q);
    // (a question that names its own token — "does $SEND have a community?" — is whole, not a piece of the one before)
    const ownQuestion = /^\s*(?:can|could|does|do|is|are|will|would|where|how|what|why|when|who|which)\b/i.test(q) && !pointsAlone(q);   // "can I make a call on it?" is a question of its own
    if (!followUp && !dummyIt && !strongNamed.length && (FOLLOW_LEAD.test(q) || (terms(q).length <= 2 && !ownQuestion) || pointsAlone(q))) { const again = await followOn(q, page, history); if (again) return again; }
    return passageAnswer(q, page, t, lastOf(history, 'user'));
  }

  /* A few facts asked so many ways that the question's words rarely meet the page's: each is answered with the one sentence
     of the site that states it, found by its own words (PIN) and quoted as written — never a sentence that only shares
     words with the question (Rocket Run's top is the explosion point's cap, 50×; what a cash-out can win is the boost's, 5× —
     two caps, two sentences). A sentence the pages no longer hold is not pinned: the search answers as it always has. */
  const ROCKET = /\brocket\b|\barcade\b|\bthat game\b|\bthe game\b/i, TOP = /\b(max(imum)?|limit|cap|capped|highest|how (high|far|big)|the most|at the latest|go (past|over|beyond|above)|top out|upper|ceiling)\b/i;
  const CONCEPTS = [
    [(q) => ROCKET.test(q) && TOP.test(q) && /\b(boost|bonus|win|earn|reward|get for|cash(ing)? out)\b/i.test(q), /Cashing out of Rocket Run gives a bonus of up to/],
    [(q) => ROCKET.test(q) && TOP.test(q) && !/\b(boost|bonus|win|earn|reward)\b/i.test(q), /explosion point is capped at/],
    [(q) => /\b(on record|publicly|prove|show (people|everyone|the world)|i was early|got in early|called it|first to)\b/i.test(q) && /\b(coin|token|holding|bought|early)\b/i.test(q), /^A Send Call is a public, permanent scorecard/],
    [(q) => /\b(get|put|move|transfer|load)\s+(the |my |some )?(coins?|tokens?|send|gwc)\s+(onto|into|on|in)\s+(it|my wallet|the wallet|there)\b/i.test(q), /^The How to Buy guide \(\/guide\) walks through it/],
    [(q) => /\b(follow|watch|track|monitor|spy on|keep an eye on)\b[^.?!]{0,30}\bwallets?\b|\bwallet'?s? (transactions|activity|history|holdings)\b/i.test(q) && !/\b(connect|link|sign)\b/i.test(q), /^The wallet tracker \(\/tracker\)/],
  ];
  // the passage of the site's own words holding a sentence, and that sentence (a note is quoted whole) — read once per version
  const pinMemo = new Map(), PIN_KIND = { note: 0, page: 1, whitepaper: 2, readme: 3, map: 4, terms: 5 };
  function pin(re) {
    const m = pinMemo.get(re.source);
    if (m && m.v === index.version()) return m.pin;
    let best = null;
    for (const id of index.ids()) {
      const d = index.get(id); if (!d || !DOC_KINDS.includes(d.kind) || (best && PIN_KIND[d.kind] >= PIN_KIND[best.doc.kind])) continue;
      const ss = (String(d.text).match(/[^.!?]+[.!?]*/g) || []).map((x) => x.trim()), i = ss.findIndex((x) => re.test(x) || (d.title && re.test(x.slice(d.title.length).trim())));
      if (i >= 0) { const s0 = d.title && ss[i].startsWith(d.title) ? ss[i].slice(d.title.length).replace(/^[\s:—–-]+/, '') : ss[i]; best = { doc: d, ex: clip(s0 + (s0.length < 160 && ss[i + 1] ? ' ' + ss[i + 1] : ''), 420) }; }
    }
    pinMemo.set(re.source, { v: index.version(), pin: best });
    return best;
  }
  // the best passages of the index, quoted — or, when nothing is relevant, the hand-over to a person
  function passageAnswer(q, page, t, before) {
    const ctx = before && terms(q).length <= 4 ? q + ' ' + before : q;   // a short question carries the one before it, for its topic
    const pinned = (() => { for (const [is, re] of CONCEPTS) if (is(ctx)) { const p = pin(re); if (p) return p; } return null; })();
    void t;
    const how = RX.explain.test(q) || /^\s*where\b/i.test(q);
    // "what are people saying about …" is a question about the walls: there the posts come first, and the asking words
    // ("people", "saying") are not part of what is asked about — the topic alone has to be found
    const social = /\b(people|someone|anyone|everyone|folks|members?|senders?)\b.{0,24}\b(say|says|said|saying|post(ed|ing)?|talk(ed|ing)?|think|wrote|writing)\b|\bon the (send )?wall\b/i.test(q);
    let qt = social ? queryTerms(q).filter((g) => !SOCIAL_WORDS.has(g[0])) : queryTerms(q);
    if (qt.length > 1 && tokenMentions(q, true).some((x) => x.strong || x.known)) { const k = qt.filter((g) => g[0] !== 'coin' && g[0] !== 'token'); if (k.length) qt = k; }
    if (!qt.length) return out('handover', HAND_OVER, [srcOf('Support board', '/support')], { miss: true });
    // how much of the question a passage must cover to count: that share of its words, and at least half that share of their
    // weight by rarity — a passage that shares only the common words around a rare one is not about what was asked
    const need = qt.length <= 2 ? 1 : qt.length <= 4 ? 0.5 : 0.4;
    const hits = index.search(qt, { limit: 14, weight: (d) => kindWeight(d) * ((d.kind === 'post' || d.kind === 'call') ? (social ? 2.5 : how ? 0.5 : 1) : 1) * (page && d.href && d.href.split(/[?#]/)[0] === page ? 1.15 : 1) });
    const good = pinned ? [pinned.doc] : [];
    for (const h of pinned ? [] : hits) {
      if (h.cover < need || h.weight < need / 2 || h.score < 2.2) continue;
      const d = stillPublic(h.doc); if (!d || shills(d)) continue;
      good.push(d);
      if (good.length >= 3) break;
    }
    if (!good.length) return out('handover', HAND_OVER, [srcOf('Support board', '/support')], { miss: true });
    const best = good[0], where = best.href || mapFor(qt);
    let a;
    if (best.kind === 'note') a = best.text;
    else if (best.kind === 'map') a = "That's " + best.href + ' — ' + best.text.replace(/\.$/, '') + '.';
    else if (best.kind === 'support') a = best.answers.length
      ? 'This came up on the Support board: someone asked “' + clip(best.question, 200) + '”, and the answer was “' + clip(best.answers[0].text, 400) + '” (@' + best.answers[0].by + ', ' + day(best.answers[0].at) + '). The thread is at ' + best.href + '.'
      : best.held ? 'Someone asked that on the Support board — “' + clip(best.question, 200) + '”. The thread is at ' + best.href + '.'   // its answers are not ones Sendy repeats
        : 'Someone asked that on the Support board — “' + clip(best.question, 200) + '” — and it has no answer yet. You can add one, or follow it, at ' + best.href + '.';
    else if (best.kind === 'rated') a = 'Readers rated this earlier answer helpful (' + day(best.at) + '): “' + clip(best.answer, 700) + '”';
    else if (best.kind === 'community') a = best.text + ' It is at ' + best.href + '.';
    else if (best.kind === 'terms') a = 'That is covered by the Terms of Service, section “' + best.title.replace(/^Terms of Service — /, '') + '”: ' + best.href + '. I point to the section rather than paraphrase it.';
    else if (best.kind === 'call') a = best.text + ' The call is at ' + best.href + '.';
    else a = (best.kind === 'post' ? best.title + ' wrote:' : best.kind === 'whitepaper' ? 'The white paper' + (best.title && best.title !== 'The white paper' ? ' (“' + clip(best.title, 80) + '”)' : '') + ' says:' : best.kind === 'readme' ? 'The site\'s guide (“' + clip(best.title, 80) + '”) says:' : 'From ' + (where || 'the site') + (best.title ? ' (“' + clip(best.title, 80) + '”)' : '') + ':')
      + ' “' + (pinned ? pinned.ex : excerpt(best.text, qt, best.title)) + '”' + (where ? ' More on ' + where + '.' : '');
    const also = good.slice(1).find((d) => d.href && d.href !== best.href && d.kind !== 'post' && d.kind !== 'call');
    if (also && best.kind !== 'note' && !pinned) a += ' See also ' + also.href + '.';
    // the sources are the passages the answer used: the one quoted, the page it points to, the one it adds
    const used = [best.href ? best : null, !best.href && where ? { kind: 'map', href: where } : null, also && best.kind !== 'note' ? also : null].filter(Boolean);
    // reusable once rated only when every passage it quotes or adds is the site's own words (see migrate)
    const reuse = [best].concat(also && best.kind !== 'note' ? [also] : []).every((d) => DOC_KINDS.includes(d.kind));
    return out('passage', a, used.map((d) => srcOf(labelOf(d), d.href, d.at)), { kinds: good.map((d) => d.kind), reuse, pinned: !!pinned });
  }
  const SOCIAL_WORDS = new Set(['people', 'someone', 'anyone', 'everyone', 'folk', 'member', 'sender', 'say', 'said', 'post', 'talk', 'think', 'wrote', 'writ', 'wall'].map(stem));
  // the index holds no member's words that push a trade (postDoc, supportDoc); this checks a passage again as it is quoted
  const shills = (d) => (d.kind === 'post' || d.kind === 'call') ? pushes(d.text) : d.kind === 'support' ? pushes(d.question) || d.answers.some((x) => pushes(x.text)) : false;
  const labelOf = (d) => ({ support: 'Support board', post: 'Send Wall', call: 'Send Call', whitepaper: 'White paper', terms: 'Terms', community: 'Communities', map: 'Site map', note: "Sendy's notes", rated: 'Rated answer' }[d.kind] || 'The page ' + String(d.href || '').split(/[?#]/)[0]);
  // the page a question is about, from the site map, for a passage that has no page of its own
  function mapFor(qt) { const h = index.search(qt, { kinds: ['map'], limit: 1 })[0]; return h && h.cover > 0 ? h.doc.href : null; }
  // the sentences of a passage that answer most of the question, quoted as they are written
  function excerpt(text, qt, title) {
    // a section's text starts with its heading, which the answer has just named: quoted once, not twice
    let body = String(text).trim();
    if (title && body.length > title.length + 20 && body.startsWith(title)) body = body.slice(title.length).replace(/^[\s:—–-]+/, '');
    const ss = body.match(/[^.!?]+[.!?]*/g) || [body];
    // when the heading names everything asked about, the section is the answer: its opening, not the line that repeats the words
    const named = title && body !== String(text).trim() && qt.every((g) => covers(new Set(terms(title)), g));
    let bi = 0, bs = named ? Infinity : -1;
    ss.forEach((s, i) => { const ts = new Set(terms(s)); const sc = qt.filter((g) => covers(ts, g)).length; if (sc > bs) { bs = sc; bi = i; } });
    let ex = ss[bi].trim();
    if (ex.length < 160 && ss[bi + 1]) ex += ' ' + ss[bi + 1].trim();
    return clip(ex, 420);
  }

  /* ===== THE ANSWERS WITH A MODEL: Claude through Anthropic's SDK, with the same tools ============================== */
  // the turns as the model wants them: alternating, starting and ending with the person, the page said once
  function turns(q, page, history) {
    const msgs = [];
    for (const m of history || []) { if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1].content += '\n' + m.content; else msgs.push({ role: m.role, content: m.content }); }
    if (msgs.length && msgs[0].role === 'assistant') msgs.shift();
    if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs[msgs.length - 1].content += '\n' + q; else msgs.push({ role: 'user', content: q });
    msgs[msgs.length - 1].content = '[The person is on the page ' + page + ']\n' + msgs[msgs.length - 1].content;
    return msgs;
  }
  async function askModel({ q, page, history, system }) {
    const ctx = { q, page, missed: false, sources: [], own: true };   // own: no tool brought anything but the site's own words
    const msgs = turns(q, page, history);
    const t0 = Date.now(), ac = new AbortController(), timer = setTimeout(() => ac.abort(), DEADLINE_MS);
    try {
      for (let round = 0; round < MODEL_ROUNDS; round++) {
        const left = DEADLINE_MS - (Date.now() - t0);
        if (left < 500) return { error: 'timeout' };
        const r = await ai.beta.messages.create({
          model: MODEL, max_tokens: 4096,
          ...(FALLBACK_MODELS.has(MODEL) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
          output_config: { effort: 'low' },
          system, tools: TOOL_DEFS, messages: msgs,
        }, { signal: ac.signal, timeout: left });
        // a refusal first: its content may be empty or cut off, and is never read
        if (r.stop_reason === 'refusal') { if (!ctx.missed) miss(q, page, 'model'); return { refused: true }; }
        if (r.stop_reason === 'pause_turn') { msgs.push({ role: 'assistant', content: r.content }); continue; }
        const uses = (r.content || []).filter((b) => b.type === 'tool_use');
        if (r.stop_reason === 'tool_use' && uses.length) {
          msgs.push({ role: 'assistant', content: r.content });
          // every tool of the turn, and all of their answers back in one message (a failed one says so, never dropped)
          const results = uses.map((u) => {
            let input = u.input;
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
            const res = runTool(u.name, input, ctx);
            if (res && !res.error) for (const s of sourcesOfTool(res)) ctx.sources.push(s);
            if (u.name !== 'search_site' || (res && (res.passages || []).some((p) => !DOC_KINDS.includes(p.kind)))) ctx.own = false;
            const text = JSON.stringify(res);
            return { type: 'tool_result', tool_use_id: u.id, content: text.length > TOOL_RESULT_MAX ? text.slice(0, TOOL_RESULT_MAX) + ' …(cut)' : text, ...(res && res.error ? { is_error: true } : {}) };
          });
          msgs.push({ role: 'user', content: results });
          continue;
        }
        const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (!text) return { error: r.stop_reason === 'max_tokens' ? 'cut' : 'empty' };
        return { answer: r.stop_reason === 'max_tokens' ? text + ' …' : text, sources: ctx.sources, missed: ctx.missed,
          reuse: ctx.own && !ctx.missed && r.stop_reason !== 'max_tokens' && ownWordsOnly(text) };
      }
      return { error: 'rounds' };
    } catch (e) {
      // the SDK's own error classes, most specific first; a message is never matched as text
      if (e instanceof Anthropic.APIUserAbortError || e instanceof Anthropic.APIConnectionTimeoutError) return { error: 'timeout' };
      if (e instanceof Anthropic.RateLimitError) return { error: 'busy' };
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { error: 'key' };
      if (e instanceof Anthropic.BadRequestError) return { error: 'request' };
      if (e instanceof Anthropic.InternalServerError) return { error: 'upstream' };
      if (e instanceof Anthropic.APIConnectionError) return { error: 'unreachable' };
      if (e instanceof Anthropic.APIError) return { error: 'api' };
      if (e instanceof Anthropic.AnthropicError) return { error: 'sdk' };
      throw e;
    } finally { clearTimeout(timer); }
  }
  /* The model's answer could be reused once rated only if it reads as the site's own words: no number (a reading, a count, a
     date — true only when it was said), no @member, no token but the site's own two, nothing in quotes (someone's words).
     The live block it was given holds figures and the Support board's words, so its tools alone cannot say. */
  const ownWordsOnly = (text) => !/\d|@\w|\$[A-Za-z]|[“”"]/.test(String(text).replace(/(^|[\s(])\/[^\s)”"',;]*/g, (m, a) => a).replace(/\$(SEND|GWC|Send)\b/g, ' '));
  function sourcesOfTool(res) {
    const s = [];
    if (res.href) s.push(srcOf(res.chain ? 'Market Data · ' + (CHAIN_NAMES[res.chain] || res.chain) : 'Sendy\'s reading', res.href, res.at));
    for (const p of (res.passages || []).slice(0, 2)) if (p.href) s.push(srcOf(labelOf(p), p.href, p.at));
    for (const t of (res.tokens || []).slice(0, 1)) if (t.href) s.push(srcOf(sym(t.symbol), t.href, t.at));
    return s;
  }
  const BUSY = { busy: 'My model is very busy right now, so this is from my own notes: ', timeout: 'My model took too long just now, so this is from my own notes: ' };
  const REFUSED = "That's one I can't help with here. If it's about the site, ask on the Support board (/support), or email " + EMAIL + ' — a person reads both.';

  /* ----- one message, as the brain answers it: read as it means (lib/sendywords.js), what it points back at said, and
     each of its questions answered — two questions in one message get two answers, a guard rail anywhere in it gets only its
     own answer (never a figure beside "should I buy" or "is it safe"), and a word read as another is said at the end ----- */
  const RECOGNISED = (a) => !!a && (a.pinned || !['handover', 'passage', 'hello', 'thanks', 'clarify'].includes(a.intent));
  const GUARDED = ['advice', 'secrets', 'safety', 'affiliated'];
  // a symbol or a name typed in two pieces ("zq moon"): one, when the two together are one the site has read and a piece is no word
  function joinNames(s, fixes) {
    const { symbols, users } = names(), parts = String(s).split(/(\s+)/);
    for (let i = 0; i + 2 < parts.length; i += 2) {
      const a = parts[i], b = parts[i + 2];
      if (!/^[A-Za-z0-9]{1,8}$/.test(a) || !/^[A-Za-z0-9]{1,10}[?!.,]*$/.test(b)) continue;
      const bw = b.replace(/[?!.,]+$/, ''), k = lc(a + bw);
      if ((symbols.has(k) || users.has(k)) && !symbols.has(lc(a)) && !symbols.has(lc(bw)) && !STOP.has(lc(a)) && !STOP.has(lc(bw)) && (a.length <= 2 ? !plainWord(lc(a)) : !LEX.known(lc(a)) || !LEX.known(lc(bw)))) {
        if (fixes) fixes.push({ from: lc(a + ' ' + bw), to: k });
        parts[i] = a + b; parts.splice(i + 1, 2);
      }
    }
    return parts.join('');
  }
  async function answerMessage(q0, page, history) {
    lookups = new Map(); figureBan = false; typedNow = '';
    try { return await answerMessageNow(q0, page, history); } finally { lookups = null; figureBan = false; typedNow = ''; }
  }
  // a part of a message that is no market question: the boards, the counts, the communities, who runs the site, a how-to, a definition
  const NONMARKET = (p) => RX.leaderboard.test(p) || RX.counts.test(p) || RX.communitiesList.test(p) || RX.competitions.test(p) || RX.whoami.test(p) || RX.hello.test(p) || RX.thanks.test(p)
    || RX.squads.test(p) || RX.scans.test(p) || RX.whoRuns.test(p) || HOWTO.test(p) || DEFINES.test(p) || RX.explain.test(p) || membersIn(p).length > 0;
  const SIMPLY_OK = /^,?\s*(?:like (?:i am|i'm|im) (?:5|five)|eli5|in (?:simple|plain|easy) (?:terms|words|english)|simply)$/i;
  async function answerMessageNow(q0, page, history) {
    const R = WORDS.read(q0, LEX), hist = history || [];
    R.text = joinNames(R.text, R.fixes);
    const sents = WORDS.sentences(R.text), bySentence = sents.length > 1, parts = bySentence ? sents : WORDS.clauses(R.text);
    // the guard rails first, on the message as typed and as tidied and on each of its parts: a message with one anywhere in it
    // gets that answer alone — nothing points back, nothing is split off, nothing is looked up beside it
    const every = [...new Set(WORDS.sentences(R.text, 50).flatMap((x) => [x].concat(WORDS.clauses(x, 50))).concat(WORDS.clauses(R.text, 50)))];
    for (const [x, r0, ty] of [[R.text, joinNames(R.raw), joinNames(R.typed)]].concat(every.length > 1 ? every.map((p) => [joinNames(WORDS.read(p, LEX).text), p, null]) : [])) {
      const g = guardOf(x, r0, hist, ty, R.text);
      if (!g) continue;
      // "is GWC safe and should I buy it?": both of its guard rails' answers, and still no figure
      if (g.intent === 'advice' && RX.safety.test(R.text)) { const named = tokenMentions(R.text, true).filter((y) => y.strong || y.known); if (named.length) { const sa = safetyFor(R.text, named); return finish(out('advice', g.answer + '\n\n' + sa.answer, g.sources.concat(sa.sources)), R); } }
      return finish(g, R);
    }
    // a question of safety about a token, anywhere in it: the safety answer, about the token beside the word — never a figure
    if ((RX.safety.test(R.text) || RX.safety.test(R.raw)) && !SAFE_SITE.test(R.text)) {
      const r = refer(R.text, hist), asked = r.q || R.text, tp = topicOf(lastOf(hist, 'assistant'));
      if (tokenMentions(asked, true).some((x) => x.strong || x.known)) { const a = await answerBrain(asked, page, hist, true); if (a.intent === 'safety') return finish(a, R); }
      else if (r.clarify || (tp && ['tokens', 'communities'].includes(tp.kind) && PRONOUN.test(R.text))) return finish(out('safety', safety(null), [srcOf('Scanner', '/newpairs')]), R);
    }
    // a market figure for this message only if each of its parts plainly asks for one, or asks no market question at all
    typedNow = R.typed || '';
    // (and none where the reader set a reason or an audience aside: "top tokens for beginners", "gwc price, as i'm new here")
    // (every part, not only the ones answered — "…? …? …? …? buy?" — and every piece between commas and dashes: "gwc price, moon?")
    const allParts = [...new Set((bySentence ? WORDS.sentences(R.text, 50) : [R.text]).flatMap((x) => WORDS.clauses(x, 50)))];
    figureBan = (allParts.length > 1 && !allParts.every((p) => figureOnly(joinNames(WORDS.read(p, LEX).text)) || NONMARKET(p))) || (R.aside || []).some((x) => !SIMPLY_OK.test(x))
      // (and a follow-up gets one only for words of its own that ask for one: "too pricey?", "out of 10?", "priced in?" after a price)
      || (hist.length > 0 && parts.length === 1 && !figuresOk(R.text, joinNames(R.raw), R.typed) && !NONMARKET(R.text));
    const one = async (q, h, raw) => { const r = refer(q, h); return r.clarify ? out('clarify', r.clarify, []) : answerBrain(r.q, page, h, false, raw); };
    const whole = await one(R.text, hist, joinNames(R.raw));
    let res = whole;
    if (parts.length > 1 && !GUARDED.includes(whole.intent)) {
      const outs = []; let h = hist;
      for (const p0 of parts) { const p = joinNames(WORDS.read(p0, LEX).text); const a = await one(p, h); outs.push({ p, a }); h = h.concat([{ role: 'user', content: p }, { role: 'assistant', content: a.answer }]); }
      // (the advice guard has already read every part in the message's context above: a part's own refusal, read without it — a
      // lone "yes or no" — is not one; the other guard rails still answer for the whole message)
      for (const o of outs) if (o.a.intent === 'advice') o.a = out('handover', HAND_OVER, []);
      const guard = outs.find((o) => GUARDED.includes(o.a.intent));
      // a part counts when it was answered: in sentences, from the pages too; in "… and …", only as a reading or a known shape —
      // or from the pages when every part is a question of its own ("where is the tracker and how do calls work")
      const asking = (p) => /^\s*(how|what|where|who|when|why|which|is|are|can|could|do|does|should)\b/i.test(p);
      const own = !bySentence && outs.every((o) => asking(o.p));
      const good = outs.filter((o) => (bySentence || own ? !['handover', 'hello', 'thanks'].includes(o.a.intent) : RECOGNISED(o.a)));
      // the message read whole already answers each part (two tokens, two chains, one token's two figures): that answer
      const covered = RECOGNISED(whole) && good.every((o) => whole.answer.includes(o.a.answer.slice(0, 30)));
      // a long message with its question at the end ("just came over from twitter … how would i get $SEND"): that question
      const longOne = words(R.text).length >= 14, lastAsk = [...outs].reverse().find((o) => asking(o.p) && o.a.intent !== 'handover');
      if (guard) res = guard.a;
      else if (good.length < 2 && lastAsk && (whole.intent === 'handover' || (longOne && !RECOGNISED(whole)))) res = lastAsk.a;
      else if (!covered && (good.length >= 2 || (good.length === 1 && bySentence && !RECOGNISED(whole)))) {
        // (a part that asks nothing — "i just got into crypto, my cousin sent me this site" — gets no passage of its own)
        const said = outs.filter((o, i) => !['hello', 'thanks'].includes(o.a.intent) && !outs.slice(0, i).some((p) => p.a.answer === o.a.answer) && !(['passage', 'handover'].includes(o.a.intent) && !asking(o.p) && !/\?\s*$/.test(o.p))), answered = said.filter((o) => o.a.intent !== 'handover');
        res = out('multi', said.map((o) => (o.a.intent === 'handover' ? 'For “' + clip(o.p, 80) + '”, I don\'t have an answer yet — ask it on the Support board (/support).' : o.a.answer)).join('\n\n'),
          [].concat(...answered.map((o) => o.a.sources || [])), { parts: said.map((o) => o.a.intent), miss: said.length > answered.length, reuse: said.length === answered.length && answered.every((o) => o.a.reuse === true) });
      }
    }
    // nothing found, after another question: the same words with what that question was about ("and the part about liability?")
    const prevQ = lastOf(hist, 'user');
    if (res.intent === 'handover' && prevQ && terms(R.text).length <= 5) {
      const about = WORDS.read(prevQ, LEX).text.replace(/^\s*(?:what|where|how|who|which)\s+(?:is|are|does|do|was|can)\s+(?:i\s+|the\s+)?|^\s*(?:tell me about|explain)\s+/i, '').replace(/[?!.]+$/, '');
      const again = terms(about).length ? await answerBrain(R.text.replace(/[?!.]+$/, '') + ' ' + about, page, hist, true) : null;
      if (again && again.intent === 'passage') res = again;   // the pages' words only: never a figure for a question that asked how
    }
    // a safety word in the message never sits beside a figure, however the answer was reached
    if ((RX.safety.test(R.text) || RX.safety.test(R.raw)) && /\babout \$\d|\bprice about\b/.test(res.answer) && !/\bit(?:'s| is)?\s+safe\s+to\b/i.test(R.text)) res = out('safety', safety(null), [srcOf('Scanner', '/newpairs')]);
    return finish(res, R);
  }
  function finish(res, R) {
    // a word read as another is said, so a wrong guess is seen (and an answer that repeats the person's words is not reused)
    if (R.fixes.length && !['handover', 'hello', 'thanks', 'clarify'].includes(res.intent)) {
      res = Object.assign({}, res, { answer: res.answer + ' (I read ' + R.fixes.slice(0, 3).map((f) => '“' + f.from + '” as “' + f.to + '”').join(' and ') + '.)', reuse: false });
    }
    return res;
  }

  /* ----- one question, start to finish ----- */
  async function answer({ q, page, history, system }) {
    const t0 = process.hrtime.bigint();
    const hist = (history || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '') })).filter((m) => m.content);
    let res;
    if (ai && system) {
      const m = await askModel({ q, page, history: hist, system });
      if (m.answer) res = { engine: 'model', intent: 'model', answer: m.answer, sources: dedupe(m.sources).slice(0, 4), miss: m.missed, reuse: m.reuse };
      else if (m.refused) res = { engine: 'model', intent: 'refused', answer: REFUSED, sources: [srcOf('Support board', '/support')], miss: true };
      else {
        log('[sendy] the model could not answer (' + m.error + ') — answering from the brain');
        const b = await answerMessage(q, page, hist);
        res = Object.assign(b, { answer: (BUSY[m.error] || 'My model could not answer just now, so this is from my own notes: ') + b.answer, fallback: m.error, reuse: false });
      }
    } else res = await answerMessage(q, page, hist);
    if (res.engine === 'brain' && res.miss) miss(q, page, 'brain');
    res.sources = dedupe(res.sources);
    res.reuse = res.reuse === true;   // the route keeps it with the answer: only these may be reused once readers rate them
    st.answered++; st.lastAnswerMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return res;
  }
  const dedupe = (ss) => { const seen = new Set(); return (ss || []).filter((s) => s && s.href && /^\/(?!\/)/.test(s.href) && !seen.has(s.href) && seen.add(s.href)); };

  function stats() {
    return { model: ai ? MODEL : null, index: { docs: index.size(), kinds: index.kinds(), watermarks: Object.assign({}, wm), files: fileAt.size },
      refresh: { everyMs: REFRESH_MS, rebuildEveryTicks: REBUILD_EVERY, loadedAt: st.loadedAt, ticks: st.ticks, rebuilds: st.rebuilds, lastTickAt: st.lastTickAt, lastTickMs: st.lastTickMs, lastRebuildAt: st.lastRebuildAt, prunedAt: st.prunedAt, maxSliceMs: Math.round(st.maxSliceMs * 10) / 10, errors: st.errors },
      answered: st.answered, lastAnswerMs: st.lastAnswerMs == null ? null : Math.round(st.lastAnswerMs * 10) / 10, tools: Object.keys(TOOLS) };
  }

  return { migrate, start, stop, tick, load, answer, answerBrain: answerMessage, rated, misses, miss, prune, stats, runTool, supportFor, ratedAnswers, TOOL_DEFS, tools: Object.keys(TOOLS),
    search: (q, o) => index.search(queryTerms(q), Object.assign({ weight: kindWeight }, o || {})), read: (q) => WORDS.read(q, LEX), _test: { index, READ, wm, chainKeyOf, tokenMentions, membersIn, refer, LEX, spellTargets: () => [].concat(...targets().values()).map((c) => c.w), pins: () => CONCEPTS.map(([, re]) => !!pin(re)), joinNames, figureOnly, adviceAsked, stripSite, rules: { PRECISE, ALWAYS_PICK, BARE_DECISION, DECIDE, HOWTO, SUPPORT, target: RX.target } } };
}

module.exports = { createSendyBrain, createIndex, htmlChunks, readmeChunks, termsChunks, readNotes, terms, stem, usd, pct, count, ago, srcName, pushes, DOC_KINDS, DEFAULT_MODEL, FALLBACK_MODELS, FALLBACK_BETA };
