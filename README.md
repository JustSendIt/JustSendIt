# $Send — Just Send It 🚀

**A community platform, game, and honest on-chain toolkit for the $Send (SEND IT) memecoin on Robinhood Chain.**

> 🎉 Entertainment purposes only. Not financial advice. Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. "Robinhood Chain" refers to the public blockchain network of that name. Memecoins are extremely volatile — you can lose everything you put in. Always do your own research.

**New here?** [`WHITEPAPER.html`](WHITEPAPER.html) explains the whole project in plain English — what it does, how it protects your data, the full points economy with every number, the games, and an honest list of its limits. Open it in a browser, or run `npm run whitepaper` to render it as a PDF.


### What this repository is

This is the complete source of the JustSendIt website, released to the public domain under
[CC0 1.0](LICENSE) so anyone can read, audit, fork or self-host it. It is the code, not a service:
running it yourself gives you your own independent site with its own database and its own users.

A fork is not the official deployment and is not endorsed by it. The contract addresses below are
real mainnet addresses, so if you are looking for the live site, confirm the domain rather than
trusting any copy of this code you happen to find.

**Media note:** the site's feature video and theme audio are deliberately **not** in this repository.
Their rights could not be established, and CC0 is an irrevocable grant that cannot be made over work
you do not own. `public/index.html` still references the video, so a fresh clone shows an empty
player there until you supply footage of your own.

---

## 1. What is this?

**$Send / Just Send It** is a fan-built community hub for the **$Send** memecoin (and its sibling **$GWC**, Generational Wealth Coin) living on **Robinhood Chain** — an Ethereum Layer‑2 (chain ID 4663). It turns "watching a memecoin" into something you can actually *do*: connect a wallet (read‑only), track holdings, hang out on a social wall, call the tokens you believe in, discover new pairs safely, and earn **Send Power** for taking part.

It is built to be **fun, clear, mobile‑first, and — above all — honest.** The whole platform is designed so that everything you earn is *organic*: holdings and status are read straight from the blockchain and verified on the server, so nobody can fake their way to the top.

**Tokens**
- **$Send (SEND IT)** — `0xa40a9C0e2E9bf7a3b9deb9ebed2b59E77d01e105`
- **$GWC (Generational Wealth Coin)** — `0x61339F11384dDe4B2dc3a33E75B4dc23Cc620F22`

Always copy contract addresses from the site and verify them on the explorer before you swap.

### $Send tokenomics — a self-building liquidity pool 💧

**$Send charges a 1% tax on every buy, sell, and transfer, and 100% of that fee is automatically added to the liquidity pool.** The resulting LP tokens are sent to a burn address, so the added liquidity is permanently locked — the pool keeps *building on itself* as more volume flows through $Send.

This is verified on-chain (the contract source is verified on the explorer, Solidity 0.8.25):

- Buy / sell / transfer fee = **1% each**, and 100% of it is earmarked for liquidity via swap‑and‑liquify — **there is no marketing or tax wallet.**
- Collected fees pool and deploy to the LP **in batches** as volume accumulates (roughly once pending ≥ ~0.35% of the pool), so liquidity grows steadily with activity.
- The LP tokens minted from those fees are sent to the dead address (**burned**), so that liquidity can never be pulled.
- **Ownership is renounced** — the 1% rate and the auto‑LP destination can **never be changed**, and there is no owner function to withdraw the collected fees.

*Independent of $Send, **$GWC** charges a 5% buy / 5% sell tax that is converted to ETH for its tax wallet — factor that in, and always verify each contract yourself on the explorer.*

---

## 2. Core features

