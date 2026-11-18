ETH/USD history fixtures (tests/ethusd.mjs, lib/ethusd.js). These are measured chain answers from Robinhood Chain's public
node, https://rpc.mainnet.chain.robinhood.com. Nothing here was typed in: rows and fields were dropped to keep the files
small, never invented or edited.

sync-41300000-41599999.json, sync-116100000-116399999.json — eth_getLogs answers for the WETH/USDG pair
  0x8803c117ccae7b5146297876c2a25df135141c4d, topic Sync(uint112,uint112) 0x1c411e9a…bbad1. Read on 2026-11-18 at about
  00:58 UTC (2026-11-17 evening, local time) by the "$100 bought" review, with the site's honest User-Agent, as two
  1,000,000-block reads; kept unchanged in the review's scratchpad as rpc/sync_408.json (2,287 Syncs, blocks
  40,800,038–41,797,445) and rpc/sync_116.json (982 Syncs, blocks 116,010,042–116,999,839).
  Copied here on 2026-11-18:
    · only the Syncs in blocks 41,300,000–41,599,999 (845 of them: 30 whole cells, 21 blocks with two or three Syncs,
      every cell priced) and 116,100,000–116,399,999 (166: 30 whole cells, five with no Sync at all, six thin). Both
      slices lie strictly inside what the original read covered (its first and last Sync are outside them), so a cell
      with no Sync in these files had none on the chain;
    · each log keeps address, topics, data, blockNumber, transactionHash, logIndex, blockTimestamp and removed, in the
      node's own order and spelling; blockHash and transactionIndex were dropped. blockTimestamp is "0x0" in every log
      (the node does not fill it), which is why nothing may ever read a date from it;
    · the JSON-RPC wrapper (jsonrpc, id) is the original answer's; one log per line.

pair-facts.json — four eth_call reads asked on 2026-11-18 at 01:34:32 UTC of the same node, with the User-Agent
  "JustSendIt/1.0 (+https://sendrh.com)", by the WP1 build to check the pair's layout before relying on it. The
  questions are in "asked" and the node's answer, unchanged, in "answer":
    1  token0() of the pair                → WETH 0x0bd7d308f8e1639fab988df18a8011f41eacad73
    2  token1() of the pair                → USDG 0x5fc5360d0400a0fd4f2af552add042d716f1d168
    3  decimals() of USDG                  → 6
    4  the factory 0x8bceaa40…937f's getPair(WETH, USDG) → 0x8803c117ccae7b5146297876c2a25df135141c4d
  WETH's 18 decimals were not asked: it is the chain's WETH9, read at 18 everywhere in server.js, and the saved Syncs
  agree (57.56 WETH against 131,256.36 USDG is $2,280.23 per ETH).
