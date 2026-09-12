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
| **New Pairs Radar** | A live, honest scanner of brand‑new tokens on Robinhood Chain with plain‑English risk flags (honeypot, dumping, thin liquidity, whale‑concentration, unverified contract, serial deployer) so you can spot traps. Three views: **📈 Best Runners** (the top **50** gainers among tokens holding at least **$300** of liquidity — the same floor decides whether a sighting is trustworthy enough to set a baseline or move a peak; 24h from real Dexscreener data, or 1W/1M/1Y/All from a persistent price‑history store, with windows longer than the tracked history honestly labeled "since Nd", and a **🔎 *since scanned*** chip giving the multiple from the earliest price we ever retained for that token, in the Send Call convention where +100% = 1x), **🎬 Hot Feed** (a full **100/100**, no tripped flag, enough data to judge, **and** a completed block‑0 scan that came back clean — four conditions, not one; a token with a perfect score whose sniper scan hasn't finished is held back rather than promoted), and **📋 DEX List** (every filter, plus a two‑press 📣 Send Call button on each row). A token whose name/symbol don't resolve on‑chain ("Unknown Token" / `???`) is withheld from every radar view, server‑side and client‑side. Every on‑chain detail body opens with a **live Dexscreener chart**. |
| **Conviction Plays** | Pin tokens you believe in to your public wall — by pasting a contract or from any token's detail. Each chip shows its **live market cap** and **how many Xs it's up since you convicted** (baseline captured at pin time); hovering shows, when a wallet is linked, how much you hold and how long (read‑only, on‑chain, coarsened for privacy). A 💎 conviction badge appears when you're a member of that token's community. |
| **Send Power (gamification)** | Earn points for nearly everything you do, level up endlessly (no cap — Level 100 = Biggest Sender, then Send Deity and beyond), and multiply it all with your Holder Boost and Diamond Hands. |
| **🕹️ Arcade — Rocket Run** | One free flight per UTC day on `arcade.html`. A rocket climbs at `e^(0.06·s)`; the crash point is rolled **server‑side at launch and never sent to the browser** until the round resolves. Cash out any time for a **Send Power boost** of `min(5, 1 + (x−1)/4)` lasting 24h; don't cash out before it blows and you get nothing. **Your daily go is spent at takeoff, not at cash‑out** — and a round left open for more than **5 minutes** is force‑expired ("the rocket flew off without you"), with no boost and no second flight that day. So don't launch and walk away. Nothing is at stake, nothing is for sale, entertainment only. |
| **⚡ Boost in the nav badge** | Your live boost rides in the same badge as your level: **Lv 12 · 1,683 · ⚡1.03×**. It repaints the moment a boost starts, and drops itself when one expires. |
| **🏆 Weekly community competition** | On `communities.html`: which community's members earned it the most points **this week** (Mon 00:00 → Mon 00:00 UTC, reset server‑side). Scored purely on activity inside a community — joins, posts, reactions, comments, and its members' Send Calls on its own token, each daily‑capped per member. **Market cap counts for nothing.** No prize, just bragging rights. |
| **📅 Daily check‑in** | The daily bonus is something you *do*: a check‑in button at the top of your own wall, idempotent per UTC day, with a live countdown to the next one. |
| **Dev‑wallet communities** | The wallet that deployed (or owns) a token can start that token's community **without holding any of it** — confirmed on‑chain from a linked read‑only wallet. |
| **Sign in your way** | Wallet, email, Google, Facebook, X, or Instagram. |

---

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

This is the heart of the game: **holding $Send and $GWC boosts every point you earn.** Your Holder Boost is one number, and it is the first term of a sum — every boost on the platform **adds** what it pays above 1× (`1 + (Holder − 1) + (OG − 1) + (Community − 1) + (Arcade − 1) + (Prize − 1)`); boosts never multiply each other:

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

**Liquidity gate.** A token needs **≥ $500 pooled liquidity** to be callable — thinner pools are rejected, so no one can farm points on a self‑made dust pool.

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

A genuine buyer who later takes some profit nets down to what they actually still put in, which is what "how much did you send into this coin" was always supposed to mean. And because a thin pool's owner sets its price, **the credited position can never exceed the pool's own liquidity** — a self‑made $600 pool pumped to a paper million credits $600, not a million. **The caller's size is captured once, at call time, and locked in** for that call's award (it fails open to $0 so it never blocks a call). *(The Senders list in this section re‑reads Senders' holdings on demand, throttled to at most once every ~5 minutes, so their "still holding" status stays current — the caller's own recorded size does not change afterward.)*

**The stack cap on the opening award: ×10 (`OPEN_STACK_MAX`).** However large your boost stack gets, the *paid* opening award is capped at **ten times the size‑scaled base**:

```
paid = min( callHeadroom, round(120 × sizeMult) × 10 )
```

So a caller with no on‑chain position (sizeMult ×1) can never be paid more than **1,200** for opening a call, and $1,000 held (×10) caps at 12,000 — no matter whether the stack behind it is 11× or 60×. Anyone in a live community (+9) plus one other boost is already past the bound. **The same ×10 cap applies to the "Send It!" award**, so a Send with no position pays at most 300. This is why the opening award is not the way to climb: the cap bites almost immediately, and the hold bonus does not have one.

**Per‑X milestone payouts: an additive ladder.** As your call actually runs, each **whole X** it crosses pays a rung, and the rungs climb in a **straight line, not by the X**:

```
rung(m) = round(170 × (1 + (m − 1) × 0.1))   →   170 + 17 × (m − 1)
```

1x → **+170**, 2x → **+187**, 3x → **+204**, 10x → **+323**, 20x → **+493**, 50x → **+1,003** (ladder caps at 50x). All fifty rungs together come to **29,325 base** — about **13%** of the ladder's own 30% slice of a call's budget (221,288). That headroom is the point: the ladder is deliberately *not* where a call's Send Power lives, because paying by the X would hand a single lucky 50x more than twenty patient calls. Holding in profit is the main event (below). No daily cap on the ladder (it's pure performance), but every payout draws on the call's lifetime budget (§3.1). Each milestone pays once, ever, and only on a price **sustained** across two samples with live liquidity still ≥ $500 — a single wick can't pay.

