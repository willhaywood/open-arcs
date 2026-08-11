# Arcs Digital — Battle

Status: implemented in `packages/engine/src/rules/battle.ts` and `dice.ts`. Repair is now
also implemented (unblocked by the damage state battle introduces).
Date: 2026-07-23
References: haunt-roll-fail `arcs/game-battle.scala` (flow, resolution); arcs_tts
`src/DiceCounter.lua` (dice component data). Both cross-checked.

## 1. The dice — confirmed identical in both references

This was the part most worth verifying, and it came out clean: the three battle dice have
**exactly the same faces** in HRF (`game.scala` `BattleDie`) and in the TTS mod's per-face
result tables. I checked all eighteen faces. The values in `dice.ts` are therefore
high-confidence.

Five symbols: **self** (hit your own ships), **intercept** (lets the defender strike back),
**hits** (enemy ships), **buildings** (enemy buildings), **keys** (raid loot).

| Die | Faces |
| --- | --- |
| Skirmish | 3× blank, 3× (1 hit) |
| Assault | blank; (2 hits, 1 self); (2 hits); (1 hit, 1 self) ×2; (1 hit, 1 intercept) |
| Raid | (1 bldg, 1 self) ×2; (2 keys, 1 intercept); (1 key, 1 bldg); (1 key, 1 self); (1 intercept) |

There are six physical dice of each type — the roll-count cap in the game.

## 2. Flow

```
Battle (a pip action, from an Aggression card)
  battle/declare  — choose a system where you have ships and an enemy is present
  battle/system   — (that system)
  battle/target   — choose the enemy color (auto if only one)
  battle/gather   — choose a dice pool: total <= your ships, <=6 of each type,
                    raid dice only if the enemy has buildings (HRF's freeRaid)
  battle/roll     — roll via the seeded RNG in state, then resolve
```

The pool enumeration mirrors HRF's combination list (`game-battle.scala:194`). Rolling uses
the RNG carried in state, so a battle is deterministic in the seed and reproducible from the
journal — no separate randomness channel.

## 3. Resolution

Tally the pool, then in order:

1. **Attacker self-damage.** `self` hits, plus — if *any* intercept was rolled — the
   defender's fresh ship count (`game-battle.scala:338`), strike the attacker's own ships.
2. **Enemy ships.** `hits` strike enemy ships; any that can't be placed (ships exhausted)
   overflow into building hits.
3. **Enemy buildings.** Building hits strike Cities and Starports.
4. **Trophies — both directions.** Rulebook p14, verbatim: "The attacker takes destroyed
   defending pieces as Trophies. **The defender takes destroyed attacking pieces as Trophies.**"
   So destroyed enemy pieces go to the attacker's Trophies box, and the attacker's own ships
   destroyed by self-damage or interception go to the *defender's*. This is how the **Warlord**
   ambition scores, and it scores for defending as well as attacking.

   This was wrong until it was reported from play: attacker losses were sent home to reserve, so a
   defender who wrecked an attacking fleet by interception received nothing, and Warlord only ever
   paid the aggressor. HRF was read as agreeing, which is what kept it in place; the rulebook is
   the authority and both printings (April 2024, August 2025) carry the sentence unchanged. A
   defender that is not a seated player has no Trophies box, and only then do the pieces go to
   reserve.
5. **Raid.** `keys` steal resources from the enemy, cheapest slot first, paying each slot's
   key cost (`CITY_SLOT_KEYS`), following HRF's raidable-cost model.

## 3a. Outrage — razing a city

Implemented in `outrage.ts`, triggered from `resolveBattle` step 5. Three points, because
each is easy to get backwards and two of them I would have guessed wrong:

- **The attacker is outraged, not the city's owner.** HRF collects the destroyed cities and
  then applies `OutrageAction(f, r, ...)` with `f` bound to the *battling* faction — the same
  `f` that takes the trophies and ransacks (`game-battle.scala:568-672`). Razing a world
  turns its guilds against you, not against the player you razed. The intuitive reading —
  "you lost a city, so you are outraged" — is wrong.
