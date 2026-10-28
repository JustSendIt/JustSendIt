/* Sendy — the $Send rocket in the corner: greets, tips, and answers questions in chat.
   The look is the 3D Sendy of the marketing videos, rendered from their model, camera and lights by scripts/sendy-3d.py:
   the idle loop as a sprite sheet (/assets/sendy-idle.png, 30 frames), a still for the chat header (/assets/sendy.png),
   and the faces he pulls in the videos as short clips he plays when someone reaches for him (/assets/sendy-act-*.webp,
   listed in /assets/sendy-acts.json).
   Phone: pinned above the bottom controls, never dragged, never in the way of anything.
   Desktop: floats, takes a short flight along the edges now and then, and can be dragged anywhere — once
   dragged, it stays where it was put.
   Chat: POST /api/sendy/ask — the server's brain (lib/sendybrain.js) answers from the site's own pages and its live public
   data, with or without a model key, and says where each figure came from. The built-in notes below answer only when the
   server cannot be reached (the server indexes these same notes, so the two never disagree); anything they do not cover is
   handed to a person: the Support board, or the email. */
(function () {
  'use strict';

  const EMAIL = 'SendRH@Atomicmail.io';
  const MAILTO = 'mailto:' + EMAIL + '?subject=Question%20about%20sendrh.com';
  const FRAMES = 30;                                        // frames in the sprite sheet (2s loop)
  const isMobile = () => window.innerWidth < 768;
  const coarse = () => !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);   // a finger: a phone or a tablet, at any width
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('motion-off');   // the site's ⏸ switch counts too
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the built-in notes: what Sendy can say when the server cannot be reached (it indexes them too) ---------- */
  const knowledgeBase = {
    'send power': {
      keywords: ['send power', 'power', 'points', 'leaderboard', 'level'],
      answer: 'Send Power is your score on $Send. You earn it by making Send Calls on the Wall, taking part in communities and being active; it decays if you go quiet. The About page (/about) has every rule, and your dashboard shows where yours comes from.'
    },
    'send call': {
      keywords: ['send call', 'call', 'how to call', 'make a call'],
      answer: 'A Send Call is a public, permanent scorecard on a token you picked. Scan a token in the Scanner (/newpairs), then tap "Send Call to the Wall". If you are in a Send Squad you can make the call private to the squad instead. Calls stay on record even if the account is deleted.'
    },
    'scanner': {
      keywords: ['scanner', 'scan', 'token address', 'on-chain', 'new pairs', 'radar'],
      answer: 'The Scanner (/newpairs) reads any token or pool address on Robinhood Chain: holders, market, price history, the contract. Paste the address and tap Scan. It is a reading of public chain data, not an audit — nothing on it is a promise.'
    },
    'wallet': {
      keywords: ['wallet', 'link wallet', 'track', 'holdings', 'pnl', 'tracker', 'cost basis'],
      answer: 'The wallet tracker (/tracker) tracks any wallet on Robinhood Chain — holdings, every token transaction, a value-over-time chart, cost basis and PNL, read from the chain by this site. On the public node a wallet\'s first read can take an hour or more. You can leave: it keeps its place in line, keeps reading, is saved, and you get a notification when it is ready (or when the node refuses it for so long that it stops — it goes on from where it stopped when you come back). Later refreshes read only what is new and take seconds. Linking a wallet to your account happens on your profile (/profile) and is how the site checks what you hold.'
    },
    'which wallet': {
      keywords: ['which wallet', 'what wallet', 'best wallet', 'wallet should i', 'wallet to use', 'get a wallet', 'install a wallet', 'download a wallet'],
      answer: 'Step 1 of the How to Buy guide (/guide) lists the wallets that connect here, with links to install them. Only ever download a wallet from its official site or your phone\'s app store, and never type its seed phrase into a website or give it to anyone. Connecting a wallet here is read-only: you sign a message to prove it\'s yours, and that\'s all it can ever do.'
    },
    'squad': {
      keywords: ['squad', 'send squad', 'private group'],
      answer: 'A Send Squad is a private, token-gated group. Members can make Send Calls that only the squad sees, and the squad earns points together. Start one or find yours under Communities (/communities); only verified members count toward a squad\'s gate.'
    },
    'community': {
      keywords: ['community', 'communities', 'join'],
      answer: 'Communities gather around a token — $Send and $GWC have their own from day one. Hold the token and opt in to unlock the holders-only wall and proposals; while you are in a live one, everything you earn anywhere on the site gets a flat 10× boost (boosts add up, they do not multiply). Start on /communities.'
    },
    'watchlist': {
      keywords: ['watchlist', 'save token', 'star', 'saved'],
      answer: 'Your Watchlist (/watchlist) holds the tokens you saved. Scan a token and tap its ☆ to keep it; from the list you can jump back to a full scan or make a Send Call.'
    },
    'report': {
      keywords: ['report', 'spam', 'inappropriate', 'moderator', 'remove'],
      answer: 'Every post and comment has a report control — use it and a moderator will look. For anything that needs a person right away, email ' + EMAIL + ' with a link and a sentence about what is wrong.'
    },
    'safety': {
      keywords: ['safe', 'security', 'risk', 'dyor', 'research', 'rug', 'scam', 'should i buy', 'should i sell', 'go up', 'moon', 'price prediction'],
      answer: 'Nothing here will ever tell you to buy — that is not what the site does. Read the token in the Scanner (/newpairs), look at the liquidity, the holders and the contract, and decide for yourself. Everything on this site is entertainment, not financial advice, and it is not affiliated with Robinhood.'
    },
    'how to buy': {
      keywords: ['how to buy', 'how do i buy', 'where to buy', 'where can i buy', 'get send', 'get gwc', 'swap', 'bridge', 'robinhood wallet'],
      answer: 'The How to Buy guide (/guide) walks through it in five steps: get a wallet and lock down its seed phrase, add Robinhood Chain to it, bridge some ETH over, swap it into $SEND or $GWC on the swap (/swap) — which fills in the real contract address — and then see your bags. It is a guide, not a tip: memecoins are maximum-risk entertainment, and nothing here tells anyone to buy.'
    },
    'market data': {
      keywords: ['market data', 'tvl', 'market cap', 'top tokens', 'top chains', 'chain stats', 'liquidity', 'volume', 'fees'],
      answer: 'Market Data (/market) has the figures for Robinhood Chain and the other chains — DeFi TVL, DEX volume, liquidity, fees, stablecoins, market caps — and the top tokens of a chain or of every chain, sortable over a time frame. Every figure names its source (DefiLlama, L2BEAT, growthepie, GeckoTerminal, Dexscreener, the chain itself) and when it was read; one nobody could read says why instead of showing a zero.'
    },
    'arcade': {
      keywords: ['arcade', 'competition', 'biggest sender', 'rocket run', 'prize', 'weekly', 'leaderboard'],
      answer: 'The Arcade (/arcade) holds the weekly competitions and their boards: Biggest Sender (the most Send Power earned this week — the top ten win a boost for the week after), the Send Calls board, the community race, and Rocket Run, the free once-a-day game. The all-time leaderboard is there too.'
    },
    'data api': {
      keywords: ['data api', 'api key', 'send api', 'developer', 'export my data'],
      answer: 'The Data API (/data) serves the site\'s public data — and your own account\'s data — to programs, read-only, behind a key. The key is backed by a $SEND burn from your linked wallets; the page explains how, and the limits per key.'
    },
    'appeal': {
      keywords: ['appeal', 'restricted', 'strike', 'suspended', 'read-only', 'muted', 'banned'],
      answer: 'If your account was restricted, there is a free appeal: email ' + EMAIL + ' with your account name and what happened, and a person will look at it. Strikes never expire on their own, but an appeal can lift a restriction.'
    },
    'account': {
      keywords: ['sign in', 'login', 'log in', 'password', 'two-factor', '2fa', 'delete my account', 'username', 'invite'],
      answer: 'Your account lives on /profile: username, sign-in methods, two-factor, linked wallets, and the delete control (deleting is permanent). Joining is by invite code, and nobody here will ever ask for your password, a seed phrase or a private key.'
    },
    'support': {
      keywords: ['support', 'help', 'question', 'contact', 'email'],
      answer: 'Two ways to reach a person: ask on the Support board (/support), where the community and the team answer in public, or email ' + EMAIL + ' for anything private. Both are free.'
    }
  };
  // the note whose keywords cover most of the question (a longer keyword says more than a short one); null when none does
  function findAnswer(question) {
    const q = question.toLowerCase();
    let best = null, top = 0;
    for (const entry of Object.values(knowledgeBase)) {
      const score = entry.keywords.reduce((s, k) => s + (q.includes(k) ? k.length : 0), 0);
      if (score > top) { top = score; best = entry; }
    }
    return best ? best.answer : null;
  }

  /* ---------- tips per page ---------- */
  const pageTips = {
    '/': { tips: ['New here? The How to Buy guide is on this page, under the hero.', 'Drag me anywhere on a desktop — I stay where you put me.', 'Anything you cannot find: ask me, or the Support board.'] },
    '/about': { tips: ['Everything about Send Power and the leaderboard is on this page.', 'Send Calls are permanent — they outlive the account that made them.', 'Strikes never expire on their own, but an appeal by email is free.'] },
    '/newpairs': { tips: ['Paste any token or pool address to read its market, holders, contract and first buyers.', 'Tap the ☆ on a scan to save the token to your Watchlist.', 'The buttons under a scan open a Send Call — to the Wall, or to your Squad.', 'A scan is public chain data, not an audit. Nothing here is a promise.'] },
    '/wall': { tips: ['The Send Wall is every Send Call, live, as a permanent scorecard.', 'Tap a name to open that person\'s own Send Wall.', 'Deep liquidity and steady price make a call easier to read — never a guarantee.'] },
    '/support': { tips: ['Ask in public here; answers that solve it get voted up.', 'Prefer private? Email ' + EMAIL + ' — a person reads it.', 'Answering someone else\'s question counts too.'] },
    '/profile': { tips: ['Link a wallet here — it is how the site checks what you hold.', 'Two-factor keeps the account yours; nobody here asks for passwords.', 'Deleting the account is permanent; Send Calls stay under a placeholder.'] },
    '/watchlist': { tips: ['Saved tokens land here. Scan one and tap its ☆.', 'Each saved token opens straight back into a full scan.', 'A Send Call can start from here too.'] },
    '/communities': { tips: ['$Send and $GWC have their own communities, run by the site.', 'Hold the token and opt in: while you are in a live one, everything you earn gets a flat 10× boost.', 'Send Squads are the private, token-gated version.'] },
    '/community': { tips: ['The holders-only wall opens once your linked wallet passes the gate.', 'Proposals let the community decide things together.', 'Tap the founder\'s name to see their Send Wall.'] },
    '/squad': { tips: ['Squad calls are private to the squad and score for it.', 'Only verified members count toward the gate.', 'The 🛡️ button on any token scan calls it to this squad.'] },
    '/tracker': { tips: ['Track any wallet: holdings, every token transaction, a value chart, cost basis, PNL — read from the chain.', 'On the public node a first read can take an hour or more — leave the page: it keeps its place in line, keeps reading, is saved, and you get a notification when it is ready (or when the node refuses it for so long that it stops; it goes on from where it stopped when you come back). Later refreshes take seconds.', 'The explorer never learns which wallets you look at; this site reads them.', 'A wallet you track reopens from its saved report; a refresh reads only what is new.'] },
    '/arcade': { tips: ['The weekly competitions live here, with their boards.', 'Biggest Sender resets every week.', 'Tap any name on a board to open their Send Wall.'] },
    '/market': { tips: ['Pick a chain or a token in the side list, or search for one: the main view shows everything we could read about it.', 'Every figure names its source and when it was read. A figure nobody could read says why — it is never shown as zero.', 'A list sorted lowest-first is lowest among what the source lists, not lowest on the whole chain.'] },
    '/data': { tips: ['The Data API is read-only public data behind a key.', 'Keys are the burn kind — the docs on this page say how.', 'Limits are per key; the page lists them.'] }
  };
  // the page, by its name: /about (an old /about.html or a trailing / reads the same); the home page's sections are the home page
  const path = () => { const p = location.pathname.replace(/\/+$/, '').replace(/\.html$/, '').toLowerCase() || '/'; return /^\/(index|guide|swap|tokens|beta|rocketize)$/.test(p) ? '/' : p; };
  const tipsFor = () => (pageTips[path()] || pageTips['/']).tips;
  const greeting = () => {
    const u = window.AUTH && AUTH.user && AUTH.user.username;
    return (u ? 'Hey @' + u + '! ' : 'Hey, I\'m Sendy! ') + 'Ask me anything about $Send, or how to use this site. 🚀';
  };
  // the chat's first line (the tips greeting reworded by a regex used to read "Hey there —, I'm Sendy!")
  const chatHello = () => {
    const u = window.AUTH && AUTH.user && AUTH.user.username;
    return 'Hey ' + (u ? '@' + u : 'there') + ' — I\'m Sendy! Ask me anything about $Send, or how to use this site. 🚀';
  };

  /* ---------- markup ---------- */
  function html() {
    const tip = tipsFor()[Math.floor(Math.random() * tipsFor().length)];
    // data-nosnippet: the greeting and the tips are the helper talking, never a search result's description of the page
    return '<div id="sendy-widget" class="sendy-widget" data-nosnippet hidden>' +
      '<button class="sendy-rocket" id="sendy-rocket" type="button" aria-label="Sendy, your $Send guide" aria-expanded="false" data-tip="Opens Sendy — ask a question, or get a tip about this page. Drag to move (desktop)">' +
        '<span class="sendy-emo" aria-hidden="true"><span class="sendy-sprite" aria-hidden="true"></span><span class="sendy-act" aria-hidden="true"></span></span>' +
      '</button>' +
      '<div class="sendy-say" id="sendy-say" aria-hidden="true" hidden></div><span class="sendy-live" id="sendy-live" role="status"></span>' +
      '<div class="sendy-popup" id="sendy-popup" role="dialog" aria-label="Sendy" hidden>' +
        '<div class="sendy-head">' +
          '<button class="sendy-hbtn sendy-back-btn" id="sendy-back" type="button" data-tip="Leaves the chat and shows the tips again" hidden>←<span class="sendy-back-word"> Tips</span></button>' +
          '<img class="sendy-avatar" src="/assets/sendy.png" alt="" width="28" height="28">' +
          '<span class="sendy-title">Sendy <small>your $Send guide</small></span>' +
          '<button class="sendy-hbtn sendy-close" id="sendy-close" type="button" aria-label="Close Sendy" data-tip="Closes Sendy — the rocket stays in the corner"><span class="sendy-x" aria-hidden="true"></span></button>' +
        '</div>' +
        '<div class="sendy-body" id="sendy-tips-mode">' +
          '<p class="sendy-greeting" id="sendy-greeting">' + esc(greeting()) + '</p>' +
          '<p class="sendy-tip" id="sendy-tip" aria-live="polite">💡 ' + esc(tip) + '</p>' +
          '<div class="sendy-actions">' +
            '<button class="sendy-btn sendy-btn-primary" id="sendy-chat" type="button" data-tip="Opens a chat with Sendy — it answers from the site\'s own pages">💬 Ask Sendy a question</button>' +
            '<button class="sendy-btn sendy-btn-secondary" id="sendy-support" type="button" data-tip="Opens the Support board, where you can ask in public and answer others">Support board</button>' +
            '<button class="sendy-btn sendy-btn-tertiary" id="sendy-newtip" type="button" data-tip="Shows a different tip about this page">Another tip</button>' +
            '<button class="sendy-btn sendy-btn-tertiary" id="sendy-tour" type="button" hidden data-tip="Takes the guided tour of everything your account can do — Sendy flies you around the site, step by step">🎓 Show me around</button>' +
          '</div>' +
          '<p class="sendy-fine">Prefer email? <a class="sendy-link" href="' + MAILTO + '">' + EMAIL + '</a> — private, and a person reads it.</p>' +
        '</div>' +
        '<div class="sendy-body" id="sendy-chat-mode" hidden>' +
          // a Tab stop of its own, so a keyboard can scroll the conversation; focusChat puts focus here on a touch screen
          '<div class="sendy-chat-messages" id="sendy-chat-messages" role="log" aria-live="polite" aria-label="Your conversation with Sendy" tabindex="0"></div>' +
          '<form class="sendy-chat-form" id="sendy-chat-form">' +
            // short enough for one line in a phone's box (the longer hint wrapped it to two, and an empty box is sized by it)
            '<textarea id="sendy-chat-input" class="sendy-chat-input" rows="1" placeholder="Ask Sendy anything" autocomplete="off" maxlength="600" aria-label="Your question for Sendy"></textarea>' +
            '<button type="submit" class="sendy-chat-send" id="sendy-chat-send" aria-label="Send the question" data-tip="Sends your question to Sendy — Enter does too; Shift+Enter starts a new line">Send</button>' +
          '</form>' +
          '<p class="sendy-fine" id="sendy-chat-fine">Sendy\'s answers are generated and can be wrong<span class="sendy-fine-more"> — check the page it points to</span>. Entertainment only, not financial advice, not affiliated with Robinhood.</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- styles ---------- */
  function css() {
    /* Every size in the popup is in em of the popup's own text (the page floor, 14px on a phone to 19pt on a desktop), so
       the box grows with its words: about 45 characters a line at every width, controls that stay in proportion, and a
       44px minimum for anything a finger taps. */
    return '' +
      /* One and a half times the first size — 114px, 90px on a phone — and never more than 30% of the screen's height
         (a landscape phone or a short window keeps a clear strip above and below it). On :root, so the footer can keep
         that much room free at the end of every page. */
      ':root{--sendy-size:min(114px,30vh)}@media (max-width:767px){:root{--sendy-size:min(90px,30vh)}}' +
      '#sendy-widget{--sendy-z:190;position:fixed;right:1rem;bottom:var(--fab-clear,5.5rem);z-index:var(--sendy-z);font-family:inherit;width:var(--sendy-size);height:var(--sendy-size)}' +
      '#sendy-widget:not([hidden]){display:block}' +
      '@media (max-width:767px){#sendy-widget{right:0.75rem}}' +
      'footer{padding-bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px)}' +   /* the footer's last links scroll clear of the rocket */
      /* where it would sit on controls that never move, it steps aside: the Hot Feed's action rail (a full-screen player,
         where nothing else belongs), the arcade's multiplier while a flight runs, and the Scanner's settings sheet on a phone */
      'body.np-mode-feed #sendy-widget,html.arc-flying #sendy-widget{display:none}' +
      '@media (max-width:760px){body:has(#np-filters:not([hidden])) #sendy-widget{display:none}}' +
      /* Only the rocket's body takes a tap. The frame is a square and most of it is transparent, and the whole square
         used to catch taps meant for whatever showed through it. The button keeps its focus ring, hover and drag:
         a hit on its ::before is a hit on the button. */
      '#sendy-widget,.sendy-rocket,.sendy-sprite{pointer-events:none}.sendy-popup,.sendy-say{pointer-events:auto}' +
      '.sendy-rocket::before{content:"";position:absolute;inset:3% 15% 2%;border-radius:45%;pointer-events:auto}' +
      '.sendy-widget.is-flying .sendy-rocket::before{pointer-events:none}' +
      '.sendy-rocket{position:relative;width:var(--sendy-size);height:var(--sendy-size);padding:0;margin:0;border:0;background:none;cursor:grab;display:block;border-radius:50%;transition:transform .2s ease;touch-action:manipulation}' +
      '@media (max-width:767px){.sendy-rocket{cursor:pointer}}' +
      '.sendy-rocket:hover{transform:scale(1.08)}' +
      '.sendy-rocket:active{cursor:grabbing}' +
      '.sendy-rocket:focus-visible{outline:3px solid var(--focus);outline-offset:3px}' +
      '.sendy-sprite{display:block;width:var(--sendy-size);height:var(--sendy-size);background:url(/assets/sendy-idle.png) no-repeat 0 0/var(--sendy-size) auto;' +
        'filter:drop-shadow(0 0 calc(var(--sendy-size) * .12) color-mix(in srgb,var(--green) 55%,transparent));animation:sendy-idle 2s steps(' + FRAMES + ') infinite}' +
      '@keyframes sendy-idle{to{background-position:0 calc(var(--sendy-size) * -' + FRAMES + ')}}' +
      '@media (prefers-reduced-motion:reduce){.sendy-sprite{animation:none}}' +
      'html.motion-off .sendy-sprite,html.motion-off .sendy-msg,html.motion-off .sendy-say{animation:none}html.motion-off .sendy-widget.is-hyped .sendy-rocket{animation:none}' +
      '@media (prefers-reduced-motion:reduce){.sendy-say{animation:none}}' +
      '.sendy-widget.is-flying .sendy-sprite{animation-duration:.6s}' +
      /* reactions: each time the pointer comes over Sendy, and on a tap, he pulls one of the faces from the marketing videos —
         a short 3D clip (scripts/sendy-3d.py renders it from the videos' model, camera and lights, the same as the idle loop),
         drawn on .sendy-act over the idle sprite. Its box is the idle box widened by that clip's --act-k about the same centre, so a
         raised arm has room and his body sits exactly where the idle frame has it. The frames, timings and box come from
         /assets/sendy-acts.json (actCss() below). Some add a small move of the whole rocket, on .sendy-emo inside the
         button, so the part that takes the pointer (the button's ::before) never moves and a bounce cannot set off another. */
      '.sendy-emo{position:relative;display:block;width:var(--sendy-size);height:var(--sendy-size);transform-origin:50% 85%;pointer-events:none}' +
      '.sendy-act{position:absolute;display:none;pointer-events:none;left:calc(var(--sendy-size) * (1 - var(--act-k,1)) / 2);top:calc(var(--sendy-size) * (1 - var(--act-k,1)) / 2);' +
        'width:calc(var(--sendy-size) * var(--act-k,1));height:calc(var(--sendy-size) * var(--act-k,1));background:no-repeat 0 0;' +
        'filter:drop-shadow(0 0 calc(var(--sendy-size) * .12) color-mix(in srgb,var(--green) 55%,transparent))}' +   /* the idle sprite's glow */
      '#sendy-widget[data-act] .sendy-act{display:block}#sendy-widget[data-act] .sendy-sprite{visibility:hidden;animation:none}' +   /* the loop stops under a clip and starts again at frame 0, the pose every clip ends on */
      '@media (prefers-reduced-motion:no-preference){' +
        '#sendy-widget[data-move="hop"] .sendy-emo{animation:sendy-m-hop .8s ease}' +
        '#sendy-widget[data-move="dash"] .sendy-emo{animation:sendy-m-dash .9s ease}' +
        '#sendy-widget[data-move="bounce"] .sendy-emo{animation:sendy-m-bounce .9s ease}}' +
      '@keyframes sendy-m-hop{0%,100%{transform:none}35%{transform:translateY(-14%) rotate(-4deg)}60%{transform:translateY(-3%) rotate(2deg)}}' +
      '@keyframes sendy-m-dash{0%,100%{transform:none}30%{transform:translateY(-24%) scaleY(1.06)}55%{transform:translateY(-24%)}}' +
      '@keyframes sendy-m-bounce{0%,50%,100%{transform:none}22%{transform:translateY(-12%)}72%{transform:translateY(-8%)}}' +
      'html.motion-off #sendy-widget[data-move] .sendy-emo{animation:none}' +
      /* a reaction: a speech bubble by the rocket, and a hop — as wide as its words allow, never wider than the screen */
      '.sendy-say{position:absolute;bottom:calc(var(--sendy-size) + 8px);right:0;width:max-content;max-width:min(16em,calc(100vw - 1.5rem));padding:.5em .75em;border-radius:.8em;border-bottom-right-radius:4px;background:var(--green);color:var(--ink-1);font-weight:600;font-size:max(var(--text-floor), .86rem);line-height:1.35;box-shadow:0 8px 24px rgba(0,0,0,.35);animation:sendy-in .25s ease;z-index:1}' +
      '.sendy-say[hidden]{display:none}' +
      '.sendy-live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +
      '@media (forced-colors:active){.sendy-say{border:2px solid CanvasText}}' +   /* the system colours drop its fill: an outline keeps it a bubble */
      '.sendy-widget.say-greet .sendy-say{cursor:pointer}' +   /* the hello says "Tap me": a tap on it opens Sendy */
      '.sendy-widget.say-greet .sendy-rocket:hover~.sendy-say{visibility:hidden}' +   /* under the pointer his tip says it instead; the greeting is back when the pointer leaves */
      '.sendy-widget.say-up .sendy-say{bottom:auto;top:calc(var(--sendy-size) + 8px);border-radius:.8em;border-top-right-radius:4px}' +
      '.sendy-widget.say-left .sendy-say{right:auto;left:0;border-radius:.8em;border-bottom-left-radius:4px}' +
      '.sendy-widget.say-side .sendy-say{bottom:auto;top:0;right:calc(var(--sendy-size) + 8px);left:auto;border-radius:.8em;border-top-right-radius:4px}' +
      '.sendy-widget.say-side.say-left .sendy-say{right:auto;left:calc(var(--sendy-size) + 8px);border-radius:.8em;border-top-left-radius:4px}' +
      '@media (max-width:767px){.sendy-say{position:fixed;right:.75rem;bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px);max-width:calc(100vw - 1.5rem)}}' +
      '.sendy-widget.is-hyped .sendy-sprite{animation-duration:.5s}' +
      '@media (prefers-reduced-motion:no-preference){.sendy-widget.is-hyped .sendy-rocket{animation:sendy-hop .6s ease}}' +
      '@keyframes sendy-hop{0%,100%{transform:none}40%{transform:translateY(calc(var(--sendy-size) * -.16)) rotate(-6deg)}70%{transform:translateY(calc(var(--sendy-size) * -.05)) rotate(4deg)}}' +   /* the glow and the hop scale with the rocket */
      /* the popup: above the rocket, aligned to its right edge; flipped when the rocket sits near the top or the left.
         The tips are 25em wide (capped to the screen). The chat is as much of the screen as the conversation can have:
         wider (25em on a tablet to 28em on a laptop, then growing to 38em on the widest screens: fewer lines for the same
         answer) and as tall as there is room for. On a desktop placePopup stands it beside the rocket, from under the nav
         down to the strip the music player and the SEND IT button own; on a phone it is a sheet over that whole height. */
      '.sendy-popup{--sendy-chat-w:clamp(25em, calc(25em + (100vw - 768px) * .3), 28em);position:absolute;bottom:calc(var(--sendy-size) + 10px);right:0;font-size:max(var(--text-floor), .92rem);width:min(25em,calc(100vw - 2rem));max-height:calc(100vh - 24px);background:var(--ink-2,var(--bg-0,#0f120b));color:var(--text);border:1px solid var(--edge-ctl);border-radius:.7em;box-shadow:0 12px 36px rgba(0,0,0,.45);z-index:1;overflow:hidden;display:flex;flex-direction:column}' +
      '@media (min-width:1280px){.sendy-popup{--sendy-chat-w:clamp(28em, calc(28em + (100vw - 1280px) * .3), 38em)}}' +
      '@media (max-height:520px){.sendy-popup{--sendy-chat-w:36em}}' +   /* a short window: what the conversation cannot have in height it takes in width */
      '.sendy-popup.is-chat{width:min(var(--sendy-chat-w),calc(100vw - 2rem));height:52em}' +   /* placePopup caps the height to the room there is */
      '@media (min-width:768px){.sendy-widget.is-up .sendy-popup{bottom:auto;top:calc(var(--sendy-size) + 10px)}' +
        '.sendy-widget.is-left .sendy-popup{right:auto;left:0}' +
        '.sendy-widget.is-side .sendy-popup{position:fixed;top:auto;bottom:var(--fab-clear,5.5rem);right:auto;left:auto}}' +   /* beside the rocket: placePopup sets the side and the width */
      /* a phone: the tips span the width above the rocket, kept under the nav; the chat is a sheet from under the nav down to
         the strip, over the rocket (its own header has him, and the close) — fitPhone measures the nav, the theme tune's
         nudge and the keyboard and moves its edges to clear them */
      '@media (max-width:767px){.sendy-popup{position:fixed;left:0.75rem;right:0.75rem;bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px);width:auto;max-width:none;max-height:calc(100vh - var(--fab-clear,5.5rem) - var(--sendy-size) - var(--nav-h,58px) - 16px);display:flex;flex-direction:column}' +
        '.sendy-popup.is-chat{top:calc(var(--nav-h,58px) + 6px);bottom:var(--fab-clear,5.5rem);left:max(.5rem,env(safe-area-inset-left,0px));right:max(.5rem,env(safe-area-inset-right,0px));width:auto;height:auto;max-height:none}}' +
      '@supports (height:100dvh){@media (max-width:767px){.sendy-popup{max-height:calc(100dvh - var(--fab-clear,5.5rem) - var(--sendy-size) - var(--nav-h,58px) - 16px)}}}' +
      /* a phone on its side: above the rocket there is almost no height, so the tips stand left of the rocket's column
         instead, from under the nav down to the strip. The chat is the same sheet as upright, over him too: a conversation
         that short gets the whole width (fewer lines to every answer) — standing beside him it lost a sixth of it. */
      '@media (max-width:767px) and (max-height:500px){.sendy-popup{right:calc(var(--sendy-size) + 1.5rem);bottom:var(--fab-clear,5.5rem);max-height:calc(100vh - var(--fab-clear,5.5rem) - var(--nav-h,58px) - 12px)}}' +
      '@supports (height:100dvh){@media (max-width:767px) and (max-height:500px){.sendy-popup{max-height:calc(100dvh - var(--fab-clear,5.5rem) - var(--nav-h,58px) - 12px)}}}' +
      '.sendy-popup[hidden]{display:none !important}' +
      /* header: the way back to the tips (chat only), Sendy, and the close — both controls a finger can hit */
      '.sendy-head{display:flex;align-items:center;gap:.5em;padding:.45em .5em .45em .8em;border-bottom:1px solid var(--edge-ctl);flex:none}' +
      '.sendy-avatar{width:1.9em;height:1.9em;flex:none}' +
      '.sendy-title{flex:1;min-width:0;font-weight:800;font-size:max(var(--text-floor), calc(var(--text-floor) * 1.1), 1.05em);color:var(--text);display:flex;flex-direction:column;line-height:1.15}' +
      '.sendy-title small{font-weight:500;font-size:max(var(--text-floor), .8em);color:var(--text-mute)}' +
      '.sendy-hbtn{flex:none;min-width:2.4em;min-height:2.4em;display:inline-flex;align-items:center;justify-content:center;padding:0 .55em;border-radius:.45em;cursor:pointer;font:inherit;font-size:max(var(--text-floor), .92em);font-weight:700;line-height:1.2}' +
      '.sendy-hbtn[hidden]{display:none}' +
      '.sendy-close{background:none;border:0;color:var(--text-mute);padding:0;width:2.4em}' +
      '.sendy-close:hover{color:var(--text);background:var(--g-wash)}' +
      '.sendy-x{position:relative;display:block;width:1em;height:1em}' +
      '.sendy-x::before,.sendy-x::after{content:"";position:absolute;left:50%;top:50%;width:1.15em;height:.14em;border-radius:1px;background:currentColor;translate:-50% -50%;rotate:45deg}' +
      '.sendy-x::after{rotate:-45deg}' +
      '.sendy-back-btn{background:transparent;color:var(--text-dim);border:1px solid var(--edge-ctl)}' +
      '.sendy-back-btn:hover{color:var(--text);border-color:var(--text-mute)}' +
      /* the chat's header is one slim row at every size — the back, Sendy and the close — so the conversation keeps the height */
      '.sendy-popup.is-chat .sendy-title small{display:none}' +
      '.sendy-popup.is-chat .sendy-head{padding:.2em .35em .2em .7em}' +
      '.sendy-popup.is-chat .sendy-hbtn{min-height:2em}.sendy-popup.is-chat .sendy-close{width:2em}' +   /* 50px at 19pt; 44px under a finger (below) */
      '.sendy-back-word{white-space:pre}' +
      /* A short, wide chat (a phone on its side, a laptop's 720-768px, a small window; fitChat sets it): the header becomes a
         rail down the left side, the back and the close at its top and Sendy at its foot, so the conversation gets that row
         too. The back is its arrow there (its name and its tip stay), and the fine print drops its aside. */
      '.sendy-popup.is-rail{flex-direction:row}' +
      '.sendy-popup.is-rail .sendy-head{flex-direction:column;align-items:center;padding:.35em .25em;border-bottom:0;border-right:1px solid var(--edge-ctl)}' +
      '.sendy-popup.is-rail .sendy-title{display:none}' +
      '.sendy-popup.is-rail .sendy-avatar{order:1;margin-top:auto}' +
      '.sendy-popup.is-rail .sendy-back-btn{width:2em;padding:0}' +
      '.sendy-popup.is-rail .sendy-back-word{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +
      '.sendy-popup.is-rail .sendy-fine-more{display:none}' +
      '.sendy-popup.is-rail .sendy-body{flex:1 1 auto;min-width:0}' +
      '.sendy-close:focus-visible,.sendy-btn:focus-visible,.sendy-back-btn:focus-visible,.sendy-chat-send:focus-visible,.sendy-link:focus-visible{outline:3px solid var(--focus);outline-offset:2px}' +
      '.sendy-body{padding:.8em;display:flex;flex-direction:column;gap:.7em;min-height:0;flex:1 1 auto;overflow:auto;overscroll-behavior:contain}' +
      '.sendy-body[hidden]{display:none}' +
      '.sendy-greeting,.sendy-tip{margin:0;font-size:max(var(--text-floor), 1em);line-height:1.45}' +
      '.sendy-greeting{font-weight:700;color:var(--green-bright)}' +
      '.sendy-tip{color:var(--text-dim)}' +
      '.sendy-actions{display:flex;flex-direction:column;gap:.5em}' +
      '.sendy-btn{min-height:2.6em;padding:.45em .8em;font:inherit;font-size:max(var(--text-floor), .95em);font-weight:600;line-height:1.25;border:1px solid var(--edge-ctl);border-radius:.45em;cursor:pointer;text-align:center;transition:background .15s ease,border-color .15s ease}' +
      '.sendy-btn-primary{background:var(--green);color:var(--ink-1);border-color:var(--green)}' +
      '.sendy-btn-primary:hover{background:var(--green-bright);border-color:var(--green-bright)}' +
      '.sendy-btn-secondary{background:transparent;color:var(--text)}' +
      '.sendy-btn-secondary:hover{border-color:var(--edge-ctl-lit);background:var(--g-wash)}' +
      '.sendy-btn-tertiary{background:transparent;color:var(--text-dim);font-weight:500}' +
      '.sendy-btn-tertiary:hover{color:var(--text);border-color:var(--text-mute)}' +
      /* tips with less room than they want (a phone on its side, a small window; fitTips sets it): the slim header of the
         chat, and the buttons straight under the greeting with the tip after them — the way into the chat was under the fold
         of a long tip, and a tap there landed on the page. Where even that leaves it under the fold (a 568×320 phone on its
         side), the buttons come first. */
      '.sendy-popup.is-cramped .sendy-title small{display:none}.sendy-popup.is-cramped .sendy-head{padding:.2em .35em .2em .7em}' +
      '.sendy-popup.is-cramped #sendy-tips-mode{padding:.45em .6em;gap:.45em}.sendy-popup.is-cramped .sendy-tip{order:1}.sendy-popup.is-cramped #sendy-tips-mode .sendy-fine{order:2}.sendy-popup.is-tight .sendy-actions{order:-1}' +
      '.sendy-fine{margin:0;font-size:max(var(--text-floor), .8em);line-height:1.4;color:var(--text-mute)}' +
      '.sendy-link{color:var(--green-bright);font-weight:600;text-decoration:underline;text-underline-offset:2px;border-radius:3px}' +
      /* chat: the conversation fills the body and is the one thing in it that scrolls; the question box and the fine print
         sit under it. Tighter padding than the tips: every em of it is a line of an answer at 19pt. */
      '#sendy-chat-mode{padding:.4em .45em .35em .5em;gap:.35em}' +
      '.sendy-chat-messages{position:relative;display:flex;flex-direction:column;gap:.5em;flex:1 1 auto;min-height:2.5em;overflow-y:auto;overscroll-behavior:contain;padding:.1em .15em .1em 0}' +
      '.sendy-chat-messages:focus{outline:none}.sendy-chat-messages:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}' +   /* a ring when the keyboard brings focus here, none for a finger (focusChat) */
      '.sendy-msg{display:flex;animation:sendy-in .25s ease}' +
      '@keyframes sendy-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.sendy-msg{animation:none}}' +
      '.sendy-msg-user{justify-content:flex-end}' +
      /* nothing in a bubble is ever cut: it wraps anywhere (a long address, a URL, a made-up word) and grows to its words */
      '.sendy-msg-bubble{padding:.5em .75em;border-radius:.7em;max-width:88%;min-width:0;overflow-wrap:anywhere;font-size:max(var(--text-floor), 1em);line-height:1.45;white-space:pre-line}' +
      '.sendy-msg-sendy .sendy-msg-bubble{max-width:100%;background:var(--g-wash);color:var(--text);border:1px solid var(--edge-ctl);border-bottom-left-radius:3px}' +   /* an answer takes the width: fewer lines to scroll */
      '.sendy-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +   /* who said it, for a screen reader; the side and the colour say it on screen */
      '.sendy-msg-user .sendy-msg-bubble{background:var(--green);color:var(--ink-1);border-bottom-right-radius:3px}' +
      /* the routes to a person under an answer: pills, not bare words */
      '.sendy-msg-links{display:flex;flex-wrap:wrap;gap:.4em;margin-top:.55em;white-space:normal}' +
      '.sendy-msg-links .sendy-link{display:inline-flex;align-items:center;min-height:2.2em;padding:.2em .75em;border:1px solid var(--edge-ctl);border-radius:999px;text-decoration:none;line-height:1.2}' +
      '.sendy-msg-links .sendy-link:hover{border-color:var(--edge-ctl-lit);background:var(--g-wash)}' +
      '.sendy-typing .sendy-msg-bubble{color:var(--text-mute);letter-spacing:.15em}' +
      '.sendy-rate{display:flex;flex-wrap:wrap;align-items:center;gap:.4em;margin-top:.55em;font-size:max(var(--text-floor), .9em);color:var(--text-mute);white-space:normal}' +
      '.sendy-rate-btn{min-width:2.4em;min-height:2.2em;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--edge-ctl);border-radius:.45em;cursor:pointer;padding:0 .5em;font:inherit;line-height:1}' +
      '.sendy-rate-btn:hover{border-color:var(--edge-ctl-lit);background:var(--g-wash)}' +
      '.sendy-rate-btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}' +
      '.sendy-chat-form{display:flex;align-items:flex-end;gap:.45em;flex:none}' +
      /* the question box: at least 16px (an iPhone zooms the whole page into a smaller one), growing with what is typed to
         five lines — or to under a third of the panel, where that is less (a phone on its side, the keyboard up), so the
         conversation is never pushed out by the question; past that it scrolls. --sendy-h is the panel's height (fitChat). */
      '.sendy-chat-input{flex:1;min-width:0;min-height:2.4em;max-height:min(8em,calc(var(--sendy-h,40em) * .3));padding:.45em .65em;border:1px solid var(--edge-ctl);border-radius:.45em;background:var(--ink-1,#050505);color:var(--text);font:inherit;font-size:max(var(--text-floor), 16px, 1em);line-height:1.35;resize:none;overflow-y:auto;field-sizing:content}' +
      '.sendy-chat-input::placeholder{color:var(--text-mute)}' +
      '.sendy-chat-input:focus{outline:2px solid var(--focus);outline-offset:-1px;border-color:var(--edge-ctl-lit)}' +
      '.sendy-chat-send{flex:none;min-width:2.6em;min-height:2.4em;padding:0 .9em;background:var(--green);color:var(--ink-1);border:1px solid var(--green);border-radius:.45em;cursor:pointer;font:inherit;font-size:max(var(--text-floor), 1em);font-weight:800;line-height:1.2}' +
      '.sendy-chat-send:hover{background:var(--green-bright);border-color:var(--green-bright)}' +
      '.sendy-chat-send[disabled]{opacity:.6;cursor:default}' +
      '#sendy-chat-mode .sendy-fine{flex:none;line-height:1.3}' +
      /* a short chat (fitChat: under 16em tall — a phone on its side, a keyboard up): the honesty line rides at the foot of
         the conversation, under the newest answer, where it is read after each one — pinned under the box it took two or
         three of the ten lines there are, and the conversation was left one */
      '.sendy-chat-messages .sendy-fine{padding:.1em .2em 0}' +
      '.sendy-popup.is-short #sendy-chat-mode{padding-top:.25em;padding-bottom:.25em}.sendy-popup.is-short .sendy-chat-messages{min-height:1.6em}' +   /* a line of it, at the least: with a phone's keyboard up on its side the panel is under 100px, and the box must stay in it */
      /* a finger does the tapping: every control at least 44px */
      '@media (pointer:coarse){.sendy-hbtn,.sendy-close,.sendy-rate-btn{min-height:max(44px,2.4em)}.sendy-btn{min-height:max(44px,2.6em)}.sendy-chat-send,.sendy-chat-input{min-height:max(44px,2.4em)}.sendy-msg-links .sendy-link{min-height:max(44px,2.2em)}.sendy-close,.sendy-rate-btn{min-width:max(44px,2.4em)}.sendy-chat-send{min-width:max(44px,2.6em)}' +
        '.sendy-popup.is-chat .sendy-hbtn{min-height:max(44px,2em)}.sendy-popup.is-chat .sendy-close,.sendy-popup.is-rail .sendy-back-btn{width:max(44px,2em)}}' +
      /* forced colours: the drawn close mark keeps the system's button-text colour */
      '@media (forced-colors:active){.sendy-x::before,.sendy-x::after{forced-color-adjust:none;background:ButtonText}}';
  }

  /* ---------- state that survives a page change: the chat, and whether the greeting was shown ---------- */
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('sendy:' + k)); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem('sendy:' + k, JSON.stringify(v)); } catch {} }
  };

  function init() {
    if (document.getElementById('sendy-widget')) return;
    const style = document.createElement('style'); style.textContent = css(); document.head.appendChild(style);
    const host = document.createElement('div'); host.innerHTML = html(); document.body.appendChild(host.firstElementChild);

    const $ = (id) => document.getElementById(id);
    const widget = $('sendy-widget'), rocket = $('sendy-rocket'), popup = $('sendy-popup');
    const tipsMode = $('sendy-tips-mode'), chatMode = $('sendy-chat-mode'), chatForm = $('sendy-chat-form');
    const chatInput = $('sendy-chat-input'), chatSend = $('sendy-chat-send'), chatLog = $('sendy-chat-messages'), chatFine = $('sendy-chat-fine');
    let history = Array.isArray(store.get('chat')) ? store.get('chat').slice(-12) : [];
    let userPlaced = false, flying = false, hovering = false, painting = false, revealLater = null;

    /* ---------- open / close ---------- */
    const size = () => rocket.getBoundingClientRect().width || 228;
    // the strip at the bottom that the music player and the SEND IT button own, in pixels: --fab-clear is a calc()
    // with rem and a safe-area inset, so it is measured on a probe box rather than parsed
    function fabClearPx() {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:var(--fab-clear,5.5rem);width:0';
      document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h || 88;
    }
    /* The bottom of the nav bar on the screen (0 when there is none): the popup stops under it, so Sign In, the bell and the
       menu stay theirs to tap. Measured rather than read from --nav-h, so a strip above the bar at the top of a page counts. */
    function navBottom() {
      const n = document.querySelector('.nav'), b = n && n.getClientRects().length ? n.getBoundingClientRect().bottom : 0;
      return Math.max(0, Math.min(b, window.innerHeight / 2));
    }
    /* How far down the popup may reach over x0…x1: to the strip the player and SEND IT own — or higher while the theme
       tune's nudge stands above the player (it belongs to the strip, but stands above it for its few seconds; the popup
       moves back down when it goes). */
    let hintWatched = null;
    function lowEdge(x0, x1) {
      let low = window.innerHeight - fabClearPx();
      const hint = document.querySelector('#mp-hint');   // the player's (player.js), so optional: not one of Sendy's own ids
      if (hint && !hint.hidden && hint.getClientRects().length) { const b = hint.getBoundingClientRect(); if (b.right > x0 && b.left < x1) low = Math.min(low, b.top - 8); }
      if (hint && hintWatched !== hint && typeof MutationObserver === 'function') {
        hintWatched = hint;
        new MutationObserver(() => { if (isOpen()) placePopup(); }).observe(hint, { attributes: true, attributeFilter: ['hidden'] });
      }
      return low;
    }
    /* desktop only: a rocket near the top opens its popup downward, one near the left edge opens it rightward.
       On a phone fitPhone places it (fixed, the width of the screen), and these flips must never touch it. */
    function placePopup() {
      popup.style.top = ''; popup.style.bottom = ''; popup.style.left = ''; popup.style.right = ''; popup.style.width = ''; popup.style.maxHeight = ''; widget.classList.remove('is-side');
      if (isMobile()) { widget.classList.remove('is-up', 'is-left'); fitPhone(); return; }
      const strip = fabClearPx(), chat = popup.classList.contains('is-chat'), kb = keyboardCover();
      // upward stops under the nav bar: on a 768 px laptop it used to open over Sign In (and under the top of what is on
      // screen, while a keyboard has the page scrolled)
      const top0 = Math.max(navBottom(), kb ? visualViewport.offsetTop : 0) + 8;
      const r = rocket.getBoundingClientRect(), above = r.top - 4 - top0, below = window.innerHeight - r.bottom - 12 - strip;   // downward stops above the player strip
      widget.classList.toggle('is-up', below > above);      // open toward whichever side has more room…
      // …and rightward when hung too near the left edge for the popup (its own width: 25em of its text for the tips, the chat's wider)
      const fs = parseFloat(getComputedStyle(popup).fontSize), pw = Math.min(popup.getBoundingClientRect().width || fs * 25, window.innerWidth - 32);
      widget.classList.toggle('is-left', r.right - pw < 8);
      popup.style.maxHeight = Math.max(260, Math.floor(Math.max(above, below))) + 'px';   // …and never past the viewport: the body scrolls instead
      const leftRoom = r.left - 18, rightRoom = window.innerWidth - r.right - 18;
      // a rocket dragged near the middle of a narrow window: the popup fits neither hung left nor right of it, so it is
      // slid along until it is wholly on the screen
      const left0 = widget.classList.contains('is-left') ? r.left : r.right - pw, fit = Math.max(8, Math.min(left0, window.innerWidth - 8 - pw));
      if (Math.abs(fit - left0) > 0.5) { popup.style.left = Math.round(fit - r.left) + 'px'; popup.style.right = 'auto'; }
      /* Beside the rocket the popup has the screen's whole height between the nav and the strip. The chat opens there
         whenever there is room for it beside him: it is the most of a conversation anyone can see at once. The tips, a few
         lines, only on a short window, where above and below the rocket there is not the height they want. */
      const want = Math.min(fs * 24, window.innerHeight - strip - top0);
      if ((chat || Math.max(above, below) < want * 0.87) && Math.max(leftRoom, rightRoom) >= Math.min(pw, fs * 16)) {   // the tips only when it gains a sixth or more
        popup.style.left = ''; popup.style.right = '';
        widget.classList.add('is-side');
        const w = Math.floor(Math.min(pw, Math.max(leftRoom, rightRoom))), x0 = leftRoom >= rightRoom ? r.left - 10 - w : r.right + 10;
        popup.style.width = w + 'px';
        if (leftRoom >= rightRoom) popup.style.right = Math.round(window.innerWidth - r.left + 10) + 'px'; else popup.style.left = Math.round(r.right + 10) + 'px';
        // its foot on the strip — or on the keyboard while one is up (a tablet, a phone on its side wider than 768px: the
        // panel stood on the strip and the question box went under the keyboard)
        const low = kb ? Math.min(lowEdge(x0, x0 + w), window.innerHeight - kb - 6) : lowEdge(x0, x0 + w);
        popup.style.bottom = Math.round(window.innerHeight - low) + 'px';
        popup.style.maxHeight = Math.floor(low - top0) + 'px';
      }
      fitChat(); fitTips();
    }
    /* A phone: the tips above the rocket, the chat a sheet from under the nav down to the strip (fixed, styles above). While
       the keyboard is up the popup sits on top of it. */
    function fitPhone() {
      const vv = window.visualViewport;
      if (isMobile()) { popup.style.top = ''; popup.style.bottom = ''; popup.style.maxHeight = ''; }
      if (!isMobile() || !isOpen()) return;
      const covered = keyboardCover();
      if (popup.classList.contains('is-chat')) {
        // the sheet's top under the nav (or at the top of what is on screen, scrolled for the keyboard); its foot on the
        // strip, above the theme tune's nudge while that is up, or on the keyboard
        popup.style.top = Math.round(Math.max(navBottom(), vv ? vv.offsetTop : 0) + 6) + 'px';
        const pr = popup.getBoundingClientRect();
        popup.style.bottom = Math.round(covered ? covered + 6 : window.innerHeight - lowEdge(pr.left, pr.right)) + 'px';
      } else if (covered) { popup.style.bottom = Math.round(covered + 8) + 'px'; popup.style.maxHeight = Math.floor(vv.height - 16) + 'px'; }
      fitChat(); fitTips();
    }
    /* How much of the screen's foot an on-screen keyboard covers, in pixels (0 while it is down). It covers the bottom of
       the screen without moving a fixed box, which would leave the question box under it, and only the visual viewport
       knows: it is shorter than the page's while the keyboard is up. A phone at any width and anything with a finger for a
       pointer (a tablet, a phone on its side at 768px or wider) — on a desktop the visual viewport shrinks for a pinch zoom,
       which is not a keyboard. */
    function keyboardCover() {
      const vv = window.visualViewport;
      if (!vv || !(isMobile() || coarse())) return 0;
      const c = window.innerHeight - vv.height - vv.offsetTop;
      return c > 80 ? c : 0;
    }
    // the keyboard coming up or going (or the page scrolled under it): the popup moves with it, wherever it stands
    if (window.visualViewport) { const refit = () => { if (isOpen()) placePopup(); }; visualViewport.addEventListener('resize', refit); visualViewport.addEventListener('scroll', refit); }
    /* The chat, once its box is placed: its height for the question box's cap (--sendy-h); on a short, wide panel (a
       phone on its side, a laptop's 720-768px, a small window: under 24em of its own text tall and 24em or more wide) the
       header as a rail down its side — there a row is a tenth of the height, and the conversation gets it back; and on a
       short one (under 16em, about ten lines: a phone on its side, a keyboard up) the honesty line at the foot of the
       conversation (styles above). None of it changes the box, so nothing here can set off another fit. */
    function fitChat() {
      popup.classList.remove('is-rail', 'is-short');
      if (!popup.classList.contains('is-chat') || !isOpen()) return;
      const r = popup.getBoundingClientRect(), fs = parseFloat(getComputedStyle(popup).fontSize) || 16, short = r.height < fs * 16;
      popup.style.setProperty('--sendy-h', Math.round(r.height) + 'px');
      popup.classList.toggle('is-rail', r.height < fs * 24 && r.width >= fs * 24);
      popup.classList.toggle('is-short', short);
      if (short !== (chatFine.parentNode === chatLog)) { if (short) chatLog.appendChild(chatFine); else chatMode.appendChild(chatFine); }
    }
    /* The tips, once their box is placed: where they want more height than there is (a phone on its side, a small window),
       the buttons come straight under the greeting — or first, where under the greeting the way into the chat is still not
       wholly in view (styles above). Each step is measured without the next, so neither can undo itself. */
    function fitTips() {
      popup.classList.remove('is-cramped', 'is-tight');
      if (popup.classList.contains('is-chat') || !isOpen() || tipsMode.scrollHeight <= tipsMode.clientHeight + 1) return;
      popup.classList.add('is-cramped');
      const b = $('sendy-chat').getBoundingClientRect(), t = tipsMode.getBoundingClientRect();
      if (b.bottom + tipsMode.scrollTop > t.bottom - 2) popup.classList.add('is-tight');
    }
    function openPopup() { popup.removeAttribute('hidden'); placePopup(); rocket.setAttribute('aria-expanded', 'true'); if (revealLater) { const row = revealLater; revealLater = null; reveal(row); } }
    function closePopup() {
      const hadFocus = popup.contains(document.activeElement);
      popup.setAttribute('hidden', ''); rocket.setAttribute('aria-expanded', 'false');
      if (hadFocus) rocket.focus();   // focus was in the box that just closed: back to the rocket, not to <body>
    }
    const isOpen = () => !popup.hasAttribute('hidden');

    /* ---------- tips ---------- */
    $('sendy-newtip').addEventListener('click', () => {
      const tips = tipsFor(), cur = $('sendy-tip').textContent.replace(/^💡 /, '');
      const next = tips.filter((t) => t !== cur); const t = (next.length ? next : tips)[Math.floor(Math.random() * (next.length ? next : tips).length)];
      $('sendy-tip').textContent = '💡 ' + t;
      fitTips();   // a longer tip can be the one that no longer fits
    });
    $('sendy-support').addEventListener('click', () => { location.href = '/support'; });
    // the tour with Sendy (public/onboard.js), for members: from here it can be taken again any time
    const tourBtn = $('sendy-tour');
    const tourShow = () => { if (tourBtn) tourBtn.hidden = !(window.AUTH && AUTH.user && window.ONBOARD); };
    tourShow(); document.addEventListener('auth:change', tourShow);
    if (tourBtn) tourBtn.addEventListener('click', () => { closePopup(); if (window.ONBOARD) ONBOARD.replay(); });
    $('sendy-close').addEventListener('click', closePopup);
    $('sendy-close').addEventListener('click', () => { if (window.SFX) SFX.play('close'); });   // the ✕ shuts the popup (a plain button to the generic layer)

    /* ---------- chat ---------- */
    function linkify(text, into) {
      // site paths and the email become links; everything else stays text (an answer is never markup)
      // a page by its name (/about, /newpairs?scan=…, /terms#s12), an old .html path, a wall, a home section, the email
      const re = /((?<![\w/.])\/(?:about|arcade|communities|community|data|market|newpairs|privacy|profile|squad|support|terms|tracker|wall|watchlist|whitepaper|guide|swap|tokens|beta|rocketize)(?:\?[\w=&%-]+(?:\.[\w=&%-]+)*)?(?:#[\w-]+)?(?![\w/])|\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]*\.html(?:#[\w-]+)?|\/u\/[A-Za-z0-9._-]+|\/#[\w-]+|SendRH@Atomicmail\.io)/g;
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) into.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement('a'); a.className = 'sendy-link';
        a.setAttribute('href', m[1] === EMAIL ? MAILTO : m[1]); a.textContent = m[1];
        into.appendChild(a); last = m.index + m[1].length;
      }
      if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
    }
    function addMessage(text, who, links) {
      const row = document.createElement('div'); row.className = 'sendy-msg sendy-msg-' + who;
      const bubble = document.createElement('div'); bubble.className = 'sendy-msg-bubble';
      const said = document.createElement('span'); said.className = 'sendy-sr'; said.textContent = who === 'sendy' ? 'Sendy: ' : 'You: ';
      bubble.appendChild(said);
      if (who === 'sendy') linkify(text, bubble); else bubble.appendChild(document.createTextNode(text));
      if (links && links.length) {
        const bar = document.createElement('div'); bar.className = 'sendy-msg-links';
        for (const l of links) { const a = document.createElement('a'); a.className = 'sendy-link'; a.setAttribute('href', l.href); a.textContent = l.text; bar.appendChild(a); }
        bubble.appendChild(bar);
      }
      row.appendChild(bubble); chatLog.insertBefore(row, chatFine.parentNode === chatLog ? chatFine : null);   // above the honesty line, when that rides at the foot
      if (!painting) reveal(row);
      return row;
    }
    /* The newest message in view. An answer is shown from its FIRST line, with the question it answers still above it when
       the two fit, so a long answer is read from the top down instead of being found at its end (the log used to jump to
       its last line); a question, or the · · · under it, at the foot. Instant, never smooth: the reader is waiting for it.
       A message that lands while the chat is out of sight (closed, or the tips showing) is shown when it opens again. */
    function reveal(row) {
      if (!chatLog.clientHeight) { revealLater = row; return; }
      const prev = row.previousElementSibling;
      if (!row.classList.contains('sendy-msg-sendy') || !prev) { chatLog.scrollTop = chatLog.scrollHeight; return; }
      // where a message starts in the conversation: offsetTop in the log (positioned for it), which a message's arrival
      // slide does not move — mid-slide a measured box sits 6px low, and the answer came to rest with its top edge cut off
      const cs = getComputedStyle(row.firstElementChild);
      const firstLine = row.offsetTop + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45);
      const q = prev.classList.contains('sendy-msg-user') ? prev : null;
      chatLog.scrollTop = Math.max(0, (q && firstLine - q.offsetTop <= chatLog.clientHeight - 6 ? q : row).offsetTop - 4);
    }
    /* Where focus goes in the chat: the question box — except on a touch screen with a conversation to read, where focus
       in the box would raise the keyboard over half of it. There it waits on the conversation; the box is a tap away. */
    function focusChat() { if (coarse() && history.length) chatLog.focus({ preventScroll: true }); else chatInput.focus(); }
    // a thumb under a model answer: rated up, an answer is reused for the next person who asks the same thing
    function rateBar(row, id) {
      const bar = document.createElement('div'); bar.className = 'sendy-rate';
      const mk = (v, label, tip) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sendy-rate-btn'; b.textContent = label;
        b.setAttribute('aria-label', tip); b.setAttribute('data-tip', tip);
        b.addEventListener('click', async () => {
          bar.textContent = v > 0 ? 'Thanks — noted 👍' : 'Thanks — I\'ll do better 👎';
          if (window.SFX) SFX.play(v > 0 ? 'vote' : 'downvote');   // a 👍 rises, a 👎 steps down
          focusChat();   // the button just replaced itself with the thanks
          try { await fetch('/api/sendy/rate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, vote: v }) }); } catch {}
        });
        return b;
      };
      bar.appendChild(mk(1, '👍', 'Marks this answer helpful — Sendy reuses answers people rate up'));
      bar.appendChild(mk(-1, '👎', 'Marks this answer unhelpful — it will not be reused'));
      row.querySelector('.sendy-msg-bubble').appendChild(bar);
      if (!painting) reveal(row);   // the bar made the answer taller: shown again, so where it all fits the thumbs are in view too
    }
    const ROUTES = [{ text: 'Support board', href: '/support' }, { text: 'Email ' + EMAIL, href: MAILTO }];
    const NO_ANSWER = "I don't have an answer for that yet. Ask it on the Support board, where the community and the team answer in public — or email if it's private.";
    function remember(role, text) { history.push({ role, text }); history = history.slice(-12); store.set('chat', history); }
    function paintHistory() {
      for (const m of chatLog.querySelectorAll('.sendy-msg')) m.remove();   // the messages, not the honesty line riding at their foot
      painting = true;
      if (!history.length) addMessage(chatHello(), 'sendy');
      for (const m of history) addMessage(m.text, m.role === 'assistant' ? 'sendy' : 'user');
      painting = false; revealLater = null;
      const rows = chatLog.querySelectorAll('.sendy-msg');
      reveal(rows[rows.length - 1]);   // once, for the last exchange: the conversation picks up where it was left
    }
    // where an answer came from, under it: site paths only (anything else the server might send is dropped), each with its reading's age
    const ageOf = (at) => { const s = Math.max(0, (Date.now() - at) / 1000); return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 172800 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
    const sourceLinks = (list) => (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s.href === 'string' && /^\/(?!\/)[^\s]{0,200}$/.test(s.href) && typeof s.label === 'string' && s.label)
      .slice(0, 4).map((s) => ({ text: s.label.slice(0, 60) + (Number.isFinite(s.at) ? ' · ' + ageOf(s.at) : ''), href: s.href }));
    // the server first, always; the notes above answer only when it cannot be reached (or failed outright)
    async function ask(q) {
      const mine = addMessage(q, 'user'); remember('user', q);
      if (window.SFX) SFX.play('send');   // the question goes up to Sendy
      const typing = addMessage('· · ·', 'sendy'); typing.classList.add('sendy-typing');
      chatSend.disabled = true;
      let answer = null, note = null, reached = false, qaId = 0, sources = [];
      try {
        const r = await fetch('/api/sendy/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, page: location.pathname, history: history.slice(-9, -1) }) });
        const j = await r.json().catch(() => ({}));
        reached = r.status < 500;
        if (r.ok && j.answer) { answer = String(j.answer); qaId = Number(j.id) || 0; sources = sourceLinks(j.sources); }
        // a seed phrase or a key in the question: the chat keeps (and shows) it with those words removed, and never sends it again
        if (r.ok && typeof j.redacted === 'string' && j.redacted) {
          for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user' && history[i].text === q) { history[i].text = j.redacted.slice(0, 2000); break; }
          store.set('chat', history);
          const t = mine && mine.querySelector('.sendy-msg-bubble'); if (t && t.lastChild && t.lastChild.nodeType === 3) t.lastChild.textContent = j.redacted;
        }
        else if (r.ok && j.unavailable) reached = false;   // a server from before the brain: it has no answer of its own, so the notes answer
        else if (r.status === 429) note = String(j.error || 'Sendy needs a breather — try again in a few minutes.');
      } catch {}
      typing.remove(); chatSend.disabled = false;
      if (window.SFX) { if (note) SFX.play('error'); else SFX.play('toast'); }   // Sendy answers (or says he needs a breather)
      if (answer) { const row = addMessage(answer, 'sendy', sources); remember('assistant', answer); if (qaId) rateBar(row, qaId); }
      else {
        const local = reached ? null : findAnswer(q);
        if (note) addMessage(note, 'sendy', ROUTES);
        else if (local) { addMessage(local, 'sendy'); remember('assistant', local); }
        else addMessage(NO_ANSWER + (reached ? '' : ' (I could not reach the server just now.)'), 'sendy', ROUTES);
      }
      chatInput.focus();
    }
    function showChat() { tipsMode.setAttribute('hidden', ''); chatMode.removeAttribute('hidden'); popup.classList.add('is-chat'); $('sendy-back').removeAttribute('hidden'); placePopup(); paintHistory(); setTimeout(focusChat, 60); }
    function showTips() {
      const fromBack = document.activeElement === $('sendy-back');
      chatMode.setAttribute('hidden', ''); tipsMode.removeAttribute('hidden'); popup.classList.remove('is-chat'); $('sendy-back').setAttribute('hidden', ''); placePopup();
      if (fromBack) $('sendy-chat').focus();   // the back button just hid itself: focus lands on the way back into the chat
    }
    $('sendy-chat').addEventListener('click', showChat);
    $('sendy-back').addEventListener('click', showTips);
    $('sendy-chat').addEventListener('click', () => { if (window.SFX) SFX.play('open'); });   // into the chat
    $('sendy-back').addEventListener('click', () => { if (window.SFX) SFX.play('close'); });   // back out to the tips
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); const q = chatInput.value.trim(); if (!q || chatSend.disabled) return; chatInput.value = ''; grow(); ask(q); });
    // the question box grows with what is typed (up to its max-height, then it scrolls): natively where the browser
    // sizes a field to its content, by hand elsewhere. Enter sends; Shift+Enter starts a new line.
    const nativeGrow = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));
    function grow() { if (nativeGrow) return; chatInput.style.height = 'auto'; chatInput.style.height = chatInput.scrollHeight + 2 + 'px'; }
    chatInput.addEventListener('input', grow);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (chatForm.requestSubmit) chatForm.requestSubmit(); else chatForm.dispatchEvent(new Event('submit', { cancelable: true })); }
    });

    /* ---------- reactions (owner, 2026-10-15: "make sendy react differently each time you scroll over him … a random
       emotion but never negative"; 2026-10-16: "use the different facial expressions from videos we have made with sendy …
       instead of the emoji's … in random … when users hover over and when they click on him"): each time the pointer comes
       over Sendy, and on every tap, he plays one of the faces from the videos, rendered in 3D — only happy ones. Drawn from
       a shuffled deck, so every reaction comes round before any repeats and the same one never plays twice in a row.
       With reduced motion (or the ⏸) the face still shows — the clip's fullest frame, held — but nothing moves.
       Loading, as they are wanted: the list and two clips once he shows up (none on a Save-Data connection), then two more
       each time someone reaches for him — all twelve are about a megabyte, and most visitors never touch him. A reaction
       plays only once its clip has decoded, so he never blinks out; until one has, he just hops. ---------- */
    const TAP_GAP = 600;   // a tap never cuts a reaction under 600 ms old: one reaction per click, and never more than two face changes a second
    const MOVES = { cheer: 'hop', sendit: 'dash', vee: 'bounce' };   // the jumpy ones lift the whole rocket as well
    let acts = null, order = [], owed = 0, bag = [], last = null, moodTimer = null, moodUntil = 0, moodAt = 0, MOOD_MS = 1200;
    const strips = {}, ready = new Set();
    const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    function strip(a) {
      if (strips[a.id]) return;
      const im = strips[a.id] = new Image();
      const done = () => ready.add(a.id);
      im.decoding = 'async'; im.src = '/assets/sendy-act-' + a.id + '.webp';
      if (im.decode) im.decode().then(done, () => {}); else im.onload = done;
    }
    function moreActs(n) {   // n more clips, in a random order fixed when the list arrives
      if (!acts) { owed += n; return; }
      for (const a of order) { if (n <= 0) break; if (!strips[a.id]) { strip(a); n--; } }
    }
    // the clips' frames as CSS: a strip of square cells, shown one at a time (step-end holds each until the next)
    function actCss(m) {
      const pct = (i, n) => (n > 1 ? +(i / (n - 1) * 100).toFixed(4) : 0) + '%';
      let out = '';
      for (const a of m.acts) {
        const steps = [];
        a.seq.forEach((c, j) => { if (!j || c !== a.seq[j - 1]) steps.push(+(j / a.fps / m.dur * 100).toFixed(3) + '%{background-position:' + pct(c, a.cells) + ' 0}'); });
        out += '#sendy-widget[data-act="' + a.id + '"] .sendy-act{--act-k:' + a.k + ';background-image:url(/assets/sendy-act-' + a.id + '.webp);background-size:' + (a.cells * 100) + '% 100%;' +
          '--peak:' + pct(a.peak, a.cells) + ';animation:sendy-a-' + a.id + ' ' + m.dur + 's step-end both}' +
          '@keyframes sendy-a-' + a.id + '{' + steps.join('') + '}';
      }
      // after the clips, so it wins on order: without motion, the fullest frame, held
      out += '@media (prefers-reduced-motion:reduce){#sendy-widget[data-act] .sendy-act{animation:none;background-position:var(--peak) 0}}' +
        'html.motion-off #sendy-widget[data-act] .sendy-act{animation:none;background-position:var(--peak) 0}';
      const st = document.createElement('style'); st.textContent = out; document.head.appendChild(st);
    }
    function startActs(n) {
      fetch('/assets/sendy-acts.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
        const ok = m && Array.isArray(m.acts) && m.acts.length && m.acts.every((a) => /^[a-z]+$/.test(a.id) && a.cells > 0 && a.fps > 0 && Array.isArray(a.seq) && a.seq.length && a.seq.every((c) => Number.isInteger(c) && c >= 0 && c < a.cells) && Number.isInteger(a.peak) && a.peak >= 0 && a.peak < a.cells && a.k >= 1 && a.k < 3)
          && m.dur > 0 && m.dur <= 3;
        if (!ok) return;
        acts = m; MOOD_MS = Math.round(m.dur * 1000); actCss(m); order = shuffle(m.acts.slice());
        moreActs(n + owed); owed = 0;
      }).catch(() => {});
    }
    function nextAct() {
      if (!acts) return null;
      for (let round = 0; round < 2; round++) {
        if (!bag.length) { bag = shuffle(acts.acts.slice()); if (bag[bag.length - 1] === last) bag.unshift(bag.pop()); }   // a fresh deck never opens with the last one
        for (let i = bag.length - 1; i >= 0; i--) if (bag[i] !== last && ready.has(bag[i].id)) { last = bag.splice(i, 1)[0]; return last; }
        bag = [];   // none left in this deck has loaded yet: deal again
      }
      return last && ready.has(last.id) ? last : null;   // only one has loaded so far
    }
    function react(how) {
      if (widget.hasAttribute('hidden') || flying) return;
      const t = Date.now();
      if (how === 'hover' && t < moodUntil) return;   // still mid-reaction: a pointer wavering on his edge must not set off a flurry
      if (how === 'tap' && t - moodAt < TAP_GAP) return;   // the click right after the pointer arrived: the reaction it set off is this click's
      const a = nextAct(), move = a ? MOVES[a.id] : 'hop';   // nothing loaded yet: a hop on its own
      moreActs(2);   // and two more on their way for next time
      moodUntil = t + MOOD_MS; moodAt = t;
      const play = (withFace) => {
        widget.removeAttribute('data-act'); widget.removeAttribute('data-move'); void widget.offsetWidth;   // restart, even for the same one
        if (withFace) widget.setAttribute('data-act', a.id);
        if (move) widget.setAttribute('data-move', move);
        clearTimeout(moodTimer);
        moodTimer = setTimeout(() => { widget.removeAttribute('data-act'); widget.removeAttribute('data-move'); }, MOOD_MS);
      };
      const im = a && strips[a.id];
      if (im && im.decode) im.decode().then(() => play(true), () => { ready.delete(a.id); play(false); });
      else play(!!a);
    }
    rocket.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') react('hover'); });
    rocket.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') react('tap'); }, { passive: true });   // a finger landing on him, a tap or the start of a scroll (a finger has no hover); its click then falls inside TAP_GAP

    /* ---------- the rocket: tap opens, drag moves (desktop) ---------- */
    let drag = null;
    rocket.addEventListener('click', (e) => {
      if (drag && drag.moved) { drag = null; return; } drag = null; e.stopPropagation();
      store.set('greeted', true);   // found him without the hello: no need for it this visit
      react('tap');
      if (isOpen()) closePopup();
      else { openPopup(); if (e.detail === 0) { const first = chatMode.hasAttribute('hidden') ? $('sendy-chat') : chatInput; if (first) first.focus(); } }   // opened from the keyboard: focus goes in with it
    });
    rocket.addEventListener('pointerdown', (e) => {
      if (isMobile() || e.button !== 0) return;
      const r = widget.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      rocket.setPointerCapture(e.pointerId);
    });
    rocket.addEventListener('pointermove', (e) => {
      if (!drag || isMobile()) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; userPlaced = true; if (isOpen()) closePopup();
      setPos(drag.left + dx, drag.top + dy);
    });
    rocket.addEventListener('pointerup', () => { if (drag && !drag.moved) drag = null; });
    rocket.addEventListener('pointercancel', () => { drag = null; });
    rocket.addEventListener('mouseenter', () => { hovering = true; });
    rocket.addEventListener('mouseleave', () => { hovering = false; });
    function setPos(x, y) {
      const s = size(), maxX = window.innerWidth - s - 8, maxY = window.innerHeight - s - 8;
      x = Math.max(8, Math.min(x, maxX)); y = Math.max(8, Math.min(y, maxY));
      widget.style.left = x + 'px'; widget.style.top = y + 'px'; widget.style.right = 'auto'; widget.style.bottom = 'auto';
      placePopup();
    }
    window.addEventListener('resize', () => { if (widget.style.left) { const r = widget.getBoundingClientRect(); setPos(r.left, r.top); } else if (isOpen()) placePopup(); });

    /* ---------- the flights: a short glide along the edges now and then (desktop, popup closed, nobody typing) ---------- */
    const fabClear = fabClearPx;   // the strip in pixels (parsing the calc() gave 5.5, and a flight landed in the strip)
    function anchors() {
      const s = size(), W = window.innerWidth, H = window.innerHeight, m = 16, low = H - fabClear() - s;
      if (low < 8) return [];
      const y = (v) => Math.max(8, Math.min(v, low));   // never down into the strip the music player and SEND IT own
      // along the right edge, the side it rests on: a glide to the left edge parked it on the page
      return [{ x: W - s - m, y: low }, { x: W - s - m, y: y(H * 0.42) }, { x: W - s - m, y: y(H * 0.16) }];
    }
    // a spot where the rocket's body would sit on a link, a button or a field is not a place to land (sticky bars included)
    const CONTROL = 'a[href],button,input,select,textarea,summary,[role="button"],[tabindex]:not([tabindex="-1"])';
    function coversControl(a) {
      const s = size();
      for (const fx of [0.25, 0.5, 0.75]) for (const fy of [0.15, 0.5, 0.85]) {
        const top = document.elementsFromPoint(a.x + s * fx, a.y + s * fy).find((el) => !widget.contains(el));
        if (top && top.closest(CONTROL)) return true;
      }
      return false;
    }
    function typing() { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); }
    function fly() {
      if (isMobile() || reduced() || userPlaced || flying || hovering || isOpen() || Date.now() < moodUntil || !sayEl.hasAttribute('hidden') || document.visibilityState !== 'visible' || typing()) return;
      const r = widget.getBoundingClientRect(), from = { x: r.left, y: r.top };
      const opts = anchors().filter((a) => Math.hypot(a.x - from.x, a.y - from.y) > 120 && !coversControl(a));
      if (!opts.length) return;
      const to = opts[Math.floor(Math.random() * opts.length)];
      const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy), bend = Math.min(90, len / 4) * (Math.random() < 0.5 ? -1 : 1);
      const cx = from.x + dx / 2 - dy / len * bend, cy = from.y + dy / 2 + dx / len * bend;   // one control point, off the straight line
      const frames = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16, u = 1 - t, x = u * u * from.x + 2 * u * t * cx + t * t * to.x, y = u * u * from.y + 2 * u * t * cy + t * t * to.y;
        const tx = 2 * u * (cx - from.x) + 2 * t * (to.x - cx), ty = 2 * u * (cy - from.y) + 2 * t * (to.y - cy);
        const tilt = Math.max(-28, Math.min(28, Math.atan2(tx, -ty) * 180 / Math.PI * 0.35));   // lean into the direction of travel, gently
        frames.push({ transform: 'translate(' + (x - from.x) + 'px,' + (y - from.y) + 'px) rotate(' + tilt + 'deg)' });
      }
      frames[frames.length - 1].transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(0deg)';
      flying = true; widget.classList.add('is-flying');
      const anim = widget.animate(frames, { duration: 1400 + len * 0.9, easing: 'ease-in-out' });
      anim.onfinish = anim.oncancel = () => { widget.classList.remove('is-flying'); widget.style.transform = ''; setPos(to.x, to.y); flying = false; };
    }
    function scheduleFlight() { setTimeout(() => { fly(); scheduleFlight(); }, 45000 + Math.random() * 45000); }

    /* ---------- outside click / escape ---------- */
    // inside or out by the click's path, fixed when it starts: a thumb replaces itself with its thanks, and its click
    // reached here from a button no longer in the widget — so rating an answer closed the chat
    document.addEventListener('click', (e) => { if (isOpen() && !e.composedPath().includes(widget)) closePopup(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && window.SFX) SFX.play('close'); });   // before the close below, while the popup is still open
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closePopup(); });   // closePopup returns focus to the rocket only if it was inside
    document.addEventListener('auth:change', () => { const g = $('sendy-greeting'); if (g) g.textContent = greeting(); });

    /* ---------- reactions: a line in a speech bubble when something happens on the site ----------
       Built on the events the pages already dispatch. Never while the popup is open (the person is reading),
       never mid-flight, at most one every few seconds — a ghost find is the one thing that jumps the queue.
       Every line is a joke about the rocket or the moment, never a nudge: nothing here says buy, sell or moon. */
    const LINES = {
      callopen: ['Composer\'s open. Say something worth the Wall.', 'A Send Call! Deep breath. Read the chart, not the tea leaves.', 'Ooh, a call. I\'ll hold your coffee. Wait — fins. No hands. Well, some hands.'],
      call: ['Posted on the Wall. That\'s on the record now — like a tattoo, but cheaper.', 'Logged. The Wall never forgets. I forget everything at reload, personally.', 'Bold. I like bold. I am, technically, shaped like bold.'],
      squadcall: ['Squad-only. Whispered it. Very hush-hush. 🫡', 'Private call, logged for the squad. My lips are sealed. I don\'t have lips.'],
      post: ['Posted. The Wall just grew a brick taller.', 'On the Wall. Very load-bearing.', 'Sent it. Somewhere, a scroll wheel twitched.'],
      save: ['Starred. I\'ll keep an eye on it. I have two.', 'Watchlisted. Like a bookmark, but with more suspense.', 'Saved. It\'s on the list now. The list is honoured.'],
      unsave: ['Un-starred. Breakups are hard.', 'Off the list. We had a good run.', 'Removed. The list will heal.'],
      egg: ['👻 BOO. You found one. Points minted, ghost evicted.', 'A hidden ghost! {found} of {total}. The others are getting nervous.', 'Ghost busted. I felt a chill. Might be the altitude.'],
      scanned: ['Scan\'s in. Read it like a menu, not a prophecy.', 'Every number the chain would give me. Your turn to think.', 'Done. Liquidity is the pool, not the vibes.'],
      signin: ['Welcome back, @{name}! I kept your seat warm. Rockets run hot.', 'Signed in. The leaderboard senses a disturbance.', 'Hey @{name}. Mission control is back online.'],
      signout: ['Logged out. I\'ll just… float here.', 'Bye for now. Orbiting nothing in particular until you\'re back.'],
      theme: ['Ooh, new paint job. Do I look faster? I feel faster.', 'Theme changed. Same rocket, different mood lighting.', 'Fresh colours. My fins approve.'],
      boost: ['Holder boost updated. Diamond hands, meet rocket fins.', 'Boost check done. The chain has spoken; I merely relay.'],
      entered: ['You\'re in! Please keep arms and fins inside the rocket at all times.', 'Ticket accepted. Welcome aboard — the seatbelt is decorative.'],
      firstvisit: ['First time here? I\'m Sendy. Tap me whenever you\'re lost. Or bored. Or both.'],
      hello: ['Hey, I\'m Sendy! 👋 Stuck, or just curious? Tap me — I\'m here to help.', 'Hi! I\'m Sendy, this site\'s helper. Got a question? Tap me any time.', 'Psst — I\'m Sendy. Lost? Curious? Tap me and I\'ll help you find your way.'],
      hellouser: ['Hey @{name}! 👋 Need a hand? Tap me — I\'m here to help.', 'Welcome back, @{name}! Tap me if you need anything.'],
      oops: ['The chain hiccupped. Happens to the best of us. Give it a minute.', 'That didn\'t go through. Not you — the tubes. Try again shortly.', 'Turbulence. Nothing decided, nothing lost. Retry in a bit.']
    };
    const SAY_COOLDOWN = 8000, sayEl = $('sendy-say'), liveEl = $('sendy-live');
    let sayTimer = null, hypeTimer = null, liveTimer = null, lastSayAt = 0; const lastLine = {};
    function hideSay() { sayEl.setAttribute('hidden', ''); widget.classList.remove('is-hyped'); endGreet(); }
    /* the hello (owner, 2026-10-16: closed on arrival, "just a fun little speech bubble that greets the user and lets the
       user know that he is here to help", gone "after the user start interacting with the site"): a bubble that stays
       until the visitor starts using the site — a click or tap anywhere (in an embedded chart too: focus leaves for its
       frame), a key that acts on the page (not a bare Shift/Ctrl/⌘, nor a shortcut such as ⌘-Tab on the way out), or the
       wheel. A scroll on its own does not end it: pages scroll themselves (a section link, panels filling in above), and
       dragging the scrollbar is a pointerdown anyway. A tap on the bubble opens Sendy, as it says. While it is up nothing
       else he would say takes its place, and he stays where he is (no flights). */
    const GREET_ON = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove', 'pointercancel'];   // a pan cancels the pointer: a swipe that starts on the bubble ends it too
    const BARE_KEY = /^(Shift|Control|Alt|AltGraph|Meta|OS|CapsLock|Fn|FnLock|Hyper|Super)$/;
    const asIs = (e) => e && e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || BARE_KEY.test(e.key));   // not someone using the page
    function greetDone(e) {
      if (!widget.classList.contains('say-greet') || asIs(e)) return;
      if (e && (e.type === 'pointerdown' || e.type === 'touchstart') && e.target && sayEl.contains(e.target)) return;   // the bubble's own tap opens Sendy (below)
      if (covered()) { unGreet(); return; }   // a click in a dialog that came up over it (the tour's welcome) is not using the site
      hideSay();
    }
    function greetFrame() { setTimeout(() => { const f = document.activeElement; if (f && f.tagName === 'IFRAME') greetDone(); }, 0); }
    function endGreet() {
      if (!widget.classList.contains('say-greet')) return;
      widget.classList.remove('say-greet'); sayEl.removeAttribute('data-tip'); sayEl.removeAttribute('role');
      GREET_ON.forEach((t) => document.removeEventListener(t, greetDone, true));
      window.removeEventListener('blur', greetFrame);
    }
    sayEl.addEventListener('click', (e) => { if (!widget.classList.contains('say-greet')) return; e.stopPropagation(); hideSay(); openPopup(); });
    function say(kind, vars, urgent, stay) {
      const lines = LINES[kind]; if (!lines || widget.hasAttribute('hidden')) return false;
      if (isOpen() || flying) return false;
      if (widget.classList.contains('say-greet')) return false;   // the hello stays until the visitor starts using the site: nothing replaces it
      const t = Date.now(); if (!urgent && t - lastSayAt < SAY_COOLDOWN) return false;
      let i = Math.floor(Math.random() * lines.length); if (lines.length > 1 && i === lastLine[kind]) i = (i + 1) % lines.length;
      lastLine[kind] = i; lastSayAt = t;
      const text = lines[i].replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? String(vars[k]) : m);
      sayEl.textContent = text;
      // screen readers hear it from a live region that is always there: one filled as it appears is often not announced
      clearTimeout(liveTimer); liveEl.textContent = ''; liveTimer = setTimeout(() => { liveEl.textContent = text; }, 150);
      if (!isMobile()) {
        // measured, not guessed: above the rocket if it fits there, below it if it fits there (never into the SEND IT
        // strip), otherwise beside it — a fixed 140px rule of thumb only suited the first 76px rocket
        sayEl.style.visibility = 'hidden'; sayEl.removeAttribute('hidden');
        const r = rocket.getBoundingClientRect(), bw = Math.min(parseFloat(getComputedStyle(sayEl).fontSize) * 16, window.innerWidth - 24), bh = sayEl.offsetHeight;
        const above = r.top - 8, below = window.innerHeight - fabClearPx() - r.bottom - 8, side = above < bh && below < bh;
        widget.classList.toggle('say-up', !side && above < bh);
        widget.classList.toggle('say-side', side);
        widget.classList.toggle('say-left', side ? r.left - bw < 8 : r.right - bw < 8);
        sayEl.style.visibility = '';
      }
      sayEl.removeAttribute('hidden');
      clearTimeout(hypeTimer);
      if (!reduced()) {
        widget.classList.remove('is-hyped'); void widget.offsetWidth; widget.classList.add('is-hyped');
        if (stay) hypeTimer = setTimeout(() => widget.classList.remove('is-hyped'), 700);   // one hop: a hello that stays must not keep him racing
      }
      clearTimeout(sayTimer); endGreet();
      if (stay) {
        widget.classList.add('say-greet'); sayEl.setAttribute('data-tip', 'Opens Sendy — ask a question, or get a tip about this page');
        sayEl.setAttribute('role', 'button');   // what the site's tips answer to (tips.js); the bubble stays aria-hidden, the live region speaks
        GREET_ON.forEach((t) => document.addEventListener(t, greetDone, { capture: true, passive: true }));
        window.addEventListener('blur', greetFrame);
      } else sayTimer = setTimeout(hideSay, 4500);
      return true;
    }
    /* the hello waits until it can be seen: the 18+ question answered and gone, the homepage's intro over, no dialog up,
       Sendy himself on screen (the Hot Feed, an arcade flight and a phone's Scanner filters hide him), the tab in front —
       and all of that for a moment (1.2 s), not just the gap between two dialogs (the 18+ answer, then the tour's welcome
       650 ms later). Only then does it count as said for the visit; a dialog that opens over it later takes it down unsaid,
       and it comes back once the page is clear. A visitor already busy by then (a click, a key, the wheel outside the gate,
       the intro and dialogs, or focus already inside an embedded chart) gets it as an ordinary line that goes by itself. */
    let busy = false, greetTries = 0, clearSince = 0;
    function covered() {
      if (window.AGE && (AGE.needed || AGE.isOpen)) return true;
      if ((document.body.dataset.intro && !sawEntered) || document.querySelector('#intro')) return true;
      for (const m of document.querySelectorAll('[aria-modal="true"]')) if (m.getClientRects().length) return true;
      return false;
    }
    function busyOn(e) {
      if (asIs(e) || covered()) return;
      busy = true; GREET_ON.forEach((t) => document.removeEventListener(t, busyOn, true));
    }
    GREET_ON.forEach((t) => document.addEventListener(t, busyOn, { capture: true, passive: true }));
    function clearToGreet() { return !covered() && widget.getClientRects().length > 0 && document.visibilityState === 'visible' && !isOpen() && !flying; }
    function waitToGreet() {
      if (store.get('greeted')) return;
      if (!clearToGreet()) clearSince = 0;
      else if (!clearSince) clearSince = Date.now();
      else if (Date.now() - clearSince >= 1200) {
        const u = window.AUTH && AUTH.user && AUTH.user.username, f = document.activeElement, inFrame = !!f && f.tagName === 'IFRAME';
        if (say(u ? 'hellouser' : 'hello', { name: u }, true, !busy && !inFrame)) { store.set('greeted', true); watchGreet(); return; }
      }
      if (++greetTries < 1300) setTimeout(waitToGreet, 700);   // looks again for about 15 minutes, then leaves it to the next page
    }
    function watchGreet() { if (!widget.classList.contains('say-greet')) return; if (covered()) unGreet(); else setTimeout(watchGreet, 700); }
    function unGreet() { hideSay(); store.set('greeted', false); clearSince = 0; greetTries = 0; waitToGreet(); }
    rocket.addEventListener('click', () => { if (!sayEl.hasAttribute('hidden')) hideSay(); }, true);   // opening the popup clears a bubble
    document.addEventListener('egg:found', (e) => { const d = e.detail || {}; if (d.id != null) say('egg', { found: d.found, total: d.total }, true); });
    document.addEventListener('post:created', (e) => { say(e.detail && e.detail.call_id ? 'call' : 'post'); });
    document.addEventListener('squad:call', () => { say('squadcall'); });
    document.addEventListener('auth:change', (e) => { if (window.ONBOARD && (ONBOARD.active() || ONBOARD.due())) return; if (e.detail && e.detail.username) say('signin', { name: e.detail.username }); else if (!e.detail) say('signout'); });
    document.addEventListener('site-prefs', () => { say('theme'); });
    document.addEventListener('boost:changed', () => { say('boost'); });
    document.addEventListener('jsi:entered', (e) => { if (store.get('greeted')) say(e.detail && e.detail.firstVisit ? 'firstvisit' : 'entered', null, true); });   // a visit's first page says hello instead
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-call-go]')) { setTimeout(() => say('callopen'), 250); return; }
      const w = e.target.closest('.np-watch');   // the ☆: read its state once the toggle has landed; signed out it only opens the sign-in
      if (w && window.AUTH && AUTH.user) setTimeout(() => say(w.getAttribute('aria-pressed') === 'true' ? 'save' : 'unsave'), 150);
    }, true);
    const scanOut = document.querySelector('#sc-result');   // the Scanner's result box — only on that page, so optional (querySelector: not one of Sendy's own ids); a scan's result is the token dashboard, .tkd
    if (scanOut) new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('.sc-hit, .tkd') || n.querySelector('.sc-hit, .tkd'))) { say('scanned'); return; } }).observe(scanOut, { childList: true });
    if (typeof window.sendToast === 'function') {   // a ⚠️ toast is the site saying something did not go through
      const toast = window.sendToast;
      window.sendToast = function (msg) { try { if (/^\s*⚠️/.test(String(msg))) say('oops'); } catch {} return toast.apply(this, arguments); };
    }
    window.SENDY = { say };   // the pages can ask for a reaction of their own: SENDY.say('post')

    /* ---------- show up: the rocket, closed; once a visit a hello, when it can be seen ---------- */
    setTimeout(() => {
      widget.removeAttribute('hidden');
      startActs(navigator.connection && navigator.connection.saveData ? 0 : 2);
      if (!isMobile()) scheduleFlight();
      shownUp = true;
      const d = earlyEntered; earlyEntered = null;
      if (!store.get('greeted')) waitToGreet();
      // the intro ended while Sendy was still waiting for the page to load: say now what he would have said then
      else if (d) say(d.firstVisit ? 'firstvisit' : 'entered', null, true);
    }, 1400);
  }

  /* ---------- start after the page, never alongside it ----------
     The idle sprite sheet is over half a megabyte, and the still, the styles and the markup come with it. None of it
     may compete with the page's own first paint (the hero image first of all), so nothing of Sendy's is added before
     the window's load event has fired, and then only in an idle moment: requestIdleCallback, or a short timer where a
     browser has none. The sheet itself is fetched only once the widget unhides, 1.4 s after that. A page whose load
     event never comes (a request that hangs) still gets its rocket after LOAD_CAP_MS. */
  const LOAD_CAP_MS = 15000;
  let started = false;
  /* The homepage's intro can end (jsi:entered) before this deferred start has put Sendy on screen. Before the deferral
     he was up 1.4 s after DOMContentLoaded, so an intro that ended later than that got his line; one that ended sooner
     did not (say() stays quiet while he is hidden). Keep exactly that: remember a late-enough event, and replay it
     once he shows up. Earlier ones are dropped, as they always were. */
  let shownUp = false, earlyEntered = null, sawEntered = false;
  document.addEventListener('jsi:entered', (e) => {
    sawEntered = true;   // the homepage's intro (and the 18+ question after it) are over: the hello may show
    if (shownUp) return;   // he is on screen: init's own listener answers it
    const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    const dcl = nav && nav.domContentLoadedEventEnd;
    if (dcl && performance.now() - dcl >= 1400) earlyEntered = e.detail || {};
  });
  function whenIdle() {
    if (started) return; started = true;
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => init(), { timeout: 2000 });
    else setTimeout(init, 200);
  }
  if (document.readyState === 'complete') whenIdle();
  else { window.addEventListener('load', whenIdle, { once: true }); setTimeout(whenIdle, LOAD_CAP_MS); }
})();
