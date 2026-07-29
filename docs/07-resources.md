# Arcs Digital — Resource System

Status: implemented in `packages/engine/src/resources.ts` and `control.ts`; Tax and Build
wired into `rules/standard-actions.ts`. Transcribed from haunt-roll-fail's
`arcs/game.scala`.
Date: 2026-07-23

## 1. The model

Five resources — Material, Fuel, Weapon, Relic, Psionic — with **five tokens of each** in a
shared supply (25 tokens total). A faction holds gained tokens in **six city resource
slots** with printed "keys" `[3, 1, 1, 2, 1, 3]` (`game.scala:885-892`). Keys feed the
Tycoon ambition and raiding; they are carried in `CITY_SLOT_KEYS` now so scoring needs no
later data change.

Everything is a `Tracker` (the same immutable identity tracker as figures and cards), keyed
by slot location:

| Location | Holds |
| --- | --- |
| `supply:<Resource>` | the shared pool, 5 tokens each |
| `cityslot:<faction>:<0..5>` | a faction's six resource slots |
| `overflow:<faction>` | where a gained token waits when every slot is full, until the owner chooses what to keep |

Token ids are `<Resource>#<index>` (e.g. `Material#3`) — the same interning approach used
everywhere in the engine.

## 2. Slot capacity

How many of the six slots a faction can actually use depends on how many **cities it still
has in reserve** (`game.scala:1005`):

```
usable = [6, 6, 6, 4, 3, 2][citiesInReserve]
```

Fewer cities in reserve means more cities built on the map, which means more usable slots —
building cities is what grows your resource capacity. Tokens beyond capacity overflow.

`slotCapacity(citiesInReserve)` implements this, clamped. The engine derives
`citiesInReserve` from the figures tracker at the point of use, so capacity is always
consistent with the board.

## 3. Operations

Pure, tracker-in/tracker-out:

- `registerResources(tracker, factions)` — register and fill the supply, register slots.
- `gain(tracker, faction, capacity, resource)` — move one token from supply to the first
  open slot. Returns `{ tracker, gained }`; `gained` is false when the supply is empty or
  all usable slots are full.
- `spendToken(tracker, token)` — return a specific token to its supply.
- `countResource` / `heldTokens` / `openSlots` / `supplyOf` — queries, including the count
  scoring will use for Tycoon / Keeper / Empath.

Conservation is a tested invariant: gain-then-spend never invents or loses a token.

## 4. Two standard actions now work

Tax and Build were the placeholders blocked on exactly this. Both are now driven end to end
through the real turn loop in the tests.

**Tax** — tax a City you hold, gaining that planet's resource (planet resources are board
data, docs/05). **Each City is taxed at most once per turn**, tracked per *City figure* in
`taxedThisTurn` and reset at end of turn.

Per city, not per system: **8 of the 18 planets have two building slots** (1-Arrow, 1-Hex,
2-Hex, 3-Hex, 4-Arrow, 4-Crescent, 5-Hex, 6-Crescent), so a faction can hold two Cities on
one planet and may tax each. HRF does the same — `f.taxed.cities` is a list of city figures,
offered one option per city and disabled with `.!(taxed.has(c), "taxed")`
(`game-common.scala:730`, recorded at `:744`). Its separate `taxed.slots` list is only for
the campaign's empty-slot tax and is not modelled here.

*Fixed after a report:* taxing was tracked by **system**, so taxing one City on a two-slot
planet wrongly blocked the other.

**Build** — place a City or Starport from reserve into an open building slot of a system
you rule, or a Ship at one of your starports. "Rule" is the base rule from `game.scala:765`:
strictly more ships than any other color. Free building slots come from the planet's slot
count minus buildings present (`control.ts`, from `game.scala:1445`).

**A Starport builds at most one Ship per turn.** Spent starports are held in
`workedThisTurn` (figure ids) and withheld from the Build menu until the turn ends. This
mirrors HRF's `worked` set: the option is disabled by `f.worked.count(b) > 0` — "built this
turn" (`game-common.scala:916`), recorded at `:1019`, and cleared in `EndTurnAction` at
`:2142`. A faction with two Starports in a system therefore gets two Ships per turn, one
from each.

*Fixed after a report:* Build was previously offered per **system** rather than per
Starport, so several pips could produce several Ships from one Starport in a single turn.
`packages/engine/test/per-turn-limits.test.ts` guards it — the property is "no two Ship builds share a
(turn, starport) pair", checked over a full game, and it was confirmed to fail against the
old behaviour before the fix landed.

Control queries live in `control.ts`: `rules`, `present`, `ruleValue`, `freeSlots`.

## 5. Scope and simplifications

Stated plainly, per the collaboration rules. None of this is guessed at — each item is a
deliberate deferral of a rule I could see in HRF but chose not to port yet.

- **Overflow is declined, not resolved.** When a gain has no open slot, HRF routes the token
  to overflow and forces the faction to discard down. Phase 1 declines the gain and logs it.
  The `overflow:<faction>` location exists for when this is built out.
- **Tax covers own cities only.** Taxing a rival's city in a system you rule — and the agent
  capture that follows — is **implemented**, see the section below. Empty-slot taxing (the
  Inspiring trait) is campaign.
- **Build requires ruling the system** for a City or Starport. The exact base rule is
  presence with an open slot plus a control check that differs slightly for gate stations;
  the phase-1 rule (ruled + open slot) is a safe subset. Upgrades, bunkers and gate stations
  are deferred.
