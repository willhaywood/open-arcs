/**
 * What a bot is, and the trivial one.
 *
 * The interfaces here are the ones docs/03 section 2 argues for and docs/19 section 2a settles.
 * They are deliberately fixed *before* any evaluation exists, because every one of them is
 * expensive to widen once call sites depend on the narrow version:
 *
 *   - A bot returns a **`BotDecision`, not an `Action`.** The reason has to come from the code that
 *     made the choice — reconstructing it afterwards from the board is guesswork that will
 *     eventually narrate something untrue (docs/19 section 2a). Retrofitting this once the UI, the
 *     arena and the diagnostic panel all expect a bare `Action` means touching all three.
 *   - A bot takes **`ObservedState`, never `GameState`.** Cheating is then a compile error rather
 *     than an oversight — the mistake HRF shipped, whose `cleanFor` is a no-op.
 *   - A bot is **pure and deterministic**. Two clients running the same bot on the same position
 *     must agree, or a multiplayer game forks by who posted first (docs/03 section 9a). Any
 *     randomness a later version needs comes from a journal-derived stream, never `Math.random()`.
 */

import type { Action } from '../action.js'
import type { ObservedState } from '../observe.js'

/** One candidate weighed, kept for the diagnostic panel (docs/19 section 2e). */
export interface Considered {
  readonly action: Action
  readonly score: number
  /** Optional term-level breakdown — "ambition +3.1, tempo −0.4". */
  readonly note?: string
}

export interface BotDecision {
  readonly action: Action
  /**
   * One line, written for a *player*: "Taking 2-Arrow — the last Fuel I need for Tycoon."
   *
   * Not a debug string. It is shown during the bot's turn (docs/19 section 2a), and because it
   * comes from the same computation as `action`, it cannot drift from what actually happened.
   */
  readonly because: string
  /**
   * Everything weighed, for the diagnostic panel. Absent for bots that do not evaluate.
   *
   * The panel must display *this*, not a re-run — a re-run debugs a different call, and hides any
   * accidental non-determinism precisely when it matters (docs/19 section 2e).
   */
  readonly considered?: readonly Considered[]
}

/**
 * Choose among the actions the engine is offering.
 *
 * `actions` comes straight from the `ask` — already legality-checked and `canTake`-filtered, which
 * is why docs/19 section 1 closes the `legalActions` prerequisite as satisfied by a different
 * shape. A bot never has to work out what is legal.
 */
/**
 * What one candidate action leads to.
 *
 * `repeats` exists because of a livelock the arena found on its first real run, and the reasoning
 * matters more than the flag: the bot faced `arrange your resource slots`, where swapping two
 * tokens is value-identical to `Done` — the value function prices resources by type, never by slot.
 * Tied, so the first offer won, and the first offer was a swap. Forever.
 *
 * **No pure position-scoring bot can escape that.** Identical position, identical choice, by
 * definition of purity — so the way out cannot be a weight. It has to be information, and the only
 * thing that separates "swap" from "Done" is that one leaves you facing the same question. The
 * harness holds the continuation and the bot does not, so the harness is the only place that can
 * see it. That is the same reason `Lookahead` exists at all.
 *
 * This stays deterministic across clients: it is computed from the position, not from history, so
 * two clients running the bot still agree (docs/03 section 9a).
 */
