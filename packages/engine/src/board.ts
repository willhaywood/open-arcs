/**
 * Board topology, extracted from haunt-roll-fail's Scala sources and its region bitmaps.
 * See docs/05-board-topology.md.
 *
 * The engine performs no IO — the data is imported as a module so it works identically in
 * the browser, in Node and in a Worker.
 */

import topology from './data/board-topology.json' with { type: 'json' }
import type { SystemId, Symbol_ } from './ids.js'

export interface SystemInfo {
  readonly id: SystemId
  readonly cluster: number
  readonly symbol: Symbol_
  readonly isGate: boolean
  readonly resource: string | null
  readonly buildingSlots: number | null
  /** Introduced by a fate at runtime; never part of a board's starting systems. */
  readonly fateOnly: boolean
  readonly render: {
    readonly anchor: readonly [number, number]
    readonly gateMarkers: readonly (readonly [number, number])[]
    readonly regionColour: string
    readonly selectColour: string
    /**
     * Well-spread points *inside* this system's region, for laying out pieces and empty
     * building slots. Precomputed from the region bitmap (scripts/compute_placements.py),
     * ordered most-central first. HRF does the equivalent at runtime via its FitLayer.
     */
    readonly placements: readonly (readonly [number, number])[]
  }
}

export interface BoardVariant {
  readonly name: string
  readonly players: number
  readonly clusters: readonly number[]
  readonly systems: readonly SystemId[]
  readonly adjacency: ReadonlyMap<SystemId, readonly SystemId[]>
  /** Per seat: [city, starport, [fleet systems]]. */
  readonly starting: readonly (readonly [SystemId, SystemId, readonly SystemId[]])[]
  readonly campaignOnly: boolean
}

const SYSTEMS: ReadonlyMap<SystemId, SystemInfo> = new Map(
  topology.systems.map((s) => [s.id, s as unknown as SystemInfo]),
)

export function system(id: SystemId): SystemInfo {
  const found = SYSTEMS.get(id)
  if (found === undefined) throw new Error(`unknown system: ${id}`)
  return found
}

export function allSystems(): readonly SystemInfo[] {
  return [...SYSTEMS.values()]
}

function sid(pair: readonly (string | number)[]): SystemId {
  return `${pair[0]}-${pair[1]}`
}

const VARIANTS: ReadonlyMap<string, BoardVariant> = new Map(
  Object.entries(topology.boards).map(([name, raw]) => {
    const clusters = raw.clusters as readonly number[]
    const adjacency = new Map<SystemId, readonly SystemId[]>(
      Object.entries(raw.adjacency as Record<string, string[]>),
    )
    const variant: BoardVariant = {
      name,
      players: raw.players as number,
      clusters,
      systems: [...adjacency.keys()].sort(),
      adjacency,
      starting: (raw.starting as unknown[][]).map(
        (seat) =>
          [
            sid(seat[0] as string[]),
            sid(seat[1] as string[]),
            (seat[2] as string[][]).map(sid),
          ] as const,
      ),
      campaignOnly: 'campaign_only' in raw && raw.campaign_only === true,
    }
    return [name, variant]
  }),
)

/**
 * Board layout is a required parameter, never defaulted. HRF's selector has no default
 * case and throws a MatchError when no setup option is chosen — see docs/05 section 2.
 */
export function board(name: string): BoardVariant {
  const found = VARIANTS.get(name)
  if (found === undefined) {
    throw new Error(`unknown board: ${name} (have: ${[...VARIANTS.keys()].join(', ')})`)
  }
  return found
}

export function boardNames(): readonly string[] {
  return [...VARIANTS.keys()]
}

export function boardsFor(players: number): readonly BoardVariant[] {
  return [...VARIANTS.values()].filter((b) => !b.campaignOnly && b.players === players)
}

export function connected(variant: BoardVariant, from: SystemId): readonly SystemId[] {
  const found = variant.adjacency.get(from)
  if (found === undefined) throw new Error(`system ${from} not on board ${variant.name}`)
  return found
}

export function areConnected(variant: BoardVariant, a: SystemId, b: SystemId): boolean {
  return connected(variant, a).includes(b)
}

export const MAP_SIZE = topology.mapSize as { readonly width: number; readonly height: number }