**Diamond‑hands HOLD bonus — the main event.** While your call stays in profit, you keep earning a **super‑linear** bonus:

```
holdX  += min(hoursSinceLastTick, 0.5) × min(currentX, 50)     ← the integral
owed    = min(750000, 2 × holdX^1.5 × crewBonus)               ← the payout
```

It is deliberately where most of a call's Send Power lives: of the per‑call lifetime budget (§3.1), the opening award may take at most 10% and the milestone ladder at most 30% cumulatively, so **at least 60% is reserved for holding in profit**. (`HOLD_MAX` = 750,000 base is a backstop the budget always reaches first.)

**Two clamps inside the integral.** Height above **50X** credits nothing extra, and at most **30 minutes** of holding is credited per sweep tick — so a long gap between price samples is not back‑credited. "Compounds with height and duration" is true up to those two bounds, not beyond them.

**Crew factor — applied to the payout, not the integral.** The bonus is larger when the people who Sent It on your call are also in profit from *their own* entry: `rate = 1 + 0.1 × (Senders in profit with ≥ $20 of their own in the token)`, capped at **3×** (twenty profitable Senders — real positions, not taps). It multiplies `owed` **after** the `^1.5` exponent, which matters: folded into the integral instead, a 3× crew would really have been worth 3^1.5 ≈ 5.2×. A conviction play that carries other people with it is worth more than a lonely one — but by 3×, not 5×.

It accrues **only while the pool is liquid and the price is above your entry** (underwater or drained ticks earn nothing and are never back‑credited), and pays out once at least 20 points are owed.

**⚠️ The honest caveat: "holding" here means the *price* holds, not that *you* do.** The accrual reads the call's current price against its entry and nothing else — no code path re‑reads the caller's wallet after the call is opened, and the recorded position size is written once at call time and never updated. A caller who sells their entire bag keeps collecting the diamond‑hands bonus for as long as the price stays up. The name describes the pattern it rewards, not a verified fact about the caller. Your *size* at call time is spoof‑proof; your continued holding is not checked.

**Send It! — following a call.** Tap **"Send It!"** to Send It on someone else's call: base **30**, scaled by *your* Send size and Holder Boost (and capped at **10×** that size‑scaled base, exactly like the opening award), capped at 30 Sends/day. Points pay only on your **first** Send per call; you can't Send It on your own. Your Xs are measured from the price when *you* Sent It, and **Senders earn a diamond‑hands HOLD bonus of their own** — the same shape as the caller's, on a smaller scale and without the crew factor: a Sender's hold accrual gets **no crew bonus** (only the caller's does), and it is paid against a budget of **184,407** (a quarter of the caller's) with a per‑event ceiling of **18,440**.

**One paying Send per token, not per call.** If you have already Sent It on *this same token* through some other call, the new Send is recorded but **earns nothing and never accrues a hold bonus** — it is stored with no entry price and zero size. You still appear on the senders list; you just don't get paid twice for the same position. Without this, one token called by ten people would be ten payouts for a single buy.

**The senders list.** Each call shows who's behind it, ranked by conviction: `$ put in × (1 + days held) × (1 + your Xs)`. Anyone **not holding** any more drops below every current holder. Top 3 show inline; "Show all" pulls the full ranked list.

### 3.5 Daily Call Limits & keeping it fair

**The dynamic earned limit (base 5, floats 1–5).** Everyone starts with 5 calls/day over a rolling 24h. That earned number floats on the quality of your matured calls (judged once ≥24h old): at least one **doubled** (peak ≥ 1x) → **+1** (cap 5); only duds → **−1** (floor 1). One step per day; even a persistently bad caller always keeps at least **1**.

