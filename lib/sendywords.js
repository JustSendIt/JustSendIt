'use strict';
/* ===== How Sendy reads a message as people actually type it (owner, 2026-10-28: "Make Sendy understand natural language
   patterns") ============================================================================================================
   lib/sendybrain.js knows the shapes of a question — a price, the leaderboard, how a feature works — and searches the site's
   own words. People do not type those shapes. They type "wats the prise of send rn", "whos top of the leaderbord", "hey sendy
   could u tell me how many ppl r on here", two questions in one message, and "whats its market cap?" after a question about a
   token. This module turns a message into the plain sentence it means before the brain reads it:
     · the characters: curly quotes, zero-width marks, emoji, a message typed all in capitals;
     · chat-speak and dropped apostrophes, word for word from a fixed table (u, ur, r, pls, wat, ppl, rn, gonna, mc, liq …);
     · the wrappers around a question ("hey sendy, could you tell me", "i was wondering", "do you know", "quick question"),
       and the ways of asking how ("is there a way to", "i want to", "help me") said as "how do I";
     · number words where a count is asked ("top five");
     · spelling: a word the site never uses, a letter or two from one it does, is read as that word — and the answer says so
       (correct() returns each fix; the brain adds "I read “leaderbord” as “leaderboard”"), so a wrong guess is seen;
     · several questions in one message: sentences() and clauses() cut it where each one starts.
   It never touches a $SYMBOL, an @name, an address, a link or a path, and spelling never touches a word typed in capitals
   (a symbol), a number, or a word the site has seen people use. It never decides what a question is about — the brain does,
   on the plain sentence, and it reads the guard-rail questions (advice, seed phrases, Robinhood) on the message as typed
   too, so tidying can only add a reading, never take one away. Nothing here reads data: the brain hands correct() the words
   it may correct to. */

/* ----- spelling distance: Damerau–Levenshtein (a swapped pair of letters is one slip), given up past max ----- */
function distance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let low = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < low) low = v;
    }
    if (low > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}

/* ----- the characters ----- */
const PICTO = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
function tidyChars(q) {
  const s0 = String(q == null ? '' : q).normalize('NFKC').replace(/[​‌⁠﻿]/g, '')
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»„]/g, '"');
  // the emoji that are words here ("💎🙌" is diamond hands), and dictation ("… question mark")
  let s = (/diamond ?hands?/i.test(s0) ? s0 : s0.replace(/💎\s*🙌|🙌\s*💎/gu, ' diamond hands ')).replace(PICTO, ' ')
    .replace(/\s+(?:question mark|questionmark)\s*$/i, '?').replace(/\s+(?:exclamation (?:mark|point)|full stop|period)\s*$/i, '.')
    .replace(/\s+/g, ' ').trim();
  // a symbol spelled out a letter at a time ("g w c", "Z Q R H"): one word — three letters or more, so "a b" in a sentence stays
  s = s.replace(/(?<![\w$@])[A-Za-z](?:[ .][A-Za-z]){2,9}(?![\w])/g, (m) => {
    const ls = m.split(/[ .]/), tail = [];
    while (ls.length > 3 && /^[ai]$/.test(ls[ls.length - 1])) tail.unshift(ls.pop());   // "z q r h a scam": the "a" is the article
    if (ls.filter((l) => /^[ai]$/i.test(l)).length > 1) return m;                          // "I A M": words, not a symbol
    return ls.join('') + (tail.length ? ' ' + tail.join(' ') : '');
  })
    .replace(/\bp\s*(?:&|and|n)\s*l\b/gi, 'PNL');
  // a message of emoji alone: a wave is a hello, a thumbs-up or a heart is a thanks, a rocket is a hello too
  if (!/[\p{L}\p{N}]/u.test(s) && s0.trim()) s = /🙏|👍|❤|💙|💜|💚|🧡|💛|👌|💯|🙌|👏/u.test(s0) ? 'thanks' : /[\p{Extended_Pictographic}]/u.test(s0) ? 'hi' : s;
  // a message typed all in capitals: its words as words (a $SYMBOL and an address keep theirs). One word alone is a symbol.
  const caps = s.match(/[A-Za-z]{2,}/g) || [];
  if (caps.length >= 2 && !/[a-z]/.test(s)) s = s.replace(/(\$[A-Z0-9][\w.-]*|0x[0-9A-F]{6,64})|[A-Z]+/g, (m, keep) => keep || m.toLowerCase());
  return s;
}

