/**
 * The shipped bot does not walk in circles.
 *
 * Movement was tie-broken by offer order (no feature reads ship positions), which walked fleets
 * A -> B -> A at 14% of all moves. `moveReversal` is the fix; this drives real games and counts
 * the exact waste the report named: a leg reversing one the same faction made this round. The
 * contrast case pins that the term, not luck, is what does it.
 *
 * A catapult continuation is a leg too. Seed 1 here reversed two of them before the move memory
 * recorded them, and a four-player game bounced a ship between two gates until `runBots` gave up
 * (the last block).
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  NO_ASKS,
  advance,
  botToAct,
  defaultRegistry,
  locationOf,
  mobileBot,
  standardBot,
  startGame,
  stepBot,
} from '../src/index.js'
import type { Action, Bot, FactionId, GameState, RuleResult, SystemId } from '../src/index.js'

const registry = defaultRegistry()
const TWO: readonly FactionId[] = ['red', 'yellow']

/** A Move's leg, or a catapult continuation's — whose origin is where the moving group stands. */
function legOf(state: GameState, a: Action): { from: string; to: string } | undefined {
  if (a.type === 'action/move-pick') return { from: String(a['from']), to: String(a['to']) }
  if (a.type !== 'action/move-more') return undefined
  const at = locationOf(state.figures, (a['group'] as readonly string[])[0]!) ?? ''
  return { from: at.slice('system:'.length), to: String(a['to']) }
}

/** Same-round A->B->A reversals over one driven game. */
function reversals(bot: Bot, seed: number, steps = 700): { moves: number; reversals: number } {
  let cur: RuleResult = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed }, registry)
  let asked = NO_ASKS
  let round = cur.state.round
  const legs = new Map<string, Set<string>>()
  let moves = 0
  let undone = 0
  for (let i = 0; i < steps && cur.continue.kind === 'ask'; i++) {
    const f = botToAct(cur, TWO)
    if (f === undefined) break
    const s = stepBot(cur, bot, f, registry, asked)
    const a = s.decision.action
    if (cur.state.round !== round) {
      round = cur.state.round
      legs.clear()
    }
    const leg = legOf(cur.state, a)
    if (leg !== undefined) {
      moves++
      const set = legs.get(f) ?? new Set()
      if (set.has(`${leg.to}->${leg.from}`)) undone++
      set.add(`${leg.from}->${leg.to}`)
      legs.set(f, set)
    }
    cur = s.result
    asked = s.asked
  }
  return { moves, reversals: undone }
}

describe('purposeful movement', () => {
  it('the shipped bot never reverses its own leg within a round', () => {
    for (const seed of [1, 5, 9]) {
      const r = reversals(mobileBot, seed)
      expect(r.moves, `seed ${seed} actually moved`).toBeGreaterThan(0)
      expect(r.reversals, `seed ${seed}`).toBe(0)
    }
  })

  it('and the contrast holds: without the term, the same games do circle', () => {
    // Not vacuous — the old bot reverses on these seeds, so the zero above is the term working.
    const total = [1, 5, 9].reduce((n, seed) => n + reversals(standardBot, seed).reversals, 0)
    expect(total).toBeGreaterThan(0)
  })
})

