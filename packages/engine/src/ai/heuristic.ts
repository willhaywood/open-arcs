/**
 * V1: one-ply search over the value function, biased by chapter intent.
 *
 * This is docs/03 section 2's `chooseAction` — `maxBy(actions, a => value(advance(state, a)))` —
 * with the apply step supplied by the harness, since only it holds the full state (see `Lookahead`).
 *
 * Deterministic by construction: no RNG, and ties broken by the order the engine offered the
 * actions in. That is what lets any client run a bot in multiplayer without the game forking
 * (docs/03 section 9a), and it is why tie-breaking is positional rather than random.
 */

import { intentFor } from './intent.js'
import { WEIGHTS, termsFor, topTerms, valueOf } from './value.js'
import type { Weights } from './value.js'
import type { Action } from '../action.js'
import type { Bot, BotDecision, Considered, Lookahead } from './bot.js'
import type { ObservedState } from '../observe.js'

/**
 * What one unspent action pip is worth, in the same units as `valueOf`.
 *
 * Sized against the terms it competes with rather than guessed: a card is 0.15 of tempo, a Ship
 * 0.35, a City 2.0. A pip usually becomes a Move or a Build, so 0.5 prices it well above the card
 * it costs and well below the city it might become.
 *
 * A starting point, like every weight here — the arena is what moves it.
 */
const PIP_VALUE = 0.5

/**
 * Backing out of something already begun. A bot never does this: a decision is final.
 *
 * Cancel exists for a *human* who clicked into the battle screen and changed their mind. It is an
 * interface affordance, not a move, and offering it to an evaluator was actively harmful — landing
 * mid-battle leaves no pip ask to read, so `actionsAhead` reported 0 for every roll and 1 for the
 * `Cancel` beside it, paying the bot half a pip to abandon each fight. It cancelled 31 battles for
 * every 4 it rolled, while the trivial bot fought all 28 of its own.
 *
 * **Keyed on the label, because the type cannot tell them apart.** `action/skip` is `Cancel` when it
 * abandons an action and `Done` or `Stop here` when it completes one — the same type, opposite
 * meanings — and a leader's exit is `Cancel` before it places anything and `Done` after. The label
 * is the distinction the engine actually draws, so it is the one to read. `battle/cancel` is matched
 * by type as well, since it can never mean anything else.
 *
 * A renamed label degrades rather than breaks: the bot could consider cancelling again, which is a
 * weaker bot, not a stuck one.
 */
export function refuses(action: Action): boolean {
  return action.type === 'battle/cancel' || action['label'] === 'Cancel'
}

function describe(action: Action): string {
  return String(action['label'] ?? action.type)
}

/**
 * V1 with a given set of evaluator weights.
 *
 * Exists so a fitted set can be played against the hand-set one in the same match — the only way to
 * find out whether fitting produced a better *player* rather than merely a better predictor of the
 * outcome under the policy that generated the data.
 */
