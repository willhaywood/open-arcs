/**
 * The hidden-information boundary.
 *
 * HRF has a hook for this — `cleanFor(faction)` — but it is `def cleanFor(f) = this`, a
 * no-op, so its rollout bot sees every hand (docs/03 section 1). The fix is not to
 * remember to redact; it is to make the redacted type the only thing a bot can accept, so
 * cheating is a compile error.
 *
 * Phase 1 models little hidden information, but the boundary exists and already redacts
 * one real leak: the RNG seed. A bot holding the seed can predict every future die roll.
 */

import type { BoardVariant } from './board.js'
import type { ColorId, FactionId } from './ids.js'
import type { GameState } from './state.js'
import type { Tracker } from './tracker.js'

declare const observed: unique symbol

export interface ObservedState {
  readonly [observed]: true
  /** Whose view this is. */
  readonly self: FactionId
  readonly board: BoardVariant
  readonly factions: readonly FactionId[]
  readonly colors: readonly ColorId[]
  readonly act: number
  readonly chapter: number
  readonly round: number
  readonly current: FactionId | undefined
  readonly figures: Tracker
  readonly log: readonly string[]
  readonly isOver: boolean
  readonly winners: readonly FactionId[]
}

/**
 * Project full state down to what `faction` may legitimately see.
 *
 * Note what is absent: `rng`, and `journal`. Add redactions here as hidden zones are
 * introduced (hands, face-down court cards, undeclared ambitions) — never widen this to
 * pass the full state through.
 */
export function observe(state: GameState, self: FactionId): ObservedState {
  return {
    self,
    board: state.board,
    factions: state.factions,
    colors: state.colors,
    act: state.act,
    chapter: state.chapter,
    round: state.round,
    current: state.current,
    figures: state.figures,
    log: state.log,
    isOver: state.isOver,
    winners: state.winners,
  } as ObservedState
}

/**
 * How this faction got the pips it is spending right now: the kind of card play it made this
 * round.
 *
 * Each faction plays exactly one card per round, so its last entry in `roundPlays` is this
 * turn's play. Several leader traits key off "when you Copy or Pivot" — HRF spells this
 * `f.copy || f.pivot` (game-common.scala:766) — and deriving it from the play log means no new
 * state to keep in sync, and it stays correct through undo and replay for free.
 */
export function playKindThisRound(
  state: GameState,
  faction: FactionId,
): 'lead' | 'surpass' | 'copy' | 'pivot' | undefined {
  for (let i = state.roundPlays.length - 1; i >= 0; i--) {
    const play = state.roundPlays[i]!
    if (play.faction === faction) return play.kind
  }
  return undefined
}

/** True when this turn's pips came from a Copy or a Pivot, which four leader traits key off. */
export function copiedOrPivoted(state: GameState, faction: FactionId): boolean {
  const kind = playKindThisRound(state, faction)
  return kind === 'copy' || kind === 'pivot'
}
