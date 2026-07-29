import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  contentsOf,
  defaultRegistry,
  move,
  parseFigureId,
  startGame,
  system,
} from '../src/index.js'
import type { Action, GameState, RuleResult } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

interface PlayRecord {
  turnKey: string
  faction: string
  /** figure id of the Starport that built, or the City that was taxed */
  subject: string
}

/**
 * A Starport builds at most one Ship per turn. Verified against haunt-roll-fail: the
 * build-ship option is disabled by `f.worked.count(b) > 0` ("built this turn",
 * game-common.scala:916), the starport is recorded with `f.worked :+= b` (:1019), and
 * `worked` is cleared in EndTurnAction (:2142). (The TTS mod only automates setup and
 * components, so it neither confirms nor contradicts this.)
 *
 * The bug this guards: Build was offered per *system*, so a faction with several pips could
 * build several Ships from one Starport in a single turn.
 */
describe('a Starport builds at most one Ship per turn', () => {
  const { builds, taxes, final } = playSeekingBuilds()

  it('exercises the rule (the run actually built ships)', () => {
    expect(builds.length).toBeGreaterThan(0)
    for (const b of builds) expect(b.subject).toBeTruthy()
  })

  it('never builds two Ships from the same Starport in one turn', () => {
    const seen = new Set<string>()
    for (const b of builds) {
      const key = `${b.turnKey}|${b.subject}`
      expect(seen.has(key), `starport ${b.subject} built twice in turn ${b.turnKey}`).toBe(false)
      seen.add(key)
    }
  })

  it('frees a Starport again on a later turn', () => {
    // Proves the per-turn set is actually cleared, rather than blocking forever.
    const turnsByStarport = new Map<string, Set<string>>()
    for (const b of builds) {
      const set = turnsByStarport.get(b.subject) ?? new Set<string>()
      set.add(b.turnKey)
      turnsByStarport.set(b.subject, set)
    }
    const reused = [...turnsByStarport.values()].some((turns) => turns.size > 1)
    expect(reused, 'no starport was used across two different turns').toBe(true)
  })

  it('conserves pieces — a faction never exceeds its 15 ships', () => {
    for (const f of THREE) expect(shipsOwned(final.state, f)).toBe(15)
  })
})

/**
 * A City is taxed at most once per turn — tracked per City, not per system. Eight of the
 * eighteen planets have two building slots, so a faction can hold two Cities in one system
 * and may tax each of them. HRF keeps `f.taxed.cities` as a list of city *figures*, offers
 * one option per city, and disables it with `.!(taxed.has(c), "taxed")`
 * (game-common.scala:730, recorded at :744, cleared at :2142); its separate `taxed.slots`
 * list is only for the campaign's empty-slot tax.
 *
 * The bug this guards: taxing was tracked by *system*, so taxing one City in a two-slot
 * planet also blocked the other.
 */
describe('a City is taxed at most once per turn', () => {
  const { taxes } = playSeekingBuilds()

  it('exercises the rule (the run actually taxed)', () => {
    expect(taxes.length).toBeGreaterThan(0)
    for (const t of taxes) expect(t.subject).toBeTruthy()
  })

  it('never taxes the same City twice in one turn', () => {
    const seen = new Set<string>()
    for (const t of taxes) {
      const key = `${t.turnKey}|${t.subject}`
      expect(seen.has(key), `city ${t.subject} taxed twice in turn ${t.turnKey}`).toBe(false)
      seen.add(key)
    }
  })

  it('frees a City to be taxed again on a later turn', () => {
    const turnsByCity = new Map<string, Set<string>>()
    for (const t of taxes) {
      const set = turnsByCity.get(t.subject) ?? new Set<string>()
      set.add(t.turnKey)
      turnsByCity.set(t.subject, set)
    }
    const reused = [...turnsByCity.values()].some((turns) => turns.size > 1)
    expect(reused, 'no city was taxed across two different turns').toBe(true)
  })

  it('offers a separate tax for each City a faction holds in one system', () => {
    // Build the two-cities-on-one-planet position directly, since it is rare in a random
    // playout, and check the menu lists one option per City rather than one per system.
    const start = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 }, registry)
    const twoSlotSystem = '3-Hex' // red's starting city sits here; the planet has 2 slots
    expect(system(twoSlotSystem).buildingSlots).toBe(2)

    const before = contentsOf(start.state.figures, Location.system(twoSlotSystem)).filter(
      (id) => parseFigureId(id).color === 'red' && parseFigureId(id).piece === 'City',
    )
    expect(before).toHaveLength(1)

    // Place a second red City on that planet.
    const spare = contentsOf(start.state.figures, Location.reserve('red')).find(
      (id) => parseFigureId(id).piece === 'City',
    )!
    const state = {
      ...start.state,
      figures: move(start.state.figures, spare, Location.system(twoSlotSystem)),
    }

    // Open the Tax menu for red.
    const then = { type: 'turn/pips', faction: 'red', suit: 'Administration', done: 0, total: 1 }
    const menu = advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then }, registry)
    if (menu.continue.kind !== 'ask') throw new Error('expected a Tax menu')

    const here = menu.continue.actions.filter(
      (a) => a.type === 'action/tax-city' && a['system'] === twoSlotSystem,
    )
    expect(here).toHaveLength(2)
    // ...and they name different Cities, so taxing one leaves the other available.
    expect(new Set(here.map((a) => a['city'] as string)).size).toBe(2)
  })
})

