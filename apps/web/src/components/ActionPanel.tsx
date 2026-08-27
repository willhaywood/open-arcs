import type { Continue } from '@arcs/engine'

import { store } from '../store.js'
import { surfaceFor } from '../surfaces.js'
import { colorOf, textOn } from '../theme.js'

interface Props {
  cont: Continue
  onNewGame: () => void
}

export function ActionPanel({ cont, onNewGame }: Props): JSX.Element | null {
  if (cont.kind === 'gameOver') {
    return (
      <div className="actions">
        <div className="game-over">
          <div className="go-title">Game Over</div>
          <div className="go-reason">{cont.reason}</div>
          {cont.winners.length > 0 ? (
            <div className="go-winner">
              Winner:{' '}
              <span
                className="swatch"
                style={{ background: colorOf(cont.winners[0]!), color: textOn(cont.winners[0]!) }}
              >
                {cont.winners[0]}
              </span>
            </div>
          ) : null}
          <button className="primary" onClick={onNewGame}>
            New game
          </button>
          <button className="ghost" onClick={() => store.reopenGameOver()}>
            View summary
          </button>
        </div>
      </div>
    )
  }

  if (cont.kind === 'multiAsk') {
    return <div className="actions">Simultaneous decisions (summits) are not in phase 1.</div>
  }

  if (cont.kind !== 'ask') {
    return <div className="actions">Engine is working…</div>
  }

  /*
   * Which surface draws this Ask is decided in one place — `surfaces.ts` — and asked, not
   * re-derived. This used to be two lists here (types that live elsewhere, plus a conditional
   * battle-window set) reasoning independently of what the battle window would actually render.
   * Where the two disagreed, the Ask fell through: Railgun Arrays hid `battle/hit` here while the
   * window declined to draw it, and the game stopped.
   */
  /*
   * Draws what it is claimed for — and anything claimed by nobody, so a missing entry in the table
   * is a failing test rather than an unplayable game. `surfaces.test.ts` asserts `undefined` never
   * happens in real play; this makes sure that if it ever does, the turn can still be taken.
   */
  const surface = surfaceFor(cont)
  if (surface !== 'panel' && surface !== undefined) return null

  const CARD_PLAYS = ['turn/lead', 'turn/surpass', 'turn/copy', 'turn/pivot']

  const actions = cont.actions
  const playPhase = cont.actions.some((a) => CARD_PLAYS.includes(a.type))

  return (
    <div className="actions">
      <div className="ask-head">
        <span
          className="swatch"
          style={{ background: colorOf(cont.faction), color: textOn(cont.faction) }}
        >
          {cont.faction}
        </span>
        <span className="prompt">{cont.prompt ?? 'Choose an action'}</span>
      </div>
      {playPhase ? <div className="play-hint">Play a card from your hand below ↓</div> : null}
      <div className="action-list">
        {actions.map((a, i) => (
          <button
            key={`${a.type}-${i}`}
            className={`action-btn ${categoryClass(a.type)}`}
            onClick={() => store.apply(a)}
          >
            {String(a['label'] ?? a.type)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Tint buttons by the kind of choice so a long list reads at a glance. */
function categoryClass(type: string): string {
  if (type.startsWith('turn/pass') || type.endsWith('/cancel') || type.endsWith('/skip')) return 'muted'
  if (type.startsWith('turn/lead') || type.startsWith('turn/surpass') || type.startsWith('turn/pivot') || type.startsWith('turn/copy')) return 'card'
  if (type.startsWith('ambition/')) return 'ambition'
  if (type.startsWith('battle/')) return 'battle'
  if (type.startsWith('action/') || type === 'action/take') return 'act'
  return ''
}
