/**
 * The Prelude: spend resources, before your pips.
 *
 * **A tray, not a modal.** It sits across the bottom of the map column, over the hand — you have
 * already played your card, so the fan is spent for the turn — and leaves the map, the court and
 * your own player board in view. Spending here is a decision you make *looking at the board*:
 * whether a Fuel is worth a Move depends on where your ships are.
 *
 * That is why it is a sibling of `.hand-row` rather than a child: the hand row clips its children
 * to hide the fan's overhang. The tray fits the row's fixed height — the map must not resize when
 * it opens — with the tiles scrolling inside the band on the rare menu that cannot.
 *
 * The most-used decision in the game, and it used to read as a list of sentences —
 * `Fuel: Move`, `Weapon: add Battle option`, `Discard Relic (no effect)`. But the choice is
 * *which token you spend*, so the tokens are the buttons, and what each one buys hangs off it.
 *
 * **One tile per resource type, not per token.** Two Fuel are the same choice; the count on the
 * tile says how many you hold. That mirrors the engine, which offers per type for the same reason.
 *
 * **An outraged type still appears**, dimmed, wearing its outrage art and able to do nothing but
 * be discarded. Hiding it would make the board look wrong — the token is still on it — and the
 * whole cost of outrage is seeing what you cannot spend.
 *
 * Guild cards sit apart because they are not token spends: each one **discards the card** as its
 * cost, which is why none needs a once-per-turn marker.
 *
 * The Prelude is a loop in the engine — every spend returns to this menu — so the screen simply
 * re-renders against whatever it is offered next, and closes when the menu is gone.
 */

import { courtCard, heldTokens, outragedResources, parseResourceToken, slotsOf } from '@arcs/engine'
import type { Action, Continue, FactionId, GameState, Resource } from '@arcs/engine'
import { useState } from 'react'

import { store } from '../store.js'
import { colorOf } from '../theme.js'
import { CardZoom } from './CardZoom.js'
import { asset } from '../assets.js'

const iconFor = (r: Resource, outraged: boolean): string =>
  asset(`game-assets/icon/${r.toLowerCase()}${outraged ? '-outrage' : ''}.webp`)

/** The Prelude action each resource buys, as printed on the player board. */
const PRINTED: Record<Resource, string> = {
  Material: 'Build or repair',
  Fuel: 'Move',
  Weapon: 'Lets your card battle',
  Relic: 'Secure',
  Psionic: 'Take an action of the lead card',
}

/** Everything one resource type can buy this Prelude. */
interface Tile {
  resource: Resource
  held: number
  outraged: boolean
  buys: { label: string; action: Action; discard: boolean }[]
}

/** A Loyal card letting this resource be spent as another type, when the engine says so. */
function viaOf(a: Action): { as: string; name: string } | undefined {
  const via = a['via'] as { as: string; card: string } | undefined
  if (via === undefined) return undefined
  return { as: via.as, name: courtCard(via.card).name }
}

/** What a spend of this kind is called on a chip — the verb, not a sentence. */
function chipLabel(a: Action): string {
  switch (a.type) {
    case 'turn/prelude-battle':
      return 'Battle option'
    case 'turn/prelude-discard':
      return 'Discard'
    default: {
      const via = viaOf(a)
      return via === undefined
        ? String(a['action'])
        : `${String(a['action'])} — as ${via.as} (${via.name})`
    }
  }
}

/** The full sentence for the chip's tooltip. */
function spendTitle(resource: string, a: Action, label: string): string {
  if (a.type === 'turn/prelude-discard') return `Spend the ${resource} for nothing, to free its slot`
  const via = viaOf(a)
  return via === undefined
    ? `Spend the ${resource} to ${label}`
    : `Spend the ${resource} as a ${via.as} to ${String(a['action'])} — ${via.name} lets any resource be spent as ${via.as}s`
}

