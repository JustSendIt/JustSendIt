/* Sendy — the helpful rocket companion for navigating $Send and crypto
   A Clippy-style helper that knows the site and guides users to answers or support.
   On desktop: fluid, animated, draggable. On mobile: fixed at the bottom, out of the way.
   Users can chat with Sendy to ask questions about the site, crypto, and using Send. */

(function () {
  'use strict';

  let sendyOpen = false, isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  let chatMode = false, chatMessages = [];
  const isMobile = () => window.innerWidth < 768;

  // Knowledge base: answers to common questions
  const knowledgeBase = {
    'send power': {
      keywords: ['send power', 'power', 'points', 'leaderboard'],
      answer: 'Send Power is your reputation on $Send. You earn it by making Send Calls on the Wall, participating in communities, and being active. Higher Send Power gives you more influence on the leaderboard. Join the $Send or $GWC communities to earn 10× multiplier on all your points!'
    },
    'send call': {
      keywords: ['send call', 'call', 'how to call', 'make a call'],
      answer: 'A Send Call is a public prediction that a token will do well. Scan a token, then tap "Send Call to the Wall" to share your pick with the community. If you\'re in a squad, you can also make private squad calls. All Send Calls are permanent records on this site.'
    },
    'scanner': {
      keywords: ['scanner', 'scan', 'token address', 'on-chain'],
      answer: 'The Scanner reads any token\'s full on-chain profile: holder breakdown, market data, price history, and contract details. Just paste a token address or contract and tap Scan. Green scores mean data is verified on-chain; gray means it\'s indexed by a third party.'
    },
    'wallet link': {
      keywords: ['wallet', 'link wallet', 'track', 'holdings', 'pnl'],
      answer: 'Link your wallets on your profile to track your holdings, trades, cost basis, and PNL—all read from the chain. The explorer never learns which wallets you follow. Your wallet data is private to you and cached locally for instant access.'
    },
    'squad': {
      keywords: ['squad', 'send squad', 'group', 'private'],
      answer: 'A Send Squad is a private group that earns points together. You can make Send Calls private to your squad, and only verified squad members count toward the gate. Start your own or join an existing squad to collaborate with other traders.'
    },
    'community': {
      keywords: ['community', 'join community', 'groups'],
      answer: 'Communities are groups around specific tokens, like $Send and $GWC. Join a community to earn 10× Send Power multiplier on everything you do there. Communities are run by the site itself, so they\'re verified and safe.'
    },
    'watchlist': {
      keywords: ['watchlist', 'save token', 'star'],
      answer: 'Your Watchlist saves tokens you\'re following for quick access later. Scan a token and tap the ☆ to save it. You can quickly jump to a full scan or make a Send Call from your watchlist.'
    },
    'report': {
      keywords: ['report', 'spam', 'inappropriate'],
      answer: 'See something wrong? Use the report control on any post or comment. For safety issues, email SendRH@Atomicmail.io with details. Moderators will look at your report and take action if it breaks the rules.'
    },
    'safety': {
      keywords: ['safe', 'security', 'risk', 'dyor', 'due diligence'],
      answer: 'Always do your own research (DYOR) before sending on any token. The Scanner shows on-chain data, but nothing is guaranteed. Prefer higher liquidity, lower volume, and steady prices. No warranties—this is crypto. Report anything suspicious to SendRH@Atomicmail.io.'
    },
    'appeal': {
      keywords: ['appeal', 'restricted', 'strike', 'suspension'],
      answer: 'If your account is restricted or you get a strike, you have a free appeal. Email SendRH@Atomicmail.io with your account name and explain what happened. A person will review your case. Strikes never expire, but you can appeal once per restriction.'
    }
  };

  function findAnswer(question) {
    const lowerQ = question.toLowerCase();
    for (const [key, entry] of Object.entries(knowledgeBase)) {
      for (const keyword of entry.keywords) {
        if (lowerQ.includes(keyword)) {
          return entry.answer;
        }
      }
    }
    return null;
  }

  // Page-specific tips and greetings
  const pageTips = {
    '/': {
      greeting: '🚀 Hey, I\'m Sendy! Here to help you navigate $Send and the crypto world.',
      tips: [
        'New to $Send? Check out the "How to Buy" guide above.',
        'Drag me around if I\'m in your way (on desktop)!',
        'Spotted something odd? Report it or ask questions on the Support page.'
      ]
    },
    '/about.html': {
      tips: [
        'Learn how Send Power works and what drives the leaderboard.',
        'Send Calls are permanent — they stay even after an account is deleted.',
        'Strikes never expire, but there\'s a free appeal process.'
      ]
    },
    '/newpairs.html': {
      tips: [
        'Scan any token address to see its full on-chain profile.',
        'Save tokens to your watchlist by tapping the ☆.',
        'Green score means the data is verified on-chain; gray means it\'s indexed by a third party.',
        'Tap a token to see holder breakdown, market data, and make a Send Call.'
      ]
    },
    '/wall.html': {
      tips: [
        'The Send Wall is a live leaderboard of all Send Calls — permanent records on this site.',
        'Click a username to see their Send Wall and history.',
        'High liquidity, low volume, and steady price = safer calls.',
        'No warranty — always DYOR before sending.'
      ]
    },
    '/support.html': {
      tips: [
        'Ask public questions or answer others — help the community.',
        'Can\'t find what you need? Email SendRH@Atomicmail.io for private help.',
        'Vote up answers that solve your problem.'
      ]
    },
    '/profile.html': {
      tips: [
        'Link wallets to track your holdings and earn Send Power.',
        'Two-factor auth keeps your account safe.',
        'Delete your account if you need to — it\'s permanent and can\'t be undone.'
      ]
    },
    '/watchlist.html': {
      tips: [
        'Your saved tokens land here. Scan a token and tap the ☆ to save it.',
        'Quick access to tokens you\'re watching.',
        'Make a Send Call from here or jump to the full Scanner scan.'
      ]
    },
    '/communities.html': {
      tips: [
        'Join $Send or $GWC communities to earn 10× Send Power on everything you do.',
        'Communities are run by the site and verified — trust is built in.',
        'Start your own community or squad to gather people around a token.'
      ]
    },
    '/squad.html': {
      tips: [
        'Send Squads are private groups that earn points together.',
        'Make Send Calls private to your squad.',
        'Only verified members count toward the gate.'
      ]
    },
    '/tracker.html': {
      tips: [
        'Track wallet performance: holdings, buys, sells, cost basis, and PNL.',
        'All data is read from the chain — the explorer never sees which wallets you follow.',
        'Save wallets to get instant snapshots next time.'
      ]
    }
  };

  function getPagePath() {
    return location.pathname.split('?')[0] || '/';
  }

  function getTips() {
    const path = getPagePath();
    return pageTips[path] || pageTips['/'];
  }

  function buildSendyHTML() {
    const tips = getTips();
    const greeting = tips.greeting || pageTips['/'].greeting;
    const tip = tips.tips[Math.floor(Math.random() * tips.tips.length)];

    return `
      <div id="sendy-widget" class="sendy-widget" hidden>
        <div class="sendy-rocket" id="sendy-rocket" role="button" tabindex="0" aria-label="Sendy, the helpful $Send rocket" data-tip="Click to open Sendy — your guide to $Send and crypto">
          🚀
        </div>
        <div class="sendy-popup" id="sendy-popup" hidden>
          <div class="sendy-head">
            <span class="sendy-title">Sendy</span>
            <button class="sendy-close" id="sendy-close" type="button" aria-label="Close Sendy" data-tip="Closes Sendy">✕</button>
          </div>
          <div class="sendy-body sendy-tips-mode" id="sendy-tips-mode">
            <p class="sendy-greeting" id="sendy-greeting">${greeting}</p>
            <p class="sendy-tip" id="sendy-tip">${tip}</p>
            <div class="sendy-actions">
              <button class="sendy-btn sendy-btn-primary" id="sendy-chat" type="button" data-tip="Chat with Sendy to ask questions">
                💬 Ask Sendy a question
              </button>
              <button class="sendy-btn sendy-btn-secondary" id="sendy-support" type="button" data-tip="Opens the Support page where you can ask questions or answer others">
                Support page
              </button>
              <button class="sendy-btn sendy-btn-tertiary" id="sendy-newtip" type="button" data-tip="Shows another helpful tip about this page">
                Another tip
              </button>
            </div>
          </div>
          <div class="sendy-body sendy-chat-mode" id="sendy-chat-mode" hidden>
            <div class="sendy-chat-messages" id="sendy-chat-messages" role="log" aria-live="polite">
              <div class="sendy-msg sendy-msg-sendy">
                <div class="sendy-msg-bubble">Hey! Ask me anything about $Send, crypto, or how to use this site. I'll do my best to help! 🚀</div>
              </div>
            </div>
            <form class="sendy-chat-input-form" id="sendy-chat-form">
              <input
                type="text"
                id="sendy-chat-input"
                class="sendy-chat-input"
                placeholder="Ask Sendy..."
                autocomplete="off"
                aria-label="Message to Sendy"
              />
              <button type="submit" class="sendy-chat-send" id="sendy-chat-send" aria-label="Send message" data-tip="Send your question to Sendy">→</button>
            </form>
            <button class="sendy-back-btn" id="sendy-back" type="button" data-tip="Back to tips">← Back</button>
          </div>
        </div>
      </div>
    `;
  }

  function buildSendyCSS() {
    return `
      #sendy-widget {
        --sendy-size: 56px;
        --sendy-z: 300;
        position: fixed;
        bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
        right: 1rem;
        z-index: var(--sendy-z);
        font-family: inherit;
      }

      #sendy-widget:not([hidden]) {
        display: block;
      }

      .sendy-rocket {
        width: var(--sendy-size);
        height: var(--sendy-size);
        border-radius: 50%;
        background: var(--green-bright);
        border: 2px solid var(--text);
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        user-select: none;
      }

      .sendy-rocket:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }

      .sendy-rocket:active {
        cursor: grabbing;
      }

      .sendy-rocket:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }

      /* Desktop: Popup appears above rocket */
      @media (min-width: 768px) {
        .sendy-popup {
          position: absolute;
          bottom: calc(var(--sendy-size) + 12px);
          right: 0;
          width: 280px;
          max-width: 90vw;
          background: var(--bg-0);
          border: 1px solid var(--edge-ctl);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          z-index: calc(var(--sendy-z) + 1);
        }
      }

      /* Mobile: Popup appears as overlay */
      @media (max-width: 767px) {
        .sendy-popup {
          position: fixed;
          bottom: var(--sendy-size);
          left: 1rem;
          right: 1rem;
          width: auto;
          max-height: 60vh;
          overflow-y: auto;
          background: var(--bg-0);
          border: 1px solid var(--edge-ctl);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          z-index: calc(var(--sendy-z) + 1);
        }
      }

      .sendy-popup:not([hidden]) {
        display: flex;
        flex-direction: column;
      }

      .sendy-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--edge-ctl);
        gap: 1rem;
      }

      .sendy-title {
        font-weight: 700;
        font-size: 0.95rem;
        color: var(--text);
      }

      .sendy-close {
        background: none;
        border: none;
        color: var(--text-mute);
        cursor: pointer;
        font-size: 1.2rem;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s ease;
      }

      .sendy-close:hover {
        color: var(--text);
      }

      .sendy-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .sendy-greeting,
      .sendy-tip {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.4;
        color: var(--text);
      }

      .sendy-greeting {
        font-weight: 600;
        color: var(--green-bright);
      }

      .sendy-tip {
        color: var(--text-dim);
      }

      .sendy-actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: 0.25rem;
      }

      .sendy-btn {
        padding: 0.5rem 0.75rem;
        font-size: 0.85rem;
        border: 1px solid var(--edge-ctl);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
        font-weight: 500;
      }

      .sendy-btn-primary {
        background: var(--green);
        color: var(--ink-1);
        border-color: var(--green);
      }

      .sendy-btn-primary:hover {
        background: var(--green-bright);
        border-color: var(--green-bright);
      }

      .sendy-btn-secondary {
        background: var(--bg-1);
        color: var(--text);
        border-color: var(--edge-ctl);
      }

      .sendy-btn-secondary:hover {
        background: color-mix(in srgb, var(--green) 10%, var(--bg-1) 90%);
        border-color: var(--edge-ctl-lit);
      }

      .sendy-btn-tertiary {
        background: transparent;
        color: var(--text-dim);
        border-color: var(--edge-ctl);
        font-size: 0.8rem;
      }

      .sendy-btn-tertiary:hover {
        color: var(--text);
        border-color: var(--text-mute);
      }

      /* Animation: Sendy flies in on desktop (just a subtle scale) */
      @keyframes sendy-float {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-4px); }
      }

      @media (min-width: 768px) and (prefers-reduced-motion: no-preference) {
        .sendy-rocket {
          animation: sendy-float 3s ease-in-out infinite;
        }
      }

      /* Chat mode styles */
      .sendy-chat-messages {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-height: 300px;
        overflow-y: auto;
        padding: 0.5rem 0;
        margin-bottom: 0.75rem;
      }

      .sendy-msg {
        display: flex;
        animation: slideIn 0.3s ease;
      }

      @keyframes slideIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .sendy-msg-user {
        justify-content: flex-end;
      }

      .sendy-msg-bubble {
        padding: 0.6rem 0.9rem;
        border-radius: 6px;
        max-width: 85%;
        word-wrap: break-word;
        font-size: 0.9rem;
        line-height: 1.3;
      }

      .sendy-msg-sendy .sendy-msg-bubble {
        background: var(--bg-1);
        color: var(--text);
        border: 1px solid var(--edge-ctl);
      }

      .sendy-msg-user .sendy-msg-bubble {
        background: var(--green);
        color: var(--ink-1);
      }

      .sendy-chat-input-form {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .sendy-chat-input {
        flex: 1;
        padding: 0.6rem 0.75rem;
        border: 1px solid var(--edge-ctl);
        border-radius: 4px;
        background: var(--bg-1);
        color: var(--text);
        font-family: inherit;
        font-size: 0.9rem;
      }

      .sendy-chat-input::placeholder {
        color: var(--text-mute);
      }

      .sendy-chat-input:focus {
        outline: 2px solid var(--focus);
        outline-offset: -2px;
        border-color: var(--edge-ctl-lit);
      }

      .sendy-chat-send {
        padding: 0.6rem 0.75rem;
        background: var(--green);
        color: var(--ink-1);
        border: 1px solid var(--green);
        border-radius: 4px;
        cursor: pointer;
        font-weight: 600;
        transition: all 0.2s ease;
      }

      .sendy-chat-send:hover {
        background: var(--green-bright);
        border-color: var(--green-bright);
      }

      .sendy-back-btn {
        width: 100%;
        padding: 0.5rem;
        background: transparent;
        color: var(--text-mute);
        border: 1px solid var(--edge-ctl);
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.85rem;
        transition: all 0.2s ease;
      }

      .sendy-back-btn:hover {
        color: var(--text);
        border-color: var(--text-mute);
      }

      .sendy-tips-mode[hidden],
      .sendy-chat-mode[hidden] {
        display: none;
      }

      /* Ensure Sendy doesn't block the compose FAB or music player */
      #sendy-widget {
        bottom: max(calc(1rem + env(safe-area-inset-bottom, 0px)), var(--fab-clear, 1rem));
      }
    `;
  }

  function init() {
    // Insert HTML
    const widget = document.createElement('div');
    widget.innerHTML = buildSendyHTML();
    document.body.appendChild(widget);

    // Insert CSS
    const style = document.createElement('style');
    style.textContent = buildSendyCSS();
    document.head.appendChild(style);

    // Get elements
    const rocket = document.getElementById('sendy-rocket');
    const popup = document.getElementById('sendy-popup');
    const closeBtn = document.getElementById('sendy-close');
    const supportBtn = document.getElementById('sendy-support');
    const emailBtn = document.getElementById('sendy-email');
    const newTipBtn = document.getElementById('sendy-newtip');
    const sendyWidget = document.getElementById('sendy-widget');

    // Show Sendy after a brief delay (let the page settle)
    setTimeout(() => {
      if (sendyWidget) sendyWidget.removeAttribute('hidden');
      // Show popup on first visit, hide after 8 seconds
      popup.removeAttribute('hidden');
      setTimeout(() => {
        popup.setAttribute('hidden', '');
      }, 8000);
    }, 1500);

    // Toggle popup on rocket click
    rocket.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popup.hasAttribute('hidden')) {
        popup.removeAttribute('hidden');
      } else {
        popup.setAttribute('hidden', '');
      }
    });

    rocket.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rocket.click();
      }
    });

    // Close button
    closeBtn.addEventListener('click', () => {
      popup.setAttribute('hidden', '');
    });

    // Support button
    supportBtn.addEventListener('click', () => {
      window.location.href = '/support.html';
    });

    // Email button
    emailBtn.addEventListener('click', () => {
      window.location.href = 'mailto:SendRH@Atomicmail.io?subject=Question about SendRH.com';
    });

    // New tip button
    newTipBtn.addEventListener('click', () => {
      const tips = getTips().tips || [];
      const randomTip = tips[Math.floor(Math.random() * tips.length)];
      const tipEl = document.getElementById('sendy-tip');
      if (tipEl) tipEl.textContent = randomTip;
    });

    // Chat mode handlers
    const chatBtn = document.getElementById('sendy-chat');
    const tipsMode = document.getElementById('sendy-tips-mode');
    const chatMode = document.getElementById('sendy-chat-mode');
    const chatForm = document.getElementById('sendy-chat-form');
    const chatInput = document.getElementById('sendy-chat-input');
    const chatMessages = document.getElementById('sendy-chat-messages');
    const backBtn = document.getElementById('sendy-back');

    function switchToChat() {
      tipsMode.setAttribute('hidden', '');
      chatMode.removeAttribute('hidden');
      setTimeout(() => chatInput.focus(), 100);
    }

    function switchToTips() {
      chatMode.setAttribute('hidden', '');
      tipsMode.removeAttribute('hidden');
    }

    function addMessage(text, isUser = false) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'sendy-msg ' + (isUser ? 'sendy-msg-user' : 'sendy-msg-sendy');
      const bubble = document.createElement('div');
      bubble.className = 'sendy-msg-bubble';
      bubble.textContent = text;
      msgDiv.appendChild(bubble);
      chatMessages.appendChild(msgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatBtn.addEventListener('click', switchToChat);
    backBtn.addEventListener('click', switchToTips);

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const question = chatInput.value.trim();
      if (!question) return;

      // Add user message
      addMessage(question, true);
      chatInput.value = '';

      // Find and add answer
      const answer = findAnswer(question);
      setTimeout(() => {
        if (answer) {
          addMessage(answer, false);
        } else {
          addMessage(
            "I'm not sure about that one! 🤔 Head over to the Support page to ask the community, or email SendRH@Atomicmail.io for direct help. I'm always learning!",
            false
          );
        }
        chatInput.focus();
      }, 300);
    });

    // Dragging on desktop (not on mobile)
    let startX = 0, startY = 0, elementX = 0, elementY = 0;

    rocket.addEventListener('mousedown', (e) => {
      if (isMobile()) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = rocket.getBoundingClientRect();
      elementX = rect.left;
      elementY = rect.top;
      rocket.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || isMobile()) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newX = elementX + deltaX;
      const newY = elementY + deltaY;

      // Constrain to viewport
      const maxX = window.innerWidth - 64;
      const maxY = window.innerHeight - 64;
      const finalX = Math.max(0, Math.min(newX, maxX));
      const finalY = Math.max(0, Math.min(newY, maxY));

      sendyWidget.style.position = 'fixed';
      sendyWidget.style.left = finalX + 'px';
      sendyWidget.style.right = 'auto';
      sendyWidget.style.top = finalY + 'px';
      sendyWidget.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        rocket.style.cursor = 'grab';
      }
    });

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
      if (!popup.hasAttribute('hidden') &&
          !popup.contains(e.target) &&
          !rocket.contains(e.target)) {
        popup.setAttribute('hidden', '');
      }
    });
  }

  // Start Sendy when the page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
