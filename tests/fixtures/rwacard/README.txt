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

goplus-4663-tsla.json — GoPlus Security's token_security/4663 answer for TSLA, read 2026-10-28 with the site's honest
  User-Agent (the research read in the RWA build's detail.md §5); the result object is unchanged, in the wrapper the
  contractfacts fixtures use.

ds-pair-tsla.json — the deepest Robinhood Chain pool with TSLA as its base in Dexscreener's search for "TSLA", read
  2026-10-28 with the honest User-Agent; the pair object is unchanged.