| Feature | What it does |
|---|---|
| **Live charts & how‑to‑buy** | Real‑time Dexscreener charts, copy‑and‑verify contract addresses, and a beginner‑friendly guide to buying on Robinhood Chain. |
| **One‑click swap** | Swap ETH that's already on Robinhood Chain into $SEND / $GWC in one transaction, signed entirely in your own wallet. The panel shows the **dollar value** of what you spend and receive, **checks your ETH balance first** (and says exactly how short you are), and explains any failure **inline**, not just in a toast. Bridging in from another chain is a separate, third‑party step (the guide links Relay; a card on‑ramp such as MoonPay is linked for people with no crypto at all) — the site vouches for neither. |
| **Universal read‑only wallet connect** | Connect *any* EVM wallet — Robinhood Wallet (native to Robinhood Chain), Phantom, MetaMask, Coinbase, Trust, OKX, Rainbow — via EIP‑6963 or a mobile deep‑link. **It only ever reads your address and balances; it can never move your funds.** Your $SEND / $GWC / ETH balances show in the nav. |
| **Private wallet tracker** | Analyze any wallet's holdings, trade history, cost basis, and PNL. Track up to **10 wallets free**; hold **$GWC** and diamond‑hand it to unlock **100+** (scales with your Diamond level). |
| **The Send Wall** | A public community feed — post, react (🔥🚀), comment, and **upvote / downvote** (Reddit‑style, top‑sorted). Every sender gets a customizable public profile wall. |
| **One button, two moves** | The floating ✏️ **Send it** button (every page) opens a composer with two modes: **🧱 Post** to the Send Wall, or **📣 Send Call** — paste a contract address, see the token resolve live (logo, market cap, liquidity), add an optional note, and post a permanent scorecard. Paste an address into a plain post and it offers to make it a call instead. |
| **Rocketize your pic** | A browser-only image editor on the homepage: drop a photo, tap to add 🚀 stickers (drag, resize, rotate, duplicate, undo/redo, full keyboard control), download the PNG, or set it as your profile picture in one tap. Nothing is uploaded unless you choose to make it your avatar. |
| **Tokens are social objects** | Paste a contract address into any post or comment and it becomes its **$TICKER** (resolved on‑chain); every $TICKER is a chip that opens the same token detail popup used everywhere else. Every token card and detail popup shows whether the token **has a community** — tap it to jump in, or to start one (address prefilled). |
| **Official communities** | **$Send** and **$GWC** have house communities from day one (owned by the site's own `@JustSendIt` account, live immediately, pinned to the top of Communities) so a newcomer can see what participating looks like and join in one tap. |
| **Moderation (mute)** | From anyone's public profile: **Moderation ▾ → Mute**. Their posts, calls and comments disappear from your feeds (server‑side); anywhere else they appear they render in red with a 🔇 you can tap to unmute. Private — they are never told. |
| **Wallet Tracker page** | The whole tracker lives on its own page (`tracker.html`, in your account menu ▾): tracked wallets, instant open from an **encrypted per‑user cache**, then a live on‑chain refresh, with plain‑English explainers on every stat. |
| **Notifications** | The 🔔 bell covers level‑ups, holder/OG events and Send Call outcomes **and social activity** — new followers, comments, 🔥/🚀 reactions and upvotes on your posts (each identical message is throttled to once per 10 min, so toggling can't spam you). |
| **Token Communities** | Rally around any token: paste a contract to **start a community** (goes live at 10 members), auto‑branded from its Dexscreener art. Each has its own wall, gives members a flat **10× Send Power**, and levels up — both the community and your per‑community **conviction** — exponentially. See §3.10. |
| **Send Calls** | Go on the record: call a token you believe in and a permanent, live, on‑chain scorecard tracks how far it runs. Others can "Send It!" to follow. |
| **New Pairs Radar** | A live, honest scanner of brand‑new tokens on Robinhood Chain with plain‑English risk flags (honeypot, dumping, thin liquidity, whale‑concentration, unverified contract, serial deployer) so you can spot traps. Three views: **📈 Best Runners** (top gainers, default; 24h from real Dexscreener data, or 1W/1M/1Y/All from a persistent price‑history store — windows longer than the tracked history are honestly labeled "since Nd"), **🎬 Hot Feed** (only tokens scoring a full **100/100** — the 🚀 *Looks Good, Send It* verdict), and **📋 DEX List** (every filter, plus a two‑press 📣 Send Call button on each row). A token whose name/symbol don't resolve on‑chain ("Unknown Token" / `???`) is withheld from every radar view, server‑side and client‑side. Every on‑chain detail body opens with a **live Dexscreener chart**. |
| **Convicted In** | Pin tokens you believe in to your public wall — by pasting a contract or from any token's detail. Each chip shows its **live market cap** and **how many Xs it's up since you convicted** (baseline captured at pin time); hovering shows, when a wallet is linked, how much you hold and how long (read‑only, on‑chain, coarsened for privacy). A 💎 conviction badge appears when you're a member of that token's community. |
| **Send Power (gamification)** | Earn points for nearly everything you do, level up endlessly (no cap — Level 100 = Biggest Sender, then Send Deity and beyond), and multiply it all with your Holder Boost and Diamond Hands. |
| **🕹️ Arcade — Rocket Run** | One free flight per UTC day on `arcade.html`. A rocket climbs at `e^(0.06·s)`; the crash point is rolled **server‑side at launch and never sent to the browser** until the round resolves. Cash out any time for a **Send Power boost** of `min(5, 1 + (x−1)/4)` lasting 24h; don't cash out before it blows and you get nothing. Nothing is at stake, nothing is for sale, entertainment only. |
| **⚡ Boost in the nav badge** | Your live multiplier rides in the same badge as your level: **Lv 12 · 1,683 · ⚡1.03×**. It repaints the moment a boost starts, and drops itself when one expires. |
| **🏆 Weekly community competition** | On `communities.html`: which community's members earned it the most points **this week** (Mon 00:00 → Mon 00:00 UTC, reset server‑side). Scored purely on activity inside a community — joins, posts, reactions, comments, and its members' Send Calls on its own token, each daily‑capped per member. **Market cap counts for nothing.** No prize, just bragging rights. |
| **📅 Daily check‑in** | The daily bonus is something you *do*: a check‑in button at the top of your own wall, idempotent per UTC day, with a live countdown to the next one. |
| **Dev‑wallet communities** | The wallet that deployed (or owns) a token can start that token's community **without holding any of it** — confirmed on‑chain from a linked read‑only wallet. |
| **Sign in your way** | Wallet, email, Google, Facebook, X, or Instagram. |

---

## 3. The Rules of the Game 🎮

Everything below is exactly how the platform works — the same numbers the server uses. Nothing here is financial advice; it's a game built on public on‑chain data. **Most new tokens go to zero. Always DYOR.**

### 3.1 Send Points, Levels & Titles

Everything you do that helps the community earns **Send Power** (points, also your XP). Every action has a fixed base value; holders multiply that base (see §3.2), and a few actions scale further by how much you bought and held.

**Point values**

| Action | Base points | Notes |
|---|---:|---|
| Make a Send Call | 120 | **Scaled by your Send size** (see §3.4) |
| Swap ETH → $Send/$GWC in‑page | 450 | Largest fixed earner |
| Connect a wallet holding $Send/$GWC | 150 | Once per address, ever |
| First‑ever post | 150 | One‑time bonus |
| Per‑X milestone on a call | 180 × the X hit | **Scaled by the X** — 1x → +180, 2x → +360 … up to 50x. No daily cap, but inside the per‑call budget (below) |
| Post on the Send Wall | 75 | |
| Daily visit bonus | 60 | Once per day |
| Track a wallet | 45 | Once per address, ever |
| Customize your wall | 30 | Effectively once per day |
| "Send It!" on a call | 30 | **Scaled by your Send size** |
| Reply / comment | 24 | |
| Your post gets upvoted | 12 | Only an upvote pays the author |
| Your post receives a 🔥/🚀 reaction | 9 | |
| You react to a post | 6 | |
| You up/downvote a post | 6 | |
| Watch a token | 15 | Once per token, ever |
| Someone follows you | 15 | |
| You follow someone | 18 | Once per unique person |

Two more earn types have **no fixed base** — they're computed live from performance and shown as "⚡ scales": the **caller diamond‑hands hold bonus** and the **Sender hold bonus** (see §3.4).

**Daily caps (anti‑farm).** Cheap, repeatable social actions are capped over a **rolling 24 hours** (not a midnight reset — a slot frees exactly 24h after you used it). Hit the cap and further events of that kind pay 0 until the window rolls.

| Action | Cap / 24h | | Action | Cap / 24h |
|---|---:|---|---|---:|
| Upvote received | 100 | | Post | 40 |
| React received | 60 | | React given | 40 |
| Vote given | 60 | | Watch token | 30 |
| Someone follows you | 30 | | "Send It!" (a Send) | 30 |
| Comment | 20 | | Swap | 20 |
| Send Call (point events) | 20 | | Track wallet | 10 |
| Follow someone | 10 | | Connect wallet | 5 |

**Three earn types are deliberately uncapped by count**, because they reward real market performance rather than clicks: per‑X call milestones, the diamond‑hands hold bonuses, and the once‑per‑day visit bonus. Each is fenced by its own structural limit instead (milestone ladder caps at 50x; hold bonus caps at 750,000 base points per position; and everything pauses when a pool loses liquidity). **Every Send Call also has a lifetime budget.** Everything one call ever pays its caller — the opening award, every milestone and the hold bonus together, after multipliers — is capped at the Send Power it takes to reach **Level 70 (≈ 737,627)**, and no single payout can take more than a tenth of that. A Sender's budget on that call is a quarter of the caller's. Level 100 is about 20 perfect calls; a single call cannot reach the top of the leaderboard on its own. And one hard backstop applies to **every** award: after the base is multiplied by your Holder Boost, a single event can never mint more than **1,500,000** points — so the stacked multipliers can never run away.

**Levels — an endless climb.** Send Power feeds an exponential XP curve with **no level cap** — each level costs about **10.4% more** than the last.

| Level | Send Power | | Level | Send Power |
|---:|---:|---|---:|---:|
| 1 | 0 | | 50 | ≈ 101,333 |
| 2 | 83 | | 99 | ≈ 13.03M |
| 10 | ≈ 1,154 | | 100 | ≈ 14.39M |
| 25 | ≈ 7,800 | | 120 | ≈ 104M |

**Titles** are set purely by your level — you hold the highest one you've reached:

Fresh Sender (`<5`) → Coin Curious (5) → Send Apprentice (10) → Rocket Rider 🚀 (20) → Send Sergeant (30) → Diamond Hands 💎 (40) → Rocket Commander (50) → Send Sensei (60) → Wealth Wizard (70) → Send Lord (80) → Send God (90) → **Biggest Sender 👑 (100)** → Send Deity ✨ (110) → Eternal Sender ♾️ (125) → Sender Singularity 🌌 (150+).

### 3.2 The Holder Boost — hold to multiply everything

This is the heart of the game: **holding $Send and $GWC multiplies every point you earn.** Your boost is one number:

```
weightedPct   = yourSend% + 3 × yourGWC%        // $GWC is weighted 3× per % of supply
supplyBoost   = 10 × weightedPct                 // +10× for every weighted 1% of supply
diamondFactor = your Diamond tier factor         // 1 … up to 100 (see §3.3)

Holder Boost  = 1 + supplyBoost × diamondFactor
```

- A **non‑holder gets exactly 1×** — the boost only ever scales up.
- Every weighted **1% of supply** adds **10** to your supply boost.
- **$GWC is weighted ×3** on the supply axis — the same fraction of $GWC gives three times the boost that $Send does.
- The **supply side is uncapped**; the only cap inside the formula is the Diamond factor's **×100** ceiling (and every award is still bounded by the 1,500,000‑per‑event backstop).

**Worked examples** (fresh, unbroken streak):

| You hold | Diamond factor | Holder Boost |
|---|---:|---:|
| 1% as $Send, 60 days | 10 | **101×** |
| 1% as $GWC, 60 days | 16 | **481×** (≈4.76× more than $Send — triple weight + faster Diamond climb) |
| 0.1% as $Send, day 0 | 1 | **2×** |
| 2% as $GWC, 2+ years, never sold | 100 | **6001×** |

Your holdings are **read straight from the blockchain, server‑side** (see §3.8) — you can never type in a fake balance. And the boost **pauses back to 1× if your holdings haven't been verified on‑chain in the last 26 hours** — just open your dashboard (which re‑verifies every visit) to keep it live. A daily visitor never goes stale.

### 3.3 Diamond Hands — conviction, rewarded

The longer you hold **without selling**, the higher your Diamond tier climbs — lifting your Holder Boost, your wallet‑tracking capacity, and your daily call allowance.

| Level | Days held ≥ | Name | Factor |
|---:|---:|---|---:|
| 0 | 0 | 📄 Paper Grip | ×1 |
| 1 | 3 | ✊ Getting a Grip | ×1.6 |
| 2 | 7 | 🤝 Firm Hands | ×2.5 |
| 3 | 14 | 🔩 Steel Hands | ×4 |
| 4 | 30 | 💠 Diamond Forming | ×6.3 |
| 5 | 60 | 💎 Diamond Hands | ×10 |
| 6 | 120 | 💎 Flawless Diamond | ×16 |
| 7 | 240 | 🛡️ Titanium Grip | ×25 |
| 8 | 365 | 🏆 Diamond Legend | ×40 |
| 9 | 550 | 👑 Unbreakable | ×63 |
| 10 | 730 | 🔥 Immortal Diamond | ×100 |

**What counts as "not selling":** your no‑sell streak tracks the **peak** percentage of supply you reached. **Selling = dropping more than 2% below that peak**, which resets your streak clock and collapses your Diamond factor to 1. A small wobble within 2% doesn't count; buying more only raises the peak. Because the baseline is your all‑time streak peak (not your last reading), you can't slowly bleed tokens out just under the threshold to dodge a reset.

**$GWC climbs twice as fast:** $GWC has its **own independent** no‑sell streak (only reset when you sell $GWC), and each day holding $GWC counts as **2 days** toward your tier — `effHoldDays = max(combined no‑sell days, 2 × $GWC‑only days)`. Since it's a `max`, the $GWC bonus can only ever help.

Your Diamond level (0–10) drives three systems: the Holder Boost factor (§3.2), your wallet‑tracking capacity (§3.7), and your daily Send‑Call allowance, which is multiplied by **2^level** (§3.5).

### 3.4 Send Calls — the core game

A **Send Call** is you going on the record: a public, timestamped, **permanent** claim that a token is going to run. Once posted, *a call can never be edited or deleted* — it's on the record forever, and its all‑time high is preserved even if the token later dies. One active call per token.

**The Xs rule.** Performance is measured in **Xs**, where **+100% = 1x**: `X = current price / your entry − 1`. So +100% = 1x, +340% = 3.4x. Each call shows **Now** (live) and **Peak** (its permanent all‑time high since the call); "Now" can never display above "Peak."

**Grades (F → S)**, driven by the call's **peak** X:

| Grade | Peak X ≥ | | Grade | Peak X ≥ |
|:--:|---:|---|:--:|---:|
| 🏆 S Legendary | 20 | | 💪 C Solid | 2 |
| 🚀 A Massive | 10 | | 🌱 D Small | 0.5 |
| 🔥 B Big | 5 | | ➖ E Flat | 0 |
| | | | 💀 F Underwater | below entry |

**Liquidity gate.** A token needs **≥ $500 pooled liquidity** to be callable — thinner pools are rejected, so no one can farm points on a self‑made dust pool.

**Making a call: +40, scaled by your Send size.** The 40 base is multiplied by how much of that token you actually bought and held, then by your Holder Boost:

```
sizeMult = min(100, max(1, yourSpendUSD / 100))
```

Every **$100** of tokens bought and still held = **×1**, cap **×100** ($10k+). So $1,000 held = ×10. The anti‑cheat that makes it honest: your "spend" is credited as **min(tokens you bought from the pool, tokens you still hold) × price**, read best‑effort across up to 3 connected wallets. Taking the *minimum* defeats value spoofing, wash/recycled buys, self‑pool paper value, and airdrops. **The caller's size is captured once, at call time, and locked in** for that call's award (it fails open to $0 so it never blocks a call). *(The Senders list in this section re‑reads Senders' holdings on demand, throttled to at most once every ~5 minutes, so their "still holding" status stays current — the caller's own recorded size does not change afterward.)*

**Per‑X milestone payouts: 180 × the X.** As your call actually runs, each **whole X** it crosses pays **180 × that X** — 1x → +180, 2x → +360 … up to **50x → +9,000** (ladder caps at 50x). No daily cap (pure performance), but every payout draws on the call's lifetime budget (§3.1). Each milestone pays once, ever, and only on a price **sustained** across two samples with live liquidity still ≥ $500 — a single wick can't pay.

**Diamond‑hands HOLD bonus — the main event.** While your call stays in profit, you keep earning a **super‑linear** bonus: `owed = 0.5 × holdX^1.5` (capped at 750,000 base points per position). It is deliberately where most of a call's Send Power lives: of the per‑call lifetime budget (§3.1), the opening award may take at most 10% and the milestone ladder at most 30% cumulatively, so **at least 60% is reserved for holding in profit**. **Crew factor:** the hold integral accrues faster when the people who Sent It on your call are also in profit from *their own* entry — `rate = 1 + 0.1 × (Senders in profit)`, capped at **3×** (twenty profitable Senders). A conviction play that carries other people with it is worth more than a lonely one. It compounds with both height and duration, accrues **only while the pool is liquid and you're in profit** (underwater/drained ticks earn nothing and are never back‑credited), and pays out once at least 20 points are owed.

**Send It! — following a call.** Tap **"Send It!"** to Send It on someone else's call: base **30**, scaled by *your* Send size and Holder Boost, capped at 30 Sends/day. Points pay only on your **first** Send per call; you can't Send It on your own. Your Xs are measured from the price when *you* Sent It, and **Senders earn the same diamond‑hands HOLD bonus** the caller does.

**The senders list.** Each call shows who's behind it, ranked by conviction: `$ put in × (1 + days held) × (1 + your Xs)`. Anyone **not holding** any more drops below every current holder. Top 3 show inline; "Show all" pulls the full ranked list.

### 3.5 Daily Call Limits & keeping it fair

**The dynamic earned limit (base 5, floats 1–5).** Everyone starts with 5 calls/day over a rolling 24h. That earned number floats on the quality of your matured calls (judged once ≥24h old): at least one **doubled** (peak ≥ 1x) → **+1** (cap 5); only duds → **−1** (floor 1). One step per day; even a persistently bad caller always keeps at least **1**.

**Diamond boost: ×2^level.** Your earned limit is multiplied by 2 to the power of your Diamond level (Lv0 ×1 … Lv10 ×1024). Spoof‑proof, and pauses if your holdings go unverified for 26h.

**The RUGGED penalty (−2).** If a token you called started with real liquidity but its pool later **collapses below $100**, the call is permanently marked **💀 RUGGED**, and your daily call limit is **docked by 2** (floored at 1), with a notification. Fires once per call, only on a definitive on‑chain read below $100 (a failed fetch never triggers it). Between $100 and $500, all point‑crediting simply pauses.

**The no‑DYOR flag.** Post a call **without first opening that token's full on‑chain detail** and it's stamped: *"⚠️ Not researched — the caller made this call without opening the token's full on‑chain details first. DYOR."* (A client‑side session flag reflecting UI interaction, not a server‑verified fact.)

**Spam trap.** Burn your *entire* daily allowance within **60 minutes** (only if your limit is ≥3) and you're flagged for spamming, which puts you into Read‑Only Mode (§3.6). There's also a hard rate limit of 10 calls per 10 minutes.

### 3.6 Read‑Only Mode & redeeming with $Send

Tripping the spam trap mutes your account, escalating with each **distinct** offense: **1st → 24 hours**, **2nd → 1 week**, **3rd+ → permanent**.

**Blocked while muted:** making calls, Sending It, posting, commenting, reacting, voting, following, tracking wallets, customizing. **Still allowed:** your daily visit bonus, buying & holding $Send/$GWC (your Holder Boost keeps compounding), swapping (points still count), connecting/refreshing a wallet, and browsing everything.

**Redeem with $Send — buy your way out early.** Any restriction can be lifted by **buying and then holding** enough $Send, verified on‑chain:

| Restriction | Cost to redeem |
|---|---|
| 24‑hour mute | $25 of $Send |
| 1‑week mute | $175 of $Send |
| Any timed mute | $25 per 24 hours |
| Permanent mute | flat **$1,000** of $Send |

Only $Send you buy **after** your baseline (recorded when the restriction was applied, or on your first redeem tap if no wallet was linked) counts — a pre‑existing bag can't fake a buy, and pricing is fail‑closed (no price ⇒ no redemption).

**Post‑redemption probation — hold, or it comes back doubled.** Lifting a restriction starts a hold: keep the $Send you bought for the restriction's own length (timed) or **40 days** (permanent). "Sold" = dropping >2% below the balance floor. Sell during a **timed** hold → it returns with the **timer doubled** (and the next buy‑out costs double); sell during a **permanent** hold → back to permanent. Hold to term and it's fully cleared. Sells are caught by a throttled recheck before your next action **and** a background sweep every 5 minutes.

### 3.7 Safety tools

**Read the honesty rule first: every safety readout is an automated heuristic pattern‑scan of public on‑chain data. It is not an audit, and it never simulates a buy or sell.** It's a starting point for your own research, never a guarantee or a "buy."

**Contract scanner — owner‑power flags.** Expanding a token's "Contract & trust" section fetches its **verified** source and scans for owner powers that can trap you:

| Flag | Severity | The owner could… |
|---|:--:|---|
| Blacklist | 🔴 critical | Block wallets from selling (classic honeypot) |
| Change fees | 🟠 high | Raise the sell tax toward 100%, trapping sellers |
| Mint | 🟠 high | Inflate supply and dump it |
| Pausable | 🟠 high | Freeze all transfers, including sells |
| Trading toggle | 🟠 high | Turn selling off at will |
| Max limits | 🟡 medium | Cap buy/sell/wallet size (can block selling) |

It's a purely lexical scan (a token can dodge a flag by renaming a function, or trip one on a harmless word). If the source is **not verified**, no powers are scanned — and unverified is itself a **medium‑weight flag (−15)**, so an unverified token can still reach "Looks OK" on other merits; treat that verdict as "nothing *visible* is wrong", not as safe. Cached 30 minutes.

**LP‑lock check.** Reads the top 15 LP holders and sums how much sits in burn addresses or named lockers: **≥50%** → "looks locked / burned"; below → "does NOT look locked (rug risk)"; can't tell → "couldn't tell." A snapshot of *where LP is now*, not an unlock‑date check.

**Health score (0–100).** Start at 100, subtract a weight per risk flag:

| Flag | −Weight | Trips when |
|---|---:|---|
| 🍯 Honeypot suspect | 45 | ≥12 buys in 24h and **exactly 0** sells |
| 📉 Dumping | 32 | Price down ≥50% in the last hour |
| 🚩 Serial deployer | 26 | Deployer launched ≥3 tokens recently |
| 💧 Low liquidity | 26 | Liquidity < $1,500 |
| 🐋 Concentrated | 20 | Top holder ≥ 30% |
| ❓ Unverified | 15 | Contract source not verified |
| 👤 Low holders | 15 | Fewer than 25 holders |
| 🔻 Sell pressure | 12 | Sells > 2× buys, and ≥12 sells |
| 🥱 Dead volume | 12 | 24h volume < $300 and older than 60 min |

**Triage:** ≥70 "Looks OK" · ≥40 "Caution" · ≥15 "High risk" · else "Avoid." Anti‑greenwashing: if any high/critical flag trips, a token can *never* show the green tier. Four sub‑scores (Liquidity · Holders · Trading · Contract) each get a letter grade to show *how* the score was reached.

**Safety filter** — three views, and **Safer** is the default on every visit (never persisted, so protection is always the arrival default): **🛡️ Safer** shows a token only if it's **not risky and scores ≥ 75** (honeypot/serial‑deployer tokens are *always* hidden there); **🌐 All** shows everything *except* tokens flagged risky or with too little liquidity to trade; **☠️ Risky** shows only those hidden ones, so nothing is ever silently unreachable.

**Watchlist:** save up to **500** tokens, each with the same live score/flags. **Read‑only wallet tracker:** track wallets and get a browser‑computed PNL report (average‑cost basis, realized + unrealized) — it never signs, sends, or moves funds. If the explorer's balance read fails, the report says so instead of quietly showing $0. 10 wallets free; a fresh $GWC diamond‑holder at tier ≥1 unlocks `min(1000, level × 100)`. It reads a bounded history and flags "PNL is partial" for very active wallets — an approximation, not accounting.

### 3.8 Fair & spoof‑proof

The whole economy rests on holdings being **real**, so JustSendIt reads them straight from the blockchain, server‑side — the client never supplies a balance.

- **Holder Boost & Diamond tier** are computed from on‑chain balance and total‑supply reads on your linked wallets. You cannot type in a fake number.
- **Send size** on calls and Sends is a best‑effort read of `min(tokens bought from the pool, tokens still held) × price` across up to 3 wallets — the minimum defeats spoofing, wash buys, self‑pool value, and airdrops.
- **The boost pauses when stale** (holdings unverified for 26h) — otherwise someone could refresh once, sell, and keep the boost forever. Opening the dashboard re‑verifies automatically.
- **Fail‑closed reads:** if an on‑chain read errors, the system refuses rather than treating it as a zero balance, so a transient RPC outage can't wrongly reset an honest holder's streak.

### 3.9 Golden rules

- **This is entertainment** — a game and a community, not financial advice. We never tell you to buy.
- **Most new tokens go to zero.** Treat every call, score, and green checkmark as a starting point, not a promise.
- **The safety tools are heuristics, not audits.** They never simulate a buy or sell to prove you can actually get out.
- **Send size is best‑effort** — a live read of `min(bought, held)`, hard to fake but still an approximation.
- **Your boost pauses if it goes unverified** — keep your bags fresh by checking in.
- **Always DYOR.** Never invest more than you can afford to lose. The only thing the code can prove is what's on‑chain right now.

### 3.10 Communities & Conviction 🏘️

Rally the fans of a token into one place. A **community** is a fan group for a single token — **not an endorsement**, and the person who starts one is a **community starter**, never a "dev".

**Starting & going live**
- **Anyone can start one** by pasting a token's contract address. The token needs **≥ $500 liquidity** (same floor as Send Calls — no communities on a dust pool), and there's one community per token. The starter is auto‑opted‑in as the first member.
- Each community is **auto‑branded** from its Dexscreener/on‑chain art (logo + banner), with live market cap, holders, and 24h price change on its card and page.
- A community **goes LIVE once 10 members opt in — and only real holders count.** To start, join, or post in a community you must **hold that community's own token**, verified on‑chain from a linked (read‑only) wallet. On top of holding, **no more than 2 counting opt‑ins per network address** (the starter's own network is excluded). Holding is an **ongoing** requirement, not a one‑time check: a background sweep re‑reads each qualified member's balance and **revokes their qualification + the 10×** if they sell or move the tokens out — so you can't qualify once and keep the boost forever.

**Who can see vs. who can post**
- **Anyone can read a live community's wall** — click any community card and browse its posts, photos, GIFs and videos without an account.
- **Only members can post.** Posting requires opting in, and opting in requires **connecting a wallet and confirming on‑chain that you hold the community's token**. Members post exactly what the Send Wall supports — text, **photos, GIFs and videos** — through the same compressed, streaming upload pipeline.

**The 10× multiplier (Send Power bonus)**
- While you're a qualified member of **≥ 1 live community**, **every point you earn is multiplied 10×** — a flat **10×** applied in the same `awardPoints` path as everything else, so it stacks *on top of* your Holder Boost and OG bonus. The full stack the server multiplies is: `base × HolderBoost × OG × Community`. Every action you take **inside a community** (posting, reacting, commenting on its wall) earns Send Power at that 10×, and your dashboard shows the bonus as an achievement you can unlock.
- It's a **flat 10×** — being in five live communities is still 10× (it doesn't stack with itself).