// --- driver ----------------------------------------------------------------

/**
 * Play a game preferring to build ships, recording every ship-build with the turn it
 * happened in. A turn is uniquely identified by (chapter, round, acting faction).
 */
function playSeekingBuilds(
  seed = 5,
  limit = 4000,
): { builds: PlayRecord[]; taxes: PlayRecord[]; final: RuleResult } {
  let step = startGame({ board: 'Board3MixUp', factions: THREE, seed }, registry)
  const builds: PlayRecord[] = []
  const taxes: PlayRecord[] = []

  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind !== 'ask') break

    const ship = c.actions.find((a) => a.type === 'action/build' && a['piece'] === 'Ship')
    const buildMenu = c.actions.find((a) => a['label'] === 'Build')
    const taxCity = c.actions.find((a) => a.type === 'action/tax-city')
    const taxMenu = c.actions.find((a) => a['label'] === 'Tax')
    const pick =
      ship ??
      buildMenu ??
      taxCity ??
      taxMenu ??
      c.actions.find((a) => a.type === 'turn/lead') ??
      c.actions.find((a) => a.type === 'ambition/skip-declare') ??
      c.actions.find((a) => a.type === 'turn/skip-seize') ??
      c.actions.find((a) => a.type === 'turn/surpass') ??
      c.actions.find((a) => a.type === 'turn/pivot') ??
      c.actions.find((a) => a.type === 'turn/end') ??
      c.actions.find((a) => a.type === 'turn/pass') ??
      c.actions[0]!

    const s = step.state
    const turnKey = (f: string) => `c${s.chapter}r${s.round}:${f}`
    if (pick === ship && ship !== undefined) {
      builds.push({
        turnKey: turnKey(ship['faction'] as string),
        faction: ship['faction'] as string,
        subject: ship['starport'] as string,
      })
    }
    if (pick === taxCity && taxCity !== undefined) {
      taxes.push({
        turnKey: turnKey(taxCity['faction'] as string),
        faction: taxCity['faction'] as string,
        subject: taxCity['city'] as string,
      })
    }
    step = advance(step.state, pick, registry)
  }
  return { builds, taxes, final: step }
}

function shipsOwned(state: GameState, faction: string): number {
  const onBoard = state.board.systems.reduce(
    (n, s) =>
      n +
      contentsOf(state.figures, Location.system(s)).filter((id) => {
        const f = parseFigureId(id)
        return f.color === faction && f.piece === 'Ship'
      }).length,
    0,
  )
  const inReserve = contentsOf(state.figures, Location.reserve(faction as never)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  ).length
  const trophies = state.factions.reduce(
    (n, f) =>
      n +
      contentsOf(state.figures, Location.trophies(f)).filter((id) => {
        const p = parseFigureId(id)
        return p.color === faction && p.piece === 'Ship'
      }).length,
    0,
  )
  return onBoard + inReserve + trophies
}

// keep the Action type import meaningful
export type _A = Action