- **Provoking it discards what you already hold.** Every token of that resource goes back to
  the supply (`game-common.scala:545-551`). This is the part with teeth today: it moves
  Tycoon scoring the moment it fires.
- **Nothing clears it in the base game.** Every `ClearOutrageAction` call site in HRF is
  campaign — building a *Free* city or starport (`:971`, `:1005`), discarding a lore card
  (`:1950`), fates, and Blighted Reach setup. Outrage provoked in a base game lasts the rest
  of it, which is what makes razing a city a real decision rather than free trophies.

Cross-checked against Quinnsicle/arcs_tts, which confirms the physical model but not the
trigger — it is component data, not a rules engine. `tools/LayoutTools.lua` has five
`outrage_agent_layout` slots, one per resource, each covered by one of your **agents**
(HRF matches: `pooled(Agent) - outraged.num`), and the guild card text is explicit about what
it blocks: "You ignore Outrage when spending Material **for its Prelude action**."

**Now enforced:** the Prelude (docs/06 section 4) checks `canSpendForPrelude`, so an outraged
resource buys no action there — it can still be discarded, and it still counts for the
resource ambitions. Outrage blocks the Prelude action, not ownership. The agent cost is still
not modelled: our engine has no agent pool to draw down.

**Ordering:** outrage resolves *after* the raid, so the discard takes what the attacker holds
once the battle is over. It only differs when one battle both raids a resource and razes a
city producing it, in which case the loot goes straight back to the supply. HRF builds its
continuation chain in the opposite order; this is a deliberate call, not a transcription.

**Damage model.** A fresh piece takes one hit to damage and a second to destroy; a damaged
piece is destroyed by one hit. Damage is a set of figure ids in state (`damaged`). This is
what **Repair** removes — Repair un-damages one of your pieces for a pip, now a real action
rather than a placeholder.

Hit application lives in `dice.ts` as a pure, exported `applyHits(damaged, targets, count)`,
so the health model is unit-testable without going through a random roll
(`packages/engine/test/hits.test.ts`).

*Fixed during the action audit (docs/12):* `applyHits` previously ran two sequential passes —
finish damaged, then damage fresh — so it could never damage *and then* destroy in one
battle. Four hits against two fresh ships damaged both and discarded two hits, instead of
destroying both. It now loops, consuming the health pool fully, so hits overflow only once
no target can absorb them. Battles were under-killing before this.

A sanity game bears out the behaviour: assault dice deal self-damage as they should,
destroyed ships become trophies, the defender retaliates on a later turn, and damage
accumulates across the board.

## 4. Scope and simplifications

Stated plainly. Each is a rule visible in HRF that is deliberately deferred, not guessed.

- ~~**Hit allocation is auto-resolved, not player-directed.**~~ **Implemented.** The attacker
  now assigns each hit to a specific piece, one at a time, matching HRF's `AssignHitsAction`
  (game-battle.scala:474): self-damage and interception onto the attacker's own ships, then
  ship hits onto enemy ships (overflowing to buildings once no ship remains), then building
  hits. The engine offers one `battle/hit` action per legal target and applies exactly the
  one chosen; the fixed-policy `applyHits` helper is kept for its own tests but is no longer
  on the battle path. See section 4a.
- ~~**No rerolls.**~~ **Implemented** — `tallyOf` / `rerollAt` in `dice.ts` and the reroll hop in
  `performRoll`. Seeker Torpedoes uses it; Skirmishers (bc13) is still unwired but no longer
  blocked.
