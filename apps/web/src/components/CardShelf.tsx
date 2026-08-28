/**
 * Court-card decisions, as a shelf of readable cards rather than a list of labelled buttons.
 *
 * docs/15 S1. Influence, Secure and Ransack all ask the same question — *which card in the court* —
 * and all three were rendered as text like "Influence Mining Interest", naming a card whose art,
 * body text and agent counts were somewhere else on screen. The decision is which card, so the
 * decision gets the cards.
 *
 * `RaidModal` already proved the shape (a shelf, a magnifier that reads without taking, an
 * irreversible act on the card itself), and this is that shape generalised to the court.
 *
 * ## What it claims, and what it deliberately does not
 *
 * The three slot-picking actions share a payload — `{ faction, slot, then }` — which is what makes
 * one surface right for them. Three of the decisions docs/15 grouped under S1 turned out **not** to
 * share it, and are left in the panel:
 *
 *   - `leaders/beloved` carries no card at all; it is a yes/no, so it belongs to S6's confirm strip.
 *   - `turn/bards-declare` picks an *ambition*, not a card — the same shape as Populist Demands,
 *     which already has the ambition track.
 *   - `leaders/generous-give` picks a card **and** a recipient, so it is a matrix rather than a
 *     shelf and wants its own treatment.
 *
 * **Bold needs no code here.** `leaders/bold` is only the door — the picks it leads to are ordinary
 * `action/influence` actions carrying `then: leaders/bold`, so the shelf draws them like any other
 * influence and the engine re-offers until the player stops. The multi-select variant docs/15
 * anticipated is just the shelf staying open.
 */

import { courtCard } from '@arcs/engine'
import type { Continue, GameState } from '@arcs/engine'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { asset } from '../assets.js'
import { shelfParts } from '../court-slot.js'
import type { CourtSlot } from '../court-slot.js'
import { store } from '../store.js'
import { useModalDrag } from '../modal-drag.js'
import { owns } from '../surfaces.js'
import { colorOf, figureArt } from '../theme.js'
import { CardZoom } from './CardZoom.js'

/**
 * Title and footnote per decision, chosen from the actions actually offered.
 *
 * An Ask offers one kind at a time, so the first pick decides. The note says what the act costs,
 * because that is the part a card thumbnail cannot show.
 */
const COPY: Record<string, { title: string; note: string }> = {
  'action/influence': {
    title: 'Influence',
    note: 'Places an agent. A card is secured only on a strict majority — a tie secures nothing.',
  },
  'action/secure': {
    title: 'Secure',
    note: 'Takes the card and its agents. Rival agents on it become your captives.',
  },
  'action/ransack': {
    title: 'Ransack',
    note: 'Takes a card from the court outright, as spoils of the city you razed.',
  },
}

/**
 * The part of the engine's prompt the header does not already say.
 *
 * Influence and Secure are asked as `"red — Influence"`, which alongside the title and the faction
 * chip rendered "RED — RED — INFLUENCE". Ransack's prompt is `"red destroyed a blue city — ransack
 * the court?"`, which carries something the header genuinely cannot. So the faction prefix and a
 * restatement of the title are stripped, and whatever is left is shown.
 */
function detail(faction: string, prompt: string | undefined, title: string): string {
  // Strips a leading faction name whether it is punctuated off ("red — Influence") or runs straight
  // into the sentence ("white razed a city — ransack the court?"), since the chip has just said it.
  const bare = (prompt ?? '').replace(new RegExp(`^\\s*${faction}\\s*(?:[—-]\\s*)?`, 'i'), '').trim()
  return bare === '' || bare.toLowerCase() === title.toLowerCase() ? '' : ` — ${bare}`
}

