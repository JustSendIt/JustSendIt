/* F70: prove the sign-in message is EXACTLY EIP-4361, not merely domain-bound prose.
   The point of the format is that a wallet PARSES it — only then does MetaMask draw the "Sign-in request"
   panel and warn on a domain mismatch. So this validates against the spec's grammar, not against a hope. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { SERVER_JS, ETHERS } from './_paths.mjs';
// ethers is CommonJS; createRequire loads it from the checkout without a literal import path
const { Wallet, verifyMessage, getAddress } = createRequire(import.meta.url)(ETHERS);

const SRC = readFileSync(SERVER_JS, 'utf8');

// pull the real function out of server.js rather than reimplementing it
const m = SRC.match(/function signInMessage\(address, nonce, statement\) \{[\s\S]*?\n\}/);
if (!m) { console.error('could not extract signInMessage'); process.exit(1); }
const SITE_HOST = 'justsendit.xyz', BASE_URL = 'https://justsendit.xyz/';
const now = () => 1788960000000;
const signInMessage = new Function('SITE_HOST', 'BASE_URL', 'now', 'getAddress',
  m[0] + '\nreturn signInMessage;')(SITE_HOST, BASE_URL, now, getAddress);

const results = [];
const check = (n, ok, extra) => { results.push([n, !!ok, extra || '']); };

const addr = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const nonce = 'a3f9c1d2e4b5a6f7';
const msg = signInMessage(addr, nonce);
console.log('--- message as issued ---\n' + msg + '\n-------------------------\n');

/* EIP-4361 ABNF, transcribed. Field order is fixed by the spec; Version is mandatory. */
const RE = new RegExp(
  '^(?<domain>[^\\n]+) wants you to sign in with your Ethereum account:\\n' +
  '(?<address>0x[0-9a-fA-F]{40})\\n' +
  '\\n(?<statement>[^\\n]+)\\n' +
  '\\nURI: (?<uri>[^\\n]+)\\n' +
  'Version: (?<version>1)\\n' +
  'Chain ID: (?<chainId>[0-9]+)\\n' +
  'Nonce: (?<nonce>[a-zA-Z0-9]{8,})\\n' +
  'Issued At: (?<issuedAt>[^\\n]+)' +
  '(?:\\nExpiration Time: (?<exp>[^\\n]+))?' +
  '(?:\\nNot Before: [^\\n]+)?' +
  '(?:\\nRequest ID: [^\\n]*)?' +
  '(?:\\nResources:(?:\\n- [^\\n]+)*)?$'
);
const g = RE.exec(msg);
check('parses against the EIP-4361 grammar', !!g);

if (g) {
  const f = g.groups;
  check('line 1 names this host as the domain', f.domain === SITE_HOST, f.domain);
  check('line 2 is the bare address (not an "Address:" field)', f.address.toLowerCase() === addr);
  check('address is EIP-55 checksummed (the parser requires it)', f.address === getAddress(addr), f.address);
  check('Version: 1 present', f.version === '1');
  check('Chain ID is Robinhood Chain', f.chainId === '4663', f.chainId);
  check('nonce carried through', f.nonce === nonce);
  check('URI is the site origin, no trailing slash', f.uri === 'https://justsendit.xyz', f.uri);
  check('Issued At is ISO 8601', !isNaN(Date.parse(f.issuedAt)), f.issuedAt);
  check('Expiration Time present and after Issued At', !!f.exp && Date.parse(f.exp) > Date.parse(f.issuedAt));
  check('expiry is the 10 minutes the server enforces', Date.parse(f.exp) - Date.parse(f.issuedAt) === 6e5);
  check('statement warns it moves no funds', /never moves funds/i.test(f.statement));
}

// the domain must be the thing a wallet compares against the site asking
check('domain is not a placeholder', !/yourdomain|example\.com/i.test(msg));

// end-to-end: a real signature over this exact text must recover the signer
const w = Wallet.createRandom();
const m2 = signInMessage(w.address.toLowerCase(), nonce);
const sig = await w.signMessage(m2);
check('a real signature over the message recovers the signer', verifyMessage(m2, sig).toLowerCase() === w.address.toLowerCase());
// and a signature over a DIFFERENT message must not
const other = signInMessage(w.address.toLowerCase(), 'ffffffffffffffff');
check('a signature is not valid for a different nonce', verifyMessage(other, sig).toLowerCase() !== w.address.toLowerCase());

// the 2FA challenge now goes through the same builder
check('2FA challenge uses signInMessage (one per wallet)', /entry\.messages\[w\] = signInMessage\(/.test(SRC));
check('2FA verify binds the signature to the claimed address', /if \(recovered !== addr\) return bad\(res, 'signature does not match that wallet'/.test(SRC));

let pass = 0;
for (const [n, ok, extra] of results) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (extra ? '  [' + extra + ']' : '')); if (ok) pass++; }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
