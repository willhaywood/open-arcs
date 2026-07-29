import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  Continue as C,
  CourtPile,
  Location,
  advance,
  contentsOf,
  courtCard,
  defaultRegistry,
  isOutraged,
  outragedResources,
  parseFigureId,
  startGame,
  unhandled,
} from '../src/index.js'
import type { Continue, GameState } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry().register({
  id: 'test-terminal',
  perform: (state: GameState, action: { type: string }) =>
    action.type === 'test/stop'
      ? { state, continue: C.ask('red', [{ type: 'test/stop', faction: 'red', label: 'stop' }], 'stop') }
      : unhandled(state),
})
const STOP = { type: 'test/stop' } as const

function fresh(seed = 1): GameState {
  const s = startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
  return { ...s, ruleChain: [...s.ruleChain, 'test-terminal'] }
}

const fire = (state: GameState, card: string, faction: 'red' = 'red') =>
  advance(state, { type: 'vox/trigger', faction, card, then: STOP }, registry)

const labels = (c: Continue): string[] =>
  c.kind === 'ask' ? c.actions.map((a) => (a.label as string | undefined) ?? '') : []

/** Put a court card into a pile directly. */
function putCard(state: GameState, cardId: string, pile: string): GameState {
  const contents = new Map(state.courtCards.contents)
  const at = new Map(state.courtCards.at)
  const from = at.get(cardId)
  if (from !== undefined) contents.set(from, (contents.get(from) ?? []).filter((c) => c !== cardId))
  contents.set(pile, [...(contents.get(pile) ?? []), cardId])
  at.set(cardId, pile)
  return { ...state, courtCards: { ...state.courtCards, contents, at } }
}

describe('Call to Action (bc31) — draw a card', () => {
  it('moves one card from the deck to your hand, then discards itself', () => {
    const state = putCard(fresh(), 'bc31', CourtPile.discard())
    const handBefore = contentsOf(state.cards, CardLocation.hand('red')).length
    const deckBefore = contentsOf(state.cards, CardLocation.deck()).length

    const step = fire(state, 'bc31')
    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).toHaveLength(handBefore + 1)
    expect(contentsOf(step.state.cards, CardLocation.deck())).toHaveLength(deckBefore - 1)
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc31')
  })
})

describe('Outrage Spreads (bc28) — everyone, not just you', () => {
  it('offers one option per resource', () => {
    const c = fire(putCard(fresh(), 'bc28', CourtPile.discard()), 'bc28').continue
    expect(labels(c)).toEqual(
      expect.arrayContaining(['Spread Material outrage', 'Spread Psionic outrage']),
    )
  })

  it('outrages every faction, including the one that secured it', () => {
    const state = putCard(fresh(), 'bc28', CourtPile.discard())
    const step = advance(
      state,
      { type: 'vox/outrage', faction: 'red', resource: 'Fuel', card: 'bc28', then: STOP },
      registry,
    )
    for (const f of THREE) expect(isOutraged(step.state, f, 'Fuel')).toBe(true)
    // Only that resource.
    for (const f of THREE) expect(outragedResources(step.state, f)).toEqual(['Fuel'])
  })
})

describe('Populist Demands (bc27) — a free ambition declaration', () => {
  it('declares without zeroing any played card', () => {
    const base = fresh()
    const state = {
      ...putCard(base, 'bc27', CourtPile.discard()),
      ambitionable: [{ high: 5, low: 3 }],
      lead: { faction: 'red' as const, cardId: 'Aggression-4', suit: 'Aggression' as const, strength: 4, pips: 2, zeroed: false },
    }
    const step = advance(
      state,
      { type: 'vox/populist', faction: 'red', ambition: 'Tycoon', card: 'bc27', then: STOP },
      registry,
    )
    expect(step.state.declared.map((d) => d.ambition)).toContain('Tycoon')
    expect(step.state.ambitionable).toHaveLength(0)
    // Declaring off a *card* zeroes it; declaring off this Vox card must not.
    expect(step.state.lead?.zeroed).toBe(false)
  })

  it('does nothing when no markers are left', () => {
    const state = { ...putCard(fresh(), 'bc27', CourtPile.discard()), ambitionable: [] }
    const step = fire(state, 'bc27')
    expect(step.state.declared).toEqual([])
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc27')
  })
})

describe('Mass Uprising (bc26) — up to four ships in one cluster', () => {
  it('offers a cluster, then places one ship at a time within it', () => {
    const state = putCard(fresh(), 'bc26', CourtPile.discard())
    const c = fire(state, 'bc26').continue
    expect(labels(c).some((l) => /^Rise up in cluster \d+ \(4 ships\)/.test(l))).toBe(true)

    const cluster = Number(/cluster (\d+)/.exec(labels(c).find((l) => l.startsWith('Rise up'))!)![1])
    const chosen = advance(
      state,
      { type: 'vox/uprising', faction: 'red', cluster, left: 4, card: 'bc26', then: STOP },
      registry,
    )
    // Every option is a system of that cluster.
    const opts = labels(chosen.continue).filter((l) => l.startsWith('Place a ship'))
    expect(opts.length).toBeGreaterThan(0)
    for (const l of opts) expect(l).toMatch(new RegExp(`Place a ship in ${cluster}-`))
  })

  it('places a ship and decrements the budget', () => {
    const state = putCard(fresh(), 'bc26', CourtPile.discard())
    const system = state.board.systems[0]!
    const before = contentsOf(state.figures, Location.system(system)).filter((id) =>
      id.startsWith('red/Ship/'),
    ).length

    const step = advance(
      state,
      {
        type: 'vox/uprising-place',
        faction: 'red',
        cluster: Number(system.split('-')[0]),
        left: 4,
        system,
        card: 'bc26',
        then: STOP,
      },
      registry,
    )
    expect(
      contentsOf(step.state.figures, Location.system(system)).filter((id) => id.startsWith('red/Ship/')),
    ).toHaveLength(before + 1)
    expect(labels(step.continue).some((l) => /\(3 left\)/.test(l))).toBe(true)
  })
})

