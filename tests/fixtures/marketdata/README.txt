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
The chain market caps' cross-check (2026-10-28; lib/chainmcap.js). Measured 2026-10-28 with the honest User-Agent; rows dropped
and fields trimmed to what the code reads, never a value changed:
  mcap-llama-chains.json — DefiLlama /v2/chains, ~15:30 UTC: 37 chains (the traps among them: Fantom, Mixin, PulseChain and Krown
    Network, whose CoinGecko market cap is 0; Morph, whose tokenSymbol is "-"; XRPL / XRPL EVM, IOTA / IOTA EVM and Ontology /
    OntologyEVM, which share one token; Beam, Mezo and MANTRA, whose token CoinGecko's asset platforms name differently);
  mcap-cg-markets.json — CoinGecko keyless /coins/markets?vs_currency=usd&per_page=250&ids=… for those chains' 32 tokens,
    15:29:50 UTC (stable-2's name "\u200b\u200bStable" carries two zero-width spaces, as CoinGecko gives it; icon's last_updated is 06:38);
  mcap-llama-mcaps.json — DefiLlama coins.llama.fi/mcaps for the same 32 tokens (its relay of CoinGecko's figure);
  mcap-cg-platforms.json — CoinGecko /asset_platforms: the 34 platforms these chains match by EVM chain id or name, and both
    platforms CoinGecko names "Sei Network" (the ambiguity trap);
  mcap-lore-tickers.json — CoinLore /tickers/?start=N&limit=100 for N = 0 … 1900 (pages 0–400 read ~15:30 UTC with the samples
    above, pages 500–1900 at 15:42–15:43 UTC by the build, 1.2 s apart), each page cut to the rows the suite needs and at least
    its first: the coins that match these chains' tokens, every coin sharing one of their symbols (both of CoinLore's "Beam"s —
    onbeam at $0.003362 and the older BEAM at $0.006579 — Blast at $0.000003, "Binance Coin"), Bubblemaps on two pages (its list
    shifted during the walk) and eCash (a measured figure 3.9% off its own price × supply);
  mcap-lore-ticker.json — CoinLore /ticker/?id=90,80,48543 (BTC, ETH, SOL), ~15:32 UTC: the per-run read's shape (the same rows
    as the walk's). The fake answers a /ticker/ read from the walk's rows.
  CoinPaprika's answers were measured for the comparison too, and are NOT here: its free plan is for personal use only, and
  passing its data on needs its Enterprise licence.