export function heuristicBotWith(weights: Weights, id = 'heuristic-v1'): Bot {
  return {
  id,
  decide(observed: ObservedState, actions: readonly Action[], lookahead?: Lookahead): BotDecision {
    const first = actions[0]
    if (first === undefined) throw new Error('heuristicBot: no actions on offer')

    const intent = intentFor(observed, observed.self)

    /*
     * Without lookahead there is nothing to evaluate — scoring an action without applying it is
     * HRF's mistake (docs/03 section 2). Degrade to the first offer and say so, rather than
     * inventing a ranking the value function cannot support.
     */
    if (lookahead === undefined) {
      return { action: first, because: `${intent.summary} — no lookahead available` }
    }

    /*
     * The position as it stands, which is what a repeating action has to beat.
     *
     * `valueOf` needs no lookahead, so this is free — and it is the only reference point that makes
     * "did that achieve anything" answerable at all.
     */
    const here = valueOf(observed, observed.self, intent, weights)

    /*
     * Rollbacks are dropped before anything is weighed, so they cannot win on score or on a
     * tie-break. Kept as a fallback only if they are somehow all that is offered, which would be a
     * rule to fix rather than a decision to make.
     */
    const live = actions.filter((a) => !refuses(a))
    const choices = live.length > 0 ? live : actions

    const considered: Considered[] = []
    const stuck = new Set<Action>()
    for (const action of choices) {
      const probe = lookahead(action)
      if (probe === undefined) continue
      /*
       * What the turn still has to spend, priced. Added here rather than in `valueOf` because pips
       * are not in the state at all (see `Probe.actionsAhead`), so the value function cannot reach
       * them — this is the one term that has to live outside it.
       *
       * **Without it the bot will not lead.** Leading costs a card, which the tempo term charges
       * 0.15 for, and buys three actions, which nothing counted; so every card scored below `Pass`
       * and three heuristic bots produced 2.5 mean power against the trivial bot's 10.7. Reaching
       * the pip ask was not enough on its own — the board has not moved there either, so the
       * position looks identical until the pips themselves are priced.
       *
       * A flat rate is crude: a pip is worth what you do with it, and Build and Move are not the
       * same. It is deliberately the *cheap* answer, and the honest one is a rollout (V2). This is
       * a weight for the arena to move — docs/19 section 2d.7.
       */
      /*
       * Averaged over the samples, which is what makes a random outcome a judgement about odds
       * rather than about one imaginary roll. For everything deterministic there is exactly one
       * sample and this is the same arithmetic as before.
       */
      const gained =
        probe.samples.reduce((n, s) => n + valueOf(s, observed.self, intent, weights), 0) /
        probe.samples.length
      const score = gained + probe.actionsAhead * PIP_VALUE
      /*
       * **A repeating action must strictly improve the position to be eligible at all.**
       *
       * Gated on `gained`, not on `score`, and the difference is not cosmetic — getting it wrong
       * brought the livelock straight back. `here` is the board as it stands and has no pip term,
       * so comparing the pip-inclusive score against it made *every* candidate look like an
       * improvement and the gate never fired. The gate asks "did that achieve anything", and pips
       * still to spend are potential rather than achievement.
       *
       * A tie-break is not enough, and the arena showed why on its first real run. Arranging
       * resource slots offers value-neutral swaps alongside options that place the arriving token by
       * *discarding* something — which score strictly lower. So the swaps were not merely tied for
       * best, they *were* the best, and the bot swapped two tokens back and forth for twenty
       * thousand actions without leaving chapter one.
       *
       * Gating on the current position rather than on rival candidates is what makes termination a
       * property instead of a hope: every repeat strictly increases a bounded quantity, so a turn
       * cannot go round forever. It still permits honest re-entry — taking one pip of three comes
       * back to a *different* question anyway, and anything that genuinely gains passes the gate.
       */
      if (probe.repeats && gained <= here) stuck.add(action)
      considered.push({
        action,
        score,
        note:
          topTerms(termsFor(probe.observed, observed.self, intent, weights)) +
          (probe.samples.length > 1 ? ` [${probe.samples.length} rolls]` : '') +
          (probe.repeats ? ' [same question]' : ''),
      })
    }
    if (considered.length === 0) {
      return { action: first, because: `${intent.summary} — nothing could be evaluated` }
    }

    /*
     * Eligible candidates first; fall back to everything only if the engine offers nothing but
     * no-ops, which would be a rule to fix rather than a decision to make.
     */
    const eligible = considered.filter((c) => !stuck.has(c.action))
    const pool = eligible.length > 0 ? eligible : considered

    // Strictly greater, so the earliest of equal candidates wins — a stable, seedless tie-break.
    let best = pool[0]!
    for (const c of pool) if (c.score > best.score) best = c

    // The margin is over the candidates it was actually choosing between, not over ones it ruled out.
    const runnerUp = pool.filter((c) => c !== best).sort((a, b) => b.score - a.score)[0]
    const margin = runnerUp === undefined ? undefined : best.score - runnerUp.score
    const close = margin !== undefined && margin < 0.05

    return {
      action: best.action,
      because:
        `${intent.summary} — ${describe(best.action)}` +
        (close ? ' (a close call)' : margin === undefined ? '' : ` (+${margin.toFixed(1)})`),
      considered,
    }
  },
  }
}

/** V1 as shipped, with the hand-set weights. */
export const heuristicBot: Bot = heuristicBotWith(WEIGHTS)
