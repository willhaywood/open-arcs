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

import { interceptionRisk } from '../rules/battle.js'
import { intentFor, structuralFitness } from './intent.js'
import type { Fitness } from './intent.js'
import { WEIGHTS, termsFor, topTerms, valueOf } from './value.js'
import type { RivalIntent, Weights } from './value.js'
import type { Action } from '../action.js'
import type { Bot, BotDecision, Considered, Lookahead } from './bot.js'
import type { ObservedState } from '../observe.js'
import type { ColorId, SystemId } from '../ids.js'

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
 * What a point of interception risk costs, per expected hit.
 *
 * **This is a risk premium, not a missing expectation.** The sampled mean in `gained` already
 * includes interception on the rolls where it fired, so this is not correcting a term the evaluator
 * cannot see. It corrects a *selection* bias: with `SAMPLES` at 5 and a gather menu offering up to
 * ~84 pools, taking the argmax of noisy estimates systematically favours whichever option's noise
 * ran favourable — and interception, a 1-in-6 event costing one hit per fresh defending ship, is by
 * far the largest variance source among them. Penalising by risk is what stops the luckiest sample
 * winning.
 *
 * Measured cause: the bot left dice unused in 20% of battles (2.03 dice on average), and the
 * indefensible cases were all the same shape — swapping skirmish dice for a single assault die on
 * margins of 0.01 to 0.08, buying 0.17 expected hits for 0.5 self-hits and a 1-in-6 chance of
 * losing one ship per fresh defender.
 *
 * Sized at roughly half what a hit on our own ships is worth — a hit damages a fresh Ship
 * (0.35 to 0.1) or destroys a damaged one into the *defender's* trophies (rulebook p14, so 0.1 plus
 * 0.3 the other way) — precisely because the mean is already sampled and only the variance needs
 * pricing. A starting point, like every weight here; the arena is what moves it.
 */
const INTERCEPT_RISK = 0.15

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
export interface HeuristicOptions {
  /**
   * Score each rival under the intent *they* would derive, rather than under this bot's own.
   *
   * Off by default: the frozen baseline scores everyone with one intent, and the golden test pins
   * that behaviour. `true` judges rivals by the same `fitness` this bot judges itself with — see
   * `RivalIntent` in `value.ts` for why the difference is what makes denial visible.
   *
   * Also accepts the function itself. That exists for the tests, and the reason is worth keeping:
   * a mutation that computed the *acting* faction's intent inside the lambda — the one-token
   * mistake this option makes possible — passed every test that only compared against the default,
   * because recomputing anyone's intent on the probed state moves the same decisions. The wrong
   * variant has to be constructible for a test to pin the difference between it and the right one.
   */
  readonly rivalIntent?: boolean | RivalIntent
}

export function heuristicBotWith(
  weights: Weights,
  id = 'heuristic-v1',
  /** How chapter goals are judged. Swappable so a stronger answer can be measured against the frozen one. */
  fitness: Fitness = structuralFitness,
  opts: HeuristicOptions = {},
): Bot {
  const explicitRival: RivalIntent | undefined =
    typeof opts.rivalIntent === 'function' ? opts.rivalIntent : undefined
  return {
  id,
  decide(observed: ObservedState, actions: readonly Action[], lookahead?: Lookahead): BotDecision {
    const first = actions[0]
    if (first === undefined) throw new Error('heuristicBot: no actions on offer')

    const intent = intentFor(observed, observed.self, fitness)
    /*
     * Rival intents are computed **once per decision, from the pre-action state**, and held fixed
     * while every candidate is scored. The first version recomputed them on each probed state —
     * "my action can change a rival's position, so read their intent off the position it produces"
     * — and that reasoning was measured wrong twice over:
     *
     *   - **It let candidates move the measuring stick.** A rival's `contest()` reads *my*
     *     holdings, so discarding my own Material shifted their recomputed intent, repriced their
     *     whole position, and netted +0.018 — the bot paid real resources to twitch an imputed
     *     number. This is the anti-flap rule (docs/19 section 2b) violated from the other side:
     *     rival intent read things that move across my own actions.
     *   - **It broke the livelock gate.** The strictly-improving-repeat rule terminates because
     *     every repeat increases a bounded quantity — which requires `valueOf` to be one fixed
     *     function per decision. With intents shifting under each candidate it was not, and seed
     *     245 in the arena cycled Prelude → arrange → swap → Done for 20,000 actions.
     *
     * Fixed per decision, both hold again: no candidate can differ by intent-shift alone, and the
     * gate's bounded quantity is a real one.
     */
    const rivalIntent: RivalIntent | undefined =
      opts.rivalIntent === true
        ? (() => {
            const views = new Map(
              observed.factions
                .filter((f) => f !== observed.self)
                .map((f) => [f, intentFor(observed, f, fitness)] as const),
            )
            return (_probed, rival) => views.get(rival) ?? intent
          })()
        : explicitRival

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
    const here = valueOf(observed, observed.self, intent, weights, rivalIntent)

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
        probe.samples.reduce(
          (n, s) => n + valueOf(s, observed.self, intent, weights, rivalIntent),
          0,
        ) / probe.samples.length
      /*
       * Risk premium on a dice pool, from the rules' own face counts. Added here rather than in
       * `valueOf` for the same reason the pip term is: a pool is a property of the *action*, and
       * the value function only ever sees positions.
       */
      const risk =
        action.type === 'battle/roll'
          ? interceptionRisk(
              observed,
              action['system'] as SystemId,
              action['enemy'] as ColorId,
              Number(action['assault'] ?? 0),
              Number(action['raid'] ?? 0),
            )
          : undefined
      const exposure = risk === undefined ? 0 : risk.chance * risk.hits * INTERCEPT_RISK
      // Undoing this turn's own movement leg pays twice for nothing; weighted, zero in the
      // baseline, so the term is inert everywhere it has not been measured on.
      const undo = probe.undoes === true ? (weights.moveReversal ?? 0) : 0
      const score = gained + probe.actionsAhead * PIP_VALUE - exposure - undo
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
      const ineligible = probe.repeats && gained <= here
      if (ineligible) stuck.add(action)
      considered.push({
        action,
        score,
        eligible: !ineligible,
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