**Diamond boost: ×2^level.** Your earned limit is multiplied by 2 to the power of your Diamond level (Lv0 ×1 … Lv10 ×1024). Spoof‑proof, and pauses if your holdings go unverified for 26h.

**The RUGGED penalty (−2).** If a token you called started with real liquidity but its pool later **collapses below $100**, the call is permanently marked **💀 RUGGED**, and your daily call limit is **docked by 2** (floored at 1), with a notification. Fires once per call, only on a definitive on‑chain read below $100 (a failed fetch never triggers it). Between $100 and $500, all point‑crediting simply pauses.

**The no‑DYOR flag.** Post a call **without first opening that token's full on‑chain detail** and it's stamped: *"⚠️ Not researched — the caller made this call without opening the token's full on‑chain details first. DYOR."* (A client‑side session flag reflecting UI interaction, not a server‑verified fact.)

**Spam trap.** Burn your *entire* daily allowance within **60 minutes** (only if your limit is ≥3) and you're flagged for spamming, which puts you into Read‑Only Mode (§3.6). There's also a hard rate limit of 10 calls per 10 minutes.

### 3.6 Read‑Only Mode & redeeming with $Send

Tripping the spam trap mutes your account, escalating with each **distinct** offense: **1st → 24 hours**, **2nd → 1 week**, **3rd+ → permanent**.

**Strikes are for life.** The counter only ever increments — nothing ages it out, forgives it, or resets it, and there is **no appeal endpoint and no admin who can lift a restriction**. Three offences years apart still land on permanent. The only route back is buying your way out (below), which is why that path exists at all.

**Blocked while muted:** making calls, Sending It, posting, commenting, reacting, voting, following, tracking wallets, customizing. Also blocked, though the in‑app list doesn't enumerate them: minting a Data API key, flying Rocket Run, starting a community, joining one, posting in one, and opening or voting on a community proposal. **Still allowed:** **the daily check‑in**, buying & holding $Send/$GWC (your Holder Boost keeps compounding), swapping (points still count), connecting/refreshing a wallet, and browsing everything. *(Connecting works, but the **150‑point connect award is withheld** while you're restricted, and linking a wallet mid‑restriction raises your redemption baseline to whatever it already holds.)*

**The check‑in stays open on purpose.** Read‑only pauses what you can *make*; it does not lock you out of protecting what you already earned. Since the check‑in is the switch that stops the escalating absence decay (§3.6b), gating it would have turned a mute into a compounding penalty a muted account could do nothing about — a different and much harsher thing than pausing posting.

**A mute still costs points, just not runaway ones.** While restricted you're charged a flat **+1.0 percentage point** of Send Power per day, and — unlike every other decay component — **checking in does not cancel it**. That's what keeps the restriction a penalty rather than an inconvenience. But it is *all* you pay: check in daily and your absence streak stays at zero and your underwater calls cost nothing, so the bleed is a steady 1%/day instead of climbing to the 4% ceiling. Ignore the site while muted and both components stack.

**Redeem with $Send — buy your way out early.** Any restriction can be lifted by **buying and then holding** enough $Send, verified on‑chain:

| Restriction | Cost to redeem |
|---|---|
| 24‑hour mute | $25 of $Send |
| 1‑week mute | $175 of $Send |
| Any timed mute | $25 per 24 hours |
| Permanent mute | flat **$1,000** of $Send |

Only $Send you buy **after** your baseline (recorded when the restriction was applied, or on your first redeem tap if no wallet was linked) counts — a pre‑existing bag can't fake a buy, and pricing is fail‑closed (no price ⇒ no redemption).

**Post‑redemption probation — hold, or it comes back doubled.** Lifting a restriction starts a hold: keep the $Send you bought for the restriction's own length (timed) or **40 days** (permanent). "Sold" = dropping >2% below the balance floor. Sell during a **timed** hold → it returns with the **timer doubled** (and the next buy‑out costs double); sell during a **permanent** hold → back to permanent. Hold to term and it's fully cleared.

**How a sell is caught, precisely.** A background sweep every **5 minutes**, plus a throttled recheck (at most once a minute) triggered by exactly two actions: **making a Send Call** and **joining a community**. Posting, commenting, reacting, voting, following, tracking and customizing do *not* trigger it — so in practice the 5‑minute sweep is what finds most sells.

**During probation, an unreadable wallet counts as a sell.** If the sweep cannot read your balance — you unlinked the wallet, or the read fails — it is treated as a balance of zero and the restriction comes back (doubled if timed, permanent if it was permanent). This is the opposite of how the OG badge behaves, where an unreadable read merely *pauses* the badge and is retried. Probation is deliberately fail‑closed: it's the one place where "we couldn't check" resolves against you, because it is the exit from a penalty rather than an entry to a reward. **Keep the wallet linked for the whole hold.**

