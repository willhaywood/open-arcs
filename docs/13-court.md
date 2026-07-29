# Arcs Digital — The Court

Status: implemented in `packages/engine/src/court.ts` (data) and
`rules/standard-actions.ts` (Influence, Secure). This is what made **Influence** and
**Secure** real, and with them the **Tyrant** ambition, which could never score before.
Date: 2026-07-23
References: haunt-roll-fail `arcs/game-base.scala:115-149` (the deck),
`arcs/game-common.scala:1074-1210` (Influence, Secure, capture, replenish). Card art in
`game-assets/court/bc01..bc31.webp`, ids matching HRF exactly.

## 1. Shape

- **31 cards**: 25 Guild (`bc01`–`bc25`), 6 Vox (`bc26`–`bc31`).
- **4 display slots** in the base game. HRF builds `market` as `1.to(4)`; the campaign adds
  slot 0, the Imperial Council. Slots are dealt at setup and refilled as they empty.
- **10 agents per faction**, from `game.scala:846`. These are the real constraint on the
  court — influence is limited by agents, not by pips.

Cards live in their own tracker (`state.courtCards`: deck, four slots, a secured pile per
faction, a discard). Agents standing on a slot are *figures*, at `Location.court(n)`, so they
move between reserve, court and captives through the same tracker as every other piece.

## 2. Influence

Place one agent from reserve onto a face-up card (`game-common.scala:1086`). Needs an agent
in reserve and a card in the slot — an empty slot cannot be influenced (HRF disables it with
`.!(m.none)`).

There is **no cap** on agents per card. Under a greedy policy a single card can accumulate
twenty-odd agents, which looks alarming but is faithful; a real player stops long before.

## 3. Secure — and the prisoners

Two rules, and both are the point of the subsystem.

**A strict majority is required.** HRF disables Secure when your agent count on a card is
`<=` the best any *single* rival has (`game-common.scala:1170`). A tie is not enough. This is
the whole tension of the court: committing agents is public, and a rival only has to match
you to deny the card.

**Securing takes prisoners.** Your own agents return to your reserve; every **rival** agent on
that card becomes **your captive** (`CaptureAgentsCourtCardAction`). This is the base game's
only source of captives, and therefore the only way the Tyrant ambition scores.

The slot is then refilled from the top of the deck (`ReplenishMarketAction`); an exhausted
deck leaves it empty and says so in the log.

Guild cards go to the securing faction's pile; Vox cards are discarded.

## 4. Card effects

**Every card in the base court now has its effect.** All 25 guild cards and all 6 Vox cards
are dealt, influenced, secured — and fire.

### Data (all 25 guild cards)

Each guild card carries its **suit** and **key value**, transcribed from HRF
`game-base.scala:83-107` (`GuildEffect(name, suit, keys)`). The keys are the **raid cost** to
take the card off its holder in battle (`game-battle.scala:416`) — they are *not* ambition
points; secured cards do not score. Raiding cards off a rival is not implemented, so the keys
are carried but unused.

### The Loyal guilds — implemented

Loyal Engineers (Material), Loyal Pilots (Fuel), Loyal Marines (Weapon), Loyal Empaths
(Psionic), Loyal Keepers (Relic). Each is worth 3 keys.

HRF writes every Prelude condition as:

```scala
if ((r.is(Material) && f.outraged.has(Material).not) || f.hasGuild(LoyalEngineers)) { ... }
```

so one card does **two** things at once, and both fall out of unioning the grants:

- **any** resource you hold can buy that suit's Prelude action, and
- **outrage on that suit stops nothing**.

Loyal Empaths is the widest, since Psionic's grant is the whole lead suit.

One trap worth recording. Loyal Marines lets a non-Weapon token buy the Battle option, but
the offer originally hardcoded `resource: 'Weapon'` while the handler pays with
`paying(state, faction, resource)` — which **throws** when you hold none. Caught by reading
the handler before shipping; a test now drives the real action and fails with
`red has no Weapon to spend` if the hardcoding comes back. The lesson generalises: a Prelude
offer must name the token actually spent, never assume the card's own suit.

### The alt-action hook — implemented

HRF offers `game.build(f, cost, then)` **and** `game.buildAlt(f, cost, guilds, then)` at every
action site (`game.scala:1549-1780`). A card does not *replace* an action — it **widens the
menu that action opens**. That is the shape reproduced in `guild-actions.ts`: a `GuildAlt`
declares which standard action's menu it joins, which card grants it, and any extra
condition; `withAlts()` in `rules/standard-actions.ts` merges them at **every** action site,
including ones no card touches yet, so a new card costs a registry entry plus its flow.

**All six of HRF's base alts are implemented:**

