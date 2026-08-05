/**
 * What this client is, and what it may therefore be offered.
 *
 * ## Three states, named, because two of them look alike
 *
 * The first version of this carried the seat as `FactionId | null` and it had a hole: `null` meant
 * both "hotseat, so every seat is yours" and "spectator, so none of them is". Those want opposite
 * behaviour, and collapsing them showed a watching stranger the current player's hand. `SeatView`
 * exists so the compiler asks which one you meant.
 *
 * ## Why the filter is one function and not a change to fourteen components
 *
 * Thirty-five call sites across fourteen components call `store.apply`, and every one builds its
 * buttons from `cont.actions`. Teaching each of them about seats would be a wide change whose
 * failure mode is silent — one component forgotten is one place you can still act for somebody else.
 *
 * So the gate goes at the single point where the engine's answer reaches the UI. An `Ask` that is
 * not yours is handed on **with its actions emptied**, and every existing "nothing to offer" path
 * then does the right thing for free: trays return null, buttons do not render, and no component
 * learns a new concept.
 *
 * `faction` is deliberately preserved rather than rewritten. It is how the board still highlights
 * whose turn it is, and how `Hand` tells your turn from your cards. Whose turn it is was never
 * secret; only the cards are.
 *
 * ## This is presentation, not enforcement
 *
 * `store.mayAct` is the local gate and the server's `actorOf` check is the one that holds against a
 * tampered client. This exists so you are never shown a button that would be refused — a dead button
 * is a worse answer than no button.
 */

import type { Continue, FactionId } from '@arcs/engine'

export type SeatView =
  /** One browser playing every seat. The default, and how the rules are tested (docs/17 section 7). */
  | { readonly kind: 'hotseat' }
  /** A joined game, holding this faction's seat token. */
  | { readonly kind: 'seat'; readonly faction: FactionId }
  /** A joined game with no seat token: may watch, may not act, may not see a hand. */
  | { readonly kind: 'spectator' }

/** The continuation as this client should see it. */
export function viewFor(cont: Continue, view: SeatView): Continue {
  if (view.kind === 'hotseat') return cont
  const mine: FactionId | null = view.kind === 'seat' ? view.faction : null

  if (cont.kind === 'ask') return cont.faction === mine ? cont : { ...cont, actions: [] }
  /*
   * `multiAsk` is simultaneous decisions — summits, phase 2. Nothing emits it yet, so this is not
   * reachable, but leaving it to fall through would make the one case that most obviously needs a
   * seat filter the one case without one.
   */
  if (cont.kind === 'multiAsk') {
    return { ...cont, asks: cont.asks.filter((a) => a.faction === mine) }
  }
  return cont
}

/**
 * Whose hand to fan along the bottom, or `null` for nobody's.
 *
 * Hotseat shows whoever is being asked — that is what hotseat is. A seat shows its **own** cards,
 * on its turn and off it, which is both the fix for the leak and closer to the tabletop: you hold
 * your cards the whole time. A spectator holds none and is shown none.
 */
export function handOwner(view: SeatView, asked: FactionId): FactionId | null {
  if (view.kind === 'hotseat') return asked
  if (view.kind === 'seat') return view.faction
  return null
}
