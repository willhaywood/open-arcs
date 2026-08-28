/**
 * The board. The real map art is the board; pieces and empty building slots are laid out at
 * precomputed points *inside* each planet's region (board-topology `render.placements`,
 * derived from the region bitmap), which is what HRF does at runtime via its FitLayer.
 *
 * The schematic node rings and adjacency lines an earlier revision drew are gone — the
 * adjacency logic still drives play, it just no longer needs to be shown.
 *
 * This is an SVG vector board rather than the canvas + real-art compositor doc 02 describes.
 * For ~24 labelled, clickable nodes that are static between actions, SVG is simpler and the
 * performance argument for canvas does not apply; the real map image is an optional backdrop
 * behind it. When component art is layered in, a canvas map layer can sit underneath.
 */

import {
  Location,
  MAP_SIZE,
  contentsOf,
  freeSlots,
  parseFigureId,
  system as systemInfo,
} from '@arcs/engine'
import type { Action, Continue, GameState, SystemInfo } from '@arcs/engine'
import { useEffect, useRef, useState } from 'react'

import { store, useBotUi } from '../store.js'
import { caption, derivePlacement, liveEvents } from '../bot-events.js'
import type { BotEvent } from '../bot-events.js'
import { colorOf, figureArt } from '../theme.js'
import { asset } from '../assets.js'

interface Props {
  state: GameState
  cont: Continue
  highlight: string | undefined
}

/** Systems a battle may be declared in, from `battle/system` actions — click to fight there. */
function battleSystems(cont: Continue): Map<string, Action> {
  const m = new Map<string, Action>()
  if (cont.kind !== 'ask') return m
  for (const a of cont.actions) {
    if (a.type === 'battle/system') m.set(a['system'] as string, a)
  }
  return m
}

/**
 * Galactic Rifles, both steps, as system -> action.
 *
 * The card is a *spatial* decision twice over — which of your systems fires, then which adjacent
 * system it hits — and both were lists of labelled buttons ("Fire from 5-Gate", "Fire at red in
 * 2-Arrow") while the map that answers them sat right there. Same treatment as Battle: reticles on
 * the systems you may choose.
 *
 * `rifles/target` is the *first* step despite the name — it carries `from`, the system that fires.
 * `rifles/roll` is the second and carries `at`, the system struck. Keyed off the field rather than
 * the type name, so the naming quirk cannot mislead.
 */
function riflesSystems(cont: Continue): { map: Map<string, Action>; kind: 'from' | 'at' } {
  const map = new Map<string, Action>()
  if (cont.kind !== 'ask') return { map, kind: 'from' }
  for (const a of cont.actions) {
    if (a.type === 'rifles/target') map.set(a['from'] as string, a)
  }
  if (map.size > 0) return { map, kind: 'from' }
  for (const a of cont.actions) {
    if (a.type === 'rifles/roll') map.set(a['at'] as string, a)
  }
  return { map, kind: 'at' }
}

/**
 * Mass Uprising, both steps, as system -> action.
 *
 * Choosing a *cluster* was a list of "Rise up in cluster 3" with nothing on the map saying which
 * systems that is — the one decision in the game where the thing being chosen had no drawn
 * representation at all. A cluster is a set of systems, so every system in it lights up and
 * clicking any of them chooses the cluster.
 *
 * The second step places ships one at a time and already names a system, so it needs no
 * translation — the same shape as Galactic Rifles' target step.
 */
function uprisingSystems(
  state: GameState,
  cont: Continue,
): { map: Map<string, Action>; kind: 'cluster' | 'place' } {
  const map = new Map<string, Action>()
  if (cont.kind !== 'ask') return { map, kind: 'cluster' }

  const clusters = cont.actions.filter((a) => a.type === 'vox/uprising')
  if (clusters.length > 0) {
    for (const a of clusters) {
      const n = Number(a['cluster'])
      for (const id of state.board.systems) {
        if (systemInfo(id).cluster === n) map.set(id, a)
      }
    }
    return { map, kind: 'cluster' }
  }
  for (const a of cont.actions) {
    /*
     * All of these are "choose a system to place pieces in", so they read as the same gesture on
     * the map. `turn/reinforce` is the no-elimination rule (rulebook p22) offering every gate;
     * `turn/gates-place` is Gatekeepers' shortage picker (docs/20 B3), also offering gates;
     * `turn/ships-place` is the 3-ships Prelude cards' system pick, offering controlled systems.
     */
    if (
      a.type === 'vox/uprising-place' ||
      a.type === 'turn/reinforce' ||
      a.type === 'turn/gates-place' ||
      a.type === 'turn/ships-place'
    ) {
      map.set(a['system'] as string, a)
    }
  }
  return { map, kind: 'place' }
}

/**
 * Repair, as click targets on the damaged pieces themselves.
 *
 * The ask lists one action per damaged figure, which as buttons read as entity ids — no answer
 * to "which ship is being repaired?". The pieces are already drawn on the map wearing their
 * damaged art, so the pick goes there: one target per damaged *stack* (identical pieces in the
 * same system are interchangeable — repairing any one of them is the same repair), positioned
 * with the same layout functions that placed the tokens.
 */
function repairTargets(
  state: GameState,
  cont: Continue,
): { system: string; piece: string; at: readonly [number, number]; action: Action }[] {
  if (cont.kind !== 'ask') return []
  const repairs = cont.actions.filter((a) => a.type === 'action/repair')
  if (repairs.length === 0) return []
  const byGroup = new Map<string, { system: string; piece: string; action: Action }>()
  for (const a of repairs) {
    const id = String(a['figure'])
    const loc = state.figures.at.get(id)
    if (loc === undefined || !loc.startsWith('system:')) continue
    const system = loc.slice('system:'.length)
    const piece = parseFigureId(id).piece
    const key = `${system}/${piece}`
    if (!byGroup.has(key)) byGroup.set(key, { system, piece, action: a })
  }
  return [...byGroup.values()].map((t) => {
    const s = systemInfo(t.system)
    const items = slotsAndPieces(state, t.system, groupPieces(state, t.system))
    const pos = positionsFor(s, items)
    const i = items.findIndex(
      (it) =>
        it.kind === 'piece' &&
        it.group.damaged &&
        it.group.piece === t.piece &&
        it.group.color === cont.faction,
    )
    return { ...t, at: i >= 0 ? pos[i]! : s.render.anchor }
  })
}

