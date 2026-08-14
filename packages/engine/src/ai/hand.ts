/**
 * The hand-quality bot: the shipped weights, plus a price on the hand's actual cards.
 *
 * ## The blind spot this closes
 *
 * The evaluator's only hand feature is `tempo` — a count. `{Aggression-7, Construction-6}` and
 * `{Administration-1, Mobilization-2}` score identically, and so does every pair of candidate card
 * plays that buys the same board this turn while leaving those two different hands behind. The card
 * play is the highest-weight decision in the game (docs/19 section 2d): the beam prices what the
 * *played* card buys, `leadZeroed` prices what declaring surrenders, and nothing prices the
 * **residual hand** at all.
 *
 * This is the register's one repeatedly-winning shape — information that is legal, already in
 * `ObservedState`, and unpriced — as against the five consecutive re-pricings that measured null or
 * worse (docs/19 sections 3j, 3k, 6, 12). No strength claim is made until the arena's twin protocol
 * says otherwise.
 *
 * ## Why these two weights
 *
 * Sized against the decision they must flip rather than guessed. Choosing which card to spend moves
 * residual `handPips` by 2-3 (a low card carries 3-4 pips, a high card 1-2), so 0.1/pip puts a
 * 0.2-0.3 swing against measured card-play margins of ~0.13-0.22 median — big enough to bite, an
 * order of magnitude under a city (2.0). Spending the hand's top card past a 3-4 point drop in
 * `handTopCard` at 0.08 is a comparable 0.24-0.32. Starting points, like every weight here; the
 * arena is what moves them.
 *
 * ## Why a new bot rather than a change to `standardBot`
 *
 * The same reason as `weapon.ts` and every step before it: both features are weight **0** in
 * `WEIGHTS`, so `standardBot` and the frozen baseline stay byte-identical and the arena can
 * attribute any difference to this idea alone.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

export const HAND_WEIGHTS: Weights = { ...STANDARD_WEIGHTS, handPips: 0.1, handTopCard: 0.08 }

export const handBot: Bot = heuristicBotWith(HAND_WEIGHTS, 'hand-quality', feasibility)
