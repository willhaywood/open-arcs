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
 * Apply an action and report the position it leads to, as *this bot* would see it.
 *
 * The harness supplies it, because scoring a move means applying it and only the caller holds the
 * full `GameState` — handing that to the bot would undo the whole point of `ObservedState`. So the
 * one-ply lookahead docs/03 section 2 describes is split: the harness advances, the bot sees the
 * result through the same redaction as everything else.
 *
 * Returns `undefined` when the action cannot be applied — a bot must cope rather than assume.
 */
export type Lookahead = (action: Action) => ObservedState | undefined

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