/* ----- chat-speak and dropped apostrophes: whole words, typed in lower case (or with a capital first letter) ----- */
const SPEAK = {
  u: 'you', ya: 'you', yu: 'you', ur: 'your', urs: 'yours', r: 'are', ru: 'are you',
  wat: 'what', wut: 'what', wht: 'what', waht: 'what', whta: 'what', wot: 'what', whut: 'what', wats: 'what is', whats: 'what is', wuts: 'what is', whts: 'what is', watz: 'what is', whatz: 'what is',
  whatre: 'what are', hows: 'how is', howz: 'how is', hw: 'how', hwo: 'how', howw: 'how', whos: 'who is', hoos: 'who is', wheres: 'where is', whers: 'where is', wher: 'where', whr: 'where', whens: 'when is', wen: 'when',
  whys: 'why is', wich: 'which', wch: 'which', whcih: 'which',
  pls: 'please', plz: 'please', pleas: 'please', plss: 'please', plox: 'please', pleez: 'please', pleaze: 'please', plis: 'please',
  thx: 'thanks', thnx: 'thanks', thanx: 'thanks', tnx: 'thanks', thks: 'thanks', tks: 'thanks', ty: 'thanks', tysm: 'thanks so much', tyvm: 'thanks very much', thnks: 'thanks', thanku: 'thank you', thankyou: 'thank you',
  ppl: 'people', ppls: 'people', peeps: 'people', abt: 'about', bout: 'about', rn: 'right now', rnow: 'right now', atm: 'right now', '2day': 'today', tdy: 'today', tmrw: 'tomorrow', tmr: 'tomorrow', tmrow: 'tomorrow', b4: 'before',
  cuz: 'because', coz: 'because', bc: 'because', bcuz: 'because', bcoz: 'because', becuz: 'because',
  gonna: 'going to', gona: 'going to', wanna: 'want to', wana: 'want to', gotta: 'have to', gimme: 'give me', gimmie: 'give me', lemme: 'let me', dunno: 'do not know', idk: 'I do not know', tho: 'though', thru: 'through',
  im: 'I am', ive: 'I have', dont: 'do not', doesnt: 'does not', didnt: 'did not', cant: 'cannot', wont: 'will not', isnt: 'is not', arent: 'are not', wasnt: 'was not', werent: 'were not',
  havent: 'have not', hasnt: 'has not', couldnt: 'could not', shouldnt: 'should not', wouldnt: 'would not', youre: 'you are', theyre: 'they are', thats: 'that is', theres: 'there is', whered: 'where did', howd: 'how did',
  msg: 'message', msgs: 'messages', pic: 'picture', pics: 'pictures', acct: 'account', accnt: 'account', addy: 'address', addr: 'address', pfp: 'profile picture',
  mc: 'market cap', mcap: 'market cap', mktcap: 'market cap', marketcap: 'market cap', mkt: 'market', liq: 'liquidity', vol: 'volume', txs: 'transactions', txns: 'transactions', tx: 'transaction',
  wbu: 'what about', hbu: 'how about', wby: 'what about', poppin: 'popping', pumpin: 'pumping', dumpin: 'dumping', moonin: 'mooning', tankin: 'tanking', crashin: 'crashing', runnin: 'running',
  sned: 'send', sedn: 'send', sendd: 'send', gcw: 'gwc', wgc: 'gwc', mvp: 'top sender', recomend: 'recommend', reccomend: 'recommend',
  shud: 'should', shld: 'should', shuld: 'should', cud: 'could', wud: 'would', lvl: 'level', lvls: 'levels', ammount: 'amount', bal: 'balance',
  lookin: 'looking', goin: 'going', tryin: 'trying', doin: 'doing', sayin: 'saying', makin: 'making', gettin: 'getting', buyin: 'buying', sellin: 'selling',
  holdin: 'holding', talkin: 'talking', thinkin: 'thinking', workin: 'working', wonderin: 'wondering', nothin: 'nothing', somethin: 'something', checkin: 'checking',
  some1: 'someone', sum1: 'someone', any1: 'anyone', every1: 'everyone', no1: 'no one', elses: "else's",
  // the site's names run together
  sendcall: 'Send Call', sendcalls: 'Send Calls', sendpower: 'Send Power', sendsquad: 'Send Squad', sendsquads: 'Send Squads', sendwall: 'Send Wall',
  rocketrun: 'Rocket Run', diamondhands: 'Diamond Hands', newpairs: 'New Pairs', marketdata: 'Market Data', walletracker: 'wallet tracker', wallettracker: 'wallet tracker',
};
// what dictation and a quick thumb make of the site's words, as phrases
const SOUNDS = [[/\b(?:knew|new) (?:pears|pares)\b|\bknew pairs\b/gi, 'new pairs'], [/\bleader ?(?:bored|bord|boared)\b/gi, 'leaderboard'], [/\b(?:sent|cent|scent) calls?\b/gi, (m) => (/s$/i.test(m) ? 'Send Calls' : 'Send Call')],
  [/\b(how (?:do|can|would|should) i|want to|wanna|where (?:to|do i|can i)|to|gonna)\s+by\s+(?=\$?[a-z])/gi, '$1 buy '], [/\bsend it (?:token|coin)s?\b/gi, 'send token'], [/\bwhat means\b/gi, 'what is'],
  [/\bwho (?:is|are) (?:the )?best player\b/gi, 'who is the best player'], [/\b(?:explain|tell|show) (?:me |us )?(?:the )?steps (?:for|to|of)\s+/gi, 'how do I '], [/\bhow (?:much|many) peoples?\b/gi, 'how many people']];