| Card | Alt | On | Effect |
| --- | --- | --- | --- |
| Mining Interest | Manufacture | Build | gain 1 Material |
| Shipping Interest | Synthesize | Build | gain 1 Fuel |
| Prison Wardens | Press Gang | Build | return a captive, gain any 1 resource — repeatable |
| Prison Wardens | Execute | Influence | move a captive to your trophies — repeatable |
| Court Enforcers | Abduct | Battle | take every rival agent off a lightly-held court card |
| Elder Broker | Trade | Tax | swap a resource with a rival whose city you rule |

Details worth keeping:

- **Press Gang returns the captive to its *owner's* reserve**, not the captor's
  (`game-guilds.scala:158`). It was never the captor's piece.
- **Execute converts Tyrant points into Warlord points.** Both metrics count interchangeable
  agents, so *which* captive is never a decision — which is why the loop-one-at-a-time flow
  is exactly as expressive as HRF's multi-select, without needing one.
- **Abduct's reach is Weapon tokens *plus* secured Weapon-suit guild cards**
  (`game.scala:1684`). Court Enforcers is itself Weapon-suited, so holding it is always worth
  at least 1 — the card is self-starting. A slot is reachable only when rivals hold
  **strictly fewer** agents than that, so a well-defended card is safe; your own agents on the
  card do not count against you. Abduct then takes *all* rival agents there at once.
- **Trade is a swap, not a theft.** You take the planet's resource off a rival whose city
  stands in a system you rule, and hand back a type they do **not** hold — so the give-back
  leg is a real second decision, and it is why the rival ends up better diversified.

Battle needed a small change to accept alts at all: it alone had no menu of its own, handing
straight to `DeclareBattle`. It now opens a menu **only** when a card adds something, so the
common case is unchanged.

### Vox card triggers — implemented

All six fire on secure (`rules/vox.ts`, from `game-base.scala:208-297`). A Vox card is not
kept: it fires once and goes — and **how** it goes differs in a way that matters.

| Card | Effect |
| --- | --- |
| Call to Action | draw one action card |
| Populist Demands | declare an ambition, free |
| Mass Uprising | place up to 4 ships across the systems of **one** cluster |
| Outrage Spreads | choose a resource — **every** faction provokes outrage of it, you included |
| Guild Struggle | steal a Guild card from a rival, then recycle the discard |
| Song of Freedom | free a City in a system you rule, then optionally seize the initiative |

Four points worth keeping:

- **Discard vs bury.** Five go to the court discard. **Song of Freedom is buried** — back into
  the *deck*, which is then shuffled (`game-common.scala:658`), so it can come round again.
- **Guild Struggle recycles only *guild* cards** from the discard (`game-common.scala:347`).
  Vox cards stay discarded, which is what stops them cycling endlessly.
- **Populist Demands must not zero a played card.** Zeroing is a consequence of declaring off
  *your action card*, not of declaring as such. `takeAmbitionMarker` was split out of
  `performDeclare` for exactly this — the marker-taking is shared, the zeroing is not.
- **Song of Freedom frees anyone's city**, including your own, and the seize is offered only
  when nobody has seized and you are not already leading (`FreeCitySeizeAskAction`).

Mass Uprising is the one deliberate restructure: HRF enumerates every combination of systems
in the cluster, which explodes. Asking for a cluster and then placing one ship at a time
reaches the same set of outcomes without the combinatorics.

`vox` is a new module in the rule chain, which is why `createGame`'s chain is now six ids.

### The remaining seven — implemented

| Card | Shape | Effect |
| --- | --- | --- |
| Sworn Guardians | passive | nothing of yours is stealable — blocks battle raids and guild-card theft |
| Secret Order | passive | declaring **Keeper or Empath** does not zero your played card |
| Lattice Spies | seize | seize the initiative by discarding **this card** instead of one from hand |
| Galactic Bards | seize | before anyone has declared, declare an ambition matching your card's strength (any on a 7) — once per turn |
| Relic Fence | Prelude | spend any resource to gain a Relic |
| Silver Tongues | Prelude | steal a resource **or** a guild card from a rival |
| Farseers | Prelude | discard your hand and draw as many again |

Points worth keeping:

- **Sworn Guardians shields the holder's *other* cards, not itself.** HRF's check excludes the
  card being stolen (`game-guilds.scala:100`), so the Guardians card can always be taken —
  you just cannot pick off the cards behind it first.
- **Secret Order is narrow.** Only Keeper and Empath. The other three ambitions still zero
  your card, which is what stops it being a blanket "declare for free".