describe('a catapult chain cannot bounce between two gates', () => {
  /*
   * Four-player seed 77 on Board4MixUp1 (arena game #305), rebuilt. White is on the last pip of a
   * Mobilization turn with Battle bought by a Weapon, and launches one ship onto the gate ring at
   * 1-Gate. 4-Gate holds two red and two blue ships: nobody rules it, so the chain runs through, and
   * arriving there opens a battle (`battleUnlocked`). Staying in the chain beats "Stop here" by the
   * phantom pip, 2-Gate to 4-Gate gains the battle, and 4-Gate to 2-Gate wins its tie on offer
   * order — and the ship did that until `runBots` gave up at 20,000 decisions. The prompt-repeat
   * guard cannot see it, because 4-Gate to 2-Gate lands on an earlier prompt.
   *
   * Built rather than played into: reaching decision 795 of that game takes its search seat half a
   * minute, and the bounce needs only the ring, the contested gate and the last pip.
   */
  const FOUR: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']
  const RING: readonly SystemId[] = ['1-Gate', '2-Gate', '4-Gate', '5-Gate', '6-Gate']

  function relocate(state: GameState, ids: readonly string[], to: string): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    for (const id of ids) {
      const from = at.get(id)!
      contents.set(from, contents.get(from)!.filter((x) => x !== id))
      contents.set(to, [...(contents.get(to) ?? []), id])
      at.set(id, to)
    }
    return { ...state, figures: { ...state.figures, contents, at } }
  }
  const reserve = (id: string): string => `reserve:${id.slice(0, id.indexOf('/'))}`
  const onMap = (state: GameState, test: (id: string) => boolean): string[] =>
    state.board.systems.flatMap((s) => (state.figures.contents.get(Location.system(s)) ?? []).filter(test))
  function place(state: GameState, color: string, system: SystemId, n: number): GameState {
    const spare = (state.figures.contents.get(`reserve:${color}`) ?? [])
      .filter((id) => id.startsWith(`${color}/Ship/`))
      .slice(0, n)
    return relocate(state, spare, Location.system(system))
  }

  function launched(): RuleResult {
    let s = startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed: 77 }, registry).state
    // White's one ship is the only one on the map, so no battle opens anywhere but 4-Gate.
    s = relocate(s, onMap(s, (id) => id.startsWith('white/Ship/')), 'reserve:white')
    for (const gate of RING) {
      const here = s.figures.contents.get(Location.system(gate)) ?? []
      for (const id of here) s = relocate(s, [id], reserve(id))
    }
    s = place(place(s, 'red', '4-Gate', 2), 'blue', '4-Gate', 2)
    s = place(s, 'white', '1-Arrow', 1)
    s = { ...s, current: 'white', anyBattle: true }
    const group = onMap(s, (id) => id.startsWith('white/Ship/'))
    const then = { type: 'turn/pips', faction: 'white', suit: 'Mobilization', done: 2, total: 2 }
    const go = { type: 'action/move-more-go', faction: 'white', to: '1-Gate', group, count: 1, then }
    return advance(s, go, registry)
  }

  const catapulting = (r: RuleResult): boolean =>
    r.continue.kind === 'ask' && r.continue.actions.some((a) => a.type === 'action/move-more')

  /** Drive the chain for at most `cap` decisions; the legs it took and whether it is still going. */
  function drive(bot: Bot, cap = 40): { legs: string[]; undone: number; going: boolean } {
    let cur = launched()
    let asked = NO_ASKS
    const legs: string[] = []
    let undone = 0
    for (let i = 0; i < cap && catapulting(cur); i++) {
      const step = stepBot(cur, bot, 'white', registry, asked)
      const leg = legOf(cur.state, step.decision.action)
      if (leg !== undefined) {
        if (legs.includes(`${leg.to}->${leg.from}`)) undone++
        legs.push(`${leg.from}->${leg.to}`)
      }
      cur = step.result
      asked = step.asked
    }
    return { legs, undone, going: catapulting(cur) }
  }

  it('the shipped bot ends the chain without undoing a leg', () => {
    const r = drive(mobileBot)
    expect(r.going, r.legs.join(' ')).toBe(false)
    expect(r.undone, r.legs.join(' ')).toBe(0)
  })

  it('and the position does bounce without the reversal term', () => {
    // Not vacuous: the same chain under `standardBot` is still going at the cap.
    const r = drive(standardBot)
    expect(r.going).toBe(true)
    expect(new Set(r.legs.slice(1))).toEqual(new Set(['2-Gate->4-Gate', '4-Gate->2-Gate']))
  })
})
