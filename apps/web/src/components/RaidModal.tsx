/**
 * Spending raid keys, as a shop rather than a list.
 *
 * Keys buy resources or guild cards off the defender, and the decision is what to spend them on:
 * a guild card is usually worth more than a resource but costs more, and the keys do not carry
 * over. So the two kinds sit side by side with their prices on them, the remaining keys are always
 * visible, and every purchase re-prices the shelf.
 *
 * The engine offers only what the remaining keys can afford, and re-offers after each purchase.
 * This screen renders exactly that and invents nothing — when it runs dry, or the raider stops,
 * the battle settles.
 */

import { courtCard, tallyOf } from '@arcs/engine'
import type { Action, Continue, DieRoll, DieType } from '@arcs/engine'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import { dieArt } from '../dice-art.js'
import { store } from '../store.js'
import { colorOf } from '../theme.js'
import { CardZoom } from './CardZoom.js'

const resourceIcon = (r: string): string => `/game-assets/icon/${r.toLowerCase()}.webp`

/** The resource a token id names, e.g. `Fuel#5`. */
const resourceOf = (token: string): string => token.slice(0, token.indexOf('#'))

/**
 * A price, drawn with the game's own key art — the same `keys-N` image the player board stamps on
 * a resource slot, so a slot's cost reads identically in both places. Anything dearer than the
 * printed set falls back to the `keys-x` plate.
 */
function Price({ n }: { n: number }): JSX.Element {
  const plate = n >= 1 && n <= 4 ? `keys-${n}` : 'keys-x'
  return (
    <img
      className="raid-price"
      src={`/game-assets/icon/${plate}.webp`}
      alt={`${n} key${n === 1 ? '' : 's'}`}
      title={`${n} key${n === 1 ? '' : 's'}`}
    />
  )
}

/**
 * The keys still to spend, shown as the dice that earned them.
 *
 * These are the actual faces this battle rolled — the same art the battle tray showed a moment
 * ago — so the purse is the player's own roll rather than a tally of invented tokens. Only the
 * dice that came up keys are here; the rest of the roll has already been spent as damage.
 *
 * A die dims once **all** of its keys are gone, which is why the run is accumulated rather than
 * counted: the two-key face is still worth something after one of its keys has been spent.
 */
function Purse({ dice, keys }: { dice: readonly DieRoll[]; keys: number }): JSX.Element | null {
  const earners = dice.filter((d) => tallyOf([d]).keys > 0)
  if (earners.length === 0) return null

  let left = keys
  return (
    <span className="raid-keys" title={`${keys} key${keys === 1 ? '' : 's'} to spend`}>
      {earners.map((d, i) => {
        const worth = tallyOf([d]).keys
        const spent = left <= 0
        left -= worth
        return (
          <img
            key={i}
            className={`raid-die${spent ? ' spent' : ''}`}
            src={dieArt(d.die as DieType, d.face)}
            alt=""
          />
        )
      })}
    </span>
  )
}

export function RaidModal({ cont }: { cont: Continue }): JSX.Element | null {
  const [reading, setReading] = useState<string | null>(null)

  const takes = cont.kind === 'ask' ? cont.actions.filter((a) => a.type === 'battle/raid-take') : []
  const stop = cont.kind === 'ask' ? cont.actions.find((a) => a.type === 'battle/settle') : undefined
  if (takes.length === 0 || stop === undefined || cont.kind !== 'ask') return null

  const ctx = takes[0]!['ctx'] as {
    faction: string
    enemy: string
    keys: number
    dice?: readonly DieRoll[]
  }
  const resources = takes.filter((a) => a['kind'] === 'resource')
  const cards = takes.filter((a) => a['kind'] === 'card')

  const shelf = (label: string, items: readonly Action[], render: (a: Action) => JSX.Element) =>
    items.length === 0 ? null : (
      <section className="raid-shelf">
        <h3 className="da-force-head">{label}</h3>
        <div className="raid-items">{items.map(render)}</div>
      </section>
    )

  return createPortal(
    <div className="da-backdrop">
      <div className="da-modal raid-modal">
        <div className="da-head">
          <span className="da-title">Raid</span>
          <span className="da-prompt">
            <span style={{ color: colorOf(ctx.faction as never) }}>{ctx.faction}</span> is raiding{' '}
            <span style={{ color: colorOf(ctx.enemy as never) }}>{ctx.enemy}</span>
          </span>
          <span className="raid-purse">
            <Purse dice={ctx.dice ?? []} keys={ctx.keys} />
            <em>
              {ctx.keys} key{ctx.keys === 1 ? '' : 's'} to spend
            </em>
          </span>
        </div>

        {shelf('Resources', resources, (a) => {
          const r = resourceOf(String(a['target']))
          return (
            <button
              key={String(a['target'])}
              className="raid-item"
              title={`Take ${r} for ${String(a['cost'])} keys`}
              onClick={() => store.apply(a)}
            >
              <img src={resourceIcon(r)} alt={r} />
              <span className="raid-name">{r}</span>
              <Price n={a['cost'] as number} />
            </button>
          )
        })}

        {shelf('Guild cards', cards, (a) => {
          const id = String(a['target'])
          const cost = a['cost'] as number
          return (
            /*
             * The magnifier reads; the card itself buys. Court art carries real body text that no
             * thumbnail can hold, and taking a card is an irreversible steal — so studying one must
             * not be a click on the thing that takes it. Same split as the Learned screen.
             */
            <div key={id} className="raid-slot">
              <button
                className="raid-item card"
                title={`Take ${courtCard(id).name} for ${cost} key${cost === 1 ? '' : 's'}`}
                onClick={() => store.apply(a)}
              >
                <img src={`/game-assets/court/${id}.webp`} alt={courtCard(id).name} />
                <span className="raid-name">{courtCard(id).name}</span>
                <Price n={cost} />
              </button>
              <button
                type="button"
                className="raid-read"
                title={`Read ${courtCard(id).name}`}
                onClick={() => setReading(id)}
              >
                ⌕
              </button>
            </div>
          )
        })}

        <div className="da-actions">
          <button className="da-ghost" onClick={() => store.apply(stop)}>
            Stop raiding
          </button>
        </div>

        <p className="da-note">
          Keys do not carry over — anything unspent is lost when the battle settles. Use the
          magnifier to read a card without taking it.
        </p>
      </div>

      {reading !== null ? (
        <CardZoom cardId={reading} onClose={() => setReading(null)}>
          <div className="cm-note">
            {(() => {
              const cost = courtCard(reading).keys ?? 0
              return `Costs ${cost} key${cost === 1 ? '' : 's'} to raid. Reading it takes nothing.`
            })()}
          </div>
        </CardZoom>
      ) : null}
    </div>,
    document.body,
  )
}
