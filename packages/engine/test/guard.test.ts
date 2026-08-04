/**
 * Slot armour: the evaluator can finally tell one arrangement from another.
 *
 * A slot's printed key cost is what a rival spends to steal from it, and the board is uneven —
 * `CITY_SLOT_KEYS` is `[3, 1, 1, 2, 1, 3]`. Before `resourcesGuarded` no feature read *where* a
 * token sat, so every ordering of a row scored identically. That is the part worth pinning: not
 * merely that the new number moves, but that the decision has a gradient at all, since without one
 * the bot had no reason to prefer a good row and no reason to stop rearranging.
 */

import {
  BASELINE_WEIGHTS,
  GUARD_WEIGHTS,
  Location,
  contentsOf,
  defaultRegistry,
  featuresOf,
  intentFor,
  move,
  observe,
  slotKeys,
  slotsOf,
  startGame,
  valueOf,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'
import { describe, expect, it } from 'vitest'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']
const SELF: FactionId = 'red'

const fresh = (): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 5 }, registry).state

/** Empty red's slots, then put `resource` in exactly `slot`. */
function only(state: GameState, slot: string, resource: string): GameState {
  let resources = state.resources
  for (const s of slotsOf(state, SELF)) {
    for (const t of contentsOf(resources, s)) resources = move(resources, t, `supply:${resource}`)
  }
  const token = contentsOf(resources, `supply:${resource}`)[0]
  expect(token).toBeDefined()
  return { ...state, resources: move(resources, token!, slot) }
}

const guardOf = (state: GameState): number => {
  const observed = observe(state, SELF)
  return featuresOf(observed, SELF, intentFor(observed, SELF)).resourcesGuarded
}

describe('slot armour prices where a token sits', () => {
  it('scores a token higher in a slot that costs more to raid', () => {
    const base = fresh()
    // Slots 0 and 5 cost 3 keys; slots 1, 2 and 4 cost 1. Same token, different armour.
    const safe = only(base, `cityslot:${SELF}:0`, 'Relic')
    const exposed = only(base, `cityslot:${SELF}:1`, 'Relic')

    expect(slotKeys(`cityslot:${SELF}:0`)).toBe(3)
    expect(slotKeys(`cityslot:${SELF}:1`)).toBe(1)
    expect(guardOf(safe)).toBeGreaterThan(guardOf(exposed))
  })

  it('scores the cheapest slot at zero — that is where an unprotected token sits', () => {
    // Scaled by `keys - 1`, so a 1-key slot contributes nothing. The zero is deliberate: holding is
    // already priced by `resourcesDeclared`/`resourcesUndeclared`, and this term is placement only.
    expect(guardOf(only(fresh(), `cityslot:${SELF}:1`, 'Relic'))).toBe(0)
  })

  it('ranks the whole row by key cost, not by slot order', () => {
    const base = fresh()
    const scores = slotsOf(base, SELF).map((slot) => ({
      keys: slotKeys(slot),
      guard: guardOf(only(base, slot, 'Relic')),
    }))
    // Every slot dearer than another must score at least as high — a monotone relationship, stated
    // over whatever the board actually offers rather than over hardcoded indices.
    for (const a of scores) {
      for (const b of scores) {
        if (a.keys > b.keys) expect(a.guard).toBeGreaterThan(b.guard)
        if (a.keys === b.keys) expect(a.guard).toBeCloseTo(b.guard, 10)
      }
    }
  })

  it('leaves the frozen baseline blind to the arrangement', () => {
    /*
     * The whole reason the weight defaults to 0. `baselineBot` must not move, or a bot that switches
     * armour on could not be attributed the difference — the reference point would have shifted
     * underneath the comparison.
     */
    const base = fresh()
    const safe = only(base, `cityslot:${SELF}:0`, 'Relic')
    const exposed = only(base, `cityslot:${SELF}:1`, 'Relic')
    const val = (s: GameState, w: typeof BASELINE_WEIGHTS) => {
      const observed = observe(s, SELF)
      return valueOf(observed, SELF, intentFor(observed, SELF), w)
    }

    expect(BASELINE_WEIGHTS.resourcesGuarded).toBe(0)
    expect(val(safe, BASELINE_WEIGHTS)).toBeCloseTo(val(exposed, BASELINE_WEIGHTS), 10)

    // And with armour switched on, the same two positions are no longer indistinguishable — which
    // is the gradient the arrange decision previously did not have.
    expect(GUARD_WEIGHTS.resourcesGuarded).toBeGreaterThan(0)
    expect(val(safe, GUARD_WEIGHTS)).toBeGreaterThan(val(exposed, GUARD_WEIGHTS))
  })
})
