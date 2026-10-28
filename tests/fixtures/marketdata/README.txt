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
    as landscape.md §1.1 reports them, the role holders found to have no code); the fake answers nothing else;
  rwa-cg-lookalikes.json — CoinGecko coins/list?include_platform=true: the rows for the lookalike traps (GameStop 0x7e86…,
    Greatest Meme Ever, A Meme Coin, Advanced Micro Dog, BLACKROCK, Blockchain USD) and their namesakes, robinhood address only.
