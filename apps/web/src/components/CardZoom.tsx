/**
 * A court card at readable size.
 *
 * Court art is 744x1039 with real body text on it, so nothing that fits in a rail or on a player
 * board can be read — every small copy of a card is a *reference* to it, and this is where it is
 * actually read. Shared so the court rail and the secured piles open cards identically rather
 * than growing two near-identical modals.
 *
 * `children` is whatever the opener wants beside the art: the court rail passes the agents
 * standing on the card, a secured pile passes nothing.
 */

import { courtCard } from '@arcs/engine'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export function CardZoom({
  cardId,
  onClose,
  children,
}: {
  cardId: string
  onClose: () => void
  children?: React.ReactNode
}): JSX.Element {
  const card = courtCard(cardId)

  // Escape closes, as any modal should.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * Portalled to `body` rather than rendered where it was opened from.
   *
   * The secured piles open this from inside a player board, and `.player-boards` sits in its own
   * stacking context at `z-index: 50` — a `position: fixed` child cannot escape that, so the
   * card would have been painted *under* the header. A `transform` on any ancestor would break
   * it the same way, by making that ancestor the containing block for fixed positioning. A modal
   * covers the app, so it has to be a child of the app.
   */
  return createPortal(
    <div className="court-modal" onClick={onClose} role="presentation">
      {/* Stop clicks on the card itself from closing, so it can be read and inspected. */}
      <div className="court-modal-inner" onClick={(e) => e.stopPropagation()}>
        <span className="cm-frame" aria-hidden="true" />
        <img
          className="court-modal-art"
          src={`/game-assets/court/${cardId}.webp`}
          alt={card.name}
        />
        <div className="court-modal-side">
          <div className="cm-name">{card.name}</div>
          <div className="cm-kind">{card.kind === 'vox' ? 'Vox card' : 'Guild card'}</div>
          {children}
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
