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
   post taken down or deleted since the index read it is never repeated.

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

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DEFAULT_MODEL = 'claude-opus-5-5';
// the models that take the server-side fallback beta (a declined request is retried on the model Anthropic names for it)
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MODEL_ROUNDS = 4;            // a question gets at most this many model turns (tool calls in between)
const TOOL_RESULT_MAX = 8000;      // characters of one tool's answer sent to the model
const MISS_KEEP_MS = 90 * DAY, MISS_KEEP_ROWS = 5000;    // the questions Sendy could not answer: 90 days, the newest 5,000
const QA_UNRATED_KEEP_MS = 90 * DAY, QA_UNRATED_KEEP_ROWS = 20000;   // an answer nobody rated: 90 days, the newest 20,000 (every answer is kept now)
const POSTS_MAX = 20000, CALLS_MAX = 5000;                // the newest public posts and calls in the index (memory has a ceiling)
const BATCH = 400;                 // rows read per slice; the loop is let go between slices
const REBUILD_EVERY = 15;          // ticks between full rebuilds of the people-written part

/* ----- words ----- */
const STOP = new Set(('a about above after again all also am an and any are as at be been being but by can could did do does doing '
  + 'for from get got had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off '
  + 'on once only or other our out over own please same she should so some such than that the their theirs them then there these they '
  + 'this those through to too under until up very was we were what when where which while who whom why will with would you your '
  + 'yours tell show give know want need im ive dont doesnt cant hey hi hello sendy site page').split(' '));
