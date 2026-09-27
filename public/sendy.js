/* Sendy — the helpful rocket companion for navigating $Send and crypto
   A Clippy-style helper that knows the site and guides users to answers or support.
   On desktop: fluid, animated, draggable. On mobile: fixed at the bottom, out of the way. */

(function () {
  'use strict';

  let sendyOpen = false, isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
  const isMobile = () => window.innerWidth < 768;

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
          <div class="sendy-body">
            <p class="sendy-greeting" id="sendy-greeting">${greeting}</p>
            <p class="sendy-tip" id="sendy-tip">${tip}</p>
            <div class="sendy-actions">
              <button class="sendy-btn sendy-btn-primary" id="sendy-support" type="button" data-tip="Opens the Support page where you can ask questions or answer others">
                Got a question? → Support
              </button>
              <button class="sendy-btn sendy-btn-secondary" id="sendy-email" type="button" data-tip="Opens your email client to send a private message to the support team">
                Email: SendRH@Atomicmail.io
              </button>
              <button class="sendy-btn sendy-btn-tertiary" id="sendy-newtip" type="button" data-tip="Shows another helpful tip about this page">
                Another tip
              </button>
            </div>
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
