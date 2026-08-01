/**
 * The frozen current-best bot, kept so every later change has something to be measured against.
 *
 * **The rule is that this never changes.** A change that would alter its behaviour is a *new* bot,
 * not an edit to this one. Without that the baseline drifts along with whatever is under test and no
 * comparison means anything — `heuristicBot` today is far stronger than `heuristicBot` at the start
 * of docs/19 section 2, and if the goal layer (section 4) edits the same code path there would be
 * nothing left to compare it to.
 *
 * It is the configuration that, as of docs/19 section 3, beat every alternative measured: the
 * trivial bot 100–0, every fitted weight set by 46 points, and V2 rollouts on mean power in all
 * three of their configurations.
 *
 * Drift is *caught* rather than trusted — `test/baseline.test.ts` plays fixed seeds and asserts exact
 * outcomes, so an accidental change to the shared evaluator fails loudly and names itself.
 */

import { heuristicBotWith } from './heuristic.js'
import { WEIGHTS } from './value.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

/**
 * The hand-set weights as they stood when this baseline was taken.
 *
 * Copied rather than referenced *on purpose*: `WEIGHTS` is the live set and is expected to move, and
 * a baseline that follows it is not a baseline. The golden test is what proves the two have not
 * silently diverged in the code around them.
 */
export const BASELINE_WEIGHTS: Weights = {
  power: 1,
  standing: 1,
  resourcesDeclared: 0.45,
  resourcesUndeclared: 0.1125,
  // Off in the baseline by definition: it predates income projection entirely.
  incomeDeclared: 0,
  incomeUndeclared: 0,
  declareReady: 0,
  standingContested: 0,
  weapons: 0.25,
  cities: 2.0,
  starports: 1.2,
  shipsFresh: 0.35,
  shipsDamaged: 0.1,
  courtSecured: 1,
  courtClaimAhead: 0.25,
  courtClaimLevel: 0.12,
  courtClaimBehind: 0.05,
  trophies: 0.3,
  captives: 0.3,
  tempo: 0.15,
}

/** True while the live weights still match the snapshot; the golden test reports when they do not. */
export const weightsMatchBaseline = (): boolean =>
  (Object.keys(BASELINE_WEIGHTS) as (keyof Weights)[]).every(
    (k) => WEIGHTS[k] === BASELINE_WEIGHTS[k],
  )

/** The frozen best bot. `--seats baseline` in the arena. */
export const baselineBot: Bot = heuristicBotWith(BASELINE_WEIGHTS, 'baseline')
