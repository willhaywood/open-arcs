/**
 * The ambitions panel, to the right of the map — as on the physical board.
 *
 * Uses the real board artwork (`ambitions.webp`, 431x1224) as the backdrop and overlays the
 * live state at percentage positions measured from that image: available markers on the
 * three hex slots at the top, and declared markers inside the matching ambition box. Below
 * it sits the chapter strip (`chapter-N.webp`) and the power goal token for this player
 * count (`goal-27` at four players, `goal-30` at three, `goal-33` at two — the 39 - 3n threshold).
 *
 * At two players the boxes also carry the **out-of-play resources**, which score as a third player
 * (rulebook p19). They are shown as a count against the ambition they feed, because a player who
 * cannot see what the phantom holds cannot tell whether declaring is worth anything.
 *
 * If the artwork is missing the panel falls back to a plain readable list.
 */

import { AMBITIONS, FUEL_CARTEL, MATERIAL_CARTEL, RESOURCES, ResourceSlot, contentsOf, courtCard, phantomHolding, securedCards, supplyOf } from '@arcs/engine'
import type { Action, Ambition, AmbitionMarker, Continue, GameState } from '@arcs/engine'
import { useState } from 'react'

import { ambitionFlash, liveFlash } from '../bot-events.js'
import { store, useBotUi } from '../store.js'
import { colorOf } from '../theme.js'
import { asset } from '../assets.js'

/** Vertical centre of each ambition box, as a fraction of the panel height. */
const ROW_Y: Record<Ambition, string> = {
  Tycoon: '27.5%',
  Tyrant: '44%',
  Warlord: '60.5%',
  Keeper: '77%',
  Empath: '93.5%',
}

/** Centres of the three hex slots for undeclared markers. */
const HEX_X = ['18%', '50%', '82%']
const HEX_Y = '11.8%'

function markerSrc(m: AmbitionMarker): string {
  return asset(`game-assets/ambition/ambition-values-${m.high}-${m.low}.webp`)
}

