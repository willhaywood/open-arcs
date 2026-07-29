/**
 * Resources: the token/slot/supply model.
 *
 * Transcribed from haunt-roll-fail/arcs/game.scala (Resource, ResourceToken,
 * CityResourceSlot, Supply, recalculateSlots). See docs/07-resources.md.
 *
 * Five resource types, five tokens of each in a shared supply. A faction gains tokens
 * into its city resource slots; how many of its six slots are usable depends on how many
 * cities it still has in reserve (fewer in reserve = more cities built = more capacity).
 * Tokens beyond capacity overflow and must be resolved.
 */

import type { FactionId, LocationId } from './ids.js'
import type { EntityId, Tracker } from './tracker.js'
import { contentsOf, move, place, register } from './tracker.js'

export const RESOURCES = ['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as const
export type Resource = (typeof RESOURCES)[number]

export const TOKENS_PER_RESOURCE = 5

/** Resource each planet symbol produces is board data; see board-topology.json. */

// --- token / slot ids ------------------------------------------------------

export function resourceToken(resource: Resource, index: number): EntityId {
  return `${resource}#${index}`
}

export function parseResourceToken(id: EntityId): { resource: Resource; index: number } {
  const hash = id.indexOf('#')
  if (hash === -1) throw new Error(`not a resource token: ${id}`)
  return { resource: id.slice(0, hash) as Resource, index: Number(id.slice(hash + 1)) }
}

export const ResourceSlot = {
  supply: (r: Resource): LocationId => `supply:${r}`,
  /** A faction's six city resource slots, index 0..5. */
  citySlot: (f: FactionId, index: number): LocationId => `cityslot:${f}:${index}`,
  /**
   * A slot that lives on a *card* rather than the player board — Ancient Holdings (lore13) is the
   * only one. It is registered for every faction because registration happens before any draft.
   */
  cardSlot: (f: FactionId, card: string): LocationId => `cardslot:${f}:${card}`,
  overflow: (f: FactionId): LocationId => `overflow:${f}`,
} as const

/** Ancient Holdings prints a raid cost of four keys, dearer than any city slot. */
export const ANCIENT_HOLDINGS_KEYS = 4

/** What it costs an attacker in keys to raid a token out of `slot`. */
export function slotKeys(slot: LocationId): number {
  if (slot.startsWith('cardslot:')) return ANCIENT_HOLDINGS_KEYS
  const index = Number(slot.slice(slot.lastIndexOf(':') + 1))
  return CITY_SLOT_KEYS[index] ?? 1
}

/**
 * The "keys" printed on each city slot (game.scala:885-892). Keys feed the Tycoon
 * ambition and raiding; carried now so scoring can use them without a data change.
 */
export const CITY_SLOT_KEYS: readonly number[] = [3, 1, 1, 2, 1, 3]
export const CITY_SLOT_COUNT = CITY_SLOT_KEYS.length

/**
 * Usable slots by cities-in-reserve (game.scala:1005). Index 0 (all cities built) = 6
 * usable; index 5 (none built) = 2. Clamped for safety.
 */
const USABLE_BY_RESERVE_CITIES: readonly number[] = [6, 6, 6, 4, 3, 2]

export function slotCapacity(citiesInReserve: number): number {
  const i = Math.max(0, Math.min(USABLE_BY_RESERVE_CITIES.length - 1, citiesInReserve))
  return USABLE_BY_RESERVE_CITIES[i]!
}

// --- registration / seeding ------------------------------------------------

/** Register the shared supply and each faction's slots, and fill the supply. */
export function registerResources(tracker: Tracker, factions: readonly FactionId[]): Tracker {
  let t = tracker
  for (const r of RESOURCES) {
    t = register(t, ResourceSlot.supply(r))
    t = place(
      t,
      Array.from({ length: TOKENS_PER_RESOURCE }, (_, i) => resourceToken(r, i + 1)),
      ResourceSlot.supply(r),
    )
  }
  for (const f of factions) {
    for (let i = 0; i < CITY_SLOT_COUNT; i++) t = register(t, ResourceSlot.citySlot(f, i))
    t = register(t, ResourceSlot.cardSlot(f, 'lore13'))
    t = register(t, ResourceSlot.overflow(f))
  }
  return t
}

// --- queries ---------------------------------------------------------------

export function supplyOf(tracker: Tracker, r: Resource): readonly EntityId[] {
  return contentsOf(tracker, ResourceSlot.supply(r))
}

/** The faction's usable slots given its capacity, as location ids. */
export function usableSlots(f: FactionId, capacity: number): LocationId[] {
  return Array.from({ length: Math.min(capacity, CITY_SLOT_COUNT) }, (_, i) =>
    ResourceSlot.citySlot(f, i),
  )
}

/*
 * The three queries below take the **resolved slot list** rather than a capacity number. A number
 * cannot express "these city slots, plus the one on Ancient Holdings" — the card slot is not the
 * seventh city slot, and a faction with two city slots and the card has three in total but must
 * not get city slot index 2. Passing the list makes that representable, and made the compiler
 * point at every site that had to be updated when the card arrived.
 */

/** Slots that currently hold no token. */
export function openSlots(tracker: Tracker, slots: readonly LocationId[]): LocationId[] {
  return slots.filter((s) => contentsOf(tracker, s).length === 0)
}

/** Every resource token a faction holds across those slots. */
export function heldTokens(tracker: Tracker, slots: readonly LocationId[]): EntityId[] {
  return slots.flatMap((s) => [...contentsOf(tracker, s)])
}

/** Count tokens of one resource across those slots. For scoring. */
export function countResource(
  tracker: Tracker,
  slots: readonly LocationId[],
  r: Resource,
): number {
  return heldTokens(tracker, slots).filter((id) => parseResourceToken(id).resource === r).length
}

// --- mutations -------------------------------------------------------------

/**
 * Gain one token of `r` from the supply into an open slot. Returns the tracker unchanged
 * (and reports it) when the supply is empty or every usable slot is full — HRF sends the
 * excess to overflow to be resolved; phase 1 declines the gain and lets the caller log it.
 */
export function gain(
  tracker: Tracker,
  slots: readonly LocationId[],
  r: Resource,
  overflow?: LocationId,
): { tracker: Tracker; gained: boolean; overflowed: boolean } {
  const supply = supplyOf(tracker, r)
  if (supply.length === 0) return { tracker, gained: false, overflowed: false }
  const token = supply[supply.length - 1]!
  const open = openSlots(tracker, slots)
  if (open.length > 0) {
    return { tracker: move(tracker, token, open[0]!), gained: true, overflowed: false }
  }
  /*
   * No slot free. The rule is not that the resource is refused: "when you take or are given a
   * resource you may rearrange any resources in your resource slots, but you must discard
   * resources you cannot hold". So the token is taken and something has to go — which is a
   * *choice*, and choices belong to the player. It waits in the faction's overflow until one is
   * made (`resolveOverflow`).
   *
   * Without an overflow location to wait in — setup, where slots are empty anyway — the gain is
   * declined as before rather than silently vanishing.
   */
  if (overflow === undefined) return { tracker, gained: false, overflowed: false }
  return { tracker: move(tracker, token, overflow), gained: false, overflowed: true }
}

/** Tokens waiting in a faction's overflow, which must be resolved before play continues. */
export function overflowTokens(tracker: Tracker, f: FactionId): readonly EntityId[] {
  return contentsOf(tracker, ResourceSlot.overflow(f))
}

/** Return a specific held token to the supply (spending / paying it). */
export function spendToken(tracker: Tracker, token: EntityId): Tracker {
  const { resource } = parseResourceToken(token)
  return move(tracker, token, ResourceSlot.supply(resource))
}
