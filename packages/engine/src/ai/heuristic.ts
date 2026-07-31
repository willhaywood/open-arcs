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

    const considered: Considered[] = []
    for (const action of actions) {
      const after = lookahead(action)
      if (after === undefined) continue
      considered.push({
        action,
        score: valueOf(after, observed.self, intent),
        note: topTerms(termsFor(after, observed.self, intent)),
      })
    }
    if (considered.length === 0) {
      return { action: first, because: `${intent.summary} — nothing could be evaluated` }
    }

    // Strictly greater, so the earliest of equal candidates wins — a stable, seedless tie-break.
    let best = considered[0]!
    for (const c of considered) if (c.score > best.score) best = c

    const runnerUp = considered.filter((c) => c !== best).sort((a, b) => b.score - a.score)[0]
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
