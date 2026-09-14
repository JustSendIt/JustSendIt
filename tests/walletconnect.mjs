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

    const ens = (/async function ensureRobinhoodChain[\s\S]*?\n\}/.exec(CHAIN) || [''])[0];
    const add = (/async function addRobinhoodChain[\s\S]*?\n\}/.exec(CHAIN) || [''])[0];
    let ensure = null;
    try {
      ensure = new Function('RH_CHAIN', 'sendToast', 'wprov', `${add}\n${ens}\nreturn ensureRobinhoodChain;`)(
        { hexId: chainId, name: 'Robinhood Chain', rpc: 'x', explorer: 'y', currency: {} },
        () => {}, () => null);
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
      const run = async (cur, onSwitch, onAdd) => { const m = mk(cur, onSwitch, onAdd); const ok = await ensure(m.provider, 'connect'); return { ok, calls: m.calls }; };

      const already = await run(chainId);
      check('a wallet already on Robinhood Chain is never interrupted',
        already.ok === true && already.calls.length === 1 && already.calls[0] === 'eth_chainId', already.calls.join('→'));
      const switched = await run('0x1');
      check('a wallet on another chain is switched', switched.ok === true && switched.calls.includes('wallet_switchEthereumChain'));
      const added = await run('0x1', { code: 4902, msg: 'Unrecognized chain ID' });
      check('a wallet that has never seen this chain is offered it',
        added.ok === true && added.calls.includes('wallet_addEthereumChain'), added.calls.join('→'));
      const refusedSwitch = await run('0x1', { code: 4001, msg: 'User rejected' });
      check('a refused switch reports false rather than pretending', refusedSwitch.ok === false);
      const refusedAdd = await run('0x1', { code: 4902, msg: 'Unrecognized chain ID' }, { code: 4001, msg: 'rejected' });
      check('  ...and so does a refused add', refusedAdd.ok === false, refusedAdd.calls.join('→'));
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
} catch (e) {
  console.error('ERROR', e.message, e.stack && e.stack.split('\n').slice(1, 3).join('\n'));
}

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
