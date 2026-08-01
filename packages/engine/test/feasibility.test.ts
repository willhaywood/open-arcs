/**
 * Feasibility: is this ambition winnable *from here*, rather than does this faction look big.
 *
 * `structuralFitness` counts every city the same whether it stands on Material or on Psionic, so a
 * faction whose territory is all Relic rates its Tycoon prospects as highly as one on the Material
 * belt. These are the properties that separate the two, plus the anti-flap rule that constrains what
 * feasibility is allowed to read at all.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  Location,
  contentsOf,
  defaultRegistry,
  feasibility,
  intentFor,
  move,
  observe,
  planetResource,
  startGame,
  structuralFitness,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry).state

const cityOn = (state: GameState, faction: FactionId, system: string): GameState => {
  const city = contentsOf(state.figures, Location.reserve(faction)).find((id) => id.includes('City'))
  if (city === undefined) throw new Error(`no spare city for ${faction}`)
  return { ...state, figures: move(state.figures, city, Location.system(system)) }
}

const firstOf = (state: GameState, resource: string): string => {
  const s = state.board.systems.find((sys) => planetResource(state, sys) === resource)
  if (s === undefined) throw new Error(`no ${resource} planet on this board`)
  return s
}

describe('feasibility', () => {
  it('tells a Material city apart from a Relic one; structural fitness cannot', () => {
    const base = fresh()
    const onMaterial = observe(cityOn(base, 'red', firstOf(base, 'Material')), 'red')
    const onRelic = observe(cityOn(base, 'red', firstOf(base, 'Relic')), 'red')

    // The whole point: the same city in two places says different things about Tycoon.
    expect(feasibility(onMaterial, 'red', 'Tycoon')).toBeGreaterThan(
      feasibility(onRelic, 'red', 'Tycoon'),
    )
    expect(feasibility(onRelic, 'red', 'Keeper')).toBeGreaterThan(
      feasibility(onMaterial, 'red', 'Keeper'),
    )

    // And the reason it is an improvement: the old measure cannot tell them apart at all.
    expect(structuralFitness(onMaterial, 'red', 'Tycoon')).toBe(
      structuralFitness(onRelic, 'red', 'Tycoon'),
    )
  })

  it('moves chapter intent toward the ambition the territory supports', () => {
    const base = fresh()
    const material = observe(cityOn(base, 'red', firstOf(base, 'Material')), 'red')

    const before = intentFor(observe(base, 'red'), 'red', feasibility).pursuing.get('Tycoon') ?? 0
    const after = intentFor(material, 'red', feasibility).pursuing.get('Tycoon') ?? 0
    expect(after).toBeGreaterThan(before)
  })

  it('does not move when resources or cards change — the flap rule it must obey', () => {
    /*
     * The constraint that shapes the whole design. Intent is recomputed at every decision, so
     * anything it reads that moves within a turn makes the bot contradict itself between two of its
     * own actions (docs/19 section 2b). Feasibility reads the planets under its cities and never the
     * resources those cities have produced — spending Material must not lower the appetite for the
     * Tycoon it was spent on.
     */
    const base = cityOn(fresh(), 'red', firstOf(fresh(), 'Material'))
    const before = intentFor(observe(base, 'red'), 'red', feasibility)

    let s = base
    for (let i = 0; i < 6; i++) {
      for (const token of contentsOf(s.resources, `cityslot:red:${i}`)) {
        s = { ...s, resources: move(s.resources, token, `supply:${token.slice(0, token.indexOf('#'))}`) }
      }
    }
    for (const card of contentsOf(s.cards, CardLocation.hand('red')).slice(0, 3)) {
      s = { ...s, cards: move(s.cards, card, CardLocation.discard()) }
    }

    const after = intentFor(observe(s, 'red'), 'red', feasibility)
    expect(after.leading).toBe(before.leading)
    for (const [ambition, weight] of before.pursuing) {
      expect(after.pursuing.get(ambition)).toBeCloseTo(weight, 10)
    }
  })
})
