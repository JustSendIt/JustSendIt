The real-world-asset card on the Scanner's token dashboard (public/newpairs.js rwaCardHTML), drawn from these in
tests/scanpage.mjs. Nothing here was typed in.

rwa-token-*.json — the server's own /api/market/rwa/token answers (lib/marketdata.js rwaToken; the body server.js withRwa
  puts on a Robinhood Chain profile as p.rwa), written 2026-10-28 by tests/marketdata.mjs's in-process harness with its
  dump switch (MARKET_DUMP_DIR), run on that suite's measured fixtures (tests/fixtures/marketdata/README.txt says where each
  came from), with the fake node answering only what the research measured — so a subcall nobody measured reads as "no such
  function" here, as it does in that suite. Each file is one token's answer, unchanged:
    tsla                  TSLA, Robinhood Assets (Jersey): registry + on-chain, Chainlink and Robinhood references, the 12
                          registry roles, 175 blocked wallets, 7 connected tokens
    tsla-registry-down    the same, read again after Robinhood's API answered 503 (reads.registry.ok false, with its reason)
    spy                   SPY: a cash dividend in progress, multiplier 1.001718, a pool pairing it with another RWA
    week                  WEEK: on the chain but out of the registry's active list (A2 only), Robinhood's -50% deviation flag
    tslaon                TSLAon, Ondo Global Markets: confirmed by its beacon; Robinhood's references null with their reasons
    googlon               Ondo's GOOGLon before its beacon was read: not confirmed
    gme                   GME: the "GameStop" memecoin scanned as a lookalike
    gme-memecoin          that memecoin's own answer: the 404 { notRwa, why } ("Same ticker as $GME, but not issued by …")
    usdg                  USDG's 404: a fiat-backed stablecoin, listed apart
    notmystock            "Not My Stock" (NMS): a 404 that is neither a lookalike nor a stablecoin
  Rewritten on 2026-10-28 after the review, by the same harness and switch (every file here and the six in
  tests/fixtures/market/rwa-*.json are now dumped by tests/marketdata.mjs itself, so they follow lib's answers as they stand): one
  basis for liquidity and volume (GeckoTerminal's per-token figures), the A2 code check (the fake node answers the registry tokens'
  and WEEK's code, measured), DefiLlama's per-app dates, rolesRead, the lookalike's twin, no Robinhood logo on a Stock Token's row.
  That suite's world leaves AMC and AAPL out of GeckoTerminal's multi answer (so TSLA is among the 12 with the most liquidity) and
  adds a spoofed token of its own, which is left out of every file dumped.
  Rewritten again on 2026-10-28 after review two, by the same harness and switch: connectedBasis (where a token's connected
  tokens come from), the TVL figure's caveat, the job's own pool reads in the shared-pool volume, the chain's own casing of
  Ondo's and Anchored's symbols ("GOOGLon"), "listed, not proof" (proof: false) on an issuer-list item the chain has not agreed
  with, and the premium's reference worded as one token's price.
  An earlier change, the same in every file with Robinhood's sentences (tsla, tsla-registry-down, spy, week, gme, and
  tests/fixtures/market/rwa-token-0x322f…3b2d.json): issuerProfile.sentences is lib/rwa.js's ISSUER_TEXT.rhj as it now
  stands, where the custody sentence became two, each linking the page it comes from (the FAQ; the service-providers page
  that names Alpaca). tests/marketpage.mjs holds these files to lib's shapes, and the market copy's list to lib's text.

goplus-4663-tsla.json — GoPlus Security's token_security/4663 answer for TSLA, read 2026-10-28 with the site's honest
  User-Agent (the research read in the RWA build's detail.md §5); the result object is unchanged, in the wrapper the
  contractfacts fixtures use.

ds-pair-tsla.json — the deepest Robinhood Chain pool with TSLA as its base in Dexscreener's search for "TSLA", read
  2026-10-28 with the honest User-Agent; the pair object is unchanged.
