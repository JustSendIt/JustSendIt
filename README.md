# $Send — Just Send It 🚀

**A community platform, game, and honest on-chain toolkit for the $Send (SEND IT) memecoin on Robinhood Chain.**

> 🎉 Entertainment purposes only. Not financial advice. Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. "Robinhood Chain" refers to the public blockchain network of that name. Memecoins are extremely volatile — you can lose everything you put in. Always do your own research.

**New here?** [`public/whitepaper.html`](public/whitepaper.html), served at `/whitepaper.html`, explains the whole project in plain English — what it does, how it protects your data, the full points economy with every number, the games, and an honest list of its limits. Open it in a browser, or run `npm run whitepaper` to render it as a PDF.


### What this repository is

This is the complete source of the JustSendIt website, released to the public domain under
[CC0 1.0](LICENSE) so anyone can read, audit, fork or self-host it. It is the code, not a service:
running it yourself gives you your own independent site with its own database and its own users.

A fork is not the official deployment and is not endorsed by it. The contract addresses below are
real mainnet addresses, so if you are looking for the live site, confirm the domain rather than
trusting any copy of this code you happen to find.

**Media note:** the site's feature video and theme audio are deliberately **not** in this repository. Their rights could not be established, and CC0 is an irrevocable grant that cannot be made over work you do not own. `public/index.html` still references the video, but the server reports which optional media files exist (`GET /api/config` → `media`) and the pages hide what is missing: the feature‑video section (and its poster) is not shown when the video is absent, and no music player is drawn when the theme audio is absent. A fresh clone simply shows neither until you supply footage and a theme of your own.

---

## 1. What is this?

