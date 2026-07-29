/**
 * The round's card-play area, down the left of the board — mimicking the physical board,
 * which has two gold-framed slots: a tall SURPASS, COPY OR PIVOT slot above a single LEAD
 * slot, with the labels running vertically up the frame edge.
 *
 * Fed by `state.roundPlays`, so it shows the current round only and clears when the next
 * round starts, exactly like the physical board. Copied cards are shown face down, as they
 * are played in the real game.
 */

import type { GameState, RoundPlay } from '@arcs/engine'

import { colorOf } from '../theme.js'
import { CardFace } from './CardFace.js'

export function PlayedCards({ state }: { state: GameState }): JSX.Element {
  const lead = state.roundPlays.find((p) => p.kind === 'lead')
  const follows = state.roundPlays.filter((p) => p.kind !== 'lead')
  // Declaring an ambition zeroes the played card; the zero marker goes on top of it.
  const zeroedCard = state.lead?.zeroed === true ? state.lead.cardId : undefined

  return (
    <div className="play-rail">
      <Slot label="Surpass, Copy or Pivot" plays={follows} tall zeroedCard={zeroedCard} />
      <Slot label="Lead" plays={lead ? [lead] : []} zeroedCard={zeroedCard} />
    </div>
  )
}

function Slot({
  label,
  plays,
  tall = false,
  zeroedCard,
}: {
  label: string
  plays: RoundPlay[]
  tall?: boolean
  zeroedCard?: string | undefined
}): JSX.Element {
  return (
    <div className={`play-slot${tall ? ' tall' : ''}`}>
      <div className="slot-label">{label}</div>
      <div className="slot-cards">
        {plays.length === 0 ? (
          <div className="slot-empty" />
        ) : (
          plays.map((p) => (
            <div
              key={`${p.faction}-${p.cardId}`}
              className="slot-card"
              style={{ borderColor: colorOf(p.faction) }}
              title={`${p.faction} — ${p.kind}`}
            >
              {/* Card and token share one rotated frame, so the token sits on the card in
                  its own coordinates — the 0 lands over the printed number. */}
              <div className="slot-card-rot">
                {p.kind === 'copy' ? (
                  <img
                    className="cardface"
                    src="/game-assets/action/card-back.webp"
                    alt="face down"
                  />
                ) : (
                  <CardFace cardId={p.cardId} />
                )}
                {p.cardId === zeroedCard ? (
                  <div
                    className="ambition-token"
                    title="Ambition declared — this card counts as strength 0"
                  >
                    <span className="at-zero" />
                    <span className="at-text">
                      Ambition
                      <br />
                      Declared
                    </span>
                  </div>
                ) : null}
              </div>
              <span className="slot-tag" style={{ background: colorOf(p.faction) }}>
                {p.kind === 'copy' ? 'copy' : p.kind}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
