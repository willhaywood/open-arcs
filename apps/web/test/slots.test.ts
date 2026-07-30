/**
 * The drawn slot row must agree with the engine about which slots exist.
 *
 * `slotRow` used to iterate `CITY_SLOT_KEYS` — six entries, no concept of a seventh — so Ancient
 * Holdings' slot, which lives on the card rather than the player board, was drawn by neither the
 * player board nor `SlotBoard`. The engine had it the whole time: `slotsOf` returned it and
 * `slotKeys` priced it at four keys. A token there could not be seen, dragged or spent, and
 * capacity read one low. Nothing failed; the row just looked ordinary.
 *
 * The invariant below is what makes that class of bug loud: **every usable slot the engine reports
 * has a well drawn for it, and nothing extra.** It is stated against `slotsOf` rather than a count,
 * so a future card adding a slot is covered without touching this file.
 */

import { ANCIENT_HOLDINGS, defaultRegistry, slotKeys, slotsOf, startGame } from '@arcs/engine'
import type { FactionId, GameState } from '@arcs/engine'
import { describe, expect, it } from 'vitest'

import { slotRow } from '../src/slots.js'

const registry = defaultRegistry()
const FACTIONS = ['red', 'yellow', 'blue'] as const

const fresh = (): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...FACTIONS], seed: 1 }, registry).state

const withLore = (s: GameState, f: FactionId, id: string): GameState => ({
  ...s,
  lores: { ...s.lores, [f]: [...(s.lores[f] ?? []), id] },
})

describe('slotRow agrees with the engine about which slots exist', () => {
  it('draws a well for every usable slot, and no more', () => {
    const s = withLore(fresh(), 'blue', ANCIENT_HOLDINGS)
    for (const f of FACTIONS) {
      const drawn = slotRow(s, f)
        .filter((r) => !r.locked)
        .map((r) => r.id)
      // Order is the row's business; membership is the engine's.
      expect([...drawn].sort()).toEqual([...slotsOf(s, f)].sort())
    }
  })

  it('adds the card slot only for the faction holding the card', () => {
    const s = withLore(fresh(), 'blue', ANCIENT_HOLDINGS)
    const cardSlots = (f: FactionId): string[] =>
      slotRow(s, f)
        .map((r) => r.id)
        .filter((id) => id.startsWith('cardslot:'))

    expect(cardSlots('blue')).toEqual([`cardslot:blue:${ANCIENT_HOLDINGS}`])
    expect(cardSlots('red')).toEqual([])
    expect(cardSlots('yellow')).toEqual([])
  })

  it('prices the card slot from the engine, dearer than any city slot', () => {
    const s = withLore(fresh(), 'blue', ANCIENT_HOLDINGS)
    const row = slotRow(s, 'blue')
    const card = row.find((r) => r.id.startsWith('cardslot:'))
    expect(card).toBeDefined()
    expect(card!.keys).toBe(slotKeys(card!.id))
    // Four keys on the printed card, against a maximum of three on the board.
    expect(card!.keys).toBe(4)
    expect(Math.max(...row.filter((r) => !r.id.startsWith('cardslot:')).map((r) => r.keys))).toBe(3)
  })

  it('never locks the card slot — it is not covered by a city', () => {
    const s = withLore(fresh(), 'blue', ANCIENT_HOLDINGS)
    const card = slotRow(s, 'blue').find((r) => r.id.startsWith('cardslot:'))!
    expect(card.locked).toBe(false)
    expect(card.needs).toBe(0)
    // The board's own row still has covered slots, so this is not a blanket "nothing is locked".
    expect(slotRow(s, 'blue').some((r) => r.locked)).toBe(true)
  })

  it('leaves the row untouched without the card', () => {
    const base = fresh()
    for (const f of FACTIONS) {
      expect(slotRow(base, f)).toHaveLength(6)
      expect(slotRow(base, f).every((r) => r.id.startsWith('cityslot:'))).toBe(true)
    }
  })
})
