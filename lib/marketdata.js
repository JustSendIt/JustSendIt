'use strict';
/* ===== Market Data: every chain's public figures, collected and kept (owner, 2026-10-26) ===========================
   Owner's requests: a "Market Data" page with "a full dashboard of all of the chain's data as much as can be found publicly
   through free API keys … Robinhood being the default view", top chains and top tokens sortable by market cap, liquidity,
   TVL and volume over a chosen time frame; "make sure the token scanner and live new pair scanner is constantly caching data
   about everything on every chain … and have all that data be accessible through the Send API"; and the collected data
   visible on the admin page, public columns only.

   What is read, and from where (measured 2026-10-26 with this module's own User-Agent; no source needed a key):
     · DefiLlama (api.llama.fi, coins.llama.fi, stablecoins.llama.fi) — DeFi TVL, DEX volume, fees, stablecoins, open
       interest and DEX liquidity (TVL of the 'Dexs' protocols), for every chain it lists; which coin is each chain's own
       token (gecko_id) and its gas token; and its relay of CoinGecko's market caps (coins.llama.fi/mcaps), which stands in
       only when CoinGecko itself cannot be read and is never counted as a second source;
     · L2BEAT (l2beat.com/api) — Total Value Secured, stage and risks of the L2s and L3s, and their daily activity;
     · growthepie (api.growthepie.xyz / .com, CC BY 4.0) — daily transactions, active addresses, gas fees and the median
       transaction cost of the 27 chains it covers;
     · GeckoTerminal (api.geckoterminal.com) — the most-traded pools of a network (it sorts by 24 h volume only and stops at
       ten pages of twenty), new pools, a pool's candles;
     · Dexscreener (api.dexscreener.com) — a token's links and logo, and the name search (it cannot list a chain);
     · CoinGecko (api.coingecko.com, keyless) — the market cap of each chain's own token (one /coins/markets read of up to 250
       coins per chains run) and, daily, its asset platforms (which coin it names as a chain's native coin); never asked
       twice within two minutes ('cg_last');
     · CoinLore (api.coinlore.net, keyless, free and open "for developers … building crypto apps, dashboards, screeners") —
       the independent second market cap: its coin ids learned by a daily walk of its list (at most 20 pages), those coins
       read again every chains run, every call at least 1.1 s apart (it asks for about one a second). The rules that match
       its coins to CoinGecko's and cross-check the two are lib/chainmcap.js's. CoinPaprika is NOT read: its free plan is for
       personal use only, and showing its data needs its Enterprise licence;
     · Robinhood Chain's own node — block, block time, gas, the ArbGasInfo prices, WETH and USDG supply, what the v4
       PoolManager holds, and every pool created on the v2 factory, the v3 factory and the v4 PoolManager (address-filtered
       logs from a cursor kept in the database);
     · an Ethereum node (ethereum-rpc.publicnode.com) — the ETH the chain's canonical bridge holds on Ethereum, its batch and
       delayed-message counters;
     · for the RWA tab (owner, 2026-10-28; lib/rwa.js decides what counts): Robinhood's Stock Token API (api.robinhood.com/rhj —
       its registry, quotes, corporate actions and published price deviations), Chainlink's public feed directory for the chain
       (reference-data-directory.vercel.app), DefiLlama's per-app token deposits (/protocol/<slug>) and stablecoins, GeckoTerminal's
       multi-token read and a token's pools, and the chain itself in Multicall3 batches (supplies, pause flags, multipliers,
       beacon fingerprints, Chainlink feeds, the registry's role logs);
     · for the bubble map of the whole crypto market (owner, 2026-10-30; lib/marketmap.js has the rules): CoinGecko's 100 largest
       coins every 10 minutes, its /global total market cap every 30 minutes and its stablecoins category every 6 hours — every
       CoinGecko read through the same two-minute slot as the chains run's ('cg_last', cgSlot below) — and CoinLore's 100
       largest coins every run, the independent check of each market cap (lib/chainmcap.js's matchCoin and crossCheck).

   The rules every figure here follows (the contract of the page, the API and the admin browser):
     · nothing is estimated and shown as read: every figure is { v, src, at } and an unknown one is { v: null, why }, never 0;
     · nothing is fetched with a borrowed identity: one honest User-Agent ('JustSendIt/1.0 (+https://sendrh.com)'), at least
       30 s to answer, no redirects, a size cap; every call takes its host's outbound meter first (the server's OUTBOUND_RPM),
       and GeckoTerminal calls also take one of Market Data's two shares of the site's GeckoTerminal budget: the collectors'
       ('market:geckoterminal') or the one kept for a person opening a token ('market:geckoterminal-asked'), which the
       collectors never take from;
     · a DefiLlama point dated today is a partial day and is never stored as a day;
     · the chain node is read through the server's shared pace, and every chain job steps aside while the site's own reads
       are being refused or are queued (rpcBusy answers the reason).

   THE TABLES (public data only — nothing about a person, nothing encrypted; every one pages by id or at, newest first):
     mkt_runs        — one row per collector run: job, at, ok, ms, calls (outbound requests made), note. Kept 14 days.
     mkt_state       — small named values a collector carries between runs (cursors, the latest L2BEAT summary, DEX liquidity
                       by chain, the pool-list coverage, CoinLore's learned coin ids 'coinlore_ids', CoinGecko's asset
                       platforms 'cg_platforms'): name, value (JSON), at. The RWA job's: rhj_assets, rhj_prices, rhj_actions,
                       rhj_deviations (Robinhood's answers, each { readAt, data, failAt?, failWhy? } — a failed read keeps the last good
                       one), chainlink_rh (the feed directory), rwa_chain (per address: beacon fingerprint, supply, pause flags,
                       multipliers, names; the registry, the issuers' beacons, the feeds), rwa_tvl (DefiLlama's deposits per app),
                       rwa_protocols (the liquidity job's list of apps with a Robinhood Chain TVL), rwa_stables, rwa_gt (GeckoTerminal's
                       multi read), rwa_connected (each RWA's pools), rwa_seen (tokens the radar and the Scanner met, for lookalikes),
                       rhj_roles (the registry's role holders, blocked wallets, upgrades and pauses, with the log cursor). The bubble
                       map's 'heatmap': { coins, global, stables, lore } — CoinGecko's top 100, its total market cap, its stablecoin
                       ids and CoinLore's 100 largest coins, each part { readAt, …, failAt?, failWhy? } (a failed read keeps the
                       last good one, and says so).
     mkt_chain_snap  — one row per chain per chains run: chain (this site's key), name, chain_id, at, tvl, dex_vol_24h,
                       dex_vol_30d, fees_24h / fees_7d / fees_30d (the chain's own gas fees, DefiLlama's 'Chain' category),
                       app_fees_24h (fees paid to every app on the chain), stables, oi, dex_liq, mcap (the chain's own token:
                       CoinGecko's figure, else CoinLore's when it is the only one; null, never 0, when neither has one),
                       native_token (its CoinGecko id), native_symbol (CoinGecko's symbol), gas_token, tvs (L2BEAT), stage, is_l2,
                       src (JSON: per figure, its source and read time, or why it is missing), mcap_check (JSON: the market cap's
                       cross-check — the coin, status, each source's figure with its price, supply and read time, the notes,
                       the chain → token mapping check). Every run for 7 days, then one per UTC day.
     mkt_chain_series — (chain, metric, day) → value, src, at: daily history of tvl, dex_volume, fees (gas fees), app_fees,
                       stables, txcount, daa, txcost_median — DefiLlama, growthepie or L2BEAT, one source per chart.
     mkt_pool_snap   — GeckoTerminal's most-traded pools per tracked network, one batch per pools run: network, pool, at, rank,
                       base_addr / base_symbol / base_name / base_logo / base_gecko_id, quote_addr / quote_symbol, dex, name,
                       price_usd, reserve_usd, fdv_usd, mcap_usd (null when GeckoTerminal gives null or 0), vol_m5 / vol_h1 /
                       vol_h6 / vol_h24, tx_h24, buys_h24, sells_h24, chg_m5 / chg_h1 / chg_h6 / chg_h24, created_at. Every
                       batch 7 days; then Robinhood Chain's first batch of each hour to 90 days and the other networks' (read
                       hourly) first batch of each UTC day; past 90 days, the first batch of each UTC day. A batch is
                       served once its run has finished (the 'pools:<network>' state names it), never half-written.
     mkt_new_pool    — pools as they are created: chain, pool, dex ('v2' | 'v3' | 'v4' on Robinhood Chain, read from the
                       chain; GeckoTerminal's dex id elsewhere), token0, token1, block (Robinhood Chain) or created_at,
                       first_seen, extra (fee, tick spacing, hooks). Robinhood Chain's kept 30 days, the other networks' 7.
     mkt_rh_pulse    — Robinhood Chain, once a minute: at, block, block_ts, block_time_ms (the mean over the last hour, from
                       two stored block timestamps), gas_price_wei, base_fee_wei, l1_price_wei (ArbGasInfo's price per L1
                       calldata byte), min_gas_wei; every 10 minutes weth_supply, usdg_supply, pm_eth / pm_weth / pm_usdg
                       (held by the v4 PoolManager — includes claims and fees); every 15 minutes bridge_eth, bridge_batches,
                       bridge_msgs, l1_block (the canonical bridge, read on Ethereum); pools_created_v2/v3/v4 (pools created
                       in the blocks since the previous row, filled in once the new-pools cursor has passed them, and left
                       null where those blocks were not all read). Every row 2 days, then the first of each hour and that
                       hour's first rows with a supply and a bridge reading; a kept row takes on the pool counts of the rows
                       removed before it, so its count is still "since the row before" (null if any of theirs was null).
     mkt_scan        — every token scan (the Scanner, the Market Data page and the hourly re-scan): chain, address, at,
                       read_at, src ('scan' | 'market' | 'refresh'), n (scans folded into the row: the same token and source
                       in the same ten-minute slot of the clock is one row), kind, symbol, name, price_usd, mcap, fdv,
                       liquidity_usd, volume_24h, verdict, health, holders, risk (the flags that were set), json (the public
                       profile). 90 days, and the newest 100,000 rows at most; the full profile only on the newest 64 MB of
                       rows, and after a day only on each token's newest row.
     mkt_radar       — the New Pairs radar's pairs: pair, token, token0, token1, quote, quote_symbol, symbol, name,
                       created_block, created_at, price_usd, liquidity_usd, mcap, fdv, volume_24h, health, verdict, risk,
                       json (the newest 200 only), first_seen, updated_at. The radar's block cursor is in mkt_state. A row the
                       background sweep wrote has the pair's tokens, name and market figures as it read them, and no health,
                       verdict, flags or profile: only a member's sweep (the radar open) judges a pair.
   ================================================================================================================== */

const R = require('./rwa.js');                       // what counts as an RWA, on what evidence, and its figures (pure)
const { codeKind } = require('./multichain.js');     // eth_getCode → contract or wallet (an EIP-7702 delegation is a wallet)
const CM = require('./chainmcap.js');
const MM = require('./marketmap.js');                // the bubble map of the whole crypto market: its parsers, rows and legend (pure)
const HONEST_UA = 'JustSendIt/1.0 (+https://sendrh.com)';
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/* ----- small helpers ----- */
// a figure read from a feed: a number, or a numeric string; anything else is not read (null) — never 0
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string' || x.trim() === '') return null;
  const v = Number(x); return Number.isFinite(v) ? v : null;
};
const lc = (s) => String(s || '').toLowerCase();
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (d) => Date.parse(d + 'T00:00:00Z');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => typeof d === 'string' && DAY_RE.test(d) && Number.isFinite(dayStart(d)) && dayOf(dayStart(d)) === d;
const addDays = (d, n) => dayOf(dayStart(d) + n * DAY);
const EVM_RE = /^0x[0-9a-f]{40}$/i, POOL_ID_RE = /^0x[0-9a-f]{64}$/i, B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const hexInt = (h) => { if (typeof h !== 'string' || !/^0x[0-9a-f]+$/i.test(h)) return null; try { const b = BigInt(h); return b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : null; } catch { return null; } };
const hexBig = (h) => { if (typeof h !== 'string' || !/^0x[0-9a-f]*$/i.test(h) || h === '0x') return null; try { return BigInt(h); } catch { return null; } };
const units = (b, dec) => (b == null ? null : Number(b) / Math.pow(10, dec));
const word = (data, i) => { const d = String(data || '').replace(/^0x/, ''); return d.length >= (i + 1) * 64 ? '0x' + d.slice(i * 64, (i + 1) * 64) : null; };
const wordAddr = (w) => (w && w.length === 66 ? '0x' + w.slice(26).toLowerCase() : null);
const topicAddr = (t) => (typeof t === 'string' && t.length === 66 ? '0x' + t.slice(26).toLowerCase() : null);
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
// a reason cut to n characters at a word (never in the middle of one), its trailing commas and dashes dropped
const wordClip = (s, n) => { const t = String(s == null ? '' : s); if (t.length <= n) return t; const c = t.slice(0, n), i = c.lastIndexOf(' '); return (i > 0 ? c.slice(0, i) : c).replace(/[\s,;:—–-]+$/, ''); };
// GeckoTerminal sends names HTML-escaped ("S&amp;P"): decoded once here (as the token-name search does), escaped once by the page
const unEntity = (v) => String(v || '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|#39));/gi, (m, d, h, n) => d ? String.fromCodePoint(Math.min(0x10ffff, +d)) : h ? String.fromCodePoint(Math.min(0x10ffff, parseInt(h, 16))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[n.toLowerCase()]);
const gtext = (s, n) => (s == null ? null : clip(unEntity(s), n));
const safeParse = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch { return d; } };
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
/* every number at the leaves of a DefiLlama breakdown ({ chain: { 'Curve DEX': 541435, … } }) */
const leafSum = (o) => { if (typeof o === 'number') return Number.isFinite(o) ? o : 0; if (!o || typeof o !== 'object') return 0; let s = 0; for (const k of Object.keys(o)) s += leafSum(o[k]); return s; };
/* A figure: what the API serves for every number — its value, where it came from and when, and why it is missing when it is. */
function fig(v, src, at, extra) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
  const o = { v: n, src: src || 'site', at: at || null };
  if (extra) Object.assign(o, extra);
  if (n == null && !o.why) o.why = 'not read';
  if (n != null) delete o.why;
  return o;
}
const none = (why, src, at, extra) => Object.assign({ v: null, src: src || 'site', at: at || null, why }, extra || {});

/* ===== Which chain is which, in every source =====================================================================
   The same chain has a different name in each source (measured 2026-10-26): DefiLlama's display name, the key its DEX and
   fee breakdowns use, the name its /protocols chainTvls use, L2BEAT's slug, growthepie's origin key, GeckoTerminal's
   network id, Dexscreener's chain id. The site's own key is the left column. A chain not in this table gets a key made from
   its DefiLlama name and is matched in the other sources by name (exactly, ignoring case) — never by a guess. */
const CHAIN_TABLE = [
  // key          DefiLlama name      breakdown key  protocols name     L2BEAT slug     growthepie     GT network     Dexscreener   CoinGecko platform
  ['robinhood',  'Robinhood Chain',   'robinhood',   'Robinhood Chain', 'robinhood',    'robinhood',   'robinhood',   'robinhood',  'robinhood'],
  ['ethereum',   'Ethereum',          'ethereum',    'Ethereum',        null,           'ethereum',    'eth',         'ethereum',   'ethereum'],
  ['solana',     'Solana',            'solana',      'Solana',          null,           null,          'solana',      'solana',     'solana'],
  ['base',       'Base',              'base',        'Base',            'base',         'base',        'base',        'base',       'base'],
  ['bsc',        'BSC',               'bsc',         'Binance',         null,           null,          'bsc',         'bsc',        'binance-smart-chain'],
  ['arbitrum',   'Arbitrum',          'arbitrum',    'Arbitrum',        'arbitrum',     'arbitrum',    'arbitrum',    'arbitrum',   'arbitrum-one'],
  ['polygon',    'Polygon',           'polygon',     'Polygon',         'polygon-pos',  'polygon_pos', 'polygon_pos', 'polygon',    'polygon-pos'],
  ['avalanche',  'Avalanche',         'avax',        'Avalanche',       null,           null,          'avax',        'avalanche',  'avalanche'],
  ['optimism',   'OP Mainnet',        'optimism',    'Optimism',        'optimism',     'optimism',    'optimism',    'optimism',   'optimistic-ethereum'],
  ['tron',       'Tron',              'tron',        'Tron',            null,           null,          null,          'tron',       'tron'],
  ['bitcoin',    'Bitcoin',           'bitcoin',     'Bitcoin',         null,           null,          null,          null,         null],
  ['hyperliquid','Hyperliquid L1',    'hyperliquid', 'Hyperliquid L1',  null,           null,          null,          'hyperliquid', null],
  ['sui',        'Sui',               'sui',         'Sui',             null,           null,          null,          'sui',        'sui'],
  ['gnosis',     'Gnosis',            'xdai',        'xDai',            'gnosis',       null,          null,          null,         'xdai'],
  ['zksync-era', 'zkSync Era',        'era',         'zkSync Era',      'zksync2',      'zksync_era',  null,          null,         'zksync'],
  ['mantle',     'Mantle',            'mantle',      'Mantle',          'mantle',       'mantle',      null,          null,         'mantle'],
  ['linea',      'Linea',             'linea',       'Linea',           'linea',        'linea',       null,          null,         'linea'],
  ['scroll',     'Scroll',            'scroll',      'Scroll',          'scroll',       'scroll',      null,          null,         'scroll'],
  ['ronin',      'Ronin',             'ronin',       'Ronin',           'roninnetwork', 'ronin',       null,          null,         'ronin'],
  ['xlayer',     'X Layer',           'xlayer',      'X Layer',         'xlayer',       null,          null,          null,         'x-layer'],
  ['worldchain', 'World Chain',       'wc',          'World Chain',     'worldchain',   'worldchain',  null,          null,         'world-chain'],
  ['plume',      'Plume Mainnet',     'plume_mainnet', 'Plume Mainnet', 'plumenetwork', 'plume',       null,          null,         null],
  ['manta',      'Manta',             'manta',       'Manta',           'mantapacific', 'manta',       null,          null,         'manta-pacific'],
];
const COLS = ['key', 'llama', 'bk', 'proto', 'l2beat', 'gtp', 'gt', 'ds', 'cg'];
const CHAIN_BY_KEY = new Map(), CHAIN_BY_LLAMA = new Map();
for (const r of CHAIN_TABLE) { const o = {}; COLS.forEach((c, i) => { o[c] = r[i]; }); CHAIN_BY_KEY.set(o.key, o); CHAIN_BY_LLAMA.set(lc(o.llama), o); }
const slugKey = (name) => lc(name).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || null;
/* the chain's entry, from its DefiLlama name: the table's when it is there, else one made from the name */
function chainOfLlama(name) {
  const hit = CHAIN_BY_LLAMA.get(lc(name));
  if (hit) return hit;
  const key = slugKey(name);
  if (!key || CHAIN_BY_KEY.has(key)) return null;   // a made-up key never shadows one of the table's
  return { key, llama: String(name), bk: null, proto: String(name), l2beat: null, gtp: null, gt: null, ds: null, cg: null, derived: true };
}
// the networks whose pools are read from GeckoTerminal: Robinhood Chain every 10 minutes (ten pages), the others hourly (three)
const GT_TRACKED = ['robinhood', 'ethereum', 'solana', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism'];
const GT_PAGES = { robinhood: 10 };
const SCAN_CHAINS = ['robinhood', 'ethereum', 'solana'];   // the chains the Scanner reads (lib/multichain.js)
const chainOfGt = (net) => { for (const c of CHAIN_BY_KEY.values()) if (c.gt === net) return c; return null; };
const chainOfDs = (id) => { for (const c of CHAIN_BY_KEY.values()) if (c.ds === id) return c; return null; };
// a DefiLlama /protocols chainTvls key that is not a chain
const NOT_A_CHAIN = new Set(['borrowed', 'staking', 'pool2', 'offers', 'treasury', 'vesting', 'doublecounted', 'liquidstaking', 'dcandlsoverlap', 'ownTokens'.toLowerCase()]);

/* ----- Robinhood Chain and its bridge: the contracts this module reads (docs.robinhood.com/chain/protocol-contracts; the
   v3 factory and the PoolManager were read from the chain on 2026-10-26, not confirmed as official Uniswap deployments) ----- */
const RH = {
  v2Factory: '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', v2Topic: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',   // PairCreated(address,address,address,uint256)
  v3Factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', v3Topic: '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',   // PoolCreated(address,address,uint24,int24,address)
  poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951', v4Topic: '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',   // Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', usdg: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', usdgDecimals: 6,
  arbGasInfo: '0x000000000000000000000000000000000000006c', getPricesInWei: '0x41b247a8', getMinimumGasPrice: '0xf918379a',
};
const L1 = { bridge: '0xdf8755334ce7a73ccf6b581c02ea649ae3e864b3', sequencerInbox: '0xbd0d173eeb87d57a09521c24388a12789f33ba96', batchCount: '0x06f13056', delayedMessageCount: '0xeca067ad' };
const BLOCKS_PER_DAY_CEIL = 900000;     // the first new-pools read goes this far back (the chain made ~829,000 blocks a day on 2026-10-26)
const NEWPOOL_MAX_GAP = 2500000;        // a cursor further behind than this (about three days) is not walked: the gap is recorded instead
const LOG_SPLIT_FLOOR = 2000;           // an address-filtered log read is halved on a refusal, down to this many blocks
/* ----- the chain market caps' budgets (lib/chainmcap.js has the rules) ----- */
const CG_PER_CALL = 250;     // CoinGecko's /coins/markets answers at most 250 coins a page: one read per chains run, never two
const LORE_GAP_MS = 1100;    // CoinLore asks for about one request a second: every call at least 1.1 s after the one before
const LORE_WALK_MAX = 20;    // the daily walk of CoinLore's list: at most 20 pages of 100 (its 2,000 largest coins)
const LORE_PER_CALL = 50;    // a chains run reads its learned CoinLore coins again, at most 50 ids a call (the URL stays short)
const okGecko = (x) => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x);

/* ----- the logo hosts the image proxy may fetch from (exact names, https only) ----- */
const LOGO_HOSTS = new Set(['cdn.dexscreener.com', 'dd.dexscreener.com', 'coin-images.coingecko.com', 'assets.geckoterminal.com', 'icons.llama.fi', 'icons.llamao.fi']);
function logoAllowed(u) {
  if (typeof u !== 'string' || u.length > 600 || /["'<>\s\\]/.test(u)) return false;
  let x; try { x = new URL(u); } catch { return false; }
  return x.protocol === 'https:' && !x.username && !x.password && !x.port && LOGO_HOSTS.has(x.hostname);
}
const logoPath = (u) => (logoAllowed(u) ? '/api/market/logo?u=' + encodeURIComponent(u) : null);
// DefiLlama's feeds still name chain icons at icons.llamao.fi/chains/…, which answers 404 since the files moved under /icons/chains/
// (measured 2026-10-27, every chain): mended on the way in, and an address stored before that on the way out
const llamaIcon = (u) => (typeof u === 'string' ? u.split('https://icons.llamao.fi/chains/').join('https://icons.llamao.fi/icons/chains/') : u);
// magic bytes: only still or animated rasters, never SVG (a script container wearing an image's name)
function imageTypeOf(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  const h6 = buf.slice(0, 6).toString('latin1'); if (h6 === 'GIF89a' || h6 === 'GIF87a') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/* ===== The honest fetch ==========================================================================================
   The module's only way out: a truthful User-Agent, at least 30 s to answer (5 of 15 GeckoTerminal answers took more than
   8 s on 2026-10-26, one 20.9 s), no redirect followed, and a cap on what is read. "Could not ask" (a refusal, a timeout, a
   body too large) and "the source answered" stay apart: { ok, status, data, reason }. */
async function readCapped(res, max, ac) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len && len > max) { try { ac.abort(); } catch {} return null; }
  if (!res.body || typeof res.body.getReader !== 'function') { const b = Buffer.from(await res.arrayBuffer()); return b.length > max ? null : b; }
  const reader = res.body.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch {} return null; }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}