**Founder bonus** — when a community reaches 10 members and flips to live, its starter earns a **one‑time founder bonus** of **+15,000 base Send Power**, itself run through the normal multiplier path like any award (so a starter who is now in their own live community receives it ×10, and more with a Holder Boost/OG). It's **idempotent** — it can never be paid twice, even on rejoins.

**Members & member levels** — every community page lists **all of its members**, ranked by their **community member level** (the conviction level below), with the top three medalled and the starter crowned 👑. Participating raises your own member level *and* contributes XP to the community itself — so an active member is literally what levels a community up.

**Community level (exponential curve)** — a community earns XP when its **distinct members** are active on its wall (join, post, react, comment). XP is **daily‑capped per community** *and* **capped per member per day** (so a single spammer can't level it), and only accrues while the community is **live**. Its level uses the same `levelForXp` curve as personal levels. The most active communities (a time‑decayed activity score, ~12h half‑life) float to the top of the grid.

**Conviction (per member, per community)** — your **member level** (your "conviction") in a community rises the longer you're a qualified member and the more you post/comment/react there (daily‑capped at 150 conviction XP/community/day). It surfaces as a **💎 Lv N badge next to that token** in the **Convicted In** section of your public wall, titled Newcomer → … → Ride‑or‑Die.

**Making a Send Call from anywhere** — the floating ✏️ button's **📣 Send Call** tab takes a pasted contract address, resolves it on-chain (symbol, name, market cap, liquidity) and posts the call. The button stays disabled until the token resolves and clears the **$500 liquidity** floor, it shows how many calls you have left today, and a "see the full on-chain detail first" link opens the same token popup used everywhere else — calls made without opening it are flagged on your wall, exactly as they are from the radar.

**Losing and regaining your verified slot** — the 10‑minute holder sweep (or disconnecting your wallet) flips a member who no longer holds the token to *unverified*: no posting, no 10×, and the go‑live count drops by one. It is not a dead end: buy/relink and tap **↻ Re‑verify holdings & opt back in** on the community page — the same membership row re‑qualifies (your member level is untouched, and nothing is paid twice). If you hold but a verified slot is blocked by the anti‑sybil caps (≤2 verified opt‑ins per network; the starter's own network never counts), the page says so instead of pretending you're in.

**The official communities** — `$Send` and `$GWC` are seeded as **official** communities owned by the site's own `@JustSendIt` account (a system account: it never ranks, never posts, never earns). They are live from day one, pinned in their own strip at the top of the Communities page on every tab, and join exactly like any other community (hold the token → opt in → 10×). They exist so a first‑timer can *see* a working community before starting one.

**Viewing vs. participating** — anyone, signed in or not, can open any community and read its wall, members and stats. Opting in (and therefore posting, reacting, commenting, and the 10×) requires connecting a wallet — a free, read‑only signature — and holding that token on‑chain.

**Tokens in posts** — a pasted contract address is looked up on‑chain when the post is saved and rewritten to its `$TICKER`; the post keeps a small token map, so every `$TICKER` renders as a chip that opens the token detail popup (with the community tag inside). `$SEND` / `$GWC` mentions always resolve. Unresolvable addresses stay as typed (shortened, with a copy button).

**Muting (user‑side moderation)** — on anyone's public profile: **Moderation ▾ → Mute @name**. The server then drops their posts, calls and comments from *your* Send Wall, community walls and comment threads; wherever they still appear (leaderboards, member rosters, someone else's call, notifications) their name renders **red with a 🔇** that opens an unmute popdown. Mutes are private (the muted person is never told), instant, and reversible. Their own profile stays viewable if you open it — you chose to.

**Posting from a community page** — once you're a qualified member, the floating ✏️ *Send it* button posts to *that* community's wall (it scrolls to and focuses the community composer). Anywhere else — or on a community you haven't joined — it opens the global Send Wall composer and, after posting, offers a *View on the Wall* link instead of yanking you off the page.

**Honest residual risks / limitations**
- The anti‑sybil gate is **on‑chain holding of the community token + a ≤2‑per‑network cap + continuous re‑verification**, not proof‑of‑personhood. A determined actor could still buy the token across several funded wallets and rotate IPs to manufacture a go‑live — but it now costs **real, sustained capital** (the sweep revokes qualification the moment the tokens leave a wallet), not a free throwaway account. The dust floor for "holds" is the same tiny `OG_DUST_WEI` used elsewhere.
- Going live is **one‑way** — leaving a live community never un‑lives it and never claws back the founder bonus.
- Market stats on community cards are cached (~45s refresh) and are **display only** — nothing about a community implies the token is safe or a good buy. **Most tokens go to zero.**

---

### 3.11 OG tiers — being early, three ways 🏅

Hold **both $Send and $GWC**, bought from the market, and keep holding both: you earn a **permanent OG badge** and a Send Power multiplier that stacks with everything above. There is **one standard**; only *when* you got in changes the size.

| Tier | Multiplier | Entry window (days from each coin's launch) | Binding close* |
|---|---:|---|---|
| 🥇 Gold | **10×** | days 0–30 — the first month | 2026‑09‑18 |
| 🥈 Silver | **5×** | days 30–90 — the two months after gold | 2026‑11‑17 |
| 🥉 Bronze | **3×** | days 90–360 — the nine months after silver | 2027‑08‑14 |
| — | 1× | after day 360: no badge, whatever you buy | — |

\* Windows are measured from **each coin's own launch** (`OG_LAUNCH` in `server.js`, the on‑chain pair‑creation timestamps: $GWC 2026‑08‑19, $SEND 2026‑08‑25), and your tier is the **lower** of your two coins, because the rule is that you held both. So the binding date is $GWC's, six days ahead of $SEND's. Twelve 30‑day months in all — 30 days is what "a month" has always meant here. Nothing schedules this: a tier is a pure function of an on‑chain buy timestamp, so the campaign advances and closes by itself. The live clock is served at `GET /api/og/campaign`; the homepage banner, the About page and the dashboard all read it rather than hard‑coding a date.

**The standard, identical in every window.** Verified read‑only from your linked wallets, across all of them:
- You **bought** each coin from the market — tokens leaving the LP pool, or the measured router, for your wallet. Your first such buy of the *later* coin is the moment you "completed the pair", and that timestamp decides your tier. A transfer from another wallet is not a buy.
- You **still hold both** now, across any linked wallet (moving your bag to a hardware wallet is fine).
- **Two things disqualify a wallet:** if it dumped its whole holding to nothing inside *its own* first 30 days **and** it holds less today than it did at the end of those 30 days, it earns nothing. A wallet that sold out but bought back past where it stood keeps its place. ("Net accumulator" is measured this way on purpose: a wallet's total bought minus total sold *is* its balance, so "bought more than sold" would only re‑ask "do you hold any", which is already required.)

**Losing it.** Sell out of either coin entirely, at any time, and the badge is revoked **for good**. The badge follows your wallet: unlink it and the badge pauses until you relink and are re‑verified. Like every holding‑based bonus, it pays only while your holdings were re‑checked on‑chain within the last 26 hours.

**Fail‑closed, always.** Every scan replays your wallet's full transfer history for the coin and must reconcile exactly with the chain's `balanceOf` before anything is written. A read that cannot be completed — explorer throttling, a dropped page — is retried later, never recorded as an answer, so nobody is denied a badge by an outage. Verification stays open for **90 days after the last window closes** for the same reason; what you *earned* is fixed by your buy timestamp, so late scanning can never manufacture a tier.

## 4. How to participate — in 4 steps

1. **Get a wallet** and add Robinhood Chain (Robinhood Wallet supports it natively; any EVM wallet works).
2. **Grab some $SEND / $GWC** using the how‑to‑buy guide and the in‑page swap — always verify the contract address first.
3. **Create your account** (wallet, email, Google, Facebook, X, or Instagram), connect your wallet read‑only, and claim your unique @handle.
4. **Send it.** Post on the Send Wall, join or start a **community** for a flat 10×, make and follow Send Calls, react and vote, track wallets, ride the New Pairs Radar, and stack Send Power — hold and diamond‑hand to multiply it all.

---

## 5. Running it (technical)

- **Stack:** a zero‑framework Node.js HTTP server + built‑in `node:sqlite`. No build step. Frontend is vanilla JS under a strict Content‑Security‑Policy (`script-src 'self'`). Requires Node ≥ 24.
- **Start:** `node server.js` (serves `public/`, stores data in `data/`).
- **Security & privacy (built in):**
  - **Encryption at rest.** Emails, wallet↔account links, OAuth subjects, 2FA secrets, tracked wallets, sign‑in nonces, tracker reports and IPs are stored **AES‑256‑GCM‑encrypted** under `DATA_KEY`, with HMAC blind indexes for the lookups the server needs (login by email, wallet by address). Session cookies are stored only as SHA‑256 hashes; passwords as scrypt hashes. The most sensitive fields are encrypted; a copy of the database without the key does not reveal emails, linked wallets or 2FA secrets. Public content (usernames, posts, the follow graph) is stored in the clear, because it is public on the site anyway. **Set `DATA_KEY` (64 hex chars) in production**; otherwise a key is generated once into `data/.data_key` (chmod 600) — back it up separately from the DB, and never lose it.
  - **Phishing‑resistant wallet sign‑in.** The message you sign is domain‑bound (SIWE‑style: it names this site's host, URI, chain ID, a one‑time nonce and an expiry) and the server only accepts the exact message it issued, so a signature harvested on any other site can never open a session here. 2FA confirmations are domain‑bound too.
  - **Two‑factor for everyone.** Authenticator app, wallet signature, or — for wallet‑first accounts that add an **email + password** (Profile → Security) — the **password as the second factor** for wallet sign‑ins. Changing or removing 2FA always requires the current factor; for wallet‑2FA only wallets linked *before* it was enabled count.
  - Strict CSP (`script-src 'self'`), HttpOnly/SameSite cookies, per‑route rate limits, read‑only wallet connect (a free signature, never a transaction or approval).
- **Required in production** (see `.env.example` and `DEPLOY.md`): `DATA_KEY` (64 hex chars — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `BASE_URL` (your real `https://` origin — it drives every canonical / og / twitter / JSON‑LD / sitemap / robots URL at serve time, the CSRF origin check, and OAuth callbacks), `COOKIE_SECURE=1` (Secure session cookies), and `TRUST_PROXY=1` when behind nginx/Caddy/Cloudflare (otherwise every visitor shares the proxy's IP and the per‑IP rate limits + community anti‑sybil caps misfire).
- **Optional environment variables** to enable extras (all off by default):
  - OAuth: `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET` (each provider's callback is `…/api/auth/<provider>/callback`).
  - `MOONPAY_API_KEY` for the fiat on‑ramp widget. `BACKUP_DIR` to move the daily DB snapshots (default `data/backups`).
- **Backups:** the server writes one consistent snapshot per UTC day to `data/backups/app-YYYY-MM-DD.db` (SQLite online backup API — safe while running; last 7 kept). **Restore:** stop the server, copy the snapshot over `data/app.db`, delete any `app.db-wal` / `app.db-shm` next to it, start. Copy `data/uploads/` separately (avatars, headers, post media).
- **On deploy:** the placeholder SEO domain is swapped for `BASE_URL` automatically — just set it, and register your OAuth callback URLs.

---

## 6. Community

- 🌐 [GenerationalWealthCoin.com](http://GenerationalWealthCoin.com)
- 💬 Telegram: [t.me/generationalwealthcoin](https://t.me/generationalwealthcoin)
- 🐦 X / Twitter: [x.com/senditrh](https://x.com/senditrh)

---

*Built for fun and community. Just $Send It. 🚀*
