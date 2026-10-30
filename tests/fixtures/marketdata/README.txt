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
  llama-protocols.json also carries, since 2026-10-28, each row's DefiLlama slug (the same /protocols answer read on 2026-10-28
    for the RWA research) and ten non-DEX rows from that read (name, slug, category, Robinhood Chain TVL only) — the RWA job's
    choice of apps whose per-token deposits it reads.

RWA tab fixtures (tests/marketdata.mjs, the RWA section). Read on 2026-10-28 by the RWA research with the honest User-Agent;
rows and fields were dropped, never invented:
  rwa-rhj-assets.json — api.robinhood.com/rhj/assets: 20 of its 203 assets, every field as served (logoUrl included, so the
    suite can hold the parser to dropping it);
  rwa-rhj-prices.json — api.robinhood.com/rhj/prices: the two rows the research kept of its 203 (CRM, P) and the single
    /rhj/prices/TSLA answer's row, in /prices' own { quotes: [...] } shape;
  rwa-rhj-corporate-actions.json — /rhj/corporate-actions: the rows (of 36) for the 20 assets above;
  rwa-rhj-price-deviations.json — /rhj/price-deviations: the whole answer (SATS, WEEK, NAVN; asOf 2026-10-27);
  rwa-chainlink-feeds.json — reference-data-directory.vercel.app/feeds-robinhood-mainnet.json: the feeds for those assets, GLD,
    and three that are not Robinhood's (the parser drops them);
  rwa-llama-protocol-catch-exchange.json, rwa-llama-protocol-solon-stocks.json — api.llama.fi/protocol/<slug> as served, their
    Robinhood Chain series cut to the last entries; rwa-llama-protocol-morpho-blue.json, -grove-finance.json, -spark-savings.json
    — the same answers as the research kept them (the latest Robinhood Chain tokensInUsd entry only), in the answer's shape;
  rwa-llama-stablecoins.json — stablecoins.llama.fi/stablecoins?includePrices=true (read once for this fixture on 2026-10-28):
    the five assets circulating on Robinhood Chain and USDT, each with its Robinhood Chain (and, for USDT, Ethereum) circulation;
  rwa-gt-multi.json — GeckoTerminal /networks/robinhood/tokens/multi/<addresses>: the entries of the research's reads for the
    20 assets above, in the answer's { data: [...] } shape;
  rwa-gt-token-pools-tsla.json — GeckoTerminal /networks/robinhood/tokens/<TSLA>/pools?page=1, as served (20 pools);
  rwa-sourcify-abi-registry.json, rwa-sourcify-abi-stock.json — sourcify.dev/server/v2/contract/4663/<address>?fields=abi for
    Robinhood's AccessControlsRegistry and Stock.sol (exact match), the ABI only;
  rwa-rpc-registry-logs.json — Robinhood Chain's node: every log of the registry (276, address-filtered 10M-block windows);
  rwa-rpc-reads.json — what the research read from the chain, keyed for the suite's fake node (totalSupply, the beacon and
    implementation slots, implementation() on each beacon, the TSLA batch, WEEK's beacon and supply and the TSLA Chainlink feed
    as landscape.md §1.1 reports them, the role holders found to have no code) and, since the review of 2026-10-28, the runtime
    code of the 20 registry tokens here and WEEK (eth_getCode, one JSON-RPC batch to the public node at 18:30 UTC with the honest
    User-Agent: all 21 the same 283-byte BeaconProxy as the research's TSLA read) for the A2 code check; the fake answers nothing else;
  rwa-cg-lookalikes.json — CoinGecko coins/list?include_platform=true: the rows for the lookalike traps (GameStop 0x7e86…,
    Greatest Meme Ever, A Meme Coin, Advanced Micro Dog, BLACKROCK, Blockchain USD) and their namesakes, robinhood address only.

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
  mcap-lore-others.json — the "not found" wording's traps from the same reads: CoinGecko's rows for bittorrent (BTT) and
    xdce-crowd-sale (XDC, "XDC Network") from the /coins/markets answer above (its whole 199-coin answer, not the 32 here), and
    CoinLore's rows that are not under those symbols — "IOTA" as MIOTA (page start=100), "BitTorrent" as BTTC (start=1200) and
    "XinFin Network" as XDCE (start=0) — as its walk gave them, keyed by page.
  CoinPaprika's answers were measured for the comparison too, and are NOT here: its free plan is for personal use only, and
  passing its data on needs its Enterprise licence.

Market map fixtures (tests/marketdata.mjs, the market-map section; owner, 2026-10-30: the bubble map of the whole crypto
market). Read 2026-10-30 ~00:30 UTC with the honest User-Agent; rows were dropped, never invented:
  heatmap-cg-top100.json — CoinGecko keyless /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1
    &price_change_percentage=24h, the whole answer (100 coins; BTC $76,894, −5.27%; TRX +8.48%; HYPE +10.38%; BUIDL exactly 0%);
  heatmap-cg-global.json — CoinGecko /global, the whole answer (total market cap $2.593T, updated_at 00:29:50 UTC);
  heatmap-cg-stables.json — CoinGecko /coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=250,
    cut to its first 25 rows of 250: the 17 stablecoins among the top 100 (its first 17) and the 8 after them;
  heatmap-lore-top100.json — CoinLore /tickers/?start=0&limit=100, the whole answer (its first page has no LTC, LEO or WBT,
    and BNB as "Binance Coin": the check says so for each).
