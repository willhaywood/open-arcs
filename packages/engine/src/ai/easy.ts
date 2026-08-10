/**
 * The easy bot: the shipped judgement, minus its tie-breaking discipline.
 *
 * ## How it is weakened, and why this way
 *
 * Weakening a bot is easy to do badly. Random noise over all candidates produces the occasional
 * absurdity — cancelling battles, discarding for nothing — which reads as broken rather than
 * beatable, and pure noise is also non-deterministic, which multiplayer forbids (docs/03 section
 * 9a). This bot instead plays `STANDARD_WEIGHTS`, exactly what normal plays, and among candidates
 * scoring within `SLACK` of the best picks by a hash of public state rather than taking the top.
 *
 * The effect is a player with sound instincts and no polish: it never does anything the evaluator
 * prices as clearly bad, and it reliably fumbles the close calls — which is where the margins
 * live, and what a newer human opponent actually plays like.
 *
 * ## Why not the frozen baseline, which is what this used to be
 *
 * It read as the obvious choice — the weakest configuration that still plays a coherent game — and
 * it was wrong, because `BASELINE_WEIGHTS` is not "normal, weaker". It is **the bot from before
 * every goal-layer improvement**: income, declare-readiness, contest and the price of declaring are
 * all 0 in it, and so is the Weapon's battle option. So easy did not merely play worse, it was
 * blind to rules the other levels can see — it declared ambitions nobody could score (the exact
 * behaviour `leadZeroed` was shipped to stop, one game in five) and hoarded Weapons it would never
 * spend.
 *
 * Those are the tells that read as *broken* rather than *beatable*, which is the one thing this
 * file is trying not to be. Difficulty should come from choosing worse among close calls, not from
 * being unable to see the game. So easy now shares normal's evaluator and differs only by `SLACK`,
 * which is the single dial that makes it easy.
 *
 * ## Why the fumble cannot pick just anything
 *
 * The evaluator refuses a repeated action that does not strictly improve the position — the gate in
 * `heuristic.ts`, whose termination argument is that every repeat increases a bounded quantity, so a
 * turn cannot go round forever. That gate decides the inner bot's *pick*, but `considered` reports
 * every candidate including the ones it ruled out, and this bot's entire job is to discard the pick
 * and choose again from that list.
 *
 * So easy re-admitted exactly what the gate existed to exclude, and hung: arranging resource slots
 * and closing the menu are within `SLACK` of each other, neither writes to the log, and the hash
 * below reads only public state that a no-op leaves unchanged — so the same "random" choice came up
 * forever. One arena game in five never finished (49 of 240, against a control that lost none), and
 * because the app steps bots on a timer rather than through `runBots`, a real game did not crash but
 * simply never handed the turn back.
 *
 * The fix is to fumble within the gate's pool rather than around it, which inherits the termination
 * argument as it stands. It is not a property of these weights: the bot this replaced hung at the
 * same rate (12 of 40 games, against this one's 8 of 40).
 *
 * ## Deterministic without the journal
 *
 * Bots cannot read `state.rng` or the journal (`observe.ts` hides both, deliberately). The hash
 * draws on `log.length`, chapter, round and the deciding faction — public, identical on every
 * client, and different at essentially every decision — so two clients running this bot still
 * agree, and the same position always fumbles the same way.
 */

import { feasibility } from './feasibility.js'
import { STANDARD_WEIGHTS } from './goal.js'
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

/*
 * `feasibility` as well as the weights: normal judges chapter goals by what its position can
 * *produce*, and leaving easy on `structuralFitness` would keep it blind to that too — the same
 * mistake as the weights, one layer down.
 */
const inner = heuristicBotWith(STANDARD_WEIGHTS, 'easy-inner', feasibility)

export const easyBot: Bot = {
  id: 'easy',
  decide(observed, actions, lookahead): BotDecision {
    const decision = inner.decide(observed, actions, lookahead)
    const considered = decision.considered
    if (considered === undefined || considered.length < 2) return decision

    /*
     * Fumble only among candidates the gate would allow, and mirror the inner bot's fallback
     * exactly — everything, if the gate leaves nothing, which means the engine is offering only
     * no-ops and is a rule to fix rather than a decision to make.
     */
    const eligible = considered.filter((c) => c.eligible !== false)
    const pool = eligible.length > 0 ? eligible : considered
    if (pool.length < 2) return decision

    const best = Math.max(...pool.map((c) => c.score))
    const close = pool.filter((c) => c.score >= best - SLACK)
    if (close.length < 2) return decision

    const pick = close[publicHash(observed) % close.length]!
    return {
      action: pick.action,
      because: `${decision.because.split(' — ')[0] ?? 'easy'} — ${String(pick.action['label'] ?? pick.action.type)} (close enough)`,
      considered,
    }
  },
}
