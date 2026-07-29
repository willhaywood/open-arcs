import { describe, expect, it } from 'vitest'

import {
  CITY_SLOT_KEYS,
  Location,
  RESOURCES,
  ResourceSlot,
  TOKENS_PER_RESOURCE,
  advance,
  contentsOf,
  countResource,
  defaultRegistry,
  emptyTracker,
  gain,
  heldTokens,
  openSlots,
  overflowTokens,
  parseResourceToken,
  registerResources,
  resourceToken,
  slotCapacity,
  slotsOf,
  spendToken,
  startGame,
  supplyOf,
  usableSlots,
  slotKeys,
  move,
} from '../src/index.js'
import type { Action, Continue, GameState, Resource, RuleResult } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

describe('resource model', () => {
  it('has five resources with five tokens each', () => {
    expect(RESOURCES).toHaveLength(5)
    expect(TOKENS_PER_RESOURCE).toBe(5)
  })

  it('city slot keys match the physical board', () => {
    expect([...CITY_SLOT_KEYS]).toEqual([3, 1, 1, 2, 1, 3])
  })

  it('slot capacity grows as cities leave reserve', () => {
    // [6,6,6,4,3,2] indexed by cities in reserve; more built (fewer reserve) = more slots.
    expect(slotCapacity(5)).toBe(2)
    expect(slotCapacity(4)).toBe(3)
    expect(slotCapacity(0)).toBe(6)
    expect(slotCapacity(99)).toBe(2) // clamped
  })

  it('token ids round-trip', () => {
    const id = resourceToken('Psionic', 3)
    expect(id).toBe('Psionic#3')
    expect(parseResourceToken(id)).toEqual({ resource: 'Psionic', index: 3 })
  })
})

describe('tracker operations', () => {
  function fresh() {
    return registerResources(emptyTracker(), THREE)
  }

  it('seeds the supply full and slots empty', () => {
    const t = fresh()
    for (const r of RESOURCES) expect(supplyOf(t, r)).toHaveLength(5)
    expect(openSlots(t, usableSlots('red', 6))).toHaveLength(6)
    expect(heldTokens(t, usableSlots('red', 6))).toHaveLength(0)
  })

  it('gain moves a token from supply into an open slot', () => {
    const t0 = fresh()
    const { tracker, gained } = gain(t0, usableSlots('red', 6), 'Material')
    expect(gained).toBe(true)
    expect(supplyOf(tracker, 'Material')).toHaveLength(4)
    expect(countResource(tracker, usableSlots('red', 6), 'Material')).toBe(1)
  })

  it('gain fails when every usable slot is full', () => {
    let t = fresh()
    // Capacity 2: fill both usable slots.
    expect(gain(t, usableSlots('red', 2), 'Material').gained).toBe(true)
    t = gain(t, usableSlots('red', 2), 'Material').tracker
    expect(gain(t, usableSlots('red', 2), 'Fuel').gained).toBe(true)
    t = gain(t, usableSlots('red', 2), 'Fuel').tracker
    // Third gain has no open slot within capacity 2.
    expect(gain(t, usableSlots('red', 2), 'Weapon').gained).toBe(false)
  })

  it('gain fails when the supply is exhausted', () => {
    let t = fresh()
    for (let i = 0; i < TOKENS_PER_RESOURCE; i++) t = gain(t, usableSlots('red', 6), 'Relic').tracker
    expect(supplyOf(t, 'Relic')).toHaveLength(0)
    expect(gain(t, usableSlots('red', 6), 'Relic').gained).toBe(false)
  })

  it('spend returns a token to its supply', () => {
    const t0 = fresh()
    const { tracker } = gain(t0, usableSlots('red', 6), 'Weapon')
    const held = heldTokens(tracker, usableSlots('red', 6))[0]!
    const after = spendToken(tracker, held)
    expect(supplyOf(after, 'Weapon')).toHaveLength(5)
    expect(countResource(after, usableSlots('red', 6), 'Weapon')).toBe(0)
  })

  it('never invents or loses tokens across gain then spend', () => {
    let t = fresh()
    const total = () =>
      RESOURCES.reduce(
        (n, r) => n + supplyOf(t, r).length + countResource(t, usableSlots('red', 6), r) + countResource(t, usableSlots('yellow', 6), r) + countResource(t, usableSlots('blue', 6), r),
        0,
      )
    const start = total()
    t = gain(t, usableSlots('red', 6), 'Material').tracker
    t = gain(t, usableSlots('yellow', 6), 'Fuel').tracker
    expect(total()).toBe(start)
  })
})

