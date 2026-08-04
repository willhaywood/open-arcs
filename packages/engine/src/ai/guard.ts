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
 * ## What to expect when measuring it, before running anything
 *
 * Raids are not rare — a measured 8 baseline games saw **3.9 resources stolen per game** and 18.8
 * arrange menus faced — so the decision has real surface area. But the effect is narrow: this does
 * not stop raids, it changes *which* token is taken, a few times a game. Against the recorded noise
 * floor (two identical configurations, 30 games rotated, **20 points of win rate apart**) that is
 * unlikely to separate at small game counts. Measure on mean power with a `--noise` twin over
 * several hundred games, and treat anything inside the twin gap as unproven — the register in
 * docs/19 section 0 exists because a result that looked good on one seed evaporated on another.
 *
 * ## The claim that does not need an arena run
 *
 * Independent of whether it wins more games: before this, **no feature read the arrangement**, so
 * every ordering of a row scored identically. The bot could not prefer a good arrangement and,
 * more to the point, had no reason to *stop* rearranging. This gives the decision a gradient and
 * therefore a terminating condition.
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