### 3.6b Send Power decay — the score is a stock, not a trophy 📉

Send Power is **not** a permanent record of what you once did. It is a balance, and it **drains every day you don't show up**. Levels can go *down*. The design goal is that a leaderboard reflects who is playing now, not who was early — a number that only ever climbs makes an inactive Level 90 permanently outrank an active Level 60, and after a year the board stops meaning anything.

**One drain per UTC day, per account.** A background sweep runs every **5 minutes** and takes up to **200** accounts whose next decay stamp has come due. System accounts are exempt.

**The daily rate is a sum of three things, then capped:**

| Component | Rate | When |
|---|---:|---|
| **Absence** | **0.4%** on the first day past grace, **+0.2 points** per further consecutive day away | Only after **2 consecutive days** (`GRACE_DAYS`) with no check‑in — two days off costs nothing |
| **Read‑only** | **+1.0 point** | Every day the account is muted (§3.6) — the **only** component a check‑in does not cancel |
| **Bad calls** | **+0.3 points** per call currently **underwater**, up to **+1.5** | Any of your calls whose current price is below its entry |
| **Ceiling** | **4%** in one day, total | However long you've been gone |

So: away 3 days → 0.4%. Away 7 days → 1.2%. Away 21 days → 4% (the cap). Away *and* muted *with* three sinking calls → the cap, immediately.

**What stops it.** A **daily check‑in** — and nothing else. Holding coins doesn't stop it; neither does a high level. **Anyone can check in, including a muted account** — read‑only pauses what you can *make*, not your ability to defend what you already earned.

**It stops two of the three components.** A check‑in inside the last 24 hours sets your absence streak to zero *and* skips the underwater‑call charge entirely, so on a day you show up those cost you **nothing**. The bad‑call rate only ever applies on a day you were *already* away: a call that went down is a market outcome, not misconduct, and billing someone daily for one while they are actively participating would be a far harsher rule than the one intended.

**The read‑only charge is the exception.** It is the one component a check‑in does **not** cancel — while restricted you pay its flat 1.0 point per day regardless. A penalty that stops costing anything the moment you tap a button is not a penalty. But it is *all* you pay if you keep showing up: a steady 1%/day, instead of that plus an absence rate climbing toward the 4% ceiling.

**Old bad calls never stop counting.** The underwater count is `cur_price < entry_price` over *all* your calls, and since nothing ever closes a call, one you made a year ago that never recovered still adds its 0.3% to any day you're absent. It costs nothing on a day you check in.

**Two clocks, deliberately.** Decay is held off by a check‑in within a **rolling 24 hours**, while the 60‑point award is once per **UTC calendar day** — so a late‑night check‑in still protects you even after the calendar day turns.

**Floors, so it can't wipe you out.** Balances at or below **5,000** are never touched, and the drain is `min(balance × rate, balance − 5,000)` — decay can take you down toward the floor but never through it, and never negative. If the computed drain is **less than one whole point** it takes nothing rather than rounding up.

**It is on the record.** Every drain writes a negative row to your points ledger (`kind: 'decay'`) and sends you a **📉** notification, so a drop is always explained and always auditable. Nothing happens silently.

**What decay does *not* touch:** your Holder Boost, Diamond level, OG tier, badges, community memberships, or any call's recorded history. It only ever moves the points balance.

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
| 🎯 Block‑0 snipers sold out | 28 | The wallets that bought in the pool's very first block have since dumped |
| 🎯 Block‑0 snipers took a big share | 14 | Those first‑block wallets took a large share of the float |

**Triage:** ≥70 "Looks OK" · ≥40 "Caution" · ≥15 "High risk" · else "Avoid." Anti‑greenwashing: if any high/critical flag trips, a token can *never* show the green tier. Four sub‑scores (Liquidity · Holders · Trading · Contract) each get a letter grade to show *how* the score was reached.

**Safety filter** — three views, and **Safer** is the default on every visit (never persisted, so protection is always the arrival default): **🛡️ Safer** shows a token only if it's **not risky and scores ≥ 75** (honeypot/serial‑deployer tokens are *always* hidden there); **🌐 All** shows everything *except* tokens flagged risky or with too little liquidity to trade; **☠️ Risky** shows only those hidden ones, so nothing is ever silently unreachable.

**Watchlist:** save up to **500** tokens, each with the same live score/flags. **Read‑only wallet tracker:** track wallets and get a browser‑computed PNL report (average‑cost basis, realized + unrealized) — it never signs, sends, or moves funds. If the explorer's balance read fails, the report says so instead of quietly showing $0. 10 wallets free; a fresh $GWC diamond‑holder at tier ≥1 unlocks `min(1000, level × 100)`. It reads a bounded history and flags "PNL is partial" for very active wallets — an approximation, not accounting.

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
- A community **goes LIVE once 10 members opt in — and only real holders count.** To start, join, or post in a community you must **hold that community's own token**, verified on‑chain from a linked (read‑only) wallet. On top of holding, **no more than 2 counting opt‑ins per network address** (the starter's own network is excluded). Holding is an **ongoing** requirement, not a one‑time check: a background sweep re‑reads qualified members' balances and **revokes their qualification + the 10×** if they sell or move the tokens out — so you can't qualify once and keep the boost forever. **The sweep's real throughput:** every **10 minutes** it takes the **40** least‑recently‑checked qualified rows **site‑wide** (not per community), oldest first. So revocation is certain but not instant — across a large site a given member is re‑read on the order of hours, not minutes.

