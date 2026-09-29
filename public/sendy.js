/* Sendy — the $Send rocket in the corner: greets, tips, and answers questions in chat.
   The look is the 3D Sendy from the marketing video — its idle loop as a sprite sheet (/assets/sendy-idle.png,
   30 frames) and a still for the chat header (/assets/sendy.png).
   Phone: pinned above the bottom controls, never dragged, never in the way of anything.
   Desktop: floats, takes a short flight along the edges now and then, and can be dragged anywhere — once
   dragged, it stays where it was put.
   Chat: POST /api/sendy/ask answers from the site's own text. Without a model key the built-in notes below
   answer the common questions and everything else is handed to a person: the Support board, or the email. */
(function () {
  'use strict';

  const EMAIL = 'SendRH@Atomicmail.io';
  const MAILTO = 'mailto:' + EMAIL + '?subject=Question%20about%20sendrh.com';
  const FRAMES = 30;                                        // frames in the sprite sheet (2s loop)
  const isMobile = () => window.innerWidth < 768;
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('motion-off');   // the site's ⏸ switch counts too
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the built-in notes: what Sendy can say with no model behind it ---------- */
  const knowledgeBase = {
    'send power': {
      keywords: ['send power', 'power', 'points', 'leaderboard', 'level'],
      answer: 'Send Power is your score on $Send. You earn it by making Send Calls on the Wall, taking part in communities and being active; it decays if you go quiet. The About page (/about.html) has every rule, and your dashboard shows where yours comes from.'
    },
    'send call': {
      keywords: ['send call', 'call', 'how to call', 'make a call'],
      answer: 'A Send Call is a public, permanent scorecard on a token you picked. Scan a token in the Scanner (/newpairs.html), then tap "Send Call to the Wall". If you are in a Send Squad you can make the call private to the squad instead. Calls stay on record even if the account is deleted.'
    },
    'scanner': {
      keywords: ['scanner', 'scan', 'token address', 'on-chain', 'new pairs', 'radar'],
      answer: 'The Scanner (/newpairs.html) reads any token or pool address on Robinhood Chain: holders, market, price history, the contract. Paste the address and tap Scan. It is a reading of public chain data, not an audit — nothing on it is a promise.'
    },
    'wallet': {
      keywords: ['wallet', 'link wallet', 'track', 'holdings', 'pnl', 'tracker', 'cost basis'],
      answer: 'The wallet tracker (/tracker.html) follows any wallet on Robinhood Chain — holdings, trades, cost basis and PNL, read from the chain by this site. Linking a wallet to your account happens on your profile (/profile.html) and is how the site checks what you hold.'
    },
    'squad': {
      keywords: ['squad', 'send squad', 'private group'],
      answer: 'A Send Squad is a private, token-gated group. Members can make Send Calls that only the squad sees, and the squad earns points together. Start one or find yours under Communities (/communities.html); only verified members count toward a squad\'s gate.'
    },
    'community': {
      keywords: ['community', 'communities', 'join'],
      answer: 'Communities gather around a token — $Send and $GWC have their own from day one. Holding the token opts you in, unlocks the holders-only wall and proposals, and everything you do there earns 10× Send Power. Start on /communities.html.'
    },
    'watchlist': {
      keywords: ['watchlist', 'save token', 'star', 'saved'],
      answer: 'Your Watchlist (/watchlist.html) holds the tokens you saved. Scan a token and tap its ☆ to keep it; from the list you can jump back to a full scan or make a Send Call.'
    },
    'report': {
      keywords: ['report', 'spam', 'inappropriate', 'moderator', 'remove'],
      answer: 'Every post and comment has a report control — use it and a moderator will look. For anything that needs a person right away, email ' + EMAIL + ' with a link and a sentence about what is wrong.'
    },
    'safety': {
      keywords: ['safe', 'security', 'risk', 'dyor', 'research', 'rug', 'scam', 'should i buy', 'buy'],
      answer: 'Nothing here will ever tell you to buy — that is not what the site does. Read the token in the Scanner (/newpairs.html), look at the liquidity, the holders and the contract, and decide for yourself. Everything on this site is entertainment, not financial advice, and it is not affiliated with Robinhood.'
    },
    'appeal': {
      keywords: ['appeal', 'restricted', 'strike', 'suspended', 'read-only', 'muted', 'banned'],
      answer: 'If your account was restricted, there is a free appeal: email ' + EMAIL + ' with your account name and what happened, and a person will look at it. Strikes never expire on their own, but an appeal can lift a restriction.'
    },
    'account': {
      keywords: ['sign in', 'login', 'log in', 'password', 'two-factor', '2fa', 'delete my account', 'username', 'invite'],
      answer: 'Your account lives on /profile.html: username, sign-in methods, two-factor, linked wallets, and the delete control (deleting is permanent). Joining is by invite code, and nobody here will ever ask for your password, a seed phrase or a private key.'
    },
    'support': {
      keywords: ['support', 'help', 'question', 'contact', 'email'],
      answer: 'Two ways to reach a person: ask on the Support board (/support.html), where the community and the team answer in public, or email ' + EMAIL + ' for anything private. Both are free.'
    }
  };
  function findAnswer(question) {
    const q = question.toLowerCase();
    for (const entry of Object.values(knowledgeBase)) if (entry.keywords.some((k) => q.includes(k))) return entry.answer;
    return null;
  }

  /* ---------- tips per page ---------- */
  const pageTips = {
    '/': { tips: ['New here? The How to Buy guide is on this page, under the hero.', 'Drag me anywhere on a desktop — I stay where you put me.', 'Anything you cannot find: ask me, or the Support board.'] },
    '/about.html': { tips: ['Everything about Send Power and the leaderboard is on this page.', 'Send Calls are permanent — they outlive the account that made them.', 'Strikes never expire on their own, but an appeal by email is free.'] },
    '/newpairs.html': { tips: ['Paste any token or pool address to read its full on-chain profile.', 'Tap the ☆ on a scan to save the token to your Watchlist.', 'The buttons under a scan open a Send Call — to the Wall, or to your Squad.', 'A scan is public chain data, not an audit. Nothing here is a promise.'] },
    '/wall.html': { tips: ['The Send Wall is every Send Call, live, as a permanent scorecard.', 'Tap a name to open that person\'s own Send Wall.', 'Deep liquidity and steady price make a call easier to read — never a guarantee.'] },
    '/support.html': { tips: ['Ask in public here; answers that solve it get voted up.', 'Prefer private? Email ' + EMAIL + ' — a person reads it.', 'Answering someone else\'s question counts too.'] },
    '/profile.html': { tips: ['Link a wallet here — it is how the site checks what you hold.', 'Two-factor keeps the account yours; nobody here asks for passwords.', 'Deleting the account is permanent; Send Calls stay under a placeholder.'] },
    '/watchlist.html': { tips: ['Saved tokens land here. Scan one and tap its ☆.', 'Each saved token opens straight back into a full scan.', 'A Send Call can start from here too.'] },
    '/communities.html': { tips: ['$Send and $GWC have their own communities, run by the site.', 'Hold the token to opt in and earn 10× Send Power there.', 'Send Squads are the private, token-gated version.'] },
    '/community.html': { tips: ['The holders-only wall opens once your linked wallet passes the gate.', 'Proposals let the community decide things together.', 'Tap the founder\'s name to see their Send Wall.'] },
    '/squad.html': { tips: ['Squad calls are private to the squad and score for it.', 'Only verified members count toward the gate.', 'The 🛡️ button on any token scan calls it to this squad.'] },
    '/tracker.html': { tips: ['Follow any wallet: holdings, trades, cost basis, PNL — read from the chain.', 'The explorer never learns which wallets you look at; this site reads them.', 'A wallet you save reopens instantly next time.'] },
    '/arcade.html': { tips: ['The weekly competitions live here, with their boards.', 'Biggest Sender resets every week.', 'Tap any name on a board to open their Send Wall.'] },
    '/data.html': { tips: ['The Data API is read-only public data behind a key.', 'Keys are the burn kind — the docs on this page say how.', 'Limits are per key; the page lists them.'] }
  };
  const path = () => location.pathname.replace(/\/$/, '') || '/';
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
    return '<div id="sendy-widget" class="sendy-widget" hidden>' +
      '<button class="sendy-rocket" id="sendy-rocket" type="button" aria-label="Sendy, your $Send guide" aria-expanded="false" data-tip="Opens Sendy — ask a question, or get a tip about this page. Drag to move (desktop)">' +
        '<span class="sendy-sprite" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="sendy-say" id="sendy-say" role="status" hidden></div>' +
      '<div class="sendy-popup" id="sendy-popup" role="dialog" aria-label="Sendy" hidden>' +
        '<div class="sendy-head">' +
          '<button class="sendy-hbtn sendy-back-btn" id="sendy-back" type="button" data-tip="Leaves the chat and shows the tips again" hidden>← Tips</button>' +
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
          '</div>' +
          '<p class="sendy-fine">Prefer email? <a class="sendy-link" href="' + MAILTO + '">' + EMAIL + '</a> — private, and a person reads it.</p>' +
        '</div>' +
        '<div class="sendy-body" id="sendy-chat-mode" hidden>' +
          '<div class="sendy-chat-messages" id="sendy-chat-messages" role="log" aria-live="polite"></div>' +
          '<form class="sendy-chat-form" id="sendy-chat-form">' +
            '<textarea id="sendy-chat-input" class="sendy-chat-input" rows="1" placeholder="Ask Sendy anything — Enter sends" autocomplete="off" maxlength="600" aria-label="Your question for Sendy"></textarea>' +
            '<button type="submit" class="sendy-chat-send" id="sendy-chat-send" aria-label="Send the question" data-tip="Sends your question to Sendy">Send</button>' +
          '</form>' +
          '<p class="sendy-fine">Sendy\'s answers are generated and can be wrong — check the page it points to. Entertainment only, not financial advice, not affiliated with Robinhood.</p>' +
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
      /* Three times the first size — 228px, 180px on a phone — but never more than 30% of the screen's height: on a
         landscape phone or a short window the full size left no clear strip above or below it, and covered the nav.
         On :root, so the footer can keep that much room free at the end of every page. */
      ':root{--sendy-size:min(228px,30vh)}@media (max-width:767px){:root{--sendy-size:min(180px,30vh)}}' +
      '#sendy-widget{--sendy-z:190;position:fixed;right:1rem;bottom:var(--fab-clear,5.5rem);z-index:var(--sendy-z);font-family:inherit;width:var(--sendy-size);height:var(--sendy-size)}' +
      '#sendy-widget:not([hidden]){display:block}' +
      '@media (max-width:767px){#sendy-widget{right:0.75rem}}' +
      'footer{padding-bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px)}' +   /* the footer's last links scroll clear of the rocket */
      /* where it would sit on controls that never move, it steps aside: the Hot Feed's action rail (a full-screen player,
         where nothing else belongs), the arcade's multiplier while a flight runs, and the Scanner's settings sheet on a phone */
      'body.np-mode-feed #sendy-widget,html.arc-flying #sendy-widget{display:none}' +
      '@media (max-width:760px){body:has(#np-filters:not([hidden])) #sendy-widget{display:none}}' +
      /* Only the rocket's body takes a tap. The frame is a square and most of it is transparent; at this size the whole
         square used to catch taps meant for whatever showed through it. The button keeps its focus ring, hover and drag:
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
      /* a reaction: a speech bubble by the rocket, and a hop — as wide as its words allow, never wider than the screen */
      '.sendy-say{position:absolute;bottom:calc(var(--sendy-size) + 8px);right:0;width:max-content;max-width:min(16em,calc(100vw - 1.5rem));padding:.5em .75em;border-radius:.8em;border-bottom-right-radius:4px;background:var(--green);color:var(--ink-1);font-weight:600;font-size:max(var(--text-floor), .86rem);line-height:1.35;box-shadow:0 8px 24px rgba(0,0,0,.35);animation:sendy-in .25s ease;z-index:1}' +
      '.sendy-say[hidden]{display:none}' +
      '.sendy-widget.say-up .sendy-say{bottom:auto;top:calc(var(--sendy-size) + 8px);border-radius:.8em;border-top-right-radius:4px}' +
      '.sendy-widget.say-left .sendy-say{right:auto;left:0;border-radius:.8em;border-bottom-left-radius:4px}' +
      '.sendy-widget.say-side .sendy-say{bottom:auto;top:0;right:calc(var(--sendy-size) + 8px);left:auto;border-radius:.8em;border-top-right-radius:4px}' +
      '.sendy-widget.say-side.say-left .sendy-say{right:auto;left:calc(var(--sendy-size) + 8px);border-radius:.8em;border-top-left-radius:4px}' +
      '@media (max-width:767px){.sendy-say{position:fixed;right:.75rem;bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px);max-width:calc(100vw - 1.5rem)}}' +
      '.sendy-widget.is-hyped .sendy-sprite{animation-duration:.5s}' +
      '@media (prefers-reduced-motion:no-preference){.sendy-widget.is-hyped .sendy-rocket{animation:sendy-hop .6s ease}}' +
      '@keyframes sendy-hop{0%,100%{transform:none}40%{transform:translateY(calc(var(--sendy-size) * -.16)) rotate(-6deg)}70%{transform:translateY(calc(var(--sendy-size) * -.05)) rotate(4deg)}}' +   /* the glow and the hop scale with the rocket */
      /* the popup: above the rocket, aligned to its right edge; flipped when the rocket sits near the top or the left.
         25em wide (capped to the screen) and, in the chat, a steady 40em tall (capped to the room there is), with the
         conversation taking whatever the header and the question box leave */
      '.sendy-popup{position:absolute;bottom:calc(var(--sendy-size) + 10px);right:0;font-size:max(var(--text-floor), .92rem);width:min(25em,calc(100vw - 2rem));max-height:calc(100vh - 24px);background:var(--ink-2,var(--bg-0,#0f120b));color:var(--text);border:1px solid var(--edge-ctl);border-radius:.7em;box-shadow:0 12px 36px rgba(0,0,0,.45);z-index:1;overflow:hidden;display:flex;flex-direction:column}' +
      '.sendy-popup.is-chat{height:40em}' +
      '@media (min-width:768px){.sendy-widget.is-up .sendy-popup{bottom:auto;top:calc(var(--sendy-size) + 10px)}' +
        '.sendy-widget.is-left .sendy-popup{right:auto;left:0}' +
        '.sendy-widget.is-side .sendy-popup{position:fixed;top:auto;bottom:var(--fab-clear,5.5rem);right:auto;left:auto}}' +   /* beside the rocket: placePopup sets the side and the width */
      /* on a phone the popup spans the width above the strip, over the rocket's upper part (a hand's breadth of it
         stays in view): leaving the whole 180px rocket clear cost a short phone most of the conversation */
      '@media (max-width:767px){.sendy-popup{position:fixed;left:0.75rem;right:0.75rem;bottom:calc(var(--fab-clear,5.5rem) + 68px);width:auto;max-width:none;max-height:calc(100vh - var(--fab-clear,5.5rem) - 84px);display:flex;flex-direction:column}}' +
      '@supports (height:100dvh){@media (max-width:767px){.sendy-popup{max-height:calc(100dvh - var(--fab-clear,5.5rem) - 84px)}}}' +
      /* a phone on its side: above the rocket there is almost no height, so the panel stands left of the rocket's column
         instead, from near the top down to the strip the music player and the SEND IT button own */
      '@media (max-width:767px) and (max-height:500px){.sendy-popup{right:calc(var(--sendy-size) + 1.5rem);bottom:var(--fab-clear,5.5rem);max-height:calc(100vh - var(--fab-clear,5.5rem) - 12px)}}' +
      '@supports (height:100dvh){@media (max-width:767px) and (max-height:500px){.sendy-popup{max-height:calc(100dvh - var(--fab-clear,5.5rem) - 12px)}}}' +
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
      '@media (max-width:420px),(max-height:700px){.sendy-popup.is-chat .sendy-title small{display:none}}' +   /* a narrow or short screen in the chat: one row for the header */   /* a phone in the chat: the back, Sendy and the close on one row */
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
      '.sendy-fine{margin:0;font-size:max(var(--text-floor), .8em);line-height:1.4;color:var(--text-mute)}' +
      '.sendy-link{color:var(--green-bright);font-weight:600;text-decoration:underline;text-underline-offset:2px;border-radius:3px}' +
      /* chat: the conversation fills the body, the question box and the fine print sit under it */
      '.sendy-chat-messages{display:flex;flex-direction:column;gap:.6em;flex:1 1 auto;min-height:4.5em;overflow-y:auto;overscroll-behavior:contain;padding:.1em .15em .1em 0}' +
      '.sendy-msg{display:flex;animation:sendy-in .25s ease}' +
      '@keyframes sendy-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.sendy-msg{animation:none}}' +
      '.sendy-msg-user{justify-content:flex-end}' +
      '.sendy-msg-bubble{padding:.55em .8em;border-radius:.7em;max-width:90%;overflow-wrap:anywhere;font-size:max(var(--text-floor), 1em);line-height:1.45;white-space:pre-line}' +
      '.sendy-msg-sendy .sendy-msg-bubble{background:var(--g-wash);color:var(--text);border:1px solid var(--edge-ctl);border-bottom-left-radius:3px}' +
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
      '.sendy-chat-form{display:flex;align-items:flex-end;gap:.5em;flex:none}' +
      /* the question box: at least 16px (an iPhone zooms the whole page into a smaller one), growing to five lines */
      '.sendy-chat-input{flex:1;min-width:0;min-height:2.6em;max-height:8em;padding:.55em .7em;border:1px solid var(--edge-ctl);border-radius:.45em;background:var(--ink-1,#050505);color:var(--text);font:inherit;font-size:max(var(--text-floor), 16px, 1em);line-height:1.35;resize:none;overflow-y:auto;field-sizing:content}' +
      '.sendy-chat-input::placeholder{color:var(--text-mute)}' +
      '.sendy-chat-input:focus{outline:2px solid var(--focus);outline-offset:-1px;border-color:var(--edge-ctl-lit)}' +
      '.sendy-chat-send{flex:none;min-width:2.6em;min-height:2.6em;padding:0 .9em;background:var(--green);color:var(--ink-1);border:1px solid var(--green);border-radius:.45em;cursor:pointer;font:inherit;font-size:max(var(--text-floor), 1em);font-weight:800;line-height:1.2}' +
      '.sendy-chat-send:hover{background:var(--green-bright);border-color:var(--green-bright)}' +
      '.sendy-chat-send[disabled]{opacity:.6;cursor:default}' +
      '#sendy-chat-mode .sendy-fine{flex:none}' +
      /* a finger does the tapping: every control at least 44px */
      '@media (pointer:coarse){.sendy-hbtn,.sendy-close,.sendy-rate-btn{min-height:max(44px,2.4em)}.sendy-btn,.sendy-chat-send,.sendy-chat-input{min-height:max(44px,2.6em)}.sendy-msg-links .sendy-link{min-height:max(44px,2.2em)}.sendy-close,.sendy-rate-btn{min-width:max(44px,2.4em)}.sendy-chat-send{min-width:max(44px,2.6em)}}' +
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
    const chatInput = $('sendy-chat-input'), chatSend = $('sendy-chat-send'), chatLog = $('sendy-chat-messages');
    let history = Array.isArray(store.get('chat')) ? store.get('chat').slice(-12) : [];
    let userPlaced = false, flying = false, hovering = false, autoHide = null;

    /* ---------- open / close ---------- */
    const size = () => rocket.getBoundingClientRect().width || 228;
    // the strip at the bottom that the music player and the SEND IT button own, in pixels: --fab-clear is a calc()
    // with rem and a safe-area inset, so it is measured on a probe box rather than parsed
    function fabClearPx() {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;height:var(--fab-clear,5.5rem);width:0';
      document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h || 88;
    }
    /* desktop only: a rocket near the top opens its popup downward, one near the left edge opens it rightward.
       On a phone the popup spans the width above the rocket (fixed), and these flips must never touch it. */
    function placePopup() {
      if (isMobile()) { widget.classList.remove('is-up', 'is-left'); popup.style.maxHeight = ''; fitPhone(); return; }
      popup.style.bottom = ''; popup.style.left = ''; popup.style.right = ''; popup.style.width = ''; widget.classList.remove('is-side');
      const strip = fabClearPx();
      const r = rocket.getBoundingClientRect(), above = r.top - 12, below = window.innerHeight - r.bottom - 12 - strip;   // downward stops above the player strip
      widget.classList.toggle('is-up', below > above);      // open toward whichever side has more room…
      // …and rightward when hung too near the left edge for the popup (25em of its own text, capped to the screen)
      const fs = parseFloat(getComputedStyle(popup).fontSize), pw = Math.min(fs * 25, window.innerWidth - 32);
      widget.classList.toggle('is-left', r.right - pw < 8);
      popup.style.maxHeight = Math.max(260, Math.floor(Math.max(above, below))) + 'px';   // …and never past the viewport: the body scrolls instead
      /* A short window (a laptop with a small browser, a phone on its side): above and below the rocket there is not
         the height the popup wants, so it opens beside the rocket instead and takes the screen's full height. */
      const want = Math.min(fs * (popup.classList.contains('is-chat') ? 40 : 24), window.innerHeight - strip - 20);
      const leftRoom = r.left - 18, rightRoom = window.innerWidth - r.right - 18;
      // a rocket dragged near the middle of a narrow window: the popup fits neither hung left nor right of it, so it is
      // slid along until it is wholly on the screen
      const left0 = widget.classList.contains('is-left') ? r.left : r.right - pw, fit = Math.max(8, Math.min(left0, window.innerWidth - 8 - pw));
      if (Math.abs(fit - left0) > 0.5) { popup.style.left = Math.round(fit - r.left) + 'px'; popup.style.right = 'auto'; }
      if (Math.max(above, below) < want * 0.87 && Math.max(leftRoom, rightRoom) >= Math.min(pw, fs * 16)) {   // only when it gains a sixth or more
        popup.style.left = ''; popup.style.right = '';
        widget.classList.add('is-side');
        popup.style.width = Math.floor(Math.min(pw, Math.max(leftRoom, rightRoom))) + 'px';
        if (leftRoom >= rightRoom) popup.style.right = Math.round(window.innerWidth - r.left + 10) + 'px'; else popup.style.left = Math.round(r.right + 10) + 'px';
        popup.style.maxHeight = Math.floor(window.innerHeight - strip - 20) + 'px';
      }
    }
    /* A phone's keyboard covers the bottom of the screen without moving a fixed box, which would leave the question
       box under it. While it is up (the visual viewport is shorter than the page's), the popup sits on top of it. */
    function fitPhone() {
      const vv = window.visualViewport;
      if (!isMobile() || !vv || !isOpen()) { popup.style.bottom = ''; if (isMobile()) popup.style.maxHeight = ''; return; }
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      if (covered > 80) { popup.style.bottom = Math.round(covered + 8) + 'px'; popup.style.maxHeight = Math.floor(vv.height - 16) + 'px'; }
      else { popup.style.bottom = ''; popup.style.maxHeight = ''; }
    }
    if (window.visualViewport) { visualViewport.addEventListener('resize', fitPhone); visualViewport.addEventListener('scroll', fitPhone); }
    function openPopup() { popup.removeAttribute('hidden'); placePopup(); rocket.setAttribute('aria-expanded', 'true'); }
    function closePopup() {
      const hadFocus = popup.contains(document.activeElement);
      popup.setAttribute('hidden', ''); rocket.setAttribute('aria-expanded', 'false'); clearTimeout(autoHide);
      if (hadFocus) rocket.focus();   // focus was in the box that just closed: back to the rocket, not to <body>
    }
    const isOpen = () => !popup.hasAttribute('hidden');

    /* ---------- tips ---------- */
    $('sendy-newtip').addEventListener('click', () => {
      const tips = tipsFor(), cur = $('sendy-tip').textContent.replace(/^💡 /, '');
      const next = tips.filter((t) => t !== cur); const t = (next.length ? next : tips)[Math.floor(Math.random() * (next.length ? next : tips).length)];
      $('sendy-tip').textContent = '💡 ' + t;
    });
    $('sendy-support').addEventListener('click', () => { location.href = '/support.html'; });
    $('sendy-close').addEventListener('click', closePopup);

    /* ---------- chat ---------- */
    function linkify(text, into) {
      // site paths and the email become links; everything else stays text (an answer is never markup)
      const re = /(\/(?:[a-z0-9._-]+\/)*[a-z0-9._-]*\.html(?:#[\w-]+)?|\/u\/[A-Za-z0-9._-]+|\/#[\w-]+|SendRH@Atomicmail\.io)/g;
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
      if (who === 'sendy') linkify(text, bubble); else bubble.textContent = text;
      if (links && links.length) {
        const bar = document.createElement('div'); bar.className = 'sendy-msg-links';
        for (const l of links) { const a = document.createElement('a'); a.className = 'sendy-link'; a.setAttribute('href', l.href); a.textContent = l.text; bar.appendChild(a); }
        bubble.appendChild(bar);
      }
      row.appendChild(bubble); chatLog.appendChild(row); chatLog.scrollTop = chatLog.scrollHeight;
      return row;
    }
    // a thumb under a model answer: rated up, an answer is reused for the next person who asks the same thing
    function rateBar(row, id) {
      const bar = document.createElement('div'); bar.className = 'sendy-rate';
      const mk = (v, label, tip) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'sendy-rate-btn'; b.textContent = label;
        b.setAttribute('aria-label', tip); b.setAttribute('data-tip', tip);
        b.addEventListener('click', async () => {
          bar.textContent = v > 0 ? 'Thanks — noted 👍' : 'Thanks — I\'ll do better 👎';
          chatInput.focus();   // the button just replaced itself with the thanks
          try { await fetch('/api/sendy/rate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, vote: v }) }); } catch {}
        });
        return b;
      };
      bar.appendChild(mk(1, '👍', 'Marks this answer helpful — Sendy reuses answers people rate up'));
      bar.appendChild(mk(-1, '👎', 'Marks this answer unhelpful — it will not be reused'));
      row.querySelector('.sendy-msg-bubble').appendChild(bar);
    }
    const ROUTES = [{ text: 'Support board', href: '/support.html' }, { text: 'Email ' + EMAIL, href: MAILTO }];
    const NO_ANSWER = "I don't have an answer for that yet. Ask it on the Support board, where the community and the team answer in public — or email if it's private.";
    function remember(role, text) { history.push({ role, text }); history = history.slice(-12); store.set('chat', history); }
    function paintHistory() {
      chatLog.textContent = '';
      if (!history.length) addMessage(chatHello(), 'sendy');
      for (const m of history) addMessage(m.text, m.role === 'assistant' ? 'sendy' : 'user');
    }
    async function ask(q) {
      addMessage(q, 'user'); remember('user', q);
      const typing = addMessage('· · ·', 'sendy'); typing.classList.add('sendy-typing');
      chatSend.disabled = true;
      let answer = null, note = null, offline = false, qaId = 0;
      try {
        const r = await fetch('/api/sendy/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q, page: location.pathname, history: history.slice(-9, -1) }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.answer) { answer = String(j.answer); qaId = Number(j.id) || 0; }
        else if (r.ok && j.unavailable) offline = true;
        else if (r.status === 429) note = String(j.error || 'Sendy needs a breather — try again in a few minutes.');
      } catch {}
      typing.remove(); chatSend.disabled = false;
      if (answer) { const row = addMessage(answer, 'sendy'); remember('assistant', answer); if (qaId) rateBar(row, qaId); }
      else {
        const local = findAnswer(q);
        if (note) addMessage(note, 'sendy', ROUTES);
        else if (local) { addMessage(local, 'sendy'); remember('assistant', local); }
        else addMessage(NO_ANSWER + (offline ? '' : ' (I could not reach my notes just now.)'), 'sendy', ROUTES);
      }
      chatInput.focus();
    }
    function showChat() { tipsMode.setAttribute('hidden', ''); chatMode.removeAttribute('hidden'); popup.classList.add('is-chat'); $('sendy-back').removeAttribute('hidden'); placePopup(); paintHistory(); setTimeout(() => chatInput.focus(), 60); }
    function showTips() {
      const fromBack = document.activeElement === $('sendy-back');
      chatMode.setAttribute('hidden', ''); tipsMode.removeAttribute('hidden'); popup.classList.remove('is-chat'); $('sendy-back').setAttribute('hidden', ''); placePopup();
      if (fromBack) $('sendy-chat').focus();   // the back button just hid itself: focus lands on the way back into the chat
    }
    $('sendy-chat').addEventListener('click', showChat);
    $('sendy-back').addEventListener('click', showTips);
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); const q = chatInput.value.trim(); if (!q || chatSend.disabled) return; chatInput.value = ''; grow(); ask(q); });
    // the question box grows with what is typed (up to its max-height, then it scrolls): natively where the browser
    // sizes a field to its content, by hand elsewhere. Enter sends; Shift+Enter starts a new line.
    const nativeGrow = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));
    function grow() { if (nativeGrow) return; chatInput.style.height = 'auto'; chatInput.style.height = chatInput.scrollHeight + 2 + 'px'; }
    chatInput.addEventListener('input', grow);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); if (chatForm.requestSubmit) chatForm.requestSubmit(); else chatForm.dispatchEvent(new Event('submit', { cancelable: true })); }
    });

    /* ---------- the rocket: tap opens, drag moves (desktop) ---------- */
    let drag = null;
    rocket.addEventListener('click', (e) => {
      if (drag && drag.moved) { drag = null; return; } drag = null; e.stopPropagation();
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
      // along the right edge, the side it rests on: at this size a glide to the left edge parked it on the page
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
      if (isMobile() || reduced() || userPlaced || flying || hovering || isOpen() || document.visibilityState !== 'visible' || typing()) return;
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
    document.addEventListener('click', (e) => { if (isOpen() && !widget.contains(e.target)) closePopup(); });
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
      oops: ['The chain hiccupped. Happens to the best of us. Give it a minute.', 'That didn\'t go through. Not you — the tubes. Try again shortly.', 'Turbulence. Nothing decided, nothing lost. Retry in a bit.']
    };
    const SAY_COOLDOWN = 8000, sayEl = $('sendy-say');
    let sayTimer = null, lastSayAt = 0; const lastLine = {};
    function hideSay() { sayEl.setAttribute('hidden', ''); widget.classList.remove('is-hyped'); }
    function say(kind, vars, urgent) {
      const lines = LINES[kind]; if (!lines || widget.hasAttribute('hidden')) return false;
      if (isOpen() || flying) return false;
      const t = Date.now(); if (!urgent && t - lastSayAt < SAY_COOLDOWN) return false;
      let i = Math.floor(Math.random() * lines.length); if (lines.length > 1 && i === lastLine[kind]) i = (i + 1) % lines.length;
      lastLine[kind] = i; lastSayAt = t;
      sayEl.textContent = lines[i].replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null) ? String(vars[k]) : m);
      if (!isMobile()) {
        // measured, not guessed: above the rocket if it fits there, below it if it fits there (never into the SEND IT
        // strip), otherwise beside it — a 140px rule of thumb was drawn for a 76px rocket
        sayEl.style.visibility = 'hidden'; sayEl.removeAttribute('hidden');
        const r = rocket.getBoundingClientRect(), bw = Math.min(parseFloat(getComputedStyle(sayEl).fontSize) * 16, window.innerWidth - 24), bh = sayEl.offsetHeight;
        const above = r.top - 8, below = window.innerHeight - fabClearPx() - r.bottom - 8, side = above < bh && below < bh;
        widget.classList.toggle('say-up', !side && above < bh);
        widget.classList.toggle('say-side', side);
        widget.classList.toggle('say-left', side ? r.left - bw < 8 : r.right - bw < 8);
        sayEl.style.visibility = '';
      }
      sayEl.removeAttribute('hidden');
      if (!reduced()) { widget.classList.remove('is-hyped'); void widget.offsetWidth; widget.classList.add('is-hyped'); }
      clearTimeout(sayTimer); sayTimer = setTimeout(hideSay, 4500);
      return true;
    }
    rocket.addEventListener('click', () => { if (!sayEl.hasAttribute('hidden')) hideSay(); }, true);   // opening the popup clears a bubble
    document.addEventListener('egg:found', (e) => { const d = e.detail || {}; if (d.id != null) say('egg', { found: d.found, total: d.total }, true); });
    document.addEventListener('post:created', (e) => { say(e.detail && e.detail.call_id ? 'call' : 'post'); });
    document.addEventListener('squad:call', () => { say('squadcall'); });
    document.addEventListener('auth:change', (e) => { if (e.detail && e.detail.username) say('signin', { name: e.detail.username }); else if (!e.detail) say('signout'); });
    document.addEventListener('site-prefs', () => { say('theme'); });
    document.addEventListener('boost:changed', () => { say('boost'); });
    document.addEventListener('jsi:entered', (e) => { say(e.detail && e.detail.firstVisit ? 'firstvisit' : 'entered', null, true); });
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

    /* ---------- show up: the greeting once per visit, then just the rocket ---------- */
    setTimeout(() => {
      widget.removeAttribute('hidden');
      if (!store.get('greeted')) {
        store.set('greeted', true);
        $('sendy-greeting').textContent = greeting();
        openPopup();
        autoHide = setTimeout(() => { if (isOpen() && chatMode.hasAttribute('hidden') && !popup.contains(document.activeElement) && !popup.matches(':hover')) closePopup(); }, 9000);   // only the tips view hides itself — never a chat someone started, never under a pointer or a focus
      }
      if (!isMobile()) scheduleFlight();
    }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
