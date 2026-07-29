/**
 * A leader or lore card at readable size.
 *
 * Both card types print their rules in full, and no thumbnail that fits in a draft row or on a
 * player board can carry them — every small copy is a *reference*, and this is where the card is
 * actually read. Shared by the draft screen and the player boards so there is one reader rather
 * than two that drift.
 *
 * `action` is what taking it would be, when taking is on offer. Keeping it a button here rather
 * than on the card itself means studying a rival's leader cannot draft it by accident.
 */

import { leaderCard, loreCard } from '@arcs/engine'
import type { Action, FactionId } from '@arcs/engine'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { store } from '../store.js'
import { colorOf } from '../theme.js'

export type DraftKind = 'leader' | 'lore'

export function cardArt(id: string, kind: DraftKind): string {
  return `/game-assets/${kind}/${id}.webp`
}

export function cardName(id: string, kind: DraftKind): string {
  return kind === 'leader' ? leaderCard(id).name : loreCard(id).name
}

export function LeaderCardReader({
  id,
  kind,
  owner,
  action,
  onClose,
}: {
  id: string
  kind: DraftKind
  /** Set when the card is already held, so the reader can say by whom. */
  owner?: FactionId | undefined
  /** Present only while the card can still be taken. */
  action?: Action | undefined
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /*
   * Portalled to `body`. Opened from a player board this would otherwise render inside
   * `.player-boards`, which is its own stacking context — a `position: fixed` child cannot
   * escape that, and the card would paint under the header. Same reason as `CardZoom`.
   */
  return createPortal(
    <div className="draft-reader" onClick={onClose} role="presentation">
      <div className="draft-reader-inner" onClick={(e) => e.stopPropagation()}>
        <img className={`draft-reader-art ${kind}`} src={cardArt(id, kind)} alt={cardName(id, kind)} />
        <div className="draft-reader-side">
          <div className="cm-name">{cardName(id, kind)}</div>
          <div className="cm-kind">{kind === 'leader' ? 'Leader' : 'Lore card'}</div>

          {owner !== undefined ? (
            <div className="draft-held" style={{ color: colorOf(owner) }}>
              held by {owner}
            </div>
          ) : null}

          <div className="draft-reader-actions">
            {action !== undefined ? (
              <button
                className="da-confirm"
                onClick={() => {
                  onClose()
                  store.apply(action)
                }}
              >
                Take this
              </button>
            ) : null}
            <button className="da-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
