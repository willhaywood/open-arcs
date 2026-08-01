/**
 * Declare-readiness: a card of the right strength, a marker still free, and the lead to use it.
 *
 * The first of the goal-layer additions with no existing proxy — nothing else in `featuresOf` knows
 * what is in the hand, whose turn it is to lead, or whether a marker remains. These pin the three
 * rules it encodes and the one thing it must never do.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  contentsOf,
  declareReadiness,
  defaultRegistry,
  intentFor,
  move,
  observe,
  startGame,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
/*
 * Four players, not three, and the reason is a rule rather than a preference: at three players the
 * strength-1 and strength-7 cards are removed from the deck (`cards.ts`). Every remaining card is a
 * 2 to a 6, so every card declares *something* and the wildcard never exists — the two cases worth
 * testing hardest are unreachable there.
 */
const FOUR: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']

const fresh = (): GameState =>
  startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed: 1 }, registry).state

const ready = (s: GameState, f: FactionId = 'red'): number => {
  const o = observe(s, f)
  return declareReadiness(o, f, intentFor(o, f))
}

/** Empty a hand, then deal it exactly the given cards. */
const handOf = (state: GameState, faction: FactionId, ids: readonly string[]): GameState => {
  let s = state
  for (const id of contentsOf(s.cards, CardLocation.hand(faction))) {
    s = { ...s, cards: move(s.cards, id, CardLocation.discard()) }
  }
  for (const id of ids) s = { ...s, cards: move(s.cards, id, CardLocation.hand(faction)) }
  return s
}

describe('declare-readiness', () => {
  it('is zero with no card that can declare anything', () => {
    // Strength 1 matches no ambition, and only a 7 is a wildcard — so a hand of 1s can declare nothing.
    expect(ready(handOf(fresh(), 'red', ['Administration-1', 'Aggression-1']))).toBe(0)
  })

  it('rises once the hand holds a card of a declaring strength', () => {
    const base = fresh()
    const none = ready(handOf(base, 'red', ['Administration-1']))
    const tycoon = ready(handOf(base, 'red', ['Administration-2']))
    expect(tycoon).toBeGreaterThan(none)
  })

  it('treats a 7 as declaring anything', () => {
    const base = fresh()
    // A 7 is a wildcard, so it must be worth at least as much as the single best specific card.
    const seven = ready(handOf(base, 'red', ['Administration-7']))
    const specific = ready(handOf(base, 'red', ['Administration-2']))
    expect(seven).toBeGreaterThanOrEqual(specific)
    expect(seven).toBeGreaterThan(0)
  })

  it('is zero when no marker is left to declare into', () => {
    const base = handOf(fresh(), 'red', ['Administration-7'])
    expect(ready(base)).toBeGreaterThan(0)
    // Only the lead player may declare, and only while a marker is available this chapter.
    expect(ready({ ...base, ambitionable: [] })).toBe(0)
  })

  it('is worth more to the faction holding initiative', () => {
    const base = handOf(fresh(), 'red', ['Administration-7'])
    const leading = { ...base, initiativeOrder: ['red', 'yellow', 'blue', 'white'] as FactionId[] }
    const trailing = { ...base, initiativeOrder: ['yellow', 'blue', 'white', 'red'] as FactionId[] }
    expect(ready(leading)).toBeGreaterThan(ready(trailing))
  })

  it('never reads a rival hand', () => {
    /*
     * `ObservedState` hides other players' cards, so readiness is only ever computable for `self`.
     * Scoring a rival's readiness would be the same class of cheat section 2k had to close for dice
     * — information the bot is not entitled to, arriving through a side door.
     */
    const s = handOf(fresh(), 'yellow', ['Administration-7'])
    const asRed = observe(s, 'red')
    expect(declareReadiness(asRed, 'yellow', intentFor(asRed, 'red'))).toBe(0)
  })
})
