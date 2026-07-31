/**
 * Ruling a system.
 *
 * "You control a system and its contents if you have more fresh ships there than each Rival."
 * Damaged ships do not count, and buildings never did.
 *
 * This has its own file because ruling is consulted by eight separate features — taxing your own
 * and rivals' cities, building, gate builds, the Gate Ports toll, the catapult, Tool Priests and
 * a vox card — and it was wrong for all of them: `ruleValue` counted damaged ships, so a wrecked
 * fleet kept ruling. The whole suite passed before the fix and after it, which is the reason these
 * tests exist.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  connectedSystems,
  system as systemInfo,
  contentsOf,
  defaultRegistry,
  rules,
  ruleValue,
  startGame,
} from '../src/index.js'
import type { GameState, SystemId } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

function clearSystem(state: GameState, system: SystemId): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const dest = Location.system(system)
  for (const id of contents.get(dest) ?? []) {
    const color = id.slice(0, id.indexOf('/'))
    contents.set(`reserve:${color}`, [...(contents.get(`reserve:${color}`) ?? []), id])
    at.set(id, `reserve:${color}`)
  }
  contents.set(dest, [])
  return { ...state, figures: { ...state.figures, contents, at } }
}

function place(state: GameState, color: string, system: SystemId, piece: string, n: number): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const reserve = `reserve:${color}`
  const dest = Location.system(system)
  const moved = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`${color}/${piece}/`)).slice(0, n)
  contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !moved.includes(id)))
  contents.set(dest, [...(contents.get(dest) ?? []), ...moved])
  for (const id of moved) at.set(id, dest)
  return { ...state, figures: { ...state.figures, contents, at } }
}

function damage(state: GameState, color: string, system: SystemId, piece: string, n: number): GameState {
  const here = contentsOf(state.figures, Location.system(system))
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  return { ...state, damaged: [...state.damaged, ...here] }
}

/** An empty system with the given fleets in it. */
function field(redShips: number, yellowShips: number) {
  const base = fresh()
  const system = base.board.systems[0]!
  let s = clearSystem(base, system)
  s = place(s, 'red', system, 'Ship', redShips)
  s = place(s, 'yellow', system, 'Ship', yellowShips)
  return { state: s, system }
}

describe('ruleValue counts fresh ships, and only fresh ships', () => {
  it('counts undamaged ships', () => {
    const { state, system } = field(3, 0)
    expect(ruleValue(state, 'red', system)).toBe(3)
  })

  it('does not count damaged ones', () => {
    const { state, system } = field(3, 0)
    expect(ruleValue(damage(state, 'red', system, 'Ship', 2), 'red', system)).toBe(1)
    expect(ruleValue(damage(state, 'red', system, 'Ship', 3), 'red', system)).toBe(0)
  })

  it('does not count buildings — a city gives no claim on the space around it', () => {
    const { state, system } = field(0, 0)
    const withCity = place(place(state, 'red', system, 'City', 1), 'red', system, 'Starport', 1)
    expect(ruleValue(withCity, 'red', system)).toBe(0)
    expect(rules(withCity, 'red', system)).toBe(false)
  })
})

describe('ruling compares fresh fleets', () => {
  it('the larger fresh fleet rules', () => {
    const { state, system } = field(3, 2)
    expect(rules(state, 'red', system)).toBe(true)
    expect(rules(state, 'yellow', system)).toBe(false)
  })

  it('a tie rules for nobody — it must be *more* than each rival', () => {
    const { state, system } = field(2, 2)
    expect(rules(state, 'red', system)).toBe(false)
    expect(rules(state, 'yellow', system)).toBe(false)
  })

  it('a wrecked fleet loses the system to a smaller fresh one', () => {
    const { state, system } = field(3, 2)
    const wrecked = damage(state, 'red', system, 'Ship', 3)
    expect(rules(wrecked, 'red', system)).toBe(false)
    expect(rules(wrecked, 'yellow', system)).toBe(true)
  })

  it('damaging one ship can hand over a system it was holding by one', () => {
    const { state, system } = field(3, 2)
    expect(rules(state, 'red', system)).toBe(true)
    const hurt = damage(state, 'red', system, 'Ship', 1)
    // 2 fresh v 2 fresh — red no longer rules, and neither does yellow
    expect(rules(hurt, 'red', system)).toBe(false)
    expect(rules(hurt, 'yellow', system)).toBe(false)
  })
})