export interface Probe {
  /** The first sample. Equivalent to `samples[0]`, kept for bots that do not average. */
  readonly observed: ObservedState
  /**
   * The action leaves this bot facing the same question — it did not advance the game.
   *
   * A hint, not a prohibition. An action that repeats the ask but genuinely *improves* the position
   * is fine and common — taking one pip of several. What is never right is choosing to repeat a
   * question when it gains nothing.
   */
  readonly repeats: boolean
  /**
   * Action pips this turn still has to spend, once the position settles.
   *
   * **Here rather than in `ObservedState` because it is not in the state.** Pips live on the
   * continuation (docs/19 section 1.5), so `valueOf` structurally cannot see them — and that is
   * precisely why leading a card scored as pure cost. The card left your hand, which the tempo term
   * charges for, and bought three actions, which nothing counted.
   *
   * Zero when the turn is over or the position never reaches the pip phase, which is what makes
   * `Pass` comparable: passing buys no actions, and now says so.
   *
   * **Zero also means "cannot tell", which is why rollbacks must not be candidates.** An action
   * landing mid-resolution — the dice of a battle it just started — has no pip ask to read and
   * reports 0, while a `Cancel` beside it returns to the pip ask and reports 1. That paid the bot
   * half a pip to abandon each fight, and it cancelled 31 battles for every 4 it rolled. The fix is
   * `refuses` in the heuristic bot, which drops rollbacks before anything is weighed — pricing them
   * differently was tried first and measurably cost 3 power a game, because the same adjustment
   * also docked the legitimate `Done` that ends a sub-decision.
   */
  readonly actionsAhead: number
  /**
   * The position after this action, sampled — several times when the outcome is random.
   *
   * **A probe must not see the roll that will really happen.** `state.rng` is a seeded generator
   * carried in the state, and `advance` is pure, so every candidate was probed from the *same*
   * generator and returned the exact dice that choice would produce. Committing it then reproduced
   * them, because the real generator had never moved. The bot was picking pools by outcome rather
   * than by odds — measurably: it chose two dice over three, which no honest evaluator does, because
   * that particular roll came up better.
   *
   * Nothing was reaching into hidden state. `ObservedState` correctly hides rivals' hands and strips
   * `rng`. The bot simply asked the engine what would happen and a deterministic engine told it the
   * truth about the future — the same trap docs/03 flags in HRF, arriving through randomness rather
   * than through cards.
   *
   * So probes run on a **derived generator**, independent of the real one and reproducible from the
   * journal, which keeps two clients in agreement (docs/03 section 9a). Where randomness is actually
   * consumed there is more than one sample, and a bot should average over all of them: one sample
   * removes the cheating but replaces it with noise, and averaging is what turns the choice back
   * into a judgement about odds.
   */
  readonly samples: readonly ObservedState[]
}

/**
 * Apply an action and report where it leads, as *this bot* would see it.
 *
 * The harness supplies it, because scoring a move means applying it and only the caller holds the
 * full `GameState` — handing that to the bot would undo the whole point of `ObservedState`. So the
 * one-ply lookahead docs/03 section 2 describes is split: the harness advances, the bot sees the
 * result through the same redaction as everything else.
 *
 * Returns `undefined` when the action cannot be applied — a bot must cope rather than assume.
 */
export type Lookahead = (action: Action) => Probe | undefined

export interface Bot {
  readonly id: string
  /**
   * `lookahead` is absent for callers that cannot supply it. A bot that needs it must degrade
   * rather than throw: an evaluator with no lookahead is a worse bot, not a broken game.
   */
  decide(
    observed: ObservedState,
    actions: readonly Action[],
    lookahead?: Lookahead,
  ): BotDecision
}

/**
 * Takes the first thing offered.
 *
 * Exists to prove the seat plumbing — options, the turn loop, the pacing, the diagnostic panel —
 * end to end *before* there is any evaluation to blame a bad game on. docs/19 section 5 sequences
 * it deliberately: a bot that plays badly but visibly is the right thing to debug presentation
 * against, and it keeps `because` honest from the first line, since "first legal action" is exactly
 * what it is doing.
 *
 * It is also the control in the arena. A V1 that cannot beat this convincingly is not working.
 */
export const trivialBot: Bot = {
  id: 'trivial',
  decide(_observed, actions) {
    const action = actions[0]
    if (action === undefined) {
      // The engine never asks with nothing to choose, so this is a wiring fault, not a game state.
      throw new Error('trivialBot: asked to decide with no actions on offer')
    }
    return { action, because: 'first legal action' }
  },
}
