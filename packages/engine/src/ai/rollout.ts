/**
 * V2: judging a card by playing the round out, rather than by pricing what it buys.
 *
 * docs/19 section 3. V1 scores a lead at the moment the pips are *about* to be spent and prices them
 * at a flat `PIP_VALUE`, which is the crudest weight in the bot: a pip is worth what you do with it,
 * and Build and Move are not the same thing. A rollout answers that by playing rather than pricing,
 * and it is the only thing here that can see a rival *reply* — no static evaluator can.
 *
 * ## Where the budget is spent, and why not everywhere
 *
 * **Only at the card-play decision**, and the first reason is not cost:
 *
 *   - It is the **highest-weight decision in the game** (docs/19 section 2d.1) and the one V1 still
 *     settles with a flat rate. Everything downstream — which action, which target — V1 already
 *     resolves by playing it out a ply (section 2j), so a rollout adds far less there.
 *   - Measured: the engine runs at 0.049 ms/action and a game is ~700 decisions, so rolling out
 *     every decision is minutes per game. Confined to the card play it is ~70 decisions a game.
 *
 * Everything else delegates to `heuristicBot` — not a compromise but the shape docs/03 section 2
 * argues for: search where it pays, evaluate where it does not.
 *
 * ## The playout policy is deliberately weak, and that is the honest caveat
 *
 * Playouts run on `trivialBot` — first legal action — because a stronger policy costs a lookahead
 * per step and multiplies the rollout by the branching factor, which the budget will not carry.
 *
 * `trivialBot` is not merely weak, it is **biased**: it takes whatever the engine offers first. So a
 * rollout measures "how does this fare under a fixed, arbitrary continuation", which is a better
 * question than V1's flat rate and a worse one than "under good play". Whether that trade is worth
 * anything is a question for the arena, not for argument.
 */

import { heuristicBot } from './heuristic.js'
import { intentFor } from './intent.js'
import { valueOf } from './value.js'
import type { Action } from '../action.js'
import type {
  Bot,
  BotDecision,
  Considered,
  Lookahead,
  Rollout,
  RolloutOptions,
} from './bot.js'
export type { RolloutOptions }
import type { ObservedState } from '../observe.js'

/** The decision this exists for: which card to play, or whether to sit the round out. */
const CARD_PLAY = ['turn/lead', 'turn/pivot', 'turn/copy', 'turn/surpass', 'turn/pass']

/** Is this the card-play decision? Exported so the harness spends its budget on the same asks. */
export function isCardPlay(actions: readonly Action[]): boolean {
  return actions.some((a) => CARD_PLAY.includes(a.type))
}

export const DEFAULT_ROLLOUT: RolloutOptions = { samples: 4, lookaheadTurns: 2, maxSteps: 400 }

/**
 * V2. Rolls out the card-play decision; delegates everything else to V1.
 *
 * The `id` names the shape rather than the weights, so an arena table stays readable as the options
 * move — and so two configurations can be run against each other in one match.
 */
export function rolloutBot(options: RolloutOptions = DEFAULT_ROLLOUT): Bot {
  return {
    id: `rollout-v2(${options.samples}x${options.untilChapterEnd === true ? 'chapter' : options.lookaheadTurns})`,
    decide(
      observed: ObservedState,
      actions: readonly Action[],
      lookahead?: Lookahead,
      rollout?: Rollout,
    ): BotDecision {
      /*
       * Degrade to V1 rather than throwing when this is not the decision rollouts are for, or when
       * the harness cannot roll out. A bot with no search is a weaker bot, not a broken game — the
       * same rule `Lookahead` follows.
       */
      if (rollout === undefined || !isCardPlay(actions)) {
        return heuristicBot.decide(observed, actions, lookahead)
      }

      const intent = intentFor(observed, observed.self)
      const considered: Considered[] = []

      for (const action of actions) {
        const outcomes = rollout(action, options)
        if (outcomes.length === 0) continue
        considered.push({
          action,
          score:
            outcomes.reduce((n, o) => n + valueOf(o, observed.self, intent), 0) / outcomes.length,
          note: `${outcomes.length} playouts, ${options.untilChapterEnd === true ? 'to chapter end' : `${options.lookaheadTurns} turns on`}`,
        })
      }

      // Nothing rolled out — fall back rather than invent a ranking from an empty set.
      if (considered.length === 0) return heuristicBot.decide(observed, actions, lookahead)

      // Strictly greater, so the earliest of equal candidates wins — V1's stable tie-break.
      let best = considered[0]!
      for (const c of considered) if (c.score > best.score) best = c

      const runnerUp = considered.filter((c) => c !== best).sort((a, b) => b.score - a.score)[0]
      const margin = runnerUp === undefined ? undefined : best.score - runnerUp.score

      return {
        action: best.action,
        because:
          `${intent.summary} — ${String(best.action['label'] ?? best.action.type)}` +
          (margin === undefined ? '' : ` (+${margin.toFixed(1)} over ${options.samples} playouts)`),
        considered,
      }
    },
  }
}