export function PreludeScreen({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  const [reading, setReading] = useState<string | null>(null)

  const asked = cont.kind === 'ask' ? cont.actions : []
  const done = asked.find((a) => a.type === 'turn/prelude-done')
  const arrange = asked.find((a) => a.type === 'turn/prelude-arrange')
  const guild = asked.filter((a) => a.type === 'turn/prelude-guild')
  const spends = asked.filter(
    (a) =>
      a.type === 'turn/prelude-spend' ||
      a.type === 'turn/prelude-battle' ||
      a.type === 'turn/prelude-discard',
  )
  // `prelude-done` is the one action always present, so it alone identifies this menu.
  if (done === undefined || cont.kind !== 'ask') return null

  const faction = cont.faction
  const outraged = outragedResources(state, faction)
  const counts = new Map<Resource, number>()
  for (const token of heldTokens(state.resources, slotsOf(state, faction))) {
    const r = parseResourceToken(token).resource
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }

  // A tile per type held, in the board's own order, each carrying what it can buy.
  const tiles: Tile[] = [...counts.entries()].map(([resource, held]) => ({
    resource,
    held,
    outraged: outraged.includes(resource),
    buys: spends
      .filter((a) => a['resource'] === resource)
      .map((a) => ({
        label: chipLabel(a),
        action: a,
        discard: a.type === 'turn/prelude-discard',
      })),
  }))

  /*
   * One horizontal band: identity rail | tiles | the way on. The head used to be its own line
   * above the tiles, which pushed the tray past the fixed hand row and resized the map whenever
   * the Prelude opened. The sub-line ("spend resources before acting") is the rail's tooltip now.
   */
  return (
    <div className="pr-tray">
      <div className="pr-inner">
        <div className="pr-head" title="Spend resources before acting">
          <span className="da-title">Prelude</span>
          <span className="pr-who" style={{ color: colorOf(faction as FactionId) }}>
            {faction}
          </span>
        </div>

        <div className="pr-body">
        {tiles.length === 0 ? (
          <p className="pr-empty">Nothing in your slots to spend.</p>
        ) : (
          <div className="pr-tiles">
            {tiles.map((t) => (
              <div key={t.resource} className={`pr-tile${t.outraged ? ' outraged' : ''}`}>
                <div className="pr-token">
                  <img src={iconFor(t.resource, t.outraged)} alt={t.resource} />
                  {t.held > 1 ? <span className="pr-count">×{t.held}</span> : null}
                </div>
                <div className="pr-printed-row">
                  <span className="pr-name">{t.resource}</span>
                  <span className="pr-printed">
                    {t.outraged ? 'outraged — cannot be spent' : PRINTED[t.resource]}
                  </span>
                </div>
                <div className="pr-buys">
                  {t.buys.map((b, i) => (
                    <button
                      key={i}
                      className={`pr-buy${b.discard ? ' discard' : ''}`}
                      onClick={() => store.apply(b.action)}
                      title={spendTitle(t.resource, b.action, b.label)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {guild.length > 0 ? (
          <section className="pr-guild">
            <h3 className="pr-guild-head">Guild cards — discarded to use</h3>
            <div className="pr-cards">
              {guild.map((a, i) => {
                const id = String(a['card'])
                return (
                  <div key={i} className="pr-card-slot">
                    <button
                      className="pr-card"
                      onClick={() => store.apply(a)}
                      title={String(a['label'])}
                    >
                      <img src={asset(`game-assets/court/${id}.webp`)} alt={courtCard(id).name} />
                      <span>
                        <span className="pr-card-name">{courtCard(id).name}</span>
                        <br />
                        {/* The label repeats the name; only the effect is wanted here. */}
                        <span className="pr-card-what">
                          {String(a['label']).replace(`${courtCard(id).name} — `, '')}
                        </span>
                      </span>
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
            </div>
          </section>
        ) : null}
        </div>

        <div className="pr-head-actions">
          {arrange === undefined ? null : (
            <button className="pr-arrange" onClick={() => store.apply(arrange)}>
              Arrange slots
            </button>
          )}
          <button className="sb-done" onClick={() => store.apply(done)}>
            {String(done['label'])}
          </button>
        </div>
      </div>

      {reading !== null ? (
        <CardZoom cardId={reading} onClose={() => setReading(null)}>
          <div className="cm-note">Using its Prelude ability discards this card.</div>
        </CardZoom>
      ) : null}
    </div>
  )
}