export function CardShelf({ state, cont }: { state: GameState; cont: Continue }): JSX.Element | null {
  const [reading, setReading] = useState<string | null>(null)
  const drag = useModalDrag()

  if (cont.kind !== 'ask' || !owns('shelf', cont)) return null

  /*
   * Built by `shelfItems` rather than here, so `court-slot.test.ts` can assert against real play
   * that every pick resolves to a drawable card. A pick that did not would render as nothing at
   * all, which is the bug class `surfaces.ts` exists to prevent and which ownership alone cannot
   * catch.
   */
  const { items, others, escape } = shelfParts(state, cont)
  if (items.length === 0) return null

  const copy = COPY[items[0]!.action.type] ?? { title: 'Court', note: '' }

  return createPortal(
    <div className={`da-backdrop${drag.dragged ? ' aside' : ''}`}>
      <div ref={drag.ref} className="da-modal shelf-modal" style={drag.style}>
        <div className="da-head" {...drag.handle}>
          <span className="da-title">{copy.title}</span>
          <span className="da-prompt">
            <span style={{ color: colorOf(cont.faction) }}>{cont.faction}</span>
            {detail(cont.faction, cont.prompt, copy.title)}
          </span>
        </div>

        <div className="shelf-items">
          {items.map(({ action, slot }) => {
            const id = slot.cardId!
            return (
              <div key={`${action.type}-${slot.n}`} className="shelf-slot">
                <button
                  className="shelf-item"
                  title={`${copy.title} ${slot.name}`}
                  onClick={() => store.apply(action)}
                >
                  <img src={asset(`game-assets/court/${id}.webp`)} alt={slot.name} />
                  <span className="shelf-name">{slot.name}</span>
                  <Agents slot={slot} />
                </button>
                {/*
                 * The magnifier reads; the card itself acts. Court art carries body text no
                 * thumbnail can hold, and securing or ransacking is irreversible — so studying a
                 * card must not be a click on the thing that takes it. Same split as RaidModal.
                 */}
                <button
                  type="button"
                  className="shelf-read"
                  title={`Read ${slot.name}`}
                  onClick={() => setReading(id)}
                >
                  ⌕
                </button>
              </div>
            )
          })}
        </div>

        {/*
          * Everything else the Ask offers, as labelled buttons: guild alternatives from `withAlts`,
          * a return to the pip menu, a trait follow-up. Not enumerated by type — `shelfParts`
          * partitions the Ask exhaustively, so anything new is drawn here without anyone having to
          * remember to add it. See `court-slot.ts`.
          */}
        {others.length === 0 ? null : (
          <div className="shelf-alts">
            <h3 className="da-force-head">Instead</h3>
            <div className="shelf-alt-row">
              {others.map((a, i) => (
                <button key={`other-${i}`} className="shelf-alt" onClick={() => store.apply(a)}>
                  {String(a['label'] ?? a.type)}
                </button>
              ))}
            </div>
          </div>
        )}

        {escape === undefined ? null : (
          <div className="da-actions">
            <button className="da-ghost" onClick={() => store.apply(escape)}>
              {String(escape['label'] ?? 'Skip')}
            </button>
          </div>
        )}

        <p className="da-note">
          {copy.note} Use the magnifier to read a card without acting on it.
        </p>
      </div>

      {reading !== null ? <CardZoom cardId={reading} onClose={() => setReading(null)} /> : null}
    </div>,
    document.body,
  )
}

/**
 * Who stands on this card, using the court rail's own representation.
 *
 * Agents are the whole basis of Secure, so showing them here is not decoration: without them the
 * shelf would be asking which card to contest while hiding the contest. The strict-majority leader
 * is ringed, exactly as the rail rings it.
 */
function Agents({ slot }: { slot: CourtSlot }): JSX.Element | null {
  if (slot.agents.length === 0) return null
  return (
    <span className="shelf-agents">
      {slot.agents.map((a) => (
        <span
          key={a.faction}
          className={`shelf-agent${slot.leader === a.faction ? ' leads' : ''}`}
          title={`${a.faction}: ${a.count} agent${a.count === 1 ? '' : 's'}${
            slot.leader === a.faction ? ' (leads)' : ''
          }`}
        >
          <img src={figureArt(a.faction, 'agent') ?? undefined} alt="" />
          <em>{a.count}</em>
        </span>
      ))}
    </span>
  )
}
