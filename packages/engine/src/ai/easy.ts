/**
 * The easy bot: the frozen baseline's judgement, minus its tie-breaking discipline.
 *
 * ## How it is weakened, and why this way
 *
 * Weakening a bot is easy to do badly. Random noise over all candidates produces the occasional
 * absurdity — cancelling battles, discarding for nothing — which reads as broken rather than
 * beatable, and pure noise is also non-deterministic, which multiplayer forbids (docs/03 section
 * 9a). This bot instead plays the **baseline evaluator** (no goal layer, no declare-cost — the
 * weakest configuration that still plays a coherent game) and, among candidates scoring within
 * `SLACK` of the best, picks by a hash of public state rather than taking the top.
 *
 * The effect is a player with sound instincts and no polish: it never does anything the evaluator
 * prices as clearly bad, and it reliably fumbles the close calls — which is where the margins
 * live, and what a newer human opponent actually plays like.
 *
 * ## Deterministic without the journal
 *
 * Bots cannot read `state.rng` or the journal (`observe.ts` hides both, deliberately). The hash
 * draws on `log.length`, chapter, round and the deciding faction — public, identical on every
 * client, and different at essentially every decision — so two clients running this bot still
 * agree, and the same position always fumbles the same way.
 */

import { BASELINE_WEIGHTS } from './baseline.js'
import { heuristicBotWith } from './heuristic.js'
import type { Bot, BotDecision } from './bot.js'
import type { ObservedState } from '../observe.js'

/** Candidates within this much of the best are "close enough" for easy to shrug between. */
const SLACK = 0.8

/** A small deterministic hash over public, always-available state. */
function publicHash(observed: ObservedState): number {
  const s = `${observed.log.length}:${observed.chapter}:${observed.round}:${observed.self}`
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

const inner = heuristicBotWith(BASELINE_WEIGHTS, 'easy-inner')

export const easyBot: Bot = {
  id: 'easy',
  decide(observed, actions, lookahead): BotDecision {
    const decision = inner.decide(observed, actions, lookahead)
    const considered = decision.considered
    if (considered === undefined || considered.length < 2) return decision

    const best = Math.max(...considered.map((c) => c.score))
    const close = considered.filter((c) => c.score >= best - SLACK)
    if (close.length < 2) return decision

    const pick = close[publicHash(observed) % close.length]!
    return {
      action: pick.action,
      because: `${decision.because.split(' — ')[0] ?? 'easy'} — ${String(pick.action['label'] ?? pick.action.type)} (close enough)`,
      considered,
    }
  },
}
