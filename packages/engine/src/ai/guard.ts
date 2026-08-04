/**
 * Slot armour: caring *where* a resource sits, not only that you hold it.
 *
 * A resource slot's printed key cost is what a rival must spend to steal from it in a raid
 * (`offerRaid` prices each steal at `slotKeys(slot)` and skips any the raider cannot afford). The
 * board is uneven on purpose — `CITY_SLOT_KEYS` is `[3, 1, 1, 2, 1, 3]` — so the same token is far
 * safer in one slot than another, and the best arrangement puts what is worth most where it is
 * dearest to take.
 *
 * ## Why this is its own bot rather than a change to the baseline
 *
 * The same reason as the goal layer (docs/19 section 4): `resourcesGuarded` is weight **0** in
 * `WEIGHTS`, so `heuristicBot` and the frozen baseline stay byte-identical and any difference this
 * makes can be attributed to switching it on rather than lost in a moved reference point.
 *
 * ## It has been measured, and it does **not** demonstrably win more games
 *
 * Expansion games (`--lore 3`), three players, seats rotated, against the same bot twinned with
 * itself to establish the floor (docs/19 section 3j):
 *
 * | games | vs `baseline` | vs **its own twin** |
 * | --- | --- | --- |
 * | 120 | 16 points, 1.9 power | 16 points, 1.9 power |
 * | 1000 | 2 points, 0.6 power | 2 points, 0.5 power |
 *
 * The effect equals the noise floor exactly, on both metrics, at both counts. **There is no
 * statistical evidence that slot armour contributes to winning.** Do not cite the raw win rate as
 * support; it is indistinguishable from two copies of one bot disagreeing with each other.
 *
 * Raids are not the reason to doubt it — a measured 8 baseline games saw 3.9 resources stolen per
 * game and 18.8 arrange menus faced, so the decision has real surface area. The effect is simply
 * narrow: it changes *which* token is taken, not whether raids happen.
 *
 * ## What is proven, which is narrower and needs no arena
 *
 * Before this, **no feature read the arrangement**, so every ordering of a row scored identically
 * and the evaluator could not prefer a good one. That blind spot is closed, and `guard.test.ts`
 * pins it. That is a correctness claim about what the bot can *see*, not a claim about strength.
 *
 * An earlier version of this note also claimed it gave the arrange decision a terminating
 * condition. That is no longer a reason to keep it: `ARRANGE_MOVE_CAP` bounds the cycle in the
 * rules, which is stronger and does not depend on any bot's scoring.
 *
 * ## Before promoting the weight
 *
 * It stays at 0 in `WEIGHTS` until there is evidence this run did not produce. Note also that
 * games failing to finish rose with the number of `guard` seats (4/1000 with one, 15/1000 with
 * two), which hints at a cycle the arrange cap does not cover — see docs/19 section 3j.
 */

import { heuristicBotWith } from './heuristic.js'
import { WEIGHTS } from './value.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

/**
 * The baseline with slot armour switched on.
 *
 * `0.3` is a starting point chosen by argument, not fitted: a token is worth roughly a third of its
 * ambition-scaled value again for each key of protection above the cheapest slot, which puts a
 * well-placed Relic in the same order as the difference between holding one and holding two. The
 * arena is the only thing entitled to say whether that is right.
 */
export const GUARD_WEIGHTS: Weights = { ...WEIGHTS, resourcesGuarded: 0.3 }

export const guardBot: Bot = heuristicBotWith(GUARD_WEIGHTS, 'guard-slots')
