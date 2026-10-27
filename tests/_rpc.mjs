/* The suites' own reads of the public node go the way the server's do: over HTTP/2. Measured 2026-10-08: once this
   address has been busy the node's edge answers Node's HTTP/1.1 fetch (with its browser-style headers) a "Just a
   moment…" 403 page, and the same request over HTTP/2 answers 200 — so a suite probing the node over plain fetch fails
   for a reason that has nothing to do with what it tests. */
import { createRequire } from 'node:module';
import { ROOT } from './_paths.mjs';
const require = createRequire(ROOT + '/package.json');
const { Agent } = require('undici');
export const rpcDispatcher = new Agent({ allowH2: true });
// …and as the site itself: the server's one identity (lib/marketdata.js HONEST_UA), never a browser's (owner, 2026-10-27)
export const HONEST_UA = require('./lib/marketdata.js').HONEST_UA;

/* Live reads of the chain — the suites' own probes and the routes that make the server read it — run only with
   CHAIN_LIVE=1. Measured 2026-10-08/09: from the machine that serves the site they throttle its own pool-price and
   chart reads for minutes (one address, one node budget), and from GitHub's runners the node refuses them outright,
   so CI was red for weeks on reads that say nothing about the code. The pure parts of every suite always run. */
export const LIVE_CHAIN = process.env.CHAIN_LIVE === '1';
export const liveSkipped = (what) => 'live chain reads skipped — CHAIN_LIVE=1 runs them (' + what + ')';
