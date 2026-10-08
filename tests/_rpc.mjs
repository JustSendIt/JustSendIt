/* The suites' own reads of the public node go the way the server's do: over HTTP/2. Measured 2026-10-08: once this
   address has been busy the node's edge answers Node's HTTP/1.1 fetch (with its browser-style headers) a "Just a
   moment…" 403 page, and the same request over HTTP/2 answers 200 — so a suite probing the node over plain fetch fails
   for a reason that has nothing to do with what it tests. */
import { createRequire } from 'node:module';
import { ROOT } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Agent } = require('undici');
export const rpcDispatcher = new Agent({ allowH2: true });
