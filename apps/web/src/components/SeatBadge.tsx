/**
 * Which seat you are, and whether the table is waiting on you.
 *
 * The first thing a joined game has to answer. A player arrives by clicking a link, and until this
 * existed there was nothing on screen that said which of the four factions was theirs — the seat
 * token is opaque, so even the client did not know until the server told it (`session.ts`).
 *
 * Renders nothing at all in a hotseat game. There is no "you" there: every seat is yours, and a
 * badge saying so would be noise on the screen the rules are tested through. A spectator gets
 * "Watching" — the one state where the answer to "which am I" is "none of them".
 *
 * ## Brand
 *
 * The topbar's existing vocabulary (docs/10 section 2ab): letterspaced caps on the display face,
 * sized to sit beside `turn-meta` rather than compete with it. The faction's own colour does the
 * identifying, the way it does on the player boards and the court rail — "which one am I" is
 * answered by the same cue as everywhere else. `--accent` stays out of it: docs/10 reserves the blue
 * for what is clickable, and this is a label.
 */

import { colorOf } from '../theme.js'
import type { SeatView } from '../multiplayer/seat.js'
import type { FactionId } from '@arcs/engine'

interface Props {
  view: SeatView
  /** Whoever the engine is actually waiting on, seat filter or not. */
  current: FactionId | undefined
}

export function SeatBadge({ view, current }: Props): JSX.Element | null {
  // Hotseat has no "you" — every seat is yours, and a badge saying so would be noise.
  if (view.kind === 'hotseat') return null

  if (view.kind === 'spectator') {
    return (
      <span className="seat-badge seat-watching">
        <span className="seat-label">Watching</span>
        {current === undefined ? null : <span className="seat-wait">{current} to play</span>}
      </span>
    )
  }

  const seat = view.faction
  const yourTurn = current === seat
  const tint = colorOf(seat)

  return (
    <span className={`seat-badge${yourTurn ? ' seat-active' : ''}`}>
      <span className="seat-label">You are</span>
      <span className="seat-who" style={{ borderColor: tint, color: tint }}>
        {seat}
      </span>
      {/*
        * The waiting half is the part that stops a player sitting there wondering whether the game
        * is broken. Naming who it is waiting on is not a leak — turn order is public.
        */}
      {yourTurn ? (
        <span className="seat-turn">your turn</span>
      ) : current === undefined ? null : (
        <span className="seat-wait">waiting for {current}</span>
      )}
    </span>
  )
}
