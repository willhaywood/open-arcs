/**
 * The fallback decision surface — a strip of labelled buttons in the bottom band.
 *
 * This replaces the side panel's ActionPanel. Every decision without a bespoke surface (a map
 * pick, the hand, the court shelf, the trays) renders here, in the same fixed band the trays
 * share, so nothing about the board moves and every choice happens in the primary UI. The strip
 * also draws **unclaimed** asks — an action type missing from `surfaces.ts` fails the invariant
 * test, but it must never be an unplayable game in the meantime.
 *
 * At game over the strip stays up as the persistent affordance after the GameOverScreen is
 * dismissed: the result line, New game, and View summary.
 */

import type { Continue } from '@arcs/engine'

import { store } from '../store.js'
import { ESCAPES, surfaceFor } from '../surfaces.js'
import { colorOf, textOn } from '../theme.js'

/** A tint per family of action, carried as a coloured left edge on the button. */
function categoryClass(type: string): string {
  if (type.startsWith('turn/lead') || type.startsWith('turn/surpass') || type.includes('card')) {
    return ' card'
  }
  if (type.startsWith('ambition/')) return ' ambition'
  if (type.startsWith('battle/')) return ' battle'
  if (type.startsWith('action/')) return ' act'
  return ''
}

export function AskStrip({
  cont,
  onNewGame,
}: {
  cont: Continue
  onNewGame: () => void
}): JSX.Element | null {
  if (cont.kind === 'gameOver') {
    return (
      <div className="at-tray ask-strip">
        <div className="at-inner">
          <div className="at-head">
            <span className="at-who strip-over-title">Game Over</span>
          </div>
          <div className="strip-actions strip-over">
            <span className="strip-reason">{cont.reason}</span>
            {cont.winners.length > 0 ? (
              <span
                className="swatch"
                style={{ background: colorOf(cont.winners[0]!), color: textOn(cont.winners[0]!) }}
              >
                {cont.winners[0]}
              </span>
            ) : null}
          </div>
          <button className="at-end" onClick={() => store.reopenGameOver()}>
            View summary
          </button>
          <button className="at-end strip-primary" onClick={onNewGame}>
            New game
          </button>
        </div>
      </div>
    )
  }

  if (cont.kind === 'multiAsk') {
    return (
      <div className="at-tray ask-strip">
        <div className="at-inner">
          <div className="strip-actions">
            <span className="strip-reason">Simultaneous decisions (summits) are not in phase 1.</span>
          </div>
        </div>
      </div>
    )
  }

  /*
   * Any other non-ask renders nothing: the turn chip and the seat badge already say whose move
   * it is, and the bot events pace what is happening. Nothing consumed the old "Engine is
   * working…" line but the column it filled.
   */
  if (cont.kind !== 'ask') return null

  /*
   * A joined watcher of a *private* ask (a rival's hand decision) receives the ask with its
   * actions emptied by `viewFor`. Empty falls through the escape filter to the strip's
   * all-escapes claim, so without this guard the strip would draw a bare band on every rival
   * card play. There is nothing to draw; the board and the seat badge carry the waiting.
   */
  if (cont.actions.length === 0) return null

  // The safety net, verbatim from the panel: the strip's own claim, plus anything unclaimed.
  const surface = surfaceFor(cont)
  if (surface !== 'strip' && surface !== undefined) return null

  const escapes = cont.actions.filter((a) => ESCAPES.includes(a.type))
  const options = cont.actions.filter((a) => !escapes.includes(a))

  return (
    <div className="at-tray ask-strip">
      <div className="at-inner">
        <div className="at-head">
          <span className="at-who" style={{ color: colorOf(cont.faction) }}>
            {cont.faction}
          </span>
          <span className="at-sub">{cont.prompt ?? 'Choose an action'}</span>
        </div>
        <div className="strip-actions">
          {options.map((a, i) => {
            const label = String(a['label'] ?? a.type)
            return (
              <button
                key={`${a.type}-${i}`}
                type="button"
                className={`strip-btn${categoryClass(a.type)}`}
                title={label}
                onClick={() => store.apply(a)}
              >
                {label}
              </button>
            )
          })}
        </div>
        {escapes.map((a, i) => (
          <button key={`esc-${i}`} className="at-end" onClick={() => store.apply(a)}>
            {String(a['label'] ?? 'Cancel')}
          </button>
        ))}
      </div>
    </div>
  )
}