- **Galactic Bards needs a once-per-turn marker**, since using it leaves the card in play.
  That is what `state.usedThisTurn` is for. The Prelude abilities need no marker because
  **the card itself is the cost** — they discard it.
- **Farseers' redraw is limited by the deck**, not by your hand. At three players setup deals
  18 of 20 cards, so a six-card hand redraws two. The log states the shortfall rather than
  silently short-changing you.

### Prelude "discard this to…" abilities — implemented

Thirteen guild cards carry one. They all share a cost — **the card itself** — which is why
none needs a once-per-turn marker: using it puts it in the court discard.

| Cards | Ability |
| --- | --- |
| Mining Interest, Shipping Interest | fill every open resource slot with Material / Fuel |
| Material Cartel, Fuel Cartel | take that one resource off a rival |
| Admin / Construction / Spacing / Arms Union | take a played card of that suit into your hand |
| Gatekeepers | a ship at every gate |
| Prison Wardens, Skirmishers, Court Enforcers, Loyal Marines | 3 ships into one system you rule |
| Elder Broker | gain one Material, one Fuel and one Weapon |
| Relic Fence, Silver Tongues, Farseers | (already covered above) |

Two details that are easy to miss:

- **Fill-slots steals when the supply runs dry.** That is the card's second sentence — "if the
  Material supply empties, steal the Material instead" (`game-guilds.scala:77`). Sworn
  Guardians still blocks the theft leg.
- **The Unions take the card straight to hand**, where HRF holds it until end of round
  (`discardAfterRound`). Equivalent here, and worth stating why: the Prelude runs *after* you
  have played, so you cannot replay the taken card this round either way.

With these, **all 25 guild cards and all 6 Vox cards have their effects.**

## 5. UI

The court is a rail down the **left of the board, beside the played-card rail**
(`CourtPanel.tsx`), with the cards stacked vertically at 128x160 — about three times the area
of the first attempt, which put four cards across a 340px side panel at ~75px each.

Size alone was never going to fix it. Court card art is 744x1039 with real rules text on it,
so **no** size that fits in a side rail is readable. The rail's job is *state* — who holds how
many agents, and who is actually ahead — and **clicking a card opens it full size** to read.
That split is what lets the rail stay narrow without being useless. The enlarged view sizes
off the viewport (`min(78vh, 900px)`), and carries the agent breakdown, who may secure, and
the standing warning that card effects are unimplemented.

Closes on the Close button, on the backdrop, and on Escape; clicking the card itself does
not close it, so it can be read and inspected. All four verified in-browser.

Cost: the map lost ~113px of width (918 -> 805 at 1600x1000). Narrowing the side column from
340px to 300px, which the court vacated, gave 40px of that back.

## 6. Tests

`packages/engine/test/court.test.ts` — 12 tests. The deck composition and setup are checked
directly; the rest is driven through 15 full games with a court-hungry policy:

- **Agents are conserved**: every one of a faction's 10 is always in reserve, on a card, or
  in someone's captives. This is the invariant that would catch a lost or duplicated piece.
- **Never secures without a strict majority** — 0 violations.
- Rival agents become captives; **Tyrant scores non-zero**, which it never could before.
- Slots refill while the deck lasts; no card ever goes missing across deck / slots / secured
  piles / discard.

Each was proven non-vacuous by re-breaking the rule: relaxing the majority to `>=`, sending
rival agents home instead of capturing them, and skipping the refill each fail their test.

`packages/engine/test/guilds.test.ts` — 12 tests covering the card data (every guild has a
suit and a key cost; exactly five Loyal guilds, one per resource, all worth 3) and the Loyal
effects in the Prelude: a Fuel token buying Build/Repair under Loyal Engineers, outrage being
ignored on the loyal suit, only the card's *own* suit being conferred, and Loyal Marines'
Battle option naming — and successfully paying with — a non-Weapon token. Proven by
re-breaking both: dropping the grant union and re-hardcoding the Weapon each fail.

The same file covers the alt-action hook (20 tests total): that alts appear only for the
holder, only on the right action, and only when their extra condition holds; that Manufacture
and Synthesize gain the right resource; that Execute moves Tyrant points to Warlord; and that
Press Gang returns the captive to its **owner**. Proven by re-breaking three ways — unwiring
the hook from Build, returning the captive to the captor, and scrapping the executed captive
instead of trophying it.

Abduct and Trade add nine more (29 in the file), covering reach arithmetic, the strict-less-than
rule, own agents not counting against you, the Battle menu gaining an option without losing
Battle, and the swap moving resources both ways. Re-broken four ways: dropping Weapon-suit
cards from the reach, relaxing the reach to `<=`, taking in Trade without giving back, and
ignoring what the rival already holds.