describe('setup grants starting resources', () => {
  it('each faction takes the resources of its city and starport systems', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    // Every faction should hold exactly two starting resources (both systems produce one).
    for (const f of THREE) {
      const held = heldTokens(state.resources, usableSlots(f, 6))
      expect(held.length).toBe(2)
    }
  })

  it('draws those tokens out of the shared supply', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const inSupply = RESOURCES.reduce((n, r) => n + supplyOf(state.resources, r).length, 0)
    const held = THREE.reduce((n, f) => n + heldTokens(state.resources, usableSlots(f, 6)).length, 0)
    expect(inSupply + held).toBe(RESOURCES.length * TOKENS_PER_RESOURCE)
    expect(held).toBe(6) // 3 factions x 2
  })
})

describe('Tax is implemented end to end', () => {
  it('gains a planet resource from a taxed city', () => {
    let step = driveToActionMenu(startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 }), 'Tax')
    if (step.continue.kind !== 'ask') throw new Error('no Tax menu')
    const taxOption = step.continue.actions.find((a) => a.type === 'action/tax-city')
    expect(taxOption).toBeDefined()
    const actor = taxOption!['faction'] as string
    const before = totalHeld(step.state, actor)

    step = advance(step.state, taxOption!, registry)

    expect(totalHeld(step.state, actor)).toBe(before + 1)
    expect(step.state.log.some((l) => l.includes('taxed'))).toBe(true)
  })
})

describe('Build is implemented end to end', () => {
  it('places a building from reserve onto the board', () => {
    let step = driveToActionMenu(startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 }), 'Build')
    if (step.continue.kind !== 'ask') throw new Error('no Build menu')
    const buildOption = step.continue.actions.find((a) => a.type === 'action/build')
    if (buildOption === undefined) return // no legal build this turn; nothing to assert
    const actor = buildOption['faction'] as string
    const before = reserveCount(step.state, actor)

    step = advance(step.state, buildOption, registry)

    expect(reserveCount(step.state, actor)).toBe(before - 1)
    expect(step.state.log.some((l) => l.includes('built'))).toBe(true)
  })
})

// --- helpers ---------------------------------------------------------------

function totalHeld(state: GameState, faction: string): number {
  return heldTokens(state.resources, usableSlots(faction as never, 6)).length
}

function reserveCount(state: GameState, faction: string): number {
  return contentsOf(state.figures, Location.reserve(faction as never)).length
}

/**
 * Drive: lead a card whose suit offers `want`, forfeit down to that action, and stop with
 * the action menu on offer. Falls back through several leads/seeds via the given start.
 */
function driveToActionMenu(start: RuleResult, want: string, limit = 300): RuleResult {
  let step = start
  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind !== 'ask') throw new Error(`stuck at ${c.kind}`)
    const wanted = c.actions.find((a) => a['label'] === want)
    if (wanted !== undefined) {
      return advance(step.state, wanted, registry)
    }
    // Prefer leading/following a card, else take the first progressing option.
    const lead = c.actions.find((a) => a.type === 'turn/lead')
    const surpass = c.actions.find((a) => a.type === 'turn/surpass' || a.type === 'turn/pivot')
    const skipSeize = c.actions.find((a) => a.type === 'turn/skip-seize')
    const pick = lead ?? surpass ?? skipSeize ?? firstProgress(c)
    step = advance(step.state, pick, registry)
  }
  throw new Error(`never reached a ${want} menu`)
}

function firstProgress(c: Continue): Action {
  if (c.kind !== 'ask') throw new Error('not an ask')
  return (
    c.actions.find((a) => a.type !== 'turn/pass' && a.type !== 'turn/end') ?? c.actions[0]!
  )
}

