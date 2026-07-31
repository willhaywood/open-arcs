/**
 * Chapter intent.
 *
 * The properties tested are the ones docs/19 section 2b says make a memoryless plan usable. Two of
 * them are easy to lose by accident and neither shows up as a crash:
 *
 *   - **It does not flap.** Intent is recomputed at every decision, so anything it reads that moves
 *     within a turn makes the bot contradict itself between two of its own actions.
 *   - **It is a pure function of the observed state.** Not of history, not of the full state. If it
 *     ever needs more than `ObservedState` it has stopped being safe to run on any client.
 */

import { describe, expect, it } from 'vitest'

import {
  AMBITIONS,
  CardLocation,
  Location,
  contentsOf,
  defaultRegistry,
  intentFor,
  move,
  observe,
  startGame,
} from '../src/index.js'
import type { Ambition, FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const FOUR = ['red', 'yellow', 'blue', 'white'] as const

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed }, registry).state

const intent = (s: GameState, f: FactionId = 'red') => intentFor(observe(s, f), f)

const declare = (s: GameState, a: Ambition, high: number, low = 0): GameState => ({
  ...s,
  declared: [...s.declared, { ambition: a, marker: { high, low } }],
})

describe('chapter intent', () => {
  it('always names something, and the weights are a distribution', () => {
    const i = intent(fresh())
    expect(AMBITIONS).toContain(i.leading)
    const total = [...i.pursuing.values()].reduce((n, v) => n + v, 0)
    expect(total).toBeCloseTo(1, 5)
    for (const v of i.pursuing.values()) expect(v).toBeGreaterThan(0)
  })

  it('leans toward an ambition once it is declared', () => {
    const base = fresh()
    const before = intent(base).pursuing.get('Warlord') ?? 0
    const after = intent(declare(base, 'Warlord', 6, 3)).pursuing.get('Warlord') ?? 0
    expect(after).toBeGreaterThan(before)
  })

  it('wants a rich marker more than a poor one', () => {
    const base = fresh()
    const rich = intent(declare(base, 'Keeper', 9, 4)).pursuing.get('Keeper') ?? 0
    const poor = intent(declare(base, 'Keeper', 2, 0)).pursuing.get('Keeper') ?? 0
    expect(rich).toBeGreaterThan(poor)
  })

  it('backs off an ambition a rival is already winning', () => {
    const base = declare(fresh(), 'Warlord', 6, 3)
    const alone = intent(base).pursuing.get('Warlord') ?? 0

    // Give yellow a pile of trophies: red's Warlord prospects should fall.
    let s = base
    const spare = contentsOf(s.figures, Location.reserve('blue')).slice(0, 6)
    for (const id of spare) s = { ...s, figures: move(s.figures, id, Location.trophies('yellow')) }
    const contested = intent(s).pursuing.get('Warlord') ?? 0

    expect(contested).toBeLessThan(alone)
  })

  it('does NOT move when resources change — the flap that would break a memoryless plan', () => {
    /*
     * The property that matters most. Intent is recomputed every decision, so if it read the
     * Material a bot is about to spend, spending it would lower the appetite for Tycoon *mid-turn*
     * and the bot would argue with itself between two of its own actions.
     */
    const base = declare(fresh(), 'Tycoon', 6, 3)
    const before = intent(base)

    // Move every resource red holds back to the supply — a drastic version of spending them.
    let s = base
    for (let i = 0; i < 6; i++) {
      for (const token of contentsOf(s.resources, `cityslot:red:${i}`)) {
        const supply = `supply:${token.slice(0, token.indexOf('#'))}`
        s = { ...s, resources: move(s.resources, token, supply) }
      }
    }
    const after = intent(s)

    expect(after.leading).toBe(before.leading)
    expect(after.pursuing.get('Tycoon')).toBeCloseTo(before.pursuing.get('Tycoon') ?? 0, 10)
  })

  it('does not move when the hand changes either — cards are spent within a turn too', () => {
    const base = fresh()
    const before = intent(base)
    let s = base
    for (const card of contentsOf(s.cards, CardLocation.hand('red')).slice(0, 3)) {
      s = { ...s, cards: move(s.cards, card, CardLocation.discard()) }
    }
    expect(intent(s).pursuing.get(before.leading)).toBeCloseTo(
      before.pursuing.get(before.leading) ?? 0,
      10,
    )
  })

  it('is deterministic — same observation, same intent', () => {
    const s = declare(fresh(3), 'Empath', 5, 2)
    const a = intent(s)
    const b = intent(s)
    expect(a.leading).toBe(b.leading)
    expect([...a.pursuing.entries()]).toEqual([...b.pursuing.entries()])
  })

  it('gives different factions different intents from the same board', () => {
    let s = declare(fresh(), 'Warlord', 6, 3)
    // Only yellow has trophies, so only yellow should fancy Warlord.
    for (const id of contentsOf(s.figures, Location.reserve('blue')).slice(0, 5)) {
      s = { ...s, figures: move(s.figures, id, Location.trophies('yellow')) }
    }
    const red = intent(s, 'red').pursuing.get('Warlord') ?? 0
    const yellow = intent(s, 'yellow').pursuing.get('Warlord') ?? 0
    expect(yellow).toBeGreaterThan(red)
  })

  it('summarises in words a player could read', () => {
    const i = intent(declare(fresh(), 'Tycoon', 8, 4))
    expect(i.summary).toContain(i.leading)
    expect(i.summary.length).toBeGreaterThan(10)
  })
})
