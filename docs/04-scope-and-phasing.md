# Arcs Digital — Scope & Phasing

Status: **Locked.**
- **Phase 1**: base game (3–4 players), plus Leaders & Lore.
- **Phase 2**: The Blighted Reach campaign. Deferred, but *committed* — phase 1 must not preclude it.
- Bot difficulty is user-selectable. See [03 — AI approach](03-ai-approach.md).

Date: 2026-07-22

## 1. Why this matters more than a normal "we'll add it later"

The campaign is not a feature bolted onto Arcs; in HRF it is roughly **half the rules code**
(`game-blight.scala` 2,425 lines + `game-summit.scala` 975 + `game-fates-common.scala` 323 +
~4,900 lines across 24 fate modules ≈ 8,600 of ~21,600 total). It adds non-player factions, a
second card deck, a second board configuration, an extra structural layer above chapters (acts),
simultaneous multi-player negotiation, and 24 distinct alternate win conditions that attach to
players mid-game.

"We'll refactor when we get there" is not viable at that size. The good news is that HRF proves
it can be purely additive — the base rules contain almost no campaign awareness. That works
because of a handful of specific design choices, and those are what phase 1 must adopt.

## 2. The seven constraints on phase 1

Ordered by cost-of-retrofit, most expensive first.

### 2.1 `Color` and `Faction` are different types — do this from the first commit

The campaign introduces **Empire**, **Blights** and **Free**, which own pieces on the board but
are not players. In HRF they are `Color`; players are `Faction`; `Faction extends Color`.

If phase 1 types a piece's owner as `FactionId`, then phase 2 has to touch every piece, every
tracker key, every rendering path and every bot heuristic. If phase 1 types it as `ColorId` and
keeps `FactionId` as the narrower thing that players and bots use, phase 2 adds three new colours
and nothing else changes.

This is the cheapest constraint to honour now and by far the most expensive to retrofit.
**Highest priority item in this document.**

```ts
type ColorId   = 'red' | 'yellow' | 'blue' | 'white'      // phase 2 adds 'empire' | 'blights' | 'free'
type FactionId = Extract<ColorId, 'red' | 'yellow' | 'blue' | 'white'>
// pieces are owned by ColorId; players and bots are FactionId
```

### 2.2 The rule-module chain must be per-game state, not a static list

Rules are ordered modules, first match wins, with an explicit "not mine" sentinel. Phase 2 slots
its modules in ahead of the base ones and intercepts.

The non-obvious part: **fates attach mid-game**. HRF does `game.expansions = fate.expansion +:
game.expansions` at runtime when a fate is assigned. So the chain is a value carried in game
state, not a module-level constant assembled at startup.

Easy to get wrong, because a static chain works perfectly for phase 1 and quietly makes phase 2
impossible.

### 2.3 Location keys must be open unions

The four trackers are keyed by location. The campaign adds new locations to every one of them:
`FatePieces(fate)` and `Exchange(color)` for figures, `FateDeck(fate)` / `NoFateDeck(faction)` /
`LoreCards(faction)` for court cards, `ImperialTrust` for resources.

Model these as discriminated unions that code is *not* required to match exhaustively on. If
phase 1 writes exhaustive switches over location kinds everywhere, each phase 2 addition breaks
every one of them. Handle the kinds you care about and ignore the rest.

### 2.4 Setup is a rule sequence, not a function

HRF runs setup as ordinary actions (`StartSetupAction` → `CourtSetupAction` →
`BaseFactionsSetupAction` → …), which is precisely why the campaign can intercept and replace
parts of it without touching base setup.

If phase 1 writes `function setupGame(): GameState` as an imperative constructor, phase 2 has to
fork it. Make setup actions from the start.

### 2.5 Decks, board and card pools are parameters

Campaign swaps the court deck (`BlightCards.court` vs `BaseCards.base`), adds a side deck, adds
`EventCard`s into the action deck, always uses the full board rather than a cluster subset, and
opens `Market(0)` as the council (base game uses markets 1–4 only).

None of these should be global constants. They come from a setup configuration value.

### 2.6 The `Continue` union needs a multi-ask variant now

Summits are simultaneous negotiation between several players. HRF's `Continue` vocabulary has
`MultiAsk(asks, policy)` for this.

`Continue` is the return type of *every rule*. Adding a variant to it later is a wide, mechanical,
error-prone change. Include it in phase 1 even though nothing emits it — an unused variant costs
nothing.

### 2.7 State has `act` even though phase 1 never leaves 0

Campaign structure is acts (1–3) above chapters (1–5). HRF carries `var act : Int = 0` regardless.
Carry the field; phase 1 ignores it. Serialization and save-format churn avoided.

## 3. Also plan for, but cheaper to defer

- **Asset manifest conditionality.** Roughly 370 of HRF's 910 image assets are fate cards. The
  manifest needs a per-entry condition (`(factions, options) => boolean`) so phase 1 players never
  download campaign art. HRF's `ConditionalAssetsList` is exactly this. Retrofit cost is low, but
  design the manifest shape now.
- **Journal versioning.** Phase 2 introduces new action types. The first journal entry already
  records the build version; make sure the parser fails loudly and legibly on an unknown action
  rather than silently mis-replaying.
- **Bot evaluator extensibility.** Each fate is an alternate win condition, so the value function
  needs a per-fate override hook. Phase 1 should route all scoring through one interface rather
  than hardcoding "power differential" as the only objective.

## 4. What phase 1 can safely ignore

To keep scope honest — these need no accommodation at all:

- Summit negotiation mechanics (beyond the `MultiAsk` variant existing)
- Laws, edicts, negotiation drafts
- Blight mechanics, imperial trust, golems
- The 24 fates themselves
- Act transitions and campaign scoring
- Two-player support (campaign-only)

## 5. Acceptance check

Phase 1 is "campaign-ready" if all of these hold:

1. A piece's owner is a `ColorId`, and adding a non-player colour requires no change to the
   tracker, rendering or serialization code.
2. The rule-module chain is a value in game state and can be modified mid-game.
3. Adding a new location kind to any tracker breaks no existing code.
4. Setup runs as actions and appears in the journal.
5. Decks and board come from a setup config, not from constants.
6. `Continue` includes a multi-ask variant.
7. The bot's objective is behind an interface, not hardcoded.
