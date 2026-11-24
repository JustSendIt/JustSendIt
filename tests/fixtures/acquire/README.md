# Fixtures for tests/acquire.mjs (lib/acquire.js)

Every file here is **measured chain data**: answers of Robinhood Chain's public node
(`https://rpc.mainnet.chain.robinhood.com`, chain id 4663), read with the site's honest
User-Agent (`JustSendIt/1.0 (+https://sendrh.com)`). Nothing in them is made up. They are
public chain data and name no account, member or user id.

The node fills every log's `blockTimestamp` with `0x0`, so no file carries it and no test reads it.
Block times come from the server's persisted times (case-a) or are left out on purpose (taxed-buy).

## send-window.json

Every `$SEND` Transfer (837) and every Swap of the `$SEND`/WETH pool (207) in one window,
blocks 107,013,370–116,996,985 (the `transferQuery` and `swapQuery` fields are the exact
`eth_getLogs` requests). Read on 2026-11-17 by the "$100 bought" review (saved answers
`holdcost-rpc/r3.json` and `r5.json`). Each window is under the node's 10,000-log cap, so it is the
complete set for those blocks. The pool's Mint and Burn events were not read for this window.

Compact form (the same fields a raw log carries, nothing the engine reads is dropped):

- transfer: `[block, logIndex, txHash, from, to, value (hex)]`
- swap: `[block, logIndex, txHash, sender, to, amount0In, amount1In, amount0Out, amount1Out]` (hex)

## taxed-buy.json

The receipt of transaction `0x3de70b7a…ebca44` (`eth_getTransactionReceipt`, block 116,864,524): a
routed, taxed `$SEND` buy where the pool paid the `$SEND` contract 3,944.48 and the buyer
390,503.50. The logs are kept whole (`[address, block, logIndex, txHash, topics, data]`). The file
also holds the WETH/USDG pair's (`0x8803…1c4d`, token0 WETH) Syncs within 30,000 blocks of it
(`[block, logIndex, txHash, reserve0, reserve1]`), from the saved answer `holdcost/rpc/sync_116.json`.

## case-a (not in this repository)

One account's two linked wallets and every `$SEND`/`$GWC` move in or out of them, with the pools' Swaps of
those transactions and the WETH/USDG Syncs around its buys — measured answers, like the files here. It is one
member's real wallet history: a wallet, a transaction hash, a block or an exact amount from it leads straight back
to that member on a block explorer, and this repository is public. So it is kept in
`tests/fixtures/private/acquire-case-a.json` (gitignored) on the machine that built it, and `tests/acquire.mjs`
runs the case only where that file is (it prints a NOTE line, and counts none of its checks, where it is not).