**$Send / Just Send It** is a fan-built community hub for the **$Send** memecoin (and its sibling **$GWC**, Generational Wealth Coin) living on **Robinhood Chain** — an Ethereum Layer‑2 (chain ID 4663). It turns "watching a memecoin" into something you can actually *do*: connect a wallet (read‑only), track holdings, post on a social wall, call the tokens you believe in, discover new pairs safely, and earn **Send Power** for taking part.

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
| **Live charts & how‑to‑buy** | Our own on‑chain charts — candles built from each pair contract's own `Swap` logs, a labelled UTC time axis, a hover readout giving the price, the market cap and the swap count for the candle under the pointer, and event markers for Send Calls, Sent Its, conviction plays, deployer trades and the first ten buyers a pool ever had, each layer toggleable with one press for a clean price‑only chart. Drag the time axis or the price gutter to stretch or compress either scale, drag the chart to pan, and press **↺ Fit** to go back. Plus copy‑and‑verify contract addresses and a beginner‑friendly guide to buying on Robinhood Chain. |
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
| **Token Communities** | Rally around any token: paste a contract to **start a community** (goes live once **10 verified holders** have opted in — an opt-in only counts when a linked read-only wallet is verified on-chain to hold at least **$100** of the token; members without that don't count, see §3.10), auto‑branded from its Dexscreener art. Each has its own wall, gives verified holders a flat **10× Send Power**, shows the **share of the token's supply held in members' linked wallets** (summed from the chain's own holder ledger — or from direct balance reads when that ledger can't be trusted — to two significant figures, and only once **3 or more** members have a read‑only wallet linked, so nobody's balance can be read off the figure), and levels up — both the community and your per‑community **conviction** — exponentially. See §3.10. |
| **Send Squads** 🛡️ | A **private, token‑gated group**. The owner names it, gives it a bio, a picture and a banner, and sets **one gate at creation that can never be changed** — **open** (anyone with an account), **a number of tokens**, or **a percentage of the token's total supply** — checked against the **sum of a member's linked read‑only wallets** on‑chain and **re‑checked on a rolling schedule** (`sweepSquadGates`: 40 members every 10 minutes, oldest check first). Its wall is visible **only to verified members** and never reaches the Send Wall or a profile. Members send **Send Calls to the squad**: every point those calls earn — the opening award, the X ladder, the hold bonus, every Send It — goes to the **squad**, and the person earns **0**. Members' pinned Conviction Plays earn the squad a little on every UTC day they are still held. A squad has a level (the same `levelForXp` curve), a weekly board (Mon 00:00 UTC, no prize) and a lifetime tracker of **paper** figures. The house **`$GWC 2% Squad`** takes 2% of $GWC's total supply to get in. Everything squad‑related is behind a sign‑in (`401 need_signin`). See §3.10e. |
| **Send Calls** | Go on the record: call a token you believe in and a permanent, live, on‑chain scorecard tracks how far it runs. Others can "Send It!" to follow. |
| **Scanner** | Paste **any token or pool address on Robinhood Chain** and read its full on‑chain profile — the same chart, score breakdown, market, activity, holders (counted from the token's own `Transfer` events on‑chain once its ledger is built — until then from GoPlus or the explorer — and labelled `chain`, `goplus` or `explorer` by where the number came from, an on‑chain count stamped with the block it is current to), block‑0 buyers and contract read the site shows for every coin. A pool address resolves to the token it prices. Every scan re‑reads the chain (a row younger than **5 s** is shared, anything older is fetched live) and is kept in a `scans` store for everyone — the token, the time and the count, **never who scanned** — so a coin someone already scanned pulls up with its latest read, each new scan updates it, and a known pool never needs a chain call to resolve again. When the price feed and the chain are both unreachable the last snapshot is served **marked stale with the time it was read**, never as live. `GET /api/scan/recent` lists the last 12 (public). Open to everyone, signed in or not; other chains are coming soon. The **New Pairs Radar** below lives on the same page as a second tab, **for members only** (it asks you to sign in or get a ticket first). **Send Call it from the scan:** 📣 **Send Call to the Wall** on every result, and 🛡️ **Send Call to** *your squad* when you are a verified member of a Send Squad (no squad, no button). Both open the site's one composer in call mode with the token filled in and read; the full on‑chain detail is on screen, so the call is not flagged "made without DYOR". Everything a call needs — sign‑in, the $SEND check, today's allowance, enough liquidity — is still asked as for any other call. |
| **New Pairs Radar** | A live, honest scanner of brand‑new tokens on Robinhood Chain with plain‑English risk flags (honeypot, dumping, thin liquidity, whale‑concentration, unverified contract, serial deployer) so you can spot traps. Three views: **📈 Best Runners** (the top **50** gainers among tokens holding at least **$300** of liquidity — the same floor decides whether a sighting is trustworthy enough to set a baseline or move a peak; 24h from real Dexscreener data, or 1W/1M/1Y/All from a persistent price‑history store, with windows longer than the tracked history honestly labeled "since Nd", and a **🔎 *since scanned*** chip giving the multiple from the earliest price we ever retained for that token, in the Send Call convention where +100% = 1x), **🎬 Hot Feed** (a full **100/100**, no tripped flag, enough data to judge, **and** a completed block‑0 scan that came back clean — four conditions, not one; a token with a perfect score whose sniper scan hasn't finished is held back rather than promoted), and **📋 DEX List** (every filter, plus a two‑press 📣 Send Call button on each row). A token whose name/symbol don't resolve on‑chain ("Unknown Token" / `???`) is withheld from every radar view, server‑side and client‑side. Every on‑chain detail body opens with the same **on‑chain chart** the landing page uses — built from the pair's own `Swap` events, with the site's event markers on it and both scales draggable. |
| **Conviction Plays** | Pin tokens you believe in to your public wall — by pasting a contract or from any token's detail. Each chip shows its **live market cap** and **how many Xs it's up since you convicted** (baseline captured at pin time); hovering shows, when a wallet is linked, how much you hold and how long (read‑only, on‑chain, coarsened for privacy). A 💎 conviction badge appears when you're a member of that token's community. |
| **Send Power (gamification)** | Earn points for nearly everything you do, level up endlessly (no cap — Level 100 = Biggest Sender, then Send Deity and beyond), and multiply it all with your Holder Boost and Diamond Hands. |
| **🕹️ Arcade — Rocket Run** | One free flight per UTC day on `arcade.html`. A rocket climbs at `e^(0.06·s)`; the crash point is rolled **server‑side at launch and never sent to the browser** until the round resolves. Cash out any time for a **Send Power boost** of `min(5, 1 + (x−1)/4)` lasting 24h; don't cash out before it blows and you get nothing. **Your daily go is spent at takeoff, not at cash‑out** — and a round left open for more than **5 minutes** is force‑expired ("the rocket flew off without you"), with no boost and no second flight that day. So don't launch and walk away. Nothing is at stake, nothing is for sale, entertainment only. |
| **⚡ Boost in the nav badge** | Your live boost rides in the same badge as your level: **Lv 12 · 1,683 · ⚡1.03×**. It repaints the moment a boost starts, and drops itself when one expires. |
| **🏆 Weekly community competition** | On `communities.html`: which community's members earned it the most points **this week** (Mon 00:00 → Mon 00:00 UTC, reset server‑side). Scored purely on activity inside a community — joins, posts, reactions, comments, and its members' Send Calls on its own token, each daily‑capped per member. **Market cap counts for nothing.** No prize, just bragging rights. |
| **📅 Daily check‑in** | The daily bonus is something you *do*: a check‑in button at the top of your own wall, idempotent per UTC day, with a live countdown to the next one. |
| **Dev‑wallet communities** | The wallet that deployed (or owns) a token can start that token's community **without holding any of it** — confirmed on‑chain from a linked read‑only wallet. |
| **Sign in your way** | Wallet, email, Google, Facebook, X, or Instagram. |

---

- **A dashboard in tabs, a motion switch, and the rain.** Your Send Station is five panels — Overview ·
  Wallet · Invites · Tracker · Settings — instead of one long scroll, and every deep link that existed
  still lands where it did. The ⏸ in the nav pauses every decorative animation (the ticker, the hero
  field, the world grid, the falling glyphs) and remembers the choice on your device; it works signed out.

## 3. The Rules of the Game 🎮

Everything below is exactly how the platform works — the same numbers the server uses. Nothing here is financial advice; it's a game built on public on‑chain data. **Most new tokens go to zero. Always DYOR.**

### 3.1 Send Points, Levels & Titles

Everything you do that helps the community earns **Send Power** (points, also your XP). Every action has a fixed base value; your boosts scale that base (see §3.2 — they add together, they do not multiply), and a few actions scale further by how much you bought and held.

**Point values**

| Action | Base points | Notes |
|---|---:|---|
| Make a Send Call | 120 | **Scaled by your Send size** (see §3.4) |
| Swap ETH → $Send/$GWC in‑page | 450 | A real buy: your wallet must **receive ≥ $10** of the coin (a sell pays nothing); 3 a day |
| Connect a wallet holding $Send/$GWC | 150 | Once per address, ever |
| First‑ever post | 150 | One‑time bonus |
| Per‑X milestone on a call | 170 + 17 × (X − 1) | **A straight line, not a multiplier** — 1x → +170, 2x → +187, 10x → +323, 50x → +1,003 (ladder caps at 50x). No daily cap, but inside the per‑call budget (below) |
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
| Upvote received | 30 | | Post | 40 |
| React received | 20 | | React given | 40 |
| Vote given | 60 | | Watch token | 5 |
| Someone follows you | 10 | | "Send It!" (a Send) | 30 — paid only on a verified buy |
| Comment | 20 | | Swap | 3 |
| Send Call (point events) | 20 | | Track wallet | 3 |
| Follow someone | 10 | | Connect wallet | 1 |

**Three earn types are deliberately uncapped by count**, because they reward real market performance rather than clicks: per‑X call milestones, the diamond‑hands hold bonuses, and the once‑per‑day visit bonus. Each is fenced by its own structural limit instead (milestone ladder caps at 50x; the hold bonus is bounded by whatever the call's budget has left — up to about **737,600** for the caller and **184,407** for a Sender, after boosts; and everything pauses when a pool loses liquidity). **Every Send Call also has a lifetime budget.** Everything one call ever pays its caller — the opening award, every milestone and the hold bonus together, after multipliers — is capped at the Send Power it takes to reach **Level 70 (≈ 737,627)**, and no single payout can take more than a tenth of that. A Sender's budget on that call is a quarter of the caller's. Level 100 is about 20 perfect calls; a single call cannot reach the top of the leaderboard on its own. And two hard ceilings apply to **every** award: after the base is multiplied by your boosts, a single event can never mint more than **73,762** points, and a shared rolling‑24h budget of the same **73,762** covers **every kind that has a daily cap plus the daily check‑in** — which includes opening a Send Call, tapping Send It, a verified swap and the founder bonus. Only three kinds sit outside it: the per‑X milestones (`call_x`) and the two hold bonuses (`call_hold`, `hop_hold`). So "Send Call performance pays in full" is true of the ladder and the hold bonus, but **not** of the opening award — that one draws on the same shared grind budget as posting.

**One ceiling for the grind.** Everything that is not Send Call performance — every daily‑capped kind plus the check‑in — shares **one rolling‑24h budget of 73,762 Send Power on what is paid** (`SOCIAL_DAY_CAP`, a tenth of a call's lifetime budget), and **no single award exceeds 73,762** (`PTS_EVENT_CAP`). Your boosts have no ceiling and still show in full; they pay in full on Send Call performance, and on the grind they pay until the day's ceiling. That is what keeps Level 100 (≈14.4M) a long climb for everyone: ≈195 maxed days of grinding, or ≈20 perfect calls held in profit.

**Levels — an endless climb.** Send Power feeds an exponential XP curve with **no level cap** — each level costs about **10.4% more** than the last.

| Level | Send Power | | Level | Send Power |
|---:|---:|---|---:|---:|
| 1 | 0 | | 50 | ≈ 101,333 |
| 2 | 83 | | 99 | ≈ 13.03M |
| 10 | ≈ 1,154 | | 100 | ≈ 14.39M |
| 25 | ≈ 7,800 | | 120 | ≈ 104M |

**Titles** are set purely by your level — you hold the highest one you've reached:

Fresh Sender (`<5`) → Coin Curious (5) → Send Apprentice (10) → Rocket Rider 🚀 (20) → Send Sergeant (30) → Diamond Hands 💎 (40) → Rocket Commander (50) → Send Sensei (60) → Wealth Wizard (70) → Send Lord (80) → Send God (90) → **Biggest Sender 👑 (100)** → Send Deity ✨ (110) → Eternal Sender ♾️ (125) → Sender Singularity 🌌 (150+).

### 3.2 The Holder Boost — hold to boost everything

This is the heart of the game: **holding $Send and $GWC boosts every point you earn.** Your Holder Boost is one number, and it is the first term of a sum — every boost on the platform **adds** what it pays above 1× (`1 + (Holder − 1) + (OG − 1) + (Community − 1) + (Arcade − 1) + (Prize − 1) + (Beta − 1)`, where Beta is the permanent ×2 a beta top‑ten badge pays — `BETA_BADGE_MULT`); boosts never multiply each other:

```
weightedPct   = yourSend% + 3 × yourGWC%        // $GWC is weighted 3× per % of supply
supplyBoost   = 10 × weightedPct                 // +10× for every weighted 1% of supply
diamondFactor = your Diamond tier factor         // 1 … up to 100 (see §3.3)

Holder Boost  = 1 + supplyBoost × diamondFactor
```

- A **non‑holder gets exactly 1×** — the boost only ever scales up.
- **A bag only counts at $100 or more.** See §3.2.1 — this is the floor, and it applies to every token on the site.
- Every weighted **1% of supply** adds **10** to your supply boost.
- **$GWC is weighted ×3** on the supply axis — the same fraction of $GWC gives three times the boost that $Send does.
- The **supply side is uncapped**; the only cap inside the formula is the Diamond factor's **×100** ceiling. The boost itself has no ceiling — what it can turn a day of grinding into does (73,762 per rolling 24h, and 73,762 per single award); on Send Call performance it pays in full.

#### 3.2.1 The $100 hold floor — dust is not a bag

**One number, one rule, every token on this site: a holding only counts at $100 or more, priced live.**

Below it you hold dust, and dust earns **no holder status of any kind** — no Diamond level, no Diamond factor, no no‑sell streak, no supply boost, no community verification, no conviction standing, no extra tracker slots.

Why it exists: every holder reward here is **time‑based**, and the balance behind it used to be checked only for "greater than zero". One cent of $GWC held for thirty days reached Diamond Forming and applied a **×6.3** factor to the whole account; at two years it reached **×100**. The cheapest route to the largest multiplier on the platform was dust plus patience, which is not conviction — it is a calendar.

- The floor is in **dollars, not tokens**, so it survives a token's own price moving.
- It is **$100** because that is already the unit the Send Call size ladder counts in (`$100 held = 1×`), so the site has exactly one definition of "you actually hold this".
- Each coin is judged **separately**: $100 of $Send and $100 of $GWC are two different bags clearing two different floors, and they carry two different streaks.
- It applies to **$Send, $GWC, community tokens, and any token a conviction play is measured on** — there is no token on this site with a different rule.
- Your dashboard shows the live dollar value of each bag against the floor, so a bag that isn't counting says so rather than quietly paying nothing.
- **A price we cannot read is not an answer.** If the market is unreadable, your previous verified status stands — an upstream outage can never reset an honest holder's months‑long streak.
- Dropping **below** $100 of a coin ends that coin's streak, the same as selling would.

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

**The $100 floor comes first.** A coin worth less than **$100** contributes nothing to a streak and nothing to your Diamond level — the clock does not start, and if a bag falls below the floor its streak ends (§3.2.1).

**What counts as "not selling":** your no‑sell streak tracks the **peak** percentage of supply you reached. **Selling = dropping more than 2% below that peak**, which resets your streak clock and collapses your Diamond factor to 1. A small wobble within 2% doesn't count; buying more only raises the peak. Because the baseline is your all‑time streak peak (not your last reading), you can't slowly bleed tokens out just under the threshold to dodge a reset.

**$GWC climbs twice as fast:** $GWC has its **own independent** no‑sell streak (only reset when you sell $GWC), and each day holding $GWC counts as **2 days** toward your tier — `effHoldDays = max(combined no‑sell days, 2 × $GWC‑only days)`. Since it's a `max`, the $GWC bonus can only ever help.

Your Diamond level (0–10) drives three systems: the Holder Boost factor (§3.2), your wallet‑tracking capacity (§3.7), and your daily Send‑Call allowance, which is multiplied by **2^level** (§3.5).

### 3.4 Send Calls — the core game

A **Send Call** is you going on the record: a public, timestamped, **permanent** claim that a token is going to run. Once posted, *a call can never be edited or deleted* — it's on the record forever, and its all‑time high is preserved even if the token later dies. **One call per caller per token, permanently** (`UNIQUE(user_id, token_addr)`): nothing closes a call and deleting its post is refused, so your first call on a token is your only one, ever. Two different people can each call the same token.

**The Xs rule.** Performance is measured in **Xs**, where **+100% = 1x**: `X = current price / your entry − 1`. So +100% = 1x, +340% = 3.4x. Each call shows **Now** (live) and **Peak** (its permanent all‑time high since the call); "Now" can never display above "Peak."

**Grades (F → S)**, driven by the call's **peak** X:

| Grade | Peak X ≥ | | Grade | Peak X ≥ |
|:--:|---:|---|:--:|---:|
| 🏆 S Legendary | 20 | | 💪 C Solid | 2 |
| 🚀 A Massive | 10 | | 🌱 D Small | 0.5 |
| 🔥 B Big | 5 | | ➖ E Flat | 0 |

**There is no F.** The grade is computed from the call's **peak**, and `peak_price` is seeded at the entry price and only ever revised upward — so peak X is never negative and **E is the floor**. A call that is currently 90% underwater still grades E, because at some point it was at least worth its entry. What tells you a call went badly is the **live** X on the card and the 💀 RUGGED marker, not the grade.

**Liquidity gate.** A token needs **≥ $2,000 pooled liquidity** (`MIN_CALL_LIQ`) to be callable — thinner pools are rejected, so no one can farm points on a self‑made dust pool.

**No calls on your own token.** If any wallet linked to your account (every link is proved by signature) is the token's deployer or its current `owner()`, the call is refused (`403`): call something you don't control. Both addresses are read server‑side — the deployer from the explorer's record of the contract's creator, the owner from the contract's own `owner()` — never from anything the client sends. If neither can be read (the explorer refused, or the token has no `owner()`), there is nothing to match and this gate does not fire.

**Making a call: +120, scaled by your Send size.** The 120 base is multiplied by how much of that token you actually bought and held, then by your Holder Boost:

```
sizeMult = min(100, max(1, yourSpendUSD / 100))
```

Every **$100** of tokens bought and still held = **×1**, cap **×100** ($10k+). So $1,000 held = ×10. The anti‑cheat that makes it honest is a **net** figure, not a gross one: your "spend" is credited as **min(net bought from the pool, tokens you still hold) × price**, where *net bought* is everything the pool sent you **minus everything you sent the pool**, read best‑effort across every linked wallet.

The netting is what makes each of these worth nothing:

| Trick | Why it nets to zero |
|---|---|
| **`skim()`** — donate tokens to a pool, then skim them back out | You can only skim what you donated, so what you sent in cancels what came out |
| **`burn()`** — pull your own liquidity and receive tokens from the pair | The LP position was minted by sending tokens *in*, so removing it nets back to where it started |
| **Wash buys** — buy, sell back to the pool, repeat | The sells cancel the buys instead of stacking |
| **Value spoofing** — a router refund with a huge `tx.value` | Delivers no tokens, so nothing was bought |
| **Airdrops and transfers in** | Never came from the pool at all |

A genuine buyer who later takes some profit nets down to what they actually still put in, which is what "how much did you send into this coin" was always supposed to mean. And because a thin pool's owner sets its price, **the credited position can never exceed the pool's own liquidity** — a self‑made $2,000 pool — the thinnest pool a call can even be opened on — pumped to a paper million credits $2,000, not a million. **The caller's size is captured once, at call time, and locked in** for that call's award (it fails open to $0 so it never blocks a call). *(The Senders list in this section re‑reads Senders' holdings on demand, throttled to at most once every ~5 minutes, so their "still holding" status stays current — the caller's own recorded size does not change afterward.)*

**The stack cap on the opening award: ×10 (`OPEN_STACK_MAX`).** However large your boost stack gets, the *paid* opening award is capped at **ten times the size‑scaled base**:

```
paid = min( callHeadroom, round(120 × sizeMult) × 10 )
```

So a caller with no on‑chain position (sizeMult ×1) can never be paid more than **1,200** for opening a call, and $1,000 held (×10) caps at 12,000 — no matter whether the stack behind it is 11× or 60×. Anyone in a live community (+9) plus one other boost is already past the bound. **The same ×10 cap applies to the "Send It!" award**, so a Send with no position pays at most 300. This is why the opening award is not the way to climb: the cap bites almost immediately, and the hold bonus does not have one.

**Per‑X milestone payouts: an additive ladder.** As your call actually runs, each **whole X** it crosses pays a rung, and the rungs climb in a **straight line, not by the X**:

```
rung(m) = round(170 × (1 + (m − 1) × 0.1))   →   170 + 17 × (m − 1)
```

1x → **+170**, 2x → **+187**, 3x → **+204**, 10x → **+323**, 20x → **+493**, 50x → **+1,003** (ladder caps at 50x). All fifty rungs together come to **29,325 base** — about **13%** of the ladder's own 30% slice of a call's budget (221,288). That headroom is the point: the ladder is deliberately *not* where a call's Send Power lives, because paying by the X would hand a single lucky 50x more than twenty patient calls. Holding in profit is the main event (below). No daily cap on the ladder (it's pure performance), but every payout draws on the call's lifetime budget (§3.1). Each milestone pays once, ever, and only on a price the call is **credited** at — never the raw last trade. The credited price is the **lower of the live price and the median of the last hour's samples** (at least six; with no median yet nothing is credited that sweep and the gap is never back‑paid), crediting **pauses while the live price is more than 3× that median**, the level must be **sustained across two consecutive sweeps** with live liquidity still ≥ $2,000, and the ladder can never credit more Xs than the pool's depth could have paid: **one X per $500 of pooled liquidity** (a $5k pool tops out at 10x). A single wick can't pay, and neither can a pump the pool is too thin to have paid for real.

**Diamond‑hands HOLD bonus — the main event.** While your call stays in profit, you keep earning a **super‑linear** bonus:

```
currentX = min( X at the credited price, floor(poolLiquidity / 500) )   ← credited price = min(live, median of the last hour's samples); one X per $500 of pooled depth
holdX   += min(hoursSinceLastTick, 0.5) × min(currentX, 50)             ← the integral
owed    = min(750000, 2 × holdX^1.5 × crewBonus)                        ← the payout
```

The credited price needs at least six samples in the last hour; until there are, or while the live price runs more than 3× that median, or while liquidity is under the callable floor (`MIN_CALL_LIQ`), the tick credits nothing (currentX = 0) and the gap is never back‑paid.

It is deliberately where most of a call's Send Power lives: of the per‑call lifetime budget (§3.1), the opening award may take at most 10% and the milestone ladder at most 30% cumulatively, so **at least 60% is reserved for holding in profit**. (`HOLD_MAX` = 750,000 base is a backstop the budget always reaches first.)

**Three clamps inside the integral.** Height above **50X** credits nothing extra; the X is also capped at **one whole X per $500 of live pooled liquidity** (`CALL_DEPTH_USD_PER_X`, rounded down — a $5,000 pool can credit at most 10x), so a thin pool cannot pay a height it never really held; and at most **30 minutes** of holding is credited per sweep tick — so a long gap between price samples is not back‑credited. The X itself is measured at the **credited price** — the lower of the live price and the median of at least six samples from the last hour — never the raw last trade; with no median yet (a fresh token or a fresh boot) nothing is credited that tick, and crediting pauses while the live price runs more than 3× above that median. "Compounds with height and duration" is true up to those bounds, not beyond them.

**Crew factor — applied to the payout, not the integral.** The bonus is larger when the people who Sent It on your call are also in profit from *their own* entry: `rate = 1 + 0.1 × (Senders in profit with ≥ $20 of their own in the token)`, capped at **3×** (twenty profitable Senders — real positions, not taps). It multiplies `owed` **after** the `^1.5` exponent, which matters: folded into the integral instead, a 3× crew would really have been worth 3^1.5 ≈ 5.2×. A conviction play that carries other people with it is worth more than a lonely one — but by 3×, not 5×.

It accrues **only while the pool is liquid (≥ $2,000), a credited price exists (the sweep needs at least six price samples for the token in the last hour — a token it has not been sampling yet credits nothing until then), the live price is not more than 3× that hour's median, and the credited price — the lower of the live price and that median — is above your entry** (underwater, drained, spiking or unsampled ticks earn nothing and are never back‑credited), and pays out once at least 20 points are owed.

**⚠️ The honest caveat: "holding" here means the *price* holds, not that *you* do.** The accrual reads the call's current price against its entry and nothing else — no code path re‑reads the caller's wallet after the call is opened, and the recorded position size is written once at call time and never updated. A caller who sells their entire bag keeps collecting the diamond‑hands bonus for as long as the price stays up. The name describes the pattern it rewards, not a verified fact about the caller. Your *size* at call time is spoof‑proof; your continued holding is not checked.

**Send It! — following a call.** Tap **"Send It!"** to Send It on someone else's call: base **30**, scaled by *your* Send size and Holder Boost (and capped at **10×** that size‑scaled base, exactly like the opening award), capped at 30 Sends/day. Points pay only on your **first** Send per call; you can't Send It on your own. Your Xs are measured from the price when *you* Sent It, and **Senders earn a diamond‑hands HOLD bonus of their own** — the same shape as the caller's, on a smaller scale and without the crew factor: a Sender's hold accrual gets **no crew bonus** (only the caller's does), and it is paid against a budget of **184,407** (a quarter of the caller's) with a per‑event ceiling of **18,440**.

**One paying Send per token, not per call.** If you have already Sent It on *this same token* through some other call, the new Send is recorded but **earns nothing and never accrues a hold bonus** — it is stored with no entry price and zero size. You still appear on the senders list; you just don't get paid twice for the same position. Without this, one token called by ten people would be ten payouts for a single buy.

**The senders list.** Each call shows who's behind it, ranked by conviction: `$ put in × (1 + days held) × (1 + your Xs)`. Anyone **not holding** any more drops below every current holder. Top 3 show inline; "Show all" pulls the full ranked list.

### 3.5 Daily Call Limits & keeping it fair

**The dynamic earned limit (base 5, floats 1–5).** Everyone starts with 5 calls/day over a rolling 24h. That earned number floats on the quality of your matured calls (judged once ≥24h old): at least one **doubled** (peak ≥ 1x) → **+1** (cap 5); only duds → **−1** (floor 1). One step per day; even a persistently bad caller always keeps at least **1**.

**Diamond boost: ×2^level.** Your earned limit is multiplied by 2 to the power of your Diamond level (Lv0 ×1 … Lv10 ×1024). Spoof‑proof, and pauses if your holdings go unverified for 26h.

**The RUGGED penalty (−2).** If a token you called started with real liquidity but its pool later **collapses below $100**, the call is permanently marked **💀 RUGGED**, and your daily call limit is **docked by 2** (floored at 1), with a notification. Fires once per call, only on a definitive price‑feed read (Dexscreener) below $100 — a failed or rate‑limited fetch never triggers it. Between $100 and $2,000 (`MIN_CALL_LIQ`), all point‑crediting simply pauses.

**The no‑DYOR flag.** Post a call **without first opening that token's full on‑chain detail** and it's stamped: *"⚠️ Not researched — the caller made this call without opening the token's full on‑chain details first. DYOR."* (A client‑side session flag reflecting UI interaction, not a server‑verified fact.)

**Spam trap.** Burn your *entire* daily allowance within **60 minutes** (only if your limit is ≥3) and you're flagged for spamming, which puts you into Read‑Only Mode (§3.6). There's also a hard rate limit of 10 calls per 10 minutes.

### 3.6 Read‑Only Mode & redeeming with $Send

Every automatic trigger walks the same ladder, escalating with each **distinct** offense: **1st → 24 hours**, **2nd → 1 week**, **3rd+ → permanent**. What trips it: the Send Call spam trap (§3.5); **acting like a bot** — 25 posts, comments or wallet‑tracks inside a minute or 60 inside five minutes, 60 reactions, votes or follows inside a minute or 180 inside five, or the same long post (40+ characters) repeated six times inside three minutes; **a ring** — three or more accounts on one connection (an IPv4 address or an IPv6 /64, held only as a blind index) all calling the same coin inside 7 days, in which case every account in the ring is muted and each one's buy‑out costs **double**; and selling the bag that opened the participation gate inside its first day (§3.15b). A moderator can also put an account in read‑only for a chosen number of days or indefinitely (§3.18); that sits outside the ladder and adds no strike.

**Strikes are for life.** The counter only ever increments — nothing ages it out, forgives it, or resets it. Three offences years apart still land on permanent. There are two routes out, different in kind: the buy‑out below (fast, on‑chain, automatic) and a free **appeal to a person** at SendRH@Atomicmail.io, which the read‑only banner puts in front of you and which a moderator can act on by lifting the restriction. A lift clears the mute, its level and its reason; it does **not** clear the strike count.

**Blocked while muted:** making calls, Sending It, posting, commenting, reacting, voting, following, tracking wallets, editing your profile or wall, uploading images or video, starting, joining or posting in a community, creating or voting on proposals, playing Rocket Run, and minting a Data API key. That is the in‑app list (`READONLY_BLOCKED`), served by the server with the restriction banner and in `/api/gamify/me` → `rules`, so the banner and this section describe the same routes. Two more writes are gated the same way but aren't on that list: claiming an easter egg (§3.17) and taking a community holder snapshot. **Still allowed:** **the daily check‑in**, buying & holding $Send/$GWC (your Holder Boost keeps compounding), swapping (points still count), connecting/refreshing a wallet, muting people, turning post alerts on or off (§3.6d), and browsing everything. *(Connecting works, but the **150‑point connect award is withheld** while you're restricted, and linking a wallet mid‑restriction raises your redemption baseline to whatever it already holds.)*

**The check‑in stays open on purpose.** Read‑only pauses what you can *make*; it does not lock you out of protecting what you already earned. Since the check‑in is the switch that stops the escalating absence decay (§3.6b), gating it would have turned a mute into a compounding penalty a muted account could do nothing about — a different and much harsher thing than pausing posting.

**A mute still costs points, just not runaway ones.** While restricted you're charged a flat **+1.0 percentage point** of Send Power per day, and — unlike every other decay component — **checking in does not cancel it**. That's what keeps the restriction a penalty rather than an inconvenience. But it is *all* you pay: check in daily and your absence streak stays at zero and your underwater calls cost nothing, so the bleed is a steady 1%/day instead of climbing to the 4% ceiling. Ignore the site while muted and both components stack.

**Redeem with $Send — buy your way out early.** Any restriction can be lifted by **buying and then holding** enough $Send, verified on‑chain:

| Restriction | Cost to redeem |
|---|---|
| 24‑hour mute | $25 of $Send |
| 1‑week mute | $175 of $Send |
| Any timed mute | $25 per 24 hours |
| Permanent mute | flat **$1,000** of $Send |
| Any mute applied to a **same‑connection ring** — three or more accounts on one connection (`SYBIL_RING_ACCOUNTS`) making Send Calls on the same token within 7 days (`SYBIL_WINDOW_MS`); every account in the ring is restricted | **double** the rows above (`SYBIL_REDEEM_MULT`): $50 per 24 hours, $350 for a week, $2,000 for a permanent one |

Only $Send you buy **after** your baseline (recorded when the restriction was applied, or on your first redeem tap if no wallet was linked) counts — a pre‑existing bag can't fake a buy, and pricing is fail‑closed (no price ⇒ no redemption).

**Post‑redemption probation — hold, or it comes back doubled.** Lifting a restriction starts a hold: keep the $Send you bought for the restriction's own length (timed) or **40 days** (permanent). "Sold" = dropping >2% below the balance floor. Sell during a **timed** hold → it returns with the **timer doubled** (and the next buy‑out costs double); sell during a **permanent** hold → back to permanent. Hold to term and it's fully cleared.

**How a sell is caught, precisely.** A background sweep every **5 minutes**; the dashboard's on‑chain holdings re‑verification, which runs the same check (it fires automatically when you open your dashboard with a wallet linked, and whenever you tap its Refresh button); plus a throttled recheck (at most once a minute) triggered by exactly two write actions: **making a Send Call** and **joining a community**. Posting, commenting, reacting, voting, following, tracking and customizing do *not* trigger it — so in practice the 5‑minute sweep is what finds most sells.

**During probation, an unreadable wallet counts as a sell.** If the sweep cannot read your balance — you unlinked the wallet, or the read fails — it is treated as a balance of zero and the restriction comes back (doubled if timed, permanent if it was permanent). This is the opposite of how the OG badge behaves, where an unreadable read merely *pauses* the badge and is retried. Probation is deliberately fail‑closed: it's the one place where "we couldn't check" resolves against you, because it is the exit from a penalty rather than an entry to a reward. **Keep the wallet linked for the whole hold.**

### 3.6b Send Power decay — the score is a stock, not a trophy 📉

Send Power is **not** a permanent record of what you once did. It is a balance, and it **drains every day you don't show up**. Levels can go *down*. The design goal is that a leaderboard reflects who is playing now, not who was early — a number that only ever climbs makes an inactive Level 90 permanently outrank an active Level 60, and after a year the board stops meaning anything.

**One drain per UTC day, per account.** A background sweep runs every **5 minutes** and takes up to **500** accounts (`DECAY_BATCH`) whose next decay stamp has come due — 500 × 288 ticks, so about 144,000 accounts a day. System accounts are exempt.

**The daily rate is a sum of three things, then capped:**

| Component | Rate | When |
|---|---:|---|
| **Absence** | **0.4%** on the first day past grace, **+0.2 points** per further consecutive day away | Only after **2 consecutive days** (`GRACE_DAYS`) with no check‑in — two days off costs nothing |
| **Read‑only** | **+1.0 point** | Every day the account is muted (§3.6) — the **only** component a check‑in does not cancel |
| **Bad calls** | **+0.3 points** per call currently **underwater**, up to **+1.5** | Any of your calls whose current price is below its entry |
| **Ceiling** | **4%** in one day, total | However long you've been gone |

So: away 3 days → 0.4%. Away 7 days → 1.2%. Away 21 days → 4% (the cap). Away *and* muted *with* three sinking calls → the cap, immediately.

**What stops it.** A **daily check‑in** — and nothing else. Holding coins doesn't stop it; neither does a high level. **Anyone can check in, including a muted account** — read‑only pauses what you can *make*, not your ability to defend what you already earned.

**It stops two of the three components.** A check‑in inside the current **UTC day** sets your absence streak to zero *and* skips the underwater‑call charge entirely, so on a day you show up those cost you **nothing**. The bad‑call rate only ever applies on a day you were *already* away: a call that went down is a market outcome, not misconduct, and billing someone daily for one while they are actively participating would be a far harsher rule than the one intended.

**The read‑only charge is the exception.** It is the one component a check‑in does **not** cancel — while restricted you pay its flat 1.0 point per day regardless. A penalty that stops costing anything the moment you tap a button is not a penalty. But it is *all* you pay if you keep showing up: a steady 1%/day, instead of that plus an absence rate climbing toward the 4% ceiling.

**Old bad calls never stop counting.** The underwater count is `cur_price < entry_price` over *all* your calls, and since nothing ever closes a call, one you made a year ago that never recovered still adds its 0.3% to any day you're absent. It costs nothing on a day you check in.

**One clock, not two.** `checkedInToday()` compares **UTC day numbers**, the same clock the 60‑point award's `daily:<id>:<ymd>` ref uses. A check‑in at 23:50 UTC protects that day and not the next. This section previously claimed a rolling 24‑hour window that carried over past midnight; it does not, and it never has.

**Floors, so it can't wipe you out.** Balances at or below **5,000** are never touched, and the drain is `min(balance × rate, balance − 5,000)` — decay can take you down toward the floor but never through it, and never negative. If the computed drain is **less than one whole point** it takes nothing rather than rounding up.

**It is on the record.** Every drain writes a negative row to your points ledger (`kind: 'decay'`) and sends you a **📉** notification, so a drop is always explained and always auditable. Nothing happens silently.

**What decay does *not* touch:** your Holder Boost, Diamond level, OG tier, badges, community memberships, or any call's recorded history. It only ever moves the points balance.

### 3.6c Your dashboard shows the other half of the ledger 💀

For a long time every block on the profile dashboard was a way to **gain**, while the same engine was
quietly draining balances for absence, muting accounts on a ladder that never resets, shrinking callers'
allowances and revoking badges on a sell. None of that reached the client, so the first anyone heard of
any of it was a notification saying it had already happened.

`gamifySummary()` now ships the rest: `boost` (the exact figure `effectiveMult` pays), `restriction`,
`probation`, `strikes`, `decay`, `beta`, `rugged`, `holderVerified`/`holderProof`, `wallets`, and a
**`rules` object carrying every constant the page prints**. Two sections render it:

- **💀 Rekt — how you lose it.** Six cards, each stating the rule *and* this account's standing against it:
  the live decay forecast (what the next sweep will take, which components, and which of them a check‑in
  cancels), the strike ladder with the rung you are on, what a rugged or underwater call costs, what is
  revoked rather than drained, the participation check, and the beta reset. It is **not** behind a
  `<details>` — a consequence you can be surprised by has to be visible without a click.
- **🗂️ Your record.** A definition list of everything the site tracks: rank, level, the multiplier you are
  paid at, each coin's dollar value against the $100 floor, both hold streaks, Diamond tier, whether the
  holdings read is fresh, call allowance, strikes, days away, wallets linked, participation state, OG,
  communities, and the beta countdown.

**The numbers now travel with the payload.** They used to be typed into `public/gamify.js`, and by the
time anyone checked, five daily caps were wrong (track said 10/day against a real 3; watch 30 against 5;
`react_get` 60 against 20; `vote_get` 100 against 30; `be_followed` 30 against 10), the Send Call X‑ladder
was quoted at the old multiplicative rate and overstated the 50× rung by **8.5×**, the per‑action ceiling
was printed as 500,000 against a real 73,762, and the beta badge was missing from the client's boost stack
entirely. `tests/dashboard.mjs` asserts the server ships each constant and the client reads it.

**Two figures that did not add up, now do.** The equation strip printed `1 + (supply × diamond) = total`
using the **raw** supply percentage while the server pays on the **qualifying** one, so an account holding
$45 of $SEND and $130 of $GWC was shown `1 + 3.9 × 10 = 28.00` — two numbers next to each other rather
than an equation. Both the strip and the Vault footer now use the figure the server actually pays on, and
say plainly which coin is being excluded by the floor and why.

**Losses are in the log.** The Loot Log filtered its own ledger to `total > 0`, so `decay` — the only
negative kind — could never appear in it, while two pages promised "every drain writes a line to your
points history". Negative rows now render in their own list, and a negative day is signed and coloured as
a loss instead of printing `+-1,234` in gain green.

### 3.6d Wall alerts — "tell me when this person posts" 🔔

On anyone else's wall, **🔔 Alerts** turns on a private subscription: when they post, make a Send Call, or
post publicly in a community, a row lands in your 🔔 bell and clicking it takes you **to that post**.

**It is private, and it is not Follow.** Following is public, pays Send Power on both sides and puts
someone in your feed; an alert rings your bell and nothing else. Conflating the two would either start
notifying every existing follow or make "quietly keep up with them" impossible. It is modelled on
**mutes** instead: the target is never told, no count is exposed anywhere, and it pays nobody anything.

**What never fans out.** Support-board questions (the help desk is not a wall, and asking there is meant
to draw no crowd), holders-only community posts (a private wall is private, even to somebody who could
open it), the site-written community invite post, and anything to a subscriber who has **muted** the
author. Muting also **retires** the subscription and clears rows already delivered — and a mute does not
silently switch alerts back on when it is lifted.

**The row carries no post text.** A notification outlives the post — the author's delete button does not
reach into strangers' bells — so quoting the body would leave somebody's deleted words in other people's
notifications. The row is: who, what kind of thing they did, and a link. Token symbols in it are filtered
the same way a community's symbol is, because a Send Call post can never be deleted, so a symbol chosen by
a token's deployer would otherwise sit in up to 200 bells permanently.

**The link is `/p/<id>`, not a rendered path.** The server resolves it at click time from the post row:
it knows whether the post lives on a profile wall, a community wall or the support board, it re-checks
who may see it, and it survives the author renaming themselves. A post that is gone (or was never yours
to see) redirects to the wall with one honest line — the same line either way, because distinguishing
them would confirm to a stranger that a private post exists. The route is rate-limited so the id space
cannot be walked.

**Four bounds, and each refuses out loud rather than accepting silently:**

| Bound | Value | Why |
|---|---|---|
| Subscribers per wall | `ALERT_TARGET_MAX` = **200** (`= PROP_NOTIFY_CAP`) | the fan-out runs synchronously on the author's own request; this is what one request can carry |
| Walls per account | `ALERT_MAX_PER_USER` = **50** (`= NOTIF_KEEP_ALERT`) | exactly what your bell holds alert rows for — watching more guarantees silent loss |
| Alerts from one author, per bell | `ALERT_BURST` = **3** per hour (`= SOCIAL_PER_ACTOR`) | one person cannot fill someone else's bell |
| Fan-outs per author | `ALERT_FANOUT_PER_HOUR` = **4** | bounds the *work*, across all three entry points, before a row is read |
| Alerts on one wall per connection | `ALERT_IP_PER_TARGET` = **3** | the 200 slots are finite, so they cannot all come from one network |

A cap that accepted the subscription and then quietly stopped delivering would be a switch reading ON that
never rings. Every one of these refuses with the reason instead.

**Gating.** Setting an alert needs the **participation check** (it commits other people's request time to
a fan-out, which is doing something here). It is **not** gated by read-only: which bells ring for you is a
setting on your own account, not something you make, and a muted person must still be able to turn their
own notifications down. Turning an alert **off** is never gated at all.

**Alerts get their own bucket.** `NOTIF_KEEP_ALERT` = 50, trimmed separately from the 50 social rows and
the 200 system rows — so a busy wall can never evict a level-up, an OG grant or a restriction notice.

Manage every alert you have set under **Settings → 🔔 Post Alerts** on your profile.

### 3.6e The scanner is yours to set 🎛️

**The problem, measured.** On a live radar of 36 pairs, **zero** could earn 🚀 "Looks Good, Send It" — and
not because they were bad. The verdict needs `health === 100` exactly (every one of the 11 RISK weights is
positive, so 100 means *no flag at all*), plus a clean block-0 scan, plus `thinData === false`. And
`thinData` was true for **36 of 36**, because `holders.count` was null for every token. The tag was not
strict; it was unreachable.

**One wording, one bar.** The verdict is the site's score and nothing else: a token earns 🚀 **Looks Good, Send It** when our checks score it a full **100** and none of the four unwaivable conditions below is present. Below 100 the top tag is not available at any setting. Your settings never award the tag — they narrow the DEX List and the Hot Feed — and the detail panel's heading always reads **"Why we say"**, because the judgement was ours.

- 🚀 **Looks Good, Send It** — a **full 100**, by either bar. Nothing we could check tripped at all. On the scanner card the score is the whole of the site's test: it no longer waits for readable data or a finished block-0 scan. Flags only trip on data we could actually read, so a token whose liquidity, holders or verification were unreadable has *fewer* ways to lose points than one we could check in full — and the panel says so in the same breath: the audit line reads *"too little of it is readable to judge, which is an unknown, not a pass"*, and the **"What we could not check"** row lists every signal we could not read. Your settings never award the tag on the card; they only narrow the Hot Feed (the same 100 plus your filters). Below 100 the top tag is not available at any setting. The verdict the server posts to Telegram and the runners' "first cleared the bar" moment still use the stricter rule — readable data, the risk model's top tier, a full 100 and a clean first block.
- ✅ **Looks Good** — **75 and above**. One light flag tripped and nothing unwaivable. Green, but flat:
  no glow, no pulse, and the words stop short of *Send* on purpose — an observation, never an invitation.
  75 is reachable rather than decorative: the lightest single deduction is 12 points, so one flag lands
  at 88. It can still be an empty band on a given day, simply because most fresh tokens trip more than one.
- The reader's own settings no longer award a verdict. The rocket is the site's score and nothing else — a full 100 with the floor intact (`earnsSendIt`, public/newpairs.js) — and it uses the same words for everyone. Your filters still narrow what you see: the list, and the Hot Feed, which shows only tokens that earn the rocket *and* clear your settings when you have any (`feedQualifies`). Nothing on the card claims your judgement: when flags are listed the detail panel's heading reads **"Why we say"**, and the spoken line carries the verdict's own caveat rather than an attribution — *"Our checks score this a full 100 out of 100 — nothing we could read tripped a flag. That is not a promise, and it is not the same as safe: most new tokens still go to zero."*

There is one test, not two. The verdict is the site's score and nothing else — a full 100 with none of the four unwaivable flags earns the rocket — and it is computed the same way whether or not you have set anything, on every page the card renders (Scanner, Send Wall, communities, support, profiles via `window.NPCard`). Your settings only ever change what the Scanner *lists* — the DEX List and the Hot Feed.

Your settings are only ever *applied* on the scanner page — they narrow the 📋 DEX List and the Hot Feed there, and nothing else. The Send Wall, communities, support and profiles render the same card through `window.NPCard`, but they have no settings panel, no filter count and no reset, so nothing there is filtered by settings you cannot see. The verdict itself is never attributed to your settings on any page, the scanner included: 🚀 Looks Good, Send It is awarded by the site's own test (a full 100 with the floor intact) wherever the card renders.

**Still measured, still honest.** Holder counts no longer hang on the explorer: the server folds every Transfer event a token has emitted into an on-chain holder ledger (`holders.source: chain`, stamped with the block it was read at), shows GoPlus Security's count until a token's ledger has been built, and falls back to the explorer only after that; verification comes from GoPlus's open-source flag or the explorer. Where a signal is still unreadable the card keeps saying, in the same panel, *"What we could not check … that is missing information, **not a pass**"* — and because flags only trip on readable data, that row is the honest counterweight to a 100.

**Four things no setting, strategy or saved view can ever waive** — the ones where being wrong is not a
matter of taste: a **honeypot**, a token **dumping** right now, **block-0 snipers who already sold**, and
the risk model's own **avoid** tier. Everything else — unverified, few holders, thin liquidity, one big
wallet, quiet volume, a serial deployer, a heavy block-0 — is a judgement you are entitled to make, as
long as the card keeps saying you made it.

**The Hot Feed obeys the settings.** It used to run its own private test and ignore every filter:
you could set twenty of them, watch the DEX List narrow, switch to the feed and see a completely different
set of tokens with nothing explaining why. It is the tag, narrowed by your settings: a token is in your feed only if it earns 🚀 Looks Good, Send It *and* passes every filter you have set. With no filters set, the feed is exactly the tagged tokens. Either way the feed can never show a token the tag would not.

**One typed table, `FIELDS`, is the single source of truth** for every setting: its kind (min / max /
bool / enum / set), its off-value, its range, the pair-object field it reads, and how it treats an
unreadable signal. `defaultFilters`, `passFilters`, `activeFilterCount`, `syncControls`, the strategies and
the reset all read it, so a setting can no longer exist in the panel and quietly do nothing — which is
exactly what had happened.

**New settings:** min age, market-cap band (min/max), 1h volume, 1h buys, volume ÷ liquidity, flow window
(1h or 24h), max top-10 concentration, max block-0 share, "block-0 must be clean", the two sniper flags in
the hide list, and a **"must actually have been checked"** group — the honest counterweight to every filter
that lets an unreadable signal through. Tick one and a token the site *could not* check is excluded rather
than quietly counted as fine.

**The settings open as a pop-down.** They used to be an inline block: opening them shoved the whole list
down the page, and on a panel this tall the rows you were reading disappeared underneath it. It floats over
the list now, anchored under the controls, scrolling inside itself — and on a phone it becomes a bottom
sheet over a dimmed page rather than a tall box in a narrow column. **Four ways out**, because a panel this
size is easy to get stuck behind: the ✕, Escape, a tap outside, or the Filters button again. Every one of
them hands focus back to the button rather than dropping it on `<body>`.

**Seven strategies**, each a complete settings configuration rather than a toggle. Pressing one **replaces**
every setting (never merges — a leftover field silently narrowing the board is how you end up believing
the chain is empty), opens the panel, and **visibly marks every control it changed** so you can fine-tune
from there. Each carries a plain blurb *and* a "what it can't tell you" line:

| | Shape | What it cannot tell you |
|---|---|---|
| 🌱 **First 30 Minutes** | ≤30m old, ≥$1.5k liq, ≥5 buys/h | almost nothing is knowable this early — the riskiest shape on the board |
| 💧 **Liquidity First** | ≥$25k liq, ≥$2k vol, turnover ≥0.15 | deep liquidity can still be removed |
| 👥 **Crowd Forming** | ≥75 holders, top ≤20%, top-10 ≤55% | requires a readable holder count and concentration (on-chain ledger, GoPlus or explorer — an automated scan, not an audit), so it shows nothing rather than guessing |
| 🚀 **Moving Right Now** | ≥$1k vol/h, ≥15 buys/h, price up | momentum is the easiest signal to fake |
| 💎 **Small Cap, Real Pool** | cap ≤$250k, ≥$3k liq, ≥$500 vol | a small cap is a small cap, not an opportunity |
| 📉 **Cooled Off** | down over 1h, pool and volume intact | a pullback and the first minutes of an exit look identical here |
| 🛡️ **Strictest Checks** | every check ran *and* came back clean | it cannot check what an upstream will not answer |

**Market cap then → now.** Each token's detail shows the cap the scanner **first saw** it at, the cap it
**first cleared the site's own bar** at, its **peak**, and **now** — with the multiple between them, so
"where the Xs were made" is readable rather than remembered. Stated plainly on the card: these are
measurements, not entries. Nobody bought at those numbers, it is *not* the launch cap, and where the feed
gives no market cap the figure is FDV.

**A failed upstream read is no longer cached as an answer.** `jgetCached` called `jget`, which collapses
`jgetR`'s `{ok:false, data:null}` to a bare `null` — and then stored that null for the full TTL. One 403,
one 429, one timeout became a cached "this token genuinely has no data", served to every caller for
minutes, and an upstream recovery changed nothing until it aged out. It caches successful reads only now.
Failures still return null to the caller; they are simply not remembered.

### 3.7 Safety tools

**Read the honesty rule first: every safety readout is an automated heuristic pattern‑scan of public on‑chain data. It is not an audit, and it never simulates a buy or sell.** It's a starting point for your own research, never a guarantee or a "buy."

**Contract scanner — owner‑power flags.** Expanding a token's "Contract & trust" section calls `GET /api/pairs/contract`, which asks GoPlus Security first — one vendor's automated reading of the contract, not an audit — for the owner‑power flags, along with its honeypot flag, buy/sell tax, open‑source flag and whether the owner address is the zero address (renounced). The explorer's **verified** source is still read to name the contract, and it is scanned lexically for owner powers only when GoPlus named none and the source is verified. The six flags below are the source scanner's vocabulary; GoPlus can additionally name powers such as taking ownership back after renouncing, changing wallet balances directly, a hidden owner, whitelisting, caps that can be changed at will, a trading cooldown and not being able to sell the whole balance:

| Flag | Severity | The owner could… |
|---|:--:|---|
| Blacklist | 🔴 critical | Block wallets from selling (classic honeypot) |
| Change fees | 🟠 high | Raise the sell tax toward 100%, trapping sellers |
| Mint | 🟠 high | Inflate supply and dump it |
| Pausable | 🟠 high | Freeze all transfers, including sells |
| Trading toggle | 🟠 high | Turn selling off at will |
| Max limits | 🟡 medium | Cap buy/sell/wallet size (can block selling) |
| Change those caps at will | 🟠 high | Tighten the caps onto sellers |
| Take ownership back | 🔴 critical | Undo a renounce |
| Change wallet balances | 🔴 critical | Take or zero your tokens directly |
| Hidden owner | 🔴 critical | Control the contract from an address it does not name |
| Whitelist | 🟡 medium | Exempt chosen wallets from the rules |
| Trading cooldown | 🟡 medium | Force a wait between trades |
| Cannot sell all | 🟡 medium | Stop you selling your whole balance |

The last seven come only from the GoPlus Security reading, which is tried first and is read whether or not the source is verified; the lexical scan of the verified source is the fallback when GoPlus returns no powers (and "Trading toggle" comes only from that source scan). If GoPlus flags the token as a honeypot, the panel's summary says so in its first line.

The powers come from GoPlus Security's automated flags first, with a purely lexical scan of the explorer's verified source as the fallback (a token can dodge a lexical flag by renaming a function, or trip one on a harmless word). GoPlus reports powers whether or not the source is verified; the lexical fallback runs only when GoPlus reported no powers (or did not answer) and needs verified source. Unverified is itself a **medium‑weight flag (−15)**, so an unverified token can still reach "Looks OK" on other merits; treat that verdict as "nothing *visible* is wrong", not as safe. Cached 30 minutes (the GoPlus reading itself for 10). Neither is an audit.

**LP‑lock check.** From the GoPlus reading when it lists LP holders, the share of LP tokens flagged locked or sitting in a burn address; otherwise — and only after the pool is verified on‑chain to actually hold this token — the top 15 LP holders from the explorer, summing burn addresses and named lockers. Either way: **≥50%** → "looks locked / burned"; below → "does NOT look locked (rug risk)"; can't tell (including a pool that does not hold this token) → "couldn't tell." A snapshot of *where LP is now*, not an unlock‑date check.

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
| 🎯 Block‑0 snipers sold out | 28 | The wallets that bought in the pool's very first block have since dumped |
| 🎯 Block‑0 snipers took a big share | 14 | Those first‑block wallets took a large share of the float |

**Triage:** ≥70 "Looks OK" · ≥40 "Caution" · ≥15 "High risk" · else "Avoid." Anti‑greenwashing: if any high/critical flag trips, a token can *never* show the green tier. Five sub‑scores (Liquidity & volume · Holders & spread · Trading activity · Launch fairness · Contract & trust) each get a letter grade to show *how* the score was reached.

**Safety filter** — three views, and **Safer** is the default on every visit (never persisted, so protection is always the arrival default): **🛡️ Safer** shows a token only if it's **not risky and scores ≥ 75** (honeypot/serial‑deployer tokens are *always* hidden there); **🌐 All** shows everything *except* tokens flagged risky or with too little liquidity to trade; **☠️ Risky** shows only those hidden ones, so nothing is ever silently unreachable.

**Watchlist:** save up to **500** tokens, each with the same live score/flags. **Read‑only wallet tracker:** track wallets and get a browser‑computed PNL report (average‑cost basis, realized + unrealized) — it never signs, sends, or moves funds. If the explorer's balance read fails, the report says so instead of quietly showing $0. 10 wallets free; a fresh $GWC diamond‑holder at tier ≥1 unlocks `min(1000, level × 100)`. It reads the wallet's **whole** history from the chain (below) and says plainly what it could not value — an estimate, not accounting.

**How the tracker reads a wallet — from the chain, all of it.** The block explorer used to answer these reads; the public one now meets servers with a bot challenge, and even when it answered, a report stopped at 400 transfers and valued at most 60 trades. The server (`GET /api/chain/wallet`, `readWalletHistory`) now reads the chain itself:
- **every ERC‑20 transfer the wallet ever sent or received, in every token, over the chain's whole life** — two `eth_getLogs` reads on the wallet's indexed topic with no token filter, window‑split only when the node says an answer is too large (a window it times out on is asked again first: the public node times out at random). Up to **20,000** transfers; past that the page says the wallet is too large to read in full, rather than showing part of it as the whole. NFT (ERC‑721) transfers are counted, not valued;
- **every token it ever touched**, with its decimals, symbol and name (kept once read) and its **live balance** (`balanceOf`) — a balance or a scale that cannot be read shows as "unread" and the total says it is partial, never a silent $0 or a guessed scale;
- **when** each transfer happened (block times), the **ETH balance**, the **transactions it has sent** (its nonce), and whether it is a contract (an EIP‑7702 delegated wallet is still a person's wallet);
- the **receipts of the wallet's own transactions** that move a token with a market (up to the newest 5,000), from which each trade is followed **swap by swap, in log order**: for each pool, what it took in and then paid out is one swap. It is the wallet's **buy** when the wallet sent the transaction and the pool's tokens reached it — straight or through any router; its **sell** when the tokens the pool took in came from the wallet. Tax and burn legs (to the token contract, `0x0`, `0x…dead`) are nobody's buy and nobody's swap input, so a taxed buy costs exactly what the pool took in (checked against a live $SEND buy in `tests/walletchain.mjs`) and a token's own swap‑back is never the seller's proceeds. One row per transaction per direction: a taxed sell is one sale. A v3 / concentrated‑liquidity pool (it pays out first and is paid in its callback) is followed the same way; a smart account's trade counts as its own when its ERC‑4337 UserOperation ran in the transaction; a swap in *someone else's* transaction that paid this wallet (a reward, a gift, a bridge or solver fill) is a zero‑cost transfer in, like any other, and the report names it. A lot whose cost genuinely cannot be read — a receipt the node would not give, a shared‑vault swap that moved two tokens at once, a USDG leg with no ETH price — makes that token's PNL **unknown** ("—"), left out of the totals and counted, never a guess. The swap shapes are pinned in `tests/tradelegs.mjs`.

The report is still computed in your browser. WETH and USDG count as cash (no "profit" on holding them). Plain ETH sent between wallets leaves no log, so only the live ETH balance is shown. A busy wallet's first read can take a minute or more on the public node — it runs as a job the page watches (202 with its progress, so no proxy times it out), paced adaptively so the site's own chain reads keep their share, with the last read kept three minutes **per member** (nobody learns what anyone else looked up); the saved report shows meanwhile. A keyed `RPC_URL` makes it fast.

**🎯 The early-buyer engine — who got in first, and did they stay?** The deepest check on the site. It replays a pool's own history from the chain and answers one question a price chart cannot: *the wallets that got in before anyone else — are they still holding, or did they sell into you?*

Two views of the same trace:

- **Block 0** — the very first block in which the pool ever paid a token out. Anyone in it bought before a human could have reacted.
- **The first 10 buys** (`EARLY_N`) — the first ten payouts the pool ever made, in chain order. Block 0's buyers are by definition inside this set, so the two views nest; a wallet in both is traced **once** and shown twice, against two different denominators.

**Every early wallet is followed as a cluster, not a single address.** Moving tokens to a fresh wallet is the oldest way to look clean, so the trace follows the wallet, everyone it sent tokens to, and everyone *they* sent to — **2 hops**, at most **12** destinations per wallet per hop and **150** wallets per token. The largest **30** early wallets are traced; beyond that they're counted and the panel says so rather than pretending the list is complete.

**What each cluster reports:**

| Reading | What it means |
|---|---|
| **Took** | Tokens the cluster received from the pool in the window (block 0, or the first 10) |
| **Still holds** | The summed **live** balance of every wallet in the cluster, read fresh |
| **Kept buying after** | Its lifetime buying from this pool exceeds its early take |
| **Sold supply it never bought here** | A floor on tokens it sold that it demonstrably never bought from this pool |
| **Cost / proceeds / P&L** | A WETH ledger built from the actual transactions the tokens moved in, plus the current holding valued at the pool price |
| **Net label** | **accumulator** (holds ≥ what it took) · **seller** · **fully out** (holds exactly zero) · **unknown** |

**"Unknown" is a real answer, not a zero.** A balance that cannot be read is stored as `null`, never `0`, and if any wallet in a cluster is unreadable the whole cluster reports **unknown** rather than guessing low. That distinction is the whole point — a scanner that reports an unreadable balance as "sold everything" would be inventing a rug.

**How it gates the green verdict.** `sniperOk` is **true** when nobody sniped block 0 at all. Otherwise it stays **null** — deliberately not `false` — until the scan is *complete* (nothing capped, no unknown wallets, every balance readable). Only then does it resolve: **true** if there are zero net sellers, or if the block-0 clusters are immaterial; **false** otherwise. **Immaterial requires both** the share taken *and* the share still held to be under **1%** of float — so a cluster that took a big share and dumped it can never qualify as immaterial on the grounds that it now holds nothing.

The **Hot Feed asks for `true`**, not "not false" — a token whose scan hasn't finished is held back rather than promoted. An unfinished scan is treated as an unanswered question, which is the honest reading of it.

**Two caveats worth stating plainly.** The first-10 cohort is **reported but does not gate** the verdict — `sniperOk` is a block-0 test only, so a token whose block 0 is clean and whose buys #2–#10 all dumped still shows the rocket, with the contradiction visible in the panel. And the per-wallet percentages in the panel are shares of **total supply**, while the summary tiles and the verdict gate use **float** — two different denominators on one screen, so compare like with like.

### 3.8 Fair & spoof‑proof

The whole economy rests on holdings being **real**, so JustSendIt reads them straight from the blockchain, server‑side — the client never supplies a balance.

- **Holder Boost & Diamond tier** are computed from on‑chain balance and total‑supply reads on your linked wallets. You cannot type in a fake number.
- **Send size** on calls and Sends is a best‑effort read of `min(tokens bought from the pool, tokens still held) × price` across up to 3 wallets (bought through a router counts, capped at what the pool sent in that transaction — `routedPoolFlows`) — the minimum defeats spoofing, wash buys, self‑pool value, and airdrops.
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
- **Anyone can start one** by pasting a token's contract address. The token needs **≥ $500 pooled liquidity** (`MIN_COMMUNITY_LIQ` — no communities on a dust pool; this is a lower bar than the **$2,000** a Send Call needs), and there's one community per token. The starter is auto‑opted‑in as the first member.
- Each community is **auto‑branded** from its Dexscreener/on‑chain art (logo + banner), with live market cap, holders (counted from the token's own `Transfer` events once its on‑chain ledger is built, the block explorer's figure until then), 24h price change, and **🔒 the share of the token's supply sitting in members' linked wallets** on its card and page. That share is the members' total against `totalSupply`, read from the holder ledger (or bounded per‑wallet `balanceOf` reads when the ledger isn't usable — and not at all past 60 wallets), rounded to **two significant figures**, and shown only once **3 or more** members have a read‑only wallet linked (`SUPPLY_MIN_MEMBERS`) — with fewer, the figure would be one person's balance with extra steps. Only the total is ever shown, never anyone's balance.
- A community **goes LIVE once 10 members opt in — and only real holders count.** To start, join, or post in a community you must **hold that community's own token**, verified on‑chain from a linked (read‑only) wallet. On top of holding, **no more than 2 counting opt‑ins per network address** (the starter's own network is excluded). Holding is an **ongoing** requirement, not a one‑time check: a background sweep re‑reads qualified members' balances and **revokes their qualification + the 10×** if they sell or move the tokens out — so you can't qualify once and keep the boost forever. **The sweep's real throughput:** every **10 minutes** it takes the **40** least‑recently‑checked qualified rows **site‑wide** (not per community), oldest first. So revocation is certain but not instant — across a large site a given member is re‑read on the order of hours, not minutes.

**Who can see vs. who can post**
- **Anyone can read a live community's wall** — click any community card and browse its posts, photos, GIFs and videos without an account.
- **Only members can post.** Posting requires opting in, and opting in requires **connecting a wallet and confirming on‑chain that you hold the community's token**. Members post exactly what the Send Wall supports — text, **photos, GIFs and videos** — through the same compressed, streaming upload pipeline.

**The 10× multiplier (Send Power bonus)**
- While you're a qualified member of **≥ 1 live community**, **a flat 10× community boost is added to every point you earn** — applied in the same `awardPoints` path as everything else, on top of your Holder Boost and OG bonus. The full sum the server pays is `base × (1 + (HolderBoost − 1) + (OG − 1) + (Community − 1) + (Arcade − 1) + (Prize − 1) + (Beta − 1))` — the last term is the flat **2×** (`BETA_BADGE_MULT`) a beta top‑ten badge pays forever once the beta settles, so it adds +1 over the base like every other boost — boosts add, they do not multiply, so OG Gold 10× plus a community 10× is 19×, not 100×. Every action you take **inside a community** (posting, reacting, commenting on its wall) earns Send Power at that 10×, and your dashboard shows the bonus as an achievement you can unlock.
- It's a **flat 10×** — being in five live communities is still 10× (it doesn't stack with itself).

