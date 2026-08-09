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
  supplyOf,
} from '../src/index.js'
import type { Action, FactionId, GameState } from '../src/index.js'

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

/**
 * The follow-up report: "the AI taxes its own city when there is nothing left to tax."
 *
 * It did, 20% of the time — 50 of 251 taxes across six driven games hit an exhausted supply and
 * gained nothing. Taxing an empty supply is *legal*, so the engine was not breaking a rule; it was
 * offering an action that provably could not do anything, and an Administration pip with nothing
 * else to buy took it.
 *
 * The tests below are almost all **escape hatches** rather than the fix itself, and that is
 * deliberate. Withholding an option is only safe while "gains nothing" stays certain: a tax can
 * also capture an agent, pay a leader's bonus, trigger Mythic or trigger Ruthless. Getting any of
 * those wrong hides a legal move — a rules bug traded for a cosmetic one — so each is pinned by a
 * test asserting the option is **still offered**.
 */
describe('a tax that could not do anything is not offered', () => {
  /**
   * Empty the supply of `r`, so taxing for it can gain nothing.
   *
   * Parked in blue's overflow rather than a "scrapped" bin: every resource location has to be
   * registered in the tracker, and overflow is the one that exists and belongs to nobody's slots,
   * so red's holdings and blue's own slots are both untouched by the drain.
   */
  function drain(s: GameState, r: string): GameState {
    let next = s
    for (const id of [...contentsOf(next.resources, `supply:${r}`)]) {
      next = { ...next, resources: move(next.resources, id, 'overflow:blue') }
    }
    return next
  }

  /** The Tax menu red is offered right now. */
  function taxMenu(s: GameState): readonly Action[] {
    const open = advance(
      s,
      { type: 'action/take', faction: 'red', action: 'Tax', then: { type: 'turn/end', faction: 'red' } } as never,
      registry,
    )
    const c = open.continue
    return c.kind === 'ask' ? c.actions : []
  }

  const taxesFor = (s: GameState, system: string): number =>
    taxMenu(s).filter((a) => String(a['label'] ?? '').includes(system)).length

  it('withholds it: own city, empty supply, no traits in play', () => {
    const { state, system } = ruledPlanet('red', true)
    expect(taxesFor(state, system), 'the fixture offers the tax to begin with').toBeGreaterThan(0)
    expect(taxesFor(drain(state, 'Material'), system)).toBe(0)
  })

  it("still offers a rival's city — the tax captures an agent", () => {
    // The escape hatch that matters most: nothing is gained in resources, but a captive is.
    const { state, system } = ruledPlanet('yellow', true)
    expect(taxesFor(drain(state, 'Material'), system)).toBeGreaterThan(0)
  })

  it('still offers it when a leader would pay a bonus resource', () => {
    /*
     * Firebrand (Agitator): a Weapon alongside the taxed resource, but only on a Copy or Pivot —
     * so the fixture has to have pivoted for the trait to be live at all.
     */
    const { state, system } = ruledPlanet('red', true)
    const s: GameState = {
      ...drain(state, 'Material'),
      leaders: { ...state.leaders, red: 'leader15' },
      roundPlays: [{ faction: 'red', cardId: 'Aggression-3', kind: 'pivot' }],
    }
    expect(taxesFor(s, system)).toBeGreaterThan(0)
  })

  it('still offers it when Mythic could reshape the planet', () => {
    /*
     * Shaper: "after you tax a city, you may place 1 resource over the planet's icon." The tax
     * gains nothing and the reshape is the whole point of taking it.
     *
     * Red must hold a resource **of a different type than the planet** — Mythic covers the printed
     * icon, so a Material token cannot reshape a Material planet, and this board's setup deals red
     * two Materials and nothing else. Handing it a Relic is what makes the trait live; without
     * that the option is correctly withheld, which cost a fixture rewrite to notice.
     */
    const { state, system } = ruledPlanet('red', true)
    const drained = drain(state, 'Material')
    const relic = contentsOf(drained.resources, 'supply:Relic')[0]!
    const s: GameState = {
      // Off the *drained* tracker — spreading `drain(...)` and then overriding `resources` from
      // the original state silently un-drains the supply, and the test passes for the wrong reason.
      ...drained,
      resources: move(drained.resources, relic, 'cityslot:red:0'),
      leaders: { ...state.leaders, red: 'leader14' },
    }
    expect(supplyOf(s.resources, 'Material').length, 'the supply really is empty').toBe(0)
    expect(taxesFor(s, system)).toBeGreaterThan(0)
  })

  it('still offers it when Ruthless could squeeze the building', () => {
    // Overseer: "once per turn, when you tax any city, you may hit the building to tax again."
    const { state, system } = ruledPlanet('red', true)
    const s: GameState = { ...drain(state, 'Material'), leaders: { ...state.leaders, red: 'leader10' } }
    expect(taxesFor(s, system)).toBeGreaterThan(0)
  })
})
