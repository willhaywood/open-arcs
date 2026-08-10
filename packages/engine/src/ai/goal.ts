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
 * Step 5 weights: the expansion's ambition-paired lore, held versus switched on.
 *
 * Ten cards (lore19-28) do nothing until the ambition they name is declared, by anyone. Two weights
 * rather than one because **the gap between them is the whole mechanism**: the bot values a declare
 * by valuing the position it produces, and declaring is what converts an armed card to a live one,
 * so `loreLive - loreArmed` is precisely the pull toward declaring what your lore wants. One scaled
 * count could not express it.
 *
 * **Measured, and it loses.** `loreBot` finishes 2-3 points of win rate and ~0.9 power *behind*
 * `contestBot` — the same bot without these weights — against a twin floor of 0-1 point, over 999
 * games. Both variants tried lose by the same margin: the flat count these weights were first set
 * for, and the `bias`-scaled version now in `value.ts`, which was meant to stop the pull arguing
 * with `feasibility` and did not help at all (docs/19 section 3k).
 *
 * So this bot exists to document a negative, not to be played. The weights stay at 0 in `WEIGHTS`;
 * what is proven is that the evaluator *can* tell a live card from a dormant one, not that acting on
 * the difference is worth anything. Before reviving it, read 3k — the likeliest explanation is that
 * a live card's benefit already reaches the evaluator through its effects on the board, making this
 * a second price for something already counted.
 */
export const LORE_WEIGHTS: Weights = { ...CONTEST_WEIGHTS, loreLive: 0.6, loreArmed: 0.2 }

export const loreBot: Bot = heuristicBotWith(LORE_WEIGHTS, 'goal-lore', feasibility)

/**
 * What declaring costs, weighed against what it earns.
 *
 * Built on `CONTEST_WEIGHTS` rather than on the lore weights, which measured worse (section 3k).
 *
 * An audit of 40 games found the shipped bot declaring 8.7 times a game and the *frozen baseline*
 * 12.8 — winning those at 34% against a 33% chance line, which is to say its declarations were worth
 * nothing. The cause is not that it declares badly on the merits; it is that declaring was **free**.
 * Zeroing the played card costs the initiative fight, and no feature read `lead.zeroed`, so a
 * hopeless declaration and a skip came out ~0.001 apart on values near 0.76 and the tie-break took
 * the marker.
 *
 * `-0.35` per point of surrendered strength, to start: zeroing a 4 costs about 1.4 power of
 * expected value, near a fresh ship, which is the order of what losing the initiative is worth.
 * High enough that a declaration has to earn its place, low enough that a real prospect still buys
 * it — declaring already moves income from `incomeUndeclared` (0.22) to `incomeDeclared` (0.9), so
 * a speculative declare backed by taxable cities keeps paying for itself.
 *
 * Starting point, like every weight here, and two of the last three ideas measured as nothing or
 * worse (sections 3j, 3k). The arena is owed a run with its twin before any of this is believed.
 */
export const DECLARE_COST_WEIGHTS: Weights = { ...CONTEST_WEIGHTS, leadZeroed: -0.35 }

export const declareCostBot: Bot = heuristicBotWith(DECLARE_COST_WEIGHTS, 'goal-cost', feasibility)

/**
 * **What the game ships.** One name for "the bot a human plays against", so that is a decision
 * rather than whichever import `store.ts` happened to reach for.
 *
 * Everything the goal layer measured as good, and nothing it measured as bad:
 *
 *   - income (`GOAL_WEIGHTS`), declare-readiness (`DECLARE_WEIGHTS`) and contest
 *     (`CONTEST_WEIGHTS`), each added and measured in turn — docs/19 section 4.
 *   - the price of declaring (`leadZeroed`), which is the one below.
 *
 * **Deliberately excluded**, both measured and both left at 0 in `WEIGHTS`:
 *
 *   - `loreLive` / `loreArmed` — 2-3 points of win rate *worse* against a 0-1 point floor, in two
 *     variants (section 3k). Shipping it would knowingly weaken the bot.
 *   - `resourcesGuarded` — no measurable effect either way (section 3j). Left off because a change
 *     with no evidence behind it is a change that cannot be defended later, not because it harms.
 *
 * **On `leadZeroed`, be precise about what it bought.** It did *not* measurably improve strength:
 * 999 games against `contestBot` came out +1 point of win rate, the twin control 2 points, and a
 * second run put it 2 points the other way — noise, twice over. What it changed is behaviour a
 * human sees. Declarations on ambitions *nobody* could score went 13-21% to **zero**, declared-and-won
 * rose from 58% to 65% against a 33% chance line, and declarations fell from 8.7 a game to 6.7.
 * A bot burning its played card on an Empath nobody holds a Psionic for looks broken, and it did
 * that one time in five. That is the case for shipping it, and it is an opponent-quality case
 * rather than a strength one.
 *
 * The known cost: it declares from a lead 87% of the time, up from 68%, so it banks more and
 * gambles less. If the striving behaviour matters more than the tidiness, `-0.2` removes the dead
 * declarations without pushing it that far.
 */
/**
 * The Weapon's battle option, shipped on **opponent quality rather than strength** — the same
 * standing `leadZeroed` has, and stated the same way.
 *
 * It measured a null: 34% wins against standard's 33% on a 1-point twin floor, identical mean rank
 * (docs/19 section 9). What it changes is behaviour a player sees. Spending a Weapon buys the Battle
 * option on the played card and nothing else, and no feature read that flag, so the bot declined 271
 * offers out of 274 and sat on Weapons all game. That was reported from real play, and a bot hoarding
 * four Weapons it will never use looks broken in exactly the way a bot declaring an Empath nobody
 * holds a Psionic for does.
 *
 * Weapon spending goes 1% to 26%, overall Prelude spending 23% to 29%, mean Weapons held 0.69 to
 * 0.32. None of that is a strength claim and it must not be cited as one.
 */
export const STANDARD_WEIGHTS: Weights = { ...DECLARE_COST_WEIGHTS, battleUnlocked: 0.6 }

export const standardBot: Bot = heuristicBotWith(STANDARD_WEIGHTS, 'standard', feasibility)

/**
 * Step 2: the same weights, but chapter goals judged by what the position can *produce*.
 *
 * Separate from `goalBot` so the arena can attribute a difference to feasibility rather than to
 * feasibility-and-income together — the two changes touch different halves of the bot, and rolling
 * them into one bot would make a null result unreadable.
 */
export const feasibilityBot: Bot = heuristicBotWith(GOAL_WEIGHTS, 'goal-feasible', feasibility)
