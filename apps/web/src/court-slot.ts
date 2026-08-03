/**
 * Reading a court slot: what card is in it, and who has agents on it.
 *
 * Extracted from `CourtPanel` so the court rail and the `CardShelf` cannot disagree about what a
 * slot holds. docs/15 S1 is explicit that the shelf should reuse the rail's agent representation
 * rather than invent a second one — two readers of the same state is how the surfaces bugs in
 * `surfaces.ts` started, and agent counts are the whole basis of whether a card can be secured.
 */

import { CourtPile, Location, contentsOf, courtCard, parseFigureId } from '@arcs/engine'
import type { Action, Continue, FactionId, GameState } from '@arcs/engine'

import { SHELF } from './surfaces.js'

export interface CourtSlot {
  n: number
  cardId: string | undefined
  name: string
  kind: 'guild' | 'vox' | undefined
  agents: { faction: FactionId; count: number }[]
  /** Ahead on agents by a **strict** majority, so genuinely able to secure. A tie leaves nobody. */
  leader: FactionId | undefined
}

export function readSlot(state: GameState, n: number): CourtSlot {
  const cardId = contentsOf(state.courtCards, CourtPile.slot(n))[0]
  const on = contentsOf(state.figures, Location.court(n)).map((id) => parseFigureId(id).color)
  const agents = state.factions
    .map((faction) => ({ faction, count: on.filter((c) => c === faction).length }))
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count)

  // Strict majority only — a tie leaves nobody able to secure.
  const leader =
    agents.length > 0 && (agents.length === 1 || agents[0]!.count > agents[1]!.count)
      ? agents[0]!.faction
      : undefined

  const card = cardId === undefined ? undefined : courtCard(cardId)
  return { n, cardId, name: card?.name ?? 'empty', kind: card?.kind, agents, leader }
}

/**
 * What the `CardShelf` draws for an Ask: one card per offered pick.
 *
 * Pure, and separate from the component, so the invariant below can be stated against real play:
 * **every pick the shelf claims resolves to a card it can draw.** That matters because the shelf is
 * the only surface for these actions now — if a pick resolved to an empty slot the component would
 * render nothing for it, and a pick with no card and no button is precisely the "engine offered it,
 * nothing draws it" bug `surfaces.ts` exists to prevent. `surfaceFor` cannot catch that: ownership
 * would still be correctly declared.
 */
export interface ShelfItem {
  action: Action
  slot: CourtSlot
}

export function shelfItems(state: GameState, cont: Continue): ShelfItem[] {
  if (cont.kind !== 'ask') return []
  return cont.actions
    .filter((a) => SHELF.includes(a.type))
    .map((action) => ({ action, slot: readSlot(state, action['slot'] as number) }))
    .filter((item): item is ShelfItem => item.slot.cardId !== undefined)
}

/** Escapes belong to whichever surface drew the menu, so they never need their own claim. */
const SHELF_ESCAPES = ['action/skip', 'action/cancel']

/**
 * Everything the shelf draws, partitioned — and the partition is **total**.
 *
 * Enumerating the types to draw is what caused the bug this module's sibling `surfaces.ts` exists
 * to prevent, and it caused it again here: an early cut drew only the card picks, so the
 * `action/guild-alt` alternatives `withAlts` appends to Influence and Secure were offered by the
 * engine and rendered by nobody. `turn/pips` and `leaders/after-declare` turned up the same way.
 *
 * So nothing is enumerated. The picks become cards, the escape becomes the way out, and
 * **everything else becomes a labelled button** — which means a new action type appearing on one of
 * these Asks is drawn without anyone having to notice it. `court-slot.test.ts` asserts the three
 * parts account for every action.
 */
export interface ShelfParts {
  /** Court cards to act on, one per pick that resolves to a real card. */
  items: ShelfItem[]
  /** Anything else offered — guild alternatives, returns to the pip menu, trait follow-ups. */
  others: Action[]
  escape: Action | undefined
}

export function shelfParts(state: GameState, cont: Continue): ShelfParts {
  if (cont.kind !== 'ask') return { items: [], others: [], escape: undefined }
  const items = shelfItems(state, cont)
  const drawn = new Set<Action>(items.map((i) => i.action))
  const escape = cont.actions.find((a) => SHELF_ESCAPES.includes(a.type))
  const others = cont.actions.filter((a) => !drawn.has(a) && a !== escape)
  return { items, others, escape }
}

/** Picks offered, whether or not they resolved to a drawable card. The test compares the two. */
export function shelfPickCount(cont: Continue): number {
  return cont.kind === 'ask' ? cont.actions.filter((a) => SHELF.includes(a.type)).length : 0
}