`packages/engine/test/guilds.test.ts` grew to 49 tests covering the guild effects, and
`packages/engine/test/vox.test.ts` has 11, one or more per card, driven through the real
dispatch. Re-broken four ways, each caught: outraging only the securing faction, discarding
Song of Freedom instead of burying it, recycling Vox cards along with guild cards, and zeroing
the played card on a Populist Demands declaration.

Unlike Trade, **every Vox card is verified in live play**: across 60 driven games all six are
secured and all six fire — 6 draws, 36 uprising placements, 11 cities freed, 12 buries, 2
guild thefts, 6 free declarations, and 7 Outrage Spreads each hitting all four factions.

**A vacuous test caught twice, and worth the warning.** Sworn Guardians blocks a raid inside
`resolveBattle`, which no unit test can reach directly. The first attempt asserted `hasGuild`
and proved nothing. The second drove real games but fixed on yellow as the victim — and
yellow was never raided under that policy, so "yellow is never raided" passed with the guard
deleted. It now runs an **A/B over identical seeds and picks the victim from the control
run**: the control leg asserts somebody really is being raided, then the same seeds with the
card on that faction must show zero. Deleting the guard now fails it 16-to-0. The general
lesson: a "never happens" assertion is worthless without a control proving it *would*.

The Prelude abilities were re-broken five ways, each caught: never stealing once the supply
empties, filling one slot instead of all, placing one ship instead of three, skipping the
gates, and not discarding the card. A sixth trap was self-inflicted — the Union test first
bailed out early when the seed dealt no card of the chosen suit, so it could pass without
testing anything. It now picks the Union to match a card the rival actually holds.

Three traps for future tests here:

- `perform` only consults modules named in **`state.ruleChain`**, so a test-local terminal
  module has to be added to the chain as well as registered.
- Alt flows **loop back to their `then`** when they run out, so `then` must be an action that
  actually halts.
- Board ids are **not** portable across player counts — the 3-player layouts use a subset of
  clusters, so a test that hardcodes `1-Hex` silently finds nothing. Pick systems off
  `state.board.systems` instead.

One of these tests was vacuous when first written: the give-back check asserted the contested
resource was excluded, but the test faction never held it, so the filter was never exercised
and breaking it kept the test green. It now holds the type first.

**Live-play coverage is uneven, and worth stating.** Driving whole games with an
alt-hungry policy fires Manufacture, Synthesize, Press Gang, Execute and — with a policy that
opens the Battle menu while holding Court Enforcers — **Abduct** (6 offered, 3 fired across
120 games). **Trade has never fired in a driven game.** Its predicate matches HRF and its unit
tests drive the real dispatch, but the full combination it needs — hold Elder Broker, rule a
system holding a rival's city, that rival holds *that planet's* resource, and you hold a type
they do not — did not arise in 40 games even with the card forced into a faction's pile and
ships steered at rival cities. So Trade is verified at unit level only; treat live behaviour
as untested until someone plays into it.

## Coverage, corrected

An audit earlier reported ten guild cards with no effect. **That was wrong** — it grepped for card
ids in the rules modules and missed three tables in `court.ts` that other modules consume:

- `UNION_SUITS` — Admin, Construction, Spacing and Arms Union, read by the `take-played` Prelude
- `SHIP_PLACERS` — the four cards whose Prelude places three ships, read by the `ships` Prelude
- `loyalSuits` — the five Loyal guilds, read by `preludeOffers`

`loyalSuits` already did two of the three things a Loyal card prints: it lets **any** resource buy
that suit's Prelude action, and it **ignores Outrage** on that suit. Both fall out of unioning the
grants, which the comment there explains.

Real coverage was 30 of 31, and is now **31 of 31**. Two things were genuinely missing:

**Outrage discards the Guild cards of that suit.** A base-game rule, not a card effect, and absent
entirely: provoking outrage discarded the matching resources but left the guilds. It now discards
your secured guild cards of the outraged suit, which is what the Loyal cards' first line —
"If you Provoke Outrage, keep this card" — exempts them from. **Guild Loyalty** (lore29, fan-made)
exempts all of them, so that card is now wired too.

**Skirmishers (bc13) — the battle half.** Its Prelude was already wired through `SHIP_PLACERS`;
"after you roll in battle, you may reroll a number of skirmish dice up to your total Weapon icons
from resources and cards" was not, because rerolls did not exist until phase 4. The limit is the
same Weapon reach Court Enforcers counts — and note the card **counts itself**, being Weapon-suit,
so holding it alone allows one reroll.

The reroll hop now takes a list of sources rather than hard-coding Seeker Torpedoes, each firing
once per roll. A faction holding both is asked twice, on different dice, which is HRF's behaviour.