// words that only pad a message where they open it ("bro, what is …") or close it ("… ser?", "… thanks!") — a thanks only at the end
const PAD = 'sendy|ser|sir|fam|bro|bruh|bros|guys|mate|dude|fren|frens|friend|friends|boss|homie|pal|man|lol|lmao|lmfao|haha+|hehe+|xd|please|kindly|asap';
const PAD_END = PAD + '|thanks|thank you|thanks so much|thanks very much|thanks a lot|cheers|in advance|thanks in advance|fr|tbh|ngl|or nah|or not';
const LEAD = [
  // a greeting, and who it greets, before the question
  new RegExp('^(?:he+y+|hi+|hello|helo|yo+|oi|hiya|heya|howdy|gm|gn|sup|wassup|ok(?:ay)?|so|well|um+|uh+|hm+|alright|right|ah|oh)\\b[\\s,!.:;-]*(?:(?:there|' + PAD + ')\\b[\\s,!.:;-]*)*', 'i'),
  new RegExp('^(?:' + PAD + ')\\b[\\s,!.:;-]+', 'i'),
  /^(?:(?:a |one )?(?:quick|simple|dumb|stupid|small|random|silly)\s+)?(?:question|q)\s*(?:for\s+(?:you|ya|sendy))?\s*[:,!.?-]+\s*/i,
  /^i\s+(?:have|got)\s+a\s+(?:quick\s+|simple\s+)?question\b[\s:,.!-]*(?:for\s+(?:you|ya|sendy)[\s:,.!-]*)?/i,
  // "could you (please) tell me what …" — what is asked, not the asking
  /^(?:can|could|would|will|cud|can't)\s+(?:you|someone|somebody|anyone|anybody)\s+(?:please\s+|kindly\s+)?(?:tell|let)\s+me\s+(?:know\s+)?(?=(?:what|how|who|where|when|which|why|if|whether|is|are|the|a|an)\b)/i,
  /^(?:can|could|would|will|cud)\s+(?:you|someone|somebody|anyone|anybody)\s+(?:please\s+|kindly\s+)?(?=(?:tell|show|explain|give|list|find|check|look|say|help|get|pull|walk)\b)/i,
  /^(?:please|kindly)\b[\s,]*/i,
  /^(?:i\s+(?:was|am)\s+|i'm\s+)?(?:just\s+)?(?:wondering|curious)\b\s*(?:about\s+)?(?:if\s+|whether\s+)?/i,
  /^(?:do|does)\s+(?:you|anyone|anybody|someone|somebody)\s+know\s+(?:if\s+|whether\s+)?/i,
  /^(?:any|some)\s+ideas?\s+(?:on\s+|about\s+|if\s+|whether\s+)?/i,
  /^(?:i\s+)?(?:want|need|would like|'d like|would love)\s+to\s+(?:know|find out|see|check|learn|understand)\s+(?:about\s+)?(?:if\s+|whether\s+)?/i,
  /^(?:tell|show)\s+me\s+(?=(?:what|how|who|where|when|which|why|if|whether)\b)/i,
  /^(?:help(?:\s+me)?(?:\s+please)?)\s*[:,!.]+\s*/i,
  /^(?:but|wait|hmm+|honestly|basically|actually)\b[\s,]*(?:so\b[\s,]*)?/i,
  /^(?:(?:two|2|three|3|a couple of|a few|couple|few)\s+(?:things|questions|qs)|i have (?:two|2|three|3|a couple of|a few) (?:questions|things))\s*[:,-]?\s*/i,
  /^(?:thanks|thank you|thx|cheers)\b[\s!.,]+(?=(?:and|what|how|who|where|when|which|why|can|could|is|are|do|does)\b)/i,
];
// "… like i'm 5", "… in simple terms": how simply to say it, not what to say
const SIMPLY = /\s*,?\s*(?:like (?:i am|i'm|im) (?:5|five|a (?:kid|child|beginner|noob|newbie))|eli5|in (?:simple|plain|easy) (?:terms|words|english)|simply|for (?:dummies|a beginner|beginners|a noob|noobs|newbies))\s*(?=[?!.]*\s*$)/i;
const TAIL = new RegExp('(?:[\\s,;:-]*\\b(?:' + PAD_END + '|if you can|if possible|when you can|real quick|quick)\\b[.!]*)+(?=[\\s!?.]*$)', 'i');
// "… but idk where to start": the asking, not the question
const SHRUG = /\s*,?\s*(?:but|and)\s+(?:i\s+(?:do not|don't|dont)\s+know|i\s+am\s+not\s+sure|not\s+sure|no\s+idea)\s+(?:where\s+to\s+(?:start|begin|look)|how|what\s+to\s+do)\b[^?!.]*/i;
// "how do I go about buying …": the verb, said plainly
const GERUND = { buying: 'buy', making: 'make', getting: 'get', changing: 'change', posting: 'post', using: 'use', connecting: 'connect', adding: 'add', creating: 'create', joining: 'join', setting: 'set', putting: 'put', selling: 'sell', starting: 'start', finding: 'find', checking: 'check', scanning: 'scan', linking: 'link', verifying: 'verify', deleting: 'delete', swapping: 'swap' };
// the ways of asking how, said the way the brain reads them
const REPHRASE = [
  [/^(?:is there (?:a|any) way (?:to|i can|for me to)|what is the (?:best |easiest |right )?way to|what's the (?:best |easiest |right )?way to|steps to|how would i|how 2|how should i)\s+/i, 'how do I '],
  [/^(?:i\s+)?(?:want|need|would like|'d like|wish)\s+to\s+(?=[a-z])(?!know\b|be\b|ask\b)/i, 'how do I '],
  [/^(?:walk me through|talk me through|guide me through|take me through)\s+/i, 'how do I '],
  [/^how (?:i can|i do|i could|i should|can i do|i)\s+(?=[a-z])/i, 'how do I '],
  [/^(?:i\s+am|i'm)\s+(?:trying|looking)\s+to\s+/i, 'how do I '],
  [/^i\s+(?:cannot|can't|could not|couldn't)\s+(?:figure out|work out|find out|see)\s+how\s+to\s+/i, 'how do I '],
  [/^i\s+(?:do not|don't)\s+(?:know|understand|get)\s+how\s+to\s+/i, 'how do I '],
  [/^(?:help me|teach me(?: how)?(?: to)?|show me how to)\s+(?=[a-z])(?!out\b|please\b)/i, 'how do I '],
  [/^where (?:can|do|would|could|should) (?:i|you|one) (?:find|see|get to|go to|go for|look at|look for|check)\s+/i, 'where is '],
  [/^(?:can|could|may) (?:i|you|we) (?:look up|check|see|view|watch|follow|spy on|track|monitor|keep an eye on)\s+(?:someone(?: else)?'s|somebody(?: else)?'s|other people's|another person's|another|a friend's|my friend's|any|an?|other)\s+(?:wallets?|address(?:es)?)\b(?:\s+(?:here|on here|on this site))?/i, 'how do I track a wallet'],
  [/^where do i go (?:to|for)\s+/i, 'how do I '],
];
const NUMBER = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

// a word may be rewritten only where it stands as a word — never inside $SYM, @name, an address, a path, a link or an email
const WORD = /(^|[^\w$@/#.'-])([A-Za-z0-9]+)(?![\w@/-]|\.[A-Za-z0-9]|'[a-z])/g;
const plainCase = (w) => w === w.toLowerCase() || (w.length > 1 && w.slice(1) === w.slice(1).toLowerCase()) || w.length <= 2;

function expand(s) {
  for (const [re, to] of SOUNDS) s = s.replace(re, to);
  // "ur not robinhood", "ur the best": you are
  s = s.replace(/\bur\s+(?=(?:not|a|an|the|so|very|just|really|from|with|in|on|part|robinhood|robin|official|human|a bot|bot|real|gonna|going|sure|right|wrong|welcome|amazing|awesome|great|legend)\b)/gi, 'you are ');
  s = s.replace(/\s&\s/g, ' and ').replace(/\bw\/o\b/gi, 'without ').replace(/\bw\/(?=\s|[a-z])/gi, 'with ');
  // "where's", "who's", "how's": said in full (a question word with its "is")
  s = s.replace(/\b(what|where|who|how|when|why|that|there)'s\b/gi, (m, w) => w + ' is');
  // "n" for "and": between two words, or opening a follow-up ("n gwc?")
  s = s.replace(/^n\s+(?=[a-z$@])/i, 'and ').replace(/(?<=[a-z0-9])\s+n\s+(?=[a-z$@])/gi, ' and ');
  s = s.replace(WORD, (m, pre, w) => {
    const lw = w.toLowerCase(), to = SPEAK[lw];
    if (!to || !plainCase(w)) return m;
    return pre + (w[0] !== lw[0] && to[0] !== 'I' ? to[0].toUpperCase() + to.slice(1) : to);
  });
  // "how 2 buy", "price 4 send": a digit for a word, only where the word is the only reading
  s = s.replace(/\b(how|want|need|have|got|go|able|trying|try|way|where|wanna|going|due|used|has|had)\s+2\s+(?=[a-z])/gi, '$1 to ')
    .replace(/\b(price|prices|info|information|stats|data|chart|link|search|look|address|contract|scan|cap|liquidity|volume)\s+4\s+(?=[a-z$])/gi, '$1 for ');
  // "y is …", "y cant …" opening a question: why
  s = s.replace(/^y\s+(?=(?:is|are|do|does|did|cannot|can't|will not|won't|is not|isn't|does not|doesn't|did not|didn't|not)\b)/i, 'why ');
  return s.replace(/\s+/g, ' ').trim();
}
function unwrap(s) {
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const re of LEAD) {
      const m = re.exec(s);
      if (m && m[0] && /[A-Za-z0-9$@]/.test(s.slice(m[0].length))) { s = s.slice(m[0].length).trim(); changed = true; }
    }
    const t = s.replace(TAIL, '').trim();
    if (t !== s && /[A-Za-z0-9$@]/.test(t)) { s = t; changed = true; }
    if (!changed) break;
  }
  s = s.replace(SHRUG, '').replace(SIMPLY, '').trim();
  for (const [re, to] of REPHRASE) if (re.test(s)) { s = s.replace(re, to); break; }
  s = s.replace(/^(how do I|how (?:can|would|should) i)\s+go about\s+([a-z]+ing)\b/i, (m, h, g) => 'how do I ' + (GERUND[g.toLowerCase()] || g))
    .replace(/^how do I\s+([a-z]+ing)\b/i, (m, g) => 'how do I ' + (GERUND[g.toLowerCase()] || g));
  // "how do i get some $send", "where can i grab gwc": buying, said as buying
  s = s.replace(/^(how (?:do|can|would|should) i|how to|where (?:do|can) i)\s+(?:even\s+|actually\s+|really\s+|just\s+)?(?:get|grab|pick up|purchase|acquire|cop|snag|get my hands on|get hold of|ape into|ape in)\s+(?:some\s+|a bit of\s+|a few\s+|more\s+)?(?=\$[a-z]|send\b|gwc\b|(?:the |this |that |these )?(?:token|coin)s?\b)/i, (m, h) => h + ' buy ');
  s = s.replace(/\b(top|first|last|best|biggest|largest|lowest|bottom|worst|newest|latest)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/gi, (m, a, n) => a + ' ' + NUMBER[n.toLowerCase()]);
  return s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+/, '').trim();
}

/* ----- spelling: lex.known(word) — a word the site uses; lex.best(word) — the word it is a slip of, or null ----- */
function correct(s, lex) {
  const fixes = [];
  if (!lex) return { text: s, fixes };
  const text = s.replace(WORD, (m, pre, w) => {
    if (!/^[A-Za-z][a-z]{3,24}$/.test(w)) return m;   // letters only, lower case (a capital first letter is a sentence's)
    const lw = w.toLowerCase();
    if (SPEAK[lw] || lex.known(lw)) return m;
    const to = lex.best(lw);
    if (!to || to === lw) return m;
    fixes.push({ from: lw, to });
    return pre + (w[0] !== lw[0] ? to[0].toUpperCase() + to.slice(1) : to);
  });
  return { text, fixes };
}

/* ----- one message, read: { text: the plain sentence, raw: the characters tidied, fixes: the spellings read otherwise } ----- */
function read(q, lex) {
  const raw = tidyChars(q);
  const plain = unwrap(expand(raw));
  const { text, fixes } = correct(plain || raw, lex);
  return { raw, text: text || raw, fixes };
}

/* ----- several questions in one message ----- */
// at ? and !, at a full stop that ends a sentence (never one in a number, a path or a link), at a new line or a semicolon
function sentences(s) {
  return String(s).split(/(?<=[?!])\s+(?=\S)|(?<=[A-Za-z)\]"'])[.](?=\s+[A-Za-z$@])\s+|\s*[\n;]+\s*/).map((x) => x.trim()).filter((x) => /[A-Za-z0-9$@]/.test(x)).slice(0, 4);
}
// within one sentence: "… and …", "… also …", "… plus …", "… as well as …"
function clauses(s) {
  return String(s).split(/\s*,?\s+(?:and also|and then|and|also|plus|as well as)\s+|\s*,?\s+or\s+(?=(?:what|which|how|where|who|should|can|could|do|does|is|are)\b)|\s*,\s+(?=(?:what|which|how|where|who|when|why|should|can|could|do|does|is|are|r)\b)/i).map((x) => x.trim()).filter((x) => /[A-Za-z0-9$@]/.test(x)).slice(0, 3);
}

module.exports = { read, tidyChars, expand, unwrap, correct, distance, sentences, clauses, SPEAK };