describe('Song of Freedom (bc29) — frees a city, and is buried not discarded', () => {
  /** Give red enough ships to rule its own starting system, which holds its city. */
  function ruled(state: GameState): { state: GameState; system: string; city: string } {
    const system = state.board.systems.find((s) =>
      contentsOf(state.figures, Location.system(s)).some((id) => id.startsWith('red/City/')),
    )!
    const city = contentsOf(state.figures, Location.system(system)).find((id) =>
      id.startsWith('red/City/'),
    )!
    return { state, system, city }
  }

  it('returns the city to its owner and buries the card in the deck', () => {
    const base = putCard(fresh(), 'bc29', CourtPile.discard())
    const { state, system, city } = ruled(base)
    const owner = parseFigureId(city).color
    const reserveBefore = contentsOf(state.figures, Location.reserve(owner)).length
    const deckBefore = contentsOf(state.courtCards, CourtPile.deck()).length

    const step = advance(
      state,
      { type: 'vox/free-city', faction: 'red', system, city, card: 'bc29', then: STOP },
      registry,
    )
    expect(contentsOf(step.state.figures, Location.system(system))).not.toContain(city)
    expect(contentsOf(step.state.figures, Location.reserve(owner))).toHaveLength(reserveBefore + 1)

    // The seize prompt only appears sometimes; when it does, decline it to reach disposal.
    let end = step
    const done =
      end.continue.kind === 'ask'
        ? end.continue.actions.find((a) => a.type === 'vox/done')
        : undefined
    if (done !== undefined) end = advance(end.state, done, registry)
    // Buried into the deck, not left in the discard.
    expect(contentsOf(end.state.courtCards, CourtPile.deck())).toContain('bc29')
    expect(contentsOf(end.state.courtCards, CourtPile.discard())).not.toContain('bc29')
    expect(contentsOf(end.state.courtCards, CourtPile.deck())).toHaveLength(deckBefore + 1)
  })

  it('offers the seize only when nobody has seized and you are not leading', () => {
    const base = putCard(fresh(), 'bc29', CourtPile.discard())
    const { state, system, city } = ruled(base)

    // red is first in initiative order at setup, so no seize is offered.
    const asLeader = advance(
      state,
      { type: 'vox/free-city', faction: 'red', system, city, card: 'bc29', then: STOP },
      registry,
    )
    expect(labels(asLeader.continue).join()).not.toMatch(/Seize/)

    // Rotate red out of the lead and it is offered.
    const behind = { ...state, initiativeOrder: ['yellow', 'blue', 'red'] as const }
    const offered = advance(
      behind as GameState,
      { type: 'vox/free-city', faction: 'red', system, city, card: 'bc29', then: STOP },
      registry,
    )
    expect(labels(offered.continue).join()).toMatch(/Seize/)
  })
})

describe('Guild Struggle (bc30) — steal, then recycle the discard', () => {
  it('moves a rival guild card into your pile', () => {
    let state = putCard(fresh(), 'bc30', CourtPile.discard())
    state = putCard(state, 'bc02', CourtPile.secured('yellow'))

    const step = advance(
      state,
      { type: 'vox/steal-guild', faction: 'red', from: 'yellow', stolen: 'bc02', card: 'bc30', then: STOP },
      registry,
    )
    expect(contentsOf(step.state.courtCards, CourtPile.secured('red'))).toContain('bc02')
    expect(contentsOf(step.state.courtCards, CourtPile.secured('yellow'))).not.toContain('bc02')
  })

  it('returns guild cards from the discard to the deck but leaves vox cards there', () => {
    let state = putCard(fresh(), 'bc30', CourtPile.discard())
    state = putCard(state, 'bc03', CourtPile.discard()) // a guild card in the discard
    state = putCard(state, 'bc02', CourtPile.secured('yellow'))

    const step = advance(
      state,
      { type: 'vox/steal-guild', faction: 'red', from: 'yellow', stolen: 'bc02', card: 'bc30', then: STOP },
      registry,
    )
    expect(contentsOf(step.state.courtCards, CourtPile.deck())).toContain('bc03')
    // bc30 is a Vox card: it stays out of the deck.
    expect(courtCard('bc30').kind).toBe('vox')
    expect(contentsOf(step.state.courtCards, CourtPile.deck())).not.toContain('bc30')
  })
})
