import { describe, expect, it } from 'vitest'

import {
  move,
  system as systemInfo,
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

describe('Call to Action (bc31) — draw from the bottom of the action discard', () => {
  /*
   * "Draw 1 action card from the bottom of the action discard pile." This test used to assert a
   * draw from the DECK — the docs/20 A5 defect pinned as if it were the rule. The discard's
   * bottom is the pile's oldest entry, which is what makes the draw knowable rather than random.
   */
  it('moves the oldest discarded card to your hand, then discards itself', () => {
    let state = putCard(fresh(), 'bc31', CourtPile.discard())
    // Seed a known discard: two hand cards discarded in order — the FIRST is the bottom.
    const hand = contentsOf(state.cards, CardLocation.hand('yellow'))
    const bottom = hand[0]!
    const top = hand[1]!
    let cards = move(state.cards, bottom, CardLocation.discard())
    cards = move(cards, top, CardLocation.discard())
    state = { ...state, cards }
    const handBefore = contentsOf(state.cards, CardLocation.hand('red')).length
    const deckBefore = contentsOf(state.cards, CardLocation.deck()).length

    const step = fire(state, 'bc31')
    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).toContain(bottom)
    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).toHaveLength(handBefore + 1)
    // The deck is untouched — the old behaviour drew from it.
    expect(contentsOf(step.state.cards, CardLocation.deck())).toHaveLength(deckBefore)
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc31')
  })

  it('draws nothing when the action discard is empty', () => {
    const state = putCard(fresh(), 'bc31', CourtPile.discard())
    const handBefore = contentsOf(state.cards, CardLocation.hand('red')).length
    const step = fire(state, 'bc31')
    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).toHaveLength(handBefore)
    expect(step.state.log.some((l) => /discard is empty/.test(l))).toBe(true)
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

describe('Mass Uprising (bc26) — one ship in each system of a cluster', () => {
  /*
   * "Choose a cluster on the map. You place 1 ship in each system of that cluster."
   *
   * A divergence from HRF, which enumerates combinations of systems as though four ships were a
   * budget to spend where you liked. That allows two ships in one system and none in another,
   * which the card forbids, and asks a question the card never asks. These tests assert the
   * printed rule.
   */
  const clusterOf = (s: GameState, n: number): string[] =>
    s.board.systems.filter((id) => systemInfo(id).cluster === n)

  it('fills every system of the cluster, one each, without asking which', () => {
    const state = putCard(fresh(), 'bc26', CourtPile.discard())
    const c = fire(state, 'bc26').continue
    const label = labels(c).find((l) => l.startsWith('Rise up'))!
    const cluster = Number(/cluster (\d+)/.exec(label)![1])
    const systems = clusterOf(state, cluster)
    expect(systems.length).toBeGreaterThan(1)
    // With a full reserve the label promises one per system rather than a budget.
    expect(label).toContain(`1 ship in each of ${systems.length} systems`)

    const before = new Map(
      systems.map((id) => [
        id,
        contentsOf(state.figures, Location.system(id)).filter((f) => f.startsWith('red/Ship/'))
          .length,
      ]),
    )
    let r = advance(
      state,
      { type: 'vox/uprising', faction: 'red', cluster, left: systems.length, card: 'bc26', then: STOP },
      registry,
    )
    /*
     * No *decision* is offered while the reserve can fill the cluster — asserted directly, because
     * checking only the final board passes either way: a version that asks which system each time
     * still ends up filling them all if the test answers every prompt.
     */
    let guard = 0
    while (r.continue.kind === 'ask' && guard++ < 10) {
      const places = r.continue.actions.filter((a) => a.type === 'vox/uprising-place')
      if (places.length === 0) break
      expect(places.length).toBe(1)
      r = advance(r.state, places[0]!, registry)
    }
    for (const id of systems) {
      const now = contentsOf(r.state.figures, Location.system(id)).filter((f) =>
        f.startsWith('red/Ship/'),
      ).length
      expect(now).toBe((before.get(id) ?? 0) + 1)
    }
  })

  it('never puts two ships in the same system', () => {
    const state = putCard(fresh(), 'bc26', CourtPile.discard())
    const cluster = systemInfo(state.board.systems[0]!).cluster
    const systems = clusterOf(state, cluster)
    const first = systems[0]!

    const step = advance(
      state,
      {
        type: 'vox/uprising-place',
        faction: 'red',
        cluster,
        left: systems.length,
        system: first,
        placed: [],
        card: 'bc26',
        then: STOP,
      },
      registry,
    )
    // Whatever comes next, the system just filled is no longer on offer.
    if (step.continue.kind === 'ask') {
      const offered = step.continue.actions
        .filter((a) => a.type === 'vox/uprising-place')
        .map((a) => a['system'])
      expect(offered).not.toContain(first)
    }
    const next = step.continue
    expect(JSON.stringify(next)).not.toContain(`"system":"${first}"`)
  })

  it('asks which systems only when the reserve cannot fill the cluster', () => {
    const base = putCard(fresh(), 'bc26', CourtPile.discard())
    const cluster = systemInfo(base.board.systems[0]!).cluster
    const systems = clusterOf(base, cluster)

    // Strip red's reserve to one ship, so a genuine choice exists.
    const reserve = contentsOf(base.figures, `reserve:red`).filter((id) =>
      id.startsWith('red/Ship/'),
    )
    const contents = new Map(base.figures.contents)
    const at = new Map(base.figures.at)
    const keep = reserve.slice(0, 1)
    contents.set('reserve:red', [
      ...(contents.get('reserve:red') ?? []).filter((id) => !reserve.includes(id)),
      ...keep,
    ])
    for (const id of reserve.slice(1)) at.delete(id)
    const short: GameState = { ...base, figures: { ...base.figures, contents, at } }

    const r = advance(
      short,
      { type: 'vox/uprising', faction: 'red', cluster, left: 1, card: 'bc26', then: STOP },
      registry,
    )
    expect(r.continue.kind).toBe('ask')
    if (r.continue.kind === 'ask') {
      const offered = r.continue.actions.filter((a) => a.type === 'vox/uprising-place')
      expect(offered.length).toBe(systems.length)
    }
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
