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
import { termsFor, topTerms, valueOf } from './value.js'
import type { Action } from '../action.js'
import type { Bot, BotDecision, Considered, Lookahead } from './bot.js'
import type { ObservedState } from '../observe.js'

function describe(action: Action): string {
  return String(action['label'] ?? action.type)
}

export const heuristicBot: Bot = {
  id: 'heuristic-v1',
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
    const here = valueOf(observed, observed.self, intent)

    const considered: Considered[] = []
    const stuck = new Set<Action>()
    for (const action of actions) {
      const probe = lookahead(action)
      if (probe === undefined) continue
      const score = valueOf(probe.observed, observed.self, intent)
      /*
       * **A repeating action must strictly improve the position to be eligible at all.**
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
      if (probe.repeats && score <= here) stuck.add(action)
      considered.push({
        action,
        score,
        note:
          topTerms(termsFor(probe.observed, observed.self, intent)) +
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