- **No allies, flagships, or Empire/Blights combatants** — campaign.
- ~~City loss does not cause resource outrage.~~ **Implemented** — see section 3a.
- ~~**Raid steals resources only.**~~ **Implemented.** Keys now buy **resources or guild cards**,
  and which is the raider's decision, so the raid is a loop of asks rather than an automatic
  sweep — HRF's `BattleRaidAction` re-enters itself with the keys that are left
  (game-battle.scala:403). A resource costs the key value printed on the slot it sits in
  (`slotKeys`, which is why Ancient Holdings at four is the dearest thing on the table); a guild
  card costs the value printed on the card.

  **Trophies and captives are not raidable in the base game.** The old note lumped all three
  together; HRF only offers them under the expansion's Vow of Fairness. Nothing to do here.

  The old automatic `raid()` helper, which swept resources cheapest-first, is deleted — with the
  choice in place it was both unreachable and wrong, since a guild card is usually worth more than
  the cheap slot a sweep would have taken first. **Sworn Guardians** still stops all of it.

  A battle now settles in two steps: `battle/finish` opens the raid, and `battle/settle` runs
  everything after it — outrage, ransack, Repair Drones and the defender's Beloved step — so the
  ordering the earlier notes describe is unchanged.
- ~~**No agent capture from taxing.**~~ **Implemented** — taxing a Rival's city captures one of
  their agents (docs/07). Capture from battle results is still deferred.

## 4a. Player-directed hit assignment

After the roll, the battle no longer resolves in one step. It carries a small `Resolve`
context — the system, the enemy, and the counts still to place (`self`, `ships`, `buildings`,
`keys`, plus a `razed` flag) — through a loop of `battle/hit` actions. `offerAssign` works one
phase at a time: the attacker's own ships first (self-damage + interception), then enemy
ships, then enemy buildings; a phase with nothing to place, or no piece left to take a hit, is
skipped, and ship-hits with no enemy ship left overflow into building hits exactly as before.
Each `battle/hit` damages a fresh piece or destroys a damaged one — enemy pieces become the
attacker's trophies, the attacker's own destroyed ships go to the defender's (p14). When every count is
placed the loop hands off to `battle/finish`, which runs the raid, provokes outrage if a City
was razed, and returns the turn.

The context is plain values only, so it round-trips through the journal like any other action
payload — a battle interrupted mid-assignment saves, loads and replays to the same point. The
roll itself stays deterministic in the seeded RNG; `state.lastRoll` records the faces purely so
the UI can show and animate them (docs/10), and nothing in the rules reads it.

**Assignment always ends on a confirm, never on itself.** When every count is placed, `offerAssign`
returns a one-option `battle/finish` ask rather than `C.then(Finish(ctx))`. Two reasons:

- **The player must be able to change their mind.** Every hit is a journalled action, so undoing
  one is just replaying the journal without it, and "start over" is dropping the whole trailing
  run of hits (docs/10). Auto-committing on the last hit would close that window at exactly the
  moment the player can finally see the full result.
- **A roll must always be visible.** Some rolls leave nothing to place — every die blank, hits
  with no surviving target, or only raid keys. `performFinish` clears `lastRoll`, and the whole
  chain runs inside one synchronous `advance`, so those used to resolve without any observer ever
  seeing a state holding the roll: the player spent a pip, rolled, and no dice appeared at all.

The raid and the outrage therefore run on confirm, not on the final hit.

## 5. What this unblocks

- **Warlord** now scores from real trophies. With the court deck supplying captives, all
  five ambitions are live.
- **Repair** is implemented.
- The **damage state** is now part of the model and available to any future rule.

## 6. Tests

`packages/engine/test/battle.test.ts`:

- Dice faces reconstructed by sampling and asserted against the confirmed HRF/TTS multisets;
  determinism in the seed; a Skirmish die averaging ~0.5 hits over 6000 rolls.
- A battle driven from a real game: piece conservation (every piece ends on the board, in
  reserve, or as a trophy — none vanish), the roll logged, and determinism under a seed.
- A full game under a battle-seeking policy still terminating in game over.
