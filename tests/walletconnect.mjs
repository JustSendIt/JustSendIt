/* Connecting a wallet: one door, the right chain, and a disconnect that means what it says.
 *
 * Three things were wrong and each was invisible in a different way.
 *   · "Connect a wallet →" did not connect a wallet on two of the four places it appeared — it opened
 *     the sign-in panel and left the reader to find the wallet tab.
 *   · Every connect except the swap left the wallet on whatever network it was already showing, so the
 *     site read balances and holdings on a chain the reader was not on: nothing on screen, nothing wrong
 *     on screen to explain it.
 *   · "Disconnect wallet" was offered to accounts whose wallet is their only way in, where the server
 *     refuses it — so the reader found out by being refused.
 *
 * ensureRobinhoodChain is exercised for real: the function is lifted out of chain.js and run against
 * fake providers, because the branch that matters (a wallet that has never seen this chain) cannot be
 * reached by reading.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_paths.mjs';

const PUB = path.join(ROOT, 'public');
const AUTH = readFileSync(path.join(PUB, 'auth.js'), 'utf8');
const CHAIN = readFileSync(path.join(PUB, 'chain.js'), 'utf8');
const WALLET = readFileSync(path.join(PUB, 'wallet.js'), 'utf8');
const ABOUT = readFileSync(path.join(PUB, 'about.js'), 'utf8');
const HOME = readFileSync(path.join(PUB, 'home.js'), 'utf8');
const SRC = readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const results = [];
const check = (n, ok, extra) => results.push([n, !!ok, extra === undefined ? '' : String(extra)]);

// assertions read CODE, not the comments that explain the code
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AUTH_C = strip(AUTH), CHAIN_C = strip(CHAIN), WALLET_C = strip(WALLET);

try {
  /* ═══════════ 1. one door ═══════════ */
  {
    check('there is a single public way to connect a wallet', /AUTH\.connectWallet = async function/.test(AUTH_C));
    check('  ...signed in, it links without a detour through the panel', /if \(AUTH\.user\) return AUTH\.linkWallet\(opts\.note\)/.test(AUTH_C));
    check('  ...signed out, it opens the panel already running the wallet sign-in',
      /openModal\(\);[\s\S]{0,320}?#btn-wallet-signin[\s\S]{0,60}?click\(\)/.test(AUTH_C));
    check('  ...and selects the wallet tab if a previous visit left Email showing',
      /#tab-wallet[\s\S]{0,120}?classList\.contains\('active'\)/.test(AUTH_C));
    /* The signed-out path deliberately reuses the modal's handler: it already deals with a brand-new
       account, an address linked elsewhere, an invite the server wants first, and a wallet that is only
       the first factor. A second copy of that would drift from the first. */
    check('  ...rather than a second copy of the hardest flow on the site',
      (AUTH_C.match(/purpose=signin/g) || []).length === 1);

    check('the about page\'s connect buttons connect', /\['gs-connect', 'pillar-connect'\][\s\S]{0,400}?AUTH\.connectWallet\(\)/.test(strip(ABOUT)));
    check('  ...and its JOIN buttons still just open the panel', /\['gs-join', 'join-signin'\][\s\S]{0,120}?openAuth/.test(strip(ABOUT)));
    check('the landing page\'s connect button goes through the same door', /AUTH\.connectWallet\(/.test(strip(HOME)));
  }

  /* ═══════════ 2. the right chain, every time ═══════════ */
  {
    check('every connect lands on Robinhood Chain, not just the swap',
      /window\.ensureRobinhoodChain\(chosen\.provider, 'connect'\)/.test(WALLET_C));
    check('  ...and the result rides along so a caller can say something useful', /chainOk: chainOk/.test(WALLET_C));
    /* A personal_sign is chain-agnostic. Refusing the sign-in because somebody declined a network switch
       would be a worse outcome than the one this fixes. */
    check('  ...but a refused switch never refuses the sign-in',
      /catch \{ chainOk = false; \}/.test(WALLET_C) && !/throw[\s\S]{0,80}?ensureRobinhoodChain/.test(WALLET_C));
    check('the chain helpers act on the provider that was actually connected',
      /async function ensureRobinhoodChain\(prov, why\)/.test(CHAIN_C) && /async function addRobinhoodChain\(prov\)/.test(CHAIN_C));
    check('  ...and the swap still names itself in its own refusal', /ensureRobinhoodChain\(null, 'swap'\)/.test(CHAIN_C));

    /* THE REAL THING. Lift ensureRobinhoodChain + addRobinhoodChain out and run them against providers
       that answer the way real wallets do. */
    const chainId = (/const RH_CHAIN = \{[\s\S]*?hexId: '([^']+)'/.exec(CHAIN) || [])[1];
    check('the chain id is Robinhood Chain', chainId === '0x1237', chainId);

    const toasts = [];
    const ens = (/async function ensureRobinhoodChain[\s\S]*?\n\}/.exec(CHAIN) || [''])[0];
    const add = (/async function addRobinhoodChain[\s\S]*?\n\}/.exec(CHAIN) || [''])[0];
    let ensure = null;
    try {
      ensure = new Function('RH_CHAIN', 'sendToast', 'wprov', `${add}\n${ens}\nreturn ensureRobinhoodChain;`)(
        { hexId: chainId, name: 'Robinhood Chain', rpc: 'x', explorer: 'y', currency: {} },
        (t) => toasts.push(String(t)), () => null);
    } catch (e) { check('ensureRobinhoodChain could be lifted out and run', false, e.message); }

    if (typeof ensure === 'function') {
      const mk = (cur, onSwitch, onAdd) => {
        const calls = [];
        return { calls, provider: { request: async ({ method }) => {
          calls.push(method);
          if (method === 'eth_chainId') { if (cur === 'unsupported') throw new Error('no'); return cur; }
          if (method === 'wallet_switchEthereumChain' && onSwitch) { const e = new Error(onSwitch.msg); e.code = onSwitch.code; throw e; }
          if (method === 'wallet_addEthereumChain' && onAdd) { const e = new Error(onAdd.msg); e.code = onAdd.code; throw e; }
          return null;
        } } };
      };
      const run = async (cur, onSwitch, onAdd, why) => { toasts.length = 0; const m = mk(cur, onSwitch, onAdd); const ok = await ensure(m.provider, why || 'connect'); return { ok, calls: m.calls, toasts: toasts.slice() }; };

      const already = await run(chainId);
      check('a wallet already on Robinhood Chain is never interrupted',
        already.ok === true && already.calls.length === 1 && already.calls[0] === 'eth_chainId', already.calls.join('→'));
      const switched = await run('0x1');
      check('a wallet on another chain is switched', switched.ok === true && switched.calls.includes('wallet_switchEthereumChain'));
      const added = await run('0x1', { code: 4902, msg: 'Unrecognized chain ID' }, null, 'swap');
      check('for the swap, a wallet that has never seen this chain is offered it',
        added.ok === true && added.calls.includes('wallet_addEthereumChain'), added.calls.join('→'));
      /* A sign-in or a link is read-only and its signature is chain-agnostic: a connect never asks the wallet to ADD a
         network (Coinbase Wallet and Phantom refuse the ask outright, and it is a strange thing to see beside "sign a
         free message") — it reports false, quietly, and the sign-in goes on. */
      const notOffered = await run('0x1', { code: 4902, msg: 'Unrecognized chain ID "0x1237". Try adding the chain using wallet_addEthereumChain first.' });
      check('for a connect, a wallet that has never seen this chain is NOT asked to add it, and no toast is shown', notOffered.ok === false && !notOffered.calls.includes('wallet_addEthereumChain') && notOffered.toasts.length === 0, notOffered.calls.join('→') + ' toasts=' + JSON.stringify(notOffered.toasts));
      const unsupported = await run('0x2105', { code: -32603, msg: 'Unsupported chain id' });
      check('  ...nor is a wallet that says the chain is unsupported in its own words', unsupported.ok === false && !unsupported.calls.includes('wallet_addEthereumChain') && unsupported.toasts.length === 0, unsupported.calls.join('→') + ' toasts=' + JSON.stringify(unsupported.toasts));
      const refusedSwitch = await run('0x1', { code: 4001, msg: 'User rejected' });
      check('a refused switch reports false rather than pretending, and a connect says nothing about it', refusedSwitch.ok === false && refusedSwitch.toasts.length === 0, JSON.stringify(refusedSwitch.toasts));
      const swapRefused = await run('0x1', { code: 4001, msg: 'User rejected' }, null, 'swap');
      check('  ...the swap, which needs the chain, says so in one toast', swapRefused.ok === false && swapRefused.toasts.length === 1 && /swap/i.test(swapRefused.toasts[0]), JSON.stringify(swapRefused.toasts));
      const refusedAdd = await run('0x1', { code: 4902, msg: 'Unrecognized chain ID' }, { code: 4001, msg: 'rejected' }, 'swap');
      check('  ...and so does a refused add (swap)', refusedAdd.ok === false, refusedAdd.calls.join('→'));
      const noChainId = await run('unsupported');
      check('a provider that cannot answer eth_chainId still gets switched',
        noChainId.ok === true && noChainId.calls.includes('wallet_switchEthereumChain'));
    }
  }

  /* ═══════════ 3. disconnect means what it says ═══════════ */
  {
    check('the menu knows how you signed in, from the server\'s own answer', /Array\.isArray\(user\.methods\)/.test(AUTH_C));
    check('  ...and /api/me actually sends it', /methods: identityTypes\(me\.id\)/.test(SRC));
    /* The first version read an ABSENT methods list as "wallet only", which would have hidden Sign out
       for every account and turned Disconnect into a logout for people who have an email. */
    check('not knowing is never treated as wallet-only',
      /const walletOnly = !!methods && methods\.length > 0 && !methods\.some\(m => m !== 'wallet'\)/.test(AUTH_C));
    check('a wallet-only account signs out instead of being refused an unlink',
      /if \(walletOnly\) \{ setProfileOpen\(wrap, false\); AUTH\.logout\(\); return; \}/.test(AUTH_C));
    check('  ...and is not shown two buttons that do the same thing',
      /if \(walletOnly && user\.wallets && user\.wallets\.length\) out\.hidden = true;/.test(AUTH_C));
    check('an account with another way in keeps its session when it drops a wallet',
      /await AUTH\.disconnectWallet\(\)/.test(AUTH_C) && /AUTH\.disconnectWallet = async function/.test(AUTH_C));
    check('  ...and the confirmation says which of the two is about to happen',
      /walletOnly[\s\S]{0,120}?this signs you out/.test(AUTH_C));
    check('the server still refuses to strand a wallet-only account',
      /your wallet is your only way to sign in, so disconnecting it would lock you out/.test(SRC));
  }
  /* ═══════════ 4. everything about getting in, in one place ═══════════ */
  {
    const PHTML = readFileSync(path.join(PUB, 'profile.html'), 'utf8');
    const PJS = strip(readFileSync(path.join(PUB, 'profile.js'), 'utf8'));
    const sec = (/<details class="setting-card" id="sec-security">[\s\S]*?<\/details>/.exec(PHTML) || [''])[0];
    check('there is a Security panel', !!sec);
    for (const [what, id] of [
      ['which ways in you have',      'pf-methods'],
      ['every linked wallet',         'wl-list'],
      ['adding another wallet',       'link-wallet-btn'],
      ['an authenticator app',        'totp-start-btn'],
      ['a wallet as the second factor','wallet-2fa-btn'],
      ['a password as the second factor','pw-2fa-btn'],
      ['turning the second factor off','twofa-disable-btn'],
    ]) check('  ...and it holds ' + what, sec.includes(id));

    /* A <details> opens shut, so a panel labelled only "Security" answers nothing until it is opened. */
    check('the label carries the state, so it is readable while shut',
      /id="sec-state"/.test(PHTML) && /function securitySummary\(me\)/.test(PJS) && /'2FA on' : '2FA off'/.test(PJS));
    check('  ...and it is repainted whenever either half changes',
      (PJS.match(/securitySummary\(me\);/g) || []).length >= 2);
    check('  ...saying it in words, never only in colour', /no wallet yet/.test(PJS) && /sec-state-warn/.test(readFileSync(path.join(PUB, 'styles.css'), 'utf8')));

    check('the dashboard offers a way to reach it', /id="sec-jump-link"/.test(PHTML) && /href="#sec-security"/.test(PHTML));
    /* A link to a <details> scrolls to it and leaves it shut — from the reader's side, a link that did
       nothing. */
    check('  ...that actually opens it, rather than scrolling to a shut panel',
      /function openSecurity\(scroll\)/.test(PJS) && /d\.open = true;/.test(PJS));
    check('  ...including when the page is opened at that link directly', /location\.hash === '#sec-security'/.test(PJS));
    check('  ...and focus follows, for anyone who arrived by keyboard', /sum\.focus\(\{ preventScroll: true \}\)/.test(PJS));

    /* This page had a THIRD hand-rolled copy of the link flow, identical to AUTH.linkWallet — and being
       a copy, it missed what the shared one gained: landing the wallet on Robinhood Chain. */
    check('linking from this page goes through the one shared door',
      /AUTH\.connectWallet\(\{ note: 'Linking a wallet adds a new way to sign in/.test(PJS));
    check('  ...so the hand-rolled copy is gone', !/purpose=link&address=/.test(PJS));
    check('  ...while the page still repaints what only it has', /loadConnectedWallet\(\)/.test(PJS) && /loadGamify\(\)/.test(PJS));
  }

  /* ═══════════ 3. the whole market, one read-only way (owner, 2026-10-20) ═══════════ */
  {
    const entries = [...WALLET_C.matchAll(/\{ key: '([a-z0-9]+)', name: '([^']+)', emoji: '[^']+', re: \/[^/]+\/i,([^}]*)\}/g)].map((m) => ({ key: m[1], name: m[2], rest: m[3] }));
    const keys = entries.map((e) => e.key);
    check('the registry names the market: 31 wallets plus GMGN, every key unique', entries.length === 32 && new Set(keys).size === keys.length && keys.includes('gmgn'), entries.length + ' ' + keys.join(','));
    check('  ...every one with an official https download page', entries.every((e) => /get: 'https:\/\/[^']+'/.test(e.rest)));
    check('  ...the five that ship Robinhood Chain say so, and no other claims it', entries.filter((e) => /chain: true/.test(e.rest)).map((e) => e.key).sort().join(',') === 'coinbase,phantom,rabby,robinhood,uniswap');
    check('  ...none of the wallets that cannot connect here is listed (WalletConnect-only, bare hardware, shut down)', !keys.some((k) => ['kraken', 'ledger', 'exodus', 'ctrl', 'trezor', 'safe', 'argent', 'zengo'].includes(k)));
    /* the registry, run: what each wallet announces (EIP-6963 name + rdns) brands as itself and nothing else */
    const PROF_C = strip(readFileSync(path.join(PUB, 'profile.js'), 'utf8'));
    const KNOWN_SRC = /const KNOWN = \[([\s\S]*?)\n  \];/.exec(WALLET)[1];
    const KNOWN = new Function('location', 'return [' + KNOWN_SRC + '\n];')({ origin: 'https://x' });
    const knownFor = (name, rdns) => KNOWN.find((k) => k.re.test(name + ' ' + (rdns || ''))) || null;
    const announce = [['MetaMask', 'io.metamask', 'metamask'], ['Phantom', 'app.phantom', 'phantom'], ['Coinbase Wallet', 'com.coinbase.wallet', 'coinbase'], ['Trust Wallet', 'com.trustwallet.app', 'trust'],
      ['Rabby Wallet', 'io.rabby', 'rabby'], ['OKX Wallet', 'com.okex.wallet', 'okx'], ['Rainbow', 'me.rainbow', 'rainbow'], ['Robinhood Wallet', 'com.robinhood.wallet', 'robinhood'],
      ['Brave Wallet', 'com.brave.wallet', 'brave'], ['Crypto.com Onchain', 'com.crypto.wallet', 'cryptocom'], ['Crypto.com | DeFi Wallet', 'com.crypto.wallet', 'cryptocom'], ['Core', 'app.core.extension', 'core'],
      ['MEW wallet', 'com.mewwallet', 'mew'], ['Enkrypt', 'com.enkrypt', 'enkrypt'], ['Uniswap Extension', 'org.uniswap.app', 'uniswap'], ['Zerion', 'io.zerion.wallet', 'zerion'], ['Bitget Wallet', 'com.bitget.web3', 'bitget'],
      ['Binance Wallet', 'com.binance.wallet', 'binance'], ['Backpack', 'app.backpack', 'backpack'], ['Taho', 'xyz.taho.wallet', 'taho'], ['Talisman', 'xyz.talisman', 'talisman'], ['Keplr', 'app.keplr', 'keplr'], ['Frame', 'sh.frame', 'frame'],
      ['Nightly', 'app.nightly', 'nightly'], ['SafePal', 'com.safepal', 'safepal'], ['TokenPocket', 'pro.tokenpocket', 'tokenpocket'], ['MathWallet', 'org.mathwallet', 'mathwallet'], ['Coin98', 'coin98.com', 'coin98'],
      ['1inch Wallet', 'io.1inch.wallet', '1inch'], ['Ambire', 'com.ambire.wallet', 'ambire'], ['imToken', 'im.token.app', 'imtoken'], ['Magic Eden', 'io.magiceden.wallet', 'magiceden'], ['GMGN', 'ai.gmgn', 'gmgn'],
      // bystanders: wallets not listed must brand as nothing, never as a listed one
      ['Trustee Wallet', 'com.trusteeglobal', null], ['XDEFI Wallet', 'io.xdefi', null], ['Bitcoin.com Wallet', 'com.bitcoin.wallet', null], ['Ledger Live', 'com.ledger.live', null], ['Exodus', 'com.exodus', null]];
    const wrong = announce.filter(([n, r, want]) => ((knownFor(n, r) || {}).key || null) !== want).map(([n, r, want]) => n + '→' + ((knownFor(n, r) || {}).key || 'none') + ' (want ' + want + ')');
    check('  ...run against what each wallet announces, every one brands as itself and a bystander as nothing', !wrong.length, wrong.join(', '));
    const cross = KNOWN.filter((k) => KNOWN.some((o) => o !== k && k.re.test(o.name))).map((k) => k.key);
    check('  ...and no entry\'s pattern matches another entry\'s name', !cross.length, cross.join(','));
    check('  ...and a late announcement redraws a list only when the set changed, so a redraw never takes the focus',
      /if \(s !== last\) \{ last = s; renderList\(\); \}/.test(WALLET) && /if \(s !== last\) \{ last = s; render\(\); \}/.test(strip(HOME)));
    /* owner, 2026-10-20: "I don't see all the new wallets in the sign-up screen" — a browser with one wallet went straight to it */
    check('signing in, signing up or linking always shows the whole list (a browser with one wallet installed included)',
      /\} else if \(!\(opts && opts\.burn\)\) \{\n      chosen = selected \|\| remembered\(\);/.test(WALLET_C) && !/fast path/.test(WALLET_C));
    check('  ...two-factor and "confirm it\'s you" go straight only to an only wallet; with several installed the person picks (never a wallet linked a minute ago, again and again)',
      /if \(opts && opts\.choose\) \{\n[^\n]*\n[^\n]*\n      if \(all\.length === 1\) chosen = all\[0\];/.test(WALLET_C)
      && (AUTH_C.match(/WALLET\.connect\(\{ choose: true \}\)/g) || []).length === 2 && (PROF_C.match(/WALLET\.connect\(\{ choose: true \}\)/g) || []).length === 2
      && !/WALLET\.connect\(\)/.test(AUTH_C) && !/WALLET\.connect\(\)/.test(PROF_C));
    check('GMGN is in the main list wherever a wallet is being proved, and its row opens Burn Verification', /!detected\.has\(k\.key\) && \(!k\.burn \|\| pickOpts\.burn\)/.test(WALLET_C) && /if \(k\.burn\) \{[\s\S]{0,900}?toBurn\(k\.key\)/.test(WALLET_C)
      && /\{ key: 'phantom'[^\n]*\n(?:[^\n]*\n){0,3}\s+\{ key: 'gmgn'/.test(WALLET) && /burn: !!k\.burn/.test(WALLET_C));
    check('the sign-in panel\'s main options are Connect wallet, Burn Verification and Email, in that order',
      /id="tab-wallet"[^>]*>🦊 Connect wallet<\/button>\s*<button[^>]*id="tab-burn"[^>]*>🔥 Burn Verification<\/button>\s*<button[^>]*id="tab-email"[^>]*>✉️ Email<\/button>/.test(AUTH)
      && /<div id="pane-burn" role="tabpanel" aria-labelledby="tab-burn" hidden>/.test(AUTH));
    /* owner, 2026-10-22: "Fix the sign-up process for the burn verification so that its fluid" — one form, not three */
    check('  ...Burn Verification is one form: a new account (username, email, password twice) or a sign-in, plus the wallet, and one press',
      /<form id="burn-form" novalidate>/.test(AUTH) && /id="b-username"/.test(AUTH) && /id="b-pw2"/.test(AUTH) && /id="b-addr"/.test(AUTH) && /id="bseg-signup"[^>]*>Create account</.test(AUTH) && /id="bseg-login"[^>]*>I have an account</.test(AUTH)
      && /if \(!AUTH\.user && AUTH\._showBurnTab\) \{/.test(AUTH_C) && !/id="burn-join"|burnGo/.test(AUTH_C));
    check('  ...that press makes the account (or signs in), starts the hour — a sign-in handing over its password as "confirm it\'s you" — and opens the burn step on the wallet',
      /j = await api\('\/api\/auth\/register', \{ method: 'POST', body: \{ username: v\.username, email: v\.email, password: v\.pw \} \}\);/.test(AUTH_C)
      && /api\('\/api\/wallet\/burnproof\/start', \{ method: 'POST', body: Object\.assign\(\{ address: v\.address \}, bRegMode \? \{\} : \{ current: \{ password: v\.pw \} \}\) \}\)/.test(AUTH_C)
      && /await AUTH\.openBurnProof\(\{ from: 'signup', address: v\.address, error:/.test(AUTH_C));
    check('  ...without a ticket the ticket comes first, and the form carries on by itself after it with what was typed; a two-factor sign-in comes back to the burn step on its wallet',
      /if \(!g\.signedIn && !g\.access\) \{ setStatus\(bStatus, ''\); toTicket\(v\); return; \}/.test(AUTH_C) && /openInvite\(\{ then: resumeBurnForm \}\)/.test(AUTH_C)
      && /bq\('b-addr'\)\.value = p\.address;\s*burnSubmit\(\);/.test(AUTH_C) && /sessionStorage\.setItem\('jsi:burnproof-addr', v\.address\)/.test(AUTH_C) && /AUTH\.openBurnProof\(\{ from: 'resume', address \}\)/.test(AUTH_C));
    /* review, 2026-10-22 */
    check('  ...a spent code is said, never looped through the ticket; a taken @username is said before the ticket; what was typed waits half an hour at most',
      /if \(bRegMode && \(err\.code === 'need_invite' \|\| err\.code === 'need_tos'\)\) \{/.test(AUTH_C) && !/err\.code === 'code_spent'\)\) \{ setStatus\(bStatus/.test(AUTH_C)
      && /api\('\/api\/username-check\?u=' \+ encodeURIComponent\(v\.username\)\)/.test(AUTH_C) && /burnPendingT = setTimeout\(\(\) => \{ burnPending = null; \}, 30 \* 60e3\);/.test(AUTH_C));
    check('  ...a member whose wallet is proved can just sign in (the wallet optional), the form is emptied after, no older note reopens the step, an error takes the focus to its field, the toast says what happened',
      /if \(!\(v\.address === '' && !bRegMode\) && !\/\^0x\[0-9a-fA-F\]\{40\}\$\/\.test\(v\.address\)\)/.test(AUTH_C) && /for \(const id of \['b-username', 'b-email', 'b-pw', 'b-pw2', 'b-addr'\]\) \{ bq\(id\)\.value = '';/.test(AUTH_C)
      && /sessionStorage\.removeItem\('jsi:burnproof'\); sessionStorage\.removeItem\('jsi:burnproof-addr'\);/.test(AUTH_C) && /f\.setAttribute\('aria-invalid', 'true'\); f\.focus\(\);/.test(AUTH_C)
      && /'⚠️ Your hour couldn’t start yet — the reason is in the burn step\.'/.test(AUTH_C) && /id="b-addr" autocomplete="off" spellcheck="false" maxlength="64"/.test(AUTH));
    check('  ...the picker lists every wallet, none behind a toggle', /for \(const k of undetected\) footEl\.appendChild\(row\(k\)\);/.test(WALLET_C) && !/wc-more|showAll/.test(WALLET_C));
    check('  ...the wallet this browser used before is marked "Last used" and focused first', /<span class="wc-badge wc-last">Last used<\/span>/.test(WALLET_C) && /overlay\.querySelector\('\.wc-item\[data-last\]'\) \|\| overlay\.querySelector\('\.wc-item'\)/.test(WALLET_C));
    check('the sign-in and sign-up screen itself names the wallets that work here, from the same registry, every one a press away — the signing ones counted as such, GMGN apart',
      /<details class="w-works" id="w-works" hidden>/.test(AUTH_C) && /'Works with ' \+ signing\.length \+ ' wallets — '/.test(AUTH_C) && /' by Burn Verification'/.test(AUTH_C) && /WALLET\.known\(\)/.test(AUTH_C));
    check('  ...but the home "Get a wallet" guide lists only wallets to get and connect: never GMGN', /\.filter\(\(k\) => !k\.burn\)\.map\(\(k, i\) => Object\.assign\(\{\}, k, \{ featured: i < 8 \}\)\)/.test(strip(HOME)) && !/verifies by a burn/.test(HOME));
    check('  ...a sign-up opened on Burn Verification stays on its own form, and the picker\'s GMGN row leaves the focus on that option',
      /if \(opts && opts\.tab === 'burn'\) \{ const t = modal\.querySelector\('#tab-burn'\); if \(t\) t\.click\(\); \}\s*if \(AUTH\._burnMode\) AUTH\._burnMode\(true\);/.test(AUTH_C) && /tabs\.burn\.click\(\); tabs\.burn\.focus\(\);[^\n]*\n\s*return true;/.test(AUTH_C));
    check('  ...the home guide shows the best-fitting eight first and the rest behind "Show all"',
      /const FEATURED = 8;/.test(WALLET_C) && /featured: i < FEATURED/.test(WALLET_C) && /k\.featured \|\| has\(k\) \|\| showAll/.test(strip(HOME)) && /'Show all ' \+ all\.length \+ ' wallets ▾'/.test(strip(HOME)));
    check('  ...and every entry goes through the one read-only path: no wallet SDK, no WalletConnect, no transaction', !/walletconnect|@walletconnect|sdk|eth_sendTransaction/i.test(WALLET_C));
  }
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
