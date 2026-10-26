Market Data fixtures (tests/marketdata.mjs). Every value here is one a source returned on 2026-10-26, read by the research
for the Market Data page with the honest User-Agent; rows were dropped to keep the files small, never invented:
  llama-*.json, stable-*.json, coins-mcaps.json — DefiLlama (api.llama.fi, stablecoins.llama.fi, coins.llama.fi), trimmed to
    the largest chains / protocols and to the fields the collectors read;
  l2beat-*.json — L2BEAT (l2beat.com/api/scaling/summary without badges and chart; activity for Robinhood Chain);
  gtp-*.json — growthepie (fundamentals.json: five chains, five metrics, 30 days; txcount for Robinhood Chain, daily only);
  gt-*.json — GeckoTerminal. gt-pools-eth-rekeyed.json and gt-new-pools-eth-rekeyed.json are Robinhood Chain answers with
    their ids re-keyed from robinhood_ to eth_, so the suite has a second network to read — a fake's input, never shown;
  ds-*.json — Dexscreener; cg-markets.json — CoinGecko keyless /coins/markets (30 rows);
  rpc-*.json — Robinhood Chain's public node (the state batch, real PairCreated / PoolCreated / Initialize logs, anchor
    blocks); eth-bridge.json — the canonical bridge read on Ethereum.
