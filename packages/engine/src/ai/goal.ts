/**
 * The goal-layer bot: the baseline, plus what the position can earn.
 *
 * docs/19 section 4, step 1. Separate from `heuristicBot` rather than an edit to it, because
 * `heuristicBot` *is* the frozen baseline and a change that alters its behaviour is a new bot by
 * definition (`baseline.ts`). Adding the signal as features weighted zero by default means the two
 * differ by exactly these numbers and nothing else — which is the only way the arena can attribute a
 * difference to the idea rather than to whatever else moved.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { WEIGHTS } from './value.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

/**
 * Income priced against the resources it will become.
 *
 * A city on a Material planet is roughly one Material a turn for the rest of the chapter, so it is
 * worth some multiple of a held resource rather than a fraction of one — `resourcesDeclared` is
 * 0.45, and two or three turns of yield puts income near double that. The undeclared rate keeps the
 * same quarter-ish discount held resources use, since income toward an ambition nobody has declared
 * is a prospect rather than a prize.
 *
 * Starting points, like every weight here. The arena and the behavioural checks are what move them.
 */
export const GOAL_WEIGHTS: Weights = {
  ...WEIGHTS,
  incomeDeclared: 0.9,
  incomeUndeclared: 0.22,
}

export const goalBot: Bot = heuristicBotWith(GOAL_WEIGHTS, 'goal-income')

/**
 * Step 3 weights: readiness to declare, priced against the marker it would win.
 *
 * `declareReadiness` already returns marker-value scaled by how much the faction wants the ambition
 * and by its chance of leading, so this multiplier only says how much of that prospect to believe.
 * Half, to start: a declaration one lead away is worth real power, and it is still a chance rather
 * than a fact.
 */
export const DECLARE_WEIGHTS: Weights = { ...GOAL_WEIGHTS, declareReady: 0.5 }

export const declareBot: Bot = heuristicBotWith(DECLARE_WEIGHTS, 'goal-declare', feasibility)

/**
 * Step 4 weights: how *live* each declared ambition is, on top of everything before it.
 *
 * `standingContested` already carries the marker's value scaled by intent, so this multiplier only
 * says how much a contest is worth relative to a settled standing. A third, to start: a marker one
 * action from changing hands is worth real attention and is still not yours.
 */
export const CONTEST_WEIGHTS: Weights = { ...DECLARE_WEIGHTS, standingContested: 0.35 }

export const contestBot: Bot = heuristicBotWith(CONTEST_WEIGHTS, 'goal-contest', feasibility)

/**
 * Step 2: the same weights, but chapter goals judged by what the position can *produce*.
 *
 * Separate from `goalBot` so the arena can attribute a difference to feasibility rather than to
 * feasibility-and-income together — the two changes touch different halves of the bot, and rolling
 * them into one bot would make a null result unreadable.
 */
export const feasibilityBot: Bot = heuristicBotWith(GOAL_WEIGHTS, 'goal-feasible', feasibility)
