/**
 * Contestedness: how *live* a declared ambition is, which `share` structurally cannot say.
 *
 * `standing` scales the marker by a step function over {0, 0.2, 0.5, 1}, so leading 10-1 and leading
 * 3-2 are the same number to it, and so are being one behind and eight behind. The second case is
 * the expensive one: a single Relic short of taking a declared Keeper is nearly as good as holding
 * it, because one action flips the whole marker, and `share` prices that at 0.2.
 *
 * These tests pin the shape rather than the scale — the weight is the arena's business.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  contentsOf,
  defaultRegistry,
  featuresOf,
  intentFor,
  move,
  observe,
  startGame,
} from '../src/index.js'
import type { Ambition, FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry).state

const declare = (s: GameState, a: Ambition, high: number): GameState => ({
  ...s,
  declared: [...s.declared, { ambition: a, marker: { high, low: 0 } }],
})

/**
 * Give a faction `n` trophies.
 *
 * Trophies are the Warlord metric and, unlike resources, cannot be spent — which is what makes them
 * the clean way to set up a known margin. Taken from blue's reserve so the two contestants are red
 * and yellow.
 */
const trophies = (s: GameState, faction: FactionId, n: number): GameState => {
  let out = s
  // Pooled across every reserve: after setup no single one holds many spare ships.
  const spare = THREE.flatMap((f) => contentsOf(out.figures, Location.reserve(f)))
    .filter((id) => id.includes('Ship'))
    .slice(0, n)
  if (spare.length < n) throw new Error(`only ${spare.length} spare ships for ${n} trophies`)
  for (const id of spare) out = { ...out, figures: move(out.figures, id, Location.trophies(faction)) }
  return out
}

/*
 * Both features are read under **one fixed intent**, taken from a neutral position and reused.
 *
 * That is not tidiness, it is the isolation the test needs: `standing` is `marker x share x bias`,
 * and `bias` comes from intent, which reads trophies for Warlord. Recomputing intent per position
 * would let the trophy counts move `standing` through the back door, and the claim here is precisely
 * about what `share` can and cannot express.
 */
const fixedIntent = (s: GameState): ReturnType<typeof intentFor> =>
  intentFor(observe(s, 'red'), 'red')

const featureOf = (
  s: GameState,
  intent: ReturnType<typeof intentFor>,
  key: 'standing' | 'standingContested',
): number => featuresOf(observe(s, 'red'), 'red', intent)[key]

describe('contestedness', () => {
  it('is highest when the margin is nothing and decays as it settles', () => {
    const base = declare(fresh(), 'Warlord', 6)
    const intent = fixedIntent(base)
    const level = trophies(trophies(base, 'red', 2), 'yellow', 2)
    const oneApart = trophies(trophies(base, 'red', 2), 'yellow', 3)
    const settled = trophies(trophies(base, 'red', 2), 'yellow', 6)

    expect(featureOf(level, intent, 'standingContested')).toBeGreaterThan(
      featureOf(oneApart, intent, 'standingContested'),
    )
    expect(featureOf(oneApart, intent, 'standingContested')).toBeGreaterThan(
      featureOf(settled, intent, 'standingContested'),
    )
  })

  it('sees a near-miss that `standing` cannot tell from a rout', () => {
    /*
     * The whole point. One behind and six behind are both `share = 0.2`, so `standing` reports the
     * same number for a marker one action from changing hands and one already gone.
     */
    const base = declare(fresh(), 'Warlord', 6)
    const intent = fixedIntent(base)
    const nearly = trophies(trophies(base, 'red', 2), 'yellow', 3)
    const hopeless = trophies(trophies(base, 'red', 2), 'yellow', 6)

    expect(featureOf(nearly, intent, 'standing')).toBeCloseTo(
      featureOf(hopeless, intent, 'standing'),
      10,
    )
    expect(featureOf(nearly, intent, 'standingContested')).toBeGreaterThan(
      featureOf(hopeless, intent, 'standingContested'),
    )
  })

  it('values a fragile lead above a settled one, which `standing` also cannot', () => {
    const base = declare(fresh(), 'Warlord', 6)
    const intent = fixedIntent(base)
    const fragile = trophies(trophies(base, 'red', 3), 'yellow', 2)
    const commanding = trophies(trophies(base, 'red', 6), 'yellow', 2)

    expect(featureOf(fragile, intent, 'standing')).toBeCloseTo(
      featureOf(commanding, intent, 'standing'),
      10,
    )
    expect(featureOf(fragile, intent, 'standingContested')).toBeGreaterThan(
      featureOf(commanding, intent, 'standingContested'),
    )
  })

  it('is zero while nothing is declared', () => {
    // Nothing to contest: the markers are still on the board.
    const base = fresh()
    expect(featureOf(base, fixedIntent(base), 'standingContested')).toBe(0)
  })
})
