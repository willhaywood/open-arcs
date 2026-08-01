/**
 * Income projection: what a position can *earn*, not what it holds.
 *
 * The gap this closes came from inspecting a live decision (docs/19 section 4): the bot declares on
 * resources currently in its slots, so a faction with three cities on Material planets and no
 * Material yet reads as having no Tycoon prospects at all.
 *
 * Tested by **behaviour and by construction**, not by win rate. The arena's floor is 12-21 points
 * (section 3c) and this effect is far smaller than that, so a match would report nothing either way;
 * every reliable signal in this document has been a direct count instead.
 */

import { describe, expect, it } from 'vitest'

import {
  GOAL_WEIGHTS,
  Location,
  WEIGHTS,
  contentsOf,
  defaultRegistry,
  featuresOf,
  incomeFor,
  intentFor,
  move,
  observe,
  planetResource,
  startGame,
  valueOf,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry).state

/** Put one of `faction`'s cities on a system, from its reserve. */
const cityOn = (state: GameState, faction: FactionId, system: string): GameState => {
  const city = contentsOf(state.figures, Location.reserve(faction)).find((id) =>
    id.includes('City'),
  )
  if (city === undefined) throw new Error(`no spare city for ${faction}`)
  return { ...state, figures: move(state.figures, city, Location.system(system)) }
}

describe('income projection', () => {
  it('counts cities by what the planet under them produces', () => {
    const base = fresh()
    const material = base.board.systems.filter((s) => planetResource(base, s) === 'Material')
    expect(material.length).toBeGreaterThan(0)

    const before = incomeFor(observe(base, 'red'), 'red').get('Tycoon') ?? 0
    const after = incomeFor(observe(cityOn(base, 'red', material[0]!), 'red'), 'red').get('Tycoon')
    expect(after).toBe(before + 1)
  })

  it('credits the ambition the planet feeds, not just any ambition', () => {
    const base = fresh()
    const relic = base.board.systems.find((s) => planetResource(base, s) === 'Relic')
    if (relic === undefined) throw new Error('expected a Relic planet on this board')

    const income = incomeFor(observe(cityOn(base, 'red', relic), 'red'), 'red')
    const start = incomeFor(observe(base, 'red'), 'red')
    expect((income.get('Keeper') ?? 0) - (start.get('Keeper') ?? 0)).toBe(1)
    expect(income.get('Tycoon')).toBe(start.get('Tycoon'))
  })

  it('is invisible to the baseline and visible to the goal bot', () => {
    /*
     * The property that keeps the comparison honest. `heuristicBot` is the frozen baseline, so the
     * new feature must not move it at all — it is carried at weight zero — while the goal bot, which
     * differs by exactly these two numbers and nothing else, must see it.
     */
    const base = fresh()
    const material = base.board.systems.filter((s) => planetResource(base, s) === 'Material')
    const richer = cityOn(base, 'red', material[0]!)

    const o0 = observe(base, 'red')
    const o1 = observe(richer, 'red')
    const intent = intentFor(o0, 'red')

    expect(WEIGHTS.incomeDeclared).toBe(0)
    expect(GOAL_WEIGHTS.incomeDeclared).toBeGreaterThan(0)

    // The feature itself moves...
    const x0 = featuresOf(o0, 'red', intent)
    const x1 = featuresOf(o1, 'red', intent)
    expect(x1.incomeUndeclared).toBeGreaterThan(x0.incomeUndeclared)

    // ...and only the goal bot's weights turn that into a difference in value.
    const baselineGap =
      valueOf(o1, 'red', intent, WEIGHTS) - valueOf(o0, 'red', intent, WEIGHTS)
    const goalGap =
      valueOf(o1, 'red', intent, GOAL_WEIGHTS) - valueOf(o0, 'red', intent, GOAL_WEIGHTS)
    expect(goalGap).toBeGreaterThan(baselineGap)
  })

  it('does not read the hand, so it cannot flap when a card is played', () => {
    /*
     * The trap this had to avoid. Holding Administration is exactly what lets you tax, so reading
     * card suits is the tempting version — and a bot's hand changes *during its own turn*, so the
     * estimate would fall the moment a card was played and the bot would contradict itself between
     * two of its own actions (section 2b). Structure is what makes it safe, and this is the check.
     */
    const base = fresh()
    const before = incomeFor(observe(base, 'red'), 'red')

    let s = base
    for (const card of contentsOf(s.cards, `hand:red`).slice(0, 3)) {
      s = { ...s, cards: move(s.cards, card, 'discard') }
    }
    const after = incomeFor(observe(s, 'red'), 'red')

    for (const [ambition, n] of before) expect(after.get(ambition)).toBe(n)
  })
})