**Founder bonus** — when a community reaches 10 members and flips to live, its starter earns a **one‑time founder bonus** of **+15,000 base Send Power**, run through the normal multiplier path like any award — but it hits the per‑event ceiling almost immediately: 15,000 × 10 would be 150,000, and no single award may exceed **73,762**, so a founder who is in their own live community is paid **73,762**, an effective ×4.92. A Holder Boost or OG tier on top of that adds **nothing** — the ceiling is already binding. It's **once per account, ever** — the dedupe key is the founder's user id, not the community, so starting and growing a second community pays nothing. (Community creation is capped at 3/day, so without this one person could farm the bonus.)

**Members & member levels** — every community page lists its members (**up to 200**, so a very large community does not show every one), ranked by their **community member level** (the conviction level below), with the top three medalled and the starter crowned 👑. Participating raises your own member level *and* contributes XP to the community itself — so an active member is literally what levels a community up.

**Community level (exponential curve)** — a community earns XP when its **distinct members** are active on its wall (join, post, react, comment). XP is **daily‑capped per community** *and* **capped per member per day** (so a single spammer can't level it), and only accrues while the community is **live**. The exact ceilings: **250 XP per member per community per day**, and per community per day a cap on the *number of awards* of each kind — **400 posts, 300 reactions‑received, 200 comments, 200 Send Calls**. Its level uses the same `levelForXp` curve as personal levels. The most active communities (a time‑decayed activity score, ~12h half‑life) float to the top of the grid.

**Conviction (per member, per community)** — your **member level** (your "conviction") in a community rises **only when you do something there**, never for elapsed time. There is no timer or sweep that accrues conviction for months held; every point comes from an action, at these rates: **join 40**, **post 20**, **Send Call 30**, **comment 6**, **reaction given 2** (daily‑capped at 150 conviction XP/community/day). Staying a member without participating leaves your conviction exactly where it was. It surfaces as a **💎 Lv N badge next to that token** in the **Conviction Plays** section of your public wall, titled Newcomer → … → Ride‑or‑Die.

**Making a Send Call from anywhere** — the floating ✏️ button's **📣 Send Call** tab takes a pasted contract address, resolves it on-chain (symbol, name, market cap, liquidity) and posts the call. The button stays disabled until the token resolves and clears the **$2,000 liquidity** floor (`MIN_CALL_LIQ` — the server refuses any call on a thinner pool), it shows how many calls you have left today, and a "see the full on-chain detail first" link opens the same token popup used everywhere else — calls made without opening it are flagged on your wall, exactly as they are from the radar.

**Losing and regaining your verified slot** — the 10‑minute holder sweep (or disconnecting your wallet) flips a member who no longer holds the token to *unverified*: no posting, no 10×, and the go‑live count drops by one. It is not a dead end: buy/relink and tap **↻ Re‑verify holdings & opt back in** on the community page — the same membership row re‑qualifies (your member level is untouched, and nothing is paid twice). If you hold but a verified slot is blocked by the anti‑sybil caps (≤2 verified opt‑ins per network; the starter's own network never counts), the page says so instead of pretending you're in.

**The official communities** — `$Send` and `$GWC` are seeded as **official** communities owned by the site's own `@JustSendIt` account (a system account: it never ranks, never posts, never earns). They are live from day one, pinned in their own strip at the top of the Communities page on every tab, and join exactly like any other community (hold the token → opt in → 10×). They exist so a first‑timer can *see* a working community before starting one.

**Viewing vs. participating** — anyone, signed in or not, can open any community and read its wall, members and stats. Opting in (and therefore posting, reacting, commenting, and the 10×) requires connecting a wallet — a free, read‑only signature — and holding that token on‑chain.

**Tokens in posts** — a pasted contract address is looked up on‑chain when the post is saved and rewritten to its `$TICKER`; the post keeps a small token map, so every `$TICKER` renders as a chip that opens the token detail popup (with the community tag inside). `$SEND` / `$GWC` mentions always resolve. Unresolvable addresses stay as typed (shortened, with a copy button).

**Muting (user‑side moderation)** — on anyone's public profile: **Moderation ▾ → Mute @name**. The server then drops their posts, calls and comments from *your* Send Wall, community walls and comment threads; wherever they still appear (leaderboards, member rosters, someone else's call, notifications) their name renders **red with a 🔇** that opens an unmute popdown. Mutes are private (the muted person is never told), instant, and reversible. Their own profile stays viewable if you open it — you chose to.

**Posting from a community page** — once you're a qualified member, the floating ✏️ *Send it* button posts to *that* community's wall (it scrolls to and focuses the community composer). Anywhere else — or on a community you haven't joined — it opens the global Send Wall composer and, after posting, offers a *View on the Wall* link instead of yanking you off the page.

**Honest residual risks / limitations**
- The anti‑sybil gate is **on‑chain holding of the community token + a ≤2‑per‑network cap + continuous re‑verification**, not proof‑of‑personhood. A determined actor could still buy the token across several funded wallets and rotate IPs to manufacture a go‑live — but it now costs **real, sustained capital** (the sweep revokes qualification the moment the tokens leave a wallet), not a free throwaway account. **A slot that counts needs $100 of the token** (`MIN_COMMUNITY_HOLD_USD`, which is the site‑wide `MIN_HOLD_USD` floor of §3.2.1), verified on‑chain, so ten qualified members is **$1,000** of standing exposure — not ten dust balances. Creating a community takes the same $100. The tiny `OG_DUST_WEI` floor applies only to checks that demand no dollar floor at all (the OG badge's $SEND/$GWC holding checks); when a dollar floor is demanded and no price can be read, `holdsToken()` answers *undecided* (`null`) rather than falling back to dust — see below. Qualification is re‑verified continuously for **pending** communities as well as live ones, so a single bag can no longer be walked through ten accounts to tip one live.
- Going live is **one‑way** — leaving a live community never un‑lives it and never claws back the founder bonus.
- Market stats on community cards are cached (~45s refresh) and are **display only** — nothing about a community implies the token is safe or a good buy. **Most tokens go to zero.**

---

**A dollar floor can never quietly become a dust floor.** `holdsToken()` used to raise its threshold to
the dollar equivalent only `if (minUsd > 0 && priceUsd > 0)`, leaving it at `OG_DUST_WEI` otherwise. Every
community caller passes `communities.c_price`, a **nullable** cached price — so whenever that price was
missing, a slot the whole site describes as "$100 of the token" was satisfied by `1e-9` of it, and with it
the verified membership, the go‑live count and the flat 10×. It now returns **`null`** — *undecided* —
when a floor is demanded and no price is available. Grant paths refuse and say which it is ("nothing has
been decided — try again in a minute"); the revocation sweep skips the row, exactly as it already did for
an RPC error, so an unreadable price never takes a slot from someone who has done nothing wrong. This is
the same rule `refreshHolder` uses for $SEND/$GWC, where an unreadable price keeps the previous verdict
rather than falling through to dust.

### 3.10b The holders‑only wall 🔒

Every live community has **two walls**:

| | Who can read it | Who can post |
|---|---|---|
| 🌐 **Public wall** | anyone, signed in or not | verified holders |
| 🔒 **Holders‑only wall** | **verified holders of that token, and nobody else** | verified holders |

"Verified holder" is the same slot everything else in a community uses (`community_members.qualified = 1`): at least **$100 of the token** (the §3.2.1 floor), read from a linked wallet on‑chain, and re‑checked continuously by the holder sweep — **sell the token and the wall closes with it.** The **sandbox has no private wall**: it grants that slot to anyone who taps Join with no wallet and no token, so a "holders‑only" wall there would be open to everyone while the page promised an on‑chain check. `canReadPrivateWall` requires `communities.demo = 0`, the wall route refuses `wall=holders` there, and the tabs do not render. The composer posts to whichever wall you are looking at, so there is no separate "who can see this" setting to get wrong.

**The gate is on the server, on every path that can return a post** — not a filter in the page:

- `GET /api/communities/:id/posts?wall=holders` is **refused outright** (403) to anyone without a live slot; no rows are sent. The public feed selects `private = 0`, so a private post is not in it to begin with.
- `GET /api/posts/:id`, its comments, and the react / vote / comment endpoints all answer **404** for a viewer who may not read it — never 403, because a 403 would confirm the post exists.
- The **Data API** (`/v1/posts`, `/v1/comments`) follows the same boundary as everything else it serves: public data in bulk, plus the key holder's **own** private posts — never anyone else's.
- **Public** community posts *do* appear on the Send Wall and the following feed — that is the point of them (§3.10c) — carrying their community's name, symbol and image so the wall links back. A **holders‑only** post never does: the wall query selects `private = 0`, so it is not in the result to begin with. Profile walls are the exception that still filters community posts out entirely (`community_id IS NULL`), so a profile shows only what its owner posted to the wall itself.

The author keeps sight of **their own** post if their slot lapses (they wrote it, and they can still delete it); the feed itself closes for them until they re‑qualify.

### 3.10c Communities on the Send Wall — one timeline, branded 🧱

A community that nobody can see is a community that never fills. So **every public community post also lands on the public Send Wall**, badged with the community it came from and linking back to it.

**What travels with a post.** Each post carries its community as `{ id, symbol, name, image, status, demo, token }`, so the wall can render the badge, show whether it's live yet, and link straight to the community page — where a reader who holds the token can join on the spot.

**What never travels.** A **holders‑only** post. The wall query filters `private = 0` in SQL, so a private post is not in the result at all — there is no view‑layer filter to get wrong. This is the boundary the whole feature rests on: public community posts are a front door, holders‑only posts stay behind it.

**The sandbox posts to the wall too.** The demo community is a community like any other here — its public posts reach the wall, badged as the sandbox, so the feature can be seen working before a real community exists. (It has no holders‑only wall at all; see §3.10b.)

**One posting allowance, wherever you write.** A community post is charged against the *same* per‑account bucket as a wall post — **12 posts per 10 minutes** — so posting from inside a community is not a second lane for reaching the front page.

**Auto‑invite posts.** The site writes exactly two posts per community, as the creator, always public, both earning **zero** Send Power:

| When | What it says |
|---|---|
| The day it's started | 🏘️ *Started a community for $SYM. It needs 10 holders to go live — if you hold $SYM, come and join.* |
| The day it goes live | 🎉 *The $SYM community is LIVE. Come say something — hold $SYM and you are in.* |

Each is deduped through a zero‑amount marker row (`cinvite:<id>:new` / `:live`), so a restart or a second go‑live transition can never repost it. And because the one‑time **first‑post bonus** counts only posts you wrote to the wall yourself, the site writing an invite in your name **does not burn it**.

### 3.10d Community proposals — deciding things together 🗳️

A **live** community can put a question to its holders. Only a **verified holder** of that community's token can open one or vote, and the whole thing runs on a two‑round clock so a handful of people can't rush a decision through.

| | Round 1 | Round 2 |
|---|---|---|
| **Runs for** | 3 days | 2 days |
| **Passes when** | yes × 2 ≥ yes + no (a **simple majority**, promoting it to round 2) | yes × 4 ≥ (yes + no) × 3 (a **three‑quarters supermajority**) |
| **Quorum** | 20% of qualified members, min 5, max 50 | 30%, min 6, max 60 |

**Limits.** One open proposal per person, five per community; a draft that is never opened expires after 24 hours; new proposals are rate‑limited to 5 per window. **Voting earns community XP** at the reaction rate, so taking part in governance counts toward the community's level like anything else. Selling the token ends your standing to vote along with everything else.

### 3.10e Send Squads — private, token‑gated groups 🛡️

A community is a fan group anyone can read. A **Send Squad** is the opposite: a **private group with a door on it**. The person who starts one (its **owner**) names it, gives it a bio, a profile picture and a banner, and sets **one gate, once, at creation** — and that gate can never be changed. Everything inside is for **verified members** only: the wall, the calls, the conviction board, the member list. A squad is a club, **not an endorsement** of the token that gates it, and nothing about one is a reason to buy anything. Every `/api/squads` route needs an account (§3.16): signed out, each answers `401 {error, code:'need_signin'}`, and the pages show a locked panel with a sign‑in button instead of the content.

**The house squad.** `seedOfficialSquad` creates the **`$GWC 2% Squad`** at boot (once the chain answers `decimals()` for $GWC — otherwise `seedOfficialSquadLater` retries in‑process after 2.5 s, 1 min, 5 min and then every 10 min, up to eight tries, before waiting for the next boot): an **official** squad owned by the site's own system account, gated at **2% of $GWC's total supply**, summed across a member's linked wallets — read on‑chain and re‑checked on a schedule exactly like every other gated squad. It sits first in the directory (`ORDER BY official DESC`) and joins like any other.

**Starting one** — `POST /api/squads {name, bio?, gateKind, gateToken?, gateAmount?, avatar?, banner?}` → `{id, squad}`
- A name of **3–40 characters** — letters, numbers, spaces and `. - _ ' $ & ! ?` (`SQUAD_NAME_RE`); a bio of up to **280** characters (`SQUAD_BIO_MAX`); a picture and a banner as a jpeg/png/webp data URL of at most **3.5 MB**, or one of your own `/uploads/` references from `POST /api/upload`.
- **Three kinds of gate** (`gateKind`): **`none`** — anyone with an account can join, and no balance is ever read; **`tokens`** — hold at least this many of the token (`gateAmount` > 0); **`pct`** — hold at least this **percentage of the token's total supply**, between **0.01** and **100** (`SQUAD_GATE_PCT_MIN`, `SQUAD_GATE_PCT_MAX`). A percentage gate is measured against the live `totalSupply()` (`squadNeedWei`), so the number of tokens it takes moves with the supply; the card shows the current "≈ N tokens". The token must answer `decimals()` on‑chain; its symbol, name and art come from the pair lookup, or from the contract itself when it has no pair.
- **The gate is fixed forever.** `POST /api/squads/:id/settings` (owner only) changes the name, bio, picture and banner — nothing else. No route edits a gate; to gate differently you start a different squad.
- **The owner must pass their own gate.** A gated squad's creator is read fresh on‑chain before the row is written (`squadHolds` with `fresh: true`); short of it, the request is refused with **403** carrying what they hold against what it takes. A gate nobody can pass is not a squad. If the chain cannot be read the answer is **503** and nothing is created.
- **Limits:** `SQUAD_CREATE_PER_DAY` = **3** squads per account per day, **5** per network address per day, and **ten** squads per person in all; you cannot own two squads with the same name (**409**). Starting one is a *doing* action behind the participation check (§3.15b), like posting or calling.
- The owner is written in as a verified `owner` member; the squad starts with a `member_count` of 1.

**Joining and staying verified** — `POST /api/squads/:id/join` · `DELETE /api/squads/:id/join`
- To join a gated squad, your **linked read‑only wallets are summed** (up to `MAX_LINKED_WALLETS` = **5**) and the total is read fresh on‑chain against the gate (`walletsBalanceWei`). Below it, the answer is **403 `code: 'gate'`** with `need` and `held` in tokens, so the page says exactly how far short you are — or, with no wallet linked, that the squad is gated and a wallet has to be linked before it can be checked. If the chain cannot be read: **503, nothing decided.** A squad is full at **500** verified members (`SQUAD_MAX_MEMBERS`).
- An **open** squad (`gate_kind = 'none'`) reads no balance at all — there is no gate to check — though joining is still a *doing* action behind the participation check of §3.15b, as every join on the site is.
- **Membership is re‑checked on a schedule, not once.** `sweepSquadGates` runs every **10 minutes** and re‑reads the **40** least‑recently‑checked verified members of gated squads **site‑wide**, oldest first. A member whose wallets no longer clear the gate is flipped to **un‑verified** — the wall, the calls and the boards close for them, the member count drops, and they are told why — while an unreadable chain leaves them exactly as they were (it still counts as their turn, so one unreadable wallet can never hold the queue). **Unlinking or disconnecting a wallet pauses every gated membership at once** (`pauseSquadGatesFor`), because the gate was read against a wallet set that no longer exists; one tap on Join re‑reads the wallets you still have. Be honest about what that means: verification is a read of the chain *at the time of the check*, so someone who sells stays verified for **ten minutes or more** after the fact, until their row comes up. A gated wall also re‑checks the holding before each post (a passed or failed read is good for **5 minutes**, `SQUAD_GATE_TTL`) and un‑verifies on a failure.
- **Un‑verified is not out.** The membership row stays; tapping **Join** again once the wallets clear the gate re‑verifies the same row (`ON CONFLICT … DO UPDATE SET verified = 1`). Leaving deletes the row; **the owner cannot leave** their own squad.

**The private wall** — `GET /api/squads/:id/posts?before=` · `POST /api/squads/:id/posts {text, image?}`
- A squad post is written with **`private = 1` and `squad_id`** set. It exists **only for verified members**: the feed answers **403 `code: 'members'`** to anyone else, and `GET /api/posts/:id`, its comments, reactions and votes all answer **404** through `postVisible` — never 403, because a 403 would confirm the post exists. The author keeps sight of their own.
- It **never** appears on the Send Wall or the following feed (those select `private = 0`), never on a profile wall (`squad_id IS NULL`), never on a token chart's markers, and never in the Data API for anyone but its author — the same boundary as the holders‑only wall (§3.10b). A report of a post the reporter cannot read answers 404 like every other verb. **Known limit, shared with holders‑only posts:** a picture attached to a squad post is served from `/uploads/<random 24‑hex name>` to anyone who has the link — the name is unguessable, but a member can pass it on.
- Posting is for verified members: text up to **500** characters, photos/GIFs/video through the same upload pipeline as the wall, out of the **same 12‑per‑10‑minutes** bucket as every other wall. A squad post pays the **person** the ordinary **75** (`PTS.post`), and comments and reactions inside a squad pay the person their ordinary Send Wall points too (`PTS.comment` 24, `react_give` 6 / `react_get` 9) — the squad gets **nothing** for any of them (below).

**Squad calls** — `POST /api/calls {token, squadId, …}`
- A Send Call can be sent **to a squad** instead of the public wall. The caller must be a **verified member** (403 otherwise); every other guard is the public one — the daily allowance (§3.5), the **$2,000** liquidity floor (`MIN_CALL_LIQ`), the no‑calling‑your‑own‑token rule, the same‑connection ring check and the spam burst (§3.4).
- **One call per token per caller, per squad.** The uniqueness key is `(user_id, token_addr, COALESCE(squad_id, 0))`, so a public call and a squad call on the same token are two different calls and both are allowed; a second call on the same token *in the same squad* is refused.
- The call and its widget post are **private to the squad** (`private = 1`, `squad_id`): it is never on a public board, never in a profile's call stats (`squad_id IS NULL`), and never in the alert fan‑out; `GET /api/calls/:id`, `/senders` and `/hop` answer **404** to anyone who is not a verified member.
- **Every point goes to the squad; the person earns 0.** The response is `{ pointsEarned: 0, squadPoints, squadId }`. A squad call also scores nothing for a token community (`callComm` is `null` for a squad call).

**"Send It" inside a squad** — `POST /api/calls/:id/hop` on a squad call is for verified members only (404 to anyone else). On a **real, verified position** it pays the squad `round(30 × addBonus(sizeMult(spend)))` — `PTS.hop_on` scaled by size, flat — and the Sender's own hold bonus (`hop_hold`) as it accrues, inside the Sender budget `HOP_POINTS_CAP` (a quarter of `CALL_POINTS_CAP`). The person earns **0**; a tap with nothing in the token pays nothing, exactly as on a public call.

**What scores — all of it to the squad.** `awardSquadXp` credits the squad's `xp` through `points_events` with `amount = 0` and the XP in `base` (`kind = 'squadxp'`), so no personal total, daily budget or "recent gains" list can ever read squad points as the person's — and the `ref` still dedupes. It is paid **flat — `mult = 1`**, never the personal multiplier stack: no Holder Boost, OG, community 10×, Arcade or prize touches a squad point.

| What | Squad points | Bound |
|---|---|---|
| Opening a squad call | `round(120 × sizeMult(spend))` — `PTS.send_call` × the size of the caller's verified position (each $100 = 1×, floor 1×, cap `SIZE_MULT_CAP` = 100×; §3.4) | the call's lifetime budget, `callHeadroom(0, CALL_POINTS_CAP)` |
| Each X the call reaches | rung *m* pays **170 + 17 × (m − 1)** (`PTS.call_x`, `CALL_X_STEP`) — 1x 170, 2x 187, 50x 1,003; the ladder caps at **50x** (`CALL_X_CAP`) | the ladder's **30%** slice (`CALL_X_BUDGET_SHARE`) of `CALL_POINTS_CAP` |
| Holding in profit (the caller's diamond‑hands bonus) | the same `accrueHold` curve and crew factor as a public call (§3.4) | `callHeadroom(paid, CALL_POINTS_CAP)` |
| A member Sends It | `round(30 × addBonus(sizeMult(spend)))` on a real position, plus their hold bonus as it accrues | `HOP_POINTS_CAP` |
| Conviction, daily | per verified member, per pinned token **still held** and worth ≥ **$20** (`SQUAD_CONV_MIN_USD`): **`2 × (1 + min(days pinned, 360) / 30)`** (`SQUAD_CONV_DAY`, `SQUAD_CONV_MAX_DAYS`, `SQUAD_CONV_RAMP_DAYS`), rounded — day 0 → 2, day 30 → 4, day 360 → 26 | once per UTC day per (squad, member, token) |
| Posts, comments, reactions on the squad wall | **nothing** | — |

The rungs and the hold bonus obey the **same anti‑farm rules as a public call** (§3.4): credited at the lower of the live price and the hour's median, only while the pool holds **≥ $2,000**, never more Xs than **one per $500** of pooled depth (`CALL_DEPTH_USD_PER_X`), a level **sustained across two consecutive sweeps**, and one lifetime budget per call (`CALL_POINTS_CAP` = `xpForLevel(70)` ≈ 737,627). The refresh sweep picks who to pay with one switch — `r.squad_id ? awardSquadXp : awardPoints` — so a squad call can never pay both.

**Conviction credit — how the daily pass works.** `sweepSquadConviction` runs every **5 minutes** and takes **one squad per pass** whose `conv_at` is before today's UTC midnight. For each verified member it prices their pinned tokens (Conviction Plays, §2) and reads their balance across their linked wallets — spending at most **300** balance reads per pass (`SQUAD_CONV_READS`) and resuming from `conv_cursor` next time; balances are cached for **10 minutes**. A pin counts as **held** when the balance is above dust (`OG_DUST_WEI`) **and** worth at least $20 at the live price; the verdict, value and days are stored in `squad_pin_state`. A token whose price cannot be read is **skipped that day** — never credited, never penalised. The credit ref is `sq<id>:conv:<member>:<token>:<day>`, so a restart cannot pay twice.

**The level.** A squad's level is `levelForXp(xp)` — the same exponential curve as personal and community levels (Level 2 = 83, Level 10 ≈ 1,154, Level 50 ≈ 101,333; §3.1). The page's bar reads `levelInfo {level, xp, intoLevel, spanLevel}` (`commLevelInfo`). When a credit crosses a level, every verified member (up to 200) is told.

**The weekly board** — `GET /api/squads/weekly` → `{ week: {startsAt, endsAt, key}, serverNow, board, last }`. The week is the **ISO week, Monday 00:00 UTC** (`weekKey`, `weekWindow`). The rollover is **lazy**: the first credit of a new week moves `xp_week` into `xp_last` (with `last_week_key`) and starts the new bucket at 0, so last week's total is kept, and a squad that earned nothing this week still shows last week's. The board is the top **20** squads by `xp_week`, then members; `last` is last week's top **3**. Squad points are calls and conviction only — activity, never market cap. **No prize**, just bragging rights. The directory response carries the same `weekly` object.

**The conviction board** — `GET /api/squads/:id/conviction` (verified members only, `squadConvictionView`): the verified members' **pinned tokens, aggregated** — per token, how many members are convicted in it, how many were **still holding** at the last daily check (a `held` verdict less than two days old), the **longest** and **average** days pinned, and up to five holders' names — sorted by members, then longest hold; the **top 10 convicted members** by pins, then longest hold; `pointsAllTime` and `pointsWeek` from conviction credits; and `checkedAt`. The detail view carries the counts alone (`conviction: {tokens, members, pointsAllTime}`).

**The lifetime tracker** (`squadLifetime` — on every card and page, and with `GET /api/squads/:id/calls`) is derived from the squad's own calls: the entry, peak and current prices the refresh sweep records, and the positions callers and Senders held when they acted (read on‑chain then). Every figure is a **paper** figure — what those positions were worth at the peak or are worth now, against what went in. Nobody has realised anything.

| Figure | Exactly |
|---|---|
| `calls` | the number of squad calls with an entry price |
| `totalX` | Σ min(peak ÷ entry − 1, 50) over the calls (`CALL_X_CAP`), to 2 decimals |
| `bestX` | the largest of those terms, to 2 decimals |
| `sentUsd` | Σ (the caller's `entry_spend_usd` + Σ its Senders' `spend_usd`) — what was in the token when they acted |
| `peakGainUsd` | Σ sent × (peak ÷ entry − 1) — paper gains at each call's peak |
| `nowGainUsd` | Σ sent × (current ÷ entry − 1) — paper gains now, negative when under water |

Dollar figures are rounded to **two significant figures** (`senderUsdPublic`; `usdSigned` keeps the sign), the same coarsening every public stake on the site gets, so no one's position can be read off a squad card.

**The directory** — `GET /api/squads?q=&sort=&gate=&time=&token=` → `{ squads, weekly, mine, serverNow }`, up to **120** cards, official squads first. `q` matches the **name** (case‑insensitive substring) or the gate token's **symbol**; a `0x…` address (or `token=`) matches the **gate token** — and several squads can share a token, so a search by contract address can return more than one. `sort`: `new` (created) · `level` (xp) · `members` · `active` (this week's points, then xp — the default). `gate`: `all` · `open` · `gated`. `time`: `all` · `day` · `week` · `month` (by creation). `GET /api/squads/mine` lists your own memberships (with `verified` and `role`) for the composer's target select; `GET /api/squads/:id` is the detail (the card plus creator, your membership, the tracker, member counts and conviction counts); `GET /api/squads/:id/members` lists up to **200** members with role, verified state, pin count and longest pin — to verified members only.

**Where it lives.** The **🛡️ Send Squads** tab of `communities.html` (`?tab=squads` opens it; `?q=` prefills the search) holds the directory, the weekly board, "My squads" and the **Start a Send Squad** form; `squad.html?id=N` is the squad page — hero, gate line, Join/Leave, the tracker, and Wall · Calls · Conviction · Members tabs. The floating ✏️ composer's **📣 Send Call** tab gains a target select — 🌐 Public, or any squad you are verified in — and a squad call's widget carries a **🛡️ Squad call** chip. Signed out, every one of these shows a locked panel.

**Leaving the site.** Deleting your account deletes **the squads you own** — with their posts, calls and pictures (a private group with no owner is nobody's) — and your membership and pin‑state rows in every other squad.

**Honest limits.** A gate is a balance read from the chain at the moment of the check, summed across the wallets *you* chose to link — it proves the wallets clear the bar, not who is behind them, and a member who sells stays verified until the sweep reaches them. Squad points are a scoreboard for a club: they pay no one, they are not a signal about the token, and a squad gated on a coin is not a recommendation of it. **Most new tokens go to zero. DYOR.**

### 3.11 OG tiers — being early, four tiers 🏅

Hold **both $Send and $GWC**, bought from the market, and keep holding both: you earn a **permanent OG badge** and a Send Power boost that adds on top of everything above. There is **one standard**; only *when* you got in changes the size.

| Tier | Multiplier | Entry window | Closes* |
|---|---:|---|---|
| 💎 Diamond | **20×** | the **first month of $GWC** (2026‑08‑19 → 2026‑09‑18), **and** a net buyer of both that month | closed 2026‑09‑18 |
| 🥇 Gold | **10×** | until the beta ends | 2026‑11‑17 |
| 🥈 Silver | **5×** | the 90 days after the beta | 2027‑02‑15 |
| 🥉 Bronze | **3×** | until $GWC turns one year old | 2027‑08‑19 |
| — | 1× | after that: no badge, whatever you buy | — |

\* All three are **single moments that apply to both coins alike** (`OG_TIER_CLOSE` in `server.js`), not offsets from each coin's own launch — so "when does gold close" has one answer rather than two six days apart. Gold is tied to the beta's end (`BETA_END_MS`, overridable with `BETA_END`; moving it moves gold and silver together), and bronze to one year from $GWC's on‑chain launch (2026‑08‑19). Your tier is the **lower** of your two coins, because the rule is that you held both — and since every close is the same instant for both coins, that simply means the timestamp that counts is your first market buy of whichever coin completed the pair. The whole campaign runs 365 days from $GWC's launch (`OG_TIER_CLOSE[1] = OG_LAUNCH.GWC + 365 days`, closing 2027‑08‑19); gold and silver close relative to the beta's end (`BETA_END_MS`, which defaults to 90 days after $GWC's launch and moves with `BETA_END`), never relative to each coin's own launch. The 30‑day "month" survives only in the sell‑out test below (`OG_MONTH_MS`). Nothing schedules this: a tier is a pure function of an on‑chain buy timestamp, so the campaign advances and closes by itself. The live clock is served at `GET /api/og/campaign`; the homepage banner, the About page and the dashboard all read it rather than hard‑coding a date.

**💎 Diamond — the first believers.** Diamond goes to accounts that bought **both** coins in the first month (30 days) after $GWC launched (`OG_DIAMOND_START`/`OG_DIAMOND_END`, from `OG_LAUNCH.GWC`) **and** were **net accumulators of both over that month**: summed across every linked wallet, more of each coin came *in from the market* inside the month than went *back to the market* inside it (`monthBoughtWei > monthSoldWei` from the same transfer replay; moving tokens between your own wallets is neither). It pays **20×** (`OG_DIAMOND_MULT`) and keeps every Gold perk (a free Data API key). The month has already closed, so nobody can buy their way into Diamond now — it is decided entirely by what happened on-chain then. Every Diamond is also a Gold buyer, so an account already holding Gold is asked the Diamond question once by the grant sweep and upgraded if it qualifies (`og_diamond_at` records a definitive answer; a read that could not be completed is retried, never recorded). It is decided only on a complete read of every linked wallet, and it sits under the same standard as every tier below: still holding both, **$100 of each** at the moment it is granted, and the same disqualifiers. Like every OG tier it is lost **for good** if you sell out of either coin. It is a separate thing from the 💎 Diamond Hands *levels* of the Holder Boost, which are about how long you hold.

**The standard, identical in every window.** Verified read‑only from your linked wallets, across all of them:
- You **bought** each coin from the market — tokens leaving the LP pool for your wallet, directly or through any router or aggregator in the same transaction (see *What counts as a market buy* in §3.15b). Your first such buy of the *later* coin is the moment you "completed the pair", and that timestamp decides your tier. A transfer from another wallet is not a buy.
- You **still hold both** now, across any linked wallet (moving your bag to a hardware wallet is fine).
- **Each bag is worth at least $100** at the moment the badge is granted (`OG_MIN_HOLD_USD = MIN_HOLD_USD`, the §3.2.1 floor, checked against the live price of *both* coins independently). Buying inside the window and keeping $10 of each earns nothing — the badge is meant to sit behind a real position, not a dust balance kept alive to hold a tier.
- **One badge per wallet, ever.** The tier is a statement about a wallet's history, so a wallet that has already earned OG for one account can never earn it again for another (`og_claims`). The claim is deliberately *not* released when the wallet is unlinked — otherwise link → claim → unlink → relink on the next account would clone the badge, and its multiplier (up to 20×), without limit.
- **Two things disqualify a wallet:** if it dumped its whole holding to nothing inside *its own* first 30 days **and** it holds less today than it did at the end of those 30 days, it earns nothing. A wallet that sold out but bought back past where it stood keeps its place. ("Net accumulator" is measured this way on purpose: a wallet's total bought minus total sold *is* its balance, so "bought more than sold" would only re‑ask "do you hold any", which is already required.)

**Losing it.** Sell out of either coin entirely, at any time, and the badge is revoked **for good**. The badge follows your wallet: unlink it and the badge pauses until you relink and are re‑verified — **but disconnecting is not always just a pause.** Before unlinking, the server reads the chain one more time; if it can see that you no longer hold both coins, that counts as selling out and the badge is revoked permanently rather than paused. Disconnecting a wallet you have already emptied does not preserve the tier. Like every holding‑based bonus, it pays only while your holdings were re‑checked on‑chain within the last 26 hours.

**Fail‑closed, always.** Every scan replays your wallet's full transfer history for the coin and must reconcile exactly with the chain's `balanceOf` before anything is written. A read that cannot be completed — explorer throttling, a dropped page — is retried later, never recorded as an answer, so nobody is denied a badge by an outage. Verification stays open for **90 days after the last window closes** for the same reason; what you *earned* is fixed by your buy timestamp, so late scanning can never manufacture a tier.

### 3.12 Biggest Sender — the weekly competition 🏆

A fresh race every week, run by the server on its own. Every **Monday 00:00 UTC** (the same ISO week the community board uses) the Biggest Sender board resets to zero, so the week's standings are only what you earned **inside** it. When the week ends, the game master settles it without anyone having to visit:

- The **top 10** each take a rung of the prize ladder **by finishing place** — **#1 gets 5×, then 4.5×, 4×, 3.5×, 3×, 2.5×, 2×, 1.75×, 1.5× and 1.25× for #10** (`WEEK_PRIZES`; exactly ten prizes — a tie at the edge goes to whoever joined first; recorded in the `competitions` row) — added on top of everything they earn for the **whole of the following week**, alongside the Holder Boost, OG, community and arcade boosts.
- **The race is proof of work.** The board ranks `points_events.comp_base` — what you *did*, with every boost taken out (Holder, OG, community, Rocket Run and any prize you were carrying) **and with position size taken out too**. That second part matters: the call bases are pre‑multiplied by how much money is in your wallet (`send_call` pays `120 × sizeMult`, up to ×100 for a $10,000 bag), so ranking the raw base would have ranked the biggest wallet under a banner that says proof of work. `comp_base` carries the unscaled figure — a call is one call's worth of work whatever is behind it — and equals `base` for everything else. A whale, an OG and a newcomer race on the same footing; the prize pays your level and the all-time board, never your next placing. (`comp_amount` is still recorded per award for the all-time view.)
- **Decay is not negative work.** `decay` events are excluded from the race. They carry a negative base, so counting them subtracted a penalty for being away from the week's standings on top of the Send Power it had already cost.
- Ties share a rank on the board, as on the all-time one; the ten prize places are the top ten rows by points, then account age (`u.id ASC`), so identical scores can never multiply the prizes.
- The deploy week is the first race. Nothing is paid retroactively from history, and a week is only ever settled once.

The board is public at `GET /api/competition` — this week's top 20, the clock, your own row, last week's winners and what they drew. On the dashboard, toggle **The Arena** to 🏆 Biggest Senders.

### 3.13 Data API — the burn key 🔑

One sanctioned door to bulk data, for AI, bots and spreadsheets. A **year** of access is minted for an account whose **linked wallets** have, between them, sent at least its price — **$1,000 of $SEND**, or $500 as OG Silver, $750 as OG Bronze, nothing as OG Gold — **to the burn address** `0x000000000000000000000000000000000000dEaD` — read on‑chain with the same fail‑closed walker the OG scan uses, and **valued at the lower of the live $SEND price and the median of the last 24 hours of on‑chain candle closes** at the moment of minting — a momentary pump cannot inflate a burn, and a live price more than 3× the day's median refuses to value anything. If the chain, the candles or the price cannot be read completely, nothing is assumed and you are told to try again. **A burn backs one live key at a time**, on whichever account its wallet is linked to; the same wallet on another account is refused until that key is revoked.

- **What it opens:** every public surface in bulk, structured JSON — `users`, `posts`, `comments`, `calls`, `communities`, `leaderboard`, `competition` — plus **your own** account in full at `me` (preferences, wallets, tracked wallets, watchlist, every points event, notifications, follows, posts), decrypted for you.
- **What it never opens:** anyone else's private fields. Emails, linked wallets, 2FA, tracked wallets and preferences are encrypted so that only their owner can read them; a burn does not change whose data it is. Public data is already public on the site — the key changes the shape, not the scope.
- **A key lasts one year, then another burn.** Minting *spends* the tokens that were worth the price that day (recorded per wallet in `api_key_burns`, never refunded — a revoked key's burn stays spent); what remains stays banked, so a wallet's **unspent** burn is what counts for the next year. Renewing while a key is live adds a year to the current expiry (`nextExpiry`); a lapsed key starts a new year from the new mint. `dataKeyOf()` refuses an expired key.
- **OG discounts** (`DATA_TIER_DISCOUNT`, needing the badge to be live): **Gold — free and never expires** while the badge is live (a revoked badge takes the key with it, except for any time already paid for on a burn key, which is carried over and honoured to the day); **Silver — 50% off ($500)**; **Bronze — 25% off ($750)**.
- **Mechanics:** `GET /api/data/v1/<resource>` with `Authorization: Bearer sk_…`; newest‑first, `before=<last id>` paging, `limit` ≤ 200, **120 requests/minute per key**. One live key per account; minting again replaces it. The key is shown **once** and stored only as a SHA‑256 hash (`api_keys.key_hash`), like a session cookie. If it leaks, **rotate** it (`POST /api/data/key/rotate`): a new secret with the same expiry, source and ledger, nothing spent — revoking and minting again would cost the paid remainder. An expired key backs nothing, so it never blocks its wallet on another account. Manage it at `/data.html` — reachable from the account menu.

**Encryption at rest, precisely.** Emails, wallet identifiers, 2FA secrets, tracked wallets and — as of this section — the per‑user preference blobs (`tracker_prefs`, `site_prefs`) are AES‑256‑GCM encrypted under `DATA_KEY`. Public content (usernames, posts, comments, calls, boards) is stored readable because search, sorting and every wall must read it; encrypting it would break the site without hiding anything that is not already public.

### 3.14 The Arcade competitions hub

The Arcade page (`arcade.html`) shows **every competition running on the site in one place**, under Rocket Run: this week's Biggest Sender race, this week's Send Calls board, the community race, the OG campaign's windows, today's Rocket Run in aggregate, and the all-time Hall of Fame. Each card carries the live clock, the prize exactly as the game master pays it, the top of the board as a podium, where *you* stand (and, for the weekly race, how many points would break you into the prize places), a one-tap way in, and an ⓘ explanation of how to win — hover or focus shows it, a tap toggles it for touch, Esc closes it.

**Every name on every leaderboard opens that person's Send Wall** (`/u/<name>`): the Arcade cards, the dashboard's Arena (including "pts to overtake @name"), the home page's beta standings, a Send Wall's 🏆 Leaderboard tab, a community's members board, a squad's conviction and members boards, and the "who Sent It" list on every Send Call. Boards whose rows are communities, squads or bare wallets show no person to link, and Rocket Run shows counts only, never who flew. `tests/boardlinks.mjs` checks each board.

- One read feeds every card: `GET /api/competitions` (`server.js`, `competitionsPublic()`), whose public half is cached for 8 s like the boards it is built from; the per-user blocks (your rank, your prize, your flight) are computed per request. Nothing on the page is typed in — every ladder, window and date is the constant the server enforces.
- Rocket Run appears as **today's totals only** (flights, cash-outs, best cash-out, pilots boosted right now) — never who flew.
- The community race lists the sandbox when it scores, marked `🧪 Sandbox · stock, not a token · no 10×` with the not-affiliated line under the board; the Biggest Sender `top` uses the payout's own predicate (rank ≤ 10, so a tie at #10 is inside) and the podium/list split is positional, so a shared rank in the top three never drops a row.
- Movement chips (▲2 · ▼1 · NEW) compare a board with the one *this browser* saw the last time the page was opened, from `localStorage`; they are labelled as "since your last visit" and never claim anything the server did not rank.
- The page re-reads every 45 s while visible, ticks its clocks from the server's own clock, and re-renders only when something moved — never while an ⓘ tip is open or while your focus is inside a board. Confetti fires once a week, only if you open the page sitting inside the prize places.
- Accessibility: podiums are ordered 1-2-3 in the DOM and arranged 2-1-3 only visually; every board is a labelled list; countdowns are plain text; the live region announces only real changes (a new top three, or your own rank); reduced motion turns every animation off.

### 3.14b The Send Calls board — how the weekly caller race is scored

The Send Calls board ranks **callers**, not calls. The Arcade card shows the **last 7 days** and the **top 10**; the full board on any public wall's 🏆 Leaderboard tab (`GET /api/calls/leaderboard?window=`) takes a rolling window (24h / week / month / year / all):

- Your score is the **sum of every call's peak X** in the window, each capped at **50x** so one freak run can't decide the board.
- Ties break on your **single best** call's peak X.
- Only calls opened inside the window count, and only ones whose pool had **≥ $2,000** liquidity at call time (`MIN_CALL_LIQ`).
- The Arcade card shows the **top 10** of a 25-row board (`callLeaderboard` is `LIMIT 25`); your own "where you stand" line is looked up in those 25 rows — beyond that you are unranked. The full **top 25** is what the profile page's 🏆 Leaderboard tab shows (`GET /api/calls/leaderboard`).

Peak, not current: the board measures how high your calls got, so a call that ran and retraced still scores what it reached.

### 3.14c The Support board — a help desk, not the wall 🛟

`support.html` is the same posting machinery pointed at a separate room (`posts.board = 'support'`), and the difference that matters is economic: **asking a question there earns no Send Power.** The post award sits behind a check that the post has no board, so support questions pay nothing — deliberately, so nobody farms points by asking questions nobody needed answered, and so the sort order reflects what people actually want answered. Answering (a comment), voting and reacting go through the same routes as on the wall and pay their usual `comment` / `vote_give` / `vote_get` / `react_give` / `react_get` awards, under the same per-post dedupe, daily caps and self-action exclusions.

- Questions sort by **votes** (most‑asked first) or newest; voting is what surfaces the common ones.
- It shares the wall's posting allowance (12 per 10 minutes) — one bucket, wherever you write.
- There is **no accepted‑answer, resolved, or official‑answer mechanic**, and no moderator pinning — votes are the only ranking signal.
- Support posts never appear on the Send Wall, and wall posts never appear there.

### 3.15 The sandbox community — branded for a listed company, not a token

The open sandbox (joinable with no token and no wallet, grants no multiplier) is branded for **Robinhood Markets, Inc. (NASDAQ: HOOD)** — the public company whose app and chain this site runs on — instead of for a token. Its page and card show the **stock's** figures, labelled as a stock: last price, the day's change, market cap when the source reports it, the exchange and market state, plus the source and the time the quote was read.

- Quotes are read server-side (`stockView()` / `refreshStock()` in `server.js`) from public quote feeds tried in order — CNBC, then Yahoo Finance — with a **truthful User-Agent naming this site**, no forged `Origin`/`Referer` and no browser impersonation (Nasdaq's feed answers only requests dressed up as its own web app, so it is not used). Responses are parsed to one shape, cached 5 minutes, and never invented: if no source can be read the page says *quote unavailable*, a quote whose re-read failed is marked **stale**, a blank field is `null` rather than `0`, and the source and time are printed wherever the figure appears. These are undocumented, browser-facing feeds: `STOCK_QUOTE=0` turns the live figure off (the page then shows no price at all), and a licensed quote feed is the right source for production.
- The sandbox is keyed to a synthetic address (`DEMO_TOKEN`), so no real token's market data or community tag can attach to it; the first version was keyed to WETH and wore WETH's price, cap and holder count.
- No Robinhood artwork or marks are used — the site brands it with its own 📈 mark and plain naming — and the sandbox is `demo`, never `official`, so a listed company's name never sits under the 🏠 Official badge. Where the brand appears: the community page carries the full line (a stock, not a token; cannot be bought, held or swapped here; not investment advice; not affiliated with, endorsed by or sponsored by Robinhood Markets, Inc.) plus the quote's source and time; the grid card carries a `Sandbox · stock, not a token` pill and a source/time/not-affiliated line; the Arcade hub row carries the Sandbox chip and the not-affiliated note; the profile names the sandbox as a membership that grants no multiplier; proposal notifications say *sandbox*, not `$HOOD`. Snapshots are refused for the sandbox (there is no token to walk) and its member count is never labelled *verified holders*.

### 3.15b The participation check — reading is open, *doing* takes a wallet 🔗

**You can make an account with an invite ticket (§3.16) and nothing but an email.** No wallet, no signature, no coins. You pick your **@username** in the same form — it is your public name, and you can sign in with it or your email. **A name is one name whatever its capitals:** once `send` exists, nobody can take `Send`, `SEND` or `SeNd` — not by signing up with an email or a wallet, and not by renaming (the column is `UNIQUE COLLATE NOCASE`, so the database itself refuses a second casing, and names are ASCII‑only, the letters that rule folds). The owner may change the capitals of their own name; signing in, `/u/<name>` and every look‑up answer to any casing, and a wall opened as `/u/SEND` shows the account's own spelling. `deleted-<number>` is reserved in every casing, because erasing an account renames it to that. (If that email is already on another account, your account is still made, without the email: you sign in with the @username and your password, and can set a different email in Settings → Security.) You can read every page, check in daily, keep your Send Power decay at bay, and set up your own profile (name, bio, colours, links) — that earns no points until you pass the check below, but nothing stops you making the page yours. Pictures are uploads like any other and wait for the check.

**You cannot *do* anything on the site until a wallet proves you are actually here.** Posting, Send Calls, Sending It, comments, reactions, votes, following, tracking, uploading to a post, joining a community — all of it waits behind one read-only check. Your **own profile's text** is the exception (`/api/profile` answers only to a read‑only *sanction*, `blockSanctioned`, not to this check): it is yours to set up from the first minute. Profile pictures (`/api/profile/image`) still wait for the check. The moment you try, the check opens over whatever page you were on, and it explains itself rather than just refusing.

**Two tests, run across every wallet you have linked, against the chain:**

| | The test | Why it is that and not something else |
|---|---|---|
| 1 | **You hold $100+ of $SEND** | Valued at the **lower** of the current price and the price the pool actually sat at over the last 24 hours — its time‑weighted median, rebuilt from the pool's own reserves (`guardedPriceUsd`, `PRICE_MEDIAN_HOURS`; see *Where $SEND and $GWC prices come from*) — and not valued at all while the price is more than 3× that median — a spike cannot buy anyone in. The same `MIN_HOLD_USD` floor Diamond status uses (§3.2.1) — the site has one definition of "you actually hold this", not two. **Dust does not count**, and the bag has to be one you *bought* on the market: a position that only ever arrived from elsewhere gives the sell window below nothing to anchor on. |
| 2 | **You are not a net seller** | Of the tokens that moved between you and the market, no more went out than came in. |

**There is no waiting period — the first day is watched instead.** A third test used to ask whether you had
held for over a week. It is gone. The door now opens the moment you hold the bag, and in exchange
`PROOF_SELL_WINDOW_MS` (24h) after your **most recent market buy**, the position that opened the door has to
still be there. Sell out of it inside that window and it is an anti-cheat trigger like any other: a **strike on
the same three-step ladder** (§3.6) — read-only for a day the first time, a week the second, for good the third —
bought out at **$25 of $SEND per day** of the sanction ($1000 flat for a permanent one), and if that bought bag is
sold before its hold is up the sanction **comes back doubled**. One ladder for every trigger, so a strike means one thing.

Two columns carry it, alongside the redemption pair in §3.6:

| Column | Holds |
|---|---|
| `gate_hold_until` | When the window ends: `lastBuyMs + PROOF_SELL_WINDOW_MS`, stored only if that instant is still in the future — so a long-standing holder is never in a window at all. |
| `gate_floor` | The $SEND balance that opened the door, in **tokens**. |
| `gate_wallets` | The addresses that balance was measured over, as JSON. |

`checkGateHold()` reads **those addresses** from the chain rather than the current linked-wallet aggregate,
and that is the whole point of the column: unlinking a spare wallet drops the aggregate without a single
token moving, and an earlier cut of this answered that with a 24-hour read-only whose stated reason was
"you sold". Pinning the addresses also closes the reverse door — shedding a wallet can no longer shrink the
number the window is measured by. An RPC that does not answer is never a sale; the window is left as it was.

**On test 3 and the tautology.** `ogScan`'s own comment argues that "bought more than you sold" is circular, because Σin − Σout *is* the balance — and for *total* flows that is exactly right. This asks a different question: of the tokens that moved between you and **the market**, did more come in than went out? That is not the balance, because tokens also arrive from a friend, an airdrop, or another of your own wallets. Two cases show the shape is right:

- **gifted 100, never sold** → bought 0, sold 0 → `0 ≤ 0` **passes.** They hold, and have never sold a thing.
- **gifted 100, sold 90** → bought 0, sold 90 → **fails.** They are a net seller. That is the entire point.

**What the $100 means on $SEND** (at the market prices of 13 September 2026, when these figures were written; they move with the price). $100 was ~0.027% of $SEND's 10,000,000,000 supply, so on the order of ~3,763 wallets can clear this bar at once. $GWC is far tighter — 1,000,000,000 tokens at roughly an $11,650 FDV makes $100 about 0.86% of every $GWC there is, ~116 wallets — which is why the gate no longer asks for it; that floor still applies to the OG badge (§3.15) and Diamond status (§3.2.1), where it is doing a different job. The number is a deliberate choice made with the arithmetic in hand, not a round figure picked without checking what it buys.

**It is not a punishment, and it is not worded like one.** Read-Only Mode (§3.6) is a sanction with strikes, an escalating ladder and a buy-out. This is a new account that simply has not shown its hand yet. The first-day sell window above is the one part that *is* a sanction, and it is worded as one. Same enforcement point in the code (`blockReadOnly`), deliberately different answer: `needsProof`, never `readOnly`.

**The check runs in the background, and says so.** A full scan walks your entire $SEND transfer history — it cannot run inside a button press, so it is queued and the page watches it. A restart re-opens anything left mid-flight; a stale claim is never believed. **Signing in with a wallet queues it** for an account that has not passed yet, so the wallet you just signed with is read without a second tap.

**Where the history comes from.** The chain itself. Every $SEND transfer is a `Transfer(from, to, value)` log, so two `eth_getLogs` reads — transfers **from** the wallet and transfers **to** it, over the token's whole life (from the first block the holder ledger saw, splitting the window if the node says an answer is too large) — give the complete history, with one block read per distinct block for the times (`rpcTokenTransfers`). A keyed explorer (`BLOCKSCOUT_URL`) is asked first when one is configured, and the chain answers whenever it refuses (the explorer is then left alone for ten minutes); with no keyed explorer the chain answers directly, because the public explorer refuses servers. The same source feeds every read‑only wallet check on the site — this door, OG badges, the data‑key burn, Send Call and Send‑It sizing, and conviction hold times. Whichever answers, the replay still has to **reconcile exactly with `balanceOf`** before anything is decided.

**What counts as a market buy.** Tokens that the pool itself sent out. Most buys never come straight from the pool — a swap router or an aggregator takes the pool's tokens and passes them on, often after paying the token's tax — so a rule of "only the pool, or a router on a list" refused real buyers (measured on the live site: a 2.47M $SEND buy through an unlisted router, turned away as "no market buy behind it"). The chain answers the question directly instead (`routedPoolFlows`): for a transfer into your wallet from any other contract, it reads the $SEND the pool sent out **in that same transaction** and counts your transfer as bought **up to that amount and no further** — so a contract that buys a dollar and forwards a million from its own stock is credited a dollar. Sells mirror it: $SEND leaving your wallet in a transaction where the pool *received* $SEND counts as sold, capped at what the pool received. A direct pool transfer uses up its transaction's flow first, so a taxed sell is one sale, not two. Only the blocks of those transfers are read (two `eth_getLogs` each), and a read that fails is "could not read", never a refusal. Send Call and Send‑It sizing (`walletTokenPosition`) use the same rule. A transfer from another person's wallet, with no pool movement behind it, is still not a buy.

**A chain we cannot read is never a refusal.** If the chain cannot be read, or a price cannot be read, nothing is decided and the door stays exactly where it was. The site says "nothing has been decided — try again in a minute", because that is the truth — and it asks again **by itself**: every 15 minutes the accounts whose last check ended unread (with a wallet linked) are re‑queued, oldest first (`requeueUnreadProofs`), and once shortly after every restart. What the history alone decides is answered **before** the price is needed: no balance, no market buy behind the bag, or more sold than bought are definite answers even while the price feed is down.

**Everything about it is read-only.** You sign a sentence (`personal_sign`) to prove the wallet is yours. That signature moves nothing, approves nothing and costs no gas. This site never calls `eth_sendTransaction` — it cannot send your funds anywhere, and it never asks your wallet to.

**Once you pass**, the rest is optional: add an email and password if you joined with a wallet (a wallet-only account is a complete account), turn on two-factor, and link more wallets (all of them read-only). A wallet that joined without picking a name — the old one-step path — is given a placeholder and asked to claim a real @handle.

### 3.16 The ticket — reading is open, joining is by invite 🎟️

**First, one question: are you 18 or older?** Every visitor is asked once per device, before the site opens, to tick a box confirming it (`public/agegate.js`). On the homepage it opens the moment the loading screen ends; on every other page it opens straight away. It asks **nothing else** — no code, no wallet, no $100 — and anyone who answers yes reads the whole site for free. "I'm under 18" keeps the site closed for that tab.

| | |
|---|---|
| Where it runs | In `<head>` of every page that loads `styles.css`, after the stylesheet, so the page is covered before it can paint. `npm run check` fails a page that forgets it. The privacy and terms pages stay readable without answering. |
| What it stores | A first‑party cookie, `jsi_age=18`, for a year (`AGE_COOKIE`, `AGE_MIN`, `AGE_MS`). Not HttpOnly on purpose: the page reads it synchronously to decide whether to cover itself, and it is not a secret — forging it says exactly what ticking the box says. With cookies off, the tab still remembers (sessionStorage). |
| What the server does with it | `POST /api/age {confirm: true, age: 18}` sets the same cookie and, for a signed‑in account, records **when** it was answered (`users.age_at`, first time only). `signupRefusal` will not create an account without the cookie (`need_age`, checked after the invite), and `claimInvite` stamps `age_at` on the account it lets in — a trail, not just a checkbox. An OAuth sign‑up refused for age comes back as `?needage=1` and reopens the question rather than the ticket. |
| While it is up | Everything else on the page is `inert` (including anything added underneath, such as a `?invite=1` ticket), Escape does nothing, the tour waits, and `jsi:entered` waits. The value is the age confirmed, not a flag, so raising `AGE_MIN` re‑asks everyone. |

**You do not need anything else to read this site.** The landing page, the Send Wall, the Scanner (any address → full profile), the Arcade, profiles and Send Calls are all open to anyone, signed in or not, crawler or person. (The one deliberate exception is the **New Pairs Radar** tab on the Scanner page: its feed and Best Runners answer `401 need_signin` without a session, so the live radar is for members.) That is deliberate and it is load‑bearing: this site's whole SEO surface — every canonical, every sitemap entry, every `og:` tag — only means something if the pages behind them can actually be fetched.

**You do need a ticket to JOIN.** An invite code is required at every door that can create an account:

| Door | Where |
|---|---|
| Email + password sign‑up | `POST /api/auth/register` |
| A wallet signing up (or signing in for the first time) | `POST /api/auth/wallet/verify`, new‑account branch |
| A wallet that signed in for the first time, finishing with its @username | `POST /api/auth/wallet/signup` |
| Google / Facebook / X / Instagram, first time | the OAuth callback |

All of them call one function (`signupRefusal`), and nothing else on the site calls it. It answers one of four things: `need_invite`, `need_tos`, `code_spent`, or — last — `need_age` — machine‑readable, so the client turns a refusal into the ticket (or, for `need_age`, the age question) rather than an error message.

**How it works for a person:**

1. They browse. Nothing is in the way.
2. They tap **Sign up** — from anywhere on the site. The ticket opens over the page they were on, headed **Ticket to Send 🚀**, and it states the rules before anyone types a code: redeem an invite code; connect a wallet, read‑only; hold **$100 of $SEND** (valued at the lower of the current price and its 24‑hour median, across every linked wallet, and not a net seller) for full access. Under $100 the account can still be made, and it stays read‑only until the wallets hold $100. Those figures are painted from `GET /api/gate/state` → `rules`, which reads `MIN_HOLD_USD`, `PROOF_COINS`, `PROOF_SELL_WINDOW_MS` and `PRICE_MEDIAN_HOURS` — the same constants the wallet check enforces (§3.15b).
3. **They can close it.** "No code? Keep browsing read‑only →" is on every step, Esc works throughout, and closing it puts them back exactly where they were. A door that cannot be walked away from is a wall.
4. They enter a code. **Each code works once.**
5. *(Hidden by default.)* A terms step — scroll to the end, twelve seconds — exists behind `TOS_GATE=1` for an operator who wants it; the site ships without it, and `need_tos` is only ever answered when it is on. (The 18+ tick that used to sit here is the age question above now.)
6. They make their account — the sign-in panel opens in **Create account** mode on both tabs. **Email:** a @username, the email and a password. **Wallet:** the **@username first**, then *optionally* an email + password as a second way in (sign in later with @username or email and that password, no wallet needed), then the wallet connects and signs once. Either way a box offers **"Set up two-factor right after (optional)"**, which lands them on Settings → Security with nothing asking for a password during their first hour. (Somebody who presses the wallet's plain *Sign in* with a wallet the site has never seen, ticket in hand, is asked for the @username instead of being given a placeholder: the server answers `needUsername` with a ten‑minute, single-use token, and naming the account costs no second signature. Both forms hash the password first and then run every gate and write in one transaction, so concurrent sign-ups cannot share a ticket or overrun the per-network cap. On **either** form, an email that already belongs to another account is not refused — a refusal told any ticket holder, as often as they liked, who is a member. The account is made anyway: it keeps its password, signs in with its @username, has no email until it sets one in Settings → Security, and the page says so. Learning that an address is in use therefore costs a whole account and a ticket, and it counts against the connection's ration of that answer (below): three per 30 days, after which sign-ups *with an email* from that connection pause, with the same refusal for every address.) Their **Send ID** — their place in line — is set at that moment and never changes. It is the user id: already monotonic, already unique, already means "how early you were", so a second counter would only be a way for the two to disagree.
7. They get **ten codes of their own**, shown immediately, one tap each to copy. They last as long as the account does: deleting it voids every code not yet used.

**Their codes live on their dashboard too** (`/profile.html#invites`), so "where are my codes" has an answer that is not "reopen the modal you closed". A code that has been used is shown there **for the record but cannot be copied** — the server withholds its characters entirely and returns only a two‑character hint plus who took it. There is nothing to copy: it will never work again, and handing someone a dead code is worse than handing them none.

**The ticket wears the site's own brand** — the green S‑rocket mark (`assets/logo-mark-sm.png`), the $Send wordmark, the acid green on matte black, and the matrix grid every control on the site carries. No coin's artwork is on it.

**The ticket is downloadable** — a 1200×630 PNG painted on a canvas (no library, same output on every browser) carrying the $Send lockup, "Ticket to Send 🚀", the holder's profile picture, their @handle, their Send ID, whether they are an invited or a founding sender (the inviter is not named on a picture made to leave the site — the ticket on screen still shows them), and the entertainment‑only disclaimer painted in, so a ticket shared on social carries it. It uses the brand's fixed green, not the reader's accent preference, because the picture leaves the site.

**Sharing it on 𝕏.** The share button opens the composer with the tagline already filled in and a link to your ticket page. Worth being exact about what is happening, because it is easy to overclaim: **X's web composer takes text and a URL and nothing else — no parameter at any version attaches an image.** The picture gets into the post the only way it can, by the link unfurling: `/t/<sendId>` is a page whose `og:image` is your own ticket card, and X fetches and renders it as a large‑image card. If you want the file itself to attach by hand, Download gives you the same picture.

**Nothing is published until you press the button.** `/t/<sendId>` and its card both 404 until you share, and un‑sharing takes them down again. What the page carries is only what is already public on your profile — handle, Send ID, join date. Not who invited you: the inviter never agreed to be named on somebody else's share, so neither the page nor the card names them (the card says only "INVITED SENDER" or "FOUNDING SENDER"). No wallet, no email, no balance, ever.

**The card is drawn by the server, not uploaded by your browser.** The obvious shortcut — render the ticket to a canvas and POST the bitmap up — would mean hosting an arbitrary user‑supplied image on this domain and putting it in a social card under our own name. Anyone could upload anything and hand out a sendrh.com link that unfurls it. So the card is drawn server‑side from your handle, your Send ID and your join date, with a small built‑in PNG encoder, a 5×7 bitmap font, a pixel rocket after "TICKET TO SEND", and the site's mark decoded once from `assets/logo-mark-sm.png` (a minimal PNG decoder; if the file cannot be read the card is drawn without it). And it lives at `/t/<id>.png`, **outside `/api/`** — `robots.txt` disallows `/api/`, and a crawler told to stay out of it will not fetch an `og:image` there, so the card would have rendered perfectly and never once appeared in a post.

**Where $SEND and $GWC prices come from.** Most prices on the site come from Dexscreener, which does not always list these two coins — it dropped both for a while in September 2026, and at the time of writing still does not list $GWC. So both are also read **from their own pools** (the Uniswap v2 pairs in `OG_PAIR`): a v2 pool's reserves *are* its price. Wherever Dexscreener has no answer — the home page cards, the tracker, Send Calls, communities, the Scanner — the figure comes from the pool, marked `source: 'reserves'`, and the home page says so under the card. Everything is read from the chain except one rate, ETH in dollars (CoinGecko, and only if read in the last ten minutes): price = quote reserve ÷ token reserve × ETH/USD; liquidity = both sides of the pool at that price; FDV = price × total supply; market cap leaves out tokens sent to the dead or zero address (as Dexscreener does); 24‑hour volume, buys and sells are decoded from the pool's Swap events. What only an index knows (5‑minute/1‑hour splits, artwork) is left empty rather than guessed.

The checks that pay out or open doors — the $100 hold, the OG badge, the hold streak, Send Power on a swap, the data‑key burn — use the **guarded** price instead (`guardedPriceUsd`): the lower of the live price and the pool's **time‑weighted median over the last 24 hours**, refused outright while the live price is more than 3× that median. The median used to be taken over hourly candles and needed six hours *with a trade* in the last day; these are quiet pools (three $SEND swaps and one $GWC swap that day), so it was nearly always "price unknown" and those checks stalled. The public node keeps no history, so the day is rebuilt from the pool's **Sync** events — a v2 pair emits one every time its reserves change, so between two Syncs the price is exactly the first one's, and a quiet day is a flat line with a well‑defined median. A pump has to hold for half the day before it moves that median at all. `/api/chain/pairs` also returns `checkPrices`, the guarded price for each coin right now.

**The brand proxy.** The ticket used to draw the $GWC banner from here; it now wears the site's own mark, and no page calls this route any more. It still works: the $GWC and $SEND artwork is served from `/api/brand/<token>/<header|logo>` rather than straight from Dexscreener's CDN, for three measured reasons: the CDN sends **no `Access-Control-Allow-Origin` header at all**, so a canvas that draws it is tainted and `toBlob()` throws — the download would break outright, not degrade; the assets are multi‑megabyte **animated GIFs** (the $GWC header is 4.6 MB) and every visitor pulling those from a third party is slow and tells that third party who looked at what; and one fetch can serve everyone. The proxy only ever fetches a URL our own token cache already vouched for, checks the bytes really are a raster image before serving them (never SVG, which is a script container wearing an image's extension), and caps what it will hold.

---

### 3.17 The hunt — a hundred hidden ghosts 👻

A hundred easter eggs are hidden across the site, and they are Halloween-themed: every find is a **hidden
ghost**. Finding one pays Send Power, and ghosts (with the odd 🎃, 🦇 and 🕸️) pop out of the spot it was found
at — where the last tap, click or hover was, or the middle of the screen for a typed word or a hash — then
float up and fade; each find has its own spooky line. Finding all hundred is the only thing on the site that
has seen more of it than the people who built it. (The code still calls them eggs: `eggs.js`, `/api/eggs`,
`easter_eggs`.)

**What an egg is.** A small, deliberate interaction that nothing advertises — a decoration that turns out
to respond, a word typed where no field is focused, a place reached by patience. `public/eggs.js` is the
engine (detectors, the claim call, the celebration); where each egg lives is registered per page. It is
not documented here on purpose.

**What the server owns.** Everything that involves a number. `POST /api/eggs/claim {id}` refuses anything
outside `1..EGG_TOTAL` (100), is a no-op on a repeat, sits behind the participation check (§3.15b) and
Read-Only Mode (§3.6) like every other write, and pays through `awardPoints` with a per-(user, egg) `ref`
so the points layer is idempotent too. `GET /api/eggs` and `gamifySummary().eggs` carry the count; the
constants ship in `rules` so the client reads them rather than copying them.

| | |
|---|---|
| `PTS.egg` | **20** base — between a follow (18) and a comment (24). A hundred is 2,000 base: Level 13 on the curve. Each egg pays once; a find made while the day's allowance is full is recorded and pays on a later claim — nothing found is ever burned. |
| `DAILY_CAP.egg` | **25** a day. That puts the kind inside the shared rolling-24h social budget (§3.1), so a script that reads the source and fires all hundred still takes four days and still cannot out-earn the day. |
| `easter_eggs` | `(user_id, egg_id, found_at)`, primary key on the pair. |

**Rules the eggs follow, because an egg that gets in the way is a bug.** None sits on a control's primary
job (the click still does what the control does). None needs money, a wallet or a purchase. Wherever the
trigger is an element, Enter/Space count as well as a click. Reduced-motion readers get the toast without
the ghosts. A find made while signed out is kept in the browser and banked on the next signed-in load,
so nobody loses one — finds banked that way are said once ("N ghosts you found earlier are banked now"),
not one toast each (a find made live meanwhile still gets its own ghosts). A find made while an allowance is
full — the 25-a-day, or the shared rolling-24h Send Power budget — stays recorded and unpaid: `GET /api/eggs`
lists it (`unpaid`, from the server's own records, never a browser list) and the page re-sends it at most
hourly, quietly unless it pays. For a ghost, `awardPoints` writes no zero-point row when the shared budget is
spent, so that ref can still pay later — "nothing found is ever burned" holds for both caps. A signed-in claim
the server refuses (rate limit, wallet check, network) is kept in the browser under that account's username and
re-sent on its next load. The "all 100" notification fires once, on the claim that records the hundredth. Who is signed in is the account's **username** (the page is never given its numeric id;
keying on the id, until September 2026, made every member look signed out, so their finds waited in the
browser — they bank on the next visit).

**Where you see it.** The power core on your dashboard shows `👻 N/100 ghosts`; the Quest Board lists the hunt;
the Loot Log names each find.

### 3.17b The tape — the transactions behind the line ⛓️

Every chart on the site carries a **Recent transactions** panel under it: the last 25 swaps on that pair,
newest first, with the time, the side, the token amount, what it was worth in the pool's quote, the address
the pool paid, and the transaction hash. The hash links to the block explorer and the address links to its
explorer page, so any row can be checked against the chain in one click.

**It costs no extra chain reads.** Every row is decoded from the same `eth_getLogs` Swap set the candles are
already built from. That is deliberate: the public chain RPC answers 429 after a handful of rapid reads, so a
per-row `eth_getTransactionByHash` — the only way to learn which key *signed* each trade — would rate-limit
the whole site the moment two people opened a chart.

**Whose address is shown.** A Uniswap-V2 `Swap` log names the contract that called it and the address it paid.
The tape shows the address that was **paid** — the trader's own wallet on many trades, a router or a bot
contract on others — and counts how many of the rows on screen went to the calling contract, so the note under
the table states that as a number rather than an impression. The transaction link shows who signed.

**The colours, each with its word beside it** (colour is never the only signal):

| Chip | Means |
|---|---|
| **new** (blue) | that address's first buy inside the window on screen |
| **up** (green) / **down** (red) | ahead or behind across all of that address's trades in the window, valued at the window's last price |
| **flat** (grey) | level across those trades |
| **no entry here** / **bag from before** (grey) | the window does not contain a whole entry price, so no profit is claimed |
| **contract** (grey) | the address paid is a router, an aggregator or the next pool on a multi‑hop route — not a person's own address, so no profit is attributed to it |
| **no price yet** (grey) | the window has no last price to value the position against |
| **address unreadable** (grey) | the swap log did not carry a readable address |

**What it refuses to claim.** A wallet that sold more tokens than it bought inside the window was spending a bag
acquired somewhere the window cannot see, at a price it cannot know — so its proceeds are not called profit and
the chip stays grey. Without that rule the biggest dumper on a tape renders as the greenest row on the page,
which is exactly the kind of invented number this project does not ship. The figures are before gas and before
any transfer tax the token itself charges, the note says so, and it prints the time the rows were read because
they do not follow the live price above them.

### 3.18 Reports, moderation and leaving 🧹

**Report a post.** Every post that is not yours carries a ⚑ control. It writes a row to a `reports` table with an
optional sentence from you; one report per person per post. Nothing is hidden automatically — a person decides.

**The moderation queue** lives at `/admin.html` and is for operators only: every `/api/admin/*` route answers 404 to anyone whose user id is not in `ADMIN_USER_IDS`, so for anybody else the page loads with an empty queue and a note that it is for the site operators (the page is `noindex` and disallowed in `robots.txt`). From it an operator can take
a post or comment down (a Send Call post keeps its call row — calls are permanent — and loses its words and
media), put an account in read‑only mode for a number of days or indefinitely, lift a restriction, or dismiss a
report. Every action notifies the person it lands on, with the reason, and is written to the report it resolved.
Behind Cloudflare, a takedown also purges the removed upload from the edge when `CF_ZONE_ID` + `CF_API_TOKEN`
are set; `/uploads` is cached a day at most either way.

**Deleting your account** is in Settings → Account. You type DELETE, prove it is you (password, or a signature
from a wallet already on the account, or your current second factor), and the account is closed: sign‑in
methods, sessions, profile, posts, comments, uploads, tracked wallets, points and notifications are removed and
you are signed out everywhere. Send Calls are permanent and stay under a placeholder name. A wallet that verified
an account for the participation check, or earned an OG badge, stays recorded (as a hash) so it cannot verify or
badge another account. **Invite codes the account had not given out are voided** — deleted, including one a friend
has redeemed but not yet used to finish signing up — so making an account and deleting it never leaves a supply of
working tickets behind; codes already used stay, as the record of who came in on them. (A boot-time repair voids the
unused codes of accounts deleted before this rule.) The [Privacy Policy](public/privacy.html) says exactly what stays and why.

## 4. How to participate — in 4 steps

1. **Get a ticket.** Someone already inside sends you one of their ten invite codes. You can read the whole site without one — you need it to make an account (§3.16).
2. **Get a wallet** and add Robinhood Chain (Robinhood Wallet supports it natively; any EVM wallet works).
3. 3. **Know what the wallet check looks for.** Doing anything here — posting, calling, reacting, voting, joining a community — waits behind a read‑only check that your linked wallets hold **$100 of $SEND** (§3.15b); $GWC is not part of that check any more. Holder status is judged per coin against the same **$100 floor** (§3.2.1): below it, a bag of $SEND or $GWC earns no holder status at all. Whether to hold anything is your decision — this site never tells you to buy. If you do swap, the how‑to‑buy guide covers the mechanics and the in‑page swap prefills the contract address — always verify it yourself first. Remember the **$100 hold floor** (§3.2.1): below it, a bag earns no holder status at all.
4. **Create your account** (wallet, email, Google, Facebook, X, or Instagram), connect your wallet read‑only, claim your unique @handle — then **send it.** Post on the Send Wall, join or start a **community** for a flat 10×, make and follow Send Calls, react and vote, track wallets, ride the New Pairs Radar, and stack Send Power.

---

## 5. Running it (technical)

- **Stack:** a zero‑framework Node.js HTTP server + built‑in `node:sqlite`. No build step. Frontend is vanilla JS under a strict Content‑Security‑Policy (`script-src 'self'`). Requires Node ≥ 24.
- **Start:** `node server.js` (serves `public/`, stores data in `data/`). **Deploying:** `DEPLOY.md` — section D is the Cloudflare setup the beta ships with (a tunnel, so the origin's address is never public), and `npm run live-check -- https://your.domain` probes a deployed origin for everything a launch can fail on.
- **Security & privacy (built in):**
  - **Encryption at rest.** Emails, wallet↔account links, OAuth subjects, 2FA secrets, tracked wallets, sign‑in nonces and tracker reports are stored **AES‑256‑GCM‑encrypted** under `DATA_KEY` (IP addresses are never written at all, encrypted or otherwise — the database holds only keyed hashes of them, see below), with HMAC blind indexes for the lookups the server needs (login by email, wallet by address). Session cookies are stored only as SHA‑256 hashes; passwords as scrypt hashes. The most sensitive fields are encrypted; a copy of the database without the key does not reveal emails, linked wallets or 2FA secrets. Public content (usernames, posts, the follow graph) is stored in the clear, because it is public on the site anyway. **Set `DATA_KEY` (64 hex chars) in production**; otherwise a key is generated once into `data/.data_key` (chmod 600) — back it up separately from the DB, and never lose it.
  - **Phishing‑resistant wallet sign‑in.** The message you sign is domain‑bound (SIWE‑style: it names this site's host, URI, chain ID, a one‑time nonce and an expiry) and the server only accepts the exact message it issued, so a signature harvested on any other site can never open a session here. 2FA confirmations are domain‑bound too.
  - **Two‑factor for everyone.** Authenticator app, wallet signature, or — for wallet‑first accounts that add an **email + password** (Profile → Security) — the **password as the second factor** for wallet sign‑ins. Changing or removing 2FA always requires the current factor — given at the change, or at the "confirm it's you" step within the last 30 minutes on that session; for wallet‑2FA only wallets linked *before* it was enabled count. Password two-factor always asks for the password itself, even in an unlocked window: arming a password you no longer remember would lock every way in.
  - **"Confirm it's you" once, then change what you like.** Every security change — adding an email or a wallet (the **first** wallet included), changing the password or the email, turning two-factor on or off, unlinking one wallet or disconnecting them all (two-factor on **or off**), minting a Data API key, deleting the account — needs proof that the owner is present: the **account password** (if it has one) **and** the **two‑factor step** (if it is on); a wallet-only account without two-factor signs with a wallet that can vouch for it (the founding wallet, or one linked more than a day ago). That proof is asked **once**, at the first such change (`POST /api/auth/verify`), and then unlocks this session's security changes for **30 minutes** (`sessions.sudo_until`, `SUDO_MS`, overridable with `SUDO_MINUTES`); `DELETE /api/auth/verify` (Settings → Security → *Lock now*) ends it early. **Signing in does not unlock anything** — so a session cookie lifted right after a sign-in is not already unlocked — with two exceptions: **the session that creates an account is unlocked for an hour**, so a new member sets everything up without being asked for the password they just chose, and a social-login account with no password, no two-factor and no wallet old enough to vouch is unlocked by signing in, because that is the only proof it has. The honest limit: a session cookie stolen *inside* an unlocked window can make those changes until the window ends — which is why it is short, never extended by use, and can be locked by hand. Any change to how the account signs in (2FA on/off/switched, an email added or changed) closes the window on every **other** session; and the possession proofs stay — arming a wallet as the second factor still takes that wallet's own signature, turning on an authenticator still takes a code from it. A refusal that only wants this step carries `code: 'need_verify'`, and the page opens the step and repeats the request once. "That email already belongs to another account" is a fact about somebody else, and there is no email the site could send instead, so wherever it has to come out — adding or changing an email in Settings, or a sign-up whose email was not added — it is **rationed: 3 per 30 days, counted per account *and* per connection** (`email_misses`, keyed by the account and by the connection's blind index, each row erased when its 30 days pass). Deleting an account and making another does not reset it. Once a count is spent, those doors refuse **before** looking the address up, with the same sentence for every address, free or taken. The honest limit: someone with many connections and many tickets can still ask, three times per connection per month.
  - Strict CSP (`script-src 'self'`), HttpOnly/SameSite cookies, per‑route rate limits, read‑only wallet connect (a free signature, never a transaction or approval).
  - **IP addresses are never stored**, only keyed hashes (`ipIdx`), and each hash lives exactly as long as the check that reads it (`sweepIpIndexes`): a Send Call's is erased a day after the 7‑day ring window, an account's signup hash after `SIGNUP_IP_KEEP_MS` (90 days — so the per‑network account cap counts the last 90 days), and membership, community and alert hashes go with the row they guard. Last‑sign‑in, vote and proposal IP hashes are not written at all. Behind proxies, an `X-Forwarded-For` shorter than `TRUST_PROXY` falls back to its outermost address, never to the proxy's own.
  - **The browser talks only to this site** (plus the chain RPC during a swap). Fonts are self‑hosted in `public/fonts` (licences beside them); token artwork is rewritten to the `/api/img` proxy at the JSON boundary (`send()`, Data API exempt); the tracker's explorer and price reads go through `/api/chain/explorer` (signed‑in, path allow‑list), `/api/chain/dex-tokens` and `/api/chain/pairs`. The explorer proxy needs `BLOCKSCOUT_URL` to be a keyed endpoint — the public host refuses servers.
  - **Uploads lose their metadata** before they are stored (`scrubMediaFile`/`scrubMediaBuffer`): EXIF/XMP/comments from JPEG (orientation kept), text/eXIf chunks from PNG, EXIF/XMP from WebP, comments and non‑loop application blocks from GIF; `udta`/`meta`/XMP boxes in MP4/MOV and `Tags` in WebM are blanked in place without moving a byte. A file that cannot be parsed is refused.
  - **Private on disk:** the server runs with `umask 077` and tightens existing `data/`, database, WAL, backups and a self‑owned `.env` to owner‑only at boot.
  - **Nothing public can name a wallet:** Send Call stakes are rounded to two significant figures for everyone but the caller, the Convicted‑In hover shows bands, notifications never quote wallet characters, and the swap ledger keeps a blind index of the tx hash. Account deletion erases handles, pictures, IP hashes, balances and the age record, and replaces the words of proposals already put to a vote.
  - **Data API keys** need the same ownership proof as any other security change to mint or rotate, and a password change, "end other sessions" or turning 2FA off resets the key's secret (the paid time is kept; rotate for a new secret).
- **Required in production** (see `.env.example` and `DEPLOY.md`): `DATA_KEY` (64 hex chars — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), `BASE_URL` (your real `https://` origin — it drives every canonical / og / twitter / JSON‑LD / sitemap / robots URL at serve time, the CSRF origin check, and OAuth callbacks), `COOKIE_SECURE=1` (Secure session cookies), and `TRUST_PROXY=<hops>` when behind a proxy — the number of proxies that append to `X-Forwarded-For`: 1 for Caddy/nginx alone or a cloudflared tunnel, 2 with Cloudflare proxying in front of Caddy/nginx; behind Cloudflare also set `TRUST_CF=1` so the visitor's address is read from `CF-Connecting-IP` instead of counted hops — `TRUST_CF` is only honoured when `TRUST_PROXY` is a positive hop count and the request comes from a trusted peer (`TRUST_PROXY_FROM`), so on its own it does nothing; otherwise every visitor shares a proxy's IP and the per‑IP rate limits + community anti‑sybil caps misfire. Node binds to `127.0.0.1` unless `HOST` says otherwise. `SEED_INVITE_CODE` is the first door's only key (unset, a random one is printed once at boot), and `ADMIN_USER_IDS` names who may use the moderation queue at `/admin.html`.
- **Optional environment variables** to enable extras (all off by default):
  - OAuth: `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET` (each provider's callback is `…/api/auth/<provider>/callback`).
  - `MOONPAY_API_KEY` for the fiat on‑ramp widget. `BACKUP_DIR` to move the daily DB snapshots (default `data/backups`).
  - `GOPLUS_KEY` / `GOPLUS_CHAIN` — holder counts and top-holder concentration come first from the site's own on-chain ledger (`holderLedger`/`indexHolders`: every Transfer event the token has emitted, folded into per-wallet balances and block-stamped, shown as `holders.source: chain`); until a token's ledger has been built they are shown from GoPlus Security (`goplus`), then the block explorer (`explorer`), and the panel labels which. Owner-power flags (mintable, pausable, blacklist, …), the honeypot flag and the verification flag come from GoPlus, which lists Robinhood Chain (4663) and answers keyless at 30 calls a minute; the explorer's verified source is read as a second opinion when it answers. A key raises that; nothing breaks without one. The readings are an automated scan, never an audit, and the panel says so.
  - `RPC_URL` and `BLOCKSCOUT_URL` — keyed chain and explorer endpoints. Both default to the public hosts, and both of those refuse a server at launch volume (the RPC 429s `eth_call` after a handful of rapid reads; the explorer answers 403 with a bot challenge), so on the defaults charts can fail intermittently and the on‑chain holder ledger builds slowly (it backs off and retries a 429, and a refused build resumes from its last block). What stays unknown is what only the explorer supplies: the deployer address, the verified‑source scan that runs when GoPlus reports no owner powers, and the tracker's `/api/chain/explorer` reads. **Wallet histories do not depend on it**: the participation check, OG badges, the data‑key burn, call sizing and conviction hold times read a wallet's transfers straight from the chain's `Transfer` logs when no keyed explorer answers (see §3.15b). Holder counts, top‑holder concentration and owner‑power flags still arrive from GoPlus, which needs neither variable.
  - `CF_ZONE_ID` + `CF_API_TOKEN` so a takedown or account deletion purges the removed upload from Cloudflare's edge (without them `/uploads` is cached a day at most). `TRUST_PROXY_FROM` to name which peers may speak for the client (default `loopback,private`).
  - `TELEGRAM_BOT_TOKEN` runs the Scanner as a Telegram bot anyone can add to their own group (`/scan <token contract address>`) — the same `lookupTokenPair` scan, the same verdict rules and the same refusal to guess as the site; a webhook when `BASE_URL` is a public `https` origin, long‑polling otherwise. Off unless set; see `DEPLOY.md` → Telegram scanner bot.
- **Backups:** the server writes one consistent snapshot per UTC day to `data/backups/app-YYYY-MM-DD.db` (SQLite online backup API — safe while running; the last 3 are kept when the snapshots sit inside `data/` beside the database, which is a rollback convenience rather than a real backup, and the last 7 when `BACKUP_DIR` is set to a path outside `data/`, meant for a separate volume; a day's snapshot is skipped rather than written when the backup directory's free space is under one extra copy of the database plus 500 MiB of headroom). **Restore:** stop the server, copy the snapshot over `data/app.db`, delete any `app.db-wal` / `app.db-shm` next to it, start. Copy `data/uploads/` separately (avatars, headers, post media).
- **On deploy:** the placeholder SEO domain is swapped for `BASE_URL` automatically — just set it, and register your OAuth callback URLs.

---

## 6. Community

- 🌐 [GenerationalWealthCoin.com](http://GenerationalWealthCoin.com)
- 💬 Telegram: [t.me/generationalwealthcoin](https://t.me/generationalwealthcoin)
- 🐦 X / Twitter: [x.com/sendrh_](https://x.com/sendrh_)

---

*Built for fun and community. Just $Send It. 🚀*
