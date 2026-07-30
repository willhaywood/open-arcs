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
  slotKeys,
  slotsOf,
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

/**
 * A faction's resource slots: the six city slots, open or covered, then any slot living on a card.
 *
 * **Ancient Holdings (lore13) prints a seventh slot on the card itself**, and this row used to be a
 * bare iteration of `CITY_SLOT_KEYS` — six entries, no concept of a seventh — so that slot was
 * drawn by neither the player board nor `SlotBoard`. The engine had it all along: `control.ts` adds
 * a `cardslot:<faction>:lore13`, `slotKeys` prices it at four keys, and `slotsOf` returns it. A
 * token there simply could not be seen, dragged or spent, and capacity read one low.
 *
 * The card slot is *appended* rather than folded into the six, and the row is not derived from
 * `slotsOf` wholesale, because the two halves mean different things. The city slots include the
 * ones still **covered by unbuilt cities** — which is the physical idea the row exists to show, and
 * exactly what `slotsOf` leaves out, since a covered slot is not usable. The card slot is never
 * covered: it is on the card, not the board, so it needs no cities off it and cannot be locked.
 *
 * Which slots exist comes from `slotsOf` and the price from `slotKeys`, so the card that grants it
 * stays the engine's business — nothing here needs to know the string `lore13`.
 */
export function slotRow(state: GameState, faction: FactionId): SlotInfo[] {
  const capacity = slotCapacity(citiesInReserve(state, faction))
  const city = Array.from({ length: CITY_SLOT_COUNT }, (_, i) => {
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

  const onCards = slotsOf(state, faction)
    .filter((id) => id.startsWith('cardslot:'))
    .map((id) => {
      const held = contentsOf(state.resources, id)[0]
      return {
        id,
        keys: slotKeys(id),
        locked: false,
        resource: held === undefined ? undefined : parseResourceToken(held).resource,
        token: held,
        needs: 0,
      }
    })

  return [...city, ...onCards]
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
