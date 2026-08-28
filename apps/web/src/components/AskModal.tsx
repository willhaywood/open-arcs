/**
 * The focused dialog for the short, self-contained matrices no other surface can carry
 * (Phase 4): resource-tile picks and card-with-recipient picks.
 *
 *   - **Tiles** — Outrage Spreads (which resource everyone provokes), Press Gang (which
 *     resource per returned captive, looping), Mythic's reshaping (which held token remakes
 *     the planet). The choice is a token, so the tokens are the buttons, exactly as the
 *     Prelude draws them.
 *   - **Cards** — Guild Struggle's steal (whose card to take) and Generous' gift (which card,
 *     to which poorest rival): the card art with the act on it, the shelf's shape.
 *   - **Trade** — Elder Broker's take/give swap, one row per combination with the tokens drawn.
 *
 * The partition is total, shelfParts-style: family items get their layout, escapes become the
 * way out, and anything else the engine adds to one of these asks renders as a labelled button
 * rather than vanishing. Draggable like every console dialog.
 */

import { courtCard, parseResourceToken } from '@arcs/engine'
import type { Action, Continue } from '@arcs/engine'
import { createPortal } from 'react-dom'

import { asset } from '../assets.js'
import { useModalDrag } from '../modal-drag.js'
import { store } from '../store.js'
import { ESCAPES, owns } from '../surfaces.js'
import { colorOf, textOn } from '../theme.js'

const TILE_TYPES = ['vox/outrage', 'action/pressgang', 'leaders/mythic-place']
const CARD_TYPES = ['vox/steal-guild', 'leaders/generous-give']

const TITLES: Record<string, string> = {
  'vox/outrage': 'Outrage Spreads',
  'action/pressgang': 'Press Gang',
  'leaders/mythic-place': 'Mythic',
  'vox/steal-guild': 'Guild Struggle',
  'leaders/generous-give': 'Generous',
  'action/trade': 'Trade',
}

/** The resource a tile option turns on. */
function tileResource(a: Action): string {
  const r = a['resource']
  if (typeof r === 'string') return r
  const token = a['token']
  return typeof token === 'string' ? parseResourceToken(token).resource : 'Material'
}

export function AskModal({ cont }: { cont: Continue }): JSX.Element | null {
  const drag = useModalDrag()
  if (cont.kind !== 'ask' || !owns('modal', cont)) return null

  // `vox/done` is the vox cards' own way out ("Skip", "Steal nothing"); it belongs in the footer.
  const escapes = cont.actions.filter((a) => ESCAPES.includes(a.type) || a.type === 'vox/done')
  const tiles = cont.actions.filter((a) => TILE_TYPES.includes(a.type))
  const cards = cont.actions.filter((a) => CARD_TYPES.includes(a.type))
  const trades = cont.actions.filter((a) => a.type === 'action/trade')
  // The total partition's remainder: whatever else the engine offered, drawn rather than lost.
  const others = cont.actions.filter(
    (a) => !escapes.includes(a) && !tiles.includes(a) && !cards.includes(a) && !trades.includes(a),
  )

  const first = tiles[0] ?? cards[0] ?? trades[0]
  const title = first !== undefined ? (TITLES[first.type] ?? 'Choose') : 'Choose'

  return createPortal(
    <div className={`da-backdrop${drag.dragged ? ' aside' : ''}`}>
      <div ref={drag.ref} className="da-modal ask-modal" style={drag.style}>
        <div className="da-head" {...drag.handle}>
          <span className="da-title">{title}</span>
          <span className="da-prompt">
            <span style={{ color: colorOf(cont.faction) }}>{cont.faction}</span>
            {cont.prompt !== undefined ? ` — ${cont.prompt}` : null}
          </span>
        </div>

        {tiles.length > 0 ? (
          <div className="am-tiles">
            {tiles.map((a, i) => {
              const r = tileResource(a)
              return (
                <button
                  key={i}
                  type="button"
                  className="am-tile"
                  title={String(a['label'] ?? r)}
                  onClick={() => store.apply(a)}
                >
                  <img src={asset(`game-assets/icon/${r.toLowerCase()}.webp`)} alt={r} />
                  <span>{String(a['label'] ?? r)}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {cards.length > 0 ? (
          <div className="am-cards">
            {cards.map((a, i) => {
              const id = String(a['stolen'] ?? a['card'])
              const to = String(a['to'] ?? a['from'] ?? '')
              return (
                <div key={i} className="am-card-slot">
                  <img src={asset(`game-assets/court/${id}.webp`)} alt={courtCard(id).name} />
                  <button
                    type="button"
                    className="am-act"
                    title={String(a['label'] ?? '')}
                    onClick={() => store.apply(a)}
                  >
                    {a.type === 'vox/steal-guild' ? 'Steal from ' : 'Give to '}
                    <span
                      className="am-who"
                      style={{ background: colorOf(to), color: textOn(to) }}
                    >
                      {to}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {trades.length > 0 ? (
          <div className="am-trades">
            {trades.map((a, i) => (
              <button
                key={i}
                type="button"
                className="am-trade"
                title={String(a['label'] ?? '')}
                onClick={() => store.apply(a)}
              >
                <span className="am-give">
                  <img
                    src={asset(`game-assets/icon/${String(a['give']).toLowerCase()}.webp`)}
                    alt={String(a['give'])}
                  />
                  give
                </span>
                <span className="am-arrow">⇄</span>
                <span className="am-take">
                  <img
                    src={asset(`game-assets/icon/${String(a['take']).toLowerCase()}.webp`)}
                    alt={String(a['take'])}
                  />
                  take from{' '}
                  <span
                    className="am-who"
                    style={{ background: colorOf(String(a['rival'])), color: textOn(String(a['rival'])) }}
                  >
                    {String(a['rival'])}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {others.length > 0 ? (
          <div className="am-others">
            {others.map((a, i) => (
              <button key={i} type="button" className="strip-btn" onClick={() => store.apply(a)}>
                {String(a['label'] ?? a.type)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="da-actions">
          {escapes.map((a, i) => (
            <button key={i} className="da-ghost" onClick={() => store.apply(a)}>
              {String(a['label'] ?? 'Cancel')}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