/**
 * Moves offered by the current decision, as a map of origin -> destination -> action.
 *
 * The board does not invent moves: it is an alternative *renderer* for whatever `Ask` the
 * engine is already offering, so clicking a system dispatches exactly the action the side
 * panel would have. Undo, save and replay are untouched by this.
 */
function moveGraph(cont: Continue): {
  origins: Map<string, Map<string, Action>>
  /** Catapult continuations, which have no origin choice — the fleet is already there. */
  onward: Map<string, Action>
} {
  const origins = new Map<string, Map<string, Action>>()
  const onward = new Map<string, Action>()
  if (cont.kind !== 'ask') return { origins, onward }
  for (const a of cont.actions) {
    if (a.type === 'action/move-pick') {
      const from = a['from'] as string
      const to = a['to'] as string
      const dests = origins.get(from) ?? new Map<string, Action>()
      dests.set(to, a)
      origins.set(from, dests)
    } else if (a.type === 'action/move-more') {
      onward.set(a['to'] as string, a)
    }
  }
  return { origins, onward }
}

/**
 * A pending "how many ships continue?" decision, if the engine is asking one.
 *
 * Covers both the opening leg (`action/move-ships`) and every catapult leg
 * (`action/move-more-go`) — they are the same question, so they get the same answer surface.
 */
function fleetChoice(cont: Continue): {
  to: string
  faction: string
  options: { count: number; action: Action }[]
} | null {
  if (cont.kind !== 'ask') return null
  const opts = cont.actions.filter(
    (a) => a.type === 'action/move-ships' || a.type === 'action/move-more-go',
  )
  if (opts.length === 0) return null
  return {
    to: opts[0]!['to'] as string,
    faction: opts[0]!['faction'] as string,
    options: opts
      .map((a) => ({ count: a['count'] as number, action: a }))
      .sort((a, b) => b.count - a.count),
  }
}

/**
 * How big every reticle is drawn, in map units.
 *
 * **Fixed, deliberately.** `centreOf` sizes its circle to the system's painted region, which runs
 * from 86 to nearly 300 units — so reticles drawn at that radius came out two and three times the
 * size of each other and the row of them read as an accident. The hit area still uses the region's
 * own radius, so a big system stays easy to click; only the art is pinned.
 */
const RETICLE_R = 100

/**
 * A targeting reticle over a system, in four states.
 *
 * The map is a printed board and the selection is an *overlay on* it — kit the fleet is painting
 * over the chart, not ink on the chart. So it is built from the vocabulary of a targeting display
 * rather than from a highlight: corner brackets, a swept ring, radial ticks, a crosshair.
 *
 *   `idle`   — a system you *could* set out from. A bare, quiet ring.
 *   `locked` — the origin you picked. The ring solidifies and the sweep **stops**.
 *   `dest`   — somewhere you may go. The ring sweeps and the ticks light.
 *   `battle` — a system you may fight in. The same kit in the game's red, plus a crosshair.
 *
 * **At rest they are deliberately faint.** A dozen bright rings at once is a wall, not a menu, so
 * resting weight is just enough to say "these are the options" and the *hover* state does the
 * work of saying "this one" — it fills, brightens, thickens and lifts. Reading the map is then a
 * sweep of the cursor rather than an exercise in telling near-identical rings apart.
 *
 * Everything here is decoration: `pointer-events` are off, and the transparent `.sys-target`
 * circle beside it in the DOM stays the hit area, so enlarging the art can never shrink the
 * clickable region.
 */
function Reticle({
  cx,
  cy,
  kind,
}: {
  cx: number
  cy: number
  kind: 'idle' | 'locked' | 'dest' | 'battle'
}): JSX.Element {
  const r = RETICLE_R

  // Radial ticks around the ring — the scale marks that make it read as an instrument.
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6
    const inner = r * 0.9
    const outer = i % 3 === 0 ? r * 1.02 : r * 0.97
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * inner}
        y1={cy + Math.sin(a) * inner}
        x2={cx + Math.cos(a) * outer}
        y2={cy + Math.sin(a) * outer}
      />
    )
  })

  return (
    <g className={`ret ret-${kind}`} filter="url(#sel-glow)">
      {/* Empty until hovered, when it fills — the strongest part of the hover state. */}
      <circle className="ret-disc" cx={cx} cy={cy} r={r} />
      <circle className="ret-ring" cx={cx} cy={cy} r={r} />
      {/* Idle is a bare ring: a system you *could* leave from should not compete with a live one. */}
      {kind !== 'idle' ? (
        <>
          <circle className="ret-sweep" cx={cx} cy={cy} r={r} />
          <g className="ret-ticks">{ticks}</g>
        </>
      ) : null}
      {kind === 'battle' ? (
        <g className="ret-cross">
          <line x1={cx - r * 1.18} y1={cy} x2={cx - r * 0.62} y2={cy} />
          <line x1={cx + r * 0.62} y1={cy} x2={cx + r * 1.18} y2={cy} />
          <line x1={cx} y1={cy - r * 1.18} x2={cx} y2={cy - r * 0.62} />
          <line x1={cx} y1={cy + r * 0.62} x2={cx} y2={cy + r * 1.18} />
        </g>
      ) : null}
    </g>
  )
}