// one word as the index keeps it: lower case, a light stem so "calls", "called" and "calling" meet "call"
function stem(w) {
  if (w.length <= 3 || /^0x|\d/.test(w)) return w;
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
const words = (s) => String(s || '').toLowerCase().normalize('NFKC').match(/0x[0-9a-f]{6,64}|[a-z0-9À-ɏ]+(?:'s)?/g) || [];
const terms = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 1).map(stem);
// a few words people use for what the site calls something else
const ALIASES = { mcap: ['market', 'cap'], marketcap: ['market', 'cap'], tvl: ['tvl', 'value', 'lock'], '2fa': ['two', 'factor'], pnl: ['pnl', 'profit'],
  dm: ['message'], pfp: ['picture', 'profile'], avatar: ['avatar', 'picture'], lp: ['liquidity', 'pool'], ca: ['contract', 'address'] };
const queryTerms = (s) => { const out = []; for (const t of terms(s)) { out.push(t); for (const a of (ALIASES[t] || [])) out.push(stem(a)); } return [...new Set(out)]; };

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
  const a = src.indexOf('const knowledgeBase = {'), b = src.indexOf('\n  };', a);   // the object closes at its own indent
  if (a < 0 || b < 0) return [];
  const literal = src.slice(a + 'const knowledgeBase = '.length, b + 4);
  const kb = vm.runInNewContext('(' + literal + ')', { EMAIL: email }, { timeout: 200 });
  return Object.entries(kb).map(([key, e]) => ({ key, keywords: Array.isArray(e.keywords) ? e.keywords.map(String) : [], answer: String(e.answer || '') }));
}

/* ----- the index: BM25 over passages, added and removed one at a time ----- */
function createIndex() {
  const docs = new Map(), post = new Map(), fam = new Map();   // fam: an id's family (before the first ':') → its ids
  const famOf = (id) => String(id).slice(0, String(id).indexOf(':') >>> 0);
  let totalLen = 0;
  const K1 = 1.2, B = 0.75;
  function remove(id) {
    const d = docs.get(id); if (!d) return false;
    for (const t of d.tf.keys()) { const p = post.get(t); if (p) { p.delete(id); if (!p.size) post.delete(t); } }
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
  }
  // the best passages for a question: BM25, weighted by the passage's kind, with how much of the question each one covers
  function search(qTerms, o = {}) {
    const N = docs.size; if (!N || !qTerms.length) return [];
    const avg = totalLen / N, score = new Map(), hit = new Map();
    for (const t of qTerms) {
      const p = post.get(t); if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const [id, n] of p) {
        const d = docs.get(id);
        if (o.kinds && !o.kinds.includes(d.kind)) continue;
        score.set(id, (score.get(id) || 0) + idf * (n * (K1 + 1)) / (n + K1 * (1 - B + B * d.len / avg)));
        hit.set(id, (hit.get(id) || 0) + 1);
      }
    }
    const out = [];
    for (const [id, s] of score) { const d = docs.get(id); out.push({ doc: d, score: s * (o.weight ? o.weight(d) : 1), cover: hit.get(id) / qTerms.length }); }
    return out.sort((a, b) => b.score - a.score).slice(0, o.limit || 8);
  }
  return { add, remove, search, get: (id) => docs.get(id), has: (id) => docs.has(id), size: () => docs.size, ids: (family) => [...(family ? fam.get(family) || [] : docs.keys())],
    kinds: () => { const k = {}; for (const d of docs.values()) k[d.kind] = (k[d.kind] || 0) + 1; return k; } };
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
  ['robinhood', /\brobinhood(?: chain)?\b|\brh chain\b|\bthe chain\b/i], ['ethereum', /\bethereum\b|\beth mainnet\b/i], ['solana', /\bsolana\b/i],
  ['base', /\b(?:on|of|in|for|across|about) base\b|\bbase(?:'s| chain| network| tvl| tokens?| volume| fees?)\b/i], ['base', /\bBase\b/],
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
    // Sendy's own two tables (no identity in either)
    rated: () => all("SELECT id, q, a, at, up, down FROM sendy_qa WHERE up - down >= 2 AND a != '' ORDER BY (up - down) DESC, at DESC LIMIT 300"),
    qa: (id) => one('SELECT id, q, a, at, up, down FROM sendy_qa WHERE id = ?', id),
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
  }
  function miss(q, page, engine) {
    try { db.prepare('INSERT INTO sendy_misses (q, page, engine, at) VALUES (?, ?, ?, ?)').run(String(q).slice(0, 600), page || null, engine || 'brain', now()); } catch (e) { log('[sendy] a missed question could not be kept — ' + (e && e.message)); }
  }
  function prune() {
    try {
      db.prepare('DELETE FROM sendy_misses WHERE at < ?').run(now() - MISS_KEEP_MS);
      db.prepare('DELETE FROM sendy_misses WHERE id <= (SELECT id FROM sendy_misses ORDER BY id DESC LIMIT 1 OFFSET ?)').run(MISS_KEEP_ROWS);
      db.prepare('DELETE FROM sendy_qa WHERE up = 0 AND down = 0 AND at < ?').run(now() - QA_UNRATED_KEEP_MS);
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
  // the people-written passages
  const postDoc = (r) => {
    const t = clip(r.text, 1200);
    if (!t || /^\[(removed|deleted)/.test(t)) return null;
    if (r.board === 'support') return null;   // a Support question is its own passage, with its answers (supportDoc)
    return { id: 'post:' + r.id, kind: 'post', ref: r.id, title: '@' + r.username + (r.community_id ? ' in a community' : ' on the Send Wall'), text: t,
      href: r.community_id ? '/community?id=' + r.community_id + '#p' + r.id : '/u/' + encodeURIComponent(r.username) + '#p' + r.id, at: r.created_at, author: r.username };
  };
  function supportDoc(r) {
    const q = clip(r.text, 600);
    if (!q || /^\[(removed|deleted)/.test(q)) return null;
    const answers = READ.supportAnswers(r.id).filter((a) => a.text && !/^\[(removed|deleted)/.test(a.text));
    return { id: 'sq:' + r.id, kind: 'support', ref: r.id, title: q, text: q + ' ' + answers.map((a) => a.text).join(' '), href: '/support#p' + r.id, at: r.created_at,
      question: q, answers: answers.map((a) => ({ text: clip(a.text, 600), by: a.username, at: a.created_at })) };
  }
  const callDoc = (r) => ({ id: 'call:' + r.id, kind: 'call', ref: r.id, title: 'Send Call on ' + sym(r.symbol), text: '@' + r.username + ' made a Send Call on ' + sym(r.symbol) + (r.name ? ' (' + r.name + ')' : '') + ' on ' + new Date(r.created_at).toISOString().slice(0, 10) + '.',
    extra: r.symbol + ' ' + (r.name || ''), href: r.post_id ? '/u/' + encodeURIComponent(r.username) + '#p' + r.post_id : '/u/' + encodeURIComponent(r.username), at: r.created_at, token: r.token_addr });
  const communityDoc = (c) => ({ id: 'comm:' + c.id, kind: 'community', ref: c.id, title: sym(c.symbol) + ' ' + c.name + ' community', extra: c.symbol + ' ' + c.name + ' community',
    text: sym(c.symbol) + ' ' + c.name + ' is a ' + (c.status === 'live' ? 'live' : 'pending') + ' community' + (c.official ? ' run by the site' : '') + (c.demo ? ' (the open sandbox)' : '') + ' with ' + (c.qual_count || 0) + ' verified member' + (c.qual_count === 1 ? '' : 's') + '.',
    href: '/community?id=' + c.id, at: c.went_live_at || c.created_at });
  // a rated answer is reused only when it carries no figure: a price was true when it was said; the tools read it again instead
  const ratedDoc = (r) => (/\$\s?\d|\d\s?%|\d+(?:\.\d+)?\s?[kKmMbB]\b/.test(r.a) ? null
    : { id: 'rated:' + r.id, kind: 'rated', ref: r.id, title: clip(r.q, 200), text: r.q + ' ' + r.a, answer: r.a, href: null, at: r.at });
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
    if (d.kind === 'rated') { const r = READ.qa(d.ref); if (!r || r.up - r.down < 2) { index.remove(d.id); return null; } return d; }
    return d;
  }

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
    const card = (x) => ({ symbol: x.symbol, name: x.name, status: x.status, official: !!x.official, sandbox: !!x.demo, verifiedMembers: x.qual_count || 0, members: x.member_count || 0, mcap: F(x.c_mc, 'site', x.c_at, 'not read yet'), href: '/community?id=' + x.id });
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
      communities: ((h.communities && h.communities.board) || []).slice(0, 3).map((c) => ({ rank: c.rank, symbol: c.symbol, name: c.name, xpWeek: c.xpWeek })),
      rocketRun: { flightsToday: rr.flightsToday, cashedToday: rr.cashedToday, bestXToday: rr.bestXToday, resetsAt: rr.resetsAt, riders: (rr.riders || []).map((r) => ({ rank: r.rank, name: r.guest ? r.name : r.username, x: r.x })) },
      href: '/arcade' };
  }
  function searchSite(query, only) {
    const kinds = only === 'docs' ? ['map', 'note', 'page', 'readme', 'whitepaper', 'terms'] : only === 'support' ? ['support'] : only === 'posts' ? ['post', 'call'] : null;
    const hits = index.search(queryTerms(query), { kinds, limit: 10, weight: kindWeight }).map((h) => ({ h, d: stillPublic(h.doc) })).filter((x) => x.d).slice(0, 5);
    if (!hits.length) return notRead('nothing on the site matches that');
    return { ok: true, src: 'site', at: now(), passages: hits.map(({ h, d }) => ({ kind: d.kind, title: d.title, text: d.kind === 'support' ? 'Q: ' + d.question + (d.answers.length ? ' A: ' + d.answers.map((a) => a.text).join(' / ') : ' (no answer yet)') : d.kind === 'rated' ? 'Q: ' + d.title + ' A: ' + d.answer : clip(d.text, 900), href: d.href, at: d.at, score: Math.round(h.score * 100) / 100 })) };
  }

  /* ----- a token from what the site has read ----- */
  function findToken(query, chain) {
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

  /* ===== THE ANSWERS WITHOUT A MODEL ================================================================================= */
  const kindWeight = (d) => ({ note: 1.3, map: 1.15, support: 1.2, rated: 1.15, page: 1, whitepaper: 1, readme: 0.9, terms: 0.7, community: 0.8, post: 0.55, call: 0.45 }[d.kind] || 1);
  const HAND_OVER = "I don't have an answer for that yet. Ask it on the Support board (/support), where the community and the team answer in public — or email " + EMAIL + " if it's private.";
  const ADVICE = "That's not something I — or anyone on this site — will ever say: nothing here tells anyone to buy, sell or hold, and nobody can predict a price. What I can do is show you the facts: read the token on the Scanner (/newpairs) — holders, liquidity, the contract — or on Market Data (/market), and decide for yourself. Everything here is entertainment, not financial advice, and the site is not affiliated with Robinhood.";
  const SECRETS = 'Never share a seed phrase, a private key or a password with anyone — not me, not a moderator, not a DM. This site never asks for them: signing in with a wallet is a free signature, never a transaction. If something asked you for one, report it, or email ' + EMAIL + '.';
  const RX = {
    advice: /\b(should i (buy|sell|hold|ape|get|invest|dump)|(is|are) (it|this|they|\$?\w+) (a )?(good|great|smart|bad) (buy|investment|bet|time to buy)|good (buy|investment|time to buy)|worth (buying|investing in)|buy or sell|sell or hold|hold or sell|financial advice|invest(ing)? in\b|ape in(to)?\b|will (it|this|they|\$?\w+) (go up|go down|rise|fall|pump|moon|dump|crash|recover|100x|10x)|going to (moon|pump|go up|go down|crash)|to the moon|price prediction|predict(ion)?s?\b|forecast|next (gem|100x|10x|moonshot)|when (should i|to) (buy|sell)|what should i buy|which (token|coin) should i|best (token|coin) to buy)/i,
    secrets: /\b(seed phrase|recovery phrase|private key|secret phrase|mnemonic)\b/i,
    hello: /^\s*(hi|hey|hello|yo|gm|sup|hiya|howdy)\b[\s!.?,]*(sendy)?[\s!.?]*$/i,
    thanks: /^\s*(thanks?( you)?|thx|ty|cheers|awesome|cool|great|nice)\b[\s!.?,]*(sendy)?[\s!.?]*$/i,
    whoami: /\bwho are you\b|\bwhat are you\b|\bare you (a )?(bot|human|ai|real|person)\b/i,
    // "how does … work" asks for an explanation, not a reading — unless it also asks who, how many or what right now
    explain: /^\s*(how (does|do|can|is|are|to)|what (is|are|does|do)\b(?! (trending|hot|moving|new))|what's an? |explain|why|when (does|do|is))\b/i,
    nowWords: /\b(who|winning|standings?|leaders?|top|this week|today|right now|now|current(ly)?|latest|winners?|ends?|end|how many|how much)\b/i,
    leaderboard: /\bleader ?board\b|\btop (\d+ )?(senders|members|players|users)\b|\bmost send power\b|\bhighest send power\b|\bwho(?:'s| is) (#1|number one|first|on top)\b|\branking\b/i,
    competitions: /\bcompetitions?\b|\bbiggest sender\b|\bweekly (race|competition|board|prize)|\bthis week'?s (race|winner|leader|prize|competition)|\bprizes?\b|\brocket run\b|\barcade\b|\brocket riders\b|\bwho(?:'s| is) winning\b/i,
    counts: /\bhow many (members|users|people|accounts|senders|calls|send calls|posts|questions|communities|squads|send squads)\b|\b(member|user) count\b|\bnumber of (members|users|calls|posts|communities|squads)\b/i,
    squads: /\bsquads?\b/i,
    communitiesList: /\b(which|list|all|live|biggest|largest|top|any)\b.*\bcommunit(y|ies)\b|\bwhat communities\b|\bcommunit(y|ies)\b.*\b(are (there|live)|exist|list|live|biggest|largest|members)\b|^\s*communit(y|ies)\s*\??\s*$/i,
    pulse: /\bgas( price| fees?)?\b|\bblock ?time\b|\b(latest|current|last) block\b|\bblock (number|height)\b|\bbridge (holds|balance)\b|\bpulse\b|\bpools? (were )?created\b|\bchain (status|health|stats)\b|\bis the chain (up|down|working)\b/i,
    newPools: /\bnew(est)? (pools?|pairs?|tokens?|launch(es)?|listings?)\b|\bjust launched\b|\blatest (pools?|pairs?|launches)\b|\bradar\b/i,
    scans: /\b(recent(ly)?|latest|popular|most) scan(s|ned)?\b|\bwhat (are|is) (people|everyone|folks) scanning\b|\bscanned (recently|lately|today)\b/i,
    topChains: /\b(top|biggest|largest|leading|best|rank(ing)?|compare)\b.*\bchains\b|\bwhich chain\b|\bchains? (by|with the (most|highest|biggest))\b/i,
    topTokens: /\b(top|biggest|largest|best|hottest|hot|trending|most[- ]traded|highest|lowest|smallest|gainers?|losers?|movers?|pumping|dumping)\b.*\b(tokens?|coins?|memecoins?|pairs?)\b|\bwhat(?:'s| is| are) (trending|hot|moving)\b|\btrending\b|\b(top|biggest) (gainers|losers|movers)\b/i,
    chainMetric: /\btvl\b|\bvalue locked\b|\btvs\b|\bvalue secured\b|\bstablecoins?\b|\bstables\b|\bfees?\b|\bdex volume\b|\bvolume\b|\bliquidity\b|\btransactions?\b|\bactive addresses\b|\bstage\b|\bopen interest\b|\bstats?\b|\bfigures?\b|\bdata\b|\bmarket ?cap\b|\bmcap\b/i,
    tokenInfo: /\b(what is|what's|tell me about|info(rmation)? (on|about)|look ?up|stats|data|figures|how is .{1,40} doing|details)\b/i,
  };
  const METRIC_RX = [['priceUsd', /\bprice|how much is|\bworth\b|\bcost\b/i], ['mcap', /market ?cap|\bmcap\b|marketcap|valuation/i], ['fdv', /\bfdv\b|fully diluted/i], ['liquidity', /liquidity|\bliq\b|\blp\b|pool size/i],
    ['volume', /volume|\bvol\b|\btraded\b/i], ['change', /\bchange|\bgain|\blos(s|ing|er)|\bmoved?\b|%|percent|\bup or down\b/i], ['holders', /\bholders?\b/i]];
  const CHAIN_METRIC_RX = [['tvl', /\btvl\b|value locked/i], ['tvs', /\btvs\b|value secured/i], ['stables', /stablecoins?|\bstables\b/i], ['fees24h', /\bfees?\b/i], ['volume24h', /volume/i],
    ['liquidity', /liquidity/i], ['txcount24h', /transactions?|\btxs?\b/i], ['daa', /active addresses|\busers\b/i], ['mcap', /market ?cap|\bmcap\b/i], ['oi', /open interest/i]];
  const NOT_TOKENS = new Set(['the', 'a', 'an', 'it', 'this', 'that', 'my', 'your', 'our', 'their', 'token', 'tokens', 'coin', 'coins', 'chain', 'chains', 'power', 'call', 'calls', 'wall', 'site', 'market', 'gas', 'is', 'of', 'on', 'there', 'its', 'which', 'what', 'send power', 'every', 'each', 'any', 'all']);
  const CAPS_NOT_TOKENS = /^(TVL|TVS|FDV|DEX|USD|ETH|PNL|API|FAQ|NFT|LP|OG|ID|UTC|AI|DM|USDG|WETH|SOL|BSC|BNB|CEO|ATH|DYOR|FUD|FOMO|RPC|URL|CA|ROI|APR|APY|KYC|OK|IS|IT|I|A|PM|AM|UK|US|EU|HOW|WHAT|WHO|THE|AND|OR)$/;
  const CHAIN_BARE = new Set(['robinhood', 'ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism', 'rh', 'avax', 'bnb']);
  /* the tokens a question names. Strong: a $SYMBOL, an address, a symbol in capitals — one the site has not read is said so.
     Weak: a plain word in a "price of X" / "X market cap" phrase — it counts only if it is a token the site has read, so
     "biggest tokens by market cap" is not a question about a token called BY. */
  const WEAK_NOT = new Set(['by', 'top', 'biggest', 'largest', 'highest', 'lowest', 'smallest', 'total', 'current', 'whats', 'average', 'daily', 'same', 'pool', 'dex', 'trading', 'buy', 'sell', 'chain']);
  function tokenMentions(q) {
    const found = new Map();
    const put = (w, strong) => {
      w = w.replace(/^\$/, '').replace(/'s$/, ''); const k = lc(w);
      if (NOT_TOKENS.has(k) || CHAIN_BARE.has(k) || (!strong && (STOP.has(k) || WEAK_NOT.has(k)))) return;
      if (!found.has(k) || strong) found.set(k, { w, strong });
    };
    for (const m of q.matchAll(/\$([A-Za-z0-9][\w.-]{0,30})/g)) put(m[1], true);
    for (const m of q.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) put(m[0], true);
    if (/[a-z]/.test(q)) for (const m of q.matchAll(/(?:^|[^\w$@])([A-Z][A-Z0-9]{1,11})(?![\w])/g)) if (!CAPS_NOT_TOKENS.test(m[1])) put(m[1], true);   // a question all in capitals is not a list of symbols
    const lq = q.toLowerCase();
    for (const m of lq.matchAll(/\b(?:price|mcap|market ?cap|liquidity|volume|fdv|holders|chart)\s+(?:of|for|on)\s+\$?([a-z0-9][\w.-]{1,30})/g)) put(m[1], false);
    for (const m of lq.matchAll(/\b([a-z0-9][\w.-]{1,30})(?:'s)?\s+(?:price|mcap|market ?cap|liquidity|volume|fdv|holders)\b/g)) put(m[1], false);
    for (const m of lq.matchAll(/\bhow much is\s+\$?([a-z0-9][\w.-]{1,30})/g)) put(m[1], false);
    return [...found.values()];
  }
  function chainIn(q) {
    for (const [k, re] of CHAIN_WORDS) if (re.test(q)) return k;
    const lq = q.toLowerCase();   // any other chain Market Data lists, by its full name
    for (const c of otherChains()) if (c.re.test(lq)) return c.key;
    return null;
  }
  const allChains = (q) => /\b(all|every|across|each) (the )?chains?\b|\bcross[- ]chain\b|\bacross chains\b|\beverywhere\b/i.test(q);
  const winIn = (q) => (/\b5 ?m(in(ute)?s?)?\b/i.test(q) ? '5m' : /\b1 ?h(ou)?r?\b|\blast hour\b|\bthis hour\b/i.test(q) ? '1h' : /\b6 ?h(ou)?rs?\b/i.test(q) ? '6h' : '24h');
  const chainWinIn = (q) => (/\b7 ?d(ays?)?\b|\bweek\b/i.test(q) ? '7d' : /\b30 ?d(ays?)?\b|\bmonth\b/i.test(q) ? '30d' : '24h');
  // a member the question names: @name (an @ inside an email address is not one), "member alice", "alice's Send Power"
  const memberIn = (q) => {
    const m = /(?:^|[^\w.+-])@([A-Za-z0-9_.-]{2,40})/.exec(q) || /\b(?:user|member|sender|profile of|wall of)\s+@?([A-Za-z0-9_.-]{3,40})\b/i.exec(q) || /\b([A-Za-z0-9_.-]{3,40})'s (?:send power|level|rank|profile|wall|points|followers)\b/i.exec(q)
      || /\b(?:send power|level|rank|points) (?:of|for)\s+@?([A-Za-z0-9_.-]{3,40})\b/i.exec(q) || /\bhow much send power (?:does|has)\s+@?([A-Za-z0-9_.-]{3,40})\b/i.exec(q);
    return m ? m[1].replace(/[.]+$/, '') : null;
  };
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const plural = (n, one, many) => count(n) + ' ' + (n === 1 ? one : many || one + 's');

  // one answer: the words, and the sources it came from (site paths and the source names the site already shows)
  const out = (intent, answer, sources, extra) => Object.assign({ engine: 'brain', intent, answer, sources: (sources || []).filter(Boolean).slice(0, 4) }, extra || {});
  const srcOf = (label, href, at) => ({ label, href: href || null, at: Number.isFinite(at) ? at : null });

  function tokenAnswer(r, metric, t) {
    if (!r.ok) return out('token', "I couldn't find that one: " + r.why + '.', [srcOf('Scanner', '/newpairs')], { unknownToken: true });
    const ts = r.tokens, first = ts[0];
    const leads = (k) => k === metric || (metric === 'volume' && k.startsWith('volume')) || (metric === 'change' && k.startsWith('change'));
    const items = [['priceUsd', 'price', 'usd'], ['mcap', 'market cap', 'usd'], ['fdv', 'FDV', 'usd'], ['liquidity', 'liquidity', 'usd'], ['volume', '24 h volume', 'usd'], ['volume24h', '24 h volume', 'usd'], ['change', '24 h change', 'pct'], ['change24h', '24 h change', 'pct'], ['holders', 'holders', 'count']]
      .filter(([k]) => isFig(first[k])).sort((a, b) => leads(b[0]) - leads(a[0])).slice(0, metric ? 4 : 5);
    let a = sym(first.symbol) + (first.name ? ' (' + first.name + ')' : '') + ' on ' + (first.chainName || CHAIN_NAMES[first.chain] || first.chain) + ': ' + said(items.map(([k, label, kind]) => ({ label, f: first[k], kind })), t) + '.';
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

  /* A follow-up ("and on Base?", "what about $GWC?"): the person's previous question, with what this one names in place of
     what that one named — the chain for the chain, the token for the token — answered once more. Null when it is not one. */
  async function followOn(q, page, history) {
    const prev = [...(history || [])].reverse().find((m) => m.role === 'user' && m.content && m.content !== q);
    if (!prev || terms(q).length > 4 || RX.explain.test(q)) return null;
    let base = prev.content;
    if (chainIn(q)) for (const [, re] of CHAIN_WORDS) base = base.replace(new RegExp(re.source, re.flags + 'g'), ' ');
    if (tokenMentions(q).some((x) => x.strong)) base = base.replace(/\$[A-Za-z0-9][\w.-]{0,30}|\b0x[0-9a-fA-F]{40}\b/g, ' ');
    const again = await answerBrain(base.replace(/\s+/g, ' ').trim() + ' ' + q.replace(/^\s*(and|what about|how about|also|same for|now)\b\s*/i, ''), page, [], true);
    return again.intent !== 'handover' && again.intent !== 'passage' ? again : null;
  }

  async function answerBrain(q, page, history, followUp) {
    const t = now();
    // "and on Base?" — a follow-up is read as one before anything else, or "Base" alone would be a question about Base
    if (!followUp && /^\s*(and|what about|how about|also|same for)\b/i.test(q)) { const again = await followOn(q, page, history); if (again) return again; }
    // a question that asks for a figure ("what is the TVL of …") is a reading, whatever its first words
    const explaining = RX.explain.test(q) && !RX.nowWords.test(q) && !METRIC_RX.some(([, re]) => re.test(q)) && !CHAIN_METRIC_RX.some(([, re]) => re.test(q));
    if (RX.secrets.test(q) && !/^\s*what (is|are)\b/i.test(q)) return out('secrets', SECRETS, [srcOf('Privacy Policy', '/privacy')]);
    if (RX.advice.test(q)) return out('advice', ADVICE, [srcOf('Scanner', '/newpairs'), srcOf('Market Data', '/market')]);
    if (RX.hello.test(q)) return out('hello', "Hey! I'm Sendy 🚀 Ask me about prices and market caps, the top tokens on a chain, the leaderboard, communities, the competitions — or how anything on this site works.");
    if (RX.thanks.test(q)) return out('thanks', 'Any time! Anything else, just ask. 🚀');
    if (RX.whoami.test(q)) return out('whoami', "I'm Sendy, the site's rocket helper — a program, not a person. I answer from the site's own pages and its live public data, and I can't see or change anyone's account. For a person: the Support board (/support) or " + EMAIL + '.');

    // a member, by @name (or "alice's Send Power")
    const name = memberIn(q);
    if (name && !/^(send|the|you|me|this|that|my|your)$/i.test(name)) {
      const r = member(name);
      if (r.ok) {
        const m = r.member;
        const a = '@' + m.username + ': about ' + count(m.points) + ' Send Power, level ' + m.level + (m.title ? ' (' + m.title + ')' : '') + (m.rank ? ', #' + m.rank + ' on the all-time board' : '') + '; joined ' + day(m.joined)
          + '; ' + plural(m.posts, 'public post') + ', ' + plural(m.followers, 'follower') + (m.og ? '; an OG badge' : '') + " (this site's records, read just now). Their Send Wall: /u/" + encodeURIComponent(m.username) + '.';
        return out('member', a, [srcOf('@' + m.username + "'s Send Wall", r.href, r.at)]);
      }
      if (/@/.test(q)) return out('member', "I couldn't find a member called @" + clip(name, 40) + ' — names are on the leaderboard (/arcade) and on every Send Wall.', [srcOf('Arcade', '/arcade')]);
    }
    if (RX.leaderboard.test(q) && !explaining) {
      const n = Math.min(10, Number((/\btop (\d{1,2})\b/i.exec(q) || [])[1]) || 5), r = leaderboard(n);
      if (!r.ok) return out('leaderboard', 'The leaderboard is empty so far: ' + r.why + '.', [srcOf('Arcade', '/arcade')]);
      return out('leaderboard', "The all-time leaderboard (Send Power, this site's records, read just now): " + r.rows.map((u) => '#' + u.rank + ' @' + u.username + ' — about ' + count(u.sendPower) + ', level ' + u.level).join('; ') + '. The boards are on /arcade; how Send Power works is on /about.', [srcOf('Arcade', '/arcade', r.at)]);
    }
    // the competitions as they stand: asked who, how, when it ends, or just named ("the arcade?") — a question about a rule is for the pages
    if (RX.competitions.test(q) && !explaining && (RX.nowWords.test(q) || terms(q).length <= 2)) {
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
    if (RX.counts.test(q)) {
      const c = READ.counts();
      return out('counts', 'Right now the site has ' + plural(c.members, 'member') + ', ' + plural(c.calls, 'public Send Call') + ', ' + plural(c.posts, 'public post') + ', ' + plural(c.support, 'Support question') + ', ' + count(c.liveCommunities) + ' live communit' + (c.liveCommunities === 1 ? 'y' : 'ies')
        + ' (' + count(c.pendingCommunities) + ' still gathering members) and ' + plural(c.squads, 'Send Squad') + " (this site's records, read just now).", [srcOf('Communities', '/communities', t)]);
    }
    if (RX.squads.test(q) && !explaining && !/\b(how|join|make|start|create)\b/i.test(q)) {
      const c = READ.counts();
      return out('squads', 'There ' + (c.squads === 1 ? 'is ' : 'are ') + plural(c.squads, 'Send Squad') + " right now (this site's records, read just now). A squad is a private, token-gated group, so its name, members and calls are for its members — sign in on /communities to browse them.", [srcOf('Communities', '/communities', t)]);
    }
    const named = tokenMentions(q), strongNamed = named.filter((x) => x.strong);
    const commSym = (/\$?([A-Za-z0-9]{2,12})\s+community\b/i.exec(q) || [])[1];
    if (commSym && !/^(the|a|an|this|my|your|which|what|any|every|each|own|live|holders|only|sandbox)$/i.test(commSym)) {
      const r = communities(commSym);
      if (r.ok) { const c = r.communities[0]; return out('community', sym(c.symbol) + ' ' + c.name + ' is a ' + c.status + ' community' + (c.official ? ' run by the site' : '') + ' with ' + plural(c.verifiedMembers, 'verified member') + " (this site's records, read just now). It is at " + c.href + '.', [srcOf(sym(c.symbol) + ' community', c.href, r.at)]); }
    }
    if (RX.communitiesList.test(q) && !explaining) {
      const r = communities(null), live = r.live || [];
      const a = (live.length ? plural(live.length, 'community is', 'communities are') + ' live: ' + live.slice(0, 6).map((c) => sym(c.symbol) + ' ' + c.name + (c.official ? ' (official)' : '') + ' — ' + count(c.verifiedMembers) + ' verified').join('; ') + '.' : 'No community is live yet.')
        + (r.pending ? ' ' + count(r.pending) + ' more ' + (r.pending === 1 ? 'is' : 'are') + ' still gathering their first members.' : '') + " (This site's records, read just now.) Browse and join them on /communities.";
      return out('communities', a, [srcOf('Communities', '/communities', r.at)]);
    }
    if (RX.scans.test(q)) {
      const r = recentScans();
      if (!r.ok) return out('scans', 'Nobody has scanned a token here recently. Scan one on /newpairs.', [srcOf('Scanner', '/newpairs')]);
      return out('scans', 'Recently scanned on the Scanner: ' + r.scans.slice(0, 8).map((s) => sym(s.symbol) + (s.count > 1 ? ' (×' + count(s.count) + ')' : '')).join(', ') + " — this site's records (which tokens, never who). Open any of them on /newpairs.", [srcOf('Scanner', '/newpairs', r.at)]);
    }
    const chain = chainIn(q);
    if (RX.pulse.test(q) && !explaining && (!chain || chain === 'robinhood') && !strongNamed.length) {
      const r = pulse();
      if (!r.ok) return out('pulse', "I have no reading of Robinhood Chain's pulse yet: " + r.why + '. It will be on /market?chain=robinhood.', [srcOf('Market Data', '/market?chain=robinhood')]);
      const pc = r.poolsCreated24h;
      let a = 'Robinhood Chain right now: ' + said([{ label: 'block', f: r.block, kind: 'count' }, { label: 'gas', f: r.gasGwei, kind: 'gwei' }, { label: 'a block every', f: r.blockTimeMs, kind: 'ms' }], t) + '.';
      a += pc.v === null ? ' Pools created in the last 24 hours: unknown (' + pc.why + ').' : ' Pools created in the last 24 hours: ' + count(pc.total) + ' (' + pc.v2 + ' v2, ' + pc.v3 + ' v3, ' + pc.v4 + ' v4).';
      a += ' ' + said([{ label: 'The canonical bridge holds', f: r.bridgeEth, kind: 'eth' }], t) + ' on Ethereum. More on /market?chain=robinhood.';
      return out('pulse', a, [srcOf('Market Data · the chain itself', r.href, r.at)]);
    }
    if (RX.newPools.test(q) && !explaining && !strongNamed.length) {
      const k = chain || 'robinhood', r = newPools(k, 5);
      if (k === 'robinhood' && r.radar.length) return out('newPools', "The New Pairs radar's newest named pairs on Robinhood Chain: " + r.radar.slice(0, 5).map((x) => sym(x.symbol) + ' — liquidity ' + val(x.liquidity) + (x.createdAt ? ', created ' + ago(x.createdAt, t) : '')).join('; ') + " (the radar's reading, read " + ago(r.radar[0].at, t) + '). New is not the same as safe: open one on /newpairs and read it first.', [srcOf('New Pairs radar', '/newpairs', r.radar[0].at)]);
      if (r.pools.length) return out('newPools', 'The newest pools on ' + (CHAIN_NAMES[k] || k) + ' (' + (r.src === 'rpc' ? 'read from the chain itself' : 'GeckoTerminal') + '): ' + r.pools.slice(0, 5).map((x) => (x.name || (x.baseSymbol ? sym(x.baseSymbol) : (x.dex || 'a') + ' pool')) + (x.createdAt ? ', ' + ago(x.createdAt, t) : x.block ? ' at block ' + count(x.block) : '')).join('; ') + '. More on ' + r.href + '.', [srcOf('Market Data · new pools', r.href, r.pools[0].createdAt)]);
      return out('newPools', 'No new pools have been read for ' + (CHAIN_NAMES[k] || k) + ' yet. The radar is on /newpairs.', [srcOf('Scanner', '/newpairs')]);
    }
    if (RX.topChains.test(q) && !/^\s*(how|why)\b/i.test(q) && !strongNamed.length && !RX.topTokens.test(q)) {
      const metric = (CHAIN_METRIC_RX.find(([, re]) => re.test(q)) || ['tvl'])[0];
      const sort = { tvl: 'tvl', volume24h: 'volume', fees24h: 'fees', stables: 'stables', liquidity: 'liquidity', mcap: 'mcap', tvs: 'tvs' }[metric] || 'tvl';
      const r = marketChains(sort, chainWinIn(q), 5);
      if (!r.ok) return out('topChains', 'I have no chain figures yet: ' + r.why + '. They will be on /market.', [srcOf('Market Data', '/market')]);
      const label = { tvl: 'DeFi TVL', volume: 'DEX volume (' + (r.window || 'last 24 hours') + ')', fees: 'gas fees (' + (r.window || 'last 24 hours') + ')', stables: 'stablecoins', liquidity: 'DEX liquidity', mcap: 'own-token market cap', tvs: "L2BEAT's value secured" }[sort];
      const f0 = r.rows[0] && r.rows[0][sort], at = (f0 && f0.at) || r.at;
      return out('topChains', 'Top chains by ' + label + ' (' + srcName((f0 && f0.src) || 'defillama') + ' via Market Data, read ' + ago(at, t) + '): ' + r.rows.map((c, i) => (i + 1) + '. ' + c.name + ' — ' + val(c[sort])).join('; ') + '. Every chain is on /market.', [srcOf('Market Data · chains', '/market', at)]);
    }
    if (RX.topTokens.test(q) && !/^\s*(how|why)\b/i.test(q) && !strongNamed.length) {
      const every = allChains(q), k = every ? 'all' : (chain || 'robinhood');
      const sort = /market ?cap|mcap/i.test(q) ? 'mcap' : /liquidity|deepest/i.test(q) ? 'liquidity' : /\bfdv\b/i.test(q) ? 'fdv' : /gainers?|pumping|movers?|losers?|dumping|biggest (moves|change)/i.test(q) ? 'change' : 'volume';
      const dir = /\blosers?\b|\bdumping\b|\blowest\b|\bsmallest\b/i.test(q) ? 'asc' : 'desc';
      const ans = listTokensAnswer(marketTokens(k, sort, dir, winIn(q), 5), every ? 'every chain the site reads' : CHAIN_NAMES[k] || k, t);
      if (/trending|\bhot\b|hottest/i.test(q) && ans.answer.startsWith('Top tokens')) {
        const sc = recentScans();
        ans.answer = 'There is no "trending" score here; the most-traded are the nearest thing. ' + ans.answer + (sc.ok ? ' What people scanned here lately: ' + sc.scans.slice(0, 5).map((s) => sym(s.symbol)).join(', ') + '.' : '');
      }
      return ans;
    }
    // a token by name: its figures, from what the site has read — when the question asks for a figure, or is about the token itself
    if (named.length && (METRIC_RX.some(([, re]) => re.test(q)) || RX.tokenInfo.test(q) || (terms(q).length <= 2 && !/^\s*(how|where|why|can|could)\b/i.test(q)))) {
      const metric = (METRIC_RX.find(([, re]) => re.test(q)) || [null])[0];
      let firstMiss = null;
      for (const tn of named) { const r = findToken(tn.w, chain); if (r.ok) return tokenAnswer(r, metric, t); if (!firstMiss && tn.strong) firstMiss = r; }
      if (firstMiss) return tokenAnswer(firstMiss, metric, t);
    }
    // a chain by name, with a figure asked for (or just the chain)
    if (chain && !explaining && (RX.chainMetric.test(q) || /^\s*(tell me about|what about|how is|how's|and)\b/i.test(q) || terms(q).length <= 2)) {
      const metric = (CHAIN_METRIC_RX.find(([, re]) => re.test(q)) || [null])[0];
      return chainAnswer(marketChain(chain), metric, t);
    }
    // a short question that names nothing the brain recognised may still continue the one before it
    if (!followUp) { const again = await followOn(q, page, history); if (again) return again; }
    return passageAnswer(q, page, t);
  }

  // the best passages of the index, quoted — or, when nothing is relevant, the hand-over to a person
  function passageAnswer(q, page, t) {
    void t;
    const qt = queryTerms(q), how = RX.explain.test(q) || /^\s*where\b/i.test(q);
    // "what are people saying about …" is a question about the walls: there the posts come first
    const social = /\b(people|someone|anyone|everyone|folks|members?|senders?)\b.{0,24}\b(say|said|saying|post(ed|ing)?|talk(ed|ing)?|think|wrote|writing)\b|\bon the (send )?wall\b/i.test(q);
    const need = qt.length <= 2 ? 1 : qt.length <= 4 ? 0.5 : 0.4;   // how much of the question a passage must cover to count
    const hits = index.search(qt, { limit: 14, weight: (d) => kindWeight(d) * ((d.kind === 'post' || d.kind === 'call') ? (social ? 2.5 : how ? 0.5 : 1) : 1) * (page && d.href && d.href.split(/[?#]/)[0] === page ? 1.15 : 1) });
    const good = [];
    for (const h of hits) {
      if (h.cover < need || h.score < 2.2) continue;
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
      : 'Someone asked that on the Support board — “' + clip(best.question, 200) + '” — and it has no answer yet. You can add one, or follow it, at ' + best.href + '.';
    else if (best.kind === 'rated') a = 'Readers rated this earlier answer helpful (' + day(best.at) + '): “' + clip(best.answer, 700) + '”';
    else if (best.kind === 'community') a = best.text + ' It is at ' + best.href + '.';
    else if (best.kind === 'terms') a = 'That is covered by the Terms of Service, section “' + best.title.replace(/^Terms of Service — /, '') + '”: ' + best.href + '. I point to the section rather than paraphrase it.';
    else if (best.kind === 'call') a = best.text + ' The call is at ' + best.href + '.';
    else a = (best.kind === 'post' ? best.title + ' wrote:' : best.kind === 'whitepaper' ? 'The white paper' + (best.title && best.title !== 'The white paper' ? ' (“' + clip(best.title, 80) + '”)' : '') + ' says:' : best.kind === 'readme' ? 'The site\'s guide (“' + clip(best.title, 80) + '”) says:' : 'From ' + (where || 'the site') + (best.title ? ' (“' + clip(best.title, 80) + '”)' : '') + ':')
      + ' “' + excerpt(best.text, qt) + '”' + (where ? ' More on ' + where + '.' : '');
    const also = good.slice(1).find((d) => d.href && d.href !== best.href && d.kind !== 'post' && d.kind !== 'call');
    if (also && best.kind !== 'note') a += ' See also ' + also.href + '.';
    // the sources are the passages the answer used: the one quoted, the page it points to, the one it adds
    const used = [best.href ? best : null, !best.href && where ? { kind: 'map', href: where } : null, also && best.kind !== 'note' ? also : null].filter(Boolean);
    return out('passage', a, used.map((d) => srcOf(labelOf(d), d.href, d.at)), { kinds: good.map((d) => d.kind) });
  }
  const SHILL = /\b(you should|you must|go|time to|everyone should)\s+(buy|ape|load up)\b|\bbuy (it )?(now|before|asap)\b|\bape in\b|\bload up\b|\b(1000|100|10)x\b|\bguaranteed\b|\bnfa\b|\bnot financial advice\b|\bto the moon\b|\bwill (moon|pump)\b/i;
  const shills = (d) => (d.kind === 'post' || d.kind === 'call' || d.kind === 'rated') ? SHILL.test(d.text) : d.kind === 'support' ? d.answers.some((x) => SHILL.test(x.text)) : false;
  const labelOf = (d) => ({ support: 'Support board', post: 'Send Wall', call: 'Send Call', whitepaper: 'White paper', terms: 'Terms', community: 'Communities', map: 'Site map', note: "Sendy's notes", rated: 'Rated answer' }[d.kind] || 'The page ' + String(d.href || '').split(/[?#]/)[0]);
  // the page a question is about, from the site map, for a passage that has no page of its own
  function mapFor(qt) { const h = index.search(qt, { kinds: ['map'], limit: 1 })[0]; return h && h.cover > 0 ? h.doc.href : null; }
  // the sentences of a passage that answer most of the question, quoted as they are written
  function excerpt(text, qt) {
    const ss = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
    let bi = 0, bs = -1;
    ss.forEach((s, i) => { const ts = new Set(terms(s)); const sc = qt.filter((x) => ts.has(x)).length; if (sc > bs) { bs = sc; bi = i; } });
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
    const ctx = { q, page, missed: false, sources: [] };
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
            const text = JSON.stringify(res);
            return { type: 'tool_result', tool_use_id: u.id, content: text.length > TOOL_RESULT_MAX ? text.slice(0, TOOL_RESULT_MAX) + ' …(cut)' : text, ...(res && res.error ? { is_error: true } : {}) };
          });
          msgs.push({ role: 'user', content: results });
          continue;
        }
        const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (!text) return { error: r.stop_reason === 'max_tokens' ? 'cut' : 'empty' };
        return { answer: r.stop_reason === 'max_tokens' ? text + ' …' : text, sources: ctx.sources, missed: ctx.missed };
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
  function sourcesOfTool(res) {
    const s = [];
    if (res.href) s.push(srcOf(res.chain ? 'Market Data · ' + (CHAIN_NAMES[res.chain] || res.chain) : 'Sendy\'s reading', res.href, res.at));
    for (const p of (res.passages || []).slice(0, 2)) if (p.href) s.push(srcOf(labelOf(p), p.href, p.at));
    for (const t of (res.tokens || []).slice(0, 1)) if (t.href) s.push(srcOf(sym(t.symbol), t.href, t.at));
    return s;
  }
  const BUSY = { busy: 'My model is very busy right now, so this is from my own notes: ', timeout: 'My model took too long just now, so this is from my own notes: ' };
  const REFUSED = "That's one I can't help with here. If it's about the site, ask on the Support board (/support), or email " + EMAIL + ' — a person reads both.';

  /* ----- one question, start to finish ----- */
  async function answer({ q, page, history, system }) {
    const t0 = process.hrtime.bigint();
    const hist = (history || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '') })).filter((m) => m.content);
    let res;
    if (ai && system) {
      const m = await askModel({ q, page, history: hist, system });
      if (m.answer) res = { engine: 'model', intent: 'model', answer: m.answer, sources: dedupe(m.sources).slice(0, 4), miss: m.missed };
      else if (m.refused) res = { engine: 'model', intent: 'refused', answer: REFUSED, sources: [srcOf('Support board', '/support')], miss: true };
      else {
        log('[sendy] the model could not answer (' + m.error + ') — answering from the brain');
        const b = await answerBrain(q, page, hist);
        res = Object.assign(b, { answer: (BUSY[m.error] || 'My model could not answer just now, so this is from my own notes: ') + b.answer, fallback: m.error });
      }
    } else res = await answerBrain(q, page, hist);
    if (res.engine === 'brain' && res.miss) miss(q, page, 'brain');
    res.sources = dedupe(res.sources);
    st.answered++; st.lastAnswerMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return res;
  }
  const dedupe = (ss) => { const seen = new Set(); return (ss || []).filter((s) => s && s.href && /^\/(?!\/)/.test(s.href) && !seen.has(s.href) && seen.add(s.href)); };

  function stats() {
    return { model: ai ? MODEL : null, index: { docs: index.size(), kinds: index.kinds(), watermarks: Object.assign({}, wm), files: fileAt.size },
      refresh: { everyMs: REFRESH_MS, rebuildEveryTicks: REBUILD_EVERY, loadedAt: st.loadedAt, ticks: st.ticks, rebuilds: st.rebuilds, lastTickAt: st.lastTickAt, lastTickMs: st.lastTickMs, lastRebuildAt: st.lastRebuildAt, prunedAt: st.prunedAt, maxSliceMs: Math.round(st.maxSliceMs * 10) / 10, errors: st.errors },
      answered: st.answered, lastAnswerMs: st.lastAnswerMs == null ? null : Math.round(st.lastAnswerMs * 10) / 10, tools: Object.keys(TOOLS) };
  }

  return { migrate, start, stop, tick, load, answer, answerBrain, rated, misses, miss, prune, stats, runTool, TOOL_DEFS, tools: Object.keys(TOOLS),
    search: (q, o) => index.search(queryTerms(q), Object.assign({ weight: kindWeight }, o || {})), _test: { index, READ, wm, chainKeyOf, tokenMentions } };
}

module.exports = { createSendyBrain, createIndex, htmlChunks, readmeChunks, termsChunks, readNotes, terms, stem, usd, pct, count, ago, srcName, DEFAULT_MODEL, FALLBACK_MODELS, FALLBACK_BETA };