**Who can see vs. who can post**
- **Anyone can read a live community's wall** — click any community card and browse its posts, photos, GIFs and videos without an account.
- **Only members can post.** Posting requires opting in, and opting in requires **connecting a wallet and confirming on‑chain that you hold the community's token**. Members post exactly what the Send Wall supports — text, **photos, GIFs and videos** — through the same compressed, streaming upload pipeline.

**The 10× multiplier (Send Power bonus)**
- While you're a qualified member of **≥ 1 live community**, **a flat 10× community boost is added to every point you earn** — applied in the same `awardPoints` path as everything else, on top of your Holder Boost and OG bonus. The full sum the server pays is `base × (1 + (HolderBoost − 1) + (OG − 1) + (Community − 1) + (Arcade − 1) + (Prize − 1))` — boosts add, they do not multiply, so OG Gold 10× plus a community 10× is 19×, not 100×. Every action you take **inside a community** (posting, reacting, commenting on its wall) earns Send Power at that 10×, and your dashboard shows the bonus as an achievement you can unlock.
- It's a **flat 10×** — being in five live communities is still 10× (it doesn't stack with itself).

**Founder bonus** — when a community reaches 10 members and flips to live, its starter earns a **one‑time founder bonus** of **+15,000 base Send Power**, run through the normal multiplier path like any award — but it hits the per‑event ceiling almost immediately: 15,000 × 10 would be 150,000, and no single award may exceed **73,762**, so a founder who is in their own live community is paid **73,762**, an effective ×4.92. A Holder Boost or OG tier on top of that adds **nothing** — the ceiling is already binding. It's **once per account, ever** — the dedupe key is the founder's user id, not the community, so starting and growing a second community pays nothing. (Community creation is capped at 3/day, so without this one person could farm the bonus.)

**Members & member levels** — every community page lists its members (**up to 200**, so a very large community does not show every one), ranked by their **community member level** (the conviction level below), with the top three medalled and the starter crowned 👑. Participating raises your own member level *and* contributes XP to the community itself — so an active member is literally what levels a community up.

