/**
 * Watching a bot play, and taking the wheel.
 *
 * Two surfaces in one component because they are two views of the same `BotDecision` and must never
 * disagree about what happened (docs/19 sections 2a and 2e):
 *
 *   - **The banner** is for a player: whose turn, what it did, and why, one line, paced. On the same
 *     terms as the Prelude and action trays — bottom of the map, map visible, because what a bot is
 *     doing is on the map.
 *   - **The diagnostics** are for us: the candidates it weighed and their scores. Dev-only, folded
 *     away by default, and showing *the decision that was made* rather than a re-run — a re-run
 *     debugs a different call, and hides accidental non-determinism exactly when it matters.
 *
 * Nothing here reaches the journal. Pacing is presentation, so a paced game and a skipped one
 * produce identical saves.
 */

import type { BotDecision, Continue, GameState } from '@arcs/engine'

import { store, useBotUi, useGame } from '../store.js'
import { colorOf, textOn } from '../theme.js'

export function BotPanel({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  /*
   * Both subscriptions are needed. `useGame` tracks the position; `useBotUi` tracks mode, pace and
   * the last decision — which change *without* the position moving, so a single subscription on the
   * position silently ignored them and the mode buttons appeared to do nothing.
   */
  useGame()
  useBotUi()

  const turn = store.botTurn()
  const decision = store.lastDecision
  // Nothing to say when no bot is involved and none has acted.
  if (turn === undefined && decision === null) return null
  if (cont.kind !== 'ask' && turn === undefined) return null

  const waiting = turn !== undefined && store.botMode !== 'run'
  /*
   * **Compact whenever a human needs the board**, which is every moment a bot is not mid-turn.
   *
   * The tray shares the hand's grid cell with the Prelude and action trays, which is right while a
   * bot is playing because nothing else is up. Two cases break that assumption, and both were bugs:
   *
   *   - **Take-over.** The tray reads "play this seat from the board" while sitting on the board it
   *     means, and at `z-index: 46` against the cards' 0 it won every click.
   *   - **A human's own turn.** `lastDecision` lingers after any bot has acted, so the tray stays up
   *     to report it — with `turn` now `undefined`, which the first version read as "not take-over"
   *     and drew full-size straight over the player's hand and action tray. It also hid the
   *     resource-overflow prompt, so taxing looked like it silently produced nothing.
   *
   * Compact moves it to the map's bottom edge instead — the same idiom as the Prelude tray, map
   * still visible — and drops to the controls alone, since the diagnostics describe a decision that
   * is no longer being made.
   */
  const compact = turn === undefined || store.botMode === 'off'

  return (
    <div className={`bot-tray${compact ? ' compact' : ''}`}>
      <div className="bot-inner">
        <div className="bot-head">
          {turn !== undefined ? (
            <span className="bot-who" style={{ background: colorOf(turn), color: textOn(turn) }}>
              {turn}
            </span>
          ) : null}
          <span className="bot-title">{turn === undefined ? 'Last bot action' : 'Bot turn'}</span>

          <span className="bot-modes">
            {(['run', 'step', 'off'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`bot-mode${store.botMode === m ? ' on' : ''}`}
                title={
                  m === 'run'
                    ? 'Play bot turns automatically, paced'
                    : m === 'step'
                      ? 'Pause before each bot action'
                      : 'Hand bot turns to you — play the seat yourself'
                }
                onClick={() => store.setBotMode(m)}
              >
                {m === 'off' ? 'take over' : m}
              </button>
            ))}
          </span>

          {store.botMode === 'run' ? (
            <label className="bot-pace">
              pace
              <input
                type="range"
                min={150}
                max={2000}
                step={50}
                value={store.botPace}
                onChange={(e) => store.setBotPace(Number(e.target.value))}
              />
            </label>
          ) : null}

          {/*
           * Overrides are surfaced rather than merely counted. The journal cannot tell afterwards
           * who chose an action, so a game where you played the bot's turns looks exactly like one
           * it played alone — and tuning against that is tuning against yourself.
           */}
          {store.overrides > 0 ? (
            <span className="bot-overrides" title="Decisions you took over — this game is not clean tuning evidence">
              {store.overrides} taken over
            </span>
          ) : null}
        </div>

        {decision !== null && !compact ? <Narration decision={decision} /> : null}

        {waiting ? (
          <div className="bot-waiting">
            <span>
              {store.botMode === 'step'
                ? 'Paused — step to take the next action'
                : 'Taken over — play this seat from the board'}
            </span>
            {store.botMode === 'step' ? (
              <button className="bot-step" onClick={() => store.stepBotOnce()}>
                Step
              </button>
            ) : null}
          </div>
        ) : null}

        {!compact && decision?.considered !== undefined && decision.considered.length > 0 ? (
          <Diagnostics decision={decision} state={state} />
        ) : null}
      </div>
    </div>
  )
}

/** What it did and why — the player-facing half. */
function Narration({ decision }: { decision: BotDecision }): JSX.Element {
  return (
    <div className="bot-said">
      <span className="bot-action">{String(decision.action['label'] ?? decision.action.type)}</span>
      <span className="bot-because">{decision.because}</span>
    </div>
  )
}

/**
 * The candidates it weighed — dev-facing.
 *
 * Sorted by score with the chosen one marked, because the useful question is rarely "why X" but
 * "why X over Y", and that is only answerable side by side. Absent entirely for a bot that does not
 * evaluate, which is why the trivial bot shows a banner and no table.
 */
function Diagnostics({ decision }: { decision: BotDecision; state: GameState }): JSX.Element {
  const rows = [...(decision.considered ?? [])].sort((a, b) => b.score - a.score)
  const top = rows[0]?.score ?? 0
  return (
    <details className="bot-diag">
      <summary>{rows.length} candidates weighed</summary>
      <table>
        <tbody>
          {rows.slice(0, 12).map((c, i) => {
            const chosen = c.action === decision.action
            return (
              <tr key={i} className={chosen ? 'chosen' : undefined}>
                <td className="bot-diag-score">{c.score.toFixed(2)}</td>
                {/* Distance from the best, which is what says how close the call was. */}
                <td className="bot-diag-gap">{chosen ? '' : `−${(top - c.score).toFixed(2)}`}</td>
                <td>{String(c.action['label'] ?? c.action.type)}</td>
                <td className="bot-diag-note">{c.note ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}
