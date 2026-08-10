/**
 * The shipped bot is a decision, and this is where it is pinned.
 *
 * `standardBot` is what a human plays against. Which weights it carries has been decided by
 * measurement, and two of the candidates were measured and **rejected** — so the interesting
 * assertions here are the exclusions. A later reader adding a feature to the standard set should
 * have to change this file, and should find the reason recorded when they do.
 */

import { describe, expect, it } from 'vitest'

import {
  BASELINE_WEIGHTS,
  CONTEST_WEIGHTS,
  STANDARD_WEIGHTS,
  WEIGHTS,
  standardBot,
  weightsMatchBaseline,
} from '../src/index.js'

describe('the standard bot', () => {
  it('carries the goal layer that was measured good', () => {
    // Income, declare-readiness and contest, each added and measured in turn (docs/19 section 4).
    expect(STANDARD_WEIGHTS.incomeDeclared).toBeGreaterThan(0)
    expect(STANDARD_WEIGHTS.declareReady).toBeGreaterThan(0)
    expect(STANDARD_WEIGHTS.standingContested).toBeGreaterThan(0)
  })

  it('prices what declaring costs, as a cost', () => {
    // Negative, and the sign is the whole point: declaring zeroes the played card. Priced as a
    // bonus the bot would declare *more*, which is the behaviour this was added to stop.
    expect(STANDARD_WEIGHTS.leadZeroed).toBeLessThan(0)
  })

  it('does NOT carry lore activation, which measured worse', () => {
    /*
     * docs/19 section 3k: 2-3 points of win rate behind against a 0-1 point floor, in both the flat
     * and the feasibility-scaled variant. Shipping it would knowingly weaken the bot, so this
     * assertion is here to make that a deliberate act rather than an oversight.
     */
    expect(STANDARD_WEIGHTS.loreLive).toBe(0)
    expect(STANDARD_WEIGHTS.loreArmed).toBe(0)
  })

  it('does NOT carry slot armour, which measured as nothing', () => {
    // docs/19 section 3j: the gap *was* the noise floor, at 120 and at 1000 games. Off because a
    // change with no evidence cannot be defended later, not because it does harm.
    expect(STANDARD_WEIGHTS.resourcesGuarded).toBe(0)
  })

  it('makes the Weapon option visible, which is why the bot spends them', () => {
    /*
     * Shipped on opponent quality, not strength: it measured a null (34% against 33% on a 1-point
     * floor, docs/19 section 9) and took Weapon spending from 1% to 26%. A bot hoarding four Weapons
     * it will never use looks broken in the same way `leadZeroed` was added to stop.
     */
    expect(STANDARD_WEIGHTS.battleUnlocked).toBeGreaterThan(0)
    // Above what a Weapon is worth, or it could never flip the decision it exists to flip.
    expect(STANDARD_WEIGHTS.battleUnlocked).toBeGreaterThan(STANDARD_WEIGHTS.weapons)
  })

  it('is the contest set plus the price of declaring and the Weapon option, and nothing else', () => {
    // Stated as a diff rather than a copy of the numbers, so re-tuning any inherited weight does not
    // silently fail here — only *adding* to the standard set does.
    const diff = Object.keys(STANDARD_WEIGHTS).filter(
      (k) => STANDARD_WEIGHTS[k as keyof typeof STANDARD_WEIGHTS] !== CONTEST_WEIGHTS[k as keyof typeof CONTEST_WEIGHTS],
    )
    expect(diff.sort()).toEqual(['battleUnlocked', 'leadZeroed'])
  })

  it('leaves the frozen baseline alone — it is the reference, not the product', () => {
    /*
     * Promoting the shipped bot must never move what everything is measured against. `WEIGHTS` is
     * the live hand-set table and `BASELINE_WEIGHTS` its frozen copy; the standard set is built on
     * top of both and changes neither.
     */
    expect(weightsMatchBaseline()).toBe(true)
    expect(BASELINE_WEIGHTS.leadZeroed).toBe(0)
    expect(WEIGHTS.leadZeroed).toBe(0)
  })

  it('is a real bot with its own id, so a decision can be attributed to it', () => {
    expect(standardBot.id).toBe('standard')
  })
})
