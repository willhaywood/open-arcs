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
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { store } from '../store.js'
import { colorOf } from '../theme.js'
import { asset } from '../assets.js'

export type DraftKind = 'leader' | 'lore'

export function cardArt(id: string, kind: DraftKind): string {
  return asset(`game-assets/${kind}/${id}.webp`)
}

export function cardName(id: string, kind: DraftKind): string {
  return kind === 'leader' ? leaderCard(id).name : loreCard(id).name
}

/**
 * Just the card's illustration — the top band of the leader art, cropped by a fixed-aspect
 * frame. The end screens want the leader as a *portrait*, not a document: at their sizes the
 * card's body text is unreadable noise, and the picture alone is the identity. Sized by the
 * caller's className; the crop shows the top ~46% of the card, which is where every leader's
 * illustration lives.
 */
export function LeaderArt({
  id,
  className,
  style,
}: {
  id: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  return (
    <span
      className={`leader-art${className === undefined ? '' : ` ${className}`}`}
      style={style}
      title={cardName(id, 'leader')}
    >
      <img src={cardArt(id, 'leader')} alt={cardName(id, 'leader')} />
    </span>
  )
}

/**
 * A named, clickable card reference — the pill the player boards use for drafted cards.
 *
 * Lives here rather than in `PlayerBoards` because it is not about player boards: it is "a card
 * mentioned somewhere, readable in place". Anywhere the rules fire off a held card, the card
 * should be reachable from the thing it just did rather than by hunting for the board that holds
 * it. Battle interrupts are the case that forced this out: being told *Railgun Arrays* struck
 * first is no use if you cannot read Railgun Arrays without leaving the battle.
 *
 * The reader it opens is a portal, so a pill works inside a modal without being clipped by it.
 */
export function CardPill({
  id,
  kind,
  owner,
}: {
  id: string
  kind: DraftKind
  owner?: FactionId | undefined
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={`pb-guild pb-drafted ${kind}`}
        /*
         * Names the holder when there is one. The old player-board title said "your leader", which
         * was wrong on a rival's board; naming the faction is right everywhere, and this pill now
         * appears in places where whose card it is carries the meaning — a battle interrupt is
         * only comprehensible if you know which side owns the card that fired.
         */
        title={`${cardName(id, kind)} — ${owner === undefined ? kind : `${owner}'s ${kind}`}, click to read`}
        onClick={() => setOpen(true)}
      >
        <span className="pb-guild-name">{cardName(id, kind)}</span>
      </button>
      {open ? (
        <LeaderCardReader id={id} kind={kind} owner={owner} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
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
