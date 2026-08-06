/**
 * What this client is, what it may do, and what it may watch.
 *
 * ## Three states, named, because two of them look alike
 *
 * The first version of this carried the seat as `FactionId | null` and it had a hole: `null` meant
 * both "hotseat, so every seat is yours" and "spectator, so none is". Those want opposite
 * behaviour, and collapsing them showed a watching stranger the current player's hand. `SeatView`
 * exists so the compiler asks which one you meant.
 *
 * ## Acting and watching are different questions
 *
 * They were the same question here once, and that was a bug. `viewFor` used to empty the actions of
 * *any* ask not addressed to you — which stopped you acting on someone else's turn, correctly, and
 * also stopped you seeing it. Every decision surface asks `surfaceFor` which surface owns an ask,
 * and an ask with no actions is owned by nobody, so nine of twelve surfaces went blank: the battle
 * window and its dice, the court decisions, the action being taken. A watcher got the board, the log
 * and an empty prompt.
 *
 * So the two are now separate:
 *
 *   - **`canAct`** decides whether the controls work. `App` hands it to `Watching`, which makes the
 *     subtree inert — so a button that would be refused cannot be pressed, and looks it.
 *   - **`viewFor`** decides only what may be *drawn*, and now empties actions for the two surfaces
 *     that are genuinely private (`surfaces.ts` has the list and the argument).
 *
 * Neither is a security boundary. `store.mayAct` refuses the action locally and the server's
 * `actorOf` check refuses it against a tampered client; both are independent of anything here.
 */

import { isPublicSurface, surfaceFor } from '../surfaces.js'
import type { Continue, FactionId } from '@arcs/engine'

export type SeatView =
  /** One browser playing every seat. The default, and how the rules are tested (docs/17 section 7). */
  | { readonly kind: 'hotseat' }
  /** A joined game, holding this faction's seat token. */
  | { readonly kind: 'seat'; readonly faction: FactionId }
  /** A joined game with no seat token: may watch, may not act, may not see a hand. */
  | { readonly kind: 'spectator' }

/** The faction this view plays, or `null` when it plays none — spectating, or not yet loaded. */
function seatOf(view: SeatView): FactionId | null {
  return view.kind === 'seat' ? view.faction : null
}

/**
 * Whether this client may answer the ask in front of it.
 *
 * Hotseat plays every seat, so it always may. A joined client may only when the ask names its own
 * faction — which is also true on `multiAsk`, where it may act if any of the asks is its.
 */
export function canAct(cont: Continue, view: SeatView): boolean {
  if (view.kind === 'hotseat') return true
  const mine = seatOf(view)
  if (mine === null) return false
  if (cont.kind === 'ask') return cont.faction === mine
  if (cont.kind === 'multiAsk') return cont.asks.some((a) => a.faction === mine)
  return false
}

/**
 * The continuation as this client may see it.
 *
 * Passed through untouched unless the surface that would draw it is private and the ask is not
 * yours — in which case the actions are emptied, which is what makes `surfaceFor` decline to draw
 * it at all. Everything else a watcher sees, grayed and inert rather than hidden.
 */
export function viewFor(cont: Continue, view: SeatView): Continue {
  if (view.kind === 'hotseat' || canAct(cont, view)) return cont

  if (cont.kind === 'ask') {
    const surface = surfaceFor(cont)
    return surface !== undefined && isPublicSurface(surface) ? cont : { ...cont, actions: [] }
  }
  /*
   * `multiAsk` is simultaneous decisions — summits, phase 2. Nothing emits it yet, so this is not
   * reachable, but leaving it to fall through would make the one case that most obviously needs a
   * seat filter the one case without one.
   */
  if (cont.kind === 'multiAsk') {
    return { ...cont, asks: cont.asks.filter((a) => a.faction === seatOf(view)) }
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