/**
 * A movement route: a curve, not a chord.
 *
 * Straight lines between system centres read as a diagram. Bowing each route away from the
 * midpoint makes them read as trajectories, and — the practical part — two routes between the
 * same pair of systems no longer lie on top of each other. The dashes flow toward the
 * destination, so the direction of travel is legible without reading the arrowhead.
 */
function Route({
  from,
  to,
}: {
  from: { cx: number; cy: number }
  to: { cx: number; cy: number }
}): JSX.Element {
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  const len = Math.hypot(dx, dy) || 1
  // Start and end on the rings rather than in the middles, so the curve joins the reticles — the
  // same fixed radius they are drawn at.
  const ux = dx / len
  const uy = dy / len
  const ax = from.cx + ux * RETICLE_R
  const ay = from.cy + uy * RETICLE_R
  const bx = to.cx - ux * RETICLE_R
  const by = to.cy - uy * RETICLE_R
  // Bow perpendicular to the run, a fixed fraction of its length.
  const mx = (ax + bx) / 2 - uy * len * 0.14
  const my = (ay + by) / 2 + ux * len * 0.14
  const d = `M ${ax} ${ay} Q ${mx} ${my} ${bx} ${by}`

  return (
    <g className="route" filter="url(#sel-glow)">
      <path className="route-bed" d={d} />
      <path className="route-flow" d={d} markerEnd="url(#route-head)" />
    </g>
  )
}

/**
 * The bot's actions, drawn where they happened.
 *
 * Replaces the BotPanel's prose narration: each event from `store.botEvents` renders for
 * ~2.6 seconds as a pulse (or battle pulse) on its system — an arrow along its move — with the
 * engine's own log line as a caption chip. The interval only runs while something is live, and
 * expiry is handled here so the store never needs a cleanup timer.
 */
function BotEventLayer({ state }: { state: GameState }): JSX.Element | null {
  useBotUi()
  const [, bump] = useState(0)
  const events = liveEvents(store.botEvents, performance.now())
  useEffect(() => {
    if (store.botEvents.length === 0) return
    const t = setInterval(() => bump((n) => n + 1), 300)
    return () => clearInterval(t)
  }, [store.botEvents.length > 0 ? store.botEvents[store.botEvents.length - 1]!.id : 0])
  if (events.length === 0) return null

  const known = new Set(state.board.systems)
  return (
    <g className="bot-events">
      {events.map((e) => (
        <BotEventMark key={e.id} state={state} event={e} known={known} />
      ))}
    </g>
  )
}

function BotEventMark({
  state,
  event,
  known,
}: {
  state: GameState
  event: BotEvent
  known: ReadonlySet<string>
}): JSX.Element | null {
  const place = derivePlacement(event.action)
  if (place === null) return null
  const at = place.kind === 'arrow' ? place.to : place.system
  if (at === undefined || !known.has(at)) return null
  const { cx, cy } = centreOf(state, at)
  const battle = place.kind === 'battle'
  const text = caption(event)
  // Clamped to the map: a caption for an edge system flips above it / slides in from the sides.
  const half = text.length * 8.4 + 14
  const capX = Math.min(Math.max(cx, half + 8), MAP_SIZE.width - half - 8)
  const below = cy + RETICLE_R + 46
  const capY = below + 19 > MAP_SIZE.height - 8 ? cy - RETICLE_R - 46 : below
  return (
    <g className={`bot-event${battle ? ' battle' : ''}`}>
      {place.kind === 'arrow' && place.from !== undefined && known.has(place.from) ? (
        <Route from={centreOf(state, place.from)} to={centreOf(state, at)} />
      ) : null}
      <Reticle cx={cx} cy={cy} kind={battle ? 'battle' : 'dest'} />
      <circle className="evt-pulse" cx={cx} cy={cy} r={RETICLE_R} />
      <g className="evt-caption" transform={`translate(${capX}, ${capY})`}>
        <rect x={-half} y={-25} width={half * 2} height={44} rx={22} />
        <text x={0} y={7}>{text}</text>
      </g>
    </g>
  )
}

