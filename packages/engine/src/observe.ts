/**
 * The hidden-information boundary.
 *
 * HRF has a hook for this — `cleanFor(faction)` — but it is `def cleanFor(f) = this`, a
 * no-op, so its rollout bot sees every hand (docs/03 section 1). The fix is not to
 * remember to redact; it is to make the redacted type the only thing a bot can accept, so
 * cheating is a compile error.
 *
 * ## What is hidden, and why each
 *
 * | Hidden | Why |
 * | --- | --- |
 * | `rng` | A bot holding the seed can predict every future die roll and shuffle |
 * | `journal` | Replaying it reconstructs the seed — the same leak by another route |
 * | Rivals' hands | The one genuinely hidden zone in the base game |
 * | `unusedLore` | The box's leftovers in shuffled order; the Archivist draws off the top |
 *
 * Everything else in Arcs is on the table and is passed through: the court, resource slots,
 * declared ambitions, drafted leaders and lore, power, who played what this round. Redacting those
 * would model a game nobody is playing.
 *
 * ## `hand` is your own, and only your own
 *
 * The one *self*-scoped field. It exists because without it a bot cannot lead a card, which is most
 * of a turn in Arcs. Deliberately a flat list of ids rather than the `cards` Tracker: handing over
 * the Tracker would carry every rival's hand with it, and the type could not stop it.
 */

import { CardLocation } from './ids.js'
import { contentsOf } from './tracker.js'
import type { BoardVariant } from './board.js'
import type { ColorId, FactionId, SystemId } from './ids.js'
import type { Resource } from './resources.js'
import type { DieRoll } from './dice.js'
import type {
  Ambition,
  AmbitionMarker,
  Declaration,
  GameState,
  Lead,
  RoundPlay,
} from './state.js'
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

  /**
   * **Your** hand, by card id — never anyone else's.
   *
   * Empty for a faction that has played out, which is an observation rather than a redaction: an
   * empty hand is public in Arcs.
   */
  readonly hand: readonly string[]
  /** How many cards each faction holds. Public — a hand's size is visible, its contents are not. */
  readonly handSizes: Readonly<Partial<Record<FactionId, number>>>

  // --- public zones ---------------------------------------------------------
  readonly resources: Tracker
  readonly courtCards: Tracker
  readonly damaged: readonly string[]
  readonly unslotted: readonly string[]
  readonly planetTypes: Readonly<Partial<Record<SystemId, Resource>>>
  readonly outraged: Readonly<Partial<Record<FactionId, readonly Resource[]>>>
  readonly power: Readonly<Partial<Record<FactionId, number>>>

  // --- the round ------------------------------------------------------------
  readonly initiativeOrder: readonly FactionId[]
  readonly lead: Lead | undefined
  readonly roundPlays: readonly RoundPlay[]
  readonly seized: FactionId | undefined
  readonly passed: number
  readonly anyBattle: boolean
  readonly lastRoll: { readonly dice: readonly DieRoll[] } | undefined

  // --- ambitions ------------------------------------------------------------
  readonly ambitions: readonly Ambition[]
  readonly ambitionable: readonly AmbitionMarker[]
  readonly declared: readonly Declaration[]

  // --- leaders and lore -----------------------------------------------------
  readonly leaders: Readonly<Partial<Record<FactionId, string>>>
  readonly lores: Readonly<Partial<Record<FactionId, readonly string[]>>>

  // --- this turn ------------------------------------------------------------
  readonly taxedThisTurn: readonly string[]
  readonly workedThisTurn: readonly string[]
  readonly usedThisTurn: readonly string[]
  readonly loreUsedThisTurn: readonly string[]
}

/**
 * Project full state down to what `faction` may legitimately see.
 *
 * Absent by design: `rng`, `journal`, rivals' hands, `unusedLore`. Add redactions here as hidden
 * zones are introduced — never widen this to pass the full state through.
 */
export function observe(state: GameState, self: FactionId): ObservedState {
  const handSizes: Partial<Record<FactionId, number>> = {}
  for (const f of state.factions) {
    handSizes[f] = contentsOf(state.cards, CardLocation.hand(f)).length
  }

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

    hand: [...contentsOf(state.cards, CardLocation.hand(self))],
    handSizes,

    resources: state.resources,
    courtCards: state.courtCards,
    damaged: state.damaged,
    unslotted: state.unslotted,
    planetTypes: state.planetTypes,
    outraged: state.outraged,
    power: state.power,

    initiativeOrder: state.initiativeOrder,
    lead: state.lead,
    roundPlays: state.roundPlays,
    seized: state.seized,
    passed: state.passed,
    anyBattle: state.anyBattle,
    lastRoll: state.lastRoll,

    ambitions: state.ambitions,
    ambitionable: state.ambitionable,
    declared: state.declared,

    leaders: state.leaders,
    lores: state.lores,

    taxedThisTurn: state.taxedThisTurn,
    workedThisTurn: state.workedThisTurn,
    usedThisTurn: state.usedThisTurn,
    loreUsedThisTurn: state.loreUsedThisTurn,
  } as unknown as ObservedState
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
