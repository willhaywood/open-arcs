/**
 * The resource-slot row, derived once and drawn by two surfaces.
 *
 * The player board draws it small and read-only; `SlotBoard` draws it large and draggable. They
 * must agree about which slots are open, which city covers which, and what each costs to raid —
 * so the derivation lives here rather than in either of them.
 *
 * The physical idea it encodes: your **unbuilt cities sit on the later slots, covering them**.
 * Building a city takes it off your board and reveals what was underneath.
 *
 *   slots 1-2  open from the start
 *   slot 3     1st city
 *   slot 4     2nd city
 *   slots 5-6  3rd city  (one city reveals both — a single wide token on the real board)
 *   +2 shield  4th city
 *   +3 shield  5th city
 */

import {
  CITY_SLOT_COUNT,
  CITY_SLOT_KEYS,
  ResourceSlot,
  citiesInReserve,
  contentsOf,
  parseResourceToken,
  slotCapacity,
} from '@arcs/engine'
import type { FactionId, GameState, Resource } from '@arcs/engine'

export const CITIES_PER_FACTION = 5

export interface SlotInfo {
  /** Location id, so a drop target can name the slot the engine knows. */
  id: string
  keys: number
  locked: boolean
  resource: Resource | undefined
  /** The token in it, if any — `SlotBoard` moves tokens, not resource types. */
  token: string | undefined
  /** How many cities must be off your board before this slot is usable. */
  needs: number
}

/** Derived from `slotCapacity` rather than hardcoded, so it cannot drift from the engine. */
export function citiesToUnlock(slot: number, total: number): number {
  for (let built = 0; built <= total; built++) {
    if (slotCapacity(total - built) > slot) return built
  }
  return total
}

/** Every one of a faction's six city slots, open or covered. */
export function slotRow(state: GameState, faction: FactionId): SlotInfo[] {
  const capacity = slotCapacity(citiesInReserve(state, faction))
  return Array.from({ length: CITY_SLOT_COUNT }, (_, i) => {
    const id = ResourceSlot.citySlot(faction, i)
    const held = contentsOf(state.resources, id)[0]
    return {
      id,
      keys: CITY_SLOT_KEYS[i]!,
      locked: i >= capacity,
      resource: held === undefined ? undefined : parseResourceToken(held).resource,
      token: held,
      needs: citiesToUnlock(i, CITIES_PER_FACTION),
    }
  })
}

export interface SlotGroupInfo {
  locked: boolean
  needs: number
  items: SlotInfo[]
}

/**
 * Consecutive locked slots that the *same* city covers become one group, so a single token
 * straddles them — slots 5 and 6 both open on the 3rd city, and on the physical board that is one
 * city sitting across the pair, not two cities. The token stays the same size as every other city,
 * so it covers a two-slot group only partially; being one token rather than two carries the
 * meaning.
 */
export function groupSlots(slots: readonly SlotInfo[]): SlotGroupInfo[] {
  const groups: SlotGroupInfo[] = []
  for (const s of slots) {
    const last = groups[groups.length - 1]
    if (last !== undefined && last.locked && s.locked && last.needs === s.needs) {
      last.items.push(s)
    } else {
      groups.push({ locked: s.locked, needs: s.needs, items: [s] })
    }
  }
  return groups
}
