/**
 * Taxing, and the case that gets reported as "it gave me nothing".
 *
 * Written after exactly that report about taxing a **rival's** city. The engine turned out to be
 * correct — a rival's city yields the planet's resource *and* a captive, identically to your own —
 * and the symptom came from two other places, both worth pinning here so the next report is quicker
 * to place:
 *
 *   - **Full slots.** The resource is not lost, it goes to overflow and waits for you to choose what
 *     to keep. The log says so, but the count does not move until you decide.
 *   - **The UI hid the prompt.** The bot tray was drawing over the hand's grid cell on a human's
 *     turn, covering the very "no room, choose what to keep" prompt that explains the missing
 *     resource. Fixed in `BotPanel`, but the engine-side behaviour is what these tests fix in place.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  contentsOf,
  countResource,
  defaultRegistry,
  move,
  planetResource,
  slotsOf,
  startGame,
} from '../src/index.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/** A position where red rules a Material planet holding one city belonging to `owner`. */
function ruledPlanet(owner: FactionId, emptySlots: boolean): { state: GameState; system: string } {
  let s = startGame(
    { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
    registry,
  ).state

  if (emptySlots) {
    for (let i = 0; i < 6; i++) {
      for (const t of contentsOf(s.resources, `cityslot:red:${i}`)) {
        s = { ...s, resources: move(s.resources, t, `supply:${t.slice(0, t.indexOf('#'))}`) }
      }
    }
  }

  const system = s.board.systems.find((x) => planetResource(s, x) === 'Material')
  if (system === undefined) throw new Error('expected a Material planet on this board')

  // Clear the system, then give red a ruling fleet and `owner` the single city.
  for (const id of contentsOf(s.figures, Location.system(system))) {
    s = { ...s, figures: move(s.figures, id, Location.reserve(id.split('/')[0] as FactionId)) }
  }
  for (const id of contentsOf(s.figures, Location.reserve('red'))
    .filter((i) => i.includes('Ship'))
    .slice(0, 3)) {
    s = { ...s, figures: move(s.figures, id, Location.system(system)) }
  }
  const city = contentsOf(s.figures, Location.reserve(owner)).find((i) => i.includes('City'))
  if (city === undefined) throw new Error(`no spare city for ${owner}`)
  return { state: { ...s, figures: move(s.figures, city, Location.system(system)) }, system }
}

const taxAction = (system: string, city: string): unknown => ({
  type: 'action/tax-city',
  faction: 'red',
  system,
  city,
  then: { type: 'turn/end', faction: 'red' },
})

const cityIn = (s: GameState, system: string, owner: FactionId): string => {
  const city = contentsOf(s.figures, Location.system(system)).find((i) =>
    i.startsWith(`${owner}/City`),
  )
  if (city === undefined) throw new Error(`no ${owner} city in ${system}`)
  return city
}

describe('taxing', () => {
  it("gives the planet's resource for a rival's city, exactly as for your own", () => {
    // The reported bug. Both must gain one Material; only the rival case takes a captive.
    for (const owner of ['red', 'yellow'] as const) {
      const { state, system } = ruledPlanet(owner, true)
      const before = countResource(state.resources, slotsOf(state, 'red'), 'Material')
      const out = advance(state, taxAction(system, cityIn(state, system, owner)) as never, registry)
      const after = countResource(out.state.resources, slotsOf(out.state, 'red'), 'Material')

      expect(after).toBe(before + 1)
      expect(contentsOf(out.state.figures, Location.captives('red')).length).toBe(
        owner === 'yellow' ? 1 : 0,
      )
    }
  })

  it('sends the resource to overflow rather than losing it when the slots are full', () => {
    /*
     * The other half of the report. With no room the count does not move, which reads as "taxing
     * gave me nothing" — but the resource is waiting on an arrange decision, and the log says so.
     */
    const { state, system } = ruledPlanet('yellow', false)
    const before = countResource(state.resources, slotsOf(state, 'red'), 'Material')
    const out = advance(state, taxAction(system, cityIn(state, system, 'yellow')) as never, registry)

    expect(countResource(out.state.resources, slotsOf(out.state, 'red'), 'Material')).toBe(before)
    expect(out.state.log.join(' ')).toContain('no room')
    // And the capture still happens, so the action was not a no-op.
    expect(contentsOf(out.state.figures, Location.captives('red')).length).toBe(1)
  })
})