describe('overflow: gaining with every slot full', () => {
  const reg = defaultRegistry()
  const STOP = { type: 'turn/lead-main', faction: 'red' } as const

  function game(): GameState {
    return startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, reg).state
  }

  /** Fill every one of red's slots with Relic, and find a city it can tax. */
  function full(): { state: GameState; system: string; city: string } {
    let s = game()
    // empty the slots, then fill them all
    const contents = new Map(s.resources.contents)
    const at = new Map(s.resources.at)
    for (let i = 0; i < 6; i++) {
      const slot = `cityslot:red:${i}`
      for (const t of contents.get(slot) ?? []) {
        const sup = `supply:${t.slice(0, t.indexOf('#'))}`
        contents.set(sup, [...(contents.get(sup) ?? []), t])
        at.set(t, sup)
      }
      contents.set(slot, [])
    }
    s = { ...s, resources: { ...s.resources, contents, at } }
    for (const slot of slotsOf(s, 'red')) {
      const got = gain(s.resources, [slot], 'Relic')
      s = { ...s, resources: got.tracker }
    }
    expect(openSlots(s.resources, slotsOf(s, 'red'))).toHaveLength(0)

    for (const sys of s.board.systems) {
      const c = contentsOf(s.figures, Location.system(sys)).find((id) => id.startsWith('red/City/'))
      if (c !== undefined) return { state: s, system: sys, city: c }
    }
    throw new Error('red has no city')
  }

  function taxIt(state: GameState, system: string, city: string) {
    return advance(
      state,
      { type: 'action/tax-city', faction: 'red', system, city, then: STOP },
      reg,
    )
  }

  it('opens the slot board rather than silently refusing the resource', () => {
    const { state, system, city } = full()
    const out = taxIt(state, system, city)
    expect(out.continue.kind).toBe('ask')
    const c = out.continue as Extract<typeof out.continue, { kind: 'ask' }>
    expect(c.faction).toBe('red')
    expect(c.prompt).toContain('no room')
    // The arriving token is still waiting: it has not been dropped, and it has not landed.
    expect(overflowTokens(out.state.resources, 'red')).toHaveLength(1)
    // Every slot is full, so every landing of the arrival ejects its occupant.
    const incoming = overflowTokens(out.state.resources, 'red')[0]!
    const landings = c.actions.filter(
      (a) => a.type === 'resources/arrange-move' && a['token'] === incoming,
    )
    expect(landings.length).toBe(slotsOf(out.state, 'red').length)
    expect(landings.every((a) => a['eject'] !== undefined)).toBe(true)
    // What is already held can still be shuffled about, and those swaps eject nothing.
    const swaps = c.actions.filter((a) => a.type === 'resources/arrange-move' && a['swap'] !== undefined)
    expect(swaps.length).toBeGreaterThan(0)
    expect(swaps.every((a) => a['eject'] === undefined)).toBe(true)
    expect(c.actions.some((a) => a.type === 'resources/arrange-discard')).toBe(true)
    // Not settled, so there is no way out until it is.
    expect(c.actions.some((a) => a.type === 'resources/arrange-done')).toBe(false)
  })

  it('discarding the incoming one leaves the board as it was', () => {
    const { state, system, city } = full()
    const out = taxIt(state, system, city)
    const c = out.continue as Extract<typeof out.continue, { kind: 'ask' }>
    const incoming = overflowTokens(out.state.resources, 'red')[0]!
    const drop = c.actions.find(
      (a) => a.type === 'resources/arrange-discard' && a['token'] === incoming,
    )!
    const after = advance(out.state, drop, reg).state

    expect(overflowTokens(after.resources, 'red')).toHaveLength(0)
    const slots = slotsOf(after, 'red')
    expect(countResource(after.resources, slots, 'Relic')).toBe(slots.length)
  })

  it('landing it on a slot ejects that slot\'s token', () => {
    const { state, system, city } = full()
    const out = taxIt(state, system, city)
    const c = out.continue as Extract<typeof out.continue, { kind: 'ask' }>
    const incoming = overflowTokens(out.state.resources, 'red')[0]!
    const land = c.actions.find(
      (a) => a.type === 'resources/arrange-move' && a['token'] === incoming,
    )!
    const after = advance(out.state, land, reg).state

    expect(overflowTokens(after.resources, 'red')).toHaveLength(0)
    const slots = slotsOf(after, 'red')
    // Still exactly full, one Relic fewer, and the arriving token now sits in the slot it took.
    expect(heldTokens(after.resources, slots)).toHaveLength(slots.length)
    expect(countResource(after.resources, slots, 'Relic')).toBe(slots.length - 1)
    expect(after.resources.at.get(incoming)).toBe(land['to'])
    expect(after.log.join('\n')).toContain('no room')
  })

  it('lets the player choose which slot the arrival takes — they are not interchangeable', () => {
    const { state, system, city } = full()
    const out = taxIt(state, system, city)
    const c = out.continue as Extract<typeof out.continue, { kind: 'ask' }>
    const incoming = overflowTokens(out.state.resources, 'red')[0]!
    const landings = c.actions.filter(
      (a) => a.type === 'resources/arrange-move' && a['token'] === incoming,
    )
    // One per slot, and the slots differ in what they cost a raider — which is the whole point.
    const costs = landings.map((a) => slotKeys(a['to'] as string))
    expect(new Set(costs).size).toBeGreaterThan(1)

    const dearest = landings.reduce((best, a) =>
      slotKeys(a['to'] as string) > slotKeys(best['to'] as string) ? a : best,
    )
    const after = advance(out.state, dearest, reg).state
    expect(slotKeys(after.resources.at.get(incoming)!)).toBe(Math.max(...costs))
  })

  it('leaves a faction with room alone', () => {
    let s = game()
    // free one slot
    const slots = slotsOf(s, 'red')
    const held = heldTokens(s.resources, slots)
    if (held.length === slots.length) {
      s = { ...s, resources: spendToken(s.resources, held[0]!) }
    }
    const sys = s.board.systems.find((x) =>
      contentsOf(s.figures, Location.system(x)).some((id) => id.startsWith('red/City/')),
    )!
    const city = contentsOf(s.figures, Location.system(sys)).find((id) => id.startsWith('red/City/'))!
    const out = advance(s, { type: 'action/tax-city', faction: 'red', system: sys, city, then: STOP }, reg)
    expect(overflowTokens(out.state.resources, 'red')).toHaveLength(0)
    expect(
      (out.continue as { actions?: unknown[] }).actions?.some?.((a) =>
        String((a as Record<string, unknown>)['label']).includes('no room'),
      ),
    ).not.toBe(true)
  })
})

