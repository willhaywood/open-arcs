/**
 * Declaring an ambition costs the card you declared off, and the evaluator can now see that.
 *
 * Declaring zeroes your played card — it counts as strength 0, so any same-suit card surpasses it
 * and the initiative usually goes. Nothing read `lead.zeroed`, so declaring was **free**: an audit
 * over 40 games found a hopeless declaration and a skip differing by ~0.001 on values around 0.76,
 * and the frozen baseline declaring 12.8 times a game to win them at 34% against a 33% chance line.
 *
 * **What this deliberately does not do is judge which ambitions are winnable.** Declaring one you
 * currently hold nothing for is sound play when you have cities to tax into it, or ships to take
 * trophies with — and that case is already priced elsewhere (`feasibility`, and declaring moving
 * income from the `incomeUndeclared` bucket into `incomeDeclared`). This only makes the price
 * visible, so those gains are weighed against something instead of being had for nothing.
 */

import { describe, expect, it } from 'vitest'

import {
  BASELINE_WEIGHTS,
  DECLARE_COST_WEIGHTS,
  defaultRegistry,
  featuresOf,
  intentFor,
  observe,
  startGame,
  valueOf,
} from '../src/index.js'
import type { FactionId, GameState, Lead, Weights } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']
const SELF: FactionId = 'red'

const fresh = (): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 5 }, registry).state

const leading = (state: GameState, lead: Partial<Lead>): GameState => ({
  ...state,
  lead: {
    faction: SELF,
    cardId: 'Mobilization-4',
    suit: 'Mobilization',
    strength: 4,
    pips: 3,
    zeroed: false,
    ...lead,
  } as Lead,
})

const featuresFor = (state: GameState) => {
  const observed = observe(state, SELF)
  return featuresOf(observed, SELF, intentFor(observed, SELF))
}

const valueFor = (state: GameState, weights: Weights): number => {
  const observed = observe(state, SELF)
  return valueOf(observed, SELF, intentFor(observed, SELF), weights)
}

describe('the price of declaring', () => {
  it('is zero while the lead is intact', () => {
    expect(featuresFor(leading(fresh(), { zeroed: false })).leadZeroed).toBe(0)
  })

  it('is the strength surrendered once the card is zeroed', () => {
    expect(featuresFor(leading(fresh(), { zeroed: true, strength: 4 })).leadZeroed).toBe(4)
  })

  it('scales with the card given up — a zeroed 6 costs more than a zeroed 2', () => {
    // The reason it is not a flat penalty: zeroing a high card surrenders far more of the
    // initiative fight than zeroing a low one.
    const cheap = featuresFor(leading(fresh(), { zeroed: true, strength: 2 })).leadZeroed
    const dear = featuresFor(leading(fresh(), { zeroed: true, strength: 6 })).leadZeroed
    expect(dear).toBeGreaterThan(cheap)
  })

  it('is a cost to the faction that paid it, not to whoever is looking', () => {
    // A rival's zeroed lead is their problem. Reading it as our own would invert the whole signal.
    const rivalsLead = leading(fresh(), { faction: 'yellow', zeroed: true, strength: 5 })
    expect(featuresFor(rivalsLead).leadZeroed).toBe(0)
  })

  it('makes a zeroed lead worth strictly less than an intact one', () => {
    const intact = leading(fresh(), { zeroed: false, strength: 4 })
    const spent = leading(fresh(), { zeroed: true, strength: 4 })
    expect(valueFor(spent, DECLARE_COST_WEIGHTS)).toBeLessThan(
      valueFor(intact, DECLARE_COST_WEIGHTS),
    )
  })

  it('leaves the frozen baseline unable to see the price at all', () => {
    // Which is the measured problem: declaring was free, so the baseline took nearly every marker
    // and won them at chance.
    expect(BASELINE_WEIGHTS.leadZeroed).toBe(0)
    const intact = leading(fresh(), { zeroed: false, strength: 4 })
    const spent = leading(fresh(), { zeroed: true, strength: 4 })
    expect(valueFor(spent, BASELINE_WEIGHTS)).toBeCloseTo(valueFor(intact, BASELINE_WEIGHTS), 10)
  })
})