**Community level (exponential curve)** — a community earns XP when its **distinct members** are active on its wall (join, post, react, comment). XP is **daily‑capped per community** *and* **capped per member per day** (so a single spammer can't level it), and only accrues while the community is **live**. The exact ceilings: **250 XP per member per community per day**, and per community per day a cap on the *number of awards* of each kind — **400 posts, 300 reactions‑received, 200 comments, 200 Send Calls**. Its level uses the same `levelForXp` curve as personal levels. The most active communities (a time‑decayed activity score, ~12h half‑life) float to the top of the grid.

**Conviction (per member, per community)** — your **member level** (your "conviction") in a community rises **only when you do something there**, never for elapsed time. There is no timer or sweep that accrues conviction for months held; every point comes from an action, at these rates: **join 40**, **post 20**, **Send Call 30**, **comment 6**, **reaction given 2** (daily‑capped at 150 conviction XP/community/day). Staying a member without participating leaves your conviction exactly where it was. It surfaces as a **💎 Lv N badge next to that token** in the **Conviction Plays** section of your public wall, titled Newcomer → … → Ride‑or‑Die.

**Making a Send Call from anywhere** — the floating ✏️ button's **📣 Send Call** tab takes a pasted contract address, resolves it on-chain (symbol, name, market cap, liquidity) and posts the call. The button stays disabled until the token resolves and clears the **$500 liquidity** floor, it shows how many calls you have left today, and a "see the full on-chain detail first" link opens the same token popup used everywhere else — calls made without opening it are flagged on your wall, exactly as they are from the radar.

**Losing and regaining your verified slot** — the 10‑minute holder sweep (or disconnecting your wallet) flips a member who no longer holds the token to *unverified*: no posting, no 10×, and the go‑live count drops by one. It is not a dead end: buy/relink and tap **↻ Re‑verify holdings & opt back in** on the community page — the same membership row re‑qualifies (your member level is untouched, and nothing is paid twice). If you hold but a verified slot is blocked by the anti‑sybil caps (≤2 verified opt‑ins per network; the starter's own network never counts), the page says so instead of pretending you're in.

**The official communities** — `$Send` and `$GWC` are seeded as **official** communities owned by the site's own `@JustSendIt` account (a system account: it never ranks, never posts, never earns). They are live from day one, pinned in their own strip at the top of the Communities page on every tab, and join exactly like any other community (hold the token → opt in → 10×). They exist so a first‑timer can *see* a working community before starting one.

**Viewing vs. participating** — anyone, signed in or not, can open any community and read its wall, members and stats. Opting in (and therefore posting, reacting, commenting, and the 10×) requires connecting a wallet — a free, read‑only signature — and holding that token on‑chain.

**Tokens in posts** — a pasted contract address is looked up on‑chain when the post is saved and rewritten to its `$TICKER`; the post keeps a small token map, so every `$TICKER` renders as a chip that opens the token detail popup (with the community tag inside). `$SEND` / `$GWC` mentions always resolve. Unresolvable addresses stay as typed (shortened, with a copy button).

**Muting (user‑side moderation)** — on anyone's public profile: **Moderation ▾ → Mute @name**. The server then drops their posts, calls and comments from *your* Send Wall, community walls and comment threads; wherever they still appear (leaderboards, member rosters, someone else's call, notifications) their name renders **red with a 🔇** that opens an unmute popdown. Mutes are private (the muted person is never told), instant, and reversible. Their own profile stays viewable if you open it — you chose to.

**Posting from a community page** — once you're a qualified member, the floating ✏️ *Send it* button posts to *that* community's wall (it scrolls to and focuses the community composer). Anywhere else — or on a community you haven't joined — it opens the global Send Wall composer and, after posting, offers a *View on the Wall* link instead of yanking you off the page.

**Honest residual risks / limitations**
- The anti‑sybil gate is **on‑chain holding of the community token + a ≤2‑per‑network cap + continuous re‑verification**, not proof‑of‑personhood. A determined actor could still buy the token across several funded wallets and rotate IPs to manufacture a go‑live — but it now costs **real, sustained capital** (the sweep revokes qualification the moment the tokens leave a wallet), not a free throwaway account. **A slot that counts needs $100 of the token** (`MIN_COMMUNITY_HOLD_USD`, which is the site‑wide `MIN_HOLD_USD` floor of §3.2.1), verified on‑chain, so ten qualified members is **$1,000** of standing exposure — not ten dust balances. Creating a community takes the same $100. The tiny `OG_DUST_WEI` floor is only the fallback used when no USD price is available. Qualification is re‑verified continuously for **pending** communities as well as live ones, so a single bag can no longer be walked through ten accounts to tip one live.
- Going live is **one‑way** — leaving a live community never un‑lives it and never claws back the founder bonus.
- Market stats on community cards are cached (~45s refresh) and are **display only** — nothing about a community implies the token is safe or a good buy. **Most tokens go to zero.**

---

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

### 3.11 OG tiers — being early, three ways 🏅

Hold **both $Send and $GWC**, bought from the market, and keep holding both: you earn a **permanent OG badge** and a Send Power boost that adds on top of everything above. There is **one standard**; only *when* you got in changes the size.

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
- **Each bag is worth at least $100** at the moment the badge is granted (`OG_MIN_HOLD_USD = MIN_HOLD_USD`, the §3.2.1 floor, checked against the live price of *both* coins independently). Buying inside the window and keeping $10 of each earns nothing — the badge is meant to sit behind a real position, not a dust balance kept alive to hold a tier.
- **One badge per wallet, ever.** The tier is a statement about a wallet's history, so a wallet that has already earned OG for one account can never earn it again for another (`og_claims`). The claim is deliberately *not* released when the wallet is unlinked — otherwise link → claim → unlink → relink on the next account would clone the badge, and its 10× multiplier, without limit.
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

- One read feeds every card: `GET /api/competitions` (`server.js`, `competitionsPublic()`), whose public half is cached for 8 s like the boards it is built from; the per-user blocks (your rank, your prize, your flight) are computed per request. Nothing on the page is typed in — every ladder, window and date is the constant the server enforces.
- Rocket Run appears as **today's totals only** (flights, cash-outs, best cash-out, pilots boosted right now) — never who flew.
- The community race lists the sandbox when it scores, marked `🧪 Sandbox · stock, not a token · no 10×` with the not-affiliated line under the board; the Biggest Sender `top` uses the payout's own predicate (rank ≤ 10, so a tie at #10 is inside) and the podium/list split is positional, so a shared rank in the top three never drops a row.
- Movement chips (▲2 · ▼1 · NEW) compare a board with the one *this browser* saw the last time the page was opened, from `localStorage`; they are labelled as "since your last visit" and never claim anything the server did not rank.
- The page re-reads every 45 s while visible, ticks its clocks from the server's own clock, and re-renders only when something moved — never while an ⓘ tip is open or while your focus is inside a board. Confetti fires once a week, only if you open the page sitting inside the prize places.
- Accessibility: podiums are ordered 1-2-3 in the DOM and arranged 2-1-3 only visually; every board is a labelled list; countdowns are plain text; the live region announces only real changes (a new top three, or your own rank); reduced motion turns every animation off.

### 3.14b The Send Calls board — how the weekly caller race is scored

The Arcade's Send Calls card ranks **callers**, not calls, over a rolling window (24h / week / month / all):

- Your score is the **sum of every call's peak X** in the window, each capped at **50x** so one freak run can't decide the board.
- Ties break on your **single best** call's peak X.
- Only calls opened inside the window count, and only ones whose pool had **≥ $500** liquidity at call time.
- The board shows the **top 25**.

Peak, not current: the board measures how high your calls got, so a call that ran and retraced still scores what it reached.

### 3.14c The Support board — a help desk, not the wall 🛟

`support.html` is the same posting machinery pointed at a separate room (`posts.board = 'support'`), and the difference that matters is economic: **asking, answering and voting there earn no Send Power at all.** The post award sits behind a check that the post has no board, so support questions pay nothing — deliberately, so nobody farms points by asking questions nobody needed answered, and so the sort order reflects what people actually want answered.

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

**You can make an account with nothing but an email.** No wallet, no signature, no coins. You can read every page, check in daily, and keep your Send Power decay at bay.

**You cannot *do* anything until a wallet proves you are actually here.** Posting, Send Calls, Sending It, comments, reactions, votes, following, tracking, customising, joining a community — all of it waits behind one read-only check. The moment you try, the check opens over whatever page you were on, and it explains itself rather than just refusing.

**Three tests, run across every wallet you have linked, against the chain:**

| | The test | Why it is that and not something else |
|---|---|---|
| 1 | **You hold $100+ of $SEND and $100+ of $GWC** | Priced live, both coins, right now. The same `MIN_HOLD_USD` floor Diamond status uses (§3.2.1) — the site has one definition of "you actually hold this", not two. **Dust does not count.** |
| 2 | **You have held them for over a week** | Measured from your earliest *market* buy across your wallets. Bought this morning is not conviction, it is a ticket price. |
| 3 | **You are not a net seller** | Of the tokens that moved between you and the market, no more went out than came in. |

**On test 3 and the tautology.** `ogScan`'s own comment argues that "bought more than you sold" is circular, because Σin − Σout *is* the balance — and for *total* flows that is exactly right. This asks a different question: of the tokens that moved between you and **the market**, did more come in than went out? That is not the balance, because tokens also arrive from a friend, an airdrop, or another of your own wallets. Two cases show the shape is right:

- **gifted 100, never sold** → bought 0, sold 0 → `0 ≤ 0` **passes.** They hold, and have never sold a thing.
- **gifted 100, sold 90** → bought 0, sold 90 → **fails.** They are a net seller. That is the entire point.

**What the $100 means on these coins.** $GWC's whole supply is 1,000,000,000 tokens at roughly an $11,650 FDV, so **$100 is about 0.86% of every $GWC there is** — no more than ~116 wallets can clear that bar at the same time. ($SEND is looser: $100 is ~0.027% of its 10,000,000,000 supply, so ~3,763 wallets.) That is a deliberate choice made with the arithmetic in hand: this is a small, early community by design, not a round number picked without checking what it buys.

**It is not a punishment, and it is not worded like one.** Read-Only Mode (§3.6) is a sanction with strikes, an escalating ladder and a buy-out. This is a new account that simply has not shown its hand yet. Same enforcement point in the code (`blockReadOnly`), deliberately different answer: `needsProof`, never `readOnly`.

**The check runs in the background, and says so.** A full scan walks your entire transfer history for both coins against an explorer that rate-limits hard — it cannot run inside a button press, so it is queued and the page watches it. A restart re-opens anything left mid-flight; a stale claim is never believed.

**A chain we cannot read is never a refusal.** If the explorer times out, or a price cannot be read, nothing is decided and the door stays exactly where it was. The site says "nothing has been decided — try again in a minute", because that is the truth.

**Everything about it is read-only.** You sign a sentence (`personal_sign`) to prove the wallet is yours. That signature moves nothing, approves nothing and costs no gas. This site never calls `eth_sendTransaction` — it cannot send your funds anywhere, and it never asks your wallet to.

**Once you pass**, your profile is yours to make: claim your handle (required, once), add an email and password (**optional** — a wallet-only account is a complete account), turn on two-factor (**optional**), and link more wallets (**optional**, and all of them read-only).

### 3.16 The ticket — reading is open, joining is by invite 🎟️

**You do not need anything to read this site.** The landing page, the Send Wall, the New Pairs Radar, the Arcade, profiles, Send Calls and the terms are all open to anyone, signed in or not, crawler or person. That is deliberate and it is load‑bearing: this site's whole SEO surface — every canonical, every sitemap entry, every `og:` tag — only means something if the pages behind them can actually be fetched.

**You do need a ticket to JOIN.** An invite code is required at exactly three doors, the three that can create an account:

| Door | Where |
|---|---|
| Email + password sign‑up | `POST /api/auth/register` |
| A wallet signing in for the first time | `POST /api/auth/wallet/verify`, new‑account branch |
| Google / Facebook / X / Instagram, first time | the OAuth callback |

All three call one function (`signupRefusal`), and nothing else on the site calls it. It answers one of three things: `need_invite`, `need_tos`, or `code_spent` — machine‑readable, so the client turns a refusal into the ticket rather than an error message.

**How it works for a person:**

1. They browse. Nothing is in the way.
2. They tap **Sign up** — from anywhere on the site. The ticket opens over the page they were on.
3. **They can close it.** "No code? Keep browsing read‑only →" is on every step, Esc works throughout, and closing it puts them back exactly where they were. A door that cannot be walked away from is a wall.
4. They enter a code. **Each code works once.**
5. They read the terms. The box unlocks when the text has been scrolled to the end *and* twelve seconds have passed — jumping to the bottom is not enough. **18+ is a separate tick**, because the terms assert it and nothing was otherwise asking.
6. They make their account. Their **Send ID** — their place in line — is set at that moment and never changes. It is the user id: already monotonic, already unique, already means "how early you were", so a second counter would only be a way for the two to disagree.
7. They get **ten codes of their own**, shown immediately, one tap each to copy.

**Their codes live on their dashboard too** (`/profile.html#invites`), so "where are my codes" has an answer that is not "reopen the modal you closed". A code that has been used is shown there **for the record but cannot be copied** — the server withholds its characters entirely and returns only a two‑character hint plus who took it. There is nothing to copy: it will never work again, and handing someone a dead code is worse than handing them none.

**The ticket is downloadable** — a 1200×630 PNG painted on a canvas (no library, same output on every browser) carrying the holder's profile picture, their @handle, their Send ID, who invited them, the live Gold OG countdown, and the entertainment‑only disclaimer painted in, so a ticket shared on social carries it. The $GWC banner across the top is the coin's own Dexscreener artwork, served through **this site's** brand proxy rather than the CDN — see below.

**Sharing it on 𝕏.** The share button opens the composer with the tagline already filled in and a link to your ticket page. Worth being exact about what is happening, because it is easy to overclaim: **X's web composer takes text and a URL and nothing else — no parameter at any version attaches an image.** The picture gets into the post the only way it can, by the link unfurling: `/t/<sendId>` is a page whose `og:image` is your own ticket card, and X fetches and renders it as a large‑image card. If you want the file itself to attach by hand, Download gives you the same picture.

**Nothing is published until you press the button.** `/t/<sendId>` and its card both 404 until you share, and un‑sharing takes them down again. What the page carries is only what is already public on your profile — handle, Send ID, join date, who invited you. No wallet, no email, no balance, ever.

**The card is drawn by the server, not uploaded by your browser.** The obvious shortcut — render the ticket to a canvas and POST the bitmap up — would mean hosting an arbitrary user‑supplied image on this domain and putting it in a social card under our own name. Anyone could upload anything and hand out a sendrh.com link that unfurls it. So the card is drawn server‑side from your handle, your Send ID and your join date, with a small built‑in PNG encoder and a 5×7 bitmap font. And it lives at `/t/<id>.png`, **outside `/api/`** — `robots.txt` disallows `/api/`, and a crawler told to stay out of it will not fetch an `og:image` there, so the card would have rendered perfectly and never once appeared in a post.

**The brand proxy.** The $GWC and $SEND artwork is served from `/api/brand/<token>/<header|logo>` rather than straight from Dexscreener's CDN, for three measured reasons: the CDN sends **no `Access-Control-Allow-Origin` header at all**, so a canvas that draws it is tainted and `toBlob()` throws — the download would break outright, not degrade; the assets are multi‑megabyte **animated GIFs** (the $GWC header is 4.6 MB) and every visitor pulling those from a third party is slow and tells that third party who looked at what; and one fetch can serve everyone. The proxy only ever fetches a URL our own token cache already vouched for, checks the bytes really are a raster image before serving them (never SVG, which is a script container wearing an image's extension), and caps what it will hold.

---

## 4. How to participate — in 4 steps

1. **Get a ticket.** Someone already inside sends you one of their ten invite codes. You can read the whole site without one — you need it to make an account (§3.16).
2. **Get a wallet** and add Robinhood Chain (Robinhood Wallet supports it natively; any EVM wallet works).
3. **Grab some $SEND / $GWC** using the how‑to‑buy guide and the in‑page swap — always verify the contract address first. Remember the **$100 hold floor** (§3.2.1): below it, a bag earns no holder status at all.
4. **Create your account** (wallet, email, Google, Facebook, X, or Instagram), connect your wallet read‑only, claim your unique @handle — then **send it.** Post on the Send Wall, join or start a **community** for a flat 10×, make and follow Send Calls, react and vote, track wallets, ride the New Pairs Radar, and stack Send Power.

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
