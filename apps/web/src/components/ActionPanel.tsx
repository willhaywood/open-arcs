import type { Continue } from '@arcs/engine'

import { store } from '../store.js'
import { colorOf, textOn } from '../theme.js'

interface Props {
  cont: Continue
  onNewGame: () => void
}

export function ActionPanel({ cont, onNewGame }: Props): JSX.Element {
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

  // Card plays live in the fanned hand at the bottom, and the Leaders and Lore draft has its
  // own screen — neither belongs in a list of buttons.
  const CARD_PLAYS = ['turn/lead', 'turn/surpass', 'turn/copy', 'turn/pivot']
  // Both draft-style choices have their own screen; listing them here too would duplicate them.
  const ELSEWHERE = [
    ...CARD_PLAYS,
    'leaders/take',
    'leaders/learned',
    'battle/raid-take',
    'battle/settle',
    // The resource slots are a board you push tokens around on, not a list of moves.
    'resources/arrange-move',
    'resources/arrange-discard',
    'resources/arrange-done',
    // The Prelude is a choice between tokens, so it gets the tokens.
    'turn/prelude-spend',
    'turn/prelude-battle',
    'turn/prelude-discard',
    'turn/prelude-guild',
    'turn/prelude-arrange',
    'turn/prelude-done',
  ]

  /*
   * The battle window (`Battle.tsx`) owns four of the battle's steps: choosing a target, gathering
   * the dice, and placing hits — which ends on the `battle/finish` confirm. While any of those is
   * on offer the panel must stay out of the way, or every step is drawn twice: the dice gather
   * alone put 56 `Roll 3S 1A 0R` buttons beside the tray that already draws them.
   *
   * Conditional rather than a flat entry in the list above, because one battle step has **no**
   * window of its own and must keep the panel:
   *
   *   - `battle/system` — which system to attack in, still a list until the map targets it.
   *
   * `battle/reroll` used to be in that same boat and no longer is: the window draws the dice and
   * lets them be clicked, so leaving it here as well would print the whole option list — one
   * button per distinct face combination — beside the tray already showing them.
   *
   * `battle/cancel` goes with the window when the window is up (it draws its own way out) and
   * stays in the panel otherwise, where it is the only way back from the system choice.
   */
  const BATTLE_WINDOW = ['battle/target', 'battle/roll', 'battle/hit', 'battle/finish', 'battle/reroll']
  const inBattleWindow = cont.actions.some((a) => BATTLE_WINDOW.includes(a.type))
  const hidden = inBattleWindow ? [...ELSEWHERE, ...BATTLE_WINDOW, 'battle/cancel'] : ELSEWHERE

  const actions = cont.actions.filter((a) => !hidden.includes(a.type))
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
