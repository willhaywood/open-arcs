/**
 * The hidden-information boundary holds.
 *
 * `observe` is the thing that stops a bot cheating, and it fails silently: a projection that leaks a
 * rival's hand still typechecks, still plays, and produces a bot that is simply better than it
 * should be for reasons nobody can see. HRF shipped exactly that — its `cleanFor` is
 * `def cleanFor(f) = this` — so this is the test that says ours is not a no-op.
 *
 * The assertions are stated **structurally** rather than as a list of field names: "no rival card id
 * appears anywhere in the projection", not "the `cards` field is absent". A field-name test passes
 * the moment someone adds a differently-named field carrying the same secret.
 *
 * **`JSON.stringify` is not good enough for that, and using it made this test worthless once.**
 * The zones are `Tracker`s built on `Map`, and `JSON.stringify(new Map(...))` is `{}` — so a
 * projection leaking every hand through `cards: state.cards` serialised to a string containing no
 * card ids at all, and the leak test passed. Caught by mutation, and the reason `reachableStrings`
 * below walks the object graph by hand, expanding Maps and Sets.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  contentsOf,
  defaultRegistry,
  observe,
  startGame,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE = ['red', 'yellow', 'blue'] as const

/** `startGame` already deals chapter 1, so hands are populated from the off. */
const dealt = (seed = 1): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state

const handOf = (s: GameState, f: FactionId): readonly string[] =>
  contentsOf(s.cards, CardLocation.hand(f))

/**
 * Every string reachable from a value, through objects, arrays, **Maps and Sets**.
 *
 * The Map handling is the whole point — see the module header. A `Tracker` keeps its contents in
 * Maps, so anything that only looks at enumerable own properties, `JSON.stringify` included, sees
 * an empty object where the secret is.
 */
function reachableStrings(value: unknown, seen = new Set<unknown>(), out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    out.add(value)
    return out
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)

  if (value instanceof Map) {
    for (const [k, v] of value) {
      reachableStrings(k, seen, out)
      reachableStrings(v, seen, out)
    }
    return out
  }
  if (value instanceof Set || Array.isArray(value)) {
    for (const v of value) reachableStrings(v, seen, out)
    return out
  }
  for (const v of Object.values(value)) reachableStrings(v, seen, out)
  return out
}

describe('observe — the hidden-information boundary', () => {
  it('deals hands at all, or everything below is vacuous', () => {
    const s = dealt()
    expect(handOf(s, 'red').length).toBeGreaterThan(0)
    expect(handOf(s, 'yellow').length).toBeGreaterThan(0)
  })

  it('gives you your own hand', () => {
    const s = dealt()
    const view = observe(s, 'red')
    expect([...view.hand].sort()).toEqual([...handOf(s, 'red')].sort())
  })

  it('leaks no rival card id anywhere in the projection', () => {
    const s = dealt()
    const reachable = reachableStrings(observe(s, 'red'))

    const mine = new Set(handOf(s, 'red'))
    const leaked: string[] = []
    for (const f of ['yellow', 'blue'] as const) {
      for (const card of handOf(s, f)) {
        // A card could legitimately appear if red held one of the same id — it cannot here, since
        // ids are unique, but the guard keeps this honest if that ever changes.
        if (mine.has(card)) continue
        if (reachable.has(card)) leaked.push(`${f}: ${card}`)
      }
    }
    expect(leaked).toEqual([])
  })

  it('carries hand sizes, which are public, without the contents', () => {
    const s = dealt()
    const view = observe(s, 'red')
    for (const f of THREE) {
      expect(view.handSizes[f]).toBe(handOf(s, f).length)
    }
  })

  it('omits the rng — the leak that predicts every future roll', () => {
    const view = observe(dealt(), 'red') as unknown as Record<string, unknown>
    expect(view['rng']).toBeUndefined()
    // Nor smuggled in under another name.
    expect(Object.keys(view)).not.toContain('seed')
  })

  it('omits the journal, which reconstructs the rng by replay', () => {
    const view = observe(dealt(), 'red') as unknown as Record<string, unknown>
    expect(view['journal']).toBeUndefined()
  })

  it('omits unusedLore — the box, in shuffled order, drawn from the top', () => {
    const s = startGame(
      {
        board: 'Board3MixUp',
        factions: [...THREE],
        seed: 1,
        leadersAndLore: { expansion: true, lorePerPlayer: 2 },
      },
      registry,
    ).state
    expect(s.unusedLore.length).toBeGreaterThan(0)
    const reachable = reachableStrings(observe(s, 'red'))
    expect(s.unusedLore.filter((id) => reachable.has(id))).toEqual([])
  })

  it('passes public zones through — a bot that cannot see the court cannot play', () => {
    const s = dealt()
    const view = observe(s, 'red')
    // Sampled rather than exhaustive: these are the ones a value function cannot work without.
    expect(view.resources).toBe(s.resources)
    expect(view.courtCards).toBe(s.courtCards)
    expect(view.declared).toBe(s.declared)
    expect(view.power).toBe(s.power)
    expect(view.leaders).toBe(s.leaders)
  })

  it('gives each faction a different view of the same state', () => {
    const s = dealt()
    const red = observe(s, 'red')
    const yellow = observe(s, 'yellow')
    expect(red.self).toBe('red')
    expect(yellow.self).toBe('yellow')
    expect([...red.hand].sort()).not.toEqual([...yellow.hand].sort())
  })
})
