/**
 * The ambitions panel, to the right of the map — as on the physical board.
 *
 * Uses the real board artwork (`ambitions.webp`, 431x1224) as the backdrop and overlays the
 * live state at percentage positions measured from that image: available markers on the
 * three hex slots at the top, and declared markers inside the matching ambition box. Below
 * it sits the chapter strip (`chapter-N.webp`) and the power goal token for this player
 * count (`goal-27` at four players, `goal-30` at three — the 39 - 3n threshold).
 *
 * If the artwork is missing the panel falls back to a plain readable list.
 */

import { AMBITIONS } from '@arcs/engine'
import type { Action, Ambition, AmbitionMarker, Continue, GameState } from '@arcs/engine'
import { useState } from 'react'

import { store } from '../store.js'
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
  const threshold = 39 - state.factions.length * 3

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