describe('what ruling gates, now that damage counts against it', () => {
  const STOP = { type: 'turn/lead-main', faction: 'red' } as const

  function taxOffers(state: GameState, system: SystemId): number {
    const c = advance(
      state,
      { type: 'action/take', faction: 'red', action: 'Tax', then: STOP },
      registry,
    ).continue
    if (c.kind !== 'ask') return 0
    return c.actions.filter((a) => a.type === 'action/tax-city' && a['system'] === system).length
  }

  it('a wrecked fleet can no longer tax the rival city it was sitting on', () => {
    const { state, system } = field(4, 1)
    const withCity = place(state, 'yellow', system, 'City', 1)
    expect(taxOffers(withCity, system)).toBe(1)

    const wrecked = damage(withCity, 'red', system, 'Ship', 4)
    expect(rules(wrecked, 'red', system)).toBe(false)
    expect(taxOffers(wrecked, system)).toBe(0)
  })

  it('a wrecked fleet can no longer build there', () => {
    const { state, system } = field(4, 1)
    const buildable = (st: GameState): boolean => {
      const c = advance(
        st,
        { type: 'action/take', faction: 'red', action: 'Build', then: STOP },
        registry,
      ).continue
      return c.kind === 'ask' && c.actions.some((a) => a['system'] === system && a.type === 'action/build')
    }
    expect(buildable(state)).toBe(true)
    expect(buildable(damage(state, 'red', system, 'Ship', 4))).toBe(false)
  })
})

describe('the catapult stops where the rules say it must', () => {
  /*
   * Reported from play: ships catapulted straight through a gate held by two fresh enemy ships.
   *
   * The FAQ: a catapult must stop at "a gate controlled by a Rival **(counted just before your
   * ships move in)**". That parenthetical is the whole rule here. `performMoveMoreGo` tested it
   * *after* the move, so the arriving ships counted toward ruling — move three into a gate a rival
   * holds with two, and you now rule it, so nothing appeared to be blocking and the chain ran on.
   *
   * Asserted through `action/move-more-go`, the continuation step itself, because that is where the
   * timing lives; going through a whole Move would test the opening leg's separate check.
   */
  const gateWith = (enemyShips: number, damagedShips = 0) => {
    const base = fresh()
    const gate = base.board.systems.find((id) => systemInfo(id).isGate)!
    let s = clearSystem(base, gate)
    if (enemyShips > 0) s = place(s, 'yellow', gate, 'Ship', enemyShips)
    if (damagedShips > 0) {
      s = place(s, 'yellow', gate, 'Ship', damagedShips)
      s = damage(s, 'yellow', gate, 'Ship', damagedShips)
    }
    // Red's ships are mid-catapult, sitting in an adjacent system.
    const prev = connectedSystems(base.board, gate)[0]!
    s = place(clearSystem(s, prev), 'red', prev, 'Ship', 3)
    const group = contentsOf(s.figures, Location.system(prev)).filter((id) =>
      id.startsWith('red/Ship/'),
    )
    return { state: s, gate, group }
  }

  const continueInto = (setup: ReturnType<typeof gateWith>) =>
    advance(
      setup.state,
      {
        type: 'action/move-more-go',
        faction: 'red',
        to: setup.gate,
        group: setup.group,
        count: 3,
        then: { type: 'turn/lead-main', faction: 'red' },
      },
      registry,
    )

  /*
   * Whether the *catapult* is still live, not whether anything at all is being asked. `then` is the
   * ordinary turn, which asks its own questions either way — so checking `continue.kind` alone
   * passes in both directions and proves nothing.
   */
  const stillCatapulting = (c: ReturnType<typeof continueInto>['continue']): boolean =>
    c.kind === 'ask' && c.actions.some((a) => a.type === 'action/move-more')

  it('stops at a gate a rival rules, even once your ships outnumber theirs', () => {
    const setup = gateWith(2)
    const out = continueInto(setup)
    // Three red land on two yellow, so red rules it *now* — and must still stop.
    expect(
      contentsOf(out.state.figures, Location.system(setup.gate)).filter((id) =>
        id.startsWith('red/Ship/'),
      ).length,
    ).toBe(3)
    expect(stillCatapulting(out.continue)).toBe(false)
  })

  it('carries on through a gate holding only damaged enemy ships', () => {
    // Damaged ships rule nothing, so this never blocked — kept so the fix cannot overshoot into
    // "any enemy ship stops you".
    expect(stillCatapulting(continueInto(gateWith(0, 2)).continue)).toBe(true)
  })

  it('carries on through an empty gate', () => {
    expect(stillCatapulting(continueInto(gateWith(0)).continue)).toBe(true)
  })
})