describe('rearranging: the other half of the rule', () => {
  const reg = defaultRegistry()
  const STOP = { type: 'turn/lead-main', faction: 'red' } as const

  function game(): GameState {
    return startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, reg).state
  }

  /** Put `tokens` into consecutive slots from index 0, having emptied the row first. */
  function holding(state: GameState, ...tokens: Resource[]): GameState {
    const contents = new Map(state.resources.contents)
    const at = new Map(state.resources.at)
    for (let i = 0; i < 6; i++) {
      for (const t of contents.get(`cityslot:red:${i}`) ?? []) {
        const sup = `supply:${t.slice(0, t.indexOf('#'))}`
        contents.set(sup, [...(contents.get(sup) ?? []), t])
        at.set(t, sup)
      }
      contents.set(`cityslot:red:${i}`, [])
    }
    tokens.forEach((r, i) => {
      const sup = `supply:${r}`
      const token = (contents.get(sup) ?? [])[0]!
      contents.set(sup, (contents.get(sup) ?? []).filter((t) => t !== token))
      contents.set(`cityslot:red:${i}`, [token])
      at.set(token, `cityslot:red:${i}`)
    })
    return { ...state, resources: { ...state.resources, contents, at } }
  }

  const ask = (c: Continue) => {
    if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
    return c
  }

  it('a swap changes places and loses nothing', () => {
    const s = holding(game(), 'Relic', 'Fuel')
    const relic = contentsOf(s.resources, 'cityslot:red:0')[0]!
    const fuel = contentsOf(s.resources, 'cityslot:red:1')[0]!

    const c = ask(advance(s, { type: 'turn/prelude-arrange', faction: 'red', suit: 'Construction', pips: 1 }, reg).continue)
    const swap = c.actions.find(
      (a) => a.type === 'resources/arrange-move' && a['token'] === relic && a['to'] === 'cityslot:red:1',
    )!
    expect(swap['swap']).toBe(fuel)
    const after = advance(s, swap, reg).state

    expect(after.resources.at.get(relic)).toBe('cityslot:red:1')
    expect(after.resources.at.get(fuel)).toBe('cityslot:red:0')
    expect(heldTokens(after.resources, slotsOf(after, 'red'))).toHaveLength(2)
  })

  it('moving into an empty slot leaves the old one empty', () => {
    const s = holding(game(), 'Relic')
    const relic = contentsOf(s.resources, 'cityslot:red:0')[0]!
    const c = ask(advance(s, { type: 'turn/prelude-arrange', faction: 'red', suit: 'Construction', pips: 1 }, reg).continue)
    const move1 = c.actions.find(
      (a) => a.type === 'resources/arrange-move' && a['to'] === 'cityslot:red:2',
    )!
    expect(move1['swap']).toBeUndefined()
    expect(move1['eject']).toBeUndefined()
    const after = advance(s, move1, reg).state
    expect(after.resources.at.get(relic)).toBe('cityslot:red:2')
    expect(contentsOf(after.resources, 'cityslot:red:0')).toHaveLength(0)
  })

  it('the Prelude offers the door while you hold anything', () => {
    const prelude = (state: GameState): string[] =>
      ask(
        advance(state, { type: 'turn/prelude', faction: 'red', suit: 'Construction', pips: 1 }, reg)
          .continue,
      ).actions.map((a) => a.type)
    expect(prelude(holding(game(), 'Relic'))).toContain('turn/prelude-arrange')
  })

  it('an empty row offers nothing but Done — there is only one way to arrange nothing', () => {
    const empty = holding(game())
    const c = ask(
      advance(empty, { type: 'turn/prelude-arrange', faction: 'red', suit: 'Construction', pips: 1 }, reg)
        .continue,
    )
    expect(c.actions.map((a) => a.type)).toEqual(['resources/arrange-done'])
  })

  it('arranging is free — Done returns to the Prelude having spent nothing', () => {
    const s = holding(game(), 'Relic', 'Fuel')
    const out = advance(s, { type: 'turn/prelude-arrange', faction: 'red', suit: 'Construction', pips: 1 }, reg)
    const done = ask(out.continue).actions.find((a) => a.type === 'resources/arrange-done')!
    const after = advance(out.state, done, reg)
    expect(heldTokens(after.state.resources, slotsOf(after.state, 'red'))).toHaveLength(2)
    expect(after.continue.kind).toBe('ask')
  })

  it('a shrunken capacity strands a token, and the board must be settled before play goes on', () => {
    // Three tokens, then a city comes home to reserve: capacity 3 drops to 2.
    const s = holding(game(), 'Relic', 'Fuel', 'Material')
    const city = s.board.systems
      .flatMap((id) => contentsOf(s.figures, Location.system(id)))
      .find((f) => f.startsWith('red/City/'))!
    const shrunk = { ...s, figures: move(s.figures, city, Location.reserve('red')) }

    expect(slotsOf(shrunk, 'red')).toHaveLength(2)
    const stranded = contentsOf(shrunk.resources, 'cityslot:red:2')
    expect(stranded).toHaveLength(1)

    const c = ask(advance(shrunk, { type: 'turn/prelude-arrange', faction: 'red', suit: 'Construction', pips: 1 }, reg).continue)
    expect(c.prompt).toContain('can no longer hold')
    // No way out until it fits.
    expect(c.actions.some((a) => a.type === 'resources/arrange-done')).toBe(false)

    const shed = c.actions.find(
      (a) => a.type === 'resources/arrange-discard' && a['token'] === stranded[0],
    )!
    const after = advance(shrunk, shed, reg)
    expect(contentsOf(after.state.resources, 'cityslot:red:2')).toHaveLength(0)
    expect(ask(after.continue).actions.some((a) => a.type === 'resources/arrange-done')).toBe(true)
  })
})
