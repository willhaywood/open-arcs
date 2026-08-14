/**
 * The declaration-threat bot: the shipped weights, plus a price on the pending declaration.
 *
 * ## The blind spot this closes
 *
 * The standing terms loop over `observed.declared`, and `declareReady` is guarded to self — so a
 * rival one lead away from declaring an ambition they dominate was priced at exactly zero. docs/19
 * section 18 has the game that exposed it: chapter 5, the oracle 12-0 against an evaluator margin
 * of 11.5, where yellow's undeclared Keeper plus the last worthwhile marker was the entire match
 * and the winning move was to consume that marker.
 *
 * Unlike every previous feature candidate, this one arrives with section 15's bar already met: a
 * specific lost game the feature must flip, pinned in `decl-threat.test.ts`. The weight below was
 * chosen by that pin — the smallest probed value that flips the decision — not by argument alone.
 *
 * ## Why a new bot rather than a change to `standardBot`
 *
 * The same reason as `weapon.ts` and `hand.ts` before it: `undeclaredThreat` is weight **0** in
 * `WEIGHTS`, so `standardBot` and the frozen baseline stay byte-identical and the arena can
 * attribute any difference to this idea alone. Sections 3j-3k, 6, 12 and 15 are the register's
 * reminder of how often ideas this plausible measure as nothing or worse.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

export const THREAT_WEIGHTS: Weights = { ...STANDARD_WEIGHTS, undeclaredThreat: 1 }

export const threatBot: Bot = heuristicBotWith(THREAT_WEIGHTS, 'decl-threat', feasibility)
