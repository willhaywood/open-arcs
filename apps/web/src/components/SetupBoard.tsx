/**
 * The drawn setup card, shown where the board matters but the start screen's deck is gone.
 *
 * Two screens lose sight of which board is being played, and both are places where a player is
 * making a decision that depends on it:
 *
 *   - **The multiplayer links.** Creating a shared game jumps straight from the face-down deck to
 *     the link screen, so the card is *chosen* and never *turned over* — the one step the local
 *     path makes a small ceremony of ("you drew Mix Up 1"). Nobody at the table has seen the board
 *     they are about to be invited to.
 *   - **The leaders and lore draft.** The draft is a full-screen picker over a board that has not
 *     been populated yet, and which leader is worth taking depends on the map you will play it on.
 *
 * The setup card is the right artifact for both rather than the live board SVG, and the reason is
 * the same in each: at neither moment does a populated board exist. The multiplayer creator has no
 * game state at all — only a set of links — and the draft runs *before* setup places a piece
 * (`ruleChain` puts `leaders` ahead of `setup`), so the live board would be an empty map. The card
 * is what shows the starting positions and the clusters in play, which is the thing being asked
 * about.
 *
 * Keyed by the engine's board id, through the same `SETUP_CARDS` table the start screen and the
 * header read, so none of the three can drift on what a board is called.
 */

import { SETUP_CARDS } from '../setups.js'

interface Props {
  /** The engine's board id — `state.board.name`, or the name picked on the start screen. */
  board: string
  /** Small enough to sit in a header rather than beside the deck. */
  compact?: boolean
}

export function SetupBoard({ board, compact = false }: Props): JSX.Element | null {
  const card = SETUP_CARDS[board]
  // A board with no card art is drawable everywhere else; here there is simply nothing to show.
  if (card === undefined) return null
  return (
    <figure className={`setup-board${compact ? ' compact' : ''}`}>
      <img src={card.art} alt={`${card.label} setup`} />
      <figcaption>{card.label}</figcaption>
    </figure>
  )
}