export function Board({ state, cont, highlight }: Props): JSX.Element {
  const systems = state.board.systems.map(systemInfo)
  const { origins, onward } = moveGraph(cont)
  const [from, setFrom] = useState<string | null>(null)

  /**
   * Map units per CSS pixel.
   *
   * The board is a 2528-wide viewBox squeezed into ~800px, so anything drawn in map units
   * lands at about a third of its nominal size — a 96-unit ship icon renders ~31px, and a
   * row of them is too small to read or hit. UI chrome drawn *inside* the SVG has to be
   * sized in map units scaled by this, or it shrinks with the map.
   */
  const svgRef = useRef<SVGSVGElement>(null)
  const [unitsPerPx, setUnitsPerPx] = useState(MAP_SIZE.width / 800)
  useEffect(() => {
    const el = svgRef.current
    if (el === null) return
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      // The viewBox is fitted with `meet`, so the *smaller* of the two scales wins and the
      // other axis is letterboxed. Measuring width alone under-reports the units-per-pixel
      // whenever the box is height-limited, and the chrome then renders too small.
      setUnitsPerPx(Math.max(MAP_SIZE.width / width, MAP_SIZE.height / height))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new decision invalidates any half-made selection.
  const askKey = cont.kind === 'ask' ? `${cont.faction}:${cont.actions.length}` : cont.kind
  useEffect(() => setFrom(null), [askKey])

  const picking = origins.size > 0 || onward.size > 0
  const dests = from === null ? undefined : origins.get(from)
  const fleet = fleetChoice(cont)
  const battleSys = battleSystems(cont)
  const rifles = riflesSystems(cont)
  const uprising = uprisingSystems(state, cont)
  const repairs = repairTargets(state, cont)
  const repairOut =
    cont.kind === 'ask' && repairs.length > 0
      ? cont.actions.find((a) => a.type === 'action/skip')
      : undefined
  /*
   * The ways out the side panel used to render alongside these picks. The map owns the asks now,
   * so their escapes ride in the hint bar: battle's cancel, and the move family's skip — which is
   * "Cancel" on the opening leg and "Stop here" on a catapult continuation.
   */
  const battleOut =
    cont.kind === 'ask' && battleSys.size > 0
      ? cont.actions.find((a) => a.type === 'battle/cancel')
      : undefined
  const moveOut =
    cont.kind === 'ask' && (picking || fleet !== null)
      ? cont.actions.find((a) => a.type === 'action/skip')
      : undefined
  // The place bucket serves three cards' asks, so the hint names whichever is actually up.
  const placeType = [...uprising.map.values()][0]?.type
  const voxOut =
    cont.kind === 'ask' && uprising.map.size > 0
      ? cont.actions.find((a) => a.type === 'vox/done' || a.type === 'action/skip')
      : undefined
  const riflesOut =
    cont.kind === 'ask' && rifles.map.size > 0
      ? cont.actions.find((a) => a.type === 'battle/cancel' || a.type === 'action/skip')
      : undefined

  /** What a click on this system does right now, if anything. */
  function roleOf(id: string): 'origin' | 'dest' | 'onward' | null {
    if (onward.has(id)) return 'onward'
    if (dests?.has(id)) return 'dest'
    if (origins.has(id)) return 'origin'
    return null
  }

  function onSystem(id: string): void {
    const move = onward.get(id) ?? dests?.get(id)
    if (move !== undefined) {
      setFrom(null)
      store.apply(move)
      return
    }
    if (origins.has(id)) setFrom(id === from ? null : id)
  }

  return (
    <div className="board">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}`}
        className="board-svg"
      >
        <defs>
          {/*
            The holographic bloom every selector wears. One filter, two users — a targeting
            overlay that does not glow reads as printed on the board rather than projected over it.
          */}
          <filter id="sel-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* The head on a movement route, in the route's own colour. */}
          <marker
            id="route-head"
            viewBox="0 0 12 12"
            refX="9"
            refY="6"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path className="route-head" d="M 1 1 L 11 6 L 1 11 z" />
          </marker>
        </defs>
        {/*
          The real map. Fully opaque and carrying its own shadow: it sits on the cover art now,
          and at 95% it blended into it — the board has to read as an object on the table rather
          than as one more layer of illustration. The shadow follows the image's own edge, which
          a shadow on the element could not: the viewBox is fitted with `meet`, so the SVG box is
          always taller or wider than the painted map.
        */}
        <image
          className="map-plate"
          href={asset('game-assets/map-no-slots.webp')}
          x={0}
          y={0}
          width={MAP_SIZE.width}
          height={MAP_SIZE.height}
          onError={(e) => {
            ;(e.target as SVGImageElement).style.display = 'none'
          }}
        />

        {/*
          Clusters not in play at this player count are covered by the board's own overlay
          art. Each `map-out-N` is a full-map-size transparent layer carrying both the dark
          starfield that blanks the cluster and the gold gate arrow showing where the gate
          ring now routes around it. Drawn at (0,0) like HRF (arcs/ui.scala:539-543).
        */}
        {outOfPlayClusters(state.board.clusters).map((i) => (
          <image
            key={`out-${i}`}
            href={asset(`game-assets/map-out-${i}.webp`)}
            x={0}
            y={0}
            width={MAP_SIZE.width}
            height={MAP_SIZE.height}
            onError={(e) => {
              ;(e.target as SVGImageElement).style.display = 'none'
            }}
          />
        ))}

        {/*
          The board's frame, drawn after the out-of-play overlays so it sits on the board proper.

          Borrowed from the printed ambition track: a heavy gold bracket at each corner that
          thins into a light rule along each edge. A uniform hairline read as a web border on
          artwork that has no uniform hairlines anywhere; this is the game's own way of framing
          a panel. Laid out in map units, so it scales with the board.
        */}
        <MapFrame />

        {/* Movement routes from the chosen origin, drawn under the pieces. */}
        {from !== null &&
          [...(dests?.keys() ?? [])].map((to) => (
            <Route key={`route-${to}`} from={centreOf(state, from)} to={centreOf(state, to)} />
          ))}

        {systems.map((s) => {
          const items = slotsAndPieces(state, s.id, groupPieces(state, s.id))
          const positions = positionsFor(s, items)
          return (
            <g key={s.id}>
              {items.map((r, i) => {
                const at = positions[i]!
                return r.kind === 'slot' ? (
                  <EmptySlot key={`slot-${i}`} at={at} />
                ) : (
                  <PieceBadge key={r.group.key} at={at} piece={r.group} />
                )
              })}
            </g>
          )
        })}

        {fleet !== null ? (
          <FleetPicker state={state} choice={fleet} scale={unitsPerPx} />
        ) : null}

        {/* Mass Uprising — the whole cluster lights up, then the systems ships land in. */}
        {uprising.map.size > 0 &&
          [...uprising.map.entries()].map(([id, action]) => {
            const { cx, cy, r } = centreOf(state, id)
            return (
              <g
                key={`uprising-${id}`}
                className="sys-hit battle"
                onClick={() => store.apply(action)}
              >
                <title>{String(action['label'])}</title>
                <Reticle cx={cx} cy={cy} kind="battle" />
                <circle className="sys-target" cx={cx} cy={cy} r={r} />
              </g>
            )
          })}

        {/* Galactic Rifles — pick the firing system, then the system it strikes. */}
        {rifles.map.size > 0 &&
          [...rifles.map.entries()].map(([id, action]) => {
            const { cx, cy, r } = centreOf(state, id)
            return (
              <g
                key={`rifles-${id}`}
                className="sys-hit battle"
                onClick={() => store.apply(action)}
              >
                <title>
                  {rifles.kind === 'from' ? `Fire Rifles from ${id}` : String(action['label'])}
                </title>
                <Reticle cx={cx} cy={cy} kind="battle" />
                <circle className="sys-target" cx={cx} cy={cy} r={r} />
              </g>
            )
          })}

        {/* Repair — the damaged pieces themselves, ringed: click one to fix it. */}
        {repairs.map((t) => (
          <g
            key={`repair-${t.system}-${t.piece}`}
            className="sys-hit repair"
            onClick={() => store.apply(t.action)}
          >
            <title>{`Repair ${t.piece} in ${t.system}`}</title>
            <Reticle cx={t.at[0]} cy={t.at[1]} kind="dest" />
            <circle className="sys-target" cx={t.at[0]} cy={t.at[1]} r={110} />
          </g>
        ))}

        {/* Battle — systems you may fight in: click the system to attack there. */}
        {battleSys.size > 0 &&
          [...battleSys.entries()].map(([id, action]) => {
            const { cx, cy, r } = centreOf(state, id)
            return (
              <g
                key={`battle-sys-${id}`}
                className="sys-hit battle"
                onClick={() => store.apply(action)}
              >
                <title>{`Battle in ${id}`}</title>
                <Reticle cx={cx} cy={cy} kind="battle" />
                <circle className="sys-target" cx={cx} cy={cy} r={r} />
              </g>
            )
          })}


        {/* Click targets last, so they sit above the art and the tokens. */}
        {picking &&
          systems.map((s) => {
            const role = roleOf(s.id)
            if (role === null) return null
            const { cx, cy, r } = centreOf(state, s.id)
            const selected = s.id === from
            return (
              <g
                key={`hit-${s.id}`}
                className={`sys-hit ${role}${selected ? ' selected' : ''}`}
                onClick={() => onSystem(s.id)}
              >
                <title>
                  {role === 'origin'
                    ? `Move from ${s.id}`
                    : role === 'onward'
                      ? `Continue to ${s.id}`
                      : `Move to ${s.id}`}
                </title>
                <Reticle
                  cx={cx}
                  cy={cy}
                  kind={role === 'origin' ? (selected ? 'locked' : 'idle') : 'dest'}
                />
                <circle className="sys-target" cx={cx} cy={cy} r={r} />
              </g>
            )
          })}
        <BotEventLayer state={state} />
      </svg>
      {highlight ? <div className="board-turn">Turn: {highlight}</div> : null}
      {fleet !== null ? (
        <div className="board-hint">
          Click the ships that carry on to {fleet.to} — the rest stay behind
          {moveOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(moveOut)}>
              {String(moveOut['label'] ?? 'Cancel')}
            </button>
          ) : null}
        </div>
      ) : battleSys.size > 0 ? (
        <div className="board-hint battle">
          Battle — click a system to attack there
          {battleOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(battleOut)}>
              {String(battleOut['label'] ?? 'Cancel')}
            </button>
          ) : null}
        </div>
      ) : repairs.length > 0 ? (
        <div className="board-hint">
          Repair — click the damaged piece to fix it
          {repairOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(repairOut)}>
              {String(repairOut['label'] ?? 'Cancel')}
            </button>
          ) : null}
        </div>
      ) : uprising.map.size > 0 ? (
        <div className="board-hint battle">
          {uprising.kind === 'cluster'
            ? 'Mass Uprising — click any system in the cluster you want'
            : placeType === 'turn/gates-place'
              ? 'Gatekeepers — click a gate to place a ship'
              : placeType === 'turn/reinforce'
                ? 'Swept from the map — click a gate to place your ships'
                : placeType === 'turn/ships-place'
                  ? 'Place your ships — click a system you control'
                  : 'Mass Uprising — click a system to place a ship'}
          {voxOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(voxOut)}>
              {String(voxOut['label'] ?? 'Skip')}
            </button>
          ) : null}
        </div>
      ) : rifles.map.size > 0 ? (
        /*
         * Carries its own way out. The panel steps aside for anything the map owns, so without a
         * cancel here a player who opened Galactic Rifles by mistake would be stuck choosing a
         * target — the same shape of trap as the Railgun deadlock, one surface stepping back and
         * the other not covering everything it took on.
         */
        <div className="board-hint battle">
          {rifles.kind === 'from'
            ? 'Galactic Rifles — click one of your systems to fire from'
            : 'Galactic Rifles — click an adjacent system to strike'}
          {riflesOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(riflesOut)}>
              {String(riflesOut['label'] ?? 'Cancel')}
            </button>
          ) : null}
        </div>
      ) : picking ? (
        <div className="board-hint">
          {onward.size > 0
            ? 'Catapult — click a system to continue'
            : from === null
              ? 'Click a system to move from'
              : `Moving from ${from} — click a destination`}
          {moveOut !== undefined ? (
            <button className="hint-out" onClick={() => store.apply(moveOut)}>
              {String(moveOut['label'] ?? 'Cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * "How many carry on?" drawn as rows of ships beside the destination: four ships, then three,
 * then two, then one. You click the row you want to keep moving with; the rest stay put.
 *
 * A count is a poor thing to read as a word when the pieces are right there — and the rows
 * make the trade-off visible, because the gap between the row you pick and the row above it
 * *is* the detachment you are leaving behind.
 */
function FleetPicker({
  state,
  choice,
  scale,
}: {
  state: GameState
  choice: { to: string; faction: string; options: { count: number; action: Action }[] }
  /** Map units per CSS pixel, so this chrome keeps a fixed on-screen size. */
  scale: number
}): JSX.Element {
  const art = figureArt(choice.faction, 'ship')
  const target = centreOf(state, choice.to)

  // Sizes below are CSS pixels, converted to map units so they do not shrink with the board.
  const px = (n: number): number => n * scale
  const ICON_W = px(46)
  const ICON_H = px(19)
  const GAP = px(5)
  const ROW_H = ICON_H + px(12)
  const PAD = px(9)

  const widest = Math.max(...choice.options.map((o) => o.count))
  const widestRow = widest * ICON_W + (widest - 1) * GAP
  // The count sits in its own column. Leaving it out of the box width put the widest row's
  // numeral outside the panel.
  const NUM_GAP = px(8)
  const NUM_W = px(22)
  const boxW = PAD * 2 + widestRow + NUM_GAP + NUM_W
  const boxH = choice.options.length * ROW_H + PAD * 2

  // Prefer above the destination; drop below if that would leave the map.
  let top = target.cy - target.r - boxH - px(12)
  if (top < px(8)) top = target.cy + target.r + px(12)
  const left = Math.min(
    Math.max(px(8), target.cx - boxW / 2),
    MAP_SIZE.width - boxW - px(8),
  )

  return (
    <g className="fleet-picker">
      <rect
        className="fp-box"
        x={left}
        y={top}
        width={boxW}
        height={boxH}
        rx={px(10)}
        style={{ strokeWidth: px(2) }}
      />
      {choice.options.map((o, i) => {
        const rowY = top + PAD + i * ROW_H
        const rowX = left + PAD
        return (
          <g
            key={o.count}
            className="fp-row"
            onClick={() => store.apply(o.action)}
          >
            <title>{`Continue with ${o.count} ship${o.count === 1 ? '' : 's'}`}</title>
            {/* Full-width hit area, so the gap beside a short row is still clickable. */}
            <rect
              className="fp-hit"
              x={rowX - px(4)}
              y={rowY - px(4)}
              width={boxW - PAD * 2 + px(8)}
              height={ROW_H - px(4)}
              rx={px(6)}
            />
            {Array.from({ length: o.count }, (_, k) => (
              <image
                key={k}
                className="fp-ship"
                href={art ?? undefined}
                x={rowX + k * (ICON_W + GAP)}
                y={rowY}
                width={ICON_W}
                height={ICON_H}
                preserveAspectRatio="xMidYMid meet"
              />
            ))}
            <text
              className="fp-n"
              x={left + PAD + widestRow + NUM_GAP}
              y={rowY + ICON_H * 0.85}
              style={{ fontSize: px(17) }}
            >
              {o.count}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * The board's frame, in the printed game's idiom — the way the ambition track frames its rows:
 * a heavy gold bracket at each corner which then **opens into two parallel rails** running the
 * length of each edge. Read off the component art: the thick bar does not thin to a single line,
 * it splits, so an edge is `L=====`.
 *
 * The rails sit on the bracket's own two edges (±half its stroke), which is what makes them look
 * like the bar continuing rather than a second border floating nearby.
 *
 * Drawn in map units at the viewBox bounds, so it lands exactly on the map art. It cannot be a
 * CSS border on the SVG element — `preserveAspectRatio` fits the viewBox with `meet`, so the
 * element is always taller or wider than the painted map and a border would frame empty space.
 */
function MapFrame(): JSX.Element {
  const W = MAP_SIZE.width
  const H = MAP_SIZE.height
  /** How far each bracket arm runs from its corner, and how sharply it turns. */
  const ARM = 150
  const R = 22
  /** Half the bracket's stroke — where its two edges lie, and so where the rails run. */
  const OFF = 5.5
  /** The inked break between the end of a bracket and the start of the rails. */
  const GAP = 8

  // One corner: up the edge, round the turn, out along the next edge. `sx`/`sy` point inward.
  const bracket = (cx: number, cy: number, sx: number, sy: number): string =>
    `M ${cx} ${cy + sy * ARM} L ${cx} ${cy + sy * R} Q ${cx} ${cy} ${cx + sx * R} ${cy} ` +
    `L ${cx + sx * ARM} ${cy}`

  const a = ARM + GAP
  const rails =
    // top and bottom: a rail on each side of the edge line
    `M ${a} ${-OFF} H ${W - a} M ${a} ${OFF} H ${W - a} ` +
    `M ${a} ${H - OFF} H ${W - a} M ${a} ${H + OFF} H ${W - a} ` +
    // left and right
    `M ${-OFF} ${a} V ${H - a} M ${OFF} ${a} V ${H - a} ` +
    `M ${W - OFF} ${a} V ${H - a} M ${W + OFF} ${a} V ${H - a}`

  return (
    <g className="map-frame" pointerEvents="none">
      <path className="mf-rail" d={rails} />
      <path
        className="mf-bracket"
        d={
          `${bracket(0, 0, 1, 1)} ${bracket(W, 0, -1, 1)} ` +
          `${bracket(0, H, 1, -1)} ${bracket(W, H, -1, -1)}`
        }
      />
    </g>
  )
}

/** Footprint of whatever is currently rendered at a system. */
function centreOf(state: GameState, id: string): { cx: number; cy: number; r: number } {
  const info = systemInfo(id)
  const occupied = slotsAndPieces(state, id, groupPieces(state, id)).length
  return footprint(info, occupied)
}

/** One stack of identical pieces: same colour, same type, same damage state. */
interface PieceGroup {
  key: string
  color: string
  piece: string
  damaged: boolean
  count: number
}

/**
 * Where the i-th thing at a system sits. Beyond the precomputed points we step outward on a
 * small diagonal rather than wrapping — wrapping put two tokens on the identical point.
 */
function placementFor(s: SystemInfo, i: number): readonly [number, number] {
  const pts = s.render.placements
  if (pts.length === 0) return s.render.anchor
  if (i < pts.length) return pts[i]!
  const overflow = i - pts.length + 1
  const [x, y] = pts[pts.length - 1]!
  return [x + overflow * 46, y + overflow * 46]
}

/**
 * Positions for everything at a system, aligned with `slotsAndPieces`' order.
 *
 * The physical board prints its building slots **on the planet disc**, so buildings and the
 * empty-slot markers — the contiguous prefix `slotsAndPieces` puts first — are laid out as a
 * centred row on `render.planet`. Ships and agents keep the precomputed `placements`, indexed
 * as if the prefix still occupied the early points, so fleets sit exactly where they always
 * did. Gates have no planet (`planet: null`) and keep the old combined layout — their
 * buildings only exist through Gate Ports/Stations, which invent the position anyway.
 */
function positionsFor(
  s: SystemInfo,
  items: readonly Renderable[],
): (readonly [number, number])[] {
  const planet = s.render.planet
  if (planet === null) return items.map((_, i) => placementFor(s, i))
  const isSlotish = (it: Renderable): boolean =>
    it.kind === 'slot' || it.group.piece === 'City' || it.group.piece === 'Starport'
  const onDisc = items.filter(isSlotish).length
  const [px, py, pr] = planet
  // A centred row, spaced one token apart but never wider than the disc allows.
  const spacing = onDisc <= 1 ? 0 : Math.min(92, (2 * pr - 70) / (onDisc - 1))
  return items.map((it, i) => {
    if (!isSlotish(it)) return placementFor(s, i)
    // The prefix is contiguous, so `i` is also the index within the disc row.
    return [px + (i - (onDisc - 1) / 2) * spacing, py] as const
  })
}

/**
 * Where a system's pieces actually sit, and how much room they take.
 *
 * The hit ring used to be centred on `render.anchor`, which is the hand-picked *hub* point.
 * Tokens are laid out at `render.placements`, which fan up to ~100px away from it, so the
 * ring sat beside the ships rather than around them. Centring on the placements in use, and
 * sizing to cover them, puts it where the fleet is.
 */
function footprint(
  s: SystemInfo,
  occupied: number,
): { cx: number; cy: number; r: number } {
  const pts = s.render.placements.slice(0, Math.max(1, occupied))
  if (pts.length === 0) return { cx: s.render.anchor[0], cy: s.render.anchor[1], r: 92 }
  const cx = pts.reduce((n, p) => n + p[0], 0) / pts.length
  const cy = pts.reduce((n, p) => n + p[1], 0) / pts.length
  const reach = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy)))
  // Half a token beyond the outermost placement, with a floor so a lone piece still rings.
  return { cx, cy, r: Math.max(86, reach + 62) }
}

/** The clusters (1..6) that are not part of this board's layout. */
function outOfPlayClusters(inPlay: readonly number[]): number[] {
  return [1, 2, 3, 4, 5, 6].filter((i) => !inPlay.includes(i))
}

/**
 * Piece -> art basename. Starports use the triangle variant, matching the physical component
 * and the city silhouette. The star variant (`starport-alt`) is HRF's `StarStarports` option.
 */
const PIECE_ART: Record<string, string> = {
  Ship: 'ship',
  City: 'city',
  Starport: 'starport',
  Agent: 'agent',
}

/** Native on-map size of each token, from the asset dimensions. */
const PIECE_SIZE: Record<string, { w: number; h: number }> = {
  Ship: { w: 194, h: 81 },
  City: { w: 122, h: 122 },
  Starport: { w: 122, h: 122 },
  Agent: { w: 42, h: 68 },
}

const TOKEN_SCALE = 0.72   // 122 -> ~88px, inside the 98px placement spacing

function artFor(group: PieceGroup): string | null {
  const art = PIECE_ART[group.piece]
  if (art === undefined) return null
  return figureArt(group.color, art, group.damaged)
}

/** Group by colour + piece + damage, so fresh and damaged draw their own art. */
function groupPieces(state: GameState, systemId: string): PieceGroup[] {
  const ids = contentsOf(state.figures, Location.system(systemId))
  const map = new Map<string, PieceGroup>()
  for (const id of ids) {
    const f = parseFigureId(id)
    const damaged = state.damaged.includes(id)
    const key = `${f.color}/${f.piece}/${damaged ? 'dmg' : 'ok'}`
    const g = map.get(key) ?? { key, color: f.color, piece: f.piece, damaged, count: 0 }
    g.count++
    map.set(key, g)
  }
  // Buildings first so they sit behind the ships fanned in front of them.
  const order = (p: string) => (p === 'City' || p === 'Starport' ? 0 : 1)
  return [...map.values()].sort(
    (a, b) => order(a.piece) - order(b.piece) || a.key.localeCompare(b.key),
  )
}

/**
 * What sits at a system: the pieces there, plus one marker per still-open building slot.
 *
 * Buildings come first, then the empty slots they would fill, then ships and agents — so the
 * building area of a planet reads together. As buildings go up, `freeSlots` shrinks and the
 * empty markers are simply replaced by the real tokens.
 */
type Renderable = { kind: 'slot' } | { kind: 'piece'; group: PieceGroup }

function slotsAndPieces(
  state: GameState,
  systemId: string,
  pieces: PieceGroup[],
): Renderable[] {
  const isBuilding = (p: string) => p === 'City' || p === 'Starport'
  const buildings = pieces.filter((p) => isBuilding(p.piece))
  const rest = pieces.filter((p) => !isBuilding(p.piece))
  const open = Math.max(0, freeSlots(state, systemId))

  return [
    ...buildings.map((group) => ({ kind: 'piece', group }) as const),
    ...Array.from({ length: open }, () => ({ kind: 'slot' }) as const),
    ...rest.map((group) => ({ kind: 'piece', group }) as const),
  ]
}

/** An open building slot on a planet — replaced by a City or Starport once built. */
function EmptySlot({ at }: { at: readonly [number, number] }): JSX.Element {
  const size = 122 * TOKEN_SCALE
  const [bx, by] = at
  return (
    <image
      href={asset('game-assets/figure/building-empty.webp')}
      x={bx - size / 2}
      y={by - size / 2}
      width={size}
      height={size}
      opacity={0.85}
      onError={(e) => {
        ;(e.target as SVGImageElement).style.display = 'none'
      }}
    />
  )
}

/** One token stack drawn with the real component art, with a count if more than one. */
/**
 * A fleet is drawn as ships, not as a numeral.
 *
 * Ships are the piece whose count changes constantly and matters at a glance — reading "how big
 * is that fleet" off a small badge meant reading a digit when the answer could just be the
 * silhouette. Each ship in the stack is a real token, offset up and to the right so the ones
 * behind still show, and the whole stack stays centred on the placement point.
 *
 * Only ships stack. Buildings come one or two to a system and sit in their own slots, and an
 * agent stack is a court thing rather than a map thing, so those keep the count badge.
 */
const STACKS = 'Ship'
/**
 * How many hulls are ever drawn. Nothing in the rules caps a fleet — neither the engine nor HRF
 * limits ships per system, so one can legally hold a faction's whole supply of 15 — so this is a
 * legibility choice, not a rule. Past five the hulls stop adding information and start crowding
 * their neighbours, so the drawing stops and the badge carries the rest: a twelve-ship fleet is
 * five hulls and a "12".
 */
const MAX_STACK = 5
/** Wide enough that each hull is plainly its own ship, not a thickened edge on the one below. */
const STACK_STEP = { x: 14, y: -17 }
const STEP_LEN = Math.hypot(STACK_STEP.x, STACK_STEP.y)

/**
 * A stable pseudo-random 0..1 from a number — the classic sine hash.
 *
 * The scatter below has to be **deterministic**: it is derived from where a stack sits and which
 * ship in it this is, never from `Math.random`, so a fleet lands the same way on every render,
 * after an undo, and on a reloaded save. A random scatter would make the whole map twitch each
 * time any unrelated piece of state changed.
 */
function scatter(seed: number): number {
  const n = Math.sin(seed) * 43758.5453
  return n - Math.floor(n)
}

function PieceBadge({
  at,
  piece,
}: {
  at: readonly [number, number]
  piece: PieceGroup
}): JSX.Element | null {
  const href = artFor(piece)
  if (href === null) return null

  const native = PIECE_SIZE[piece.piece] ?? { w: 100, h: 100 }
  const w = native.w * TOKEN_SCALE
  const h = native.h * TOKEN_SCALE

  const [bx, by] = at
  const stacked = piece.piece === STACKS
  const drawn = stacked ? Math.min(piece.count, MAX_STACK) : 1
  /*
   * A pair of hulls is unambiguous at a glance, so two ships carry no numeral. From three up the
   * overlap starts costing you a beat to count, so the badge states it. Pieces that do not stack
   * need it from two, since one token is all you would otherwise see.
   */
  const showCount = piece.count > (stacked ? 2 : 1)

  const span = drawn - 1

  /*
   * Every fleet climbing the same diagonal at the same pitch read as a ruled ladder rather than
   * as ships. The stack leans by up to ~22° either side of that diagonal, chosen from where it
   * sits, so no two systems stack alike; each hull then takes a small nudge and a few degrees of
   * roll, so a fleet looks set down by hand. All of it is a function of position and index — see
   * `scatter` — so it is stable across renders.
   */
  const lean = (scatter(bx * 0.017 + by * 0.031) - 0.5) * 0.78
  const angle = Math.atan2(STACK_STEP.y, STACK_STEP.x) + lean
  const stepX = Math.cos(angle) * STEP_LEN
  const stepY = Math.sin(angle) * STEP_LEN

  /*
   * Which way the fleet is pointed. The art is drawn facing left, so every fleet on the board
   * sailed the same way; mirroring about half of them gives the map some weather. It is decided
   * per *fleet*, not per hull — ships in one system pointing different ways would read as a
   * scrap rather than a formation — and from a different seed than the lean, so facing and pitch
   * do not correlate.
   */
  const faceRight = stacked && scatter(bx * 0.043 + by * 0.011) > 0.5

  return (
    <g transform={`translate(${bx}, ${by})`}>
      {/* The mirror wraps only the hulls: flipping the group would reverse the numeral too. */}
      <g transform={faceRight ? 'scale(-1, 1)' : undefined}>
        {Array.from({ length: drawn }, (_, i) => {
          // Centre the stack on the point rather than growing away from it.
          const k = i - span / 2
          const nudgeX = stacked ? (scatter(bx + by * 0.7 + i * 3.7) - 0.5) * 7 : 0
          const nudgeY = stacked ? (scatter(bx * 1.3 + by + i * 5.1) - 0.5) * 7 : 0
          const roll = stacked ? (scatter(bx * 0.9 + by * 1.7 + i * 2.3) - 0.5) * 11 : 0
          const cx = k * stepX + nudgeX
          const cy = k * stepY + nudgeY
          return (
            <image
              key={i}
              href={href}
              x={-w / 2 + cx}
              y={-h / 2 + cy}
              width={w}
              height={h}
              transform={roll === 0 ? undefined : `rotate(${roll.toFixed(2)} ${cx} ${cy})`}
              onError={(e) => {
                ;(e.target as SVGImageElement).style.display = 'none'
              }}
            />
          )
        })}
      </g>
      {showCount ? (
        <g transform={`translate(${w / 2 - 6}, ${h / 2 - 6})`}>
          <circle r={26} fill="#0b0d13" stroke={colorOf(piece.color)} strokeWidth={3} />
          <text textAnchor="middle" dy={11} fontSize={32} className="badge-count">
            {piece.count}
          </text>
        </g>
      ) : null}
    </g>
  )
}
