/**
 * The two-player game.
 *
 * Every rule here is one the base rulebook states only for 2 players (pages 4, 5 and 19), so each
 * case pairs with a 3- or 4-player assertion showing the rule does *not* leak upward. That pairing
 * is the point: the ways this could go wrong are "2p is wrong" and "2p broke everyone else", and
 * only the second is invisible in a 2-player game.
 *
 * The board data itself is sourced and cross-checked in `scripts/build_board_topology.py`; what is
 * tested here is that the engine plays it.
 */

import { describe, expect, it } from 'vitest'

import {
  AMBITIONS,
  CardLocation,
  Location,
  ScoreAmbitions,
  advance,
  applyExternal,
  board,
  boardsFor,
  contentsOf,
  courtSize,
  courtSlots,
  defaultRegistry,
  metric,
  phantomHolding,
  replayGame,
  startGame,
} from '../src/index.js'
import type { Ambition, Continue, FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const TWO = ['red', 'yellow'] as const
const BOARDS_2P = ['Board2Frontiers', 'Board2Homelands', 'Board2MixUp1', 'Board2MixUp2'] as const

const opts = (name: string, seed = 9) =>
  ({ board: name, factions: [...TWO], seed }) as Parameters<typeof startGame>[0]

const phantomView = (name: string, factions: readonly string[]) =>
  ({ board: board(name), factions }) as never

describe('the out-of-play resources, as a third player', () => {
  /*
   * Setup K puts six tokens on the ambition boxes — one per covered planet — and p19 scores them
   * as if a third player held them. Six is the number to hold onto: it is what makes "the planets
   * of the two out-of-play clusters" and "6 resource tokens" the same statement.
   */
  it('holds exactly the six resources of the covered planets', () => {
    for (const name of BOARDS_2P) {
      const view = phantomView(name, TWO)
      const total = AMBITIONS.reduce((n, a) => n + phantomHolding(view, a), 0)
      expect(total, `${name} phantom total`).toBe(6)
    }
  })

  it('never holds captives, because no resource stands in for Tyrant', () => {
    for (const name of BOARDS_2P) {
      expect(phantomHolding(phantomView(name, TWO), 'Tyrant'), name).toBe(0)
    }
  })

  it('maps each resource to the box the rulebook prints', () => {
    // Frontiers covers clusters 1 and 6: Weapon/Fuel/Material and Material/Fuel/Psionic.
    const view = phantomView('Board2Frontiers', TWO)
    expect(phantomHolding(view, 'Tycoon')).toBe(4) // 2 Material + 2 Fuel
    expect(phantomHolding(view, 'Warlord')).toBe(1) // 1 Weapon
    expect(phantomHolding(view, 'Empath')).toBe(1) // 1 Psionic
    expect(phantomHolding(view, 'Keeper')).toBe(0) // no Relic is covered
  })

  /*
   * The containment check. Three players also cover two clusters, so a phantom that keyed off the
   * board rather than the player count would silently rewrite every 3-player ambition.
   */
  it('is absent above two players', () => {
    for (const [name, factions] of [
      ['Board3Frontiers', ['red', 'yellow', 'blue']],
      ['Board4MixUp1', ['red', 'yellow', 'blue', 'white']],
    ] as const) {
      for (const a of AMBITIONS) {
        expect(phantomHolding(phantomView(name, factions), a), `${name} ${a}`).toBe(0)
      }
    }
  })
})

describe('scoring against the phantom', () => {
  /** A 2-player game with `ambition` declared and nothing else going on. */
  const declaring = (state: GameState, ambition: Ambition): GameState => ({
    ...state,
    declared: [{ ambition, marker: { high: 4, low: 2 } }],
  })

  /** Give `faction` `n` trophies, so Warlord has something real to compare against. */
  function withTrophies(state: GameState, faction: FactionId, n: number): GameState {
    const taken = contentsOf(state.figures, Location.reserve(faction === 'red' ? 'yellow' : 'red'))
      .filter((id) => id.includes('/Ship/'))
      .slice(0, n)
    expect(taken).toHaveLength(n)
    return taken.reduce(
      (s, id) => ({
        ...s,
        figures: { ...s.figures, ...moveTo(s, id, Location.trophies(faction)) },
      }),
      state,
    )
  }
  const moveTo = (s: GameState, id: string, to: string) => {
    const contents = new Map(s.figures.contents)
    const at = new Map(s.figures.at)
    const from = at.get(id)!
    contents.set(from, (contents.get(from) ?? []).filter((x) => x !== id))
    contents.set(to, [...(contents.get(to) ?? []), id])
    at.set(id, to)
    return { contents, at }
  }

  it('lets the phantom take first place, denying the high value to a real player', () => {
    /*
     * Frontiers puts a single Weapon on Warlord. A player holding *one* trophy therefore ties it
     * rather than beating it, and a tie for first pays the low value — so this is the difference
     * between 4 power and 2, caused entirely by a pile of tokens.
     */
    const base = startGame(opts('Board2Frontiers'), registry).state
    expect(phantomHolding(base as never, 'Warlord')).toBe(1)

    const oneEach = withTrophies(base, 'red', 1)
    const tied = advance(declaring(oneEach, 'Warlord'), ScoreAmbitions(), registry)
    expect(tied.state.power['red'] ?? 0, 'tying the phantom pays the low value').toBe(2)

    // Beating it outright pays the high value, which shows the tie above was the phantom's doing.
    const two = withTrophies(base, 'red', 2)
    const won = advance(declaring(two, 'Warlord'), ScoreAmbitions(), registry)
    expect(won.state.power['red'] ?? 0, 'beating the phantom pays the high value').toBe(4)
  })

  it('never gains power itself', () => {
    // Tycoon on Frontiers is a phantom 4 against two players holding their two starting resources.
    const base = startGame(opts('Board2Frontiers'), registry).state
    const after = advance(declaring(base, 'Tycoon'), ScoreAmbitions(), registry)
    const awarded = TWO.reduce((n, f) => n + (after.state.power[f] ?? 0), 0)
    // Whatever the humans got, no power vanished into a third seat: only the two factions exist.
    expect(Object.keys(after.state.power).sort()).toEqual([...TWO].sort())
    expect(awarded).toBeGreaterThanOrEqual(0)
  })

  it('cannot place in Tyrant, so captives stay a two-way race', () => {
    const base = startGame(opts('Board2Frontiers'), registry).state
    const after = advance(declaring(base, 'Tyrant'), ScoreAmbitions(), registry)
    // Nobody has captives at setup and the phantom holds none either, so nothing scores.
    expect(after.state.power['red'] ?? 0).toBe(0)
    expect(after.state.power['yellow'] ?? 0).toBe(0)
  })
})

describe('the court row', () => {
  it('is three cards at two players and four otherwise', () => {
    expect(courtSize(2)).toBe(3)
    expect(courtSize(3)).toBe(4)
    expect(courtSize(4)).toBe(4)
    expect(courtSlots(2)).toEqual([1, 2, 3])
    expect(courtSlots(4)).toEqual([1, 2, 3, 4])
  })

  it('deals exactly that many face-up cards at setup', () => {
    const two = startGame(opts('Board2Frontiers'), registry).state
    const filled = (s: GameState, n: number) =>
      courtSlots(n).filter((i) => contentsOf(s.courtCards, CourtPileSlot(i)).length > 0).length
    expect(filled(two, 2)).toBe(3)
    /*
     * A fourth slot is not merely empty at two players — it is never registered, so reading it
     * throws. That is the stronger property and the one worth pinning: an empty-but-present slot
     * would let a stray Influence put an agent somewhere the physical game has no card.
     */
    expect(two.courtCards.contents.has(CourtPileSlot(4))).toBe(false)
    expect(() => contentsOf(two.courtCards, CourtPileSlot(4))).toThrow('not registered')

    const three = startGame(
      { board: 'Board3Frontiers', factions: ['red', 'yellow', 'blue'], seed: 9 } as never,
      registry,
    ).state
    expect(filled(three, 3)).toBe(4)
  })
})

/** `CourtPile.slot` without importing the whole namespace into the assertions above. */
const CourtPileSlot = (n: number): string => `court:slot:${n}`

/** The actions on offer, or none when the engine is not asking. */
const offered = (r: RuleResult): readonly { type: string }[] =>
  r.continue.kind === 'ask' ? (r.continue.actions as { type: string }[]) : []

describe('the mulligan', () => {
  const handOf = (r: RuleResult, f: string) =>
    [...contentsOf(r.state.cards, CardLocation.hand(f as FactionId))].sort()

  it('is offered to the player without initiative, and only at two players', () => {
    const two = startGame(opts('Board2Frontiers'), registry)
    const ask = two.continue as Continue & { kind: 'ask'; faction: FactionId; actions: unknown[] }
    expect(ask.kind).toBe('ask')
    // Red holds the initiative at setup, so the offer belongs to yellow.
    expect(two.state.initiativeOrder[0]).toBe('red')
    expect(ask.faction).toBe('yellow')
    expect((ask.actions as { type: string }[]).map((a) => a.type)).toEqual([
      'turn/mulligan',
      'turn/keep-hand',
    ])

    const three = startGame(
      { board: 'Board3Frontiers', factions: ['red', 'yellow', 'blue'], seed: 9 } as never,
      registry,
    )
    const offered = ((three.continue as { actions?: { type: string }[] }).actions ?? []).map(
      (a) => a.type,
    )
    expect(offered).not.toContain('turn/mulligan')
  })

  it('replaces the whole hand rather than topping it up', () => {
    const before = startGame(opts('Board2Frontiers'), registry)
    const mulligan = offered(before).find((a) => a.type === 'turn/mulligan')!
    const was = handOf(before, 'yellow')

    const after = applyExternal(before, mulligan as never, registry)
    const now = handOf(after, 'yellow')

    expect(now).toHaveLength(6)
    /*
     * The new six come from the action discard, which holds the chapter's 8 undealt cards plus
     * the 6 just returned (docs/22: the remainder is discarded at setup, then shuffled). With 14
     * to draw from, some of the old six MAY come back — what the rule forbids is topping up,
     * not coincidence — so the pin is the count and that the discard holds exactly the rest.
     */
    expect(contentsOf(after.state.cards, CardLocation.discard())).toHaveLength(8)
    expect(contentsOf(after.state.cards, CardLocation.deck())).toHaveLength(0)
    expect(new Set([...now, ...contentsOf(after.state.cards, CardLocation.discard())]).size).toBe(14)
    // The other player is untouched.
    expect(handOf(after, 'red')).toEqual(handOf(before, 'red'))
  })

  it('replays to the same hand, so a mulligan survives save and undo', () => {
    const before = startGame(opts('Board2Frontiers'), registry)
    const mulligan = offered(before).find((a) => a.type === 'turn/mulligan')!
    const after = applyExternal(before, mulligan as never, registry)
    const replayed = replayGame(opts('Board2Frontiers'), after.state.journal, registry)
    expect(handOf(replayed, 'yellow')).toEqual(handOf(after, 'yellow'))
    expect(replayed.state.journal).toEqual(after.state.journal)
  })

  it('keeps the hand when declined', () => {
    const before = startGame(opts('Board2Frontiers'), registry)
    const keep = offered(before).find((a) => a.type === 'turn/keep-hand')!
    const after = applyExternal(before, keep as never, registry)
    expect(handOf(after, 'yellow')).toEqual(handOf(before, 'yellow'))
    // The discard still holds only the chapter's 8 undealt cards (docs/22) — nothing was returned.
    expect(contentsOf(after.state.cards, CardLocation.discard())).toHaveLength(8)
  })
})

describe('two-player setup', () => {
  it('offers all four printed boards', () => {
    expect(boardsFor(2).map((b) => b.name).sort()).toEqual([...BOARDS_2P].sort())
  })

  /*
   * Setup N: at two players the "2 ships" position is two systems, not one. This is the rule the
   * data carries entirely — `seatFaction` already loops over fleet systems — so the check is that
   * the board really names two and both really get ships.
   */
  it('seeds two ships in each of two fleet systems per seat', () => {
    for (const name of BOARDS_2P) {
      const v = board(name)
      const state = startGame(opts(name), registry).state
      for (const [seat, [, , fleets]] of v.starting.entries()) {
        const faction = TWO[seat]!
        expect(fleets, `${name} seat ${seat + 1}`).toHaveLength(2)
        for (const sys of fleets) {
          const mine = contentsOf(state.figures, Location.system(sys)).filter((id) =>
            id.startsWith(`${faction}/`),
          )
          expect(mine, `${name}: ${faction} at ${sys}`).toHaveLength(2)
        }
      }
    }
  })

  it('ends the game at 33 power, not 30 or 27', () => {
    // The threshold is `39 - players * 3`; asserted through a real game rather than the formula.
    const state = startGame(opts('Board2Frontiers'), registry).state
    const nearly: GameState = { ...state, power: { red: 32, yellow: 0 } }
    expect(advance(nearly, ScoreAmbitions(), registry).state.isOver).toBe(false)
    const over: GameState = { ...state, power: { red: 33, yellow: 0 } }
    expect(advance(over, ScoreAmbitions(), registry).state.isOver).toBe(true)
  })
})