function createHonestFetch(opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const ua = opts.userAgent || HONEST_UA;
  async function fetchJson(url, o = {}) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), Math.max(30000, Number(o.timeoutMs) || 30000));
    try {
      const headers = Object.assign({ 'User-Agent': ua, Accept: 'application/json' }, o.headers || {});
      if (o.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetchImpl(url, { method: o.method || (o.body !== undefined ? 'POST' : 'GET'), headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined, signal: ac.signal, redirect: 'error' });
      if (!res.ok) { try { await res.arrayBuffer(); } catch {} return { ok: false, status: res.status, data: null, reason: res.status === 429 ? 'rate-limited' : 'upstream ' + res.status }; }
      const buf = await readCapped(res, Number(o.maxBytes) || 8 * 1024 * 1024, ac);
      if (!buf) return { ok: false, status: res.status, data: null, reason: 'answer too large' };
      let data; try { data = JSON.parse(buf.toString('utf8')); } catch { return { ok: false, status: res.status, data: null, reason: 'not JSON' }; }
      return { ok: true, status: res.status, data, reason: null };
    } catch (e) {
      return { ok: false, status: 0, data: null, reason: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' };
    } finally { clearTimeout(tm); }
  }
  async function fetchImage(url, o = {}) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), Math.max(30000, Number(o.timeoutMs) || 30000));
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': ua, Accept: 'image/*' }, signal: ac.signal, redirect: 'error' });
      if (!res.ok) { try { await res.arrayBuffer(); } catch {} return { ok: false, status: res.status, reason: 'upstream ' + res.status }; }
      const buf = await readCapped(res, Number(o.maxBytes) || 2 * 1024 * 1024, ac);
      if (!buf) return { ok: false, status: 413, reason: 'image too large' };
      const type = imageTypeOf(buf);
      if (!type) return { ok: false, status: 415, reason: 'not an image' };
      return { ok: true, status: 200, buf, type };
    } catch (e) {
      return { ok: false, status: 502, reason: e && e.name === 'AbortError' ? 'timed out' : 'unreachable' };
    } finally { clearTimeout(tm); }
  }
  return { fetchJson, fetchImage };
}

/* ===== The tables ===== */
function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS mkt_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, ms INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_mkt_runs_job ON mkt_runs(job, id);
CREATE INDEX IF NOT EXISTS idx_mkt_runs_at ON mkt_runs(at);
CREATE TABLE IF NOT EXISTS mkt_state (
  name TEXT PRIMARY KEY, value TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mkt_chain_snap (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL, name TEXT, chain_id INTEGER, at INTEGER NOT NULL,
  tvl REAL, dex_vol_24h REAL, dex_vol_30d REAL, fees_24h REAL, fees_7d REAL, fees_30d REAL, app_fees_24h REAL,
  stables REAL, oi REAL, dex_liq REAL, mcap REAL, native_token TEXT, native_symbol TEXT, gas_token TEXT,
  tvs REAL, stage TEXT, is_l2 INTEGER, logo TEXT, src TEXT, mcap_check TEXT
);
CREATE INDEX IF NOT EXISTS idx_mkt_chain_snap_at ON mkt_chain_snap(at);
CREATE INDEX IF NOT EXISTS idx_mkt_chain_snap_chain ON mkt_chain_snap(chain, at);
CREATE TABLE IF NOT EXISTS mkt_chain_series (
  chain TEXT NOT NULL, metric TEXT NOT NULL, day TEXT NOT NULL, value REAL, src TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (chain, metric, day)
);
CREATE INDEX IF NOT EXISTS idx_mkt_chain_series_at ON mkt_chain_series(at);
CREATE TABLE IF NOT EXISTS mkt_pool_snap (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network TEXT NOT NULL, pool TEXT NOT NULL, at INTEGER NOT NULL, rank INTEGER,
  base_addr TEXT, base_symbol TEXT, base_name TEXT, base_logo TEXT, base_gecko_id TEXT, quote_addr TEXT, quote_symbol TEXT, dex TEXT, name TEXT,
  price_usd REAL, reserve_usd REAL, fdv_usd REAL, mcap_usd REAL,
  vol_m5 REAL, vol_h1 REAL, vol_h6 REAL, vol_h24 REAL, tx_h24 INTEGER, buys_h24 INTEGER, sells_h24 INTEGER,
  chg_m5 REAL, chg_h1 REAL, chg_h6 REAL, chg_h24 REAL, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mkt_pool_snap_net ON mkt_pool_snap(network, at);
CREATE INDEX IF NOT EXISTS idx_mkt_pool_snap_base ON mkt_pool_snap(base_addr, network, at);
CREATE INDEX IF NOT EXISTS idx_mkt_pool_snap_at ON mkt_pool_snap(at);
-- the Send API pages a network's or a pool's rows newest first: without these SQLite sorted every row of the network (0.8 s at retention)
CREATE INDEX IF NOT EXISTS idx_mkt_pool_snap_net_id ON mkt_pool_snap(network, id);
CREATE INDEX IF NOT EXISTS idx_mkt_pool_snap_pool ON mkt_pool_snap(pool, id);
CREATE TABLE IF NOT EXISTS mkt_new_pool (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT NOT NULL, pool TEXT NOT NULL, dex TEXT, token0 TEXT, token1 TEXT, block INTEGER, created_at INTEGER, first_seen INTEGER NOT NULL, extra TEXT,
  UNIQUE (chain, pool)
);
CREATE INDEX IF NOT EXISTS idx_mkt_new_pool_chain ON mkt_new_pool(chain, id);
CREATE INDEX IF NOT EXISTS idx_mkt_new_pool_block ON mkt_new_pool(chain, block);
CREATE INDEX IF NOT EXISTS idx_mkt_new_pool_seen ON mkt_new_pool(first_seen);
CREATE TABLE IF NOT EXISTS mkt_rh_pulse (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, block INTEGER, block_ts INTEGER, block_time_ms REAL,
  gas_price_wei INTEGER, base_fee_wei INTEGER, l1_price_wei INTEGER, min_gas_wei INTEGER,
  weth_supply REAL, usdg_supply REAL, pm_eth REAL, pm_weth REAL, pm_usdg REAL,
  bridge_eth REAL, bridge_batches INTEGER, bridge_msgs INTEGER, l1_block INTEGER,
  pools_created_v2 INTEGER, pools_created_v3 INTEGER, pools_created_v4 INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mkt_rh_pulse_at ON mkt_rh_pulse(at);
CREATE TABLE IF NOT EXISTS mkt_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chain TEXT NOT NULL, address TEXT NOT NULL, at INTEGER NOT NULL, read_at INTEGER, src TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1,
  kind TEXT, symbol TEXT, name TEXT, price_usd REAL, mcap REAL, fdv REAL, liquidity_usd REAL, volume_24h REAL, verdict TEXT, health INTEGER, holders INTEGER, risk TEXT, json TEXT
);
-- by id, not at: the Send API and scanPut read a chain's or a token's rows newest first (the (chain, address, at) index made them sort)
DROP INDEX IF EXISTS idx_mkt_scan_tok;
CREATE INDEX IF NOT EXISTS idx_mkt_scan_tok_id ON mkt_scan(chain, address, id);
CREATE INDEX IF NOT EXISTS idx_mkt_scan_chain ON mkt_scan(chain, id);
CREATE INDEX IF NOT EXISTS idx_mkt_scan_at ON mkt_scan(at);
CREATE TABLE IF NOT EXISTS mkt_radar (
  id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL UNIQUE, token TEXT, token0 TEXT, token1 TEXT, quote TEXT, quote_symbol TEXT, symbol TEXT, name TEXT,
  created_block INTEGER, created_at INTEGER, price_usd REAL, liquidity_usd REAL, mcap REAL, fdv REAL, volume_24h REAL, health INTEGER, verdict TEXT, risk TEXT, json TEXT,
  first_seen INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_radar_upd ON mkt_radar(updated_at);
`);
  // a column added after the table: a database made before it gets it here, before anything reads or writes it (already there: no-op)
  try { db.exec('ALTER TABLE mkt_chain_snap ADD COLUMN mcap_check TEXT'); } catch {}
}
const TABLES = ['mkt_chain_snap', 'mkt_chain_series', 'mkt_pool_snap', 'mkt_new_pool', 'mkt_rh_pulse', 'mkt_scan', 'mkt_radar', 'mkt_runs', 'mkt_state'];
const TABLE_TIME = { mkt_chain_snap: 'at', mkt_chain_series: 'at', mkt_pool_snap: 'at', mkt_new_pool: 'first_seen', mkt_rh_pulse: 'at', mkt_scan: 'at', mkt_radar: 'updated_at', mkt_runs: 'at', mkt_state: 'at' };

/* ===== The collectors' timetable ==================================================================================
   every: how often; first: the stagger after boot (times MARKET_STAGGER_MS / 1000, so a test can run them at once). A job
   picks up where the database says it left off — a restart does not re-read what was read twenty minutes ago. */
/* retry: how soon a failed run is tried again — never sooner than the source refreshes (DefiLlama's answers are CDN-cached for
   30 minutes, so asking it again sooner gains nothing) and never later than the job's own cadence */
/* align: the job runs on the clock (just after each whole hour) instead of `every` after its last run ended. The other
   networks' pools need it: a custom token window there takes each day's first batch, which must land in the day's first hour,
   and a run that starts `every` after the last one finished (24 page reads, several minutes) drifts through the hour. */
const JOBS = {
  pulse:      { every: MIN,        first: 15, retry: MIN,      title: 'Robinhood Chain pulse (block, gas; supplies every 10 min; the bridge every 15 min)' },
  chains:     { every: 30 * MIN,   first: 25, retry: 30 * MIN, title: 'Chains: TVL, DEX volume, fees, stablecoins, open interest (DefiLlama + L2BEAT); own-token market caps (CoinGecko, checked against CoinLore)' },
  // every 10 min: the radar's walk of the factory's logs (two node reads on Market Data's chain share) and one Dexscreener read per 30 pairs
  radar:      { every: 10 * MIN,   first: 35, retry: 5 * MIN,  title: 'New Pairs radar: the new pairs and their market figures (a member\'s sweep judges them)' },
  l2beat:     { every: HOUR,       first: 45, retry: 15 * MIN, title: 'L2BEAT summary: TVS, stage, risks' },
  pools:      { every: 10 * MIN,   first: 55, retry: 5 * MIN,  title: 'Robinhood Chain pools (GeckoTerminal, 10 pages)' },
  newPoolsRh: { every: 3 * MIN,    first: 70, retry: 3 * MIN,  title: 'Robinhood Chain new pools (v2, v3, v4 logs from the chain)' },
  poolsOther: { every: HOUR,       first: 100, retry: 15 * MIN, align: HOUR, title: 'Other networks\' pools (GeckoTerminal, 3 pages each)' },
  prune:      { every: HOUR,       first: 120, retry: 15 * MIN, title: 'Pruning to the retention rules' },
  newPoolsGt: { every: 15 * MIN,   first: 140, retry: 15 * MIN, title: 'Other networks\' new pools (GeckoTerminal)' },
  growthepie: { every: DAY,        first: 165, retry: HOUR,     title: 'growthepie fundamentals (daily)' },
  liquidity:  { every: 3 * HOUR,   first: 190, retry: 30 * MIN, title: 'DEX liquidity by chain (DefiLlama protocols)' },
  series:     { every: 6 * HOUR,   first: 240, retry: 30 * MIN, title: 'Chain histories (top 40 by TVL + Robinhood Chain)' },
  // daily, after the chains run has read CoinGecko's coins (and never within two minutes of another CoinGecko read)
  mcapRefs:   { every: DAY,        first: 215, retry: HOUR,     title: 'Chain market caps\' references: CoinLore\'s coin ids (a walk of its list) and CoinGecko\'s asset platforms (daily)' },
  // every 10 min, first just after the chains run (whose CoinGecko read it waits behind): CoinGecko's top 100 every run, its total
  // market cap every 30 min, its stablecoins category every 6 h — each in CoinGecko's two-minute slot — and CoinLore's top 100
  heatmap:    { every: 10 * MIN,   first: 30, retry: 10 * MIN, title: 'The whole crypto market\'s bubble map: CoinGecko\'s top 100 coins, total market cap and stablecoins, checked against CoinLore' },
  scans:      { every: HOUR,       first: 300, retry: 15 * MIN, title: 'Re-scan of the 40 most-scanned tokens of the last 7 days (Ethereum and Solana read again; Robinhood Chain from the token cache)' },
  // every 30 min, each part only when due: Robinhood's quotes every run; its registry, corporate actions and deviations, stablecoins,
  // DeFi deposits and each RWA's pools every 6 h; Chainlink's directory, the fingerprints' re-check and the role logs daily
  rwa:        { every: 30 * MIN,   first: 210, retry: 15 * MIN, title: 'Robinhood Chain RWAs (Robinhood\'s registry and quotes, the chain, Chainlink, DefiLlama, GeckoTerminal)' },
};
const retryOf = (job) => Math.min(JOBS[job].every, JOBS[job].retry || 5 * MIN);
const ALIGN_SLACK = 5000;   // an aligned run starts this long after the clock turns (a timer is never early, the wall clock can be)
// when a job that ran (or should have run) at `from` is next due: `every` later, or the next turn of its clock
const nextDue = (job, from) => (JOBS[job].align ? (Math.floor(from / JOBS[job].align) + 1) * JOBS[job].align + ALIGN_SLACK : from + JOBS[job].every);

function createMarketData(deps = {}) {
  const db = deps.db;
  if (!db) throw new Error('createMarketData needs a database');
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const take = deps.outboundTake || (() => Promise.resolve());
  const http = deps.fetchJson ? { fetchJson: deps.fetchJson, fetchImage: deps.fetchImage } : createHonestFetch();
  const rpcBatch = deps.rpcBatch || null;
  const rpcBusy = deps.rpcBusy || (() => false);
  const BG_WAIT = deps.bgWaitMs != null ? deps.bgWaitMs : 120000;   // a collector waits its turn on the meter for up to this long
  const ASK_WAIT = deps.askWaitMs != null ? deps.askWaitMs : 8000;  // a person waiting on a read: this long, then "try again shortly"
  const sleep = deps.sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));   // CoinLore's pace, and a chains run waiting out CoinGecko's two minutes (a test passes one that only records)
  const urls = Object.assign({
    llama: 'https://api.llama.fi', coins: 'https://coins.llama.fi', stables: 'https://stablecoins.llama.fi',
    l2beat: 'https://l2beat.com/api', growthepie: 'https://api.growthepie.xyz/v1', growthepieMetrics: 'https://api.growthepie.com/v1',
    gt: 'https://api.geckoterminal.com/api/v2', ds: 'https://api.dexscreener.com', cg: 'https://api.coingecko.com/api/v3',
    ethRpc: 'https://ethereum-rpc.publicnode.com', coinlore: 'https://api.coinlore.net/api',
    rhj: 'https://api.robinhood.com/rhj', chainlink: 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json',
  }, deps.urls || {});
  for (const k of Object.keys(urls)) urls[k] = String(urls[k]).replace(/\/+$/, '');
  const hooks = { radarSweep: deps.radarSweep || null, scanRefresh: deps.scanRefresh || null };
  /* what the server's own background reads (the radar's sweep, the re-scan) go out through: this module's honest fetch and meters and
     its chain share, counted on the run that made them (a read the hook makes on the node one call at a time, it counts with counted()) */
  const bgTools = (ctx) => ({ ask: (url, o) => ask(ctx, url, o), rpc: (calls) => rpcAsk(ctx, calls), counted: () => { ctx.calls++; } });
  const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
  /* Two shares of the site's GeckoTerminal budget: the collectors' (their pages queue on it for up to BG_WAIT), and one kept for
     a person opening a token, which the collectors never take from. A person's read may also take a slot of the collectors'
     share when one is free right now — never the other way round, and never by waiting behind their queue. */
  const GT_SHARE = 'market:geckoterminal', GT_ASKED = 'market:geckoterminal-asked', RPC_SHARE = 'market:rpc';

  /* ----- one outbound read, metered: the share first (GeckoTerminal), then the host. A spent meter is "could not ask". ----- */
  async function ask(ctx, url, o = {}) {
    const wait = o.wait != null ? o.wait : BG_WAIT;
    try {
      if (o.share) await takeShare([].concat(o.share), wait);
      const h = hostOf(url); if (h) await take(h, wait);
    } catch { return { ok: false, status: 0, data: null, reason: 'budget' }; }
    if (ctx) ctx.calls++;
    return http.fetchJson(url, { method: o.method, body: o.body, maxBytes: o.maxBytes, timeoutMs: o.timeoutMs, headers: o.headers });
  }
  // the shares in order: the first that can give a slot within the wait does (the meter refuses at once when it cannot)
  async function takeShare(shares, wait) {
    for (let i = 0; i < shares.length; i++) {
      try { return await take(shares[i], wait); } catch (e) { if (i === shares.length - 1) throw e; }
    }
  }
  // a free CoinGecko Demo key, when the operator has one (COINGECKO_DEMO_KEY): sent as its documented header, never in a URL
  const cgHeaders = deps.cgDemoKey ? { 'x-cg-demo-api-key': String(deps.cgDemoKey) } : undefined;
  const gtAsk = (ctx, path, o = {}) => ask(ctx, urls.gt + path, Object.assign({ share: GT_SHARE }, o));
  // a person is waiting: their own share first, then a free slot of the collectors', at most ASK_WAIT on each
  const gtAskNow = (path, o = {}) => ask(null, urls.gt + path, Object.assign({ share: [GT_ASKED, GT_SHARE], wait: ASK_WAIT }, o));
  /* the chain node, through the server's paced batch; a refusal (it throws) cools Market Data's chain jobs for 5 minutes */
  let rpcCoolUntil = 0;
  async function rpcAsk(ctx, calls) {
    if (!rpcBatch) throw new Error('no chain reader');
    if (now() < rpcCoolUntil) throw Object.assign(new Error('cooling down after the node refused a read'), { yielded: true });
    const busy = rpcBusy();
    if (busy) throw Object.assign(new Error('yielded: ' + (typeof busy === 'string' ? busy : 'the site\'s own chain reads come first')), { yielded: true });
    try { await take(RPC_SHARE, BG_WAIT); } catch { throw Object.assign(new Error('the Market Data chain budget is spent'), { yielded: true }); }
    if (ctx) ctx.calls++;
    try { return await rpcBatch(calls); }
    catch (e) { if (/429|403|too many|rate.?limit|capacity|refus/i.test(String((e && e.message) || e))) rpcCoolUntil = now() + 5 * MIN; throw e; }
  }
  /* an Ethereum node: one JSON-RPC batch over the honest fetch */
  async function ethAsk(ctx, calls) {
    const r = await ask(ctx, urls.ethRpc, { body: calls.map(([m, p], i) => ({ jsonrpc: '2.0', id: i, method: m, params: p })), maxBytes: 256 * 1024 });
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, reason: r.ok ? 'the node did not answer a batch' : r.reason, out: null };
    const out = new Array(calls.length).fill(null);
    for (const x of r.data) if (x && Number.isInteger(x.id) && x.id >= 0 && x.id < calls.length && !x.error) out[x.id] = x.result;
    return { ok: true, out };
  }
  /* CoinLore asks for about one request a second: every call waits until LORE_GAP_MS after the one before (its host meter,
     'api.coinlore.net', is the ceiling on top). The slot is taken BEFORE the wait, so two jobs asking at once (the chains run
     during the daily walk — each job has its own timer) queue one behind the other instead of both sleeping the same gap. */
  let loreLast = -Infinity;
  async function loreAsk(ctx, path) {
    const slot = Math.max(now(), loreLast + LORE_GAP_MS);
    loreLast = slot;
    const wait = slot - now();
    if (wait > 0) await sleep(wait);
    return ask(ctx, urls.coinlore + path, { maxBytes: 1024 * 1024 });
  }

  /* ----- named state ----- */
  const stGet = (name) => { try { const r = db.prepare('SELECT value, at FROM mkt_state WHERE name = ?').get(name); return r ? { v: safeParse(r.value, null), at: r.at } : null; } catch { return null; } };
  const stSet = (name, v, at) => { db.prepare('INSERT INTO mkt_state (name, value, at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, at = excluded.at').run(name, JSON.stringify(v), at != null ? at : now()); };
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } };
  let dataVer = 0;   // bumped by every write here; the answers below are memoised against it (and against mkt_runs, for writes from another process)
  const verNow = () => { let m = 0; try { m = db.prepare('SELECT MAX(id) m FROM mkt_runs').get().m || 0; } catch {} return dataVer + ':' + m; };
  const memo = new Map();
  function memoize(key, ttl, fn) {
    const v = verNow(), hit = memo.get(key);
    if (hit && hit.ver === v && now() - hit.at < ttl) return hit.val;
    const val = fn();
    if (memo.size > 300) memo.delete(memo.keys().next().value);
    memo.set(key, { at: now(), ver: v, val });
    return val;
  }

  /* ===== the job runner ===== */
  const running = new Set(), timers = new Map(), nextAt = new Map();
  let started = false, enabledJobs = null;
  function lastRun(job) { try { return db.prepare('SELECT at, ok, ms, calls, note FROM mkt_runs WHERE job = ? ORDER BY id DESC LIMIT 1').get(job) || null; } catch { return null; } }
  function record(job, at, ok, ms, calls, note) {
    try { db.prepare('INSERT INTO mkt_runs (job, at, ok, ms, calls, note) VALUES (?,?,?,?,?,?)').run(job, at, ok ? 1 : 0, Math.max(0, Math.round(ms)), calls | 0, clip(note, 300)); } catch {}
    dataVer++;
  }
  const FNS = {};
  async function runJob(job) {
    const fn = FNS[job];
    if (!fn) throw new Error('no such job: ' + job);
    if (running.has(job)) return { ok: false, skipped: true, note: 'already running' };
    running.add(job);
    const at = now(), ctx = { calls: 0, notes: [] };
    let ok = true, note = '';
    try {
      const r = await fn(ctx, at);
      if (r && r.ok === false) ok = false;
      note = (r && r.note) || ctx.notes.join('; ');
    } catch (e) {
      ok = false;
      note = (e && e.yielded ? '' : 'failed: ') + String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 240);
    } finally { running.delete(job); }
    record(job, at, ok, now() - at, ctx.calls, note);
    if (!ok) log('[market] ' + job + ': ' + note);
    return { ok, note, calls: ctx.calls };
  }
  function schedule(job, delay) {
    clearTimeout(timers.get(job));
    nextAt.set(job, now() + delay);
    const t = setTimeout(async () => {
      try { await runJob(job); } catch {}
      if (!started) return;
      const lr = lastRun(job);
      schedule(job, lr && !lr.ok ? retryOf(job) : nextDue(job, now()) - now());
    }, Math.max(0, delay));
    if (t && t.unref) t.unref();
    timers.set(job, t);
  }
  function start(opts = {}) {
    if (started) return;
    started = true;
    const stagger = opts.staggerMs != null ? opts.staggerMs : 1000;
    enabledJobs = opts.jobs && opts.jobs.length ? new Set(opts.jobs) : null;
    for (const job of Object.keys(JOBS)) {
      if (enabledJobs && !enabledJobs.has(job)) continue;
      if ((job === 'radar' && !hooks.radarSweep) || (job === 'scans' && !hooks.scanRefresh)) continue;
      const lr = lastRun(job);
      const due = lr ? (lr.ok ? nextDue(job, lr.at) : lr.at + retryOf(job)) - now() : 0;
      schedule(job, Math.max(JOBS[job].first * stagger, due));
    }
  }
  function stop() { started = false; for (const t of timers.values()) clearTimeout(t); timers.clear(); nextAt.clear(); }

  /* ===================================================================================================================
     THE COLLECTORS
     =================================================================================================================== */

  /* ----- chains: one row per chain, every 30 minutes ----- */
  FNS.chains = async (ctx, at) => {
    const ex = '?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
    const chainsR = await ask(ctx, urls.llama + '/v2/chains', { maxBytes: 4 * 1024 * 1024 });
    if (!chainsR.ok || !Array.isArray(chainsR.data)) return { ok: false, note: 'DefiLlama chains could not be read (' + (chainsR.reason || 'not a list') + ') — no snapshot this run' };
    const dexR = await ask(ctx, urls.llama + '/overview/dexs' + ex, { maxBytes: 16 * 1024 * 1024 });
    const feesR = await ask(ctx, urls.llama + '/overview/fees' + ex, { maxBytes: 16 * 1024 * 1024 });
    const oiR = await ask(ctx, urls.llama + '/overview/open-interest' + ex, { maxBytes: 8 * 1024 * 1024 });
    const stR = await ask(ctx, urls.stables + '/stablecoinchains', { maxBytes: 4 * 1024 * 1024 });
    const why = (r, what) => what + ' could not be read (' + (r.reason || 'no answer') + ')';
    // the DEX and open-interest breakdowns: summed per breakdown key, every protocol (DefiLlama's own chain total does the same)
    const sumBreak = (r, field) => {
      if (!r.ok || !r.data || !Array.isArray(r.data.protocols)) return null;
      const out = new Map();
      for (const p of r.data.protocols) { const b = p && p[field]; if (!b || typeof b !== 'object') continue; for (const k of Object.keys(b)) out.set(k, (out.get(k) || 0) + leafSum(b[k])); }
      out.delete('off_chain');   // not a chain
      return out;
    };
    const vol24 = sumBreak(dexR, 'breakdown24h'), vol30 = sumBreak(dexR, 'breakdown30d'), oiBy = sumBreak(oiR, 'breakdown24h');
    // an answer without its protocols list (a 200 carrying { error }, or a new shape) is a read that failed, said as such
    const noList = { reason: 'answered without a protocols list' };
    const dexRead = !dexR.ok ? dexR : vol24 ? null : noList, oiRead = !oiR.ok ? oiR : oiBy ? null : noList;
    const feesRead = !feesR.ok ? feesR : feesR.data && Array.isArray(feesR.data.protocols) ? null : noList;
    const stRead = !stR.ok ? stR : Array.isArray(stR.data) ? null : { reason: 'answered without a list of chains' };
    const bkKeys = new Set([...(vol24 ? vol24.keys() : []), ...(oiBy ? oiBy.keys() : [])]);
    // the chain's own gas fees: DefiLlama's 'Chain' category, one entry per chain
    const feesBy = new Map();
    if (feesR.ok && feesR.data && Array.isArray(feesR.data.protocols)) {
      for (const p of feesR.data.protocols) {
        if (!p || p.category !== 'Chain' || !Array.isArray(p.chains) || p.chains.length !== 1) continue;
        const name = lc(p.chains[0]), cur = feesBy.get(name);
        const isChain = p.protocolType === 'chain' || /^chain#/.test(String(p.defillamaId || p.id || ''));
        if (cur && cur.isChain && !isChain) continue;   // the chain's own entry wins over an app filed under 'Chain'
        if (cur && !cur.isChain && !isChain) { feesBy.set(name, { dup: true }); continue; }   // two non-chain entries: neither is the chain's
        feesBy.set(name, { isChain, t24: num(p.total24h), t7: num(p.total7d), t30: num(p.total30d), logo: typeof p.logo === 'string' ? p.logo : null });
      }
    }
    const stBy = new Map();
    if (stR.ok && Array.isArray(stR.data)) for (const s of stR.data) if (s && s.name && s.totalCirculatingUSD) stBy.set(lc(s.name), num(s.totalCirculatingUSD.peggedUSD));
    const l2 = stGet('l2beat'), liq = stGet('dexliq'), appf = stGet('appfees');
    const l2p = (l2 && l2.v && l2.v.projects) || {};
    const l2ByName = new Map(Object.entries(l2p).map(([slug, p]) => [lc(p.name), slug]));
    // the rows: every chain DefiLlama lists with a TVL or a DEX volume, and Robinhood Chain always
    const rows = [], seenKeys = new Set();
    for (const c of chainsR.data) {
      if (!c || !c.name) continue;
      const ch = chainOfLlama(c.name); if (!ch || seenKeys.has(ch.key)) continue;
      // a chain not in the table is matched to a breakdown key by its whole name only (never by its first word: "Polygon zkEVM" is not Polygon)
      const bk = ch.bk || [lc(c.name).replace(/\s+/g, ''), lc(c.name).replace(/\s+/g, '_')].find((k) => bkKeys.has(k)) || null;
      const tvl = num(c.tvl), v24 = vol24 && bk ? (vol24.has(bk) ? vol24.get(bk) : null) : null;
      if (!(tvl > 0) && !(v24 > 0) && ch.key !== 'robinhood') continue;
      seenKeys.add(ch.key);
      rows.push({ c, ch, bk, tvl, v24 });
    }
    /* the market cap of each chain's OWN token (gecko_id); a chain without one has none, whatever its gas is paid in. Every token
       of every listed chain is read (it was the top 120 by TVL until 2026-10-28, and the rest said "no market cap was given"):
       CoinGecko's own figure, checked against CoinLore and against itself; DefiLlama's relay of it only when CoinGecko cannot
       be read (readMcaps below; the rules are lib/chainmcap.js's) */
    const byTvl = [...rows].sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
    const ids = [...new Set(byTvl.map((r) => r.c.gecko_id).filter(okGecko))];
    const mk = ids.length ? await readMcaps(ctx, ids) : null;
    /* the token's symbol and name when CoinGecko's answer has not got it (a run on DefiLlama's relay): CoinGecko's own, as the
       last snapshot that read them kept them — DefiLlama writes Morph's BGB as "-" — else DefiLlama's. Its name and symbol only:
       a price or a figure is never carried from an earlier read. */
    const prevCoin = new Map();
    if (mk && mk.cg.size < ids.length) for (const r of latestSnap().rows) { const k = safeParse(r.mcap_check, null), c = k && k.coin; const sym = c && CM.symOf(c.symbol); if (sym && okGecko(c.id) && !prevCoin.has(c.id)) prevCoin.set(c.id, { symbol: sym, name: CM.cleanText(c.name) }); }
    const symOfId = new Map(), sharedBy = new Map();
    for (const { c } of byTvl) {
      if (!okGecko(c.gecko_id)) continue;
      if (!symOfId.has(c.gecko_id) && prevCoin.has(c.gecko_id)) symOfId.set(c.gecko_id, prevCoin.get(c.gecko_id).symbol);
      if (!symOfId.has(c.gecko_id) && typeof c.tokenSymbol === 'string' && c.tokenSymbol !== '-') symOfId.set(c.gecko_id, CM.symOf(c.tokenSymbol));
      sharedBy.set(c.gecko_id, (sharedBy.get(c.gecko_id) || []).concat(String(c.name).slice(0, 80)));
    }
    const checked = new Map();   // one cross-check per token, however many chains share it (XRPL and XRPL EVM, IOTA and IOTA EVM)
    if (mk) for (const id of ids) {
      const cg = mk.cg.get(id) || null;
      checked.set(id, CM.crossCheck({ sym: (cg && cg.symbol) || symOfId.get(id) || null, cg, cgWhy: cg ? null : mk.cgWhyOf(id), relay: mk.relay.get(id) || null, relayWhy: mk.relayWhy,
        lore: mk.lore.get(id) || null, loreWhy: mk.loreWhy.get(id) || mk.loreNote, loreAlso: mk.loreAlso.get(id) || null, now: now() }));
    }
    const mcapNote = mk ? mcapSummary(mk, checked) : '';
    const S = (src, a, e) => Object.assign({ src, at: a || at }, e || {});
    const W = (w) => ({ why: w });
    const out = rows.map(({ c, ch, bk, tvl, v24 }) => {
      const name = lc(c.name), f = feesBy.get(name), st = stBy.get(name);
      const slug = ch.l2beat || l2ByName.get(name) || null, lp = slug ? l2p[slug] : null;
      const lq = liq && liq.v && liq.v.byName ? liq.v.byName[lc(ch.proto || c.name)] : undefined;
      const af = appf && appf.v ? appf.v[ch.key] : null;
      const gid = okGecko(c.gecko_id) ? c.gecko_id : null, mres = gid ? checked.get(gid) || null : null, cgc = gid && mk ? mk.cg.get(gid) || null : null;
      const others = gid ? (sharedBy.get(gid) || []).filter((n) => n !== String(c.name).slice(0, 80)) : [];
      const mcheck = gid && mres ? Object.assign({ coin: cgc ? { id: gid, symbol: cgc.symbol, name: cgc.name, price: cgc.price } : { id: gid, symbol: symOfId.get(gid) || null, name: (prevCoin.get(gid) || {}).name || null, price: null } }, mres.check,
        { mapping: CM.mappingCheck({ chainId: Number.isInteger(c.chainId) ? c.chainId : null, name: c.name, gecko: gid, gas: typeof c.gasTokenGeckoId === 'string' ? c.gasTokenGeckoId : null }, mk.platforms, (x) => mk.cg.get(x)) },
        others.length ? { shared: others.slice(0, 4) } : {}, mres.via ? { via: mres.via } : {}) : null;
      const src = {
        tvl: S('defillama'),
        vol: dexRead ? W(why(dexRead, 'DefiLlama DEX volume')) : bk && vol24.has(bk) ? S('defillama') : W('DefiLlama lists no DEX volume for this chain'),
        fees: feesRead ? W(why(feesRead, 'DefiLlama fees')) : f && !f.dup ? S('defillama') : W('DefiLlama lists no gas-fee figure for this chain'),
        stables: stRead ? W(why(stRead, 'DefiLlama stablecoins')) : st != null ? S('defillama') : W('DefiLlama lists no stablecoins on this chain'),
        oi: oiRead ? W(why(oiRead, 'DefiLlama open interest')) : bk && oiBy.has(bk) ? S('defillama') : W('DefiLlama lists no open interest on this chain'),
        liq: !liq ? W('DEX liquidity has not been read yet') : lq != null ? S('defillama', liq.at) : W('DefiLlama lists no DEX protocols on this chain'),
        appFees: af && af.v != null ? S('defillama', af.at) : W('fees paid to apps are read for the top 40 chains by TVL'),
        mcap: !gid ? W(c.gasTokenGeckoId === 'ethereum' ? 'No native token — gas is paid in ETH' : c.gasTokenGeckoId ? 'DefiLlama names no token of this chain\'s own (its gas token is ' + String(c.gasTokenGeckoId).slice(0, 60) + ')' : 'DefiLlama names no token of this chain\'s own')
          : !mres ? W('no market cap was read for ' + gid) : mres.v != null ? S(mres.src, mres.at) : Object.assign(W(mres.why), mres.src !== 'site' ? { src: mres.src } : {}),
        tvs: !l2 ? W('L2BEAT has not been read yet') : lp ? S('l2beat', l2.at) : W('L2BEAT tracks Ethereum L2s and L3s only'),
      };
      return {
        chain: ch.key, name: String(c.name).slice(0, 80), chain_id: Number.isInteger(c.chainId) ? c.chainId : null, at,
        tvl, dex_vol_24h: src.vol.src ? v24 : null, dex_vol_30d: src.vol.src && vol30 && vol30.has(bk) ? vol30.get(bk) : null,
        fees_24h: src.fees.src ? f.t24 : null, fees_7d: src.fees.src ? f.t7 : null, fees_30d: src.fees.src ? f.t30 : null,
        app_fees_24h: af && af.v != null ? af.v : null, stables: src.stables.src ? st : null, oi: src.oi.src ? oiBy.get(bk) : null,
        dex_liq: lq != null ? lq : null, mcap: mres && mres.v != null ? mres.v : null, native_token: gid,
        // CoinGecko's symbol (DefiLlama's is "-" for Morph, whose token is BGB), else DefiLlama's
        native_symbol: cgc && cgc.symbol ? cgc.symbol.slice(0, 16) : gid && prevCoin.has(gid) ? prevCoin.get(gid).symbol.slice(0, 16) : typeof c.tokenSymbol === 'string' && c.tokenSymbol !== '-' ? c.tokenSymbol.slice(0, 16) : null,
        gas_token: typeof c.gasTokenGeckoId === 'string' ? c.gasTokenGeckoId.slice(0, 80) : null,
        tvs: lp && lp.tvs ? num(lp.tvs.total) : null, stage: lp && typeof lp.stage === 'string' ? lp.stage.slice(0, 40) : null,
        is_l2: lp ? (/layer[23]/.test(String(lp.type || '')) ? 1 : 0) : (l2 ? 0 : null),   // L2BEAT read and not listing it: not an L2 by L2BEAT's word
        logo: f && !f.dup && logoAllowed(llamaIcon(String(f.logo || '').replace(/ /g, '%20'))) ? llamaIcon(String(f.logo).replace(/ /g, '%20')) : null,
        src: JSON.stringify(src), mcap_check: mcheck ? JSON.stringify(mcheck) : null,
      };
    });
    const ins = db.prepare(`INSERT INTO mkt_chain_snap (chain, name, chain_id, at, tvl, dex_vol_24h, dex_vol_30d, fees_24h, fees_7d, fees_30d, app_fees_24h, stables, oi, dex_liq, mcap, native_token, native_symbol, gas_token, tvs, stage, is_l2, logo, src, mcap_check)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    tx(() => { for (const r of out) ins.run(r.chain, r.name, r.chain_id, r.at, r.tvl, r.dex_vol_24h, r.dex_vol_30d, r.fees_24h, r.fees_7d, r.fees_30d, r.app_fees_24h, r.stables, r.oi, r.dex_liq, r.mcap, r.native_token, r.native_symbol, r.gas_token, r.tvs, r.stage, r.is_l2, r.logo, r.src, r.mcap_check); });
    dataVer++;
    const missing = [[dexRead, 'DEX volume'], [feesRead, 'fees'], [oiRead, 'open interest'], [stRead, 'stablecoins']].filter(([r]) => r).map(([r, w]) => w + ' (' + r.reason + ')');
    return { note: out.length + ' chains' + (missing.length ? '; not read: ' + missing.join(', ') : '') + (mcapNote ? '; ' + mcapNote : '') };
  };

  /* ----- the market-cap reads of one chains run: CoinGecko (the reference), DefiLlama's relay of it, CoinLore (the second source) ----- */
  async function readMcaps(ctx, ids) {
    const out = { ids, cg: new Map(), cgWhy: null, relay: new Map(), relayWhy: null, lore: new Map(), loreWhy: new Map(), loreAlso: new Map(), loreNote: null, loreRead: 0, platforms: null };
    /* CoinGecko keyless: one read of up to 250 coins, never within two minutes of another (it is shared by everyone on this
       address). The chains run comes first: when the daily references took the slot (their asset-platforms read), it waits out
       the rest of the two minutes — its slot taken before the wait — rather than serve DefiLlama's relay for half an hour. A
       chains run right after another (a retry, a manual run) takes the relay: the run before it read CoinGecko moments ago. */
    const lastCg = stGet('cg_last'), cgFree = lastCg ? lastCg.at + 2 * MIN : -Infinity;
    const cgWait = cgFree > now() && lastCg && lastCg.v && lastCg.v.why !== 'chains' ? cgFree - now() : 0;
    if (!cgWait && lastCg && now() - lastCg.at < 2 * MIN) out.cgWhy = 'CoinGecko was asked less than two minutes ago';
    else {
      stSet('cg_last', { why: 'chains' }, now() + cgWait);
      if (cgWait) await sleep(cgWait);
      const cr = await ask(ctx, urls.cg + '/coins/markets?vs_currency=usd&per_page=250&ids=' + encodeURIComponent(ids.slice(0, CG_PER_CALL).join(',')), { maxBytes: 2 * 1024 * 1024, headers: cgHeaders });
      if (cr.ok && Array.isArray(cr.data)) { const t = now(); for (const x of cr.data) { const c = CM.cgCoin(x, t); if (c && !out.cg.has(c.id)) out.cg.set(c.id, c); } }
      else out.cgWhy = 'CoinGecko could not be read (' + (cr.ok ? 'not a list' : cr.reason) + ')';
    }
    out.cgWhyOf = (id) => out.cgWhy || (ids.indexOf(id) >= CG_PER_CALL ? 'beyond the ' + CG_PER_CALL + ' tokens CoinGecko is asked for in one read' : 'CoinGecko\'s answer did not include ' + id);
    // DefiLlama's relay of CoinGecko's figure: the stand-in when CoinGecko cannot be read, and a check on its freshness when it can
    const mr = await ask(ctx, urls.coins + '/mcaps', { body: { coins: ids.slice(0, 400).map((i) => 'coingecko:' + i) }, maxBytes: 1024 * 1024 });
    if (mr.ok && mr.data && typeof mr.data === 'object' && !Array.isArray(mr.data)) {
      for (const i of ids) {
        const e = mr.data['coingecko:' + i], v = e && num(e.mcap);
        if (v != null) out.relay.set(i, { v, at: CM.relayAt(e.timestamp) });   // its own timestamp, or null ("time not recorded") — never the read time
      }
    } else out.relayWhy = 'DefiLlama\'s relay of it could not be read either (' + (mr.ok ? 'not an object' : mr.reason) + ')';
    // CoinLore: the coins its daily walk matched, read again now — and matched again (a learned coin whose price stops agreeing is dropped for this read)
    const learned = stGet('coinlore_ids'), L = learned && learned.v && learned.v.ids, M = (learned && learned.v && learned.v.misses) || {};
    if (!urls.coinlore) out.loreNote = 'CoinLore is not read on this server (MARKET_COINLORE_URL is empty)';
    else if (!L) out.loreNote = 'CoinLore\'s coins have not been matched yet (a daily walk of its list does that)';
    else {
      const want = [...new Set(ids.map((i) => L[i] && L[i].lore).filter((x) => /^\d{1,12}$/.test(String(x || ''))))];
      const rows = new Map(); let failed = null;
      for (let i = 0; i < want.length && !failed; i += LORE_PER_CALL) {
        const r = await loreAsk(ctx, '/ticker/?id=' + want.slice(i, i + LORE_PER_CALL).join(','));
        if (r.ok && Array.isArray(r.data)) { const t = now(); for (const x of r.data) { const c = CM.loreCoin(x, t); if (c) rows.set(c.id, c); } }
        else failed = r.ok ? 'not a list' : r.reason;
      }
      out.loreRead = rows.size;
      for (const id of ids) {
        const k = L[id];
        if (!k) { out.loreWhy.set(id, M[id] || 'not looked for on CoinLore yet (the daily walk has not run since this token was listed)'); continue; }
        if (k.rejected) out.loreAlso.set(id, k.rejected);
        const row = rows.get(String(k.lore)), cg = out.cg.get(id);
        if (!row) { out.loreWhy.set(id, failed ? 'CoinLore could not be read (' + failed + ')' : 'CoinLore did not answer for its coin ' + k.lore); continue; }
        if (!cg) { out.loreWhy.set(id, 'CoinGecko\'s price was not read, so CoinLore\'s coin is not confirmed as the same one on this read and is not counted'); continue; }
        const m = CM.matchCoin(cg, [row], { absent: 'CoinLore’s coin ' + row.id + ' (“' + (row.name || 'no name') + '”) now has ' + (row.symbol ? 'the symbol $' + row.symbol : 'no symbol') + ', not CoinGecko’s $' + cg.symbol + ', so it is not counted' });
        if (m.coin) out.lore.set(id, m.coin); else out.loreWhy.set(id, m.why + ' (on this read)');
      }
    }
    const plat = stGet('cg_platforms');
    out.platforms = plat && plat.v ? CM.platformIndex(plat.v.list) : null;
    return out;
  }
  // a run's note: what the market caps were read from, in counts
  function mcapSummary(mk, checked) {
    const n = { agreed: 0, differs: 0, single: 0, none: 0 }; let relayed = 0, loreOnly = 0;
    for (const r of checked.values()) { n[r.check.status]++; if (r.via === 'relay') relayed++; if (r.via === 'coinlore') loreOnly++; }
    return 'market caps of ' + checked.size + ' tokens: ' + mk.cg.size + ' read from CoinGecko' + (relayed ? ', ' + relayed + ' relayed by DefiLlama' : '') + (loreOnly ? ', ' + loreOnly + ' from CoinLore alone' : '')
      + '; checked against CoinLore: ' + n.agreed + ' agree, ' + n.differs + ' differ, ' + n.single + ' one source, ' + n.none + ' none'
      + (mk.cgWhy ? '; ' + mk.cgWhy : '') + (mk.cgWhy && mk.relayWhy ? ' — ' + mk.relayWhy : '') + (mk.loreNote ? '; ' + mk.loreNote : '');
  }

  /* ----- the chain market caps' references, daily: CoinGecko's asset platforms (the chain → token mapping check) and
     CoinLore's coin ids (a walk of its list, matched to the coins CoinGecko named on the newest chains run) ----- */
  // the chain tokens CoinGecko named on the newest chains run, with its symbol, name and price: what the walk matches
  function chainCoins() {
    const out = new Map();
    for (const r of latestSnap().rows) {
      const k = safeParse(r.mcap_check, null), c = k && k.coin;
      if (c && typeof c.id === 'string' && !out.has(c.id) && c.symbol && c.name && num(c.price) > 0) out.set(c.id, { id: c.id, symbol: c.symbol, name: c.name, price: num(c.price) });
    }
    return out;
  }
  FNS.mcapRefs = async (ctx) => {
    const notes = [];
    let ok = true;
    /* CoinGecko's asset platforms, daily — never within two minutes of another CoinGecko read, and never just before a chains
       run (it reads CoinGecko first: its market caps are the reason for the slot). Postponed, it is tried again within the hour. */
    const plat0 = stGet('cg_platforms');
    if (!plat0 || now() - plat0.at >= JOBS.mcapRefs.every - 30 * MIN) {
      const lastCg = stGet('cg_last'), chainsIn = nextAt.has('chains') ? nextAt.get('chains') - now() : null;
      if (running.has('chains') || (chainsIn != null && chainsIn < 3 * MIN)) { ok = false; notes.push('asset platforms not read now: the chains run, which reads CoinGecko first, is under way or due within 3 minutes'); }
      else if (lastCg && now() - lastCg.at < 2 * MIN) { ok = false; notes.push('asset platforms not read: CoinGecko was asked less than two minutes ago'); }
      else {
        stSet('cg_last', { why: 'asset_platforms' });
        const r = await ask(ctx, urls.cg + '/asset_platforms', { maxBytes: 2 * 1024 * 1024, headers: cgHeaders });
        const list = r.ok ? CM.platformsOf(r.data) : [];
        if (list.length) { stSet('cg_platforms', { list }); dataVer++; notes.push(list.length + ' CoinGecko asset platforms'); }
        else { ok = false; notes.push('CoinGecko\'s asset platforms could not be read (' + (r.ok ? 'not a list' : r.reason) + ')'); }
      }
    }
    /* CoinLore's walk: its list read 100 coins a page, at most LORE_WALK_MAX pages in a UTC day, whatever happens (a page it
       refuses counts too). A walk cut short — refused, or out of today's pages — goes on from the page where it stopped, and
       until it is whole the last whole walk's verdicts stand; it settles only tokens new since then (CM.mergeLore). The rows
       that could match a chain token are kept between its parts, so the whole walk's verdicts are a full walk's. */
    if (!urls.coinlore) notes.push('CoinLore is not read on this server (MARKET_COINLORE_URL is empty)');
    else {
      const s0 = stGet('coinlore_ids'), v0 = (s0 && s0.v) || null, today = dayOf(now());
      const used = v0 && v0.day === today ? Math.max(0, v0.dayCalls | 0) : 0, left = LORE_WALK_MAX - used;
      let part = v0 && v0.walk && Number.isInteger(v0.walk.next) && v0.walk.next > 0 ? v0.walk : null;
      const due = !!part || !v0 || !v0.doneAt || now() - v0.doneAt >= JOBS.mcapRefs.every - 30 * MIN;   // a walk part way, or none whole within the day
      let coins = due ? chainCoins() : null;
      /* a walk going on matches the tokens it set out with: its kept rows are theirs. A token listed since waits for the next
         walk ("not looked for on CoinLore yet") — never "no coin among the first 2,000" from pages whose rows were not kept for it. */
      if (part && coins) {
        const was = new Set(Array.isArray(part.for) ? part.for : []), kept = new Map([...coins].filter(([k]) => was.has(k)));
        if (kept.size) coins = kept; else part = null;   // none of them left: a walk of its own
      }
      if (!due) { /* the day's walk is done */ }
      else if (!coins.size) { ok = false; notes.push('no chain token has been read from CoinGecko yet (the walk matches CoinLore\'s coins to CoinGecko\'s as the newest chains run read them; that run had none)'); }
      else if (left <= 0) { ok = false; notes.push('CoinLore: today\'s ' + LORE_WALK_MAX + ' walk pages are spent; the walk ' + (part ? 'goes on from page ' + (part.next / 100 + 1) : 'starts again') + ' after 00:00 UTC'); }
      else {
        const okRow = (c) => c && /^\d{1,12}$/.test(String(c.id)) && typeof c.symbol === 'string';
        const rows = part ? CM.walkRows(coins, (Array.isArray(part.rows) ? part.rows : []).filter(okRow)) : [];
        let start = part ? part.next : 0, calls = 0, stopped = null, ended = false, all = false, coinsRead = part ? Math.max(0, part.coins | 0) : 0, total = part && num(part.total) != null ? num(part.total) : null;
        while (start < LORE_WALK_MAX * 100 && calls < left) {
          const r = await loreAsk(ctx, '/tickers/?start=' + start + '&limit=100');
          calls++;
          const list = r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : null;
          if (!list) { stopped = 'page ' + (start / 100 + 1) + ': ' + (r.ok ? 'not a list' : r.reason); break; }
          const t = now(), tot = num(r.data.info && r.data.info.coins_num), got = [];
          if (tot != null) total = tot;
          for (const x of list) { const c = CM.loreCoin(x, t); if (c) got.push(c); }
          coinsRead += got.length; rows.push(...CM.walkRows(coins, got));
          start += 100;
          if (!list.length || (tot != null && start >= tot)) { ended = true; break; }   // the end of its list (an empty page, or its own count)
          if (CM.allMatched(coins, rows)) { all = true; break; }   // every chain token is matched: the rest of the list is not needed
        }
        const complete = ended || all || start >= LORE_WALK_MAX * 100;
        const dayCalls = used + calls;
        if (!complete && !start && !rows.length) {
          // nothing read at all: the last walk's verdicts stand as they are; only the day's count of pages moves
          ok = false; notes.push('CoinLore could not be read (' + (stopped || 'an empty list') + ')');
          if (v0) stSet('coinlore_ids', Object.assign({}, v0, { day: today, dayCalls }), s0.at); else stSet('coinlore_ids', { ids: {}, misses: {}, pages: 0, coins: 0, total, ended: false, stopped, complete: false, doneAt: null, day: today, dayCalls, walk: null });
        } else {
          const lr = CM.learnLore(coins, rows, { seen: { upTo: start, total, ended, stopped, partial: !complete } });
          const base = part ? part.base || null : v0 && v0.ids ? { ids: v0.ids, misses: v0.misses || {} } : null;
          const served = complete ? lr : CM.mergeLore(base, lr);
          stSet('coinlore_ids', { ids: served.ids, misses: served.misses, pages: start / 100, coins: coinsRead, total, ended, stopped, complete,
            doneAt: complete ? now() : (v0 && v0.doneAt) || null, day: today, dayCalls,
            walk: complete ? null : { next: start, for: [...coins.keys()], rows, coins: coinsRead, total, base, startedAt: part && part.startedAt ? part.startedAt : now() } });
          dataVer++;
          if (!complete) ok = false;   // tried again within the hour, from where it stopped (today's pages allowing)
          const kept = complete || !base ? 0 : Object.keys(served.ids).filter((k) => (base.ids || {})[k]).length;
          notes.push('CoinLore: ' + Object.keys(served.ids).length + ' of ' + coins.size + ' chain tokens matched over ' + start / 100 + ' pages (' + coinsRead + ' coins'
            + (part ? ', this walk going on from page ' + (part.next / 100 + 1) : '') + ')' + (kept ? ', ' + kept + ' of them kept from the last whole walk' : '')
            + (stopped ? ', the walk stopped at ' + stopped + ' and goes on from there' : !complete ? ', today\'s ' + LORE_WALK_MAX + ' pages are spent and the walk goes on after 00:00 UTC' : ''));
        }
      }
    }
    return { ok, note: notes.join('; ') || 'nothing due' };
  };

  /* ----- CoinGecko's two-minute slot, for the bubble map (the chains run's own rules are in readMcaps, mcapRefs' above) -----
     Keyless CoinGecko is shared by everyone on this address, so it is never asked twice within two minutes ('cg_last'). The
     map books the next free slot — two minutes after the last one booked, by any job — and waits until it comes, as the chains
     run does. It never pushes the chains run back: while that run is under way, or due within three minutes of the slot the
     map would book, the map waits for it (a poll every 15 s, at most 24 of them: six minutes) and then books behind it; past
     that it reads on its next run. A slot further off than HM_SLOT_MAX (one already booked behind another) is not waited for. */
  const HM_EVERY = { global: 30 * MIN, stables: 6 * HOUR }, HM_POLL = 15000, HM_POLLS = 24, HM_SLOT_MAX = 4 * MIN;
  async function cgSlot(job) {
    for (let i = 0; ; i++) {
      const last = stGet('cg_last'), wait = last ? Math.max(0, last.at + 2 * MIN - now()) : 0;
      const chainsIn = nextAt.has('chains') ? nextAt.get('chains') - now() : null;
      const chainsNear = running.has('chains') || (chainsIn != null && chainsIn < wait + 3 * MIN);
      if (!chainsNear && wait <= HM_SLOT_MAX) {
        stSet('cg_last', { why: job }, now() + wait);
        if (wait) await sleep(wait);
        return { ok: true, waited: wait };
      }
      if (i >= HM_POLLS) return { ok: false, why: chainsNear ? 'the chains run, which reads CoinGecko first, was under way or due for six minutes' : 'CoinGecko\'s next free slot was more than four minutes away for six minutes' };
      await sleep(HM_POLL);
    }
  }
  /* ----- heatmap: the whole crypto market's 100 largest coins, last 24 h (the bubble map; lib/marketmap.js has the rules) -----
     Each part is read when due — CoinGecko's top 100 every run, its total market cap every 30 minutes, its stablecoins category
     every 6 hours (each again on the next run after a failed read) — in its own CoinGecko slot, and kept last-good: a read that
     fails or does not parse leaves the stored one in place, with failAt / failWhy beside it. CoinLore's 100 largest coins come
     every run, at its own pace (loreAsk). The run is ok when the top 100 was read. */
  FNS.heatmap = async (ctx) => {
    const st = stGet('heatmap'), rec = Object.assign({}, (st && st.v) || {});
    const readW = [], notW = [];
    const due = (r, every) => !every || !r || !r.readAt || (r.failAt && r.failAt >= r.readAt) || now() - r.readAt >= every - MIN;
    const keep = (name, p, when, why) => {
      if (p.ok) { const o = Object.assign({ readAt: when }, p); delete o.ok; rec[name] = o; }
      else rec[name] = Object.assign({}, rec[name] || {}, { failAt: when, failWhy: String(why || 'no answer').slice(0, 160) });
      stSet('heatmap', rec); dataVer++;
    };
    const why = (r, p) => (!r.ok ? (r.reason === 'budget' ? 'its meter was spent' : r.reason) : p.why);
    const parts = [
      ['coins', 'top 100', '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=' + MM.TOP + '&page=1&price_change_percentage=24h', (d, t) => MM.parseMarkets(d, t), null],
      ['global', 'total market cap', '/global', (d) => MM.parseGlobal(d), HM_EVERY.global],
      ['stables', 'stablecoins', '/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=' + MM.STABLES_PER_CALL, (d) => MM.parseStables(d), HM_EVERY.stables],
    ];
    let coinsOk = false;
    for (const [name, what, path, parse, every] of parts) {
      if (!due(rec[name], every)) continue;
      const slot = await cgSlot('heatmap');
      if (!slot.ok) { notW.push(what + ' (' + slot.why + ')'); break; }   // the parts after it wait for the next run too
      const r = await ask(ctx, urls.cg + path, { maxBytes: 2 * 1024 * 1024, headers: cgHeaders });
      const t = now(), p = r.ok ? parse(r.data, t) : { ok: false };
      keep(name, p, t, why(r, p));
      if (p.ok) { readW.push(what); if (name === 'coins') coinsOk = true; } else notW.push(what + ' (' + wordClip(why(r, p), 60) + ')');
    }
    // CoinLore's 100 largest coins: the independent check, read on every run that read CoinGecko's top 100 — only a CoinLore read
    // within 15 minutes of the coins is compared with them, so one taken while CoinGecko's coins stay last-good would only push out
    // the CoinLore read that matched them (and spend a call for nothing)
    let loreNote = '';
    if (!urls.coinlore) loreNote = 'CoinLore is not read on this server (MARKET_COINLORE_URL is empty)';
    else if (!coinsOk) loreNote = 'CoinLore not read: CoinGecko\'s top 100 was not read this run, so its last CoinLore read stays beside the coins it was compared with';
    else {
      const r = await loreAsk(ctx, '/tickers/?start=0&limit=' + MM.TOP);
      const t = now(), p = r.ok ? MM.parseLore(r.data, t) : { ok: false };
      keep('lore', p, t, why(r, p));
      if (p.ok) readW.push('CoinLore'); else notW.push('CoinLore (' + wordClip(why(r, p), 60) + ')');
    }
    const parts2 = [readW.length ? 'read: ' + readW.join(', ') : '', notW.length ? 'not read: ' + notW.join(', ') : '', loreNote];
    if (coinsOk) {
      const B = MM.buildMap(rec, { fig, none }), n = { agreed: 0, differs: 0, single: 0, none: 0 };
      for (const x of B.rows) n[x.check.status]++;
      parts2.push(B.rows.length + ' coins, ' + B.counts.up + ' up, ' + B.counts.down + ' down; checked against CoinLore: ' + n.agreed + ' agree, ' + n.differs + ' differ, ' + n.single + ' one source');
    }
    return { ok: coinsOk, note: fitNote(parts2) };
  };

  /* ----- L2BEAT: TVS, stage and risks of every L2 and L3 it tracks, hourly ----- */
  FNS.l2beat = async (ctx) => {
    const r = await ask(ctx, urls.l2beat + '/scaling/summary', { maxBytes: 8 * 1024 * 1024 });
    const pr = r.ok && r.data && r.data.projects;
    if (!pr || typeof pr !== 'object') return { ok: false, note: 'L2BEAT could not be read (' + (r.reason || 'no projects') + ')' };
    const projects = {};
    for (const [slug, p] of Object.entries(pr)) {
      if (!p || typeof p !== 'object' || !/^[a-z0-9-]{1,60}$/.test(slug)) continue;
      const b = (p.tvs && p.tvs.breakdown) || {};
      projects[slug] = {
        name: clip(p.name, 80), type: clip(p.type, 20), hostChain: clip(p.hostChain, 40), stage: clip(p.stage, 40),
        risks: Array.isArray(p.risks) ? p.risks.slice(0, 8).map((x) => ({ name: clip(x && x.name, 60), value: clip(x && x.value, 80), sentiment: clip(x && x.sentiment, 12), description: clip(x && x.description, 600) })) : [],
        tvs: { total: num(b.total), native: num(b.native), canonical: num(b.canonical), external: num(b.external), ether: num(b.ether), stablecoin: num(b.stablecoin), btc: num(b.btc), other: num(b.other), rwaPublic: num(b.rwaPublic), rwaRestricted: num(b.rwaRestricted) },
        change7d: num(p.tvs && p.tvs.change7d),
      };
    }
    stSet('l2beat', { projects });
    dataVer++;
    return { note: Object.keys(projects).length + ' projects' };
  };

  /* ----- DEX liquidity by chain: the TVL of DefiLlama's 'Dexs' protocols, every 3 hours (/protocols is 2.3 MB compressed) ----- */
  FNS.liquidity = async (ctx, at) => {
    const r = await ask(ctx, urls.llama + '/protocols', { maxBytes: 48 * 1024 * 1024, timeoutMs: 60000 });
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, note: 'DefiLlama protocols could not be read (' + (r.reason || 'not a list') + ')' };
    // the same answer names every app with a TVL on Robinhood Chain: the RWA job reads the per-token deposits of the largest (no extra call here)
    const rhApps = R.parseLlamaProtocols(r.data);
    stSet('rwa_protocols', { readAt: at, protocols: rhApps.slice(0, 400) });
    const byName = {};
    let n = 0;
    for (const p of r.data) {
      if (!p || p.category !== 'Dexs' || !p.chainTvls || typeof p.chainTvls !== 'object') continue;
      n++;
      for (const [k, v] of Object.entries(p.chainTvls)) {
        if (k.includes('-') || NOT_A_CHAIN.has(lc(k))) continue;
        const x = typeof v === 'number' ? v : num(v);
        if (x == null) continue;
        byName[lc(k)] = (byName[lc(k)] || 0) + x;
      }
    }
    stSet('dexliq', { byName, protocols: n });
    dataVer++;
    return { note: n + ' DEX protocols across ' + Object.keys(byName).length + ' chains; ' + rhApps.length + ' apps with a Robinhood Chain TVL' };
  };

  /* ----- daily histories: top 40 chains by TVL and Robinhood Chain, every 6 hours ----- */
  const upsertSeries = (rowsIn) => {
    const st = db.prepare(`INSERT INTO mkt_chain_series (chain, metric, day, value, src, at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(chain, metric, day) DO UPDATE SET value = excluded.value, src = excluded.src, at = excluded.at`);
    const today = dayOf(now());
    let n = 0;
    tx(() => { for (const r of rowsIn) { if (!validDay(r[2]) || r[2] >= today || r[3] == null) continue; st.run(r[0], r[1], r[2], r[3], r[4], now()); n++; } });   // a point dated today is a partial day: never stored as one
    dataVer++;
    return n;
  };
  const tsDay = (t) => { const s = num(t); return s == null ? null : dayOf(s > 1e12 ? s : s * 1000); };
  function latestSnap() {
    return memoize('snap', 15000, () => {
      try {
        const m = db.prepare('SELECT MAX(at) m FROM mkt_chain_snap').get().m;
        return m ? { at: m, rows: db.prepare('SELECT * FROM mkt_chain_snap WHERE at = ?').all(m) } : { at: null, rows: [] };
      } catch { return { at: null, rows: [] }; }
    });
  }
  FNS.series = async (ctx) => {
    const snap = latestSnap();
    if (!snap.rows.length) return { ok: false, note: 'no chains snapshot yet — the chains job runs first' };
    const pick = [...snap.rows].sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 40);
    if (!pick.some((r) => r.chain === 'robinhood')) { const rh = snap.rows.find((r) => r.chain === 'robinhood'); if (rh) pick.push(rh); }
    const gtpChains = new Set(((stGet('growthepie') || {}).v || {}).chains || []);
    const l2names = new Map(Object.entries((((stGet('l2beat') || {}).v || {}).projects) || {}).map(([slug, p]) => [lc(p.name), slug]));
    const appfees = ((stGet('appfees') || {}).v) || {};
    let points = 0; const failed = [];
    for (const r of pick) {
      const name = encodeURIComponent(r.name), out = [];
      const tvl = await ask(ctx, urls.llama + '/v2/historicalChainTvl/' + name, { maxBytes: 2 * 1024 * 1024 });
      if (tvl.ok && Array.isArray(tvl.data)) for (const p of tvl.data) out.push([r.chain, 'tvl', tsDay(p && p.date), num(p && p.tvl), 'defillama']); else failed.push(r.chain + ' tvl');
      const dx = await ask(ctx, urls.llama + '/overview/dexs/' + name + '?excludeTotalDataChartBreakdown=true', { maxBytes: 8 * 1024 * 1024 });
      if (dx.ok && dx.data && Array.isArray(dx.data.totalDataChart)) for (const p of dx.data.totalDataChart) out.push([r.chain, 'dex_volume', tsDay(p && p[0]), num(p && p[1]), 'defillama']); else if (!(dx.status === 404 || dx.status === 400)) failed.push(r.chain + ' volume');
      const fe = await ask(ctx, urls.llama + '/overview/fees/' + name + '?excludeTotalDataChartBreakdown=true', { maxBytes: 8 * 1024 * 1024 });
      if (fe.ok && fe.data && Array.isArray(fe.data.totalDataChart)) {
        for (const p of fe.data.totalDataChart) out.push([r.chain, 'app_fees', tsDay(p && p[0]), num(p && p[1]), 'defillama']);
        if (num(fe.data.total24h) != null) appfees[r.chain] = { v: num(fe.data.total24h), at: now() };
      } else if (!(fe.status === 404 || fe.status === 400)) failed.push(r.chain + ' fees');
      const sc = await ask(ctx, urls.stables + '/stablecoincharts/' + name, { maxBytes: 4 * 1024 * 1024 });
      if (sc.ok && Array.isArray(sc.data)) for (const p of sc.data) out.push([r.chain, 'stables', tsDay(p && p.date), num(p && p.totalCirculatingUSD && p.totalCirculatingUSD.peggedUSD), 'defillama']); else if (!(sc.status === 404 || sc.status === 400)) failed.push(r.chain + ' stablecoins');
      // daily transactions of an L2 growthepie does not cover: L2BEAT's activity (one source per chart)
      const ch = CHAIN_BY_KEY.get(r.chain);
      if (r.is_l2 && !(ch && ch.gtp && gtpChains.has(ch.gtp))) {
        const slug = ch && ch.l2beat ? ch.l2beat : l2names.get(lc(r.name)) || null;
        if (slug) {
          const ac = await ask(ctx, urls.l2beat + '/scaling/activity/' + encodeURIComponent(slug) + '?range=max', { maxBytes: 2 * 1024 * 1024 });
          const d = ac.ok && ac.data && ac.data.data && ac.data.data.chart;
          if (d && Array.isArray(d.data)) { const ti = (d.types || []).indexOf('timestamp'), ci = (d.types || []).indexOf('count'); for (const p of d.data) out.push([r.chain, 'txcount', tsDay(p[ti < 0 ? 0 : ti]), num(p[ci < 0 ? 1 : ci]), 'l2beat']); }
          else failed.push(r.chain + ' activity');
        }
      }
      points += upsertSeries(out);
    }
    stSet('appfees', appfees);
    // Robinhood Chain's own daily transactions and active addresses since launch, from growthepie (fundamentals keeps 90 days)
    for (const metric of ['txcount', 'daa']) {
      const g = await ask(ctx, urls.growthepieMetrics + '/metrics/chains/robinhood/' + metric + '.json', { maxBytes: 4 * 1024 * 1024 });
      const d = g.ok && g.data && g.data.details && g.data.details.timeseries && g.data.details.timeseries.daily;
      if (d && Array.isArray(d.data)) points += upsertSeries(d.data.map((p) => ['robinhood', metric, tsDay(p[0]), num(p[1]), 'growthepie']));
      else failed.push('robinhood ' + metric + ' (growthepie)');
    }
    return { note: pick.length + ' chains, ' + points + ' daily points' + (failed.length ? '; not read: ' + failed.slice(0, 12).join(', ') + (failed.length > 12 ? '…' : '') : '') };
  };

  /* ----- growthepie fundamentals: 90 days of every chain it covers, once a day (it refreshes about 05:30 UTC) ----- */
  const GTP_METRICS = { txcount: 'txcount', daa: 'daa', fees_paid_usd: 'fees', txcosts_median_usd: 'txcost_median' };
  FNS.growthepie = async (ctx) => {
    const r = await ask(ctx, urls.growthepie + '/fundamentals.json', { maxBytes: 16 * 1024 * 1024 });
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, note: 'growthepie could not be read (' + (r.reason || 'not a list') + ')' };
    const byGtp = new Map(); for (const c of CHAIN_BY_KEY.values()) if (c.gtp) byGtp.set(c.gtp, c.key);
    const out = [], seen = new Set();
    for (const x of r.data) {
      if (!x || !GTP_METRICS[x.metric_key]) continue;
      const key = byGtp.get(x.origin_key); if (!key) continue;
      seen.add(x.origin_key);
      out.push([key, GTP_METRICS[x.metric_key], typeof x.date === 'string' ? x.date : null, num(x.value), 'growthepie']);
    }
    const n = upsertSeries(out);
    stSet('growthepie', { chains: [...seen] });
    return { note: n + ' daily points for ' + seen.size + ' chains' };
  };

  /* ----- GeckoTerminal pools ----- */
  function gtPoolRows(json, network) {
    const inc = new Map(((json && json.included) || []).filter((x) => x && x.id).map((x) => [x.id, x]));
    const evm = network !== 'solana';
    const addrOfId = (id) => { const s = String(id || ''); return s.startsWith(network + '_') ? s.slice(network.length + 1) : null; };
    const fix = (a) => (a == null ? null : evm ? lc(a) : String(a));
    const out = [];
    for (const d of (json && Array.isArray(json.data) ? json.data : [])) {
      const a = (d && d.attributes) || {}, rel = (d && d.relationships) || {};
      const bid = rel.base_token && rel.base_token.data && rel.base_token.data.id, qid = rel.quote_token && rel.quote_token.data && rel.quote_token.data.id;
      const bt = (inc.get(bid) || {}).attributes || {}, qt = (inc.get(qid) || {}).attributes || {};
      const pool = fix(a.address || addrOfId(d && d.id));
      const baseAddr = fix(bt.address || addrOfId(bid));
      if (!pool || !baseAddr) continue;
      if (evm && !(EVM_RE.test(pool) || POOL_ID_RE.test(pool))) continue;
      const v = a.volume_usd || {}, pc = a.price_change_percentage || {}, t24 = (a.transactions && a.transactions.h24) || {};
      const buys = num(t24.buys), sells = num(t24.sells), mc = num(a.market_cap_usd);
      const dexId = rel.dex && rel.dex.data && rel.dex.data.id;
      out.push({
        pool, base_addr: baseAddr, base_symbol: gtext(bt.symbol || String(a.name || '').split(' / ')[0], 40), base_name: gtext(bt.name, 80),
        base_logo: logoAllowed(bt.image_url) ? bt.image_url : null, base_gecko_id: clip(bt.coingecko_coin_id, 80),
        quote_addr: fix(qt.address || addrOfId(qid)), quote_symbol: gtext(qt.symbol || String(a.name || '').split(' / ')[1], 40), dex: clip(dexId, 60), name: gtext(a.name, 120),
        price_usd: num(a.base_token_price_usd), reserve_usd: num(a.reserve_in_usd), fdv_usd: num(a.fdv_usd), mcap_usd: mc != null && mc > 0 ? mc : null,
        vol_m5: num(v.m5), vol_h1: num(v.h1), vol_h6: num(v.h6), vol_h24: num(v.h24),
        tx_h24: buys != null && sells != null ? buys + sells : null, buys_h24: buys, sells_h24: sells,
        chg_m5: num(pc.m5), chg_h1: num(pc.h1), chg_h6: num(pc.h6), chg_h24: num(pc.h24),
        created_at: a.pool_created_at ? (Date.parse(a.pool_created_at) || null) : null,
      });
    }
    return out;
  }
  async function readPools(ctx, key, at) {
    const ch = CHAIN_BY_KEY.get(key), net = ch && ch.gt;
    if (!net) return { pages: 0, pools: 0, why: 'no GeckoTerminal network' };
    const want = GT_PAGES[key] || 3;
    const ins = db.prepare(`INSERT INTO mkt_pool_snap (network, pool, at, rank, base_addr, base_symbol, base_name, base_logo, base_gecko_id, quote_addr, quote_symbol, dex, name, price_usd, reserve_usd, fdv_usd, mcap_usd,
      vol_m5, vol_h1, vol_h6, vol_h24, tx_h24, buys_h24, sells_h24, chg_m5, chg_h1, chg_h6, chg_h24, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let pages = 0, rank = 0, why = null, ended = false; const seen = new Set();
    for (let page = 1; page <= want; page++) {
      const r = await gtAsk(ctx, '/networks/' + net + '/pools?page=' + page + '&sort=h24_volume_usd_desc&include=base_token,quote_token,dex', { maxBytes: 2 * 1024 * 1024 });
      if (!r.ok) { why = 'page ' + page + ': ' + (r.reason === 'budget' ? 'the GeckoTerminal budget was spent' : r.reason); break; }
      if (!r.data || !Array.isArray(r.data.data) || !r.data.data.length) { ended = true; break; }   // an empty page is the end of the list
      const rows = gtPoolRows(r.data, net).filter((x) => !seen.has(x.pool));
      tx(() => { for (const x of rows) { seen.add(x.pool); ins.run(net, x.pool, at, ++rank, x.base_addr, x.base_symbol, x.base_name, x.base_logo, x.base_gecko_id, x.quote_addr, x.quote_symbol, x.dex, x.name, x.price_usd, x.reserve_usd, x.fdv_usd, x.mcap_usd, x.vol_m5, x.vol_h1, x.vol_h6, x.vol_h24, x.tx_h24, x.buys_h24, x.sells_h24, x.chg_m5, x.chg_h1, x.chg_h6, x.chg_h24, x.created_at); } });
      pages++;
      if (r.data.data.length < 20) { ended = true; break; }   // the last page
    }
    if (pages) stSet('pools:' + net, { at, pages, pools: rank, wanted: want, why, ended });
    dataVer++;
    return { pages, pools: rank, why, net };
  }
  FNS.pools = async (ctx, at) => {
    const r = await readPools(ctx, 'robinhood', at);
    return { ok: r.pages > 0, note: r.pools + ' pools from ' + r.pages + ' page' + (r.pages === 1 ? '' : 's') + ' (of at most ' + GT_PAGES.robinhood + ')' + (r.why ? ' — stopped at ' + r.why : '') };
  };
  FNS.poolsOther = async (ctx, at) => {
    const notes = []; let any = false;
    for (const key of GT_TRACKED) {
      if (key === 'robinhood') continue;
      const r = await readPools(ctx, key, at);
      if (r.pages) any = true;
      notes.push(key + ' ' + r.pools + (r.why ? ' (' + r.why + ')' : ''));
    }
    return { ok: any, note: notes.join(', ') };
  };
  /* ----- new pools on the other tracked networks, from GeckoTerminal ----- */
  const insNewPool = () => db.prepare('INSERT OR IGNORE INTO mkt_new_pool (chain, pool, dex, token0, token1, block, created_at, first_seen, extra) VALUES (?,?,?,?,?,?,?,?,?)');
  FNS.newPoolsGt = async (ctx) => {
    const ins = insNewPool(); let added = 0; const notes = [];
    for (const key of GT_TRACKED) {
      if (key === 'robinhood') continue;   // Robinhood Chain's are read from the chain itself
      const net = CHAIN_BY_KEY.get(key).gt;
      const r = await gtAsk(ctx, '/networks/' + net + '/new_pools?include=base_token,quote_token', { maxBytes: 2 * 1024 * 1024 });
      if (!r.ok) { notes.push(key + ': ' + r.reason); if (r.reason === 'budget') break; continue; }
      const rows = gtPoolRows(r.data, net);
      tx(() => { for (const x of rows) { const res = ins.run(key, x.pool, x.dex, x.base_addr, x.quote_addr, null, x.created_at, now(), JSON.stringify({ name: x.name, baseSymbol: x.base_symbol, quoteSymbol: x.quote_symbol })); added += res.changes; } });
    }
    dataVer++;
    return { ok: notes.length < GT_TRACKED.length - 1, note: added + ' new' + (notes.length ? '; not read: ' + notes.join(', ') : '') };
  };

  /* ----- Robinhood Chain's new pools, from its own logs, with a cursor in the database ----- */
  /* a range the node refused (more than 10,000 logs, or an answer too large) is read in halves, each halved again on a refusal */
  async function logsHalves(ctx, address, topic, from, to, depth = 0) {
    if (to - from < LOG_SPLIT_FLOOR || depth > 12) throw new Error('the node refused the log range ' + from + '–' + to + ' even at its smallest');
    const mid = Math.floor((from + to) / 2), out = [];
    for (const [a, b] of [[from, mid], [mid + 1, to]]) {
      const res = await rpcAsk(ctx, [['eth_getLogs', [{ fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16), address, topics: [topic] }]]]);
      out.push(...(Array.isArray(res[0]) ? res[0] : await logsHalves(ctx, address, topic, a, b, depth + 1)));
    }
    return out;
  }
  function poolRowsOfLogs(logs, ver) {
    const out = [];
    for (const l of logs || []) {
      if (!l || !Array.isArray(l.topics)) continue;
      const block = hexInt(l.blockNumber);
      if (ver === 'v2' && l.topics.length >= 3) { const pool = wordAddr(word(l.data, 0)); if (pool) out.push({ pool, token0: topicAddr(l.topics[1]), token1: topicAddr(l.topics[2]), block, extra: null }); }
      if (ver === 'v3' && l.topics.length >= 4) { const pool = wordAddr(word(l.data, 1)); if (pool) out.push({ pool, token0: topicAddr(l.topics[1]), token1: topicAddr(l.topics[2]), block, extra: { fee: hexInt(l.topics[3]), tickSpacing: hexInt(word(l.data, 0)) } }); }
      if (ver === 'v4' && l.topics.length >= 4 && POOL_ID_RE.test(l.topics[1])) out.push({ pool: lc(l.topics[1]), token0: topicAddr(l.topics[2]), token1: topicAddr(l.topics[3]), block, extra: { fee: hexInt(word(l.data, 0)), tickSpacing: hexInt(word(l.data, 1)), hooks: wordAddr(word(l.data, 2)) } });
    }
    return out;
  }
  FNS.newPoolsRh = async (ctx) => {
    const st = (stGet('rh_newpools') || {}).v || null;
    const head = hexInt((await rpcAsk(ctx, [['eth_blockNumber', []]]))[0]);
    if (!head) return { ok: false, note: 'the node did not give its head block' };
    // the first read goes a day back; if that failed (a slow node), the next first try reads a smaller window rather than failing the same way
    const prev = lastRun('newPoolsRh'), firstSpan = prev && !prev.ok && !(st && st.cursor) ? Math.floor(BLOCKS_PER_DAY_CEIL / 9) : BLOCKS_PER_DAY_CEIL;
    let from = st && st.cursor ? st.cursor + 1 : Math.max(1, head - firstSpan);
    const gaps = (st && Array.isArray(st.gaps)) ? st.gaps.slice(-20) : [];
    if (st && st.cursor && head - st.cursor > NEWPOOL_MAX_GAP) { const nf = head - BLOCKS_PER_DAY_CEIL; gaps.push([st.cursor + 1, nf - 1]); from = nf; }
    if (from > head) return { note: 'nothing new (cursor at the head)' };
    const kinds = [['v2', RH.v2Factory, RH.v2Topic], ['v3', RH.v3Factory, RH.v3Topic], ['v4', RH.poolManager, RH.v4Topic]];
    const calls = kinds.map(([, address, topic]) => ['eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16), address, topics: [topic] }]]);
    const res = await rpcAsk(ctx, calls);
    const ins = insNewPool(); const counts = { v2: 0, v3: 0, v4: 0 }; let added = 0; const all = [];
    for (let i = 0; i < kinds.length; i++) {
      const [ver, address, topic] = kinds[i];
      const logs = Array.isArray(res[i]) ? res[i] : await logsHalves(ctx, address, topic, from, head);   // a refused range (too many logs, too large) is read in halves
      const rows = poolRowsOfLogs(logs, ver);
      counts[ver] = rows.length;
      for (const r of rows) all.push(Object.assign({ ver }, r));
    }
    all.sort((a, b) => (a.block || 0) - (b.block || 0));   // ids follow the chain's own order
    const seenAt = now();
    tx(() => { for (const r of all) added += ins.run('robinhood', r.pool, r.ver, r.token0, r.token1, r.block, null, seenAt, r.extra ? JSON.stringify(r.extra) : null).changes; });
    stSet('rh_newpools', { cursor: head, start: st && st.start ? st.start : from, startAt: st && st.startAt ? st.startAt : now(), gaps });
    fillPulseCounts(head);
    dataVer++;
    return { note: 'blocks ' + from + '–' + head + ': v2 ' + counts.v2 + ', v3 ' + counts.v3 + ', v4 ' + counts.v4 + ' (' + added + ' new rows)' };
  };
  /* the blocks (a, b] were all read by the new-pools reader: none before where it started, none inside a gap it recorded
     (a cursor too far behind is not walked — the blocks it skipped are a gap, and a count over them would be a made-up 0) */
  function blocksRead(st, a, b) {
    if (!st || !st.cursor || !st.start || a < st.start || b > st.cursor) return false;
    return !(Array.isArray(st.gaps) ? st.gaps : []).some((g) => Array.isArray(g) && g[0] <= b && g[1] > a);
  }
  /* a pulse row's "pools created since the previous row", filled once the new-pools cursor has passed its block — exact, never
     a partial count: a row whose blocks were not all read stays null for good. Newest first, so rows that can never be filled
     (a gap's, the ones before the reader started) never hold back the ones that can. */
  function fillPulseCounts(cursor) {
    const st = (stGet('rh_newpools') || {}).v || {};
    const rows = db.prepare('SELECT id, block FROM mkt_rh_pulse WHERE pools_created_v2 IS NULL AND block IS NOT NULL AND block <= ? AND at > ? ORDER BY id DESC LIMIT 400').all(cursor, now() - 2 * DAY);
    const prevOf = db.prepare('SELECT block FROM mkt_rh_pulse WHERE id < ? AND block IS NOT NULL ORDER BY id DESC LIMIT 1');
    const cnt = db.prepare("SELECT dex, COUNT(*) n FROM mkt_new_pool WHERE chain = 'robinhood' AND block > ? AND block <= ? GROUP BY dex");
    const upd = db.prepare('UPDATE mkt_rh_pulse SET pools_created_v2 = ?, pools_created_v3 = ?, pools_created_v4 = ? WHERE id = ?');
    tx(() => {
      for (const r of rows) {
        const p = prevOf.get(r.id); if (!p || p.block == null || !blocksRead(st, p.block, r.block)) continue;
        const c = { v2: 0, v3: 0, v4: 0 }; for (const x of cnt.all(p.block, r.block)) if (x.dex in c) c[x.dex] = x.n;
        upd.run(c.v2, c.v3, c.v4, r.id);
      }
    });
  }

  /* ----- the Robinhood Chain pulse: one batch a minute; supplies and the PoolManager every 10 minutes; the bridge every 15 ----- */
  const BAL = (addr) => '0x70a08231' + addr.replace(/^0x/, '').padStart(64, '0');
  FNS.pulse = async (ctx, at) => {
    const calls = [['eth_blockNumber', []], ['eth_getBlockByNumber', ['latest', false]], ['eth_gasPrice', []],
      ['eth_call', [{ to: RH.arbGasInfo, data: RH.getPricesInWei }, 'latest']], ['eth_call', [{ to: RH.arbGasInfo, data: RH.getMinimumGasPrice }, 'latest']]];
    const lastSup = db.prepare('SELECT at FROM mkt_rh_pulse WHERE weth_supply IS NOT NULL ORDER BY id DESC LIMIT 1').get();
    const supDue = !lastSup || at - lastSup.at >= 10 * MIN - 5000;
    if (supDue) calls.push(['eth_call', [{ to: RH.weth, data: '0x18160ddd' }, 'latest']], ['eth_call', [{ to: RH.usdg, data: '0x18160ddd' }, 'latest']],
      ['eth_getBalance', [RH.poolManager, 'latest']], ['eth_call', [{ to: RH.weth, data: BAL(RH.poolManager) }, 'latest']], ['eth_call', [{ to: RH.usdg, data: BAL(RH.poolManager) }, 'latest']]);
    const r = await rpcAsk(ctx, calls);
    const blk = r[1] && typeof r[1] === 'object' ? r[1] : null;
    const block = (blk && hexInt(blk.number)) || hexInt(r[0]);
    const blockTs = blk ? hexInt(blk.timestamp) : null;
    if (!block) return { ok: false, note: 'the node gave no head block' };
    const prices = r[3];
    const row = { at, block, block_ts: blockTs, gas_price_wei: hexInt(r[2]), base_fee_wei: blk ? hexInt(blk.baseFeePerGas) : null,
      l1_price_wei: hexInt(word(prices, 1)), min_gas_wei: hexInt(word(r[4], 0)) };
    if (supDue) {
      const w = hexBig(r[5]), u = hexBig(r[6]), e = hexBig(r[7]), pw = hexBig(r[8]), pu = hexBig(r[9]);
      Object.assign(row, { weth_supply: units(w, 18), usdg_supply: units(u, RH.usdgDecimals), pm_eth: units(e, 18), pm_weth: units(pw, 18), pm_usdg: units(pu, RH.usdgDecimals) });
    }
    // block time: the mean over the last hour, from this block's timestamp and a stored one an hour back (never a per-block guess)
    const fit = (a) => (a && blockTs && a.block_ts && blockTs - a.block_ts >= 50 * 60 && blockTs - a.block_ts <= 3 * 3600 && block > a.block ? a : null);
    let anchor = fit(db.prepare('SELECT block, block_ts FROM mkt_rh_pulse WHERE block_ts IS NOT NULL AND at <= ? AND at >= ? ORDER BY id DESC LIMIT 1').get(at - 55 * MIN, at - 3 * HOUR));
    if (!anchor) { const sa = (stGet('pulse_anchor') || {}).v; if (sa && sa.block && sa.ts) anchor = fit({ block: sa.block, block_ts: sa.ts }); }
    if (!anchor && blockTs) {
      const back = Math.max(1, block - 36000);
      const a = await rpcAsk(ctx, [['eth_getBlockByNumber', ['0x' + back.toString(16), false]]]);
      const ab = a[0] && typeof a[0] === 'object' ? a[0] : null;
      if (ab && hexInt(ab.timestamp)) { anchor = fit({ block: back, block_ts: hexInt(ab.timestamp) }); stSet('pulse_anchor', { block: back, ts: hexInt(ab.timestamp) }); }
    }
    row.block_time_ms = anchor && blockTs && block - anchor.block >= 10000 ? ((blockTs - anchor.block_ts) * 1000) / (block - anchor.block) : null;
    // the bridge on Ethereum, every 15 minutes
    const lastBr = db.prepare('SELECT at FROM mkt_rh_pulse WHERE bridge_eth IS NOT NULL ORDER BY id DESC LIMIT 1').get();
    let brNote = '';
    if (!lastBr || at - lastBr.at >= 15 * MIN - 5000) {
      const b = await ethAsk(ctx, [['eth_blockNumber', []], ['eth_getBalance', [L1.bridge, 'latest']], ['eth_call', [{ to: L1.sequencerInbox, data: L1.batchCount }, 'latest']], ['eth_call', [{ to: L1.bridge, data: L1.delayedMessageCount }, 'latest']]]);
      if (b.ok) Object.assign(row, { l1_block: hexInt(b.out[0]), bridge_eth: units(hexBig(b.out[1]), 18), bridge_batches: hexInt(word(b.out[2], 0)), bridge_msgs: hexInt(word(b.out[3], 0)) });
      else brNote = '; the bridge could not be read (' + b.reason + ')';
    }
    const cols = Object.keys(row);
    db.prepare('INSERT INTO mkt_rh_pulse (' + cols.join(', ') + ') VALUES (' + cols.map(() => '?').join(',') + ')').run(...cols.map((c) => row[c] == null ? null : row[c]));
    dataVer++;
    return { note: 'block ' + block + (supDue ? ', supplies' : '') + (row.bridge_eth != null ? ', bridge' : '') + brNote };
  };

  /* ----- the radar sweep and the re-scan: the server's own code paths, run on a timer and recorded here ----- */
  FNS.radar = async (ctx) => {
    if (!hooks.radarSweep) return { ok: false, note: 'no radar in this process' };
    const r = await hooks.radarSweep(bgTools(ctx));
    if (!r || r.error) return { ok: false, note: 'the sweep did not run: ' + String((r && r.error) || 'no answer').slice(0, 200) };
    /* the server's background sweep hands back what it read (market: each pair's tokens, name and market figures, never a verdict);
       a hook that hands back the sweep's full profiles has them kept as they are */
    const n = Number.isInteger(r.persisted) ? r.persisted : r.market ? radarMarket(r.market, r.cursor, r.raw || []) : radarPersist(r.pairs || [], r.cursor, r.raw || []);
    return { note: n + ' pairs kept, cursor ' + (r.cursor || '-') + (r.note ? '; ' + String(r.note).slice(0, 200) : '') };
  };
  FNS.scans = async (ctx) => {
    if (!hooks.scanRefresh) return { ok: false, note: 'no scanner in this process' };
    const top = mostScanned(40), tools = bgTools(ctx);
    const lastOf = db.prepare('SELECT MAX(read_at) m FROM mkt_scan WHERE chain = ? AND address = ?');
    let ok = 0, cached = 0, fail = 0;
    for (const t of top) {
      // the newest reading of the token already kept, whoever made it: the hook keeps none that is not newer
      const held = { lastReadAt: (lastOf.get(t.chain, t.address) || {}).m || null };
      // cached: the hook read nothing, it handed over a reading the site already held — not counted as re-read
      try { const r = await hooks.scanRefresh(t.chain, t.address, tools, held); if (r && r.pair) { scanPut(t.chain, t.address, r.pair, { src: 'refresh', readAt: r.readAt, kind: 'token' }); if (r.cached) cached++; else ok++; } else fail++; }
      catch { fail++; }
    }
    return { note: top.length + ' tokens: ' + ok + ' re-read, ' + cached + ' kept from the token cache, ' + fail + ' not' };
  };

  /* ===== Robinhood Chain RWAs (owner, 2026-10-28: "a whole RWA section that just looks at Robinhood RWAs") =====================
     One job every 30 minutes; each part reads only when it is due, and a part that fails keeps the last good answer (served with
     its age and the failure's reason), never nothing in its place:
       · Robinhood's Stock Token API: the quotes every run; the registry, the corporate actions and the published deviations every
         6 h — on Robinhood's own meter and Market Data's share of it ('market:robinhood');
       · Chainlink's public feed directory for the chain, daily; DefiLlama's stablecoins and the per-app token deposits of the 12
         largest DeFi apps on the chain (lib/rwa.js tvlPicks), every 6 h;
       · the chain, at most RWA_RPC_MAX batches a run on Market Data's chain share (each yields while the site's own reads wait —
         and waits for them, RWA_YIELD_WAIT at a time, up to RWA_YIELD_BUDGET a run, before the part stands aside: on the live
         server a wallet walk keeps the shared pace queued for minutes, and giving up at the first busy moment left the supplies
         unread run after run):
         the beacon-slot fingerprint of every listed or hinted address not yet read (a rotating daily re-check of RWA_FP_SLICE
         after that), then the state in Multicall3 aggregate3 calls of at most R.MAX_SUBCALLS each (supplies, Robinhood's pause
         flags and multipliers, the registry, the issuers' beacons, the Chainlink feeds), then the registry's logs forward from a
         cursor in 10M-block windows (RWA_LOG_WINDOWS a run, until the walk is whole; again daily) and the role holders' code;
       · GeckoTerminal, on the collectors' share: one tokens/multi read per 30 RWA tokens, every RWA token in rotation (at most
         RWA_GT_MULTI a run — one basis for every token's liquidity and volume), and every 6 h the pools of the 12 RWAs with the most
         liquidity (RWA_GT_POOLS a run, so a round takes three runs; a failed read is tried again, RWA_GT_TRIES times a round at
         most). That is at most 7 / 30 min + 36 / 6 h ≈ 0.33 a minute on average on top of the other collectors' ≈ 1.93, under
         their share of 3 (tests/marketdata.mjs pins the sum). */
  const RWA_RH_SHARE = 'market:robinhood';
  const RWA_EVERY = { assets: 6 * HOUR, actions: 6 * HOUR, deviations: 6 * HOUR, chainlink: DAY, stables: 6 * HOUR, tvl: 6 * HOUR, connected: 6 * HOUR, roles: DAY, fingerprint: DAY };
  const RWA_GT_MULTI = 7, RWA_GT_POOLS = 4, RWA_TOP = 12, RWA_FP_MAX = 120, RWA_FP_SLICE = 40, RWA_RPC_MAX = 6, RWA_LOG_WINDOW = 10000000, RWA_LOG_WINDOWS = 4, RWA_ETH_CALLS_PER_BATCH = 5;
  const RWA_YIELD_WAIT = 20 * 1000, RWA_YIELD_BUDGET = 3 * MIN;
  const RWA_CODE_MAX = 40, RWA_CODE_REFS = 3, RWA_GT_TRIES = 3;   // code reads a run; the registry's own tokens read for the reference; tries of one RWA's pools a round
  const RWA_HINT_NAME = /•\s*Robinhood Token|\(Ondo Tokenized|\baStock\b|\bST0x\b/i;
  const stV = (name) => { const r = stGet(name); return r && r.v ? r.v : null; };
  // a read that was due: due when never read, when its last read is `every` old (a minute's slack, so a 30-minute run does not skip it), or a run after it failed
  const rwaDue = (rec, every, at) => !rec || !rec.readAt || (rec.failAt && rec.failAt >= rec.readAt ? at - rec.failAt >= 25 * MIN : at - rec.readAt >= every - MIN);
  const whyOf = (r, p) => (!r.ok ? (r.reason === 'budget' ? 'its meter was spent' : r.reason) : p.why);
  /* the run's note (mkt_runs keeps 290 characters): every part whole while they fit; past that, the reasons in brackets go first,
     from the last part back (each read's reason stays in its own mkt_state record), then whole parts from the end, counted ("+2 more")
     — never a part cut in the middle of a word */
  function fitNote(parts, max = 290) {
    const ps = parts.filter(Boolean).map(String), len = (a) => a.join('; ').length;
    const bare = (x) => { let y = x, z; do { z = y; y = y.replace(/\s*\([^()]*\)/g, ''); } while (y !== z); return y.replace(/\s+/g, ' ').trim(); };
    for (let i = ps.length - 1; i >= 0 && len(ps) > max; i--) ps[i] = bare(ps[i]);
    let dropped = 0;
    const out = () => ps.join('; ') + (dropped ? (ps.length ? '; ' : '') + '+' + dropped + ' more' : '');
    while (ps.length && out().length > max) { ps.pop(); dropped++; }
    return out().length > max ? out().slice(0, max) : out();
  }
  /* one keep-last-good read: the parsed answer replaces the stored one only when it parsed */
  async function rwaRead(ctx, name, url, o, parse, at) {
    const prev = stV(name);
    const r = await ask(ctx, url, o);
    const p = r.ok ? parse(r.data) : { ok: false };
    if (p.ok) { stSet(name, { readAt: at, data: p }); return { ok: true, p }; }
    const why = whyOf(r, p);
    stSet(name, Object.assign({}, prev || {}, { failAt: at, failWhy: why }));
    return { ok: false, why };
  }
  FNS.rwa = async (ctx, at) => {
    /* the run's note (mkt_runs keeps 290 characters; /admin shows it): what was read and what was not, each part short — the vendors'
       reads, then the chain's and GeckoTerminal's outcomes, and the DeFi apps last (their failures can be a long list); each read's
       own failure stays in its mkt_state record (failAt / failWhy) whatever the note has room for */
    const notes = [], readW = [], notW = [], said = (what, r) => (r.ok ? readW.push(what) : notW.push(what + ' (' + wordClip(r.why, 40) + ')'));
    let answered = 0, defiNote = null;
    const rh = { share: RWA_RH_SHARE, maxBytes: 4 * 1024 * 1024 };
    // ── Robinhood's Stock Token API ──
    if (rwaDue(stV('rhj_assets'), RWA_EVERY.assets, at)) { const r = await rwaRead(ctx, 'rhj_assets', urls.rhj + '/assets', rh, R.parseRhjAssets, at); said('registry', r); if (r.ok) answered++; }
    { const r = await rwaRead(ctx, 'rhj_prices', urls.rhj + '/prices', rh, R.parseRhjPrices, at); said('quotes', r); if (r.ok) answered++; }
    if (rwaDue(stV('rhj_actions'), RWA_EVERY.actions, at)) { const r = await rwaRead(ctx, 'rhj_actions', urls.rhj + '/corporate-actions', rh, R.parseRhjActions, at); said('corporate actions', r); if (r.ok) answered++; }
    if (rwaDue(stV('rhj_deviations'), RWA_EVERY.deviations, at)) { const r = await rwaRead(ctx, 'rhj_deviations', urls.rhj + '/price-deviations', rh, R.parseRhjDeviations, at); said('deviations', r); if (r.ok) answered++; }
    // ── Chainlink's directory, DefiLlama's stablecoins ──
    if (rwaDue(stV('chainlink_rh'), RWA_EVERY.chainlink, at)) { const r = await rwaRead(ctx, 'chainlink_rh', urls.chainlink, { maxBytes: 2 * 1024 * 1024 }, R.parseChainlinkDirectory, at); said('Chainlink directory', r); if (r.ok) answered++; }
    if (rwaDue(stV('rwa_stables'), RWA_EVERY.stables, at)) { const r = await rwaRead(ctx, 'rwa_stables', urls.stables + '/stablecoins?includePrices=true', { maxBytes: 8 * 1024 * 1024 }, R.parseStablecoins, at); said('stablecoins', r); if (r.ok) answered++; }
    if (readW.length) notes.push('read: ' + readW.join(', '));
    if (notW.length) notes.push('not read: ' + notW.join(', '));
    /* ── DefiLlama: the per-token deposits of the largest DeFi apps on the chain ──
       A round every 6 h. Between rounds, an app whose last read failed is tried again on the next run — never left 6 h behind a
       failure. A failed read keeps that app's last good deposits WITH THEIR OWN READ TIME (the answers date every figure by its
       oldest app, and name the app that failed) for up to R.TVL_KEEP; after that they are dropped, and the drop is said. */
    const tv = stV('rwa_tvl') || { reads: {} }, tvReads = tv.reads || {};
    const tvFailing = (r) => !!r && Number.isFinite(r.failAt) && r.failAt >= (r.at || 0);
    const tvRetry = (tv.picks || []).filter((slug) => tvFailing(tvReads[slug]) && at - tvReads[slug].failAt >= 25 * MIN);
    const tvRound = rwaDue(tv, RWA_EVERY.tvl, at);
    if (tvRound || tvRetry.length) {
      const list = (stV('rwa_protocols') || {}).protocols;
      if (!list) defiNote = 'DeFi deposits not read (DefiLlama\'s app list comes with the liquidity job, which has not run yet)';
      else {
        const picks = R.tvlPicks(list, RWA_TOP), reads = Object.assign({}, tvReads);
        const todo = tvRound ? picks : picks.filter((p) => tvRetry.includes(p.slug));
        let okNow = 0;
        for (const p of todo) {
          // a /protocol answer carries every chain's history: Morpho Blue's was 35.0 MB on 2026-10-28 and grows ~86 KB a day
          const r = await ask(ctx, urls.llama + '/protocol/' + encodeURIComponent(p.slug), { maxBytes: 64 * 1024 * 1024, timeoutMs: 60000 });
          const x = r.ok ? R.parseLlamaProtocol(r.data) : { ok: false };
          if (x.ok) { reads[p.slug] = { ok: true, at, name: x.name || p.name, category: x.category || p.category, date: x.date, tokens: x.tokens }; okNow++; continue; }
          const why = whyOf(r, x), prev = reads[p.slug];
          if (prev && prev.ok && Number.isFinite(prev.at) && at - prev.at <= R.TVL_KEEP) reads[p.slug] = Object.assign({}, prev, { failAt: at, failWhy: why });
          else reads[p.slug] = Object.assign({ ok: false, name: (prev && prev.name) || p.name, category: (prev && prev.category) || p.category, failAt: at, failWhy: why },
            prev && prev.ok ? { droppedAt: at, lastAt: prev.at } : prev && prev.droppedAt ? { droppedAt: prev.droppedAt, lastAt: prev.lastAt } : {});
        }
        for (const k of Object.keys(reads)) if (!picks.some((p) => p.slug === k)) delete reads[k];   // an app no longer among the largest drops out
        const failed = picks.filter((p) => tvFailing(reads[p.slug]) || !reads[p.slug]).map((p) => p.slug + ' (' + ((reads[p.slug] || {}).failWhy || 'not read') + ')');
        const rec = Object.assign({}, tv, { picks: picks.map((p) => p.slug), reads, failed });
        // a round is read when any app answered (the others are named, and tried again next run); with none, a failed round, tried again next run
        if (tvRound) { if (okNow) { rec.readAt = at; delete rec.failAt; delete rec.failWhy; } else Object.assign(rec, { failAt: at, failWhy: failed.join(', ') || 'no app was read' }); }
        stSet('rwa_tvl', rec);
        const goodN = picks.filter((p) => reads[p.slug] && reads[p.slug].ok).length;
        defiNote = 'DeFi ' + goodN + '/' + picks.length + ' apps' + (tvRound ? '' : ' (retried ' + todo.length + ')') + (failed.length ? ', not read: ' + failed.slice(0, 2).join(', ') + (failed.length > 2 ? ' +' + (failed.length - 2) : '') : '');
        if (okNow) answered++;
      }
    }
    dataVer++;
    // ── the chain ──
    try { const n = await rwaChain(ctx, at, notes); if (n) answered++; }
    catch (e) {
      const why = (e && e.yielded ? 'stood aside: ' : 'not read: ') + wordClip((e && e.message) || e, 120);
      notes.push('chain ' + why);
      stSet('rwa_chain', Object.assign(stV('rwa_chain') || {}, { failAt: at, failWhy: why }));
    }
    dataVer++;
    // ── GeckoTerminal ──
    try { const n = await rwaGecko(ctx, at, notes); if (n) answered++; }
    catch (e) { notes.push('GT not read: ' + wordClip((e && e.message) || e, 120)); }
    rwaSeen(at);
    dataVer++;
    if (defiNote) notes.push(defiNote);
    return { ok: answered > 0, note: fitNote(notes) };
  };
  /* the addresses whose fingerprint (beacon slot) is read: Robinhood's registry, this site's list, Robinhood's other answers, and the
     batch tokens whose CoinGecko id or name hints at an issuer (a hint picks what to check — only the chain's answer qualifies).
     In the order the fingerprints are read (RWA_FP_MAX a run): the addresses only Robinhood's other answers name first (WEEK: out of
     the registry's list, it is "not confirmed yet" until its slot is read, so it is read in the first run), this site's list, the
     registry's own tokens, then the hints. */
  function rwaCandidates() {
    const reg = new Set(), named = new Set(), hinted = new Set();
    for (const n of ['rhj_assets', 'rhj_prices', 'rhj_deviations', 'rhj_actions']) {
      const d = (stV(n) || {}).data || {};
      for (const a of d.assets || []) reg.add(a.address);
      for (const a of Object.keys(d.quotes || {})) named.add(a);
      for (const a of Object.keys(d.rows || {})) named.add(a);
      for (const a of d.actions || []) named.add(a.address);
    }
    for (const r of latestBatch('robinhood').rows) if (r.base_addr && EVM_RE.test(r.base_addr) && ((r.base_gecko_id && R.GECKO_RWA.test(r.base_gecko_id)) || RWA_HINT_NAME.test(r.base_name || ''))) hinted.add(r.base_addr);
    return [...new Set([...[...named].filter((a) => !reg.has(a)), ...R.CURATED.keys(), ...reg, ...named, ...hinted])].filter((a) => EVM_RE.test(a));
  }
  const hex32 = (h) => (typeof h === 'string' && /^0x[0-9a-f]{1,64}$/i.test(h) ? '0x' + h.slice(2).padStart(64, '0') : null);
  async function rwaChain(ctx, at, notes) {
    const ch = stV('rwa_chain') || {}; ch.tokens = ch.tokens || {}; ch.registry = ch.registry || {}; ch.beacons = ch.beacons || {}; ch.feeds = ch.feeds || {};
    delete ch.failAt; delete ch.failWhy;   // set again (FNS.rwa) if this run's chain part fails
    const roles = stV('rhj_roles') || {};
    const rolesDue = !roles.complete || !roles.walkedAt || at - roles.walkedAt >= RWA_EVERY.roles - MIN;
    let asks = 0, waited = 0;
    // (the site's own reads first: a batch that yields to them waits and asks again, within the run's budget — never past a refusal's
    // cool-down or a spent share, which end the part for this run)
    const askNode = async (calls) => {
      if (asks >= RWA_RPC_MAX) throw Object.assign(new Error('this run\'s chain reads are spent'), { yielded: true });
      asks++;
      for (;;) {
        try { return await rpcAsk(ctx, calls); }
        catch (e) {
          if (!(e && e.yielded) || /cooling down|budget is spent/.test(String(e.message)) || waited + RWA_YIELD_WAIT > RWA_YIELD_BUDGET) throw e;
          await sleep(RWA_YIELD_WAIT); waited += RWA_YIELD_WAIT;
        }
      }
    };
    const cands = rwaCandidates(), candSet = new Set(cands);
    // an address no longer a candidate (a hinted token gone from the pool batch) is dropped, never classified forever from an old read
    for (const a of Object.keys(ch.tokens)) if (!candSet.has(a)) delete ch.tokens[a];
    // 1. the fingerprints (and the head block)
    const unread = cands.filter((a) => !ch.tokens[a] || ch.tokens[a].fpAt == null).slice(0, RWA_FP_MAX);
    // the ones never read first (asked again every run until the node answers), then a daily re-check of the oldest, RWA_FP_SLICE a run
    const fp = unread.concat(cands.filter((a) => ch.tokens[a] && ch.tokens[a].fpAt != null && at - ch.tokens[a].fpAt >= RWA_EVERY.fingerprint).sort((a, b) => ch.tokens[a].fpAt - ch.tokens[b].fpAt).slice(0, RWA_FP_SLICE)).slice(0, RWA_FP_MAX);
    let head = null;
    if (fp.length || rolesDue) {
      const slotOf = (a) => (R.CURATED.get(a) && R.ISSUERS[R.CURATED.get(a).issuer].proxy === 'erc1967' ? R.SLOT.impl : R.SLOT.beacon);
      const res = await askNode([['eth_blockNumber', []], ...fp.map((a) => ['eth_getStorageAt', [a, slotOf(a), 'latest']])]);
      head = hexInt(res[0]);
      let n = 0;
      fp.forEach((a, i) => {
        const w = hex32(res[i + 1]); if (!w) return;   // the node gave nothing for this one: not read, asked again next run
        const t = ch.tokens[a] || (ch.tokens[a] = {}), addr = '0x' + w.slice(26).toLowerCase();
        if (slotOf(a) === R.SLOT.impl) { t.impl = addr; t.implAt = at; } else { t.beacon = addr; t.beaconAt = at; }
        t.fpAt = at; n++;
      });
      notes.push('fingerprints ' + n + '/' + fp.length);
      stSet('rwa_chain', ch);
    }
    /* 1b. the code check. A slot is any contract's to write, so an address the registry does not list whose beacon slot names the
       registry counts only when its runtime code is the very code the registry's own tokens run (an OpenZeppelin BeaconProxy with the
       registry as an immutable inside it: all 203 listed tokens ran the same 283 bytes on 2026-10-28). Compared by keccak with the code
       of a few of the registry's own tokens (read daily: the token of the same ticker first, then the registry's order). */
    const assetsList = (((stV('rhj_assets') || {}).data || {}).assets || []).map((x) => x.address), assets = new Set(assetsList);
    const REG = R.ISSUERS.rhj.registry, codeFresh = (t) => !!t && t.codeAt != null && at - t.codeAt < RWA_EVERY.fingerprint;
    const slotOnly = cands.filter((a) => !assets.has(a) && ch.tokens[a] && ch.tokens[a].beacon === REG);
    const codeDue = slotOnly.filter((a) => !codeFresh(ch.tokens[a])).slice(0, RWA_CODE_MAX);
    if (codeDue.length) {
      const known = assetsList.filter((a) => codeFresh(ch.tokens[a]) && ch.tokens[a].codeHash);
      const symOf = (a) => String((ch.tokens[a] && ch.tokens[a].symbol) || '').toUpperCase();
      const regSym = new Map(((((stV('rhj_assets') || {}).data || {}).assets) || []).map((x) => [String(x.symbol || '').toUpperCase(), x.address]));
      const twins = codeDue.map((a) => regSym.get(symOf(a))).filter(Boolean);
      const refs = known.length >= RWA_CODE_REFS ? [] : [...new Set(twins.concat(assetsList))].filter((a) => !codeFresh(ch.tokens[a])).slice(0, RWA_CODE_REFS - known.length);
      const want = codeDue.concat(refs.filter((a) => !codeDue.includes(a)));
      const res = await askNode(want.map((a) => ['eth_getCode', [a, 'latest']]));
      let got = 0;
      want.forEach((a, i) => {
        const c = res[i]; if (typeof c !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(c)) return;   // the node gave nothing: not read, asked again next run
        const t = ch.tokens[a] || (ch.tokens[a] = {});
        Object.assign(t, { codeHash: R.codeHash(c), codeLen: (c.length - 2) / 2, codeAt: at }); got++;
      });
      notes.push('code ' + got + '/' + want.length);
    }
    // each slot-only address's verdict: its code against the registry tokens' (read within two days); null while either is unread
    const refHashes = new Set(assetsList.map((a) => ch.tokens[a]).filter((t) => t && t.codeHash && t.codeAt != null && at - t.codeAt < 2 * DAY).map((t) => t.codeHash));
    for (const a of Object.keys(ch.tokens)) {
      const t = ch.tokens[a];
      if (assets.has(a) || t.beacon !== REG) { delete t.codeMatch; continue; }
      t.codeMatch = t.codeAt == null || !refHashes.size ? null : t.codeHash != null && refHashes.has(t.codeHash);
    }
    stSet('rwa_chain', ch);
    // 2. the state, in Multicall3 batches: Robinhood's token reads for the registry's tokens and the ones whose code matched
    const isRhj = (a) => assets.has(a) || (ch.tokens[a] && ch.tokens[a].beacon === REG && ch.tokens[a].codeMatch !== false);
    const isListed = (a) => isRhj(a) || R.CURATED.has(a);
    const rwaAddrs = cands.filter(isListed);
    const rhj = rwaAddrs.filter(isRhj);
    const meta = rwaAddrs.filter((a) => !assets.has(a) && (!ch.tokens[a] || ch.tokens[a].metaAt == null || at - ch.tokens[a].metaAt >= DAY));
    const beacons = [...new Set(Object.values(R.ISSUERS).flatMap((x) => x.beacons || []))];
    const feeds = (((stV('chainlink_rh') || {}).data || {}).feeds || []).filter((f) => f.ref !== false).map((f) => f.proxy);   // the feeds that price the share (GLD / USD prices the token's own DEX trading)
    // terms() is pure in Stock.sol (the same answer from every Stock Token): read from one, once a day
    const termsFrom = rhj.length && (!ch.registry.termsAt || at - ch.registry.termsAt >= DAY) ? rhj.find((a) => assets.has(a)) || rhj[0] : null;   // a token in the registry's own list first
    const subs = R.stateSubcalls({ supply: rwaAddrs, meta, rhj, beacons, termsFrom, feeds });
    const groups = R.chunk(R.chunk(subs, R.MAX_SUBCALLS), RWA_ETH_CALLS_PER_BATCH);
    let read = 0, gave = 0;
    try {
      for (const g of groups) {
        if (asks >= RWA_RPC_MAX - (rolesDue ? 2 : 0)) { notes.push('state cut short (reads spent)'); break; }
        const res = await askNode(g.map((part) => ['eth_call', [{ to: R.MULTICALL3, data: R.encodeAggregate3(part) }, 'latest']]));
        g.forEach((part, j) => {
          const out = R.decodeAggregate3(res[j]); if (!out) return;   // the node gave no multicall answer: these stay as last read
          gave++;
          part.forEach((s, i) => { rwaKeep(ch, s, R.decodeAs(s.type, out[i]), at); read++; });
        });
      }
    } finally {   // a batch that yields or is refused keeps what the batches before it read
      if (subs.length) { notes.push('state ' + read + '/' + subs.length + (groups.length && !gave && read === 0 ? ' (Multicall3 gave no answer)' : '')); if (read) ch.stateAt = at; }
      stSet('rwa_chain', ch);
    }
    // 3. the registry's logs: who holds which role, the wallets blocked, the upgrades and pauses
    if (rolesDue && head) {
      const r0 = roles.cursor != null ? roles.cursor + 1 : 0, wins = [];
      for (let a = r0; a <= head && wins.length < RWA_LOG_WINDOWS; a += RWA_LOG_WINDOW) wins.push([a, Math.min(head, a + RWA_LOG_WINDOW - 1)]);
      let st = roles, cursor = roles.cursor != null ? roles.cursor : -1;
      if (wins.length) {
        const res = await askNode(wins.map(([a, b]) => ['eth_getLogs', [{ fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16), address: R.ISSUERS.rhj.registry }]]));
        for (let i = 0; i < wins.length; i++) { if (!Array.isArray(res[i])) break; st = R.foldRegistryLogs(st, res[i]); cursor = wins[i][1]; }   // a window the node refused stops the walk there; the next run reads on from it
      }
      st = Object.assign({}, st, { cursor, head, readAt: at, complete: cursor >= head });
      if (st.complete) st.walkedAt = at;
      stSet('rhj_roles', st);
      notes.push('logs to block ' + cursor + (st.complete ? ' (whole)' : ' of ' + head));
      // the holders' kind: a contract or a wallet (a 7702-delegated wallet is a wallet)
      const kinds = Object.assign({}, st.kinds || {}), holders = [...new Set(Object.values(st.holders || {}).flatMap((h) => Object.keys(h)))].filter((a) => !kinds[a] || at - kinds[a].at >= DAY).slice(0, 60);
      if (holders.length && asks < RWA_RPC_MAX) {
        const res = await askNode(holders.map((a) => ['eth_getCode', [a, 'latest']]));
        holders.forEach((a, i) => { const k = codeKind(res[i]); if (k != null) kinds[a] = { kind: k ? 'contract' : 'wallet', at }; });
        stSet('rhj_roles', Object.assign({}, st, { kinds }));
      }
    }
    return read > 0 || (head != null);
  }
  // one subcall's answer, kept on the chain state (a revert is "no such function", stored as such — never false, never 0)
  function rwaKeep(ch, s, d, at) {
    const [who, what] = s.key.split('|');
    if (who === 'registry') {
      if (what === 'paused') Object.assign(ch.registry, d.absent ? { paused: null, pausedAbsent: true, at } : { paused: d.v, pausedAbsent: false, at });
      if (what === 'terms' && !d.absent) Object.assign(ch.registry, { terms: d.v, termsAt: at });
      return;
    }
    if (who === 'beacon') { ch.beacons[what] = d.absent ? { implementation: null, absent: true, at } : { implementation: d.v, at }; return; }
    if (what === 'round' || what === 'description') {
      const f = ch.feeds[who] || (ch.feeds[who] = {});
      if (what === 'round') Object.assign(f, d.absent ? { answer: null, updatedAt: null, absent: true, at } : { answer: d.v.answer.toString(), updatedAt: d.v.updatedAt, absent: false, at });
      else if (!d.absent) f.description = d.v;
      return;
    }
    const t = ch.tokens[who] || (ch.tokens[who] = {});
    if (what === 'supply') { if (d.absent) { t.supplyRaw = null; t.supplyAbsent = true; } else { t.supplyRaw = d.v.toString(); t.supplyAbsent = false; } t.supplyAt = at; }
    else if (what === 'name' || what === 'symbol') { if (!d.absent) t[what] = String(d.v).slice(0, what === 'name' ? 120 : 40); t.metaAt = at; }
    else if (what === 'decimals') { if (!d.absent && d.v <= 36n) t.decimals = Number(d.v); t.metaAt = at; }
    else if (what === 'tokenPaused' || what === 'oraclePaused') { t[what] = d.absent ? null : d.v; t[what + 'Absent'] = !!d.absent; t.stateAt = at; }
    else if (what === 'uiMultiplier' || what === 'newUIMultiplier' || what === 'effectiveAt') { t[what] = d.absent ? null : d.v.toString(); t.stateAt = at; }
  }
  async function rwaGecko(ctx, at, notes) {
    const gt = stV('rwa_gt') || { tokens: {} }; gt.tokens = gt.tokens || {};
    const base = rwaBase();
    /* tokens/multi for EVERY RWA token, the longest unread first (RWA_GT_MULTI calls of 30 a run cover 210; the rest the next run): one
       basis — GeckoTerminal's own per-token figures — for every token's liquidity and volume. An address asked about that the answer
       does not carry is kept as { absent, at }: "GeckoTerminal's token read (time) has no entry for it", never "not run yet". */
    const want = base.rows.map((r) => r.address).sort((x, y) => ((gt.tokens[x] || {}).at || 0) - ((gt.tokens[y] || {}).at || 0)), wantSet = new Set(want);
    for (const a of Object.keys(gt.tokens)) if (!wantSet.has(a)) delete gt.tokens[a];   // no longer an RWA here
    let asked = 0, got = 0, absent = 0, failed = 0, why = null;
    /* due every 30 minutes from the last run that asked (triedAt), whether or not it was answered; readAt moves only when a call
       parsed, so "the last good read" is always one that was read. A call that failed marks each of its tokens { failAt, failWhy }
       beside its last good entry: their figures keep their own time, and a token with none says the read failed, never "not run yet". */
    const lastTry = gt.triedAt || gt.readAt || 0;
    const gtDue = !lastTry || at - lastTry >= 30 * MIN - MIN;
    if (gtDue && want.length) {
      for (const part of R.chunk(want, 30).slice(0, RWA_GT_MULTI)) {
        const r = await gtAsk(ctx, '/networks/robinhood/tokens/multi/' + part.join(','), { maxBytes: 2 * 1024 * 1024 });
        asked++;
        const p = r.ok ? R.parseGtMulti(r.data) : { ok: false };
        if (!p.ok) {
          why = whyOf(r, p); failed++;
          for (const a of part) gt.tokens[a] = Object.assign({}, gt.tokens[a] || {}, { failAt: at, failWhy: String(why).slice(0, 160) });
          if (r.reason === 'budget') break;
          continue;
        }
        for (const a of part) { if (p.tokens[a]) { gt.tokens[a] = Object.assign(p.tokens[a], { at }); got++; } else { gt.tokens[a] = { absent: true, at }; absent++; } }
      }
      gt.triedAt = at; gt.calls = asked; gt.failedCalls = failed;
      if (got + absent > 0) gt.readAt = at;
      if (why) Object.assign(gt, { failAt: at, failWhy: why }); else { delete gt.failAt; delete gt.failWhy; }
      stSet('rwa_gt', gt);
      notes.push('GT tokens ' + got + (absent ? ' (' + absent + ' absent)' : '') + ' in ' + asked + ' calls' + (why ? ' (' + (failed < asked ? failed + ' failed: ' : '') + wordClip(why, 40) + ')' : ''));
    }
    /* the pools of the 12 RWAs with the most liquidity: a round every 6 h, RWA_GT_POOLS reads a run. A read that fails is tried again on
       the next runs (RWA_GT_TRIES in a round); the round is done when each was read well this round or tried that often — and the
       answers say which could not be read, never "no pool pairs it" for a read that failed. */
    const cn = stV('rwa_connected') || { reads: {} }; cn.reads = cn.reads || {};
    if (!cn.cycleAt || (cn.doneAt && at - cn.cycleAt >= RWA_EVERY.connected - MIN)) { cn.cycleAt = at; cn.doneAt = null; }
    if (gtDue) dataVer++;   // the 12 with the most liquidity, by the token read just made (the first run's too)
    const top = rwaBase().rows.filter((r) => r.liquidity.v != null).sort((x, y) => y.liquidity.v - x.liquidity.v).slice(0, RWA_TOP).map((r) => r.address);
    const okRound = (a) => !!cn.reads[a] && cn.reads[a].ok && (cn.reads[a].at || 0) >= cn.cycleAt;
    const tries = (a) => (cn.reads[a] && (cn.reads[a].triedAt || 0) >= cn.cycleAt ? cn.reads[a].tries || 1 : 0);
    const todo = top.filter((a) => !okRound(a) && tries(a) < RWA_GT_TRIES).sort((x, y) => tries(x) - tries(y)).slice(0, RWA_GT_POOLS);
    let pn = 0;
    for (const a of todo) {
      const n = tries(a) + 1;
      const r = await gtAsk(ctx, '/networks/robinhood/tokens/' + a + '/pools?page=1', { maxBytes: 2 * 1024 * 1024 });
      const p = r.ok ? R.parseGtTokenPools(r.data) : { ok: false };
      if (p.ok) { cn.reads[a] = { at, triedAt: at, tries: n, ok: true, pools: p.pools.slice(0, 30) }; pn++; }
      else { cn.reads[a] = Object.assign({}, cn.reads[a] || { ok: false, pools: [] }, { triedAt: at, tries: n, failAt: at, failWhy: whyOf(r, p) }); if (r.reason === 'budget') break; }
    }
    for (const k of Object.keys(cn.reads)) if (!top.includes(k) && at - (cn.reads[k].at || cn.reads[k].triedAt || 0) > 2 * DAY) delete cn.reads[k];
    cn.top = top;
    if (top.length && top.every((a) => okRound(a) || tries(a) >= RWA_GT_TRIES)) cn.doneAt = cn.doneAt || at;
    if (todo.length || !stV('rwa_connected')) stSet('rwa_connected', cn);
    if (todo.length) notes.push('GT pools ' + pn + '/' + todo.length);
    return got + pn;
  }
  /* the tokens the radar and the Scanner met that wear an RWA's ticker or name (lookalike candidates), kept with the RWA job */
  function rwaSeen(at) {
    const rows = rwaBase().rows; if (!rows.length) return;
    const tick = new Set(), names = new Set();
    for (const r of rows) { for (const t of [r.symbol, r.underlying.symbol]) if (t) tick.add(lc(t)); for (const n of [r.name, r.underlying.name]) if (n && n.length >= 3) names.add(lc(n)); }
    const out = [], seen = new Set();
    const take = (address, symbol, name, src) => { const a = lc(address); if (!EVM_RE.test(a) || seen.has(a) || !(tick.has(lc(symbol)) || names.has(lc(name)))) return; seen.add(a); out.push({ address: a, symbol: clip(symbol, 40), name: clip(name, 80), src }); };
    try { for (const r of db.prepare('SELECT token, symbol, name FROM mkt_radar WHERE token IS NOT NULL AND symbol IS NOT NULL ORDER BY updated_at DESC LIMIT 5000').all()) take(r.token, r.symbol, r.name, 'radar'); } catch {}
    try { for (const r of db.prepare("SELECT address, symbol, name FROM mkt_scan WHERE chain = 'robinhood' AND symbol IS NOT NULL AND at > ? GROUP BY address ORDER BY MAX(id) DESC LIMIT 20000").all(now() - 90 * DAY)) take(r.address, r.symbol, r.name, 'scan'); } catch {}
    stSet('rwa_seen', { at, tokens: out.slice(0, 500) });
  }

  /* The pulse rows of [lo, hi) once they are two days old: of each hour, the first row, the first with a supply reading and the
     first with a bridge reading are kept (the supplies come every 10 minutes and the bridge every 15, so the first row of an
     hour seldom has them, and the 30-day bridge chart would thin to a point or two a day). A removed row hands its pool counts
     on to the next row kept, so that row's count is still "since the row before"; when any removed row had none (its blocks
     were not all read), the row kept has none either — never a part of the count shown as all of it. */
  function thinPulse(lo, hi, bucket) {
    const rows = db.prepare('SELECT id, at, weth_supply, bridge_eth, pools_created_v2 v2, pools_created_v3 v3, pools_created_v4 v4 FROM mkt_rh_pulse WHERE at >= ? AND at < ? ORDER BY id ASC').all(lo, hi);
    if (!rows.length) return 0;
    const keep = new Set(), hours = new Map();
    for (const r of rows) {
      const h = Math.floor(r.at / bucket), k = hours.get(h) || {};
      if (!k.first) { k.first = true; keep.add(r.id); }
      if (!k.sup && r.weth_supply != null) { k.sup = true; keep.add(r.id); }
      if (!k.br && r.bridge_eth != null) { k.br = true; keep.add(r.id); }
      hours.set(h, k);
    }
    const upd = db.prepare('UPDATE mkt_rh_pulse SET pools_created_v2 = ?, pools_created_v3 = ?, pools_created_v4 = ? WHERE id = ?');
    const rm = db.prepare('DELETE FROM mkt_rh_pulse WHERE id = ?');
    let owed = null, n = 0;   // the counts of the rows removed since the last row kept: { v2, v3, v4, unread }
    const handOn = (r) => {
      if (!owed) return;
      if (r.v2 != null) { if (owed.unread) upd.run(null, null, null, r.id); else upd.run(r.v2 + owed.v2, r.v3 + owed.v3, r.v4 + owed.v4, r.id); }
      // a row with no count yet is filled later from the row kept before it, which already spans the removed rows' blocks
      owed = null;
    };
    tx(() => {
      for (const r of rows) {
        if (keep.has(r.id)) { handOn(r); continue; }
        if (!owed) owed = { v2: 0, v3: 0, v4: 0, unread: false };
        if (r.v2 == null || r.v3 == null || r.v4 == null) owed.unread = true; else { owed.v2 += r.v2; owed.v3 += r.v3; owed.v4 += r.v4; }
        n += rm.run(r.id).changes || 0;
      }
      // what the window's last rows owe goes to the first row after it (the next hour's first, which is kept when its turn comes)
      if (owed) { const next = db.prepare('SELECT id, pools_created_v2 v2, pools_created_v3 v3, pools_created_v4 v4 FROM mkt_rh_pulse WHERE at >= ? ORDER BY id ASC LIMIT 1').get(hi); if (next) handOn(next); }
    });
    return n;
  }

  /* ----- pruning, hourly ----- */
  FNS.prune = async () => {
    const t = now(), notes = [];
    const del = (sql, ...a) => { try { const r = db.prepare(sql).run(...a); return r.changes || 0; } catch (e) { notes.push(String(e.message).slice(0, 80)); return 0; } };
    /* Thinning works on whole buckets (an hour, a UTC day) that have just crossed their age, from a watermark kept in mkt_state:
       each hourly run reads only the hour or day that newly aged, never the millions of rows already thinned (node:sqlite is
       synchronous — a full rescan every hour would hold the server for seconds). */
    const wm = (stGet('prune') || {}).v || {};
    const thin = (name, age, bucket, run) => {
      const lo = Number(wm[name]) || 0, hi = Math.floor((t - age) / bucket) * bucket;
      if (hi <= lo) return 0;
      const n = run(lo, hi, bucket);
      wm[name] = hi;
      return n;
    };
    const bySql = (sqlOf) => (lo, hi, b) => del(sqlOf(b), lo, hi, lo, hi);
    delete wm.chain14;   // the 14-day tier it marked is now 7 days (chain7)
    // chains: every run for 7 days, then the last row of each chain per UTC day
    notes.push('chains ' + thin('chain7', 7 * DAY, DAY, bySql((b) => 'DELETE FROM mkt_chain_snap WHERE at >= ? AND at < ? AND id NOT IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY chain, at / ' + b + ' ORDER BY at DESC, id DESC) rn FROM mkt_chain_snap WHERE at >= ? AND at < ?) WHERE rn = 1)')));
    /* pools: every batch 7 days. Then Robinhood Chain's first batch of each hour to 90 days and the first of each UTC day after
       that; the other networks, read hourly (60 pools each, eight networks: a million rows over 90 days of hours), go straight
       to the first batch of each UTC day — the batch a custom window there reads anyway. */
    const poolThin = (where) => bySql((b) => 'DELETE FROM mkt_pool_snap WHERE at >= ? AND at < ? AND ' + where + ' AND (network, at) NOT IN (SELECT network, MIN(at) FROM mkt_pool_snap WHERE at >= ? AND at < ? AND ' + where + ' GROUP BY network, at / ' + b + ')');
    const RH_NET = "network = 'robinhood'", OTHER_NETS = "network <> 'robinhood'";
    notes.push('pools ' + (thin('pool7', 7 * DAY, HOUR, poolThin(RH_NET)) + thin('pool90', 90 * DAY, DAY, poolThin(RH_NET)) + thin('poolOther7', 7 * DAY, DAY, poolThin(OTHER_NETS))));
    // the pulse: every row 2 days, then the rows thinPulse keeps of each hour
    notes.push('pulse ' + thin('pulse2', 2 * DAY, HOUR, thinPulse));
    stSet('prune', wm);
    // new pools: Robinhood Chain's (read from its own logs, a few hundred a day) 30 days; the other networks' (GeckoTerminal's newest, thousands a day) 7
    notes.push('new pools ' + (del("DELETE FROM mkt_new_pool WHERE first_seen < ? AND chain = 'robinhood'", t - 30 * DAY) + del("DELETE FROM mkt_new_pool WHERE first_seen < ? AND chain <> 'robinhood'", t - 7 * DAY)));
    // scans: 90 days, and scanTrim's caps; after a day only each token's newest row keeps the full profile
    notes.push('scans ' + (del('DELETE FROM mkt_scan WHERE at < ?', t - 90 * DAY) + scanTrim()));
    try { db.prepare('UPDATE mkt_scan SET json = NULL WHERE json IS NOT NULL AND at < ? AND id NOT IN (SELECT MAX(id) FROM mkt_scan GROUP BY chain, address)').run(t - DAY); } catch {}
    // the radar: the newest 5,000 pairs; the full profile on the newest 200
    notes.push('radar ' + del('DELETE FROM mkt_radar WHERE id NOT IN (SELECT id FROM mkt_radar ORDER BY updated_at DESC LIMIT 5000)'));
    try { db.prepare('UPDATE mkt_radar SET json = NULL WHERE json IS NOT NULL AND id NOT IN (SELECT id FROM mkt_radar ORDER BY updated_at DESC LIMIT 200)').run(); } catch {}
    notes.push('runs ' + del('DELETE FROM mkt_runs WHERE at < ?', t - 14 * DAY));
    dataVer++;
    return { note: 'removed: ' + notes.join(', ') };
  };

  /* ===================================================================================================================
     WHAT THE SCANNER AND THE RADAR KEEP
     =================================================================================================================== */
  const SCAN_FOLD_MS = 10 * MIN, SCAN_JSON_MAX = 400 * 1024;
  /* Anyone can scan (40 a minute per address, no sign-in, three chains), so the scans are bounded by more than their age: the
     newest SCAN_KEEP rows, and the full profiles on the newest rows up to SCAN_JSON_BUDGET bytes together (the Scanner's own
     stores are capped the same way: SCANS_KEEP, TOKEN_CACHE_KEEP). Checked every SCAN_TRIM_EVERY new rows and by the prune. */
  const SCAN_KEEP = deps.scanKeep || 100000, SCAN_JSON_BUDGET = deps.scanJsonBudget || 64 * 1024 * 1024, SCAN_TRIM_EVERY = 200;
  let scanAdds = 0;
  function scanTrim() {
    let n = 0;
    try {
      n = db.prepare('DELETE FROM mkt_scan WHERE id <= (SELECT MAX(id) FROM mkt_scan) - ?').run(SCAN_KEEP).changes || 0;
      db.prepare('UPDATE mkt_scan SET json = NULL WHERE id IN (SELECT id FROM (SELECT id, SUM(LENGTH(CAST(json AS BLOB))) OVER (ORDER BY id DESC) kept FROM mkt_scan WHERE json IS NOT NULL) WHERE kept > ?)').run(SCAN_JSON_BUDGET);
    } catch (e) { log('[market] scans not trimmed: ' + ((e && e.message) || e)); }
    return n;
  }
  function pairFacts(pair) {
    const p = pair || {}, t = p.token || {}, m = p.market || {}, r = p.risk || {};
    const flags = Object.keys(r).filter((k) => r[k] === true).slice(0, 30);   // the risk flags that were set
    return {
      symbol: clip(t.symbol, 40), name: clip(t.name, 80), price_usd: num(m.priceUsd), mcap: num(m.marketCap), fdv: num(m.fdv),
      liquidity_usd: num(m.liquidityTotalUsd) != null ? num(m.liquidityTotalUsd) : num(m.liquidityUsd), volume_24h: num(p.volume && p.volume.h24),
      verdict: clip(r.triage, 20), health: Number.isFinite(r.health) ? Math.round(r.health) : null, holders: num(p.holders && p.holders.count), risk: flags.length ? JSON.stringify(flags) : null,
    };
  }
  /* every scan is kept: one row per token per source per ten-minute slot of the clock (a crowd scanning one coin is one row, its
     n counts them). The slot is fixed, never "ten minutes since the last scan": a coin scanned every few minutes would stay one
     row for weeks, its earlier readings overwritten and its n counted as the last 7 days' */
  function scanPut(chain, address, pair, o = {}) {
    try {
      const ch = String(chain || ''), addr = ch === 'solana' ? String(address || '') : lc(address);
      if (!ch || !addr || !pair) return false;
      const f = pairFacts(pair), src = o.src || 'scan', t = now();
      let j = null; try { j = JSON.stringify(pair); if (j.length > SCAN_JSON_MAX) j = null; } catch { j = null; }
      const last = db.prepare('SELECT id, at FROM mkt_scan WHERE chain = ? AND address = ? AND src = ? ORDER BY id DESC LIMIT 1').get(ch, addr, src);
      if (last && t >= last.at && Math.floor(t / SCAN_FOLD_MS) === Math.floor(last.at / SCAN_FOLD_MS)) {
        db.prepare('UPDATE mkt_scan SET at = ?, read_at = ?, n = n + 1, kind = ?, symbol = ?, name = ?, price_usd = ?, mcap = ?, fdv = ?, liquidity_usd = ?, volume_24h = ?, verdict = ?, health = ?, holders = ?, risk = ?, json = COALESCE(?, json) WHERE id = ?')
          .run(t, o.readAt || t, clip(o.kind, 10), f.symbol, f.name, f.price_usd, f.mcap, f.fdv, f.liquidity_usd, f.volume_24h, f.verdict, f.health, f.holders, f.risk, j, last.id);
      } else {
        db.prepare('INSERT INTO mkt_scan (chain, address, at, read_at, src, n, kind, symbol, name, price_usd, mcap, fdv, liquidity_usd, volume_24h, verdict, health, holders, risk, json) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(ch, addr, t, o.readAt || t, src, clip(o.kind, 10), f.symbol, f.name, f.price_usd, f.mcap, f.fdv, f.liquidity_usd, f.volume_24h, f.verdict, f.health, f.holders, f.risk, j);
        if (++scanAdds >= SCAN_TRIM_EVERY) { scanAdds = 0; scanTrim(); }
      }
      dataVer++;
      return true;
    } catch (e) { log('[market] scan not kept: ' + ((e && e.message) || e)); return false; }
  }
  // the tokens people scanned most in the last 7 days (the hourly re-scan's own reads do not count)
  function mostScanned(n) {
    try { return db.prepare("SELECT chain, address, SUM(n) scans FROM mkt_scan WHERE at > ? AND src IN ('scan', 'market') GROUP BY chain, address ORDER BY scans DESC, MAX(at) DESC LIMIT ?").all(now() - 7 * DAY, n); } catch { return []; }
  }
  /* the radar's pairs, kept across restarts (they lived in memory only), with the block it has read up to */
  function radarPersist(pairs, cursor, raw) {
    const t = now();
    const up = db.prepare(`INSERT INTO mkt_radar (pair, token, token0, token1, quote, quote_symbol, symbol, name, created_block, created_at, price_usd, liquidity_usd, mcap, fdv, volume_24h, health, verdict, risk, json, first_seen, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pair) DO UPDATE SET token = excluded.token, token0 = COALESCE(excluded.token0, token0), token1 = COALESCE(excluded.token1, token1), quote = COALESCE(excluded.quote, quote), quote_symbol = excluded.quote_symbol,
        symbol = excluded.symbol, name = excluded.name, created_block = COALESCE(excluded.created_block, created_block), created_at = COALESCE(excluded.created_at, created_at),
        price_usd = excluded.price_usd, liquidity_usd = excluded.liquidity_usd, mcap = excluded.mcap, fdv = excluded.fdv, volume_24h = excluded.volume_24h,
        health = excluded.health, verdict = excluded.verdict, risk = excluded.risk, json = COALESCE(excluded.json, json), updated_at = excluded.updated_at`);
    const rawBy = new Map((raw || []).filter((x) => x && x.pair).map((x) => [lc(x.pair), x]));
    let n = 0;
    tx(() => {
      for (const p of pairs || []) {
        const pa = lc(p && p.pair && p.pair.address); if (!EVM_RE.test(pa)) continue;
        const rw = rawBy.get(pa) || {}, f = pairFacts(p);
        let j = null; try { j = JSON.stringify(p); if (j.length > SCAN_JSON_MAX) j = null; } catch {}
        const t0 = lc(rw.token0 || (p.pair && p.pair.token0)) || null, t1 = lc(rw.token1 || (p.pair && p.pair.token1)) || null, tok = lc(p.token && p.token.address) || null;
        up.run(pa, tok, t0, t1, t0 && tok && t0 !== tok ? t0 : t1 && tok && t1 !== tok ? t1 : null, clip(p.pair && p.pair.quoteSymbol, 16), f.symbol, f.name,
          Number.isInteger(rw.block) ? rw.block : null, num(p.pair && p.pair.createdAt) || null, f.price_usd, f.liquidity_usd, f.mcap, f.fdv, f.volume_24h, f.health, f.verdict, f.risk, j, t, t);
        n++;
      }
      // pairs the sweep found but has not enriched yet keep their place too (and their tokens), so a restart resumes from them
      for (const rw of raw || []) {
        const pa = lc(rw && rw.pair); if (!EVM_RE.test(pa) || (pairs || []).some((p) => lc(p && p.pair && p.pair.address) === pa)) continue;
        db.prepare('INSERT OR IGNORE INTO mkt_radar (pair, token0, token1, created_block, first_seen, updated_at) VALUES (?,?,?,?,?,?)').run(pa, lc(rw.token0) || null, lc(rw.token1) || null, Number.isInteger(rw.block) ? rw.block : null, t, t);
      }
    });
    if (Number.isInteger(cursor) && cursor > 0) stSet('radar', { cursor });
    dataVer++;
    return n;
  }
  /* the background sweep's reading (no member is looking): each pair's tokens, name and market figures as read, and nothing it did not
     read. It judges nothing, so the row it writes has no health, verdict, flags or profile — an older verdict is never left standing
     beside newer figures; a member's sweep (radarPersist) writes them again. A name it did not read keeps the one the row had. */
  function radarMarket(rows, cursor, raw) {
    const t = now();
    const up = db.prepare(`INSERT INTO mkt_radar (pair, token, token0, token1, quote, quote_symbol, symbol, name, created_block, created_at, price_usd, liquidity_usd, mcap, fdv, volume_24h, first_seen, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(pair) DO UPDATE SET token = COALESCE(excluded.token, token), token0 = COALESCE(excluded.token0, token0), token1 = COALESCE(excluded.token1, token1), quote = COALESCE(excluded.quote, quote),
        quote_symbol = COALESCE(excluded.quote_symbol, quote_symbol), symbol = COALESCE(excluded.symbol, symbol), name = COALESCE(excluded.name, name),
        created_block = COALESCE(excluded.created_block, created_block), created_at = COALESCE(excluded.created_at, created_at),
        price_usd = excluded.price_usd, liquidity_usd = excluded.liquidity_usd, mcap = excluded.mcap, fdv = excluded.fdv, volume_24h = excluded.volume_24h,
        health = NULL, verdict = NULL, risk = NULL, json = NULL, updated_at = excluded.updated_at`);
    const addr = (a) => (EVM_RE.test(lc(a)) ? lc(a) : null);
    let n = 0;
    tx(() => {
      for (const r of rows || []) {
        const pa = addr(r && r.pair); if (!pa) continue;
        up.run(pa, addr(r.token), addr(r.token0), addr(r.token1), addr(r.quote), clip(r.quoteSymbol, 16), clip(r.symbol, 40), clip(r.name, 80), Number.isInteger(r.block) ? r.block : null, num(r.createdAt),
          num(r.priceUsd), num(r.liquidityUsd), num(r.mcap), num(r.fdv), num(r.volume24), t, t);
        n++;
      }
    });
    radarPersist([], cursor, raw);   // the pairs it found but did not price keep their place, and the cursor is kept
    return n;
  }
  /* what a restart needs to resume the radar where it stopped: its cursor and its newest raw pairs */
  function radarRestore(n = 120) {
    const st = stGet('radar');
    let raw = [];
    try { raw = db.prepare('SELECT pair, token0, token1, created_block block FROM mkt_radar WHERE token0 IS NOT NULL AND token1 IS NOT NULL AND created_block IS NOT NULL ORDER BY created_block DESC LIMIT ?').all(n).reverse(); } catch {}
    return { cursor: st && st.v && Number.isInteger(st.v.cursor) ? st.v.cursor : 0, raw: raw.map((r) => ({ pair: r.pair, token0: r.token0, token1: r.token1, block: r.block })) };
  }

  /* ===================================================================================================================
     THE ANSWERS
     =================================================================================================================== */
  const SOURCES = {
    defillama: { id: 'defillama', name: 'DefiLlama', url: 'https://defillama.com' },
    l2beat: { id: 'l2beat', name: 'L2BEAT', url: 'https://l2beat.com/scaling/summary' },
    growthepie: { id: 'growthepie', name: 'growthepie', url: 'https://www.growthepie.com', licence: 'CC BY 4.0', attribution: 'Source: growthepie (CC BY 4.0)' },
    geckoterminal: { id: 'geckoterminal', name: 'GeckoTerminal', url: 'https://www.geckoterminal.com' },
    dexscreener: { id: 'dexscreener', name: 'Dexscreener', url: 'https://dexscreener.com' },
    coingecko: { id: 'coingecko', name: 'CoinGecko', url: 'https://www.coingecko.com' },
    coinlore: { id: 'coinlore', name: 'CoinLore', url: 'https://www.coinlore.com' },
    rpc: { id: 'rpc', name: 'Robinhood Chain (its public node), read by this site', url: 'https://docs.robinhood.com/chain/' },
    ethrpc: { id: 'rpc', name: 'Ethereum (a public node), read by this site', url: 'https://ethereum.org' },
    site: { id: 'site', name: 'This site\'s own records', url: 'https://sendrh.com/market' },
    robinhood: { id: 'robinhood', name: 'Robinhood\'s Stock Token API (api.robinhood.com/rhj)', url: 'https://docs.robinhood.com/chain/stock-token-apis/' },
    chainlink: { id: 'chainlink', name: 'Chainlink price feeds, read on Robinhood Chain', url: 'https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood' },
  };
  /* ----- time windows ----- */
  const WIN_LABEL = { '5m': 'last 5 minutes', '1h': 'last hour', '6h': 'last 6 hours', '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' };
  function parseWindow(q, allowed) {
    const kind = String(q.window || allowed[0]);
    if (!allowed.includes(kind) && kind !== 'custom') return { error: 'window is one of ' + allowed.join(', ') + ', custom' };
    if (kind !== 'custom') return { w: { kind, label: WIN_LABEL[kind] } };
    const from = String(q.from || ''), to = String(q.to || '');
    if (!validDay(from) || !validDay(to)) return { error: 'a custom window takes from= and to= as YYYY-MM-DD (whole UTC days)' };
    if (from > to) return { error: 'from is after to' };
    const today = dayOf(now());
    if (to >= today) return { error: 'to must be a whole UTC day that has ended (' + addDays(today, -1) + ' or earlier)' };
    const days = Math.round((dayStart(to) - dayStart(from)) / DAY) + 1;
    if (days > 3660) return { error: 'a custom window is at most ten years' };
    return { w: { kind: 'custom', from, to, days, label: from === to ? from + ' (UTC)' : from + ' to ' + to + ' (UTC, ' + days + ' days)', note: 'Whole UTC days, both ends included.' } };
  }
  const nullLast = (dir, get) => (a, b) => {
    const x = get(a), y = get(b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return dir === 'asc' ? x - y : y - x;
  };
  /* ----- the chains ----- */
  function seriesCoverage() {
    return memoize('cov', 60000, () => {
      const m = new Map();
      try { for (const r of db.prepare('SELECT chain, metric, MIN(day) a, MAX(day) b, COUNT(*) n, MAX(at) at FROM mkt_chain_series GROUP BY chain, metric').all()) m.set(r.chain + '|' + r.metric, r); } catch {}
      return m;
    });
  }
  function seriesSum(metric, from, to) {
    return memoize('ss|' + metric + from + to, 60000, () => {
      const m = new Map();
      try { for (const r of db.prepare('SELECT chain, SUM(value) s, COUNT(*) n, MAX(at) at, MAX(src) src FROM mkt_chain_series WHERE metric = ? AND day BETWEEN ? AND ? GROUP BY chain').all(metric, from, to)) m.set(r.chain, r); } catch {}
      return m;
    });
  }
  function seriesAt(metric, day) {
    return memoize('sa|' + metric + day, 60000, () => {
      const m = new Map();
      try { for (const r of db.prepare('SELECT chain, value, at, src FROM mkt_chain_series WHERE metric = ? AND day = ?').all(metric, day)) m.set(r.chain, r); } catch {}
      return m;
    });
  }
  /* a flow (volume, fees) summed over whole days: only when every day of the window is in the history, else why not */
  function flowOver(chain, metric, w, label) {
    const cov = seriesCoverage().get(chain + '|' + metric);
    if (!cov) return none(metric === 'fees' ? 'no daily gas-fee history for this chain (growthepie covers 27 chains)' : 'no daily history for this chain (histories are read for the top 40 chains by TVL)', 'site');
    if (w.from < cov.a) return none('our history starts ' + cov.a, cov.src || 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    if (w.to > cov.b) return none('our history ends ' + cov.b + ' (the newest whole day read so far)', 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    const s = seriesSum(metric, w.from, w.to).get(chain);
    if (!s || s.n !== w.days) return none('our history is missing ' + (w.days - ((s && s.n) || 0)) + ' of these ' + w.days + ' days', 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    return fig(s.s, s.src, s.at, { label, days: w.days });
  }
  /* the last 7 whole UTC days the history holds (DefiLlama's newest whole day reaches us within hours of midnight: until then the
     window ends a day earlier, and its label says which days it is) */
  function last7(chain, metric, label) {
    const today = dayOf(now()), cov = seriesCoverage().get(chain + '|' + metric);
    const end = cov && cov.b < addDays(today, -1) ? cov.b : addDays(today, -1);
    if (cov && end < addDays(today, -3)) return none('our daily history ends ' + cov.b + ', more than two days ago', 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    return flowOver(chain, metric, { from: addDays(end, -6), to: end, days: 7 }, label + ' (' + addDays(end, -6) + ' to ' + end + ', UTC)');
  }
  /* a stock (TVL, stablecoins) over whole days: the end value, with the start and the change */
  function stockOver(chain, metric, w, label) {
    const cov = seriesCoverage().get(chain + '|' + metric);
    if (!cov) return none('no daily history for this chain (histories are read for the top 40 chains by TVL)', 'site');
    if (w.from < cov.a) return none('our history starts ' + cov.a, 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    const a = seriesAt(metric, w.from).get(chain), b = seriesAt(metric, w.to).get(chain);
    if (!a || !b) return none('our history has no value for ' + (!a ? w.from : w.to), 'site', cov.at, { coverage: { from: cov.a, to: cov.b } });
    return fig(b.value, b.src, b.at, { label, start: a.value, startDay: w.from, endDay: w.to, change: a.value ? ((b.value - a.value) / a.value) * 100 : null });
  }
  const parseSrc = (row) => safeParse(row && row.src, {});
  // The newest L2BEAT read, for the figures a chain snapshot copies from it: the snapshot is taken every
  // 30 minutes and can predate L2BEAT's hourly read, so the card would say "not read yet" above L2BEAT's own breakdown.
  let l2Idx = null;
  function l2Now(key, name) {
    let at = null;
    try { const r = db.prepare('SELECT at FROM mkt_state WHERE name = ?').get('l2beat'); at = r ? r.at : null; } catch {}
    if (at == null) return null;
    if (!l2Idx || l2Idx.at !== at) {
      const l2 = stGet('l2beat'), projects = (l2 && l2.v && l2.v.projects) || {};
      l2Idx = { at, projects, byName: new Map(Object.entries(projects).map(([slug, p]) => [lc(p.name), slug])) };
    }
    const ch = CHAIN_BY_KEY.get(key), slug = (ch && ch.l2beat) || l2Idx.byName.get(lc(name)) || null;
    return { at, slug, p: slug ? l2Idx.projects[slug] || null : null };
  }
  /* the market cap's cross-check, as stored (mcap_check), or what a row kept before the check began can say: one source */
  function mcapCheckOf(row, s) {
    const k = safeParse(row.mcap_check, null);
    const pick = (o) => ({ status: o.status, sources: o.sources, notes: o.notes, mapping: o.mapping, coin: o.coin ? { id: o.coin.id, symbol: o.coin.symbol || null, name: o.coin.name || null } : null });
    if (k && typeof k === 'object' && ['agreed', 'differs', 'single', 'none'].includes(k.status)) {
      return { served: pick({ status: k.status, sources: Array.isArray(k.sources) ? k.sources : [], notes: Array.isArray(k.notes) ? k.notes : [], mapping: k.mapping && k.mapping.status ? k.mapping : { status: 'unchecked' }, coin: k.coin }), via: k.via || null, shared: Array.isArray(k.shared) ? k.shared : null };
    }
    if (!row.native_token) return { served: pick({ status: 'none', sources: [], notes: [], mapping: { status: 'unchecked', note: 'no token of its own to check' }, coin: null }), via: null, shared: null };
    const x = (s && s.mcap) || {}, v = row.mcap > 0 ? row.mcap : null;
    return { served: pick({ status: v != null ? 'single' : 'none', sources: v != null ? [{ src: x.src || 'defillama', v, price: null, supply: null, at: x.at || row.at }] : [],
      notes: ['read before the cross-check began (2026-10-28): one source, not checked'], mapping: { status: 'unchecked' }, coin: { id: row.native_token, symbol: row.native_symbol || null, name: null } }), via: null, shared: null };
  }
  function chainFigures(row, w, opts = {}) {
    const s = parseSrc(row), at = row.at;
    const F = (v, k, label, extra) => { const x = s[k] || {}; return x.why ? none(x.why, x.src || 'site', at, Object.assign({ label }, extra)) : fig(v, x.src || 'defillama', x.at || at, Object.assign({ label }, extra)); };
    const tvlNow = F(row.tvl, 'tvl', 'DeFi TVL (DefiLlama), now');
    const liq = F(row.dex_liq, 'liq', 'DEX liquidity: TVL of the chain\'s DEX protocols (DefiLlama), now');
    const ownTok = row.native_symbol || row.native_token;
    const chk = mcapCheckOf(row, s);
    const mcapLabel = (row.native_token ? (ownTok ? String(ownTok).toUpperCase() : row.native_token) + (row.gas_token && row.gas_token === row.native_token ? ' (gas token)' : row.gas_token === 'ethereum' ? ' (the chain\'s own token; gas is paid in ETH)' : ' (the chain\'s own token)') + ', market cap' : 'Market cap of the chain\'s own token')
      + (chk.via === 'relay' ? ' — CoinGecko\'s figure, relayed by DefiLlama' : chk.via === 'coinlore' ? ' — CoinLore\'s figure, the only source with one' : '')
      + (chk.shared && chk.shared.length ? ' — the same token\'s market cap as ' + chk.shared.join(', ') + '\'s (one token, shared)' : '');
    // a 0 kept before 2026-10-28 (CoinGecko's 0 for a coin without a circulating supply) is not a market cap of $0
    const mcap = row.mcap != null && !(row.mcap > 0)
      ? none('the source gave 0 — it has no circulating supply for this token — which is not a market cap of $0', (s.mcap && s.mcap.src) || 'site', row.at, { label: mcapLabel, check: chk.served })
      : F(row.mcap, 'mcap', mcapLabel, { check: chk.served });
    const tvsLabel = 'Total Value Secured (L2BEAT) — a different measure from DeFi TVL';
    const l2 = l2Now(row.chain, row.name), snapTvs = F(row.tvs, 'tvs', tvsLabel);
    const l2Newer = l2 && (snapTvs.at == null || l2.at > snapTvs.at || snapTvs.v == null);
    const tvs = !l2Newer ? snapTvs
      : l2.p && l2.p.tvs && num(l2.p.tvs.total) != null ? fig(num(l2.p.tvs.total), 'l2beat', l2.at, { label: tvsLabel })
      : l2.p ? none('L2BEAT lists this chain without a value-secured total', 'l2beat', l2.at, { label: tvsLabel })
      : none('L2BEAT tracks Ethereum L2s and L3s only', 'l2beat', l2.at, { label: tvsLabel });
    const stage = l2Newer ? (l2.p && typeof l2.p.stage === 'string' ? l2.p.stage.slice(0, 40) : null) : row.stage || null;
    const isL2 = l2Newer ? (l2.p ? /layer[23]/.test(String(l2.p.type || '')) : false) : row.is_l2 == null ? null : !!row.is_l2;
    const stablesNow = F(row.stables, 'stables', 'Stablecoins on the chain (DefiLlama), now');
    let tvl = tvlNow, volume, fees, stables = stablesNow;
    if (w.kind === '24h') {
      volume = F(row.dex_vol_24h, 'vol', 'DEX volume, 24 h as DefiLlama reports it (about the last whole UTC day)');
      fees = F(row.fees_24h, 'fees', 'Gas fees paid on the chain, 24 h (DefiLlama)');
    } else if (w.kind === '30d') {
      volume = F(row.dex_vol_30d, 'vol', 'DEX volume, 30 days (DefiLlama)');
      fees = F(row.fees_30d, 'fees', 'Gas fees paid on the chain, 30 days (DefiLlama)');
    } else if (w.kind === '7d') {
      volume = last7(row.chain, 'dex_volume', 'DEX volume, the last 7 whole UTC days (DefiLlama daily)');
      fees = F(row.fees_7d, 'fees', 'Gas fees paid on the chain, 7 days (DefiLlama)');
    } else {
      volume = flowOver(row.chain, 'dex_volume', w, 'DEX volume, ' + w.label + ' (DefiLlama daily)');
      fees = flowOver(row.chain, 'fees', w, 'Gas fees, ' + w.label + ' (growthepie daily)');
      tvl = stockOver(row.chain, 'tvl', w, 'DeFi TVL at the end of the window (DefiLlama daily)');
      stables = stockOver(row.chain, 'stables', w, 'Stablecoins at the end of the window (DefiLlama daily)');
    }
    const ch = CHAIN_BY_KEY.get(row.chain);
    return {
      key: row.chain, name: row.name, chainId: row.chain_id, gtNetwork: ch && ch.gt ? ch.gt : null,
      logo: opts.raw ? (logoAllowed(llamaIcon(row.logo)) ? llamaIcon(row.logo) : null) : logoPath(llamaIcon(row.logo)),
      tvl, volume, liquidity: liq, mcap, fees, stables, tvs, stage, isL2,
    };
  }
  const CHAIN_SORTS = { tvl: (r) => r.tvl.v, volume: (r) => r.volume.v, mcap: (r) => r.mcap.v, liquidity: (r) => r.liquidity.v, fees: (r) => r.fees.v, stables: (r) => r.stables.v, tvs: (r) => r.tvs.v };
  function chains(q = {}, opts = {}) {
    const pw = parseWindow(q, ['24h', '7d', '30d']); if (pw.error) return { status: 400, body: { error: pw.error } };
    const sort = CHAIN_SORTS[q.sort] ? q.sort : 'tvl', dir = q.dir === 'asc' ? 'asc' : 'desc';
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const snap = latestSnap();
    if (!snap.rows.length) return { status: 200, body: { at: null, window: pw.w, sort, dir, total: 0, rows: [], notes: ['The chain figures have not been read yet: the collector runs every 30 minutes.'], why: 'not read yet' } };
    const rows = snap.rows.map((r) => chainFigures(r, pw.w, opts)).sort(nullLast(dir, CHAIN_SORTS[sort]));
    const notes = [
      'TVL is DeFi TVL (DefiLlama). L2BEAT\'s Total Value Secured is a different measure and is shown beside it, never mixed into the TVL column.',
      'DEX volume sums every protocol DefiLlama lists on the chain (its own chain total does the same, launchpads and trading apps included).',
      'Market cap of the chain\'s own token: CoinGecko\'s figure, checked against CoinLore (each figure\'s check says whether the two agree, and why not). DefiLlama relays CoinGecko\'s figure and stands in only when CoinGecko cannot be read; it is never counted as a second source. A chain with no token of its own (Robinhood Chain: gas is paid in ETH) has none.',
      'A chain whose figure is not available is listed last, whichever way the list is sorted.',
    ];
    if (pw.w.kind === 'custom') notes.push('Over a custom window, volume and gas fees are summed over its whole UTC days and TVL and stablecoins are the end values (with the start and the change); a window outside our daily history says so.');
    return { status: 200, body: { at: snap.at, window: pw.w, sort, dir, total: rows.length, rows: rows.slice(0, limit), notes } };
  }
  function seriesOf(chain, metric, from, to) {
    try { return db.prepare('SELECT day, value, src, at FROM mkt_chain_series WHERE chain = ? AND metric = ? AND day BETWEEN ? AND ? ORDER BY day').all(chain, metric, from || '0000-00-00', to || '9999-99-99'); } catch { return []; }
  }
  function pulseView() {
    const one = (sql) => { try { return db.prepare(sql).get() || null; } catch { return null; } };
    const head = one('SELECT * FROM mkt_rh_pulse WHERE block IS NOT NULL ORDER BY id DESC LIMIT 1');
    const sup = one('SELECT at, weth_supply, usdg_supply, pm_eth, pm_weth, pm_usdg FROM mkt_rh_pulse WHERE weth_supply IS NOT NULL ORDER BY id DESC LIMIT 1');
    const br = one('SELECT at, bridge_eth, bridge_batches, bridge_msgs, l1_block FROM mkt_rh_pulse WHERE bridge_eth IS NOT NULL ORDER BY id DESC LIMIT 1');
    const gwei = (w) => (w == null ? null : w / 1e9);
    const st = (stGet('rh_newpools') || {}).v || null;
    // pools created in the last 24 hours: from the block an hour-resolution pulse row says was the head 24 h ago, to the cursor
    let poolsCreated = { h24: null, src: 'rpc', why: 'the new-pools reader has not run yet' };
    if (st && st.cursor) {
      const ago = one('SELECT block, at FROM mkt_rh_pulse WHERE block IS NOT NULL AND at <= ' + Math.floor(now() - DAY) + ' ORDER BY at DESC LIMIT 1');
      const fromBlock = ago && ago.block >= (st.start || 0) && now() - ago.at < DAY + 2 * HOUR ? ago.block : null;
      if (fromBlock == null) poolsCreated = { h24: null, src: 'rpc', why: 'counted from our own reads, which do not reach 24 hours back yet (they start at block ' + (st.start || '?') + ')', since: { block: st.start || null, at: st.startAt || null } };
      else if (!blocksRead(st, fromBlock, st.cursor)) poolsCreated = { h24: null, src: 'rpc', why: 'our reads of the chain skipped some of the last 24 hours\' blocks (the new-pools reader fell too far behind), so they cannot be counted', gaps: st.gaps || [] };
      else {
        const c = { v2: 0, v3: 0, v4: 0 };
        try { for (const x of db.prepare("SELECT dex, COUNT(*) n FROM mkt_new_pool WHERE chain = 'robinhood' AND block > ? AND block <= ? GROUP BY dex").all(fromBlock, st.cursor)) if (x.dex in c) c[x.dex] = x.n; } catch {}
        poolsCreated = { h24: c, src: 'rpc', fromBlock, toBlock: st.cursor, fromAt: ago.at, label: 'pools created (v2 PairCreated, v3 PoolCreated, v4 Initialize), not tokens or contracts' };
      }
    }
    // the last day of readings, at most ~300 of them (every k-th reading kept as it was read — a selection, never an average)
    const hist = (sql) => { let r = []; try { r = db.prepare(sql).all(now() - DAY); } catch {} const k = Math.max(1, Math.ceil(r.length / 300)); return k === 1 ? r : r.filter((x, i) => i % k === 0 || i === r.length - 1); };
    return {
      now: head ? {
        block: head.block, blockTimeMs: head.block_time_ms, gasGwei: gwei(head.gas_price_wei), baseFeeGwei: gwei(head.base_fee_wei), minGasGwei: gwei(head.min_gas_wei), l1PriceWei: head.l1_price_wei,
        wethSupply: sup ? sup.weth_supply : null, usdgSupply: sup ? sup.usdg_supply : null, pm: { eth: sup ? sup.pm_eth : null, weth: sup ? sup.pm_weth : null, usdg: sup ? sup.pm_usdg : null },
        bridgeEth: br ? br.bridge_eth : null, bridgeBatches: br ? br.bridge_batches : null, bridgeMessages: br ? br.bridge_msgs : null, l1Block: br ? br.l1_block : null,
        at: head.at, suppliesAt: sup ? sup.at : null, bridgeAt: br ? br.at : null, src: 'rpc',
        labels: { blockTimeMs: 'mean block time over the last hour (two block timestamps)', pm: 'assets held by the v4 PoolManager (includes claims and fees) — not pool TVL', bridgeEth: 'ETH held by the canonical bridge on Ethereum — not a net inflow', l1PriceWei: 'ArbGasInfo price per L1 calldata byte' },
      } : null,
      why: head ? undefined : 'the chain has not been read yet',
      poolsCreated,
      history: {
        note: 'Readings from the last 24 hours (at most about 300: every reading kept as it was read, none averaged); the bridge, the last 30 days.',
        gas: hist('SELECT at, gas_price_wei v FROM mkt_rh_pulse WHERE at > ? AND gas_price_wei IS NOT NULL ORDER BY at').map((r) => [r.at, r.v / 1e9]),
        blockTimeMs: hist('SELECT at, block_time_ms v FROM mkt_rh_pulse WHERE at > ? AND block_time_ms IS NOT NULL ORDER BY at').map((r) => [r.at, r.v]),
        bridgeEth: (() => { try { return db.prepare('SELECT at, bridge_eth v FROM mkt_rh_pulse WHERE at > ? AND bridge_eth IS NOT NULL ORDER BY at').all(now() - 30 * DAY).map((r) => [r.at, r.v]); } catch { return []; } })(),
      },
      sources: [SOURCES.rpc, SOURCES.ethrpc],
    };
  }
  function chain(q = {}, opts = {}) {
    const key = String(q.key || 'robinhood');
    const pw = parseWindow(q, ['24h', '7d', '30d']); if (pw.error) return { status: 400, body: { error: pw.error } };
    const snap = latestSnap();
    const row = snap.rows.find((r) => r.chain === key);
    if (!row) {
      if (!snap.rows.length && CHAIN_BY_KEY.has(key)) {
        const why = 'The chain figures have not been read yet: the collector runs every 30 minutes.', ch0 = CHAIN_BY_KEY.get(key);
        const stats = {};
        for (const k of ['tvl', 'volume24h', 'volume7d', 'volume30d', 'windowVolume', 'fees24h', 'appFees24h', 'stables', 'oi', 'mcap', 'liquidity', 'tvs', 'txcount24h', 'daa', 'medianTxCostUsd']) stats[k] = none(why, 'site', null);
        Object.assign(stats, { tvsBreakdown: null, stage: null, risks: [], l2beat: null });
        const tt0 = ch0.gt ? tokens({ chain: key, sort: 'volume', dir: 'desc', window: '24h', limit: 10 }, opts).body : null;
        const body = { key, name: ch0.llama, chainId: key === 'robinhood' ? 4663 : null, at: null, why, window: pw.w, stats,
          history: { from: null, to: null, src: {}, tvl: [], volume: [], fees: [], appFees: [], stables: [], txcount: [], daa: [] },
          topTokens: tt0 ? { rows: tt0.rows || [], basis: tt0.basis || null, why: tt0.why } : { rows: [], basis: null, why: 'this site does not read this chain\'s pools' },
          newPools: newPools({ chain: key, limit: 20 }).body.rows, sources: [SOURCES.defillama] };
        if (key === 'robinhood') { body.pulse = pulseView(); body.sources.push(SOURCES.rpc, SOURCES.ethrpc); }
        return { status: 200, body };
      }
      if (!snap.rows.length) return { status: 200, body: { key, at: null, why: 'The chain figures have not been read yet: the collector runs every 30 minutes.', stats: null } };
      return { status: 404, body: { error: 'no chain with that key' } };
    }
    const f = chainFigures(row, pw.w, opts);
    const s = parseSrc(row);
    const today = dayOf(now());
    const l2 = stGet('l2beat'), ch = CHAIN_BY_KEY.get(key);
    const l2slug = ch && ch.l2beat ? ch.l2beat : null;
    const lp = l2 && l2.v && l2.v.projects ? (l2slug && l2.v.projects[l2slug]) || Object.entries(l2.v.projects).map(([, p]) => p).find((p) => lc(p.name) === lc(row.name)) || null : null;
    const lastDay = (metric) => { const r = seriesOf(key, metric, addDays(today, -3), addDays(today, -1)); return r.length ? r[r.length - 1] : null; };
    const dayFig = (metric, label) => { const r = lastDay(metric); return r ? fig(r.value, r.src, r.at, { label: label + ' (' + r.day + ')', day: r.day }) : none('no daily figure for this chain (growthepie covers 27 chains; L2BEAT\'s activity covers its L2s)', 'site'); };
    const stats = {
      tvl: f.tvl, volume24h: chainFigures(row, { kind: '24h' }, opts).volume,
      volume7d: last7(key, 'dex_volume', 'DEX volume, the last 7 whole UTC days (DefiLlama daily)'),
      volume30d: chainFigures(row, { kind: '30d' }, opts).volume, windowVolume: f.volume,
      fees24h: chainFigures(row, { kind: '24h' }, opts).fees,
      // fees paid to every app: the histories job's latest read (it may be newer than the snapshot), else the snapshot's
      appFees24h: (() => { const af = ((stGet('appfees') || {}).v || {})[key], lab = { label: 'Fees paid to every app on the chain, 24 h (DefiLlama)' };
        if (af && af.v != null) return fig(af.v, 'defillama', af.at, lab);
        return s.appFees && s.appFees.why ? none(s.appFees.why, 'site', row.at, lab) : fig(row.app_fees_24h, 'defillama', (s.appFees && s.appFees.at) || row.at, lab); })(),
      stables: f.stables, oi: s.oi && s.oi.why ? none(s.oi.why, 'site', row.at, { label: 'Open interest (DefiLlama)' }) : fig(row.oi, 'defillama', row.at, { label: 'Open interest (DefiLlama)' }),
      mcap: f.mcap, liquidity: f.liquidity, tvs: f.tvs,
      tvsBreakdown: lp && lp.tvs ? { native: lp.tvs.native, canonical: lp.tvs.canonical, external: lp.tvs.external, stablecoin: lp.tvs.stablecoin, ether: lp.tvs.ether, other: lp.tvs.other, change7d: lp.change7d, src: 'l2beat', at: l2.at } : null,
      txcount24h: dayFig('txcount', 'Transactions, the last whole UTC day'),
      daa: dayFig('daa', 'Active addresses, the last whole UTC day'),
      medianTxCostUsd: dayFig('txcost_median', 'Median transaction cost, the last whole UTC day'),
      stage: lp ? lp.stage || null : null, risks: lp ? lp.risks || [] : [],
      l2beat: lp ? { url: 'https://l2beat.com/scaling/projects/' + encodeURIComponent(l2slug || ''), hostChain: lp.hostChain, type: lp.type, at: l2.at } : null,
    };
    const hFrom = pw.w.kind === 'custom' ? pw.w.from : addDays(today, -365), hTo = pw.w.kind === 'custom' ? pw.w.to : addDays(today, -1);
    const H = (metric) => { const r = seriesOf(key, metric, hFrom, hTo); return { rows: r.map((x) => [x.day, x.value]), src: r.length ? r[r.length - 1].src : null }; };
    const hs = { tvl: H('tvl'), volume: H('dex_volume'), fees: H('fees'), appFees: H('app_fees'), stables: H('stables'), txcount: H('txcount'), daa: H('daa') };
    const history = { from: hFrom, to: hTo, src: {} };
    for (const [k, v] of Object.entries(hs)) { history[k] = v.rows; history.src[k] = v.src; }
    const tt = ch && ch.gt ? tokens({ chain: key, sort: 'volume', dir: 'desc', window: '24h', limit: 10 }, opts).body : null;
    const used = new Set(['defillama']);
    if (lp) used.add('l2beat');
    if (Object.values(history.src).includes('growthepie') || ['txcount24h', 'daa', 'medianTxCostUsd'].some((k) => stats[k].src === 'growthepie')) used.add('growthepie');
    if (tt && tt.rows && tt.rows.length) used.add('geckoterminal');
    // CoinGecko, CoinLore, or DefiLlama's relay — and the source the stat names when no figure came of it (CoinGecko's "no market cap" for Fantom)
    for (const x of (stats.mcap.check && stats.mcap.check.sources) || []) if (SOURCES[x.src]) used.add(x.src);
    if (stats.mcap.src && stats.mcap.src !== 'site' && SOURCES[stats.mcap.src]) used.add(stats.mcap.src);
    const body = {
      key, name: row.name, chainId: row.chain_id, at: row.at, window: pw.w, stats, history,
      topTokens: tt ? { rows: tt.rows || [], basis: tt.basis || null, why: tt.why } : { rows: [], basis: null, why: 'this site does not read this chain\'s pools' },
      newPools: newPools({ chain: key, limit: 20 }).body.rows,
    };
    if (key === 'robinhood') { body.pulse = pulseView(); used.add('rpc'); }
    body.sources = [...used].map((id) => (id === 'l2beat' && l2slug ? Object.assign({}, SOURCES.l2beat, { url: 'https://l2beat.com/scaling/projects/' + l2slug }) : SOURCES[id]));
    if (key === 'robinhood') body.sources.push(SOURCES.ethrpc);
    return { status: 200, body };
  }
  function chainHistory(q = {}) {
    const key = String(q.key || ''), metric = String(q.metric || '');
    const ok = ['tvl', 'dex_volume', 'fees', 'app_fees', 'stables', 'txcount', 'daa', 'txcost_median'];
    if (!key) return { status: 400, body: { error: 'key= names the chain (e.g. robinhood)' } };
    if (!ok.includes(metric)) return { status: 400, body: { error: 'metric is one of ' + ok.join(', ') } };
    if ((q.from && !validDay(q.from)) || (q.to && !validDay(q.to))) return { status: 400, body: { error: 'from / to are YYYY-MM-DD' } };
    const rows = seriesOf(key, metric, q.from, q.to);
    return { status: 200, body: { key, metric, from: q.from || null, to: q.to || null, data: rows.map((r) => ({ day: r.day, value: r.value, src: r.src, at: r.at })) } };
  }

  /* ----- the tokens of a chain: its most-traded pools, grouped by token ----- */
  /* the newest FINISHED batch: a pools run commits page by page under one `at` and names its batch in 'pools:<network>' only
     after its last page, so the run still reading (minutes, on the shared GeckoTerminal budget) is never served half-written */
  const doneAt = (net) => { const c = stGet('pools:' + net); return c && c.v && Number.isFinite(c.v.at) ? c.v.at : null; };
  function latestBatch(net) {
    return memoize('lb|' + net, 15000, () => {
      try {
        const m = doneAt(net);
        return m ? { at: m, rows: db.prepare('SELECT * FROM mkt_pool_snap WHERE network = ? AND at = ? ORDER BY rank').all(net, m) } : { at: null, rows: [] };
      } catch { return { at: null, rows: [] }; }
    });
  }
  const TOKEN_WINS = ['24h', '6h', '1h', '5m'];
  const VCOL = { '5m': 'vol_m5', '1h': 'vol_h1', '6h': 'vol_h6', '24h': 'vol_h24' }, CCOL = { '5m': 'chg_m5', '1h': 'chg_h1', '6h': 'chg_h6', '24h': 'chg_h24' };
  /* a figure summed over a token's pools: the pools that gave none are left out and counted, never added as 0 — a sum over
     some of them says so in its label (missing: how many), and a flag that needs the whole figure is not raised on it */
  const poolSum = (ps, get) => { const vs = ps.map(get).filter((v) => v != null); return { v: vs.length ? sum(vs) : null, read: vs.length, of: ps.length }; };
  const partOf = (s, what) => (s.read < s.of ? { missing: s.of - s.read, note: ' — ' + (s.of - s.read) + ' of its ' + s.of + ' pools gave no ' + what + ' and ' + (s.of - s.read === 1 ? 'is' : 'are') + ' left out' } : { missing: 0, note: '' });
  const rsv = (p) => (p.reserve_usd > 0 ? p.reserve_usd : null);   // GeckoTerminal's 0 is a reserve it did not read
  /* no Robinhood artwork on a Robinhood Chain token, wherever /market or the Send API draws one (the RWA tab says no Robinhood logos are
     used): none for a Robinhood Stock Token — its listed picture is Robinhood's mark — and none whose file is named after the token's
     own address (CoinGecko re-hosts Robinhood's logo for its Stock Tokens under that name: lib/rwa.js ownLogo) */
  const rhjAddrs = () => memoize('rwa|rhj', 15000, () => new Set(rwaBase().rows.filter((r) => r.issuer.key === 'rhj').map((r) => r.address)));
  const rhArt = (chainKey, addr, u) => chainKey === 'robinhood' && !!u && (R.ownLogo(u, addr) || rhjAddrs().has(lc(addr)));
  function groupTokens(rows, chainKey, at, raw) {
    const by = new Map();
    for (const r of rows) { if (!r.base_addr) continue; const k = r.base_addr; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    const out = [];
    for (const [addr, ps] of by) {
      ps.sort((a, b) => (b.reserve_usd || 0) - (a.reserve_usd || 0));
      const top = ps[0];
      const liqS = poolSum(ps, rsv), liqV = liqS.v, liqP = partOf(liqS, 'reserve');
      const v24 = poolSum(ps, (p) => p.vol_h24).v, txS = poolSum(ps, (p) => p.tx_h24), txP = partOf(txS, 'trade count');
      const flags = [];
      // thin needs every pool's reserve (an unread one could hold the rest); wash a whole reserve under a volume that is at least this
      if (liqV != null && !liqP.missing && liqV < 10000) flags.push('thin');
      if (v24 != null && liqV != null && !liqP.missing && v24 > 100 * Math.max(liqV, 1e-9)) flags.push('wash');
      const mc = top.mcap_usd, fdv = top.fdv_usd;
      const globalMc = mc != null && fdv != null && mc > fdv * 1.01;
      if (globalMc) flags.push('global-mcap');
      out.push({
        chain: chainKey, address: addr, symbol: top.base_symbol, name: top.base_name,
        logo: rhArt(chainKey, addr, top.base_logo) ? null : raw ? (logoAllowed(top.base_logo) ? top.base_logo : null) : logoPath(top.base_logo),
        priceUsd: fig(top.price_usd, 'geckoterminal', at, { label: 'price in its deepest pool here' }),
        mcap: mc == null ? none('GeckoTerminal has no market cap for this token', 'geckoterminal', at)
          : fig(mc, 'geckoterminal', at, globalMc ? { global: true, label: 'global market cap (CoinGecko, all chains) — larger than this chain\'s FDV, so not this chain\'s figure; kept out of the market-cap sort' } : { label: 'market cap (GeckoTerminal)' }),
        fdv: fig(fdv, 'geckoterminal', at, { label: 'FDV: total supply × price (GeckoTerminal; the supply includes burned tokens)' }),
        liquidity: liqV == null ? none('GeckoTerminal reports no reserve for ' + (ps.length === 1 ? 'its pool' : 'its ' + ps.length + ' pools') + ' here (0 or missing): not read', 'geckoterminal', at, { pools: ps.length })
          : fig(liqV, 'geckoterminal', at, Object.assign({ pools: ps.length, label: 'sum of the reserves of its ' + ps.length + ' pool' + (ps.length === 1 ? '' : 's') + ' in this list (where it is the priced token)' + liqP.note }, liqP.missing ? { missing: liqP.missing } : {})),
        txns24h: fig(txS.v, 'geckoterminal', at, Object.assign({ label: 'trades, 24 h, across these pools' + txP.note }, txP.missing ? { missing: txP.missing } : {})),
        flags, scannable: SCAN_CHAINS.includes(chainKey),
        _ps: ps, _v24: v24, _liq: liqV, _globalMc: globalMc,
      });
    }
    return out;
  }
  /* a custom window over our own snapshots: each day's volume is the 24 h figure of the first batch after that day ended */
  function tokenCustom(net, w) {
    return memoize('tc|' + net + w.from + w.to, 60000, () => {
      const done = doneAt(net);   // the batch a run is still writing is not read here either
      let firstAt = null; try { firstAt = done ? db.prepare('SELECT MIN(at) m FROM mkt_pool_snap WHERE network = ?').get(net).m : null; } catch {}
      if (!firstAt) return { why: 'our history of this chain\'s pools has not started yet' };
      // a day is covered from its start when our first batch landed within that day's first hour (it gives the day's opening prices)
      const covFrom = firstAt - dayStart(dayOf(firstAt)) < HOUR ? dayOf(firstAt) : addDays(dayOf(firstAt), 1);
      const coverage = { from: covFrom };
      if (w.from < covFrom) return { why: 'our history starts ' + covFrom, coverage };
      const batches = [];
      for (let d = w.from; d <= addDays(w.to, 1); d = addDays(d, 1)) {
        const t0 = dayStart(d);
        let b = null; try { b = db.prepare('SELECT MIN(at) m FROM mkt_pool_snap WHERE network = ? AND at >= ? AND at < ? AND at <= ?').get(net, t0, t0 + HOUR, done).m; } catch {}
        batches.push({ day: d, at: b });
      }
      const missing = batches.filter((b) => !b.at).map((b) => b.day);
      if (missing.length) return { why: 'our snapshots miss the start of ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? '…' : '') + ' (UTC)', coverage };
      const vol = new Map(), seen = new Map(), unread = new Map(), priceStart = new Map(), priceEnd = new Map();
      // a day counts only when every one of the token's pools in that batch gave a 24 h volume: a missing one is not a 0
      const q = db.prepare('SELECT base_addr, SUM(vol_h24) v, COUNT(*) n, COUNT(vol_h24) nv FROM mkt_pool_snap WHERE network = ? AND at = ? GROUP BY base_addr');
      const pq = db.prepare('SELECT base_addr, price_usd FROM mkt_pool_snap WHERE network = ? AND at = ? ORDER BY reserve_usd ASC');
      batches.forEach((b, i) => {
        if (i > 0) for (const r of q.all(net, b.at)) {
          if (r.nv < r.n) { if (!unread.has(r.base_addr)) unread.set(r.base_addr, batches[i - 1].day); continue; }
          vol.set(r.base_addr, (vol.get(r.base_addr) || 0) + r.v); seen.set(r.base_addr, (seen.get(r.base_addr) || 0) + 1);
        }
        if (i === 0) for (const r of pq.all(net, b.at)) priceStart.set(r.base_addr, r.price_usd);
        if (i === batches.length - 1) for (const r of pq.all(net, b.at)) priceEnd.set(r.base_addr, r.price_usd);
      });
      return { coverage, days: batches.length - 1, vol, seen, unread, priceStart, priceEnd, at: batches[batches.length - 1].at };
    });
  }
  const TOKEN_SORTS = { volume: (r) => r.volume.v, liquidity: (r) => r.liquidity.v, mcap: (r) => (r._globalMc ? null : r.mcap.v), fdv: (r) => r.fdv.v, change: (r) => r.change.v };
  /* one network's batch as token rows, each with the window's volume and price change (and a custom window's coverage) */
  function windowRows(key, net, b, w, raw) {
    const rows = groupTokens(b.rows, key, b.at, raw);
    let coverage;
    if (w.kind === 'custom') {
      const c = tokenCustom(net, w); coverage = c.coverage;
      for (const r of rows) {
        if (c.why) { r.volume = none(c.why, 'site', b.at); r.change = none(c.why, 'site', b.at); continue; }
        const days = c.seen.get(r.address) || 0, gap = c.unread.get(r.address);
        r.volume = gap ? none('GeckoTerminal gave no 24 h volume for one or more of its pools in our snapshot after ' + gap + ' (UTC), so the window has no total', 'site', c.at)
          : days === c.days ? fig(c.vol.get(r.address), 'site', c.at, { label: 'DEX volume over ' + w.label + ': the sum of GeckoTerminal\'s rolling 24 h figures, as our snapshots read them in the first hour after each day ended', days })
          : none('this token was among the most-traded pools on ' + days + ' of the window\'s ' + c.days + ' days', 'site', c.at);
        const p0 = c.priceStart.get(r.address), p1 = c.priceEnd.get(r.address);
        r.change = p0 > 0 && p1 > 0 ? fig(((p1 - p0) / p0) * 100, 'site', c.at, { label: 'price change over the window, from our snapshots at its two ends' }) : none('not in our snapshots at both ends of the window', 'site', c.at);
      }
    } else {
      for (const r of rows) {
        const vs = poolSum(r._ps, (p) => p[VCOL[w.kind]]), vp = partOf(vs, 'volume');
        r.volume = fig(vs.v, 'geckoterminal', b.at, Object.assign({ label: 'DEX volume, ' + w.label + ', across these pools' + vp.note }, vp.missing ? { missing: vp.missing } : {}));
        r.change = fig(r._ps[0][CCOL[w.kind]], 'geckoterminal', b.at, { label: 'price change, ' + w.label + ', in its deepest pool' });
      }
    }
    return { rows, coverage };
  }
  function tokens(q = {}, opts = {}) {
    const key = String(q.chain || 'robinhood');
    const ch = CHAIN_BY_KEY.get(key);
    const pw = parseWindow(q, TOKEN_WINS); if (pw.error) return { status: 400, body: { error: pw.error } };
    const w = pw.w;
    const sort = TOKEN_SORTS[q.sort] ? q.sort : 'volume', dir = q.dir === 'asc' ? 'asc' : 'desc';
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    if (key === 'all') return tokensAll(q, opts, w, sort, dir, limit);
    if (!ch || !ch.gt || !GT_TRACKED.includes(key)) return { status: 200, body: { at: null, chain: key, network: null, basis: null, window: w, rows: [], why: 'this site reads the pools of ' + GT_TRACKED.map((k) => CHAIN_BY_KEY.get(k).llama).join(', ') + ' only' } };
    const b = latestBatch(ch.gt);
    const cover = (stGet('pools:' + ch.gt) || {}).v || null;
    const n = b.rows.length;
    const basis = n ? 'the ' + n + ' most-traded pools on GeckoTerminal' + (cover && cover.why && cover.at === b.at ? ' (the read stopped at ' + cover.why + ')' : '') + ', grouped by token' : null;
    if (!n) return { status: 200, body: { at: null, chain: key, network: ch.gt, basis, window: w, rows: [], why: 'this chain\'s pools have not been read yet' } };
    let { rows, coverage } = windowRows(key, ch.gt, b, w, opts.raw);
    const notes = ['Highest and lowest are within ' + (basis || 'this list') + ' — never the whole chain\'s.', '"thin": under $10,000 of liquidity. "wash": 24 h volume over 100 times its liquidity.'];
    if (sort === 'volume' && dir === 'desc' && q.include !== 'all') {
      const before = rows.length; rows = rows.filter((r) => !r.flags.includes('wash'));
      if (before > rows.length) notes.push((before - rows.length) + ' token' + (before - rows.length === 1 ? '' : 's') + ' flagged "wash" are left out of the highest-volume list (include=all shows them).');
    }
    if (sort === 'mcap') notes.push('A global market cap (a token on several chains, larger than this chain\'s FDV) is kept out of the market-cap sort and listed last.');
    rows.sort(nullLast(dir, TOKEN_SORTS[sort]));
    for (const r of rows) { delete r._ps; delete r._v24; delete r._liq; delete r._globalMc; }
    return { status: 200, body: { at: b.at, chain: key, network: ch.gt, basis, window: w, ...(coverage ? { coverage } : {}), sort, dir, total: rows.length, rows: rows.slice(0, limit), notes } };
  }
  /* ----- every tracked network's top tokens in one list (owner, 2026-10-27: "add all chain's top tokens to the top tokens tab") -----
     Each network's newest finished batch, grouped by token on that chain exactly as one chain's list is: the same token on two
     chains is two rows, each naming its chain. The networks are read at different times (Robinhood Chain every 10 minutes, the
     others hourly), so every figure keeps its own network's read time, and the answer says which networks were read, when, and
     how many pools each — one not read yet is named, never dropped without a word. The rows are built once per change of the
     data (memoised like the other answers); a request only sorts and cuts them. A custom window is each network's own (its
     daily snapshots start on its own day, and a token outside its chain's coverage says so, as on one chain's list). */
  const poolsEvery = (key) => (key === 'robinhood' ? JOBS.pools.every : JOBS.poolsOther.every);
  const everyWords = (ms) => (ms >= HOUR ? 'hourly' : 'every ' + Math.round(ms / MIN) + ' minutes');
  const utcMin = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  function tokensAll(q, opts, w, sort, dir, limit) {
    const raw = !!opts.raw;
    const built = memoize('ta|' + w.kind + '|' + (w.from || '') + '|' + (w.to || '') + (raw ? '|raw' : ''), 15000, () => {
      const snap = latestSnap(), networks = [], rows = [];
      for (const key of GT_TRACKED) {
        const ch = CHAIN_BY_KEY.get(key), b = latestBatch(ch.gt), cover = (stGet('pools:' + ch.gt) || {}).v || null;
        const s = snap.rows.find((r) => r.chain === key);   // the chain's logo is the chains list's (DefiLlama's), when it has one
        const logo = s ? (raw ? (logoAllowed(llamaIcon(s.logo)) ? llamaIcon(s.logo) : null) : logoPath(llamaIcon(s.logo))) : null;
        const n = { key, name: ch.llama, network: ch.gt, logo, at: b.at, pools: b.rows.length, most: (GT_PAGES[key] || 3) * 20, everyMs: poolsEvery(key) };
        networks.push(n);
        if (!b.rows.length) { n.why = 'its pools have not been read yet (they are read ' + everyWords(n.everyMs) + ')'; continue; }
        if (cover && cover.why && cover.at === b.at) n.stopped = cover.why;
        if (now() - b.at > 3 * n.everyMs) n.stale = true;   // a collector that keeps failing: the list still shows its last read, and says how old
        const wr = windowRows(key, ch.gt, b, w, raw);
        if (wr.coverage) n.coverage = wr.coverage;
        for (const r of wr.rows) { delete r._ps; delete r._v24; delete r._liq; rows.push(Object.assign({ chain: key, chainName: ch.llama, chainLogo: logo }, r)); }
      }
      return { networks, rows };
    });
    const networks = built.networks, read = networks.filter((n) => n.pools), unread = networks.filter((n) => !n.pools);
    if (!read.length) return { status: 200, body: { at: null, chain: 'all', network: null, basis: null, window: w, networks, rows: [], why: 'no network\'s pools have been read yet' } };
    const basis = 'the most-traded pools on GeckoTerminal of ' + (read.length === 1 ? 'one network' : read.length + ' networks') + ' (' + sum(read.map((n) => n.pools)) + ' pools), grouped by token on each chain';
    const notes = [
      'Every network\'s tokens in one list: each one\'s newest finished read of its most-traded pools, grouped by token on that chain — the same token on two chains is two rows, each naming its chain.',
      'Highest and lowest are within these lists — never a whole chain\'s.',
      '"thin": under $10,000 of liquidity. "wash": 24 h volume over 100 times its liquidity.',
      'Read: ' + read.map((n) => n.name + ', ' + n.pools + ' pool' + (n.pools === 1 ? '' : 's') + ' at ' + utcMin(n.at) + ' (its ' + n.most + ' most-traded at most, read ' + everyWords(n.everyMs) + ')' + (n.stopped ? ' — the read stopped at ' + n.stopped : '') + (n.stale ? ' — older than its reads usually are' : '')).join('; ') + '.',
      'The networks are read at different times: every figure carries the time its own network was read.',
    ];
    if (unread.length) notes.push('Not read yet: ' + unread.map((n) => n.name + ' (read ' + everyWords(n.everyMs) + ')').join(', ') + ' — named here rather than left out; each joins the list once a read of its pools has finished.');
    if (w.kind === 'custom') notes.push('Over a custom window each network is summed from its own daily snapshots, which start on different days (networks[].coverage): a token outside its own chain\'s coverage says so.');
    let rows = built.rows.slice();
    if (sort === 'volume' && dir === 'desc' && q.include !== 'all') {
      const before = rows.length; rows = rows.filter((r) => !r.flags.includes('wash'));
      if (before > rows.length) notes.push((before - rows.length) + ' token' + (before - rows.length === 1 ? '' : 's') + ' flagged "wash" are left out of the highest-volume list (include=all shows them).');
    }
    if (sort === 'mcap') notes.push('A global market cap (a token on several chains, larger than its chain\'s FDV) is kept out of the market-cap sort and listed last.');
    rows.sort(nullLast(dir, TOKEN_SORTS[sort]));
    const ats = read.map((n) => n.at);
    return { status: 200, body: { at: Math.max(...ats), oldestAt: Math.min(...ats), chain: 'all', network: null, basis, window: w, networks, sort, dir, total: rows.length,
      rows: rows.slice(0, limit).map(({ _globalMc, ...r }) => r), notes } };
  }

  /* ----- one token, in full ----- */
  const cache = new Map();   // on-demand reads: key -> { at, v } (successes only)
  const cacheGet = (k, ttl) => { const h = cache.get(k); return h && now() - h.at < ttl ? h.v : undefined; };
  const cachePut = (k, v) => { if (cache.size > 2000) cache.delete(cache.keys().next().value); cache.set(k, { at: now(), v }); };
  const inflight = new Map();
  function once(k, fn) { if (inflight.has(k)) return inflight.get(k); const p = fn().finally(() => inflight.delete(k)); inflight.set(k, p); return p; }
  async function dsToken(chainKey, addr) {
    const ch = CHAIN_BY_KEY.get(chainKey); if (!ch || !ch.ds) return { ok: false, reason: 'Dexscreener does not list this chain' };
    const k = 'ds|' + chainKey + '|' + addr, hit = cacheGet(k, 10 * MIN); if (hit) return hit;
    return once(k, async () => {
      const r = await ask(null, urls.ds + '/tokens/v1/' + ch.ds + '/' + encodeURIComponent(addr), { wait: ASK_WAIT, maxBytes: 1024 * 1024 });
      const v = { ok: r.ok, reason: r.reason, pairs: r.ok && Array.isArray(r.data) ? r.data : [] };
      if (r.ok) cachePut(k, v);
      return v;
    });
  }
  async function gtToken(net, addr) {
    const k = 'gtt|' + net + '|' + addr, hit = cacheGet(k, 5 * MIN); if (hit) return hit;
    return once(k, async () => {
      const r = await gtAskNow('/networks/' + net + '/tokens/' + encodeURIComponent(addr) + '?include=top_pools', { maxBytes: 1024 * 1024 });
      const v = { ok: r.ok, reason: r.reason, status: r.status, data: r.ok ? r.data : null };
      if (r.ok || r.status === 404) cachePut(k, v);
      return v;
    });
  }
  async function gtCandles(net, pool, tf, limit, extra) {
    const k = 'gtc|' + net + '|' + pool + '|' + tf + '|' + limit + '|' + (extra || ''), hit = cacheGet(k, 10 * MIN); if (hit) return hit;
    return once(k, async () => {
      const r = await gtAskNow('/networks/' + net + '/pools/' + encodeURIComponent(pool) + '/ohlcv/' + tf + '?aggregate=1&limit=' + limit + '&currency=usd' + (extra || ''), { maxBytes: 2 * 1024 * 1024 });
      const list = r.ok && r.data && r.data.data && r.data.data.attributes && Array.isArray(r.data.data.attributes.ohlcv_list) ? r.data.data.attributes.ohlcv_list : null;
      const v = { ok: !!list, reason: r.ok ? (list ? null : 'no candles in the answer') : r.reason, rows: list ? list.filter((c) => Array.isArray(c) && c.length >= 6).map((c) => [num(c[0]) * 1000, num(c[1]), num(c[2]), num(c[3]), num(c[4]), num(c[5])]).sort((a, b) => a[0] - b[0]) : null };
      if (v.ok) cachePut(k, v);
      return v;
    });
  }
  function scannerOf(chainKey, addr) {
    const ok = SCAN_CHAINS.includes(chainKey);
    return { supported: ok, href: ok ? '/newpairs?scan=' + encodeURIComponent(addr) + '&chain=' + encodeURIComponent(chainKey) : null };
  }
  async function token(q = {}, opts = {}) {
    const key = String(q.chain || 'robinhood'), ch = CHAIN_BY_KEY.get(key);
    let addr = String(q.address || '').trim();
    if (!ch || !ch.gt || !GT_TRACKED.includes(key)) return { status: 400, body: { error: 'chain is one of ' + GT_TRACKED.join(', ') } };
    if (key === 'solana' ? !B58_RE.test(addr) : !EVM_RE.test(addr)) return { status: 400, body: { error: 'enter a token address' } };
    if (key !== 'solana') addr = lc(addr);
    const pw = parseWindow(q, TOKEN_WINS); if (pw.error) return { status: 400, body: { error: pw.error } };
    const net = ch.gt, at = now();
    const b = latestBatch(net);
    let ps = b.rows.filter((r) => r.base_addr === addr), basisAt = b.at, from = 'snapshot', gtInfo = null;
    if (!ps.length) {
      // not among the most-traded pools we keep: GeckoTerminal's token read (its top pools come with it)
      const g = await gtToken(net, addr);
      if (g.ok && g.data && g.data.data) {
        gtInfo = g.data.data.attributes || {};
        const pools = gtPoolRows({ data: (g.data.included || []).filter((x) => x && x.type === 'pool'), included: [{ id: net + '_' + addr, attributes: gtInfo }].concat(g.data.included || []) }, net);
        ps = pools.filter((p) => p.base_addr === addr); basisAt = at; from = 'geckoterminal';
      } else if (!g.ok) {
        /* the market read failed, but what this site keeps about an RWA needs no vendor read: its row (rwa), or for a token that only
           wears an RWA's ticker, the lookalike answer (rwaLookalike) — so a link to it from search, a list or a friend still shows them */
        const rwaKept = key === 'robinhood' ? { rwa: rwaRowFor(addr, opts), rwaLookalike: rwaRowFor(addr, opts) ? null : rwaLookalike(addr, null) } : {};
        if (g.status === 404) return { status: 404, body: Object.assign({ error: 'GeckoTerminal does not know this token on ' + ch.llama }, rwaKept) };
        return { status: 200, body: Object.assign({ chain: key, address: addr, unavailable: true, why: g.reason === 'budget' ? 'GeckoTerminal is being asked a lot right now — try again in a minute' : 'GeckoTerminal could not be read (' + g.reason + ')', scanner: scannerOf(key, addr), at }, rwaKept) };
      }
    }
    ps.sort((a, c) => (c.reserve_usd || 0) - (a.reserve_usd || 0));
    const top = ps[0] || null;
    const ds = ch.ds ? await dsToken(key, addr) : { ok: false, reason: 'Dexscreener does not list this chain', pairs: [] };
    const dsp = ds.pairs.find((p) => p && p.baseToken && lc(p.baseToken.address) === lc(addr)) || null;
    const info = (dsp && dsp.info) || {};
    const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]{1,300}$/i.test(u) ? u : null);
    const links = { websites: (Array.isArray(info.websites) ? info.websites : []).map((x) => ({ label: clip(x && x.label, 24) || 'Website', url: safeUrl(x && x.url) })).filter((x) => x.url).slice(0, 4),
      socials: (Array.isArray(info.socials) ? info.socials : []).map((x) => ({ type: clip(x && (x.type || x.platform), 16) || 'link', url: safeUrl(x && x.url) })).filter((x) => x.url).slice(0, 6), src: 'dexscreener', ...(ds.ok ? {} : { why: 'Dexscreener could not be read (' + ds.reason + ')' }) };
    // a Robinhood Stock Token's picture is Robinhood's mark (the RWA tab says no Robinhood artwork is used): its header draws the letter
    const rwaHere = key === 'robinhood' ? rwaRowFor(addr, opts) : null;
    const logo0 = rwaHere && rwaHere.issuer && rwaHere.issuer.key === 'rhj' ? null : (top && top.base_logo) || (logoAllowed(info.imageUrl) ? info.imageUrl : null) || (gtInfo && logoAllowed(gtInfo.image_url) ? gtInfo.image_url : null);
    const rawLogo = logo0 && rhArt(key, addr, logo0) ? null : logo0;
    const srcOf = 'geckoterminal';
    // a sum over its pools, with what it leaves out said in the label (poolSum: a pool with no figure is not a 0)
    const sumFig = (get, what, label, extra) => { const s = poolSum(ps, get), p = partOf(s, what); return fig(s.v, srcOf, basisAt, Object.assign({}, extra, { label: label + p.note }, p.missing ? { missing: p.missing } : {})); };
    const liqS = poolSum(ps, rsv), liq = liqS.v, liqWhole = liqS.read === liqS.of;   // GeckoTerminal's 0 = not read
    const vol24 = poolSum(ps, (p) => p.vol_h24).v;
    const mc = top ? top.mcap_usd : (gtInfo ? (num(gtInfo.market_cap_usd) > 0 ? num(gtInfo.market_cap_usd) : null) : null);
    const fdv = top ? top.fdv_usd : (gtInfo ? num(gtInfo.fdv_usd) : null);
    const globalMc = mc != null && fdv != null && mc > fdv * 1.01;
    const windows = {};
    for (const wk of TOKEN_WINS) windows[wk] = {
      volume: sumFig((p) => p[VCOL[wk]], 'volume', 'DEX volume, ' + WIN_LABEL[wk] + ', across its ' + ps.length + ' pool' + (ps.length === 1 ? '' : 's') + ' here'),
      change: fig(top ? top[CCOL[wk]] : null, srcOf, basisAt, { label: 'price change in its deepest pool' }),
      txns: wk === '24h' ? sumFig((p) => p.tx_h24, 'trade count', 'trades, 24 h, across its pools here') : none('GeckoTerminal\'s trade counts are kept for 24 h only here', srcOf, basisAt),
    };
    const body = {
      chain: key, address: addr, network: net,
      symbol: (top && top.base_symbol) || (gtInfo && gtext(gtInfo.symbol, 40)) || (dsp && clip(dsp.baseToken.symbol, 40)) || null,
      name: (top && top.base_name) || (gtInfo && gtext(gtInfo.name, 80)) || (dsp && clip(dsp.baseToken.name, 80)) || null,
      logo: opts.raw ? rawLogo : logoPath(rawLogo), links,
      priceUsd: fig(top ? top.price_usd : (gtInfo ? num(gtInfo.price_usd) : null), srcOf, basisAt, { label: 'price in its deepest pool' }),
      mcap: mc == null ? none('GeckoTerminal has no market cap for this token', srcOf, basisAt) : fig(mc, srcOf, basisAt, globalMc ? { global: true, label: 'global market cap (CoinGecko, all chains) — not this chain\'s' } : { label: 'market cap (GeckoTerminal)' }),
      fdv: fig(fdv, srcOf, basisAt, { label: 'FDV (GeckoTerminal)' }),
      supplyBasis: 'GeckoTerminal\'s FDV is the total supply times the price, burned tokens included; Dexscreener\'s FDV leaves out the tokens at 0x…dEaD. Neither is a circulating-supply market cap.',
      liquidity: sumFig(rsv, 'reserve', from === 'snapshot' ? 'sum of the reserves of its pools among the most-traded pools we keep' : 'sum of the reserves of its top pools (GeckoTerminal)', { pools: ps.length, why: 'GeckoTerminal reports no reserve for its pools (0 or missing): not read' }),
      pools: ps.slice(0, 30).map((p) => ({ pool: p.pool, dex: p.dex, quote: p.quote_symbol, name: p.name, reserveUsd: p.reserve_usd, volume24h: p.vol_h24, priceUsd: p.price_usd, createdAt: p.created_at })),
      windows, at: basisAt, basis: from === 'snapshot' ? 'its pools among the most-traded pools we keep (GeckoTerminal), read ' + new Date(basisAt).toISOString() : 'GeckoTerminal\'s token read, just now',
      flags: [...(liq != null && liqWhole && liq < 10000 ? ['thin'] : []), ...(vol24 != null && liq != null && liqWhole && vol24 > 100 * Math.max(liq, 1e-9) ? ['wash'] : []), ...(globalMc ? ['global-mcap'] : [])],
      scanner: scannerOf(key, addr),
      // the RWA tab's row for it (Robinhood Chain only; null when it is not an RWA here), so the token view knows without a second read
      rwa: rwaHere,
    };
    /* a token that only wears an RWA's ticker ("GameStop" $gme beside Robinhood's GME): the lookalike answer, so its view says so under
       its title — never only far below, in the Scanner's read (Robinhood Chain only; null for anything else) */
    if (key === 'robinhood') body.rwaLookalike = rwaHere ? null : rwaLookalike(addr, body.symbol);
    // candles: the deepest pool, hourly, the last week (GeckoTerminal; cached 10 minutes per pool)
    if (top) {
      const c = await gtCandles(net, top.pool, 'hour', 168);
      body.candles = c.ok ? { tf: 'hour', pool: top.pool, rows: c.rows, src: 'geckoterminal', partialLast: true, note: 'The newest candle is the hour still in progress. An hour with no candle had no trades.' }
        : { tf: 'hour', pool: top.pool, rows: null, src: 'geckoterminal', why: c.reason === 'budget' ? 'GeckoTerminal is being asked a lot right now — the chart will be there in a minute' : 'the candles could not be read (' + c.reason + ')', retry: true };
    } else body.candles = { tf: 'hour', rows: null, src: 'geckoterminal', why: 'no pool of this token is known' };
    // a custom window: summed from the deepest pool's candles (day candles for a long window, hour candles for a short one)
    if (pw.w.kind === 'custom') {
      if (!top) body.custom = { volume: none('no pool of this token is known', 'geckoterminal'), priceChange: none('no pool of this token is known', 'geckoterminal'), coverage: null, src: 'geckoterminal' };
      else {
        const long = pw.w.days > 35, limit = 1000;
        const c = await gtCandles(net, top.pool, long ? 'day' : 'hour', limit, long ? '' : '&before_timestamp=' + Math.floor((dayStart(pw.w.to) + DAY) / 1000));
        const t0 = dayStart(pw.w.from), t1 = dayStart(pw.w.to) + DAY;
        if (!c.ok) body.custom = { volume: none(c.reason === 'budget' ? 'GeckoTerminal is being asked a lot right now — try again in a minute' : 'the candles could not be read (' + c.reason + ')', 'geckoterminal'), priceChange: none('the candles could not be read', 'geckoterminal'), coverage: null, src: 'geckoterminal', retry: true };
        else {
          const first = c.rows.length ? c.rows[0][0] : null;
          const inWin = c.rows.filter((x) => x[0] >= t0 && x[0] < t1);
          // covered: the candles reach back past the window's start, or GeckoTerminal gave every candle it has and the pool is newer than the window
          const covered = (first != null && first <= t0) || (first != null && c.rows.length < limit && top.created_at != null && top.created_at >= t0 - DAY);
          const coverage = { from: first != null ? new Date(first).toISOString() : null, pool: top.pool, tf: long ? 'day' : 'hour' };
          if (!covered) body.custom = { volume: none(first == null ? 'GeckoTerminal has no candles for this pool' : 'GeckoTerminal\'s candles for this pool start ' + coverage.from, 'geckoterminal'), priceChange: none('outside the candles GeckoTerminal gives', 'geckoterminal'), coverage, src: 'geckoterminal' };
          else body.custom = {
            volume: fig(sum(inWin.map((x) => x[5] || 0)), 'geckoterminal', now(), { label: 'DEX volume in its deepest pool over ' + pw.w.label + ', summed from ' + inWin.length + ' ' + (long ? 'daily' : 'hourly') + ' candles (a period with no candle had no trades)', pool: top.pool }),
            priceChange: inWin.length ? fig(((inWin[inWin.length - 1][4] - inWin[0][1]) / inWin[0][1]) * 100, 'geckoterminal', now(), { label: 'from the first candle\'s open to the last candle\'s close' }) : none('no trades in the window', 'geckoterminal'),
            coverage, src: 'geckoterminal',
          };
        }
      }
    }
    return { status: 200, body };
  }

  /* ===== Robinhood Chain RWAs: the answers (/api/market/rwa, /api/market/rwa/token, the Send API's rwa and rwa-token) ==========
     Built from what the RWA job keeps and the newest finished pool batch (no request is made here), once per change of the data
     and at most every 15 s (memoised like the token lists); a request only filters, sorts and cuts. lib/rwa.js decides what counts
     and builds each token's figures; this assembles the views, their totals, the reads behind them and the words the page shows. */
  const RWA_VIEWS = ['assets', 'tokens', 'stables', 'connected'], RWA_KINDS = ['all', 'stock', 'etf', 'bond', 'commodity', 'credit'];
  const RWA_SORTS = { __proto__: null, value: (r) => r.value.v, tvl: (r) => r.tvl.v, liquidity: (r) => r.liquidity.v, mcap: (r) => (r._globalMc ? null : r.mcap.v), volume: (r) => r.volume24h.v, premium: (r) => (r.premium ? r.premium.v : null) };
  const RWA_NOT_AFFILIATED = 'Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc.';
  const RWA_DEFINITIONS = {
    rwa: 'An RWA here is a token an identified issuer issues to stand for a real-world asset (a share, an ETF, a bond or T-bill fund, a commodity fund, a credit or fund share), counted only on evidence — Robinhood\'s registry and the token\'s code on the chain, or this site\'s list of other issuers checked on the chain — never on a name.',
    value: 'Value on chain: the token\'s supply read on the chain times its DEX price — not the company\'s market value.',
    tvl: 'TVL in DeFi: USD of the token deposited in DeFi apps on Robinhood Chain (lending markets, vaults), from DefiLlama and matched by symbol — DEX pools are counted under Liquidity instead.',
    liquidity: 'Liquidity: GeckoTerminal\'s figure for the token across its DEX pools on Robinhood Chain (its token read) — GeckoTerminal\'s own total, which comes to less than the pools\' whole reserves; every token is ranked on that one figure, and a total adds them up.',
    mcap: 'Market cap: GeckoTerminal\'s (CoinGecko\'s) figure — for an issuer on several chains (Ondo, Anchored) it is every chain\'s, kept out of the market-cap ranking and never added to this chain\'s — and never mixed with the value on chain.',
    volume: 'Volume 24h: GeckoTerminal\'s figure for the token\'s DEX trading over the last 24 hours, across its pools on Robinhood Chain (its token read). A total takes a pool pairing two RWAs once when this site has read that pool (the most-traded pools, and the top RWAs\' own pools); one it has not read may be in both tokens\' figures, and the total says so.',
    premium: 'Premium or discount: the DEX price against the token\'s reference price — the price of one token, which is the underlying\'s price times the token\'s multiplier: Chainlink\'s feed read on the chain, else Robinhood\'s token quote (multiplier applied). Stock markets close while DEX pools trade around the clock.',
    connected: 'Connected tokens: tokens with a DEX pool against an RWA (a memecoin paired with TSLA) — not RWAs, listed apart and never counted.',
    stables: 'Fiat-backed stablecoins are listed apart and not counted as RWAs here — DefiLlama and rwa.xyz count stablecoins apart.',
  };
  const RWA_SOURCES = [
    { id: 'robinhood', name: 'Robinhood\'s Stock Token API (registry, quotes, corporate actions, price deviations)', href: 'https://docs.robinhood.com/chain/stock-token-apis/' },
    { id: 'rpc', name: 'Robinhood Chain (its public node), read by this site', href: 'https://docs.robinhood.com/chain/' },
    { id: 'chainlink', name: 'Chainlink price feeds (its public directory; each feed read on the chain)', href: 'https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood' },
    { id: 'defillama', name: 'DefiLlama (per-app deposits, stablecoins)', href: 'https://defillama.com' },
    { id: 'geckoterminal', name: 'GeckoTerminal (prices, market caps, pools)', href: 'https://www.geckoterminal.com' },
    { id: 'l2beat', name: 'L2BEAT (its count of real-world assets on the chain)', href: 'https://l2beat.com/scaling/projects/robinhood' },
  ];
  const utcAt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null);
  // one source's read, as the answer reports it: { at (the data's time), ok (the last attempt worked), why? }
  function readOf(rec, what) {
    if (!rec || (!rec.readAt && !rec.failAt)) return { at: null, ok: false, why: what + ' has not been read yet' };
    if (rec.failAt && (!rec.readAt || rec.failAt >= rec.readAt)) return { at: rec.readAt || null, ok: false, why: what + ' could not be read at ' + utcAt(rec.failAt) + ' (' + (rec.failWhy || 'no answer') + ')' + (rec.readAt ? ' — the last good read, from ' + utcAt(rec.readAt) + ', is shown' : '') };
    return { at: rec.readAt, ok: true };
  }
  const rwaClean = (r) => { if (!r) return null; const o = Object.assign({}, r); delete o._pools; delete o._globalMc; delete o._ownRead; return o; };
  /* GeckoTerminal's token read (tokens/multi, several calls a run): its time is the last run in which a call was answered; a run whose
     calls failed says how many, when and why — and "the last good read" only when there is one, with that one's own time */
  function gtRead(gt) {
    if (!gt || (!gt.readAt && !gt.failAt)) return { at: null, ok: false, why: 'GeckoTerminal\'s token read has not run yet' };
    if (!gt.failAt || (gt.readAt && gt.failAt < gt.readAt)) return { at: gt.readAt, ok: true };
    const some = Number.isFinite(gt.calls) && Number.isFinite(gt.failedCalls) && gt.failedCalls < gt.calls;
    return { at: gt.readAt || null, ok: false, why: 'GeckoTerminal\'s token read could not be read' + (some ? ' for ' + gt.failedCalls + ' of its ' + gt.calls + ' calls' : '') + ' at ' + utcAt(gt.failAt) + ' (' + (gt.failWhy || 'no answer') + ')'
      + (some ? ' — the tokens in those calls show their last good read, each with its own time' : gt.readAt && gt.readAt < gt.failAt ? ' — the last good read, from ' + utcAt(gt.readAt) + ', is shown' : gt.readAt ? '' : ' — it has not been read well yet') };
  }
  /* DefiLlama's per-app deposits: ok only while every app picked has a good read (a kept one says it is kept, with its own time); an
     app never read, failing, or dropped after two days is named — it is what a token's "not read" and a total's "may be low" are about */
  function tvlRead(tv, built) {
    if (!tv) return { at: null, ok: false, why: 'DefiLlama\'s per-app deposits have not been read yet' };
    const base = readOf(tv, 'DefiLlama\'s per-app deposits'), reads = tv.reads || {}, apps = Object.values(reads).filter((x) => x.ok).length;
    const kept = (tv.picks || []).filter((s) => reads[s] && reads[s].ok && Number.isFinite(reads[s].failAt) && reads[s].failAt >= (reads[s].at || 0));
    const unread = built.tvlUnread || [];
    if (!unread.length && !kept.length) return Object.assign(base, { apps });
    const parts = [unread.length ? 'not read: ' + unread.slice(0, 6).map((x) => x.name + ' (' + x.why + ')').join(', ') : '',
      kept.length ? 'kept from an earlier read: ' + kept.slice(0, 6).map((s) => (reads[s].name || s) + ' (read ' + utcAt(reads[s].at) + '; ' + (reads[s].failWhy || 'not read') + ' since)').join(', ') : ''].filter(Boolean);
    return { at: base.at, ok: false, apps, why: (base.ok ? '' : base.why + '; ') + 'DefiLlama\'s per-app deposits — ' + parts.join('; ') };
  }
  /* each top RWA's own pools (GeckoTerminal): a read that failed is said, with its reason, never folded into a finished round */
  function connectedRead(cn) {
    if (!cn || !cn.cycleAt) return { at: null, ok: false, why: 'the RWAs\' own pools have not been read yet' };
    const top = Array.isArray(cn.top) ? cn.top : Object.keys(cn.reads || {}), reads = cn.reads || {};
    const failed = top.filter((a) => reads[a] && Number.isFinite(reads[a].failAt) && reads[a].failAt >= (reads[a].at || 0));
    if (failed.length) {
      const whys = [...new Set(failed.map((a) => reads[a].failWhy || 'no answer'))].slice(0, 3).join(', ');
      return { at: cn.cycleAt, ok: false, failed: failed.length, why: 'GeckoTerminal could not be read for ' + failed.length + ' of ' + top.length + ' RWAs\' own pools (' + whys + ')' + (cn.doneAt ? ' — tried again in the next round' : ' — tried again on the next runs') };
    }
    return cn.doneAt ? { at: cn.cycleAt, ok: true } : { at: cn.cycleAt, ok: false, why: 'the RWAs\' own pools are read a few a run; this round is not finished' };
  }
  function rwaBase(raw) {
    return memoize('rwa|base' + (raw ? '|raw' : ''), 15000, () => {
      const rec = (n) => stV(n), b = latestBatch('robinhood');
      let usdg = null; try { usdg = db.prepare('SELECT usdg_supply v, at FROM mkt_rh_pulse WHERE usdg_supply IS NOT NULL ORDER BY id DESC LIMIT 1').get() || null; } catch {}
      const logoOf = (u) => (raw ? (logoAllowed(u) ? u : null) : logoPath(u));
      const built = R.buildRows({ now: now(), batch: b, assets: rec('rhj_assets'), prices: rec('rhj_prices'), actions: rec('rhj_actions'), deviations: rec('rhj_deviations'), chainlink: rec('chainlink_rh'),
        chain: rec('rwa_chain'), tvl: rec('rwa_tvl'), gt: rec('rwa_gt'), connected: rec('rwa_connected'), logo: logoOf });
      const rows = built.rows, counted = rows.filter((r) => r.confidence !== 'not-confirmed'), gCounted = counted.filter((r) => r._globalMc);
      const gTokW = gCounted.length === 1 ? '1 multi-chain issuer\'s token' : gCounted.length + ' multi-chain issuers\' tokens';
      const symOf = (a) => { const r = rows.find((x) => x.address === a); return r ? r.symbol : null; };
      // the pools pairing an RWA with another token: the batch's, then each RWA's own pools read from GeckoTerminal
      const cn = rec('rwa_connected') || { reads: {} }, pools = [];
      for (const p of b.rows) pools.push({ pool: p.pool, dex: p.dex, at: b.at, src: 'geckoterminal', base: { address: p.base_addr, symbol: p.base_symbol, name: p.base_name, logo: p.base_logo }, quote: { address: p.quote_addr, symbol: p.quote_symbol, name: null, logo: null }, reserveUsd: p.reserve_usd > 0 ? p.reserve_usd : null, volume24h: p.vol_h24 });
      for (const r of Object.values(cn.reads || {})) for (const p of r.pools || []) pools.push(Object.assign({}, p, { at: r.at, src: 'geckoterminal' }));
      const connected = R.connectedRows(pools, built.rwaSet, symOf);
      for (const c of connected.rows) { c.logo = logoOf(c.logoRaw); delete c.logoRaw; }
      // lookalikes: tokens our reads met with an RWA's ticker or name
      const lookCands = [];
      for (const p of pools) { lookCands.push({ address: p.base.address, symbol: p.base.symbol, name: p.base.name, src: 'pools' }); lookCands.push({ address: p.quote.address, symbol: p.quote.symbol, name: p.quote.name, src: 'pools' }); }
      for (const t of ((rec('rwa_seen') || {}).tokens || [])) lookCands.push(t);
      const lookalikes = R.lookalikesOf(rows, lookCands, built.rwaSet);
      // fiat-backed stablecoins, apart
      const sd = (rec('rwa_stables') || {}).data, stAt = (rec('rwa_stables') || {}).readAt || null;
      const stables = ((sd && sd.rows) || []).filter((x) => x.pegMechanism === 'fiat-backed').map((x) => {
        const known = R.STABLE_ADDR[x.id] || null, addr = known ? known.address : null, held = addr ? b.rows.filter((p) => p.base_addr === addr || p.quote_addr === addr) : [];
        const rs = held.map((p) => (p.reserve_usd > 0 ? p.reserve_usd : null)).filter((v) => v != null);
        return { address: addr, symbol: x.symbol, name: x.name, issuer: known ? known.issuer : null, backing: 'fiat-backed (DefiLlama\'s pegMechanism)',
          supply: addr === RH.usdg ? (usdg ? fig(usdg.v, 'rpc', usdg.at, { label: 'totalSupply() read on the chain (the pulse, every 10 minutes)' }) : none('its supply has not been read on the chain yet (the pulse reads it every 10 minutes)', 'rpc', null))
            : none(addr ? 'its supply is not read by this site' : 'its address on Robinhood Chain is not known to this site', 'rpc', null),
          circulating: fig(x.circulating, 'defillama', stAt, { label: 'circulating on Robinhood Chain (DefiLlama)' }),
          priceUsd: fig(x.price, 'defillama', stAt, { label: 'price (DefiLlama)', why: 'DefiLlama gave no price for it' }),
          liquidity: !addr ? none('its address on Robinhood Chain is not known to this site', 'geckoterminal', b.at) : rs.length ? fig(sum(rs), 'geckoterminal', b.at, { pools: held.length, label: 'the reserves of the ' + held.length + ' pools holding it among the most-traded pools we keep (each pool\'s whole reserve, both sides)' }) : none('no pool holding it among the most-traded pools we keep', 'geckoterminal', b.at),
          label: 'Not counted as an RWA here — DefiLlama and rwa.xyz count stablecoins apart' };
      });
      const otherDollars = ((sd && sd.rows) || []).filter((x) => x.pegMechanism !== 'fiat-backed').map((x) => x.symbol + ' (' + (x.pegMechanism || 'backing not given') + ')');
      // totals: the RWA tokens counted (confirmed or listed by the issuer); each pool once
      const l2 = stGet('l2beat'), l2p = l2 && l2.v && l2.v.projects && l2.v.projects.robinhood, l2tvs = (l2p && l2p.tvs) || {};
      const l2Lab = 'L2BEAT\'s count of real-world assets on Robinhood Chain — its own measure, never mixed with this site\'s sums';
      const totals = {
        value: R.sumFig(counted, 'value', 'value on chain of the ' + counted.length + ' RWA tokens counted', 'site'),
        liquidity: R.tokSumFig(counted, 'liquidity', 'GeckoTerminal\'s liquidity figures of the RWA tokens counted, added up'),
        tvl: Object.assign(R.sumFig(counted, 'tvl', 'deposited in DeFi apps on Robinhood Chain (DefiLlama, matched by symbol)' + (built.tvlUnread.length ? ' — not read: ' + built.tvlUnread.slice(0, 3).map((x) => x.name + ' (' + x.why + ')').join(', ') + ', so it may be low' : ''), 'defillama'),
          built.tvlUnread.length ? { missingApps: built.tvlUnread.map((x) => x.slug) } : {}),
        // this chain's market caps only: CoinGecko's every-chain figure for Ondo's and Anchored's tokens is never added in — apart, as mcapGlobal
        mcap: R.sumFig(counted.filter((r) => !r._globalMc), 'mcap', 'market caps summed (GeckoTerminal), this chain\'s only' + (gCounted.length ? ' — CoinGecko\'s every-chain figures for ' + gTokW + ' are kept apart' : ''), 'geckoterminal'),
        ...(gCounted.length ? { mcapGlobal: Object.assign(R.sumFig(gCounted, 'mcap', 'CoinGecko\'s every-chain market caps of ' + gTokW + ' — not this chain\'s, never added to its market caps', 'geckoterminal'), { global: true }) } : {}),
        volume24h: R.tokSumFig(counted, 'volume', 'GeckoTerminal\'s 24 h volume figures of the RWA tokens counted, added up'),
        count: counted.length, notConfirmed: rows.length - counted.length,
        stables: stables.length ? R.sumFig(stables, 'circulating', 'fiat-backed stablecoins circulating on Robinhood Chain (DefiLlama) — apart from the RWA totals', 'defillama', stAt) : none(sd ? 'DefiLlama lists no fiat-backed stablecoin on Robinhood Chain' : 'DefiLlama\'s stablecoins have not been read yet', 'defillama', stAt),
        l2beat: { rwaPublic: l2p ? fig(num(l2tvs.rwaPublic), 'l2beat', l2.at, { label: l2Lab, why: 'L2BEAT gave no figure' }) : none(l2 ? 'L2BEAT does not list Robinhood Chain' : 'L2BEAT has not been read yet', 'l2beat', l2 ? l2.at : null, { label: l2Lab }),
          rwaRestricted: l2p ? fig(num(l2tvs.rwaRestricted), 'l2beat', l2.at, { label: l2Lab + ' (restricted)', why: 'L2BEAT gave no figure' }) : none(l2 ? 'L2BEAT does not list Robinhood Chain' : 'L2BEAT has not been read yet', 'l2beat', l2 ? l2.at : null, { label: l2Lab }) },
      };
      const ch = rec('rwa_chain'), roles = rec('rhj_roles'), cl = rec('chainlink_rh'), tv = rec('rwa_tvl'), gt = rec('rwa_gt');
      const reads = {
        registry: readOf(rec('rhj_assets'), 'Robinhood\'s registry'), prices: readOf(rec('rhj_prices'), 'Robinhood\'s quotes'),
        actions: readOf(rec('rhj_actions'), 'Robinhood\'s corporate actions'), deviations: readOf(rec('rhj_deviations'), 'Robinhood\'s price deviations'),
        chain: ch && ch.stateAt ? (ch.failAt >= ch.stateAt ? { at: ch.stateAt, ok: false, why: 'the chain could not be read at ' + utcAt(ch.failAt) + ' (' + (ch.failWhy || 'no answer') + ') — the last good read, from ' + utcAt(ch.stateAt) + ', is shown' } : { at: ch.stateAt, ok: true })
          : { at: null, ok: false, why: 'the chain has not been read for the RWA tokens yet' + (ch && ch.failAt ? ' (' + (ch.failWhy || 'no answer') + ', ' + utcAt(ch.failAt) + ')' : '') },
        tvl: tvlRead(tv, built),
        stables: readOf(rec('rwa_stables'), 'DefiLlama\'s stablecoins'), chainlink: readOf(cl, 'Chainlink\'s feed directory'),
        roles: !roles ? { at: null, ok: false, why: 'the registry\'s logs have not been read yet' } : roles.complete ? { at: roles.walkedAt || roles.readAt, ok: true } : { at: roles.readAt || null, ok: false, why: 'the registry\'s logs are read up to block ' + roles.cursor + ' of ' + roles.head + ' so far' },
        gt: gtRead(gt),
        connected: connectedRead(cn),
      };
      const ats = Object.values(reads).map((x) => x.at).filter((x) => Number.isFinite(x)).concat(b.at ? [b.at] : []);
      /* Top RWAs filtered by an issuer: each group built from THAT issuer's tokens only — its main token, value, liquidity, market cap,
         premium and chip are all that issuer's token's (a group of Ondo's tokens never leads with Robinhood's token or its figures) */
      const byIssuer = {};
      const groupsFor = (iss) => byIssuer[iss] || (byIssuer[iss] = R.groupRows(rows.filter((r) => r.issuer.key === iss), b.at));
      return { built, rows, groups: R.groupRows(rows, b.at), groupsFor, connected, lookalikes, stables, otherDollars, totals, reads, at: ats.length ? Math.max(...ats) : null, batchAt: b.at, roles, chain: ch, cn };
    });
  }
  function rwa(q = {}, opts = {}) {
    // every choice is checked against this module's own keys (never an inherited one: ?sort=__proto__, ?issuer=constructor)
    const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
    const view = RWA_VIEWS.includes(q.view) ? q.view : 'assets', sort = own(RWA_SORTS, q.sort) ? q.sort : 'value', dir = q.dir === 'asc' ? 'asc' : 'desc';
    const kind = RWA_KINDS.includes(q.kind) ? q.kind : 'all', issuer = own(R.ISSUERS, q.issuer) ? q.issuer : 'all';
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 300));
    const B = rwaBase(!!opts.raw);
    const notes = [RWA_NOT_AFFILIATED + ' No Robinhood logos or artwork are used.', 'Not advice, never a tip to buy. Do your own research.',
      'How a token counts as an RWA here: it is in Robinhood\'s Stock Token registry and its code runs from Robinhood\'s registry on the chain ("confirmed"); or the registry lists it and the chain has not been read yet ("issuer-listed"); or it is on this site\'s list of other issuers, confirmed only once its own fingerprint is read on the chain. A name or a symbol never qualifies a token.',
      'Stablecoins and tokens merely paired with an RWA are listed apart and never counted.'];
    const byIssuer = new Map();
    for (const r of B.rows) { const k = r.issuer.key; byIssuer.set(k, (byIssuer.get(k) || 0) + 1); }
    const issuers = R.ISSUER_KEYS.filter((k) => byIssuer.has(k)).map((k) => ({ key: k, name: R.ISSUERS[k].name, count: byIssuer.get(k) }));
    let rows, extra = {};
    if (view === 'stables') {
      rows = B.stables.slice().sort(nullLast(dir, (r) => (sort === 'liquidity' ? r.liquidity.v : r.circulating.v)));
      notes.push('Ranked by ' + (sort === 'liquidity' ? 'liquidity' : 'what circulates on the chain') + ' (the other rankings do not apply to stablecoins).');
      if (B.otherDollars.length) notes.push('Left out, as crypto-backed or synthetic dollars rather than fiat-backed ones (DefiLlama\'s pegMechanism): ' + B.otherDollars.join(', ') + '.');
    } else if (view === 'connected') {
      rows = B.connected.rows.filter((r) => issuer === 'all' || ((B.rows.find((x) => x.address === r.rwa.address) || {}).issuer || {}).key === issuer)
        .filter((r) => kind === 'all' || ((B.rows.find((x) => x.address === r.rwa.address) || {}).underlying || {}).kind === kind)
        .sort(nullLast(dir, (r) => (sort === 'volume' ? r.volume24h.v : r.reserveUsd.v)));
      extra = { belowFloor: B.connected.below, unreadReserve: B.connected.unread, floor: B.connected.floor };
      notes.push('Every row here is NOT an RWA: a token with a DEX pool against one. Pools from $' + B.connected.floor.toLocaleString('en-US') + ' of reserve are listed; ' + B.connected.below + ' pool' + (B.connected.below === 1 ? '' : 's') + ' below that ' + (B.connected.below === 1 ? 'is' : 'are') + ' left out' + (B.connected.unread ? ', and ' + B.connected.unread + ' whose reserve GeckoTerminal did not read' : '') + '.');
      notes.push('Ranked by ' + (sort === 'volume' ? 'the pool\'s 24 h volume' : 'the pool\'s reserve') + '. Read from the most-traded pools we keep and each top RWA\'s own pools (GeckoTerminal).');
    } else {
      const src = view === 'assets' ? (issuer === 'all' ? B.groups : B.groupsFor(issuer)) : B.rows;
      rows = src.filter((r) => kind === 'all' || r.underlying.kind === kind)
        .filter((r) => issuer === 'all' || (view === 'assets' ? r.issuers.every((x) => x.key === issuer) : r.issuer.key === issuer))
        // a group's market cap is this chain's figures only (lib/rwa.js groupRows); one that is CoinGecko's every-chain figure alone is kept out of the ranking, as a token's is
        .slice().sort(nullLast(dir, view === 'assets' && sort === 'mcap' ? (r) => (r.mcap.global ? null : r.mcap.v) : RWA_SORTS[sort]));
      if (view === 'tokens') rows = rows.map(rwaClean);
      notes.push('Highest and lowest are among these RWA tokens — a token with no figure for the ranking sits last, whichever way the list is sorted.');
      if (sort === 'mcap' && view === 'tokens') notes.push('A market cap that is CoinGecko\'s every-chain figure (Ondo\'s and Anchored\'s tokens, which live on several chains) is kept out of the market-cap ranking and listed last.');
      if (sort === 'mcap' && view === 'assets') notes.push('A row\'s market cap is this chain\'s figures only: CoinGecko\'s every-chain figure for Ondo\'s and Anchored\'s tokens (which live on several chains) is kept apart, never added in — and a row whose only market cap is that figure is kept out of the ranking and listed last.');
      /* a kind or an issuer chosen: the totals are still the whole chain's (every kind and issuer), and these rows' own come beside them
         (totalsShown) — the counted tokens among them, summed by the same rules */
      if (kind !== 'all' || issuer !== 'all') {
        const mine = B.rows.filter((r) => r.confidence !== 'not-confirmed' && (kind === 'all' || r.underlying.kind === kind) && (issuer === 'all' || r.issuer.key === issuer));
        const lab = (w, tail) => w + ' of the ' + mine.length + ' RWA token' + (mine.length === 1 ? '' : 's') + ' counted among these' + (tail || '');
        extra = { totalsShown: { count: mine.length, value: R.sumFig(mine, 'value', lab('value on chain'), 'site'), liquidity: R.tokSumFig(mine, 'liquidity', lab('GeckoTerminal\'s liquidity figures', ', added up')),
          tvl: R.sumFig(mine, 'tvl', lab('deposited in DeFi apps on Robinhood Chain', ' (DefiLlama, matched by symbol)'), 'defillama'), volume24h: R.tokSumFig(mine, 'volume', lab('GeckoTerminal\'s 24 h volume figures', ', added up')) } };
        notes.push('The totals are the whole chain\'s, every kind and issuer — the counted tokens among the rows shown are summed apart, beside them.');
      }
      if (view === 'assets' && issuer !== 'all') notes.push('Each row here is built from ' + R.ISSUERS[issuer].name + '\'s tokens only: its figures, its premium and how sure the site is are that issuer\'s token\'s.');
      if (B.totals.notConfirmed) notes.push(B.totals.notConfirmed + ' listed token' + (B.totals.notConfirmed === 1 ? ' is' : 's are') + ' not confirmed on the chain yet: shown, marked, and left out of the totals.');
    }
    const tvlApps = Object.values((stV('rwa_tvl') || {}).reads || {}).filter((x) => x.ok).map((x) => x.name);
    if (tvlApps.length) notes.push('TVL in DeFi is summed over the apps DefiLlama lists with the largest deposits on the chain (' + tvlApps.slice(0, 12).join(', ') + '); DEX pools, exchanges and apps that deposit into other apps are left out so nothing is counted twice.');
    return { status: 200, body: { at: B.at, chain: 'robinhood', view, sort, dir, kind, issuer, total: rows.length, rows: rows.slice(0, limit), ...extra, issuers, totals: B.totals, reads: B.reads, definitions: RWA_DEFINITIONS, notes, sources: RWA_SOURCES } };
  }
  /* one token's facts: its row and everything the RWA card shows, or a 404 that says which evidence is missing */
  function rwaToken(q = {}, opts = {}) {
    const addr = lc(String(q.address || '').trim());
    if (!EVM_RE.test(addr)) return { status: 400, body: { error: 'enter a token address (0x…, Robinhood Chain)' } };
    const B = rwaBase(!!opts.raw), row = B.rows.find((r) => r.address === addr);
    if (!row) {
      const k = B.built.cls.get(addr) || null, ct = ((B.chain || {}).tokens || {})[addr] || {};
      const stable = B.stables.find((s) => s.address === addr) || null;
      const seen = (B.built.cls.get(addr) || {}).symbol || ((stV('rwa_seen') || {}).tokens || []).concat(latestBatch('robinhood').rows.map((p) => ({ address: p.base_addr, symbol: p.base_symbol }))).find((t) => t.address === addr);
      // the symbol this site has seen for it; else the one its own Scanner profile names (opts.symbol: server-side only, never the query)
      const symbol = (typeof seen === 'string' ? seen : seen ? seen.symbol : null) || (typeof opts.symbol === 'string' && /^[^\s<>"'&]{1,24}$/.test(opts.symbol.trim()) ? opts.symbol.trim() : null);
      const assetsRec = stV('rhj_assets');
      /* a lookalike is given the real one in full (address, issuer, how sure), so a page can link it — never only a shortened address in
         words. Every token with an RWA's ticker gets it, whatever else its own check found: a contract named exactly like a Stock Token
         that wrote the registry into its beacon slot is the most dangerous lookalike, never one warned less than a memecoin */
      const tw = !stable ? R.twinOf(addr, symbol, B.rows) : null;
      const twin = tw ? { address: tw.address, symbol: tw.symbol, name: tw.name, issuer: tw.issuer, confidence: tw.confidence, registry: tw.evidence.some((e) => e.tier === 'A1') } : null;
      return { status: 404, body: { notRwa: true, address: addr, ...(symbol ? { symbol } : {}), ...(stable ? { stablecoin: true } : {}), ...(k && k.pending ? { pending: true } : {}),
        why: R.notRwaWhy(addr, k, { stable, symbol, rows: B.rows, twin: tw, registryRead: !!(assetsRec && assetsRec.readAt), beaconRead: ct.fpAt != null, beacon: ct.beaconAt != null ? ct.beacon : null }), ...(twin ? { twin } : {}), notes: [RWA_NOT_AFFILIATED, 'Not advice, never a tip to buy. Do your own research.'] } };
    }
    const ch = B.chain || {}, ct = (ch.tokens || {})[addr] || {}, roles = B.roles || {}, isRhj = row.issuer.key === 'rhj';
    const kinds = roles.kinds || {};
    const holderOf = (a) => ({ address: a, kind: kinds[a] ? kinds[a].kind : null });
    const rolesList = isRhj ? R.roleRows(roles).map((r) => Object.assign(r, { kind: kinds[r.holder] ? kinds[r.holder].kind : null })) : [];
    const beacon = isRhj ? R.ISSUERS.rhj.registry : ct.beacon || null;
    const implRec = isRhj ? (ch.beacons || {})[R.ISSUERS.rhj.registry] : row.issuer.key === 'midas' ? (ct.impl ? { implementation: ct.impl, at: ct.implAt } : null) : beacon ? (ch.beacons || {})[beacon] : null;
    const impl = implRec && implRec.implementation ? { address: implRec.implementation, src: 'rpc', at: implRec.at || null } : { address: null, src: 'rpc', at: null, why: implRec && implRec.absent ? 'the beacon answered no implementation()' : 'not read on the chain yet' };
    const controls = {
      kind: row.issuer.key === 'midas' ? 'ERC-1967 proxy' : 'beacon proxy', beacon, registry: isRhj ? R.ISSUERS.rhj.registry : null, implementation: impl,
      verifiedSource: isRhj && impl.address ? 'https://sourcify.dev/server/v2/contract/4663/' + impl.address : null,
      ...(isRhj ? {} : { verifiedWhy: 'this site has not checked a verified source for this issuer\'s code' }),
      powers: isRhj ? R.POWERS.map(([role, power]) => ({ power, role, holders: R.holdersOf(roles, role).map(holderOf) })) : [],
      ...(isRhj ? {} : { powersWhy: 'This site reads the roles of Robinhood\'s registry only; this issuer\'s contract keeps powers of its own (see what you hold).' }),
      note: 'Powers a regulated issuer keeps, shown as such, not as a verdict: for a regulated issuer they are expected — they are still powers over your tokens. The Scanner\'s health score does not count them.',
    };
    const acts = ((((stV('rhj_actions') || {}).data) || {}).actions || []).filter((x) => x.address === addr).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const feed = isRhj && row.symbol ? B.built.feeds.get(String(row.symbol).toUpperCase()) || null : null, fr = feed ? (ch.feeds || {})[feed.proxy] || null : null;
    const chainlink = !isRhj || !feed || feed.ref === false ? null : { proxy: feed.proxy, name: feed.name, description: (fr && fr.description) || null, answer: row.reference.chainlink.v, updatedAt: fr && fr.updatedAt ? fr.updatedAt * 1000 : null, heartbeat: feed.heartbeat, stale: !!row.reference.chainlink.stale, at: fr ? fr.at : null };
    const deployers = isRhj ? R.holdersOf(roles, 'TOKEN_DEPLOYER_ROLE') : [];
    const body = Object.assign(rwaClean(row), {
      issuerProfile: R.issuerProfile(row, ch.registry || {}), controls, roles: rolesList, rolesAt: roles.walkedAt || roles.readAt || null,
      // how far the registry's log walk has come: until it is whole, a holder granted a role later is not in these lists yet
      rolesRead: isRhj && roles.readAt ? { complete: !!roles.complete, cursor: Number.isFinite(roles.cursor) ? roles.cursor : null, head: Number.isFinite(roles.head) ? roles.head : null, at: roles.readAt } : null,
      blocked: isRhj && roles.readAt ? { count: (roles.blocked || []).length, at: roles.readAt, complete: !!roles.complete } : null,
      corporateActions: acts, connected: B.connected.rows.filter((c) => c.rwa.address === addr), lookalikes: B.lookalikes.get(addr) || [],
      ...(connWhy(B.cn, addr) ? { connectedWhy: connWhy(B.cn, addr) } : {}), connectedBasis: connBasis(B, addr),
      chainlink, ...(chainlink ? {} : { chainlinkWhy: isRhj ? (feed ? (feed.ref === false ? row.reference.chainlink.why : 'not read yet') : 'Chainlink\'s public directory lists no feed for this ticker') : 'Chainlink\'s Robinhood feeds price Robinhood\'s Stock Tokens only' }),
      deployer: deployers.length ? { role: 'TOKEN_DEPLOYER_ROLE', holders: deployers.map(holderOf), note: 'Robinhood\'s registry deploys every Stock Token from its token-deployer role, so the Scanner does not raise "serial deployer" on a confirmed Stock Token deployed by it.' } : null,
      reads: B.reads, at: B.at, notes: [RWA_NOT_AFFILIATED, 'Not advice, never a tip to buy. Do your own research.', 'Stock markets close while DEX pools trade around the clock: a gap from the reference price can open outside market hours.'],
      definitions: RWA_DEFINITIONS, sources: RWA_SOURCES,
    });
    return { status: 200, body };
  }
  /* where this token's connected tokens come from, and the words for an empty list: its own pools (one of the top RWAs, read well), or
     only the most-traded pools this site keeps — a token whose own pools were never asked is never told "they could not be read" */
  function connBasis(B, addr) {
    const cn = B.cn || {}, r = (cn.reads || {})[addr], top = Array.isArray(cn.top) ? cn.top : [], floor = '$' + B.connected.floor.toLocaleString('en-US');
    if (r && r.ok && Number.isFinite(r.at)) return { own: true, src: 'geckoterminal', at: r.at, note: 'No pool among its own pools (GeckoTerminal, its first 20) or the most-traded pools this site keeps pairs it with another token from ' + floor + ' of reserve' };
    const why = top.includes(addr) ? 'its own pools are read a few a run, and have not been read yet this round' : 'only the ' + RWA_TOP + ' RWAs with the most liquidity have their own pools read';
    return { own: false, src: 'geckoterminal', at: B.batchAt || null, note: 'No pool among the most-traded pools this site keeps pairs it with another token from ' + floor + ' of reserve (' + why + ')' };
  }
  // this token's own pools read (one of the top RWAs): a failed read is said with its reason, never as "no pool pairs it"
  function connWhy(cn, addr) {
    const r = cn && cn.reads && cn.reads[addr];
    if (!r || !Number.isFinite(r.failAt) || r.failAt < (r.at || 0)) return null;
    return 'GeckoTerminal could not be read for this token\'s own pools at ' + utcAt(r.failAt) + ' (' + (r.failWhy || 'no answer') + ')' + (r.ok && r.at ? ' — its pools as read at ' + utcAt(r.at) + ' are shown' : ' — only the pools among the most-traded we keep are shown');
  }
  // the token view's rwa key (null for anything not an RWA here) and the Scanner's p.rwa: stored facts only, no request
  const rwaRowFor = (addr, opts = {}) => rwaClean(rwaBase(!!opts.raw).rows.find((r) => r.address === lc(addr)) || null);
  function rwaFacts(addr) { const a = lc(addr); if (!rwaBase().rows.some((r) => r.address === a)) return null; const r = rwaToken({ address: a }); return r.status === 200 ? r.body : null; }
  /* a token that is NOT an RWA here but shares an RWA's ticker: the Scanner's p.rwa is the 404's lookalike body ("Same ticker as $GME,
     but not issued by …"), so its own dashboard says so; null for anything else (a stablecoin, a token with a ticker of its own) */
  function rwaLookalike(addr, symbol) {
    // most tokens: no RWA has their ticker, and the answer is null without reading anything more (every token popup asks this);
    // no symbol at all (a market read that failed): the one this site has seen for it, if any
    const s0 = typeof symbol === 'string' ? symbol.trim().toLowerCase() : '';
    const s = s0 || (symbol === null ? lc(((rwaBase().built.cls.get(lc(addr)) || {}).symbol) || ((((stV('rwa_seen') || {}).tokens || []).find((t) => t.address === lc(addr))) || {}).symbol || '') : '');
    if (!s || !rwaBase().rows.some((x) => String(x.symbol || '').toLowerCase() === s)) return null;
    const r = rwaToken({ address: addr }, { symbol });
    // a 404 that names its twin is a lookalike, whatever else its own check found (its why leads with "Same ticker as $…")
    return r.status === 404 && r.body && !r.body.stablecoin && r.body.twin && /^Same ticker as \$/.test(String(r.body.why || '')) ? r.body : null;
  }
  /* the Scanner's serial-deployer flag is not raised on a confirmed Stock Token (registry and fingerprint) whose deployer is the
     registry's token-deployer role holder: that address deploys every Stock Token by design. The answer is the sentence the card shows. */
  function rwaIssuerDeployer(addr, deployer) {
    const r = rwaBase().rows.find((x) => x.address === lc(addr));
    if (!r || r.issuer.key !== 'rhj' || r.confidence !== 'confirmed' || !r.evidence.some((e) => e.tier === 'A1') || !r.evidence.some((e) => e.tier === 'A2')) return null;
    return deployer && R.holdersOf(stV('rhj_roles'), 'TOKEN_DEPLOYER_ROLE').includes(lc(deployer)) ? 'its deployer holds Robinhood\'s registry\'s token-deployer role, which deploys every Stock Token by design' : null;
  }

  /* ----- search: our own tables first, then Dexscreener ----- */
  const searchCache = new Map();
  async function search(q = {}, opts = {}) {
    const raw = String(q.q || '').normalize('NFC').trim().slice(0, 80);
    if (raw.length < 2) return { status: 400, body: { error: 'type at least two characters' } };
    const ql = raw.toLowerCase(), isAddr = EVM_RE.test(raw) || (B58_RE.test(raw) && raw.length >= 32);
    const ck = ql + (opts.raw ? '|raw' : ''), hit = searchCache.get(ck);
    if (hit && now() - hit.at < (hit.partial ? 20000 : 5 * MIN)) return { status: 200, body: hit.v };
    const like = '%' + ql.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const snap = latestSnap();
    const chainsOut = snap.rows.filter((r) => lc(r.name).includes(ql) || r.chain.includes(ql)).sort((a, b) => (b.tvl || 0) - (a.tvl || 0)).slice(0, 8).map((r) => ({ key: r.chain, name: r.name }));
    const seen = new Set(), toks = [];
    const add = (t) => { const k = t.chain + '|' + t.address; if (seen.has(k) || toks.length >= 40) return; seen.add(k); toks.push(t); };
    try {
      const nets = GT_TRACKED.map((k) => CHAIN_BY_KEY.get(k).gt);
      for (const net of nets) {
        const b = latestBatch(net); if (!b.rows.length) continue;
        const ck2 = chainOfGt(net).key;
        const m = groupTokens(b.rows.filter((r) => (isAddr ? (r.base_addr === (net === 'solana' ? raw : ql)) : (lc(r.base_symbol).includes(ql) || lc(r.base_name).includes(ql)))), ck2, b.at, opts.raw);
        for (const t of m.sort((a, c) => (c._v24 || 0) - (a._v24 || 0)).slice(0, 10)) add({ chain: ck2, address: t.address, symbol: t.symbol, name: t.name, priceUsd: t.priceUsd.v, liquidity: t.liquidity.v, volume24h: t._v24, src: 'geckoterminal', at: b.at });
      }
      for (const r of db.prepare("SELECT chain, address, symbol, name, price_usd, liquidity_usd, volume_24h, MAX(at) at FROM mkt_scan WHERE " + (isAddr ? 'address = ?' : "(LOWER(symbol) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\')") + ' GROUP BY chain, address ORDER BY at DESC LIMIT 10').all(...(isAddr ? [EVM_RE.test(raw) ? ql : raw] : [like, like])))
        add({ chain: r.chain, address: r.address, symbol: r.symbol, name: r.name, priceUsd: r.price_usd, liquidity: r.liquidity_usd, volume24h: r.volume_24h, src: 'site', at: r.at });
      for (const r of db.prepare("SELECT token, symbol, name, price_usd, liquidity_usd, volume_24h, updated_at FROM mkt_radar WHERE token IS NOT NULL AND " + (isAddr ? 'token = ?' : "(LOWER(symbol) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\')") + ' ORDER BY updated_at DESC LIMIT 10').all(...(isAddr ? [ql] : [like, like])))
        add({ chain: 'robinhood', address: r.token, symbol: r.symbol, name: r.name, priceUsd: r.price_usd, liquidity: r.liquidity_usd, volume24h: r.volume_24h, src: 'site', at: r.updated_at });
    } catch (e) { log('[market] search tables: ' + ((e && e.message) || e)); }
    // Dexscreener: cross-chain, at most 30 answers (it cannot list a chain)
    let partial = false, dsWhy = null;
    const fromDs = (pairs) => {
      for (const p of (Array.isArray(pairs) ? pairs : [])) {
        if (!p || !p.baseToken || !p.baseToken.address || !p.chainId) continue;
        const c = chainOfDs(p.chainId); const chainKey = c ? c.key : clip(lc(p.chainId), 30);
        const a = chainKey === 'solana' || !EVM_RE.test(p.baseToken.address) ? String(p.baseToken.address) : lc(p.baseToken.address);
        if (!isAddr && !(lc(p.baseToken.symbol).includes(ql) || lc(p.baseToken.name).includes(ql))) continue;
        add({ chain: chainKey, address: a, symbol: clip(p.baseToken.symbol, 40), name: clip(p.baseToken.name, 80), priceUsd: num(p.priceUsd), liquidity: num(p.liquidity && p.liquidity.usd), volume24h: num(p.volume && p.volume.h24), src: 'dexscreener', at: now(), pair: clip(p.pairAddress, 70) });
      }
    };
    if (EVM_RE.test(raw)) {
      const r = await ask(null, urls.ds + '/tokens/v1/robinhood/' + ql, { wait: ASK_WAIT, maxBytes: 1024 * 1024 });
      if (r.ok) fromDs(r.data); else { partial = true; dsWhy = 'Dexscreener could not be read (' + r.reason + ')'; }
    }
    if (!(EVM_RE.test(raw) && toks.some((t) => t.src === 'dexscreener'))) {
      const r = await ask(null, urls.ds + '/latest/dex/search?q=' + encodeURIComponent(raw), { wait: ASK_WAIT, maxBytes: 2 * 1024 * 1024 });
      if (r.ok) fromDs(r.data && r.data.pairs); else { partial = true; dsWhy = 'Dexscreener could not be read (' + r.reason + ')'; }
    }
    const v = { q: raw, chains: chainsOut, tokens: toks, sources: ['site', 'geckoterminal', 'dexscreener'], ...(dsWhy ? { why: dsWhy } : {}), note: 'Our own records first, then Dexscreener\'s search (cross-chain, at most 30 answers).' };
    if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(ck, { at: now(), v, partial });
    return { status: 200, body: v };
  }

  /* ----- new pools ----- */
  function newPools(q = {}) {
    const key = String(q.chain || 'robinhood');
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const before = Number(q.before) || Number.MAX_SAFE_INTEGER;
    let rows = [];
    try { rows = db.prepare('SELECT * FROM mkt_new_pool WHERE chain = ? AND id < ? ORDER BY id DESC LIMIT ?').all(key, before, limit); } catch {}
    const st = key === 'robinhood' ? ((stGet('rh_newpools') || {}).v || null) : null;
    return { status: 200, body: {
      chain: key, src: key === 'robinhood' ? 'rpc' : 'geckoterminal',
      label: key === 'robinhood' ? 'pools created on the v2 factory, the v3 factory and the v4 PoolManager, read from the chain' : 'GeckoTerminal\'s newest pools',
      ...(st ? { cursor: { block: st.cursor, since: st.start, sinceAt: st.startAt, gaps: st.gaps || [] } } : {}),
      rows: rows.map((r) => { const x = safeParse(r.extra, {}) || {}; return { id: r.id, chain: r.chain, pool: r.pool, dex: r.dex, token0: r.token0, token1: r.token1, block: r.block, createdAt: r.created_at, firstSeen: r.first_seen, fee: x.fee != null ? x.fee : null, hooks: x.hooks || null, name: x.name || null, baseSymbol: x.baseSymbol || null, quoteSymbol: x.quoteSymbol || null }; }),
      next: rows.length === limit ? rows[rows.length - 1].id : null,
    } };
  }

  /* ----- the bubble map of the whole crypto market: GET /api/market/heatmap, the Send API's heatmap -----
     limit: how many of CoinGecko's largest coins, 20 to 100 (100 when absent or not a number); stables=0 leaves out the
     stablecoins among them (so "limit=50&stables=0" is the top 50 coins without their stablecoins — fewer than 50 rows). */
  const heatmapBase = () => memoize('heatmap|base', 15000, () => MM.buildMap((stGet('heatmap') || {}).v || null, { fig, none }));
  function heatmap(q = {}) {
    const n = Number(q.limit), limit = q.limit != null && q.limit !== '' && Number.isFinite(n) ? Math.min(MM.TOP, Math.max(20, Math.round(n))) : MM.TOP;
    const stables = !(q.stables === '0' || q.stables === 'false');
    const B = heatmapBase();
    let rows = B.rows.slice(0, limit);
    if (!stables) rows = rows.filter((r) => r.stable !== true);
    const counts = MM.countRows(rows), lost = rows.length - counts.drawn;
    const notes = ['Not advice, never a tip to buy. Do your own research.',
      'The ' + MM.TOP + ' largest coins by market cap on CoinGecko, on every chain, read every 10 minutes; CoinGecko\'s total market cap every 30 minutes; its stablecoins category every 6 hours.'];
    if (rows.length) notes.push(MM.checkNote(rows, B.lore));
    if (lost) notes.push(lost + ' coin' + (lost === 1 ? ' has' : 's have') + ' no market cap: listed, not drawn (a bubble\'s size comes from its market cap).');
    if (!stables) notes.push('Stablecoins left out: the coins CoinGecko files as stablecoins' + (B.reads.stables.ok ? '' : ' (' + B.reads.stables.why + ')') + '.');
    if (B.reads.stables.at == null) notes.push('Which coins are stablecoins is not known yet: CoinGecko\'s stablecoins category has not been read (each row\'s stable is null until it is).');
    const body = { at: B.at, total: B.total, limit, stables, rows, counts, reads: B.reads, legend: MM.BUCKETS, definitions: MM.DEFINITIONS, notes, sources: MM.SOURCES };
    if (B.why) body.why = B.why + (started ? ' — the server reads them every 10 minutes' : ' — the market collectors are off in this process');
    return { status: 200, body };
  }

  /* ----- status ----- */
  function tableStats() {
    return memoize('tables', 30000, () => TABLES.map((name) => {
      const tc = TABLE_TIME[name];
      try { const r = db.prepare('SELECT COUNT(*) n, MIN(' + tc + ') a, MAX(' + tc + ') b FROM ' + name).get(); return { name, rows: r.n, oldestAt: r.a, newestAt: r.b }; } catch { return { name, rows: null, oldestAt: null, newestAt: null }; }
    }));
  }
  function status() {
    const collectors = Object.keys(JOBS).map((job) => {
      const lr = lastRun(job);
      let lastOk = null; try { lastOk = (db.prepare('SELECT at FROM mkt_runs WHERE job = ? AND ok = 1 ORDER BY id DESC LIMIT 1').get(job) || {}).at || null; } catch {}
      return { job, title: JOBS[job].title, everyMs: JOBS[job].every, lastAt: lr ? lr.at : null, ok: lr ? !!lr.ok : null, ms: lr ? lr.ms : null, calls: lr ? lr.calls : null, note: lr ? lr.note : null, lastOkAt: lastOk,
        running: running.has(job), nextAt: started && nextAt.has(job) ? nextAt.get(job) : null };
    });
    return { status: 200, body: { enabled: started, at: now(), collectors, tables: tableStats(), ...(started ? {} : { note: 'The collectors are off in this process (they run when MARKET_COLLECT=1 or NODE_ENV=production).' }) } };
  }

  /* ----- the Send API's new resources (same key, same 120/min, paged by before / limit like the old ones) ----- */
  const RESOURCES = ['chains', 'chain', 'chain-history', 'chain-snapshots', 'tokens', 'token', 'pools', 'new-pools', 'radar', 'scans', 'pulse', 'collectors', 'rwa', 'rwa-token', 'heatmap'];
  const pageOf = (rows, limit, idOf) => ({ data: rows, next: rows.length === limit ? idOf(rows[rows.length - 1]) : null, limit });
  const decodeJson = (r, cols) => { for (const c of cols) if (r[c] != null) r[c] = safeParse(r[c], r[c]); return r; };
  async function apiResource(name, q = {}, page = {}) {
    const limit = page.limit || 100, before = page.before || Number.MAX_SAFE_INTEGER;
    const raw = { raw: true };
    switch (name) {
      case 'chains': { const r = chains(Object.assign({ limit: 200 }, q), raw); return r.status === 200 ? { status: 200, body: { data: r.body.rows, at: r.body.at, window: r.body.window, sort: r.body.sort, dir: r.body.dir, total: r.body.total, notes: r.body.notes } } : r; }
      case 'chain': { const r = chain(q, raw); return r.status === 200 ? { status: 200, body: { data: r.body } } : r; }
      case 'chain-history': return chainHistory(q);
      case 'chain-snapshots': {
        const rows = db.prepare('SELECT * FROM mkt_chain_snap WHERE id < ?' + (q.key ? ' AND chain = ?' : '') + ' ORDER BY id DESC LIMIT ?').all(...[before].concat(q.key ? [String(q.key)] : [], [limit]));
        return { status: 200, body: pageOf(rows.map((r) => decodeJson(r, ['src', 'mcap_check'])), limit, (r) => r.id) };
      }
      case 'tokens': { const r = tokens(Object.assign({ limit: 200 }, q), raw); return r.status === 200 ? { status: 200, body: Object.assign({ data: r.body.rows }, r.body, { rows: undefined }) } : r; }
      case 'token': { const r = await token(q, raw); return r.status === 200 ? { status: 200, body: { data: r.body } } : r; }
      case 'pools': {
        /* a filter that can never match is a 400 that says why, never an empty page (which reads as "no snapshots"): the network
           is a tracked one, by this site's chain key or GeckoTerminal's id; a pool is an address of that network's kind, and only
           an EVM one is lower-cased (a Solana address is case-sensitive, and is stored as GeckoTerminal gave it) */
        const w = ['id < ?'], a = [before];
        let net = null;
        if (q.network != null && q.network !== '') {
          const n = String(q.network), ch = GT_TRACKED.includes(n) ? CHAIN_BY_KEY.get(n) : chainOfGt(n);
          if (!ch || !GT_TRACKED.includes(ch.key)) return { status: 400, body: { error: 'network is one of ' + GT_TRACKED.map((k) => k + (CHAIN_BY_KEY.get(k).gt !== k ? ' (or ' + CHAIN_BY_KEY.get(k).gt + ')' : '')).join(', ') } };
          net = ch.gt; w.push('network = ?'); a.push(net);
        }
        if (q.pool != null && q.pool !== '') {
          const p = String(q.pool).trim(), evm = EVM_RE.test(p) || POOL_ID_RE.test(p);
          if (!evm && !B58_RE.test(p)) return { status: 400, body: { error: 'pool is a pool address (0x… on the EVM networks, base58 on Solana)' } };
          if (net && (net === 'solana') === evm) return { status: 400, body: { error: net === 'solana' ? 'a Solana pool is a base58 address, not 0x…' : 'a pool on ' + net + ' is a 0x address' } };
          w.push('pool = ?'); a.push(evm ? lc(p) : p);
        }
        const rows = db.prepare('SELECT * FROM mkt_pool_snap WHERE ' + w.join(' AND ') + ' ORDER BY id DESC LIMIT ?').all(...a, limit);
        return { status: 200, body: pageOf(rows, limit, (r) => r.id) };
      }
      case 'new-pools': {
        const key = q.chain != null && q.chain !== '' ? String(q.chain) : null;
        if (key && !GT_TRACKED.includes(key)) return { status: 400, body: { error: 'chain is one of ' + GT_TRACKED.join(', ') } };
        const rows = db.prepare('SELECT * FROM mkt_new_pool WHERE id < ?' + (key ? ' AND chain = ?' : '') + ' ORDER BY id DESC LIMIT ?').all(...[before].concat(key ? [key] : [], [limit]));
        return { status: 200, body: pageOf(rows.map((r) => decodeJson(r, ['extra'])), limit, (r) => r.id) };
      }
      case 'radar': {
        const rows = db.prepare('SELECT * FROM mkt_radar WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit);
        return { status: 200, body: Object.assign(pageOf(rows.map((r) => decodeJson(r, ['risk', 'json'])), limit, (r) => r.id), { cursor: ((stGet('radar') || {}).v || {}).cursor || null }) };
      }
      case 'scans': {
        // the same rule as pools: a chain the Scanner reads, an address of its kind (a Solana one keeps its case), else a 400
        const w = ['id < ?'], a = [before];
        const key = q.chain != null && q.chain !== '' ? String(q.chain) : null;
        if (key && !SCAN_CHAINS.includes(key)) return { status: 400, body: { error: 'chain is one of ' + SCAN_CHAINS.join(', ') } };
        if (q.address != null && q.address !== '') {
          const ad = String(q.address).trim(), evm = EVM_RE.test(ad);
          if (!evm && !B58_RE.test(ad)) return { status: 400, body: { error: 'address is a token address (0x… on Robinhood Chain and Ethereum, base58 on Solana)' } };
          if (key && (key === 'solana') === evm) return { status: 400, body: { error: key === 'solana' ? 'a Solana address is base58, not 0x…' : 'an address on ' + key + ' is a 0x address' } };
          // the chains an address of this kind can be on, so the (chain, address) index answers it
          const on = key ? [key] : SCAN_CHAINS.filter((c) => (c === 'solana') !== evm);
          w.push('chain IN (' + on.map(() => '?').join(',') + ')', 'address = ?'); a.push(...on, evm ? lc(ad) : ad);
        } else if (key) { w.push('chain = ?'); a.push(key); }
        const rows = db.prepare('SELECT * FROM mkt_scan WHERE ' + w.join(' AND ') + ' ORDER BY id DESC LIMIT ?').all(...a, limit);
        return { status: 200, body: pageOf(rows.map((r) => decodeJson(r, ['risk', 'json'])), limit, (r) => r.id) };
      }
      case 'pulse': {
        const rows = db.prepare('SELECT * FROM mkt_rh_pulse WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit);
        return { status: 200, body: pageOf(rows, limit, (r) => r.id) };
      }
      case 'collectors': return { status: 200, body: { data: status().body } };
      case 'rwa': { const r = rwa(Object.assign({}, q, { limit: q.limit || 300 }), raw); return { status: 200, body: Object.assign({ data: r.body.rows }, r.body, { rows: undefined }) }; }
      case 'rwa-token': { const r = rwaToken(q, raw); return r.status === 200 ? { status: 200, body: { data: r.body } } : r; }
      /* the bubble map's coins: every row of the answer (at most 100), not paged; ?limit=20…100&stables=0|1 as the page's route — the Send API
         takes limit as its page size (100 by default), so that is the map's limit here */
      case 'heatmap': { const r = heatmap(Object.assign({}, q, q.limit == null && page.limit ? { limit: String(page.limit) } : {})); return { status: 200, body: Object.assign({ data: r.body.rows }, r.body, { rows: undefined }) }; }
      default: return null;
    }
  }

  /* ----- the admin browser's view of these tables: every column (they hold public data only) ----- */
  const ADMIN_DATASETS = [
    { id: 'mkt_chain_snap', title: 'Chains — snapshots', description: 'One row per chain per chains run (every 30 minutes): DefiLlama, L2BEAT, CoinGecko, CoinLore.', table: 'mkt_chain_snap', q: ['chain', 'name'],
      cols: [['id', 'Id'], ['chain', 'Chain'], ['name', 'Name'], ['chain_id', 'Chain id'], ['at', 'Read at'], ['tvl', 'DeFi TVL (USD)'], ['dex_vol_24h', 'DEX volume 24 h'], ['dex_vol_30d', 'DEX volume 30 d'], ['fees_24h', 'Gas fees 24 h'], ['fees_7d', 'Gas fees 7 d'], ['fees_30d', 'Gas fees 30 d'], ['app_fees_24h', 'App fees 24 h'], ['stables', 'Stablecoins'], ['oi', 'Open interest'], ['dex_liq', 'DEX liquidity'], ['mcap', 'Own-token market cap'], ['native_token', 'Own token (CoinGecko id)'], ['native_symbol', 'Own token symbol'], ['gas_token', 'Gas token'], ['tvs', 'TVS (L2BEAT)'], ['stage', 'Stage'], ['is_l2', 'L2'], ['logo', 'Logo URL'], ['src', 'Sources (JSON)'], ['mcap_check', 'Market-cap check (JSON)']] },
    { id: 'mkt_chain_series', title: 'Chains — daily history', description: 'Daily TVL, DEX volume, fees, stablecoins, transactions and active addresses (DefiLlama, growthepie, L2BEAT).', table: 'mkt_chain_series', q: ['chain', 'metric', 'day'],
      cols: [['chain', 'Chain'], ['metric', 'Metric'], ['day', 'Day (UTC)'], ['value', 'Value'], ['src', 'Source'], ['at', 'Read at']] },
    { id: 'mkt_pool_snap', title: 'Pools — GeckoTerminal snapshots', description: 'The most-traded pools of each tracked network, one batch per read.', table: 'mkt_pool_snap', q: ['network', 'pool', 'base_addr', 'base_symbol', 'base_name'],
      cols: [['id', 'Id'], ['network', 'Network'], ['pool', 'Pool'], ['at', 'Read at'], ['rank', 'Rank'], ['base_addr', 'Token'], ['base_symbol', 'Symbol'], ['base_name', 'Name'], ['base_logo', 'Logo URL'], ['base_gecko_id', 'CoinGecko id'], ['quote_addr', 'Quote token'], ['quote_symbol', 'Quote'], ['dex', 'DEX'], ['name', 'Pool name'], ['price_usd', 'Price (USD)'], ['reserve_usd', 'Reserve (USD)'], ['fdv_usd', 'FDV'], ['mcap_usd', 'Market cap'], ['vol_m5', 'Vol 5 m'], ['vol_h1', 'Vol 1 h'], ['vol_h6', 'Vol 6 h'], ['vol_h24', 'Vol 24 h'], ['tx_h24', 'Trades 24 h'], ['buys_h24', 'Buys 24 h'], ['sells_h24', 'Sells 24 h'], ['chg_m5', 'Change 5 m %'], ['chg_h1', 'Change 1 h %'], ['chg_h6', 'Change 6 h %'], ['chg_h24', 'Change 24 h %'], ['created_at', 'Pool created']] },
    { id: 'mkt_new_pool', title: 'New pools', description: 'Pools as they are created: Robinhood Chain from its own logs (v2, v3, v4), the other networks from GeckoTerminal.', table: 'mkt_new_pool', q: ['chain', 'pool', 'token0', 'token1', 'dex'],
      cols: [['id', 'Id'], ['chain', 'Chain'], ['pool', 'Pool'], ['dex', 'DEX / version'], ['token0', 'Token 0'], ['token1', 'Token 1'], ['block', 'Block'], ['created_at', 'Created'], ['first_seen', 'First seen'], ['extra', 'Details (JSON)']] },
    { id: 'mkt_rh_pulse', title: 'Robinhood Chain pulse', description: 'Block, block time, gas, supplies, PoolManager holdings and the canonical bridge, read from the chains themselves.', table: 'mkt_rh_pulse', q: [],
      cols: [['id', 'Id'], ['at', 'Read at'], ['block', 'Block'], ['block_ts', 'Block time (unix)'], ['block_time_ms', 'Mean block time (ms)'], ['gas_price_wei', 'Gas price (wei)'], ['base_fee_wei', 'Base fee (wei)'], ['l1_price_wei', 'L1 calldata price (wei/byte)'], ['min_gas_wei', 'Minimum gas price (wei)'], ['weth_supply', 'WETH supply'], ['usdg_supply', 'USDG supply'], ['pm_eth', 'PoolManager ETH'], ['pm_weth', 'PoolManager WETH'], ['pm_usdg', 'PoolManager USDG'], ['bridge_eth', 'Bridge ETH (Ethereum)'], ['bridge_batches', 'Bridge batches'], ['bridge_msgs', 'Delayed messages'], ['l1_block', 'Ethereum block'], ['pools_created_v2', 'Pools created v2'], ['pools_created_v3', 'Pools created v3'], ['pools_created_v4', 'Pools created v4']] },
    { id: 'mkt_scan', title: 'Scans', description: 'Every token scan (the Scanner, the Market Data page, the hourly re-scan), any chain. Never who scanned.', table: 'mkt_scan', q: ['chain', 'address', 'symbol', 'name'],
      cols: [['id', 'Id'], ['chain', 'Chain'], ['address', 'Token'], ['at', 'At'], ['read_at', 'Read at'], ['src', 'From'], ['n', 'Scans folded in'], ['kind', 'Kind'], ['symbol', 'Symbol'], ['name', 'Name'], ['price_usd', 'Price (USD)'], ['mcap', 'Market cap'], ['fdv', 'FDV'], ['liquidity_usd', 'Liquidity'], ['volume_24h', 'Volume 24 h'], ['verdict', 'Verdict'], ['health', 'Health'], ['holders', 'Holders'], ['risk', 'Flags (JSON)'], ['json', 'Profile (JSON)']] },
    { id: 'mkt_radar', title: 'New Pairs radar', description: 'The radar\'s pairs, kept across restarts.', table: 'mkt_radar', q: ['pair', 'token', 'symbol', 'name'],
      cols: [['id', 'Id'], ['pair', 'Pair'], ['token', 'Token'], ['token0', 'Token 0'], ['token1', 'Token 1'], ['quote', 'Quote token'], ['quote_symbol', 'Quote'], ['symbol', 'Symbol'], ['name', 'Name'], ['created_block', 'Created (block)'], ['created_at', 'Created'], ['price_usd', 'Price (USD)'], ['liquidity_usd', 'Liquidity'], ['mcap', 'Market cap'], ['fdv', 'FDV'], ['volume_24h', 'Volume 24 h'], ['health', 'Health'], ['verdict', 'Verdict'], ['risk', 'Flags (JSON)'], ['json', 'Profile (JSON)'], ['first_seen', 'First seen'], ['updated_at', 'Updated']] },
    { id: 'mkt_runs', title: 'Collector runs', description: 'Every run of every Market Data collector: when, whether it worked, how long, how many outbound requests.', table: 'mkt_runs', q: ['job', 'note'],
      cols: [['id', 'Id'], ['job', 'Job'], ['at', 'At'], ['ok', 'OK'], ['ms', 'Took (ms)'], ['calls', 'Requests'], ['note', 'Note']] },
    { id: 'mkt_state', title: 'Collector state', description: 'Cursors and carried values (the L2BEAT summary, DEX liquidity by chain, pool-list coverage, the bubble map\'s last reads of CoinGecko and CoinLore).', table: 'mkt_state', q: ['name'],
      cols: [['name', 'Name'], ['value', 'Value (JSON)'], ['at', 'At']] },
  ];

  return {
    migrate: () => migrate(db), start, stop, runJob, jobs: Object.keys(JOBS), JOBS,
    chains, chain, chainHistory, tokens, token, search, newPools, status, pulseView, rwa, rwaToken, rwaRowFor, rwaFacts, rwaLookalike, rwaIssuerDeployer, heatmap,
    scanPut, radarPersist, radarMarket, radarRestore, mostScanned, apiResource, RESOURCES, ADMIN_DATASETS,
    parseWindow, gtPoolRows, poolRowsOfLogs, urls,
    _test: { latestSnap, latestBatch, stGet, stSet, memo, rwaBase, loreAsk, fitNote, nextAt, running, cgSlot },
  };
}

const MCAP = Object.freeze({ CG_PER_CALL, LORE_GAP_MS, LORE_WALK_MAX, LORE_PER_CALL });
module.exports = { MCAP, createMarketData, createHonestFetch, migrate, HONEST_UA, llamaIcon, CHAIN_TABLE, CHAIN_BY_KEY, chainOfLlama, GT_TRACKED, SCAN_CHAINS, RH, L1, LOGO_HOSTS, logoAllowed, logoPath, imageTypeOf, num, fig, dayOf, validDay, JOBS, TABLES };