- **Actions cost only the pip.** In the base game standard actions cost a pip, not a
  resource; resources are gained by Tax and matter for scoring. The resource-paying
  the Prelude is now implemented (docs/06 section 4); guild-card substitutions stay deferred.
- **Piece counts** (15 ships, 5 cities, 5 starports per faction) should be checked against
  the physical components before release. 15 ships is confirmed from HRF; the city and
  starport counts are reasonable but unverified, and the slot-capacity array assumes cities
  can range across the `[6,6,6,4,3,2]` index.
- **Scoring still stubbed.** The count functions this system exposes are what ambition
  scoring will consume, but the ambition track and power total do not exist yet, so the game
  still ends after a fixed five chapters (docs/06 section 4). Ambitions are the natural next
  piece — they turn `countResource` and `CITY_SLOT_KEYS` into actual points.

## 6. Tests

`packages/engine/test/resources.test.ts`:

- Model constants (five resources, keys, capacity curve, token round-trip).
- Tracker operations: seeding, gain into an open slot, gain failing on a full board and on
  an empty supply, spend returning to supply, and token conservation.
- Setup granting each faction its two starting resources, drawn from the shared supply.
- Tax and Build exercised end to end by driving the turn loop to their action menus.


## Taxing a Rival's city

"Gain 1 resource at a Loyal or Controlled city. Taxing Rival captures an agent." The two halves of
that have different requirements, and the engine originally implemented only the first:

- **Your own (Loyal) city** is taxable wherever it stands. Ruling is *not* required — which is
  what makes the Upstart's Callow ("you can only tax Loyal cities if you control them") a real
  cost rather than a formality.
- **A Rival's city** is taxable only in a system you **rule**, and doing so moves one of that
  rival's agents from their reserve into your **captives**.

That makes taxing the base game's second source of captives after securing, and so a second route
into Tyrant scoring — which is why its absence mattered beyond the missing action itself.

Each city is taxed at most once per turn, tracked by figure id in `taxedThisTurn`, so a rival's
city and one of your own in the same system are counted separately.

A rival with no agents left loses nothing and the attempt is logged; HRF behaves the same way
(`game-common.scala:750`). Verified against the rulebook rather than HRF alone — the current
publisher is Buried Giant, and the rule text was cross-checked against two independent summaries.

## Overflow

Gaining a resource with every slot full used to **refuse the resource**. The rule is the opposite:
"when you take or are given a resource you may rearrange any resources in your resource slots, but
you must discard resources you cannot hold". You take it, and something has to go — and *which*
is the player's choice, including the option of dropping the new one.

`gain` now places the token into `overflow:<faction>` rather than declining, and `overflowThen`
turns that into an ask before play continues. Every path that can gain routes through it, so the
choice cannot be honoured by one caller and skipped by another. With nothing overflowing it is
exactly `C.then(then)`.

**Both clauses are implemented, in one step.** `overflowThen` no longer asks "which type do you
end up without" — it opens the slots as a board (`offerArrange`), and the player pushes tokens
around until the row is legal. A **swap** between two held tokens costs nothing; landing an
*arriving* token on an occupied slot **ejects** the occupant to the supply, which is the discard.

> An earlier version of this engine had only the discard, and justified dropping the rearrange by
> calling the slots interchangeable and saying "the raid already spends cheapest-first". Neither
> was true: `CITY_SLOT_KEYS` is `[3, 1, 1, 2, 1, 3]`, and `offerRaid` enumerates one option **per
> occupied slot at that slot's price**, letting the *raider* choose. Where a token sits decides how
> cheaply it can be stolen, so arranging the row is a real defensive decision — and it was being
> made for the player by arrival order.

The step is enumerable rather than a free-form payload: one action per legal drop, so a drag is an
ordinary journalled action and undo steps back one drag. It re-offers itself after every move,
which is what makes it a board rather than a single question — so anything driving the engine must
choose `resources/arrange-done` to leave, exactly as a player clicks Done. `arrange-done` is not
offered at all while the row is illegal.

**Most gains cannot overflow**, which is worth knowing before hunting for missing wiring: every
Prelude ability that gains first *spends* something, freeing a slot. The exceptions are Tax (and
its leader bonuses), the two guild alts that gain outright, Ambitious, the trade swap, and Elder
Broker's gain-three. Setup passes no overflow location at all, since its slots are empty by
construction.

**Capacity used to only grow — it does not any more.** A city destroyed *in battle* goes to the
attacker's trophies rather than back to its owner's board, and trophy return at cleanup is still
not implemented. But **Ruthless** (Overseer, leader10) sends a building it destroys home to its
owner's **reserve**, which raises cities-in-reserve and so lowers `slotCapacity`. A token left in a
slot that is no longer usable would be stranded: invisible to `slotsOf`, so it would stop counting
for ambitions and could be neither spent nor raided.

`strandedTokens` is the second thing that makes the row illegal, alongside a token waiting to land,
and it is what "you must discard resources you cannot hold" means when the board shrinks under you.
The arrange step forces it before play continues. `provokeOutrage` independently sweeps all six
slots rather than the usable ones, and says why.

When trophy return lands it needs no new machinery — a returning city raises cities-in-reserve the
same way, and the next gain settles the row.
