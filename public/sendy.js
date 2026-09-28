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
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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

  /* ---------- markup ---------- */
  function html() {
    const tip = tipsFor()[Math.floor(Math.random() * tipsFor().length)];
    return '<div id="sendy-widget" class="sendy-widget" hidden>' +
      '<button class="sendy-rocket" id="sendy-rocket" type="button" aria-label="Sendy, your $Send guide" aria-expanded="false" data-tip="Opens Sendy — ask a question, or get a tip about this page. Drag to move (desktop)">' +
        '<span class="sendy-sprite" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="sendy-popup" id="sendy-popup" role="dialog" aria-label="Sendy" hidden>' +
        '<div class="sendy-head">' +
          '<img class="sendy-avatar" src="/assets/sendy.png" alt="" width="28" height="28">' +
          '<span class="sendy-title">Sendy <small>your $Send guide</small></span>' +
          '<button class="sendy-close" id="sendy-close" type="button" aria-label="Close Sendy" data-tip="Closes Sendy — the rocket stays in the corner">✕</button>' +
        '</div>' +
        '<div class="sendy-body" id="sendy-tips-mode">' +
          '<p class="sendy-greeting" id="sendy-greeting">' + esc(greeting()) + '</p>' +
          '<p class="sendy-tip" id="sendy-tip">💡 ' + esc(tip) + '</p>' +
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
            '<input type="text" id="sendy-chat-input" class="sendy-chat-input" placeholder="Ask Sendy…" autocomplete="off" maxlength="600" aria-label="Your question for Sendy">' +
            '<button type="submit" class="sendy-chat-send" id="sendy-chat-send" aria-label="Send the question" data-tip="Sends your question to Sendy">→</button>' +
          '</form>' +
          '<p class="sendy-fine">Sendy\'s answers are generated and can be wrong — check the page it points to. Entertainment only, not financial advice, not affiliated with Robinhood.</p>' +
          '<button class="sendy-back-btn" id="sendy-back" type="button" data-tip="Leaves the chat and shows the tips again">← Tips</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- styles ---------- */
  function css() {
    return '' +
      '#sendy-widget{--sendy-size:76px;--sendy-z:190;position:fixed;right:1rem;bottom:var(--fab-clear,5.5rem);z-index:var(--sendy-z);font-family:inherit;width:var(--sendy-size);height:var(--sendy-size)}' +
      '#sendy-widget:not([hidden]){display:block}' +
      '@media (max-width:767px){#sendy-widget{--sendy-size:60px;right:0.75rem}}' +
      '.sendy-rocket{width:var(--sendy-size);height:var(--sendy-size);padding:0;margin:0;border:0;background:none;cursor:grab;display:block;border-radius:50%;transition:transform .2s ease;touch-action:manipulation}' +
      '@media (max-width:767px){.sendy-rocket{cursor:pointer}}' +
      '.sendy-rocket:hover{transform:scale(1.08)}' +
      '.sendy-rocket:active{cursor:grabbing}' +
      '.sendy-rocket:focus-visible{outline:3px solid var(--focus);outline-offset:3px}' +
      '.sendy-sprite{display:block;width:var(--sendy-size);height:var(--sendy-size);background:url(/assets/sendy-idle.png) no-repeat 0 0/var(--sendy-size) auto;' +
        'filter:drop-shadow(0 0 9px color-mix(in srgb,var(--green) 55%,transparent));animation:sendy-idle 2s steps(' + FRAMES + ') infinite}' +
      '@keyframes sendy-idle{to{background-position:0 calc(var(--sendy-size) * -' + FRAMES + ')}}' +
      '@media (prefers-reduced-motion:reduce){.sendy-sprite{animation:none}}' +
      '.sendy-widget.is-flying .sendy-sprite{animation-duration:.6s}' +
      /* the popup: above the rocket, aligned to its right edge; flipped when the rocket sits near the top or the left */
      '.sendy-popup{position:absolute;bottom:calc(var(--sendy-size) + 10px);right:0;width:360px;max-width:calc(100vw - 2rem);background:var(--ink-2,var(--bg-0,#0f120b));color:var(--text);border:1px solid var(--edge-ctl);border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,.45);z-index:1;overflow:hidden;display:flex;flex-direction:column}' +
      '@media (min-width:768px){.sendy-widget.is-up .sendy-popup{bottom:auto;top:calc(var(--sendy-size) + 10px)}' +
        '.sendy-widget.is-left .sendy-popup{right:auto;left:0}}' +
      '@media (max-width:767px){.sendy-popup{position:fixed;left:0.75rem;right:0.75rem;bottom:calc(var(--fab-clear,5.5rem) + var(--sendy-size) + 8px);width:auto;max-width:none;max-height:calc(100vh - var(--fab-clear,5.5rem) - var(--sendy-size) - 24px);display:flex;flex-direction:column}}' +
      '.sendy-popup[hidden]{display:none !important}' +
      '.sendy-head{display:flex;align-items:center;gap:.6rem;padding:.65rem .8rem;border-bottom:1px solid var(--edge-ctl)}' +
      '.sendy-avatar{width:28px;height:28px;flex:none}' +
      '.sendy-title{flex:1;font-weight:800;font-size:max(var(--text-floor), .95rem);color:var(--text);display:flex;flex-direction:column;line-height:1.15}' +
      '.sendy-title small{font-weight:500;font-size:max(var(--text-floor), .72rem);color:var(--text-mute)}' +
      '.sendy-close{background:none;border:0;color:var(--text-mute);cursor:pointer;font-size:max(var(--text-floor), 1.1rem);width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:6px}' +
      '.sendy-close:hover{color:var(--text)}' +
      '.sendy-close:focus-visible,.sendy-btn:focus-visible,.sendy-back-btn:focus-visible,.sendy-chat-send:focus-visible,.sendy-link:focus-visible{outline:3px solid var(--focus);outline-offset:2px}' +
      '.sendy-body{padding:.85rem;display:flex;flex-direction:column;gap:.7rem;min-height:0;overflow:auto;overscroll-behavior:contain}' +
      '.sendy-body[hidden]{display:none}' +
      '.sendy-greeting,.sendy-tip{margin:0;font-size:max(var(--text-floor), .9rem);line-height:1.4}' +
      '.sendy-greeting{font-weight:700;color:var(--green-bright)}' +
      '.sendy-tip{color:var(--text-dim)}' +
      '.sendy-actions{display:flex;flex-direction:column;gap:.45rem}' +
      '.sendy-btn{padding:.5rem .75rem;font:inherit;font-size:max(var(--text-floor), .86rem);font-weight:600;border:1px solid var(--edge-ctl);border-radius:6px;cursor:pointer;text-align:center;transition:background .15s ease,border-color .15s ease}' +
      '.sendy-btn-primary{background:var(--green);color:var(--ink-1);border-color:var(--green)}' +
      '.sendy-btn-primary:hover{background:var(--green-bright);border-color:var(--green-bright)}' +
      '.sendy-btn-secondary{background:transparent;color:var(--text)}' +
      '.sendy-btn-secondary:hover{border-color:var(--edge-ctl-lit);background:var(--g-wash)}' +
      '.sendy-btn-tertiary{background:transparent;color:var(--text-dim);font-weight:500;font-size:max(var(--text-floor), .8rem)}' +
      '.sendy-btn-tertiary:hover{color:var(--text);border-color:var(--text-mute)}' +
      '.sendy-fine{margin:0;font-size:max(var(--text-floor), .74rem);line-height:1.4;color:var(--text-mute)}' +
      '.sendy-link{color:var(--green-bright);font-weight:600;text-decoration:underline;text-underline-offset:2px;border-radius:3px}' +
      /* chat */
      '.sendy-chat-messages{display:flex;flex-direction:column;gap:.55rem;max-height:300px;overflow-y:auto;overscroll-behavior:contain;padding:.1rem 0}' +
      '@media (max-width:767px){.sendy-chat-messages{max-height:none;flex:1 1 auto}}' +
      '.sendy-msg{display:flex;animation:sendy-in .25s ease}' +
      '@keyframes sendy-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.sendy-msg{animation:none}}' +
      '.sendy-msg-user{justify-content:flex-end}' +
      '.sendy-msg-bubble{padding:.55rem .8rem;border-radius:10px;max-width:88%;overflow-wrap:anywhere;font-size:max(var(--text-floor), .88rem);line-height:1.4;white-space:pre-line}' +
      '.sendy-msg-sendy .sendy-msg-bubble{background:var(--g-wash);color:var(--text);border:1px solid var(--edge-ctl);border-bottom-left-radius:3px}' +
      '.sendy-msg-user .sendy-msg-bubble{background:var(--green);color:var(--ink-1);border-bottom-right-radius:3px}' +
      '.sendy-msg-links{display:flex;flex-wrap:wrap;gap:.3rem .9rem;margin-top:.45rem}' +
      '.sendy-typing .sendy-msg-bubble{color:var(--text-mute);letter-spacing:.15em}' +
      '.sendy-rate{display:flex;align-items:center;gap:.4rem;margin-top:.45rem;font-size:max(var(--text-floor), .8rem);color:var(--text-mute)}' +
      '.sendy-rate-btn{background:transparent;border:1px solid var(--edge-ctl);border-radius:6px;cursor:pointer;padding:.1rem .5rem;font:inherit;line-height:1.3}' +
      '.sendy-rate-btn:hover{border-color:var(--edge-ctl-lit);background:var(--g-wash)}' +
      '.sendy-rate-btn:focus-visible{outline:3px solid var(--focus);outline-offset:2px}' +
      '.sendy-chat-form{display:flex;gap:.45rem}' +
      '.sendy-chat-input{flex:1;min-width:0;padding:.55rem .7rem;border:1px solid var(--edge-ctl);border-radius:6px;background:var(--ink-1,#050505);color:var(--text);font:inherit;font-size:max(var(--text-floor), .9rem)}' +
      '.sendy-chat-input::placeholder{color:var(--text-mute)}' +
      '.sendy-chat-input:focus{outline:2px solid var(--focus);outline-offset:-1px;border-color:var(--edge-ctl-lit)}' +
      '.sendy-chat-send{padding:.5rem .8rem;background:var(--green);color:var(--ink-1);border:1px solid var(--green);border-radius:6px;cursor:pointer;font:inherit;font-weight:800}' +
      '.sendy-chat-send:hover{background:var(--green-bright);border-color:var(--green-bright)}' +
      '.sendy-chat-send[disabled]{opacity:.6;cursor:default}' +
      '.sendy-back-btn{width:100%;padding:.45rem;background:transparent;color:var(--text-mute);border:1px solid var(--edge-ctl);border-radius:6px;cursor:pointer;font:inherit;font-size:max(var(--text-floor), .82rem)}' +
      '.sendy-back-btn:hover{color:var(--text);border-color:var(--text-mute)}';
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
    const size = () => rocket.getBoundingClientRect().width || 76;
    /* desktop only: a rocket near the top opens its popup downward, one near the left edge opens it rightward.
       On a phone the popup spans the width above the rocket (fixed), and these flips must never touch it. */
    function placePopup() {
      if (isMobile()) { widget.classList.remove('is-up', 'is-left'); popup.style.maxHeight = ''; return; }
      const r = rocket.getBoundingClientRect(), above = r.top - 12, below = window.innerHeight - r.bottom - 12;
      widget.classList.toggle('is-up', below > above);      // open toward whichever side has more room…
      widget.classList.toggle('is-left', r.left < 380);     // …and rightward when hung near the left edge (the popup is 360px wide)
      popup.style.maxHeight = Math.max(260, Math.floor(Math.max(above, below))) + 'px';   // …and never past the viewport: the body scrolls instead
    }
    function openPopup() { placePopup(); popup.removeAttribute('hidden'); rocket.setAttribute('aria-expanded', 'true'); }
    function closePopup() { popup.setAttribute('hidden', ''); rocket.setAttribute('aria-expanded', 'false'); clearTimeout(autoHide); }
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
      if (!history.length) addMessage(greeting().replace(/^Hey/, 'Hey there —'), 'sendy');
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
    function showChat() { tipsMode.setAttribute('hidden', ''); chatMode.removeAttribute('hidden'); paintHistory(); setTimeout(() => chatInput.focus(), 60); }
    function showTips() { chatMode.setAttribute('hidden', ''); tipsMode.removeAttribute('hidden'); }
    $('sendy-chat').addEventListener('click', showChat);
    $('sendy-back').addEventListener('click', showTips);
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); const q = chatInput.value.trim(); if (!q || chatSend.disabled) return; chatInput.value = ''; ask(q); });

    /* ---------- the rocket: tap opens, drag moves (desktop) ---------- */
    let drag = null;
    rocket.addEventListener('click', (e) => { if (drag && drag.moved) { drag = null; return; } drag = null; e.stopPropagation(); if (isOpen()) closePopup(); else openPopup(); });
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
    window.addEventListener('resize', () => { if (widget.style.left) { const r = widget.getBoundingClientRect(); setPos(r.left, r.top); } });

    /* ---------- the flights: a short glide along the edges now and then (desktop, popup closed, nobody typing) ---------- */
    const fabClear = () => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fab-clear')); return isNaN(v) ? 88 : v; };
    function anchors() {
      const s = size(), W = window.innerWidth, H = window.innerHeight, m = 16, low = H - fabClear() - s;
      return [{ x: W - s - m, y: low }, { x: W - s - m, y: H * 0.42 }, { x: W - s - m, y: H * 0.16 }, { x: m, y: H * 0.42 }, { x: m, y: low }];
    }
    function typing() { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); }
    function fly() {
      if (isMobile() || reduced() || userPlaced || flying || hovering || isOpen() || document.visibilityState !== 'visible' || typing()) return;
      const r = widget.getBoundingClientRect(), from = { x: r.left, y: r.top };
      const opts = anchors().filter((a) => Math.hypot(a.x - from.x, a.y - from.y) > 120);
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { closePopup(); rocket.focus(); } });
    document.addEventListener('auth:change', () => { const g = $('sendy-greeting'); if (g) g.textContent = greeting(); });

    /* ---------- show up: the greeting once per visit, then just the rocket ---------- */
    setTimeout(() => {
      widget.removeAttribute('hidden');
      if (!store.get('greeted')) {
        store.set('greeted', true);
        $('sendy-greeting').textContent = greeting();
        openPopup();
        autoHide = setTimeout(() => { if (isOpen() && chatMode.hasAttribute('hidden')) closePopup(); }, 9000);   // only the tips view hides itself — never a chat someone started
      }
      if (!isMobile()) scheduleFlight();
    }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
