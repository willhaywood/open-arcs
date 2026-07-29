/**
 * Immutable identity tracker: entities live at exactly one location, with per-location
 * validity rules.
 *
 * HRF's equivalent is mutable and cloned by hand, which is a standing source of silent
 * bugs — a field added to the game and forgotten in `cloned()` corrupts every rollout.
 * Here every mutation returns a new tracker sharing structure with the old one.
 *
 * Locations are open strings (see ids.ts), so phase 2 adds new location kinds without
 * touching this file.
 */

import type { LocationId } from './ids.js'

export type EntityId = string

/** Returns true if `entity` is allowed to occupy `location`. */
export type LocationRule = (entity: EntityId) => boolean

export interface Tracker {
  /** entity -> location */
  readonly at: ReadonlyMap<EntityId, LocationId>
  /** location -> entities, insertion-ordered */
  readonly contents: ReadonlyMap<LocationId, readonly EntityId[]>
  readonly rules: ReadonlyMap<LocationId, LocationRule>
}

export function emptyTracker(): Tracker {
  return { at: new Map(), contents: new Map(), rules: new Map() }
}

/** Declare a location. Registering the same location twice is a programming error. */
export function register(
  tracker: Tracker,
  location: LocationId,
  options: { rule?: LocationRule; contents?: readonly EntityId[] } = {},
): Tracker {
  if (tracker.contents.has(location)) {
    throw new Error(`location already registered: ${location}`)
  }
  const rule = options.rule ?? (() => true)
  const initial = options.contents ?? []

  const at = new Map(tracker.at)
  for (const entity of initial) {
    if (at.has(entity)) throw new Error(`entity already placed: ${entity}`)
    if (!rule(entity)) throw new Error(`entity ${entity} not allowed at ${location}`)
    at.set(entity, location)
  }

  const contents = new Map(tracker.contents)
  contents.set(location, [...initial])

  const rules = new Map(tracker.rules)
  rules.set(location, rule)

  return { at, contents, rules }
}

export function registerAll(tracker: Tracker, locations: readonly LocationId[]): Tracker {
  return locations.reduce((t, l) => register(t, l), tracker)
}

export function has(tracker: Tracker, location: LocationId): boolean {
  return tracker.contents.has(location)
}

export function contentsOf(tracker: Tracker, location: LocationId): readonly EntityId[] {
  const found = tracker.contents.get(location)
  if (found === undefined) throw new Error(`location not registered: ${location}`)
  return found
}

export function locationOf(tracker: Tracker, entity: EntityId): LocationId | undefined {
  return tracker.at.get(entity)
}

/**
 * Move an entity to a location. Validates that the entity exists, the location exists,
 * and the location's rule accepts it — which catches a large class of "piece in two
 * places" bugs at the point of the move rather than three rules later.
 */
export function move(tracker: Tracker, entity: EntityId, to: LocationId): Tracker {
  const from = tracker.at.get(entity)
  if (from === undefined) throw new Error(`entity not registered: ${entity}`)
  if (!tracker.contents.has(to)) throw new Error(`location not registered: ${to}`)

  const rule = tracker.rules.get(to)!
  if (!rule(entity)) throw new Error(`entity ${entity} not allowed at ${to}`)

  if (from === to) return tracker

  const contents = new Map(tracker.contents)
  contents.set(from, contentsOf(tracker, from).filter((e) => e !== entity))
  contents.set(to, [...contentsOf(tracker, to), entity])

  const at = new Map(tracker.at)
  at.set(entity, to)

  return { at, contents, rules: tracker.rules }
}

export function moveAll(
  tracker: Tracker,
  entities: readonly EntityId[],
  to: LocationId,
): Tracker {
  return entities.reduce((t, e) => move(t, e, to), tracker)
}

/** Add entities that were not previously tracked anywhere. */
export function place(
  tracker: Tracker,
  entities: readonly EntityId[],
  location: LocationId,
): Tracker {
  if (!tracker.contents.has(location)) {
    throw new Error(`location not registered: ${location}`)
  }
  const rule = tracker.rules.get(location)!
  const at = new Map(tracker.at)
  const contents = new Map(tracker.contents)
  const list = [...contentsOf(tracker, location)]

  for (const entity of entities) {
    if (at.has(entity)) throw new Error(`entity already placed: ${entity}`)
    if (!rule(entity)) throw new Error(`entity ${entity} not allowed at ${location}`)
    at.set(entity, location)
    list.push(entity)
  }
  contents.set(location, list)
  return { at, contents, rules: tracker.rules }
}

/** Stable digest of tracker contents, for golden-replay assertions. */
export function digest(tracker: Tracker): string {
  return [...tracker.contents.entries()]
    .filter(([, entities]) => entities.length > 0)
    .map(([location, entities]) => `${location}=${[...entities].sort().join(',')}`)
    .sort()
    .join('|')
}
