/**
 * Step: stop the fleet undoing its own moves.
 *
 * The evaluator cannot see where a ship stands — no feature reads position — so every Move
 * candidate at every Move ask scores identically, the strictly-greater tie-break keeps the
 * earliest offer, and the board's adjacency lists walk the fleet in circles: measured at 14% of
 * all moves being same-round A-to-B-to-A reversals under `standardBot`, with sampled catapult
 * chains returning to their own origin. The prompt-repeat guard only ever blocked the *third*
 * leg, which is why the shape was always a round trip.
 *
 * `mobileBot` is `standardBot` plus one action-level term: `moveReversal`, a penalty on a
 * movement leg that exactly undoes one this faction already made this turn (`Probe.undoes`,
 * fed by the turn's move memory in `AskedThisTurn`). Probe games: reversals go from 14% of
 * moves to zero. Arena, 240 games against `standardBot` with a twin: 33/31/35 — parity against
 * a 2-point noise gap, so the cleanup costs nothing.
 *
 * The fuller idea — positional *pull* (gates held, a graded proximity field toward rivals and
 * unexploited resources) — was built and measured OFF: 28% wins against standard's 43%, plus
 * 41 unfinished games, and its probe machinery (a peek through the fleet-size step) let
 * `battleUnlocked` see positions and shifted the standard drive. The features remain in
 * `value.ts` at weight zero with the measurement recorded; making them pay is future work.
 */

import type { Bot } from './bot.js'
import { heuristicBotWith } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import { feasibility } from './feasibility.js'
import type { Weights } from './value.js'

export const MOBILE_WEIGHTS: Weights = {
  ...STANDARD_WEIGHTS,
  /*
   * The positional pulls (gatesHeld 0.25 / fleetThreat 0.04) were measured OFF: with them on,
   * mobile took 28% of wins against standard's 43% over 199 finished arena games (twin gap one
   * point) — purposeful-looking movement bought by pips that standard spends on the economy.
   * The reversal penalty alone keeps the anti-circling behaviour without the strategic drag.
   */
  gatesHeld: 0,
  fleetThreat: 0,
  moveReversal: 1,
}

export const mobileBot: Bot = heuristicBotWith(MOBILE_WEIGHTS, 'mobile', feasibility)
