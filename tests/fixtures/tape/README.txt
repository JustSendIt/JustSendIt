Coin tape fixtures (tests/tape.mjs, lib/tape.js). These are measured chain answers from Robinhood Chain's public node,
https://rpc.mainnet.chain.robinhood.com, read by the "$100 bought" review on 2026-11-17 (saved 19:59 local time, EST;
2026-11-18 about 00:59 UTC) and kept in that review's scratchpad as rpc/swap_send.json and rpc/rc1.json.
Copied here on 2026-11-17 byte for byte: nothing was dropped, edited or typed in.

swaps-send-pool.json — the eth_getLogs answer (the whole JSON-RPC reply) for the $SEND/WETH pool
  0xf30bb531d0255969be155533abac34b22bd63414, topic Swap(address,uint256,uint256,uint256,uint256,address)
  0xd78ad95f…9d822: 194 Swaps in 189 blocks, blocks 108,106,616–116,864,524. Every log carries blockTimestamp "0x0" — the
  node does not fill it in getLogs answers, which is why the tape never reads a date from a log.

receipt-3de70b.json — the eth_getTransactionReceipt answer for one $SEND buy,
  0x3de70b7a5a79458bf0003f9f69684c46ea1e233b4b8bfefc3d20a5e4acebca44 (block 116,864,524, the last Swap above): a router
  wraps 0.00697 ETH, pays the pool, and the pool sends 3,944.48 $SEND to the $SEND contract (its tax) and 390,503.50 $SEND
  to the buyer 0xc5e5…dd12; then the pool's Sync and Swap. Unlike the getLogs answer, this receipt's logs DO carry a
  blockTimestamp (0x6afcbb5d) — the field means different things in different answers, another reason never to read it.
  The suite's fake node uses that value only to anchor the block times it invents for its own eth_getBlockByNumber answers.

Hand-built in the suite, and said so there (no measured one is kept): the pool's Mints and Burns, $SEND Transfers other than
the receipt's two, and the dense and malformed logs that test refusals.

pool-check-send-pool.json — the batch answer (the whole JSON-RPC reply, three items) to the pool check lib/tape.js sends
  before a pool's first read, asked of the same node for the $SEND/WETH pool 0xf30bb531d0255969be155533abac34b22bd63414
  on 2026-11-18 at 02:31:20 UTC (read for this suite by the tape's fixer; kept in the review's scratchpad as
  rpc/poolkind/send-pool-probe.json, copied here byte for byte): factory() = 0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f
  (server.js FACTORY, the chain's Uniswap-v2-style factory); getReserves() = three words (two reserves and a time);
  slot0() = an error item {"code":3,"message":"execution reverted"} — what server.js rpcBatch hands over as null. That is
  how a v2 pair answers. The v3 pool, the address that is no pool, and the second v2 pool in the suite are hand-built
  (no measured v3 pool on this chain is kept), and said so where they are made.
