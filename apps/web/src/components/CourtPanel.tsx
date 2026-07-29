/**
 * The court: the face-up cards Influence and Secure act on, stacked down the left of the
 * board beside the played-card rail.
 *
 * Court card art is 744x1039 with real body text on it, so no size that fits in a side rail
 * is readable — the rail is for *state* (who holds how many agents, who leads) and clicking
 * a card opens it full size to actually read. That split is why the cards can stay small
 * here without the panel being useless.
 *
 * Agents are the readable state: a card is securable only on a **strict** majority, so the
 * leader is ringed only when genuinely ahead and a tie is shown as a tie.
 */

import { CourtPile, Location, contentsOf, courtCard, courtSlots, parseFigureId } from '@arcs/engine'
import type { FactionId, GameState } from '@arcs/engine'
import { useState } from 'react'

import { colorOf, figureArt } from '../theme.js'
import { CardZoom } from './CardZoom.js'

interface Slot {
  n: number
  cardId: string | undefined
  name: string
  kind: 'guild' | 'vox' | undefined
  agents: { faction: FactionId; count: number }[]
  leader: FactionId | undefined
}

function read(state: GameState, n: number): Slot {
  const cardId = contentsOf(state.courtCards, CourtPile.slot(n))[0]
  const on = contentsOf(state.figures, Location.court(n)).map((id) => parseFigureId(id).color)
  const agents = state.factions
    .map((faction) => ({ faction, count: on.filter((c) => c === faction).length }))
    .filter((a) => a.count > 0)
    .sort((a, b) => b.count - a.count)

  // Strict majority only — a tie leaves nobody able to secure.
  const leader =
    agents.length > 0 && (agents.length === 1 || agents[0]!.count > agents[1]!.count)
      ? agents[0]!.faction
      : undefined

  const card = cardId === undefined ? undefined : courtCard(cardId)
  return { n, cardId, name: card?.name ?? 'empty', kind: card?.kind, agents, leader }
}

export function CourtPanel({ state }: { state: GameState }): JSX.Element {
  const slots = courtSlots().map((n) => read(state, n))
  const deckLeft = contentsOf(state.courtCards, CourtPile.deck()).length
  const [open, setOpen] = useState<number | null>(null)

  const zoomed = open === null ? undefined : slots.find((s) => s.n === open)

  return (
    <div className="court-rail">
      <div className="court-head">
        <span>Court</span>
      </div>

      {/*
        The draw pile, as a pile: the deck's own back with what is left standing on it. It was a
        bare number beside the heading, which said the same thing without looking like the stack of
        cards it is — and the rail is otherwise all card art.
      */}
      <div
        className={`court-draw${deckLeft === 0 ? ' empty' : ''}`}
        title={
          deckLeft === 0
            ? 'The court deck is exhausted'
            : `${deckLeft} card${deckLeft === 1 ? '' : 's'} left in the court deck`
        }
      >
        {deckLeft > 0 ? (
          <img src="/game-assets/court/court-back.webp" alt="" />
        ) : null}
        <span className="court-draw-n">{deckLeft}</span>
      </div>

      {slots.map((s) => (
        <button
          key={s.n}
          type="button"
          className={`court-slot${s.cardId === undefined ? ' empty' : ''}`}
          style={s.leader ? { borderColor: colorOf(s.leader) } : undefined}
          disabled={s.cardId === undefined}
          onClick={() => setOpen(s.n)}
          title={s.cardId === undefined ? 'Empty slot' : `${s.name} — click to enlarge`}
        >
          {s.cardId !== undefined && (
            <img
              className="court-art"
              src={`/game-assets/court/${s.cardId}.webp`}
              alt={s.name}
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.visibility = 'hidden'
              }}
            />
          )}
          {/*
            The rail is ~74px wide, so this keeps the count: there is no room to draw one figure
            per agent as the enlarged card does. The agent token replaces the coloured disc that
            used to stand in for it — same piece, same colour, and it says *what* is being
            counted rather than leaving a bare number on the art.
          */}
          <span className="court-agents">
            {s.agents.map((a) => (
              <span
                key={a.faction}
                className={`court-pip${a.faction === s.leader ? ' leads' : ''}`}
                style={{ borderColor: colorOf(a.faction) }}
                title={`${a.faction}: ${a.count} agent${a.count === 1 ? '' : 's'}`}
              >
                <img
                  className="court-pip-agent"
                  src={figureArt(a.faction, 'agent') ?? undefined}
                  alt=""
                />
                <b>{a.count}</b>
              </span>
            ))}
          </span>
        </button>
      ))}

      {zoomed?.cardId !== undefined && zoomed !== undefined ? (
        <CardZoom cardId={zoomed.cardId} onClose={() => setOpen(null)}>
          <div className="cm-agents-head">Agents</div>
          {zoomed.agents.length === 0 ? (
            <div className="cm-none">none yet</div>
          ) : (
            /*
              Just the agents. They carry their faction's colour, so naming it as well was saying
              the same thing twice — and a numeral is redundant once the figures are there to
              count, the same reasoning as fleets on the map. One row per faction keeps the
              grouping; the row's tooltip still names it for anyone hovering.
            */
            zoomed.agents.map((a) => (
              <div
                key={a.faction}
                className="cm-row"
                title={`${a.faction}: ${a.count} agent${a.count === 1 ? '' : 's'}`}
              >
                {Array.from({ length: a.count }, (_, i) => (
                  <img
                    key={i}
                    className="cm-agent"
                    src={figureArt(a.faction, 'agent') ?? undefined}
                    alt={i === 0 ? `${a.faction}: ${a.count} agents` : ''}
                  />
                ))}
              </div>
            ))
          )}
          <div className="cm-note">
            {zoomed.leader === undefined
              ? 'Tied — nobody may secure this card.'
              : `${zoomed.leader} leads and may secure it.`}
          </div>
        </CardZoom>
      ) : null}
    </div>
  )
}