export function AmbitionTrack({
  state,
  cont,
}: {
  state: GameState
  cont?: Continue
}): JSX.Element {
  const [artBroken, setArtBroken] = useState(false)
  /*
   * The chip tooltips are a fixed-position element rather than CSS `::after`, for two reasons
   * found the hard way: native `title` bubbles are drawn by the browser chrome and never appear
   * in an embedded/streamed view, and a pseudo-element cannot escape the track's `overflow`
   * clipping — the panel is far narrower than a readable sentence. Fixed positioning anchors to
   * the chip's rect and grows leftward over the map, where the room is.
   */
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const showTip = (e: React.MouseEvent<HTMLElement>): void => {
    const el = e.currentTarget
    const text = el.dataset['tip']
    if (text === undefined) return
    const r = el.getBoundingClientRect()
    setTip({ text, x: r.right, y: r.bottom + 6 })
  }
  const hideTip = (): void => setTip(null)
  const threshold = 39 - state.factions.length * 3

  // A bot declaring an ambition flashes that row (see bot-events.ts).
  useBotUi()
  const flash = liveFlash(store.botEvents, performance.now(), ambitionFlash)
  const rowFlash =
    flash !== undefined && flash.value in ROW_Y ? (
      <div
        key={`evt-${flash.id}`}
        className="amb-evt evt-flash"
        style={{ top: ROW_Y[flash.value as Ambition] }}
      />
    ) : null

  /*
   * Populist Demands declares an ambition, and declaring one is a thing you do *to this track* —
   * it was a list of "Declare Tycoon" buttons beside the board that shows the five ambitions and
   * which are already taken. The row you would be claiming is right there, so it is clickable.
   */
  const declarable = new Map<Ambition, Action>()
  if (cont?.kind === 'ask') {
    for (const a of cont.actions) {
      if (a.type === 'vox/populist') declarable.set(a['ambition'] as Ambition, a)
    }
  }

  const declaredByAmbition = new Map<Ambition, AmbitionMarker[]>()
  for (const d of state.declared) {
    const list = declaredByAmbition.get(d.ambition) ?? []
    list.push(d.marker)
    declaredByAmbition.set(d.ambition, list)
  }

  /*
   * The claim strip has to survive the art failing to load.
   *
   * This early return sits *before* the track's own markup, so putting the Populist Demands buttons
   * only in the main return would leave that decision undrawable whenever the artwork 404s — and
   * the action panel steps aside for anything this surface claims, so the game would stop. The
   * renderability invariant cannot catch this: it asks who owns an Ask, not whether a runtime
   * branch inside the owner happens to draw it.
   */
  const claims =
    declarable.size === 0 ? null : (
      <>
        {[...declarable.entries()].map(([a, action]) => (
          <button
            key={`declare-${a}`}
            type="button"
            className="amb-claim"
            style={{ top: ROW_Y[a] }}
            title={`Declare ${a}`}
            onClick={() => store.apply(action)}
          >
            <span>Declare {a}</span>
          </button>
        ))}
      </>
    )

  if (artBroken) {
    return (
      <div className="amb-wrap">
        <AmbitionFallback state={state} threshold={threshold} />
        {claims}
      </div>
    )
  }

  return (
    <div className="ambition-track">
      {tip !== null && (
        <div className="amb-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
      <div className="ambition-panel">
        <img
          className="ambition-art"
          src={asset('game-assets/ambitions.webp')}
          alt="Ambitions"
          onError={() => setArtBroken(true)}
        />

        {/* Undeclared markers sit on the hex slots. */}
        {state.ambitionable.slice(0, 3).map((m, i) => (
          <img
            key={`${m.high}-${m.low}-${i}`}
            className="amb-marker"
            src={markerSrc(m)}
            alt={`${m.high}/${m.low}`}
            style={{ left: HEX_X[i], top: HEX_Y }}
          />
        ))}

        {/* Populist Demands — click the ambition's row to declare it. */}
        {claims}

        {/* A bot's declaration, flashed on the row it claimed. */}
        {rowFlash}

        {/*
          * The two-player rival: the six out-of-play resources, sitting in the boxes they were
          * dealt to. Zero at 3-4 players, so nothing renders there.
          */}
        {AMBITIONS.map((a) => {
          const held = phantomHolding(state, a)
          if (held === 0) return null
          return (
            <span
              key={`phantom-${a}`}
              className="amb-phantom"
              /*
               * Hoverable for the tooltip except while a declare ask is live — the chips sit on
               * the Populist Demands claim rows, and a click must win over a hover explanation.
               */
              style={{ top: ROW_Y[a], pointerEvents: declarable.size > 0 ? 'none' : 'auto' }}
              onMouseEnter={showTip}
              onMouseLeave={hideTip}
              data-tip={`Two-player rule (rulebook p19): the ${held} out-of-play ${
                held === 1 ? 'resource counts' : 'resources count'
              } toward ${a} as if a third player held them — they can place but never score`}
            >
              {held}
            </span>
          )
        })}

        {/*
          * The Cartels' supply claim (docs/13): while secured, the holder counts the entire token
          * supply of that resource toward Tycoon. On a table the tokens sit on the card; here the
          * claim would be invisible, so it gets the phantom's treatment — a count on the row.
          *
          * Shown whenever the card is held, **including at zero**, unlike the phantom: a phantom
          * at 0 is no phantom, but a held Cartel at 0 supply is still the standing claim that
          * rivals' scoring discards will land on.
          */}
        {([
          [MATERIAL_CARTEL, 'Material'],
          [FUEL_CARTEL, 'Fuel'],
        ] as const).map(([card, resource], i) => {
          const holder = state.factions.find((f) => securedCards(state, f).includes(card))
          if (holder === undefined) return null
          const n = supplyOf(state.resources, resource).length
          return (
            <span
              key={`cartel-${card}`}
              className="amb-cartel"
              style={{
                top: ROW_Y.Tycoon,
                left: i === 0 ? '48%' : '62%',
                borderColor: colorOf(holder),
                // Same hover-vs-claim-click rule as the phantom chip below.
                pointerEvents: declarable.size > 0 ? 'none' : 'auto',
              }}
              onMouseEnter={showTip}
              onMouseLeave={hideTip}
              data-tip={`${holder}'s ${courtCard(card).name}: the ${n} ${resource} in the supply count toward ${holder}'s Tycoon — held on the card, and ${holder} can't spend them`}
            >
              {n}
            </span>
          )
        })}

        {/* Declared markers sit in their ambition's box. */}
        {AMBITIONS.map((a) => {
          const markers = declaredByAmbition.get(a) ?? []
          return markers.map((m, i) => (
            <img
              key={`${a}-${i}`}
              className="amb-marker declared"
              src={markerSrc(m)}
              alt={`${a} ${m.high}/${m.low}`}
              // Left of centre so the Tyrant/Warlord "return in cleanup" notes stay legible.
              style={{
                left: `${45 + (i - (markers.length - 1) / 2) * 24}%`,
                top: ROW_Y[a],
              }}
            />
          ))
        })}
      </div>

      <div className="chapter-strip">
        <img
          src={asset(`game-assets/chapter-${Math.min(Math.max(state.chapter, 1), 5)}.webp`)}
          alt={`Chapter ${state.chapter}`}
        />
      </div>

      <div className="goal-row">
        <img src={asset(`game-assets/goal-${threshold}.webp`)} alt={`${threshold} power`} />
        <span>to win</span>
      </div>

      <Supply state={state} />
    </div>
  )
}

/**
 * What is left in the general supply, one row per resource.
 *
 * Worth showing because it is information the board already contains but hides: tokens live in a
 * pile off to one side, and running a type dry is a real event — `gain` reports
 * "(none left in supply)" and the tax simply yields nothing. A player who cannot see the counts has
 * no warning that the Fuel is about to run out, and no way to understand it afterwards.
 *
 * Rendered as a compact strip under the chapter marker rather than as tokens: at this width the
 * rail has room for a glyph and a number, and the number is the part that matters.
 */
function Supply({ state }: { state: GameState }): JSX.Element {
  return (
    <div className="supply-row" title="Resources left in the supply">
      {RESOURCES.map((r) => {
        const left = contentsOf(state.resources, ResourceSlot.supply(r)).length
        return (
          <span key={r} className={`supply-chip${left === 0 ? ' out' : ''}`}>
            <img src={asset(`game-assets/icon/${r.toLowerCase()}.webp`)} alt={r} />
            <span>{left}</span>
          </span>
        )
      })}
    </div>
  )
}

function AmbitionFallback({
  state,
  threshold,
}: {
  state: GameState
  threshold: number
}): JSX.Element {
  const declared = new Map<string, { high: number; low: number }>()
  for (const d of state.declared) {
    const cur = declared.get(d.ambition) ?? { high: 0, low: 0 }
    declared.set(d.ambition, { high: cur.high + d.marker.high, low: cur.low + d.marker.low })
  }
  return (
    <div className="ambition-track fallback">
      <div className="section-title">Ambitions</div>
      {AMBITIONS.map((a) => {
        const m = declared.get(a)
        return (
          <div key={a} className={`ambition${m ? ' declared' : ''}`}>
            <span>{a}</span>
            <span>{m ? `${m.high}/${m.low}` : '—'}</span>
          </div>
        )
      })}
      <div className="ambition-avail">
        available: {state.ambitionable.map((m) => `${m.high}/${m.low}`).join('  ') || '—'}
      </div>
      <div className="ambition-avail">
        chapter {state.chapter} · {threshold} power to win
      </div>
    </div>
  )
}
