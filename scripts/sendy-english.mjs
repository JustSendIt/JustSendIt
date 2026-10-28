#!/usr/bin/env node
/* ===== node scripts/sendy-english.mjs — Sendy's spelling guard, lib/sendy-english.txt =====================================
 * Sendy reads a slip of a word as the word ("leaderbord" → "leaderboard", lib/sendybrain.js LEX). A real English word the
 * site's pages happen not to use must never be "corrected" that way: "lunch" is not "launch", "steak" is not "stake". The
 * guard is the list of real words a slip away from a word Sendy corrects to, and Sendy treats every word on it as known.
 *
 * It also holds the dictionary words the site's own pages use ("link", "bridge", "higher"), so a word of English that is
 * also some token's symbol is read as the word unless it is typed as one ($LINK, LINK); a symbol that is no word ("pepe")
 * stays a symbol.
 *
 * Read from this Mac's dictionary (/usr/share/dict/words, Webster's Second) against the words Sendy corrects to — the site's
 * own passages (a brain over this checkout's files, no data), the words his questions turn on, and the common words — with
 * the same rule as the brain (one slip, two for a word of eight letters or more, the same first letter). Run it again after
 * the pages gain many new words; the list is committed, so every checkout and the CI read the same one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SB = require(path.join(ROOT, 'lib', 'sendybrain.js')), MD = require(path.join(ROOT, 'lib', 'marketdata.js')), W = require(path.join(ROOT, 'lib', 'sendywords.js'));
const DICT = process.env.DICT || '/usr/share/dict/words';
if (!fs.existsSync(DICT)) { console.error('no dictionary at ' + DICT + ' (DICT=<file> to name one)'); process.exit(1); }

// a brain over the site's own files and an empty database: its index holds the pages' words and nothing else
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, points INTEGER DEFAULT 0, system INTEGER DEFAULT 0, deleted_at INTEGER, created_at INTEGER);
  CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, text TEXT, board TEXT, community_id INTEGER, call_id INTEGER, private INTEGER DEFAULT 0, squad_id INTEGER, created_at INTEGER);
  CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER, text TEXT, created_at INTEGER);
  CREATE TABLE calls (id INTEGER PRIMARY KEY, user_id INTEGER, token_addr TEXT, symbol TEXT, name TEXT, post_id INTEGER, squad_id INTEGER, wallet TEXT, created_at INTEGER);
  CREATE TABLE communities (id INTEGER PRIMARY KEY, symbol TEXT, name TEXT, token_addr TEXT, status TEXT, official INTEGER, demo INTEGER, member_count INTEGER, qual_count INTEGER, c_price REAL, c_mc REAL, c_liq REAL, c_holders INTEGER, c_at INTEGER, created_at INTEGER, went_live_at INTEGER);
  CREATE TABLE squads (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE token_cache (token_addr TEXT, pair_json TEXT, symbol TEXT, name TEXT, found INTEGER, reads INTEGER, updated_at INTEGER);
  CREATE TABLE sendy_qa (id INTEGER PRIMARY KEY, q TEXT, a TEXT, page TEXT, at INTEGER, up INTEGER DEFAULT 0, down INTEGER DEFAULT 0);`);
MD.migrate(db);
const brain = SB.createSendyBrain({ db, root: ROOT, siteMap: '' });
brain.migrate();
await brain.tick();
const targets = brain._test.spellTargets(), vocab = brain._test.index.vocab();
brain.stop();

const byLen = new Map();
for (const w of targets) { let b = byLen.get(w.length); if (!b) byLen.set(w.length, (b = [])); b.push(w); }
const near = new Set();
// words of today's English that a dictionary of 1934 never had: "pricey" is not "price"
const MODERN = ['pricey', 'pricy', 'scammy', 'spammy', 'hypey', 'legit', 'lowkey', 'noob', 'noobs', 'newbie', 'newbies', 'techy', 'overhyped', 'overpriced', 'underpriced', 'undervalued', 'overvalued'];
for (const w of fs.readFileSync(DICT, 'utf8').split('\n').concat(MODERN)) {
  if (!/^[a-z]{3,24}$/.test(w)) continue;
  if (vocab.has(w)) { near.add(w); continue; }   // a word of English the pages use
  if (w.length < 4) continue;
  const max = w.length >= 8 ? 2 : 1;
  find: for (let L = w.length - max; L <= w.length + max; L++) for (const c of byLen.get(L) || []) if (c !== w && c[0] === w[0] && W.distance(w, c, max) <= max) { near.add(w); break find; }
}
const out = path.join(ROOT, 'lib', 'sendy-english.txt');
fs.writeFileSync(out, [...near].sort().join('\n') + '\n');
console.log(near.size + ' words (a slip from the ' + targets.length + ' Sendy corrects to, or on the pages) → ' + path.relative(ROOT, out) + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
process.exit(0);
