/* ===== apiconfig.js — WHERE THIS COPY OF THE FRONT-END LOOKS FOR ITS BACKEND =====
 *
 * This file is deliberately one line, because it is the ONE thing that differs between a normal
 * self-hosted deployment and a copy of the front-end served from decentralized storage.
 *
 *   ''    → same origin. The Node server that served this page also answers /api/*. This is the
 *           default and it is what every ordinary deployment wants: it is a no-op, and the app
 *           behaves exactly as if apibase.js did not exist.
 *
 *   null  → there is NO backend. Static-only mode: the parts of the site that read the chain
 *           directly (live prices, market cap, the swap, the charts, how-to-buy, all the written
 *           content) work normally; the parts that need an account (wall, calls, communities,
 *           points, arcade, tracker, watchlist) say so plainly instead of hanging.
 *
 *   'https://host'  → a specific instance. Used by a copy pinned to IPFS/Arweave that wants the
 *           full app. The operator of that instance must list this bundle's origin in
 *           ALLOWED_ORIGINS, or the browser will refuse the cross-origin call — see DECENTRALIZED.md.
 *
 * A viewer can always override this for themselves; apibase.js reads localStorage['jsi:api'] first.
 * scripts/build-static.mjs rewrites this file when it builds the decentralized bundle. */
window.JSI_API_BASE = '';
