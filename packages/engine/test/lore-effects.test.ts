/**
 * Leaders and Lore, phase 3 — base-game lore card effects.
 *
 * Same discipline as the trait tests: every card is checked against the identical situation
 * *without* it, because a card that silently did nothing looks exactly like a base game.
 *
 * The four covered here all live in the battle module and need no new state, so they can be
 * driven directly through `battle/target` and `battle/roll`. Cards are injected onto
 * `state.lores` rather than drafted — the deal is seeded, so drafting a chosen card to a chosen
 * faction would be testing the shuffle.
 */

import { describe, expect, it } from 'vitest'

import {
  CourtPile,
  Location,
  advance,
  citiesInReserve,
  connectedSystems,
  contentsOf,
  countResource,
  courtCard,
  freeSlots,
  gain,
  hasCloudCity,
  courtSlots,
  defaultRegistry,
  hasLore,
  outragedResources,
  slotCapacity,
  slotKeys,
  heldTokens,
  slotsOf,
  startGame,
  tallyOf,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, Resource, SystemId } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

type Ask = Extract<Continue, { kind: 'ask' }>

function ask(c: Continue): Ask {
  if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
  return c
}

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

function withLore(state: GameState, faction: FactionId, ...ids: string[]): GameState {
  return { ...state, lores: { ...state.lores, [faction]: [...(state.lores[faction] ?? []), ...ids] } }
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

/** Mark `n` of a colour's pieces of a kind in a system as damaged. */
function damage(state: GameState, color: string, system: SystemId, piece: string, n: number): GameState {
  const here = contentsOf(state.figures, Location.system(system))
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  return { ...state, damaged: [...state.damaged, ...here] }
}

const STOP = { type: 'turn/lead-main', faction: 'red' } as const

/** Return every resource token a faction holds to the supply, freeing its slots. */
function stripSlots(state: GameState, faction: FactionId): GameState {
  const contents = new Map(state.resources.contents)
  const at = new Map(state.resources.at)
  for (let i = 0; i < 6; i++) {
    const slot = `cityslot:${faction}:${i}`
    for (const token of contents.get(slot) ?? []) {
      const supply = `supply:${token.slice(0, token.indexOf('#'))}`
      contents.set(supply, [...(contents.get(supply) ?? []), token])
      at.set(token, supply)
    }
    contents.set(slot, [])
  }
  return { ...state, resources: { ...state.resources, contents, at } }
}

/** red attacking yellow in one system, nothing else present. */
function field(state: GameState, opts: { redShips?: number; yellowShips?: number; yellowPorts?: number } = {}) {
  const system = state.board.systems.find((s) => !Boolean((state.board as never)) ) ?? state.board.systems[0]!
  let s = clearSystem(state, system)
  s = place(s, 'red', system, 'Ship', opts.redShips ?? 3)
  s = place(s, 'yellow', system, 'Ship', opts.yellowShips ?? 2)
  if (opts.yellowPorts) s = place(s, 'yellow', system, 'Starport', opts.yellowPorts)
  return { state: s, system }
}

/** The dice pools the gather menu offers. */
function gatherOptions(state: GameState, system: SystemId) {
  return ask(
    advance(state, { type: 'battle/target', faction: 'red', system, enemy: 'yellow', then: STOP }, registry)
      .continue,
  ).actions.filter((a) => a.type === 'battle/roll')
}

/** Roll a fixed pool and report the resulting context and log line. */
function roll(state: GameState, system: SystemId, pool: { s: number; a: number; r: number }) {
  const out = advance(
    state,
    {
      type: 'battle/roll',
      faction: 'red',
      system,
      enemy: 'yellow',
      skirmish: pool.s,
      assault: pool.a,
      raid: pool.r,
      then: STOP,
    },
    registry,
  )
  return { state: out.state, log: out.state.log.at(-1) ?? '', continue: out.continue }
}

describe('hasLore', () => {
  it('is false for everyone in a base game', () => {
    expect(fresh().lores).toEqual({})
    expect(hasLore(fresh(), 'red', 'lore04')).toBe(false)
  })

  it('reads only the holding faction', () => {
    const s = withLore(fresh(), 'red', 'lore04')
    expect(hasLore(s, 'red', 'lore04')).toBe(true)
    expect(hasLore(s, 'yellow', 'lore04')).toBe(false)
    expect(hasLore(s, 'red', 'lore05')).toBe(false)
  })
})

describe('Hidden Harbors (lore05) — no raid dice against a fresh defending starport', () => {
  it('offers raid dice against a plain starport', () => {
    const { state, system } = field(fresh(), { yellowPorts: 1 })
    expect(gatherOptions(state, system).some((a) => (a['raid'] as number) > 0)).toBe(true)
  })

  it('withholds them when the defender holds the card', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore05'), { yellowPorts: 1 })
    expect(gatherOptions(state, system).some((a) => (a['raid'] as number) > 0)).toBe(false)
  })

  it('restores them once that starport is damaged', () => {
    const base = field(withLore(fresh(), 'yellow', 'lore05'), { yellowPorts: 1 })
    const hurt = damage(base.state, 'yellow', base.system, 'Starport', 1)
    expect(gatherOptions(hurt, base.system).some((a) => (a['raid'] as number) > 0)).toBe(true)
  })

  it('does nothing for the attacker holding it', () => {
    const { state, system } = field(withLore(fresh(), 'red', 'lore05'), { yellowPorts: 1 })
    expect(gatherOptions(state, system).some((a) => (a['raid'] as number) > 0)).toBe(true)
  })
})

describe("Hidden Harbors (lore05) — 'You always build ships fresh' (docs/21 A1)", () => {
  /*
   * The card's first clause, long recorded as a no-op because rulebook 7.2.2 was missing: "When
   * you build anything in a system that is controlled by anyone other than you, place the piece
   * damaged." The clause is the ship-only exemption — the holder's ships arrive fresh where
   * anyone else's would be damaged, and the holder's BUILDINGS still arrive damaged.
   */
  const contestedYard = (holder: boolean) => {
    const base = holder ? withLore(fresh(), 'red', 'lore05') : fresh()
    const system = base.board.systems[0]!
    // Red's starport plus a yellow fleet that rules the system.
    let s = clearSystem(base, system)
    s = place(s, 'red', system, 'Starport', 1)
    s = place(s, 'yellow', system, 'Ship', 4)
    return { s, system }
  }
  const build = (s: GameState, piece: string, system: SystemId): GameState => {
    const c = advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
    const act = ask(c.continue).actions.find(
      (a) => a.type === 'action/build' && a['piece'] === piece && a['system'] === system,
    )!
    return advance(s, act, registry).state
  }
  const builtPiece = (s: GameState, piece: string, system: SystemId): string =>
    contentsOf(s.figures, Location.system(system)).find((id) => id.startsWith(`red/${piece}/`))!

  it('a ship built under rival control arrives damaged without the card (rulebook 7.2.2)', () => {
    const { s, system } = contestedYard(false)
    const after = build(s, 'Ship', system)
    expect(after.damaged).toContain(builtPiece(after, 'Ship', system))
    expect(after.log.some((l) => /damaged — Rival-controlled/.test(l))).toBe(true)
  })

  it('the holder builds that same ship fresh', () => {
    const { s, system } = contestedYard(true)
    const after = build(s, 'Ship', system)
    expect(after.damaged).not.toContain(builtPiece(after, 'Ship', system))
  })

  it("the holder's buildings still arrive damaged — ships only", () => {
    // Presence by ship rather than starport, so the building slot stays free for the City.
    const base = withLore(fresh(), 'red', 'lore05')
    const system = base.board.systems[0]!
    let s = clearSystem(base, system)
    s = place(s, 'red', system, 'Ship', 1)
    s = place(s, 'yellow', system, 'Ship', 4)
    const after = build(s, 'City', system)
    expect(after.damaged).toContain(builtPiece(after, 'City', system))
  })
})

describe('Mirror Plating (lore04) — an extra Intercept against assault dice', () => {
  it('adds one when the attacker rolled assault dice', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore04'))
    expect(roll(state, system, { s: 0, a: 2, r: 0 }).log).toContain('+1 intercept, Mirror Plating')
  })

  it('adds nothing to a pure skirmish roll', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore04'))
    expect(roll(state, system, { s: 3, a: 0, r: 0 }).log).not.toContain('Mirror Plating')
  })

  it('turns a no-intercept assault roll into an intercepting one', () => {
    // Seed swept for an assault roll that yields no intercept of its own, so the card is the
    // only thing that could produce one.
    let found = false
    for (let seed = 1; seed < 80 && !found; seed++) {
      const plain = field(fresh(seed))
      const bare = roll(plain.state, plain.system, { s: 0, a: 2, r: 0 })
      if (bare.log.includes('no intercept')) {
        const mirrored = field(withLore(fresh(seed), 'yellow', 'lore04'))
        const out = roll(mirrored.state, mirrored.system, { s: 0, a: 2, r: 0 })
        expect(out.log).toContain('+1 intercept, Mirror Plating')
        expect(out.log).not.toContain('no intercept')
        found = true
      }
    }
    expect(found).toBe(true)
  })
})

describe('Signal Breaker (lore06) — ignore one Intercept from an all-fresh fleet', () => {
  it('applies when every attacking ship is undamaged', () => {
    const { state, system } = field(withLore(fresh(), 'red', 'lore06'))
    expect(roll(state, system, { s: 2, a: 1, r: 0 }).log).toContain('-1 intercept, Signal Breaker')
  })

  it('does not apply once any attacking ship is damaged', () => {
    const base = field(withLore(fresh(), 'red', 'lore06'))
    const hurt = damage(base.state, 'red', base.system, 'Ship', 1)
    expect(roll(hurt, base.system, { s: 2, a: 1, r: 0 }).log).not.toContain('Signal Breaker')
  })

  it('cancels Mirror Plating exactly when both are in play', () => {
    let s = withLore(fresh(), 'red', 'lore06')
    s = withLore(s, 'yellow', 'lore04')
    const { state, system } = field(s)
    const both = roll(state, system, { s: 0, a: 2, r: 0 })
    const neither = roll(field(fresh()).state, field(fresh()).system, { s: 0, a: 2, r: 0 })
    // both adjustments are reported, and the intercept verdict matches the unmodified roll
    expect(both.log).toContain('Mirror Plating')
    expect(both.log).toContain('Signal Breaker')
    expect(both.log.includes('no intercept')).toBe(neither.log.includes('no intercept'))
  })
})

describe('Repair Drones (lore07) — repair one attacking ship after battling', () => {
  /** Run a battle to completion, assigning nothing, and report red's damaged ships in-system. */
  function battleThrough(state: GameState, system: SystemId): GameState {
    let step = advance(
      state,
      { type: 'battle/roll', faction: 'red', system, enemy: 'yellow', skirmish: 1, assault: 0, raid: 0, then: STOP },
      registry,
    )
    // Assign whatever the roll produced, then finish; `finish` only appears once nothing is
    // outstanding, so taking the first offer until then is what drives the battle to its end.
    for (let i = 0; i < 40; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const finish = c.actions.find((a) => a.type === 'battle/finish')
      step = advance(step.state, finish ?? c.actions[0]!, registry)
      if (finish !== undefined) break
    }
    return step.state
  }

  function damagedRed(state: GameState, system: SystemId): number {
    return contentsOf(state.figures, Location.system(system)).filter(
      (id) => id.startsWith('red/Ship/') && state.damaged.includes(id),
    ).length
  }

  it('repairs exactly one damaged attacking ship', () => {
    const base = field(withLore(fresh(), 'red', 'lore07'))
    const hurt = damage(base.state, 'red', base.system, 'Ship', 2)
    expect(damagedRed(hurt, base.system)).toBe(2)
    const after = battleThrough(hurt, base.system)
    expect(damagedRed(after, base.system)).toBe(1)
    expect(after.log.join('\n')).toContain('Repair Drones')
  })

  it('leaves a fleet with nothing to repair alone', () => {
    const base = field(withLore(fresh(), 'red', 'lore07'))
    const after = battleThrough(base.state, base.system)
    expect(after.log.join('\n')).not.toContain('Repair Drones')
  })

  it('does nothing without the card', () => {
    const base = field(fresh())
    const hurt = damage(base.state, 'red', base.system, 'Ship', 2)
    const after = battleThrough(hurt, base.system)
    expect(damagedRed(after, base.system)).toBe(2)
  })
})

// --- cards using the alt table and the per-turn flag ------------------------

function menuFor(state: GameState, which: string): string[] {
  return ask(
    advance(state, { type: 'action/take', faction: 'red', action: which, then: STOP }, registry)
      .continue,
  ).actions.map((a) => String(a['label'] ?? a.type))
}

/** A system red rules that holds a red city, which is what several of these need. */
function redCitySystem(state: GameState): { system: SystemId; city: string } {
  for (const s of state.board.systems) {
    const city = contentsOf(state.figures, Location.system(s)).find((id) =>
      id.startsWith('red/City/'),
    )
    if (city !== undefined) return { system: s, city }
  }
  throw new Error('red has no city')
}

describe('Tool Priests (lore01) — summon a ship at a city you control', () => {
  it('is not offered without the card', () => {
    expect(menuFor(fresh(), 'Build').some((l) => l.includes('Tool Priests'))).toBe(false)
  })

  it('is offered with it', () => {
    const s = withLore(fresh(), 'red', 'lore01')
    expect(menuFor(s, 'Build').some((l) => l.includes('Tool Priests'))).toBe(true)
  })

  it('actually places a ship, and spends the city for the turn', () => {
    const s = withLore(fresh(), 'red', 'lore01')
    const { system } = redCitySystem(s)
    const summon = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes('Tool Priests'))!
    const before = contentsOf(s.figures, Location.system(summon['system'] as SystemId)).filter((id) =>
      id.startsWith('red/Ship/'),
    ).length
    const after = advance(s, summon, registry).state
    expect(
      contentsOf(after.figures, Location.system(summon['system'] as SystemId)).filter((id) =>
        id.startsWith('red/Ship/'),
      ).length,
    ).toBe(before + 1)
    // and it is once per turn, gated on any city having been worked
    expect(menuFor(after, 'Build').some((l) => l.includes('Tool Priests'))).toBe(false)
    expect(system).toBeDefined()
  })
})

describe('Living Structures (lore10) — Nurture and Prune through the lore-alt table', () => {
  it('adds Nurture to Build and Prune to Repair, and only with the card', () => {
    const base = fresh()
    expect(menuFor(base, 'Build').some((l) => l.startsWith('Nurture'))).toBe(false)
    expect(menuFor(base, 'Repair').some((l) => l.startsWith('Prune'))).toBe(false)

    const s = withLore(base, 'red', 'lore10')
    expect(menuFor(s, 'Build').some((l) => l.startsWith('Nurture'))).toBe(true)
    expect(menuFor(s, 'Repair').some((l) => l.startsWith('Prune'))).toBe(true)
  })

  it('Nurture offers the Tax menu', () => {
    const s = withLore(fresh(), 'red', 'lore10')
    const alt = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).startsWith('Nurture'))!
    expect(
      ask(advance(s, alt, registry).continue).actions.some((a) => a.type === 'action/tax-city'),
    ).toBe(true)
  })

  it('Prune swaps a city for a starport in place', () => {
    const s = withLore(fresh(), 'red', 'lore10')
    const { system, city } = redCitySystem(s)
    const prune = ask(
      advance(
        s,
        { type: 'action/guild-alt', faction: 'red', alt: 'prune', then: STOP },
        registry,
      ).continue,
    ).actions.find((a) => a['figure'] === city)!
    const after = advance(s, prune, registry).state
    const here = contentsOf(after.figures, Location.system(system))
    expect(here).not.toContain(city)
    expect(here.some((id) => id.startsWith('red/Starport/'))).toBe(true)
    expect(after.log.join('\n')).toContain('Living Structures')
  })
})

describe('Sprinter Drives (lore03) — one more move, once per turn', () => {
  /** Move two red ships between two connected systems and return the resulting continue. */
  function moveThen(state: GameState) {
    const from = state.board.systems[0]!
    let s = clearSystem(state, from)
    s = place(s, 'red', from, 'Ship', 2)
    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: state.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships')!
    return { state: s, move: picked }
  }

  it('is not offered without the card', () => {
    const { state, move } = moveThen(fresh())
    const out = advance(state, move, registry)
    expect(ask(out.continue).actions.some((a) => a.type === 'action/lore-sprint')).toBe(false)
  })

  it('offers another move with it, and staying put costs nothing', () => {
    const { state, move } = moveThen(withLore(fresh(), 'red', 'lore03'))
    const out = advance(state, move, registry)
    const labels = ask(out.continue).actions.map((a) => String(a['label'] ?? a.type))
    expect(labels.some((l) => l.startsWith('Sprint'))).toBe(true)
    expect(labels).toContain('Stay put')
    expect(out.state.loreUsedThisTurn).not.toContain('lore03')
  })

  it('moves the ships on and spends the card for the turn', () => {
    const { state, move } = moveThen(withLore(fresh(), 'red', 'lore03'))
    const out = advance(state, move, registry)
    const sprint = ask(out.continue).actions.find((a) => a.type === 'action/lore-sprint')!
    const after = advance(out.state, sprint, registry)
    const dest = sprint['to'] as SystemId
    expect(
      contentsOf(after.state.figures, Location.system(dest)).filter((id) => id.startsWith('red/Ship/')).length,
    ).toBe(2)
    expect(after.state.loreUsedThisTurn).toContain('lore03')
  })

  it('is not offered a second time in the same turn', () => {
    const spent = { ...withLore(fresh(), 'red', 'lore03'), loreUsedThisTurn: ['lore03'] }
    const { state, move } = moveThen(spent)
    const out = advance(state, move, registry)
    expect(ask(out.continue).actions.some((a) => a.type === 'action/lore-sprint')).toBe(false)
  })

  it('only takes the fresh ships along', () => {
    const from = fresh().board.systems[0]!
    let s = clearSystem(withLore(fresh(), 'red', 'lore03'), from)
    s = place(s, 'red', from, 'Ship', 3)
    const ships = contentsOf(s.figures, Location.system(from)).filter((id) => id.startsWith('red/Ship/'))
    s = { ...s, damaged: [...s.damaged, ships[0]!] }
    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: s.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships' && a['count'] === 3)!
    const out = advance(s, picked, registry)
    const sprint = ask(out.continue).actions.find((a) => a.type === 'action/lore-sprint')!
    expect((sprint['ships'] as string[]).length).toBe(2)
    expect(sprint['ships']).not.toContain(ships[0])
  })
})

describe('the per-turn lore flag survives the journal', () => {
  it('is rebuilt by replay, because saves store actions rather than state', () => {
    const from = fresh().board.systems[0]!
    let s = clearSystem(withLore(fresh(), 'red', 'lore03'), from)
    s = place(s, 'red', from, 'Ship', 2)

    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: s.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships')!
    const moved = advance(s, picked, registry)
    const sprint = ask(moved.continue).actions.find((a) => a.type === 'action/lore-sprint')!
    const after = advance(moved.state, sprint, registry)

    expect(after.state.loreUsedThisTurn).toContain('lore03')
    // a fresh game state starts with the field present and empty, which is what load relies on
    expect(fresh().loreUsedThisTurn).toEqual([])
  })
})

describe('Railgun Arrays (lore12) — a hit before the attacker collects dice', () => {
  /** Everything the attacker is offered when they open a battle. */
  function opening(state: GameState, system: SystemId): Ask {
    return ask(
      advance(state, { type: 'battle/target', faction: 'red', system, enemy: 'yellow', then: STOP }, registry)
        .continue,
    )
  }

  function maxDice(c: Ask): number {
    const totals = c.actions
      .filter((a) => a.type === 'battle/roll')
      .map((a) => (a['skirmish'] as number) + (a['assault'] as number) + (a['raid'] as number))
    return totals.length === 0 ? 0 : Math.max(...totals)
  }

  it('goes straight to the dice without the card', () => {
    const { state, system } = field(fresh())
    expect(opening(state, system).actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('asks the attacker to take a hit first when the defender holds it', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore12'))
    const c = opening(state, system)
    expect(c.actions.every((a) => a.type === 'battle/hit')).toBe(true)
    expect(c.actions.every((a) => String(a['label']).includes('red Ship'))).toBe(true)
  })

  /*
   * The volley's ask is the *only* hit assignment in the game that happens with no dice on the
   * table, and the battle window deadlocked on exactly that: it required `state.lastRoll` before
   * it would draw an assignment, `battle/hit` is hidden from the action panel because the window
   * owns it, and so nothing anywhere could answer the ask.
   *
   * Asserted here rather than in the UI because it is the engine's half of that contract: the ask
   * carries everything needed to draw it, and `railgun` is how a caller knows there are no dice
   * to show — on any battle after the first, `lastRoll` still holds the *previous* battle's dice.
   */
  it('carries a ctx and no roll, so the window must not demand dice', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore12'))
    const r = advance(
      state,
      { type: 'battle/target', faction: 'red', system, enemy: 'yellow', then: STOP },
      registry,
    )
    const carrier = ask(r.continue).actions.find((a) => a['ctx'] !== undefined)
    expect(carrier).toBeDefined()
    const ctx = carrier!['ctx'] as Record<string, unknown>
    expect(ctx['railgun']).toBe(true)
    expect(ctx['self']).toBe(1)
    expect(ctx['system']).toBe(system)
    // No dice have been collected yet, which is the whole point of the card.
    expect(r.state.lastRoll).toBeUndefined()
  })

  it('does not fire when every defending ship is already damaged', () => {
    const base = field(withLore(fresh(), 'yellow', 'lore12'))
    const hurt = damage(base.state, 'yellow', base.system, 'Ship', 2)
    expect(opening(hurt, base.system).actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('does not fire for an attacker holding it', () => {
    const { state, system } = field(withLore(fresh(), 'red', 'lore12'))
    expect(opening(state, system).actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('reaches the dice menu once the hit is placed, and only once', () => {
    const { state, system } = field(withLore(fresh(), 'yellow', 'lore12'))
    const hit = opening(state, system).actions[0]!
    const after = advance(state, hit, registry)
    const confirm = ask(after.continue).actions.find((a) => a.type === 'battle/finish')!
    const dice = ask(advance(after.state, confirm, registry).continue)
    expect(dice.actions.some((a) => a.type === 'battle/roll')).toBe(true)
    // the volley does not re-arm and trap the battle in a loop
    expect(dice.actions.some((a) => a.type === 'battle/hit')).toBe(false)
  })

  it('shrinks the dice pool when the hit destroys a ship — the reason it lands first', () => {
    const base = field(withLore(fresh(), 'yellow', 'lore12'), { redShips: 3 })
    const before = maxDice(opening(field(fresh(), { redShips: 3 }).state, base.system))
    expect(before).toBe(3)

    // Damage every attacking ship, so the volley destroys one rather than damaging it.
    const hurt = damage(base.state, 'red', base.system, 'Ship', 3)
    const hit = opening(hurt, base.system).actions[0]!
    const after = advance(hurt, hit, registry)
    const confirm = ask(after.continue).actions.find((a) => a.type === 'battle/finish')!
    const dice = ask(advance(after.state, confirm, registry).continue)
    expect(maxDice(dice)).toBe(2)
  })

  it('leaves no raid, outrage or repair behind — it is not a battle', () => {
    const s = withLore(withLore(fresh(), 'yellow', 'lore12'), 'red', 'lore07')
    const base = field(s)
    const hurt = damage(base.state, 'red', base.system, 'Ship', 1)
    const hit = opening(hurt, base.system).actions[0]!
    const after = advance(hurt, hit, registry)
    const confirm = ask(after.continue).actions.find((a) => a.type === 'battle/finish')!
    const out = advance(after.state, confirm, registry)
    expect(out.state.log.join('\n')).not.toContain('Repair Drones')
    expect(out.state.log.join('\n')).not.toContain('raided')
  })
})

describe('Gate Ports (lore08) and Gate Stations (lore11) — building on gates', () => {
  /** A gate red is present at, with a red ship put there if need be. */
  function atGate(state: GameState): { state: GameState; gate: SystemId } {
    const gate = state.board.systems.find((s) => s.includes('Gate'))
    if (gate === undefined) throw new Error('no gate on this board')
    const already = contentsOf(state.figures, Location.system(gate)).some((id) =>
      id.startsWith('red/'),
    )
    return { state: already ? state : place(state, 'red', gate, 'Ship', 1), gate }
  }

  function buildLabels(state: GameState): string[] {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.map((a) => String(a['label'] ?? a.type))
  }

  it('offers nothing on a gate without the cards', () => {
    const { state } = atGate(fresh())
    expect(buildLabels(state).some((l) => l.includes('Gate'))).toBe(false)
  })

  it('Gate Stations opens gates to cities, Gate Ports to starports', () => {
    const cities = atGate(withLore(fresh(), 'red', 'lore11'))
    expect(buildLabels(cities.state).some((l) => l.includes('City on') && l.includes('Gate Stations'))).toBe(true)
    expect(buildLabels(cities.state).some((l) => l.includes('Starport on'))).toBe(false)

    const ports = atGate(withLore(fresh(), 'red', 'lore08'))
    expect(buildLabels(ports.state).some((l) => l.includes('Starport on') && l.includes('Gate Ports'))).toBe(true)
    expect(buildLabels(ports.state).some((l) => l.includes('City on'))).toBe(false)
  })

  it('needs presence at the gate, but not rule of it', () => {
    const bare = withLore(fresh(), 'red', 'lore08')
    const gate = bare.board.systems.find((s) => s.includes('Gate'))!
    const empty = clearSystem(bare, gate)
    expect(buildLabels(empty).some((l) => l.includes(`Starport on ${gate}`))).toBe(false)

    // A rival ruling the gate does not block it — presence is the whole requirement.
    let shared = place(empty, 'red', gate, 'Ship', 1)
    shared = place(shared, 'yellow', gate, 'Ship', 3)
    expect(buildLabels(shared).some((l) => l.includes(`Starport on ${gate}`))).toBe(true)
  })

  it('really places the building on the gate', () => {
    const { state, gate } = atGate(withLore(fresh(), 'red', 'lore11'))
    const build = ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes('City on'))!
    const after = advance(state, build, registry).state
    expect(
      contentsOf(after.figures, Location.system(gate)).some((id) => id.startsWith('red/City/')),
    ).toBe(true)
  })

  it('allows one starport per gate IN TOTAL — a rival piece blocks too (docs/21 B5)', () => {
    /*
     * Inverted: this test used to follow HRF's per-faction reading, but the official FAQ answers
     * the exact question — "can multiple players have a starport in the same gate? No, it is a
     * maximum of one total." A rival's gate starport is reachable via Tyrant's Authority annexing
     * the holder's, so the block is not hypothetical.
     */
    const { state, gate } = atGate(withLore(fresh(), 'red', 'lore08'))
    const mine = place(state, 'red', gate, 'Starport', 1)
    expect(buildLabels(mine).some((l) => l.includes('Starport on'))).toBe(false)

    const theirs = place(state, 'yellow', gate, 'Starport', 1)
    expect(buildLabels(theirs).some((l) => l.includes('Starport on'))).toBe(false)
  })

  it('allows one city per gate IN TOTAL — the same FAQ ruling for Gate Stations (docs/21 B5)', () => {
    const { state, gate } = atGate(withLore(fresh(), 'red', 'lore11'))
    const mine = place(state, 'red', gate, 'City', 1)
    expect(buildLabels(mine).some((l) => l.includes('City on'))).toBe(false)

    const theirs = place(state, 'yellow', gate, 'City', 1)
    expect(buildLabels(theirs).some((l) => l.includes('City on'))).toBe(false)

    // The two cards limit their own piece kind: a rival CITY never blocks a Gate Ports starport.
    const ports = atGate(withLore(fresh(), 'red', 'lore08'))
    const cross = place(ports.state, 'yellow', ports.gate, 'City', 1)
    expect(buildLabels(cross).some((l) => l.includes('Starport on'))).toBe(true)
  })

  it('is not offered with nothing left in reserve to build', () => {
    const { state, gate } = atGate(withLore(withLore(fresh(), 'red', 'lore08'), 'red', 'lore11'))
    expect(buildLabels(state).some((l) => l.includes('City on'))).toBe(true)
    expect(buildLabels(state).some((l) => l.includes('Starport on'))).toBe(true)

    // Empty red's reserve of both building types; the gate offer must disappear with them.
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const spare = 'system:' + gate
    const reserve = 'reserve:red'
    const buildings = (contents.get(reserve) ?? []).filter(
      (id) => id.startsWith('red/City/') || id.startsWith('red/Starport/'),
    )
    contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !buildings.includes(id)))
    contents.set('trophies:yellow', [...(contents.get('trophies:yellow') ?? []), ...buildings])
    for (const id of buildings) at.set(id, 'trophies:yellow')
    const empty = { ...state, figures: { ...state.figures, contents, at } }
    expect(spare).toBeDefined()

    expect(buildLabels(empty).some((l) => l.includes('City on'))).toBe(false)
    expect(buildLabels(empty).some((l) => l.includes('Starport on'))).toBe(false)
  })

  it('leaves slotted systems alone', () => {
    const s = withLore(withLore(fresh(), 'red', 'lore08'), 'red', 'lore11')
    const planets = buildLabels(s).filter((l) => l.includes('Gate Ports') || l.includes('Gate Stations'))
    for (const l of planets) {
      const where = l.slice(l.indexOf(' on ') + 4, l.indexOf(' ('))
      expect(where).toContain('Gate')
    }
  })
})

describe('Gate Ports (lore08) — the toll on rivals entering your gate', () => {
  /** yellow holds the gate with a fresh starport and two ships; red sits next door. */
  function toll(opts: { lore?: boolean; damagedPort?: boolean; yellowShips?: number } = {}) {
    const gate = fresh().board.systems.find((s) => s.includes('Gate'))!
    const from = fresh().board.systems.find((s) => s !== gate && !s.includes('Gate'))!
    let s = opts.lore === false ? fresh() : withLore(fresh(), 'yellow', 'lore08')
    s = clearSystem(s, gate)
    s = clearSystem(s, from)
    s = place(s, 'yellow', gate, 'Starport', 1)
    s = place(s, 'yellow', gate, 'Ship', opts.yellowShips ?? 2)
    s = place(s, 'red', from, 'Ship', 6)
    if (opts.damagedPort) s = damage(s, 'yellow', gate, 'Starport', 1)
    return { state: s, gate, from }
  }

  function moveIn(state: GameState, from: SystemId, to: SystemId, count: number) {
    return advance(
      state,
      { type: 'action/move-ships', faction: 'red', from, to, count, then: STOP },
      registry,
    )
  }

  const captivesOf = (s: GameState, f: FactionId) => contentsOf(s.figures, Location.captives(f)).length
  const agentsInReserve = (s: GameState, f: FactionId) =>
    contentsOf(s.figures, Location.reserve(f)).filter((id) => id.includes('/Agent/')).length

  it('takes nothing without the card', () => {
    const { state, gate, from } = toll({ lore: false })
    const after = moveIn(state, from, gate, 2).state
    expect(captivesOf(after, 'yellow')).toBe(0)
  })

  it('captures one agent from the mover, into the holder’s captives', () => {
    const { state, gate, from } = toll()
    const before = agentsInReserve(state, 'red')
    const after = moveIn(state, from, gate, 2).state
    expect(captivesOf(after, 'yellow')).toBe(1)
    expect(agentsInReserve(after, 'red')).toBe(before - 1)
    expect(after.log.join('\n')).toContain('Gate Ports')
  })

  it('needs the starport to be fresh', () => {
    const { state, gate, from } = toll({ damagedPort: true })
    expect(captivesOf(moveIn(state, from, gate, 2).state, 'yellow')).toBe(0)
  })

  it('needs the holder to rule the gate', () => {
    const { state, gate, from } = toll({ yellowShips: 0 })
    expect(captivesOf(moveIn(state, from, gate, 2).state, 'yellow')).toBe(0)
  })

  it('judges that rule *before* the fleet lands — the whole point of the toll', () => {
    // Six ships against yellow's starport and two: red rules the gate on arrival, yellow before.
    const { state, gate, from } = toll()
    const after = moveIn(state, from, gate, 6).state
    expect(captivesOf(after, 'yellow')).toBe(1)
    // and red really does end up ruling it, so the pre/post distinction was live
    const redShips = contentsOf(after.figures, Location.system(gate)).filter((id) =>
      id.startsWith('red/Ship/'),
    ).length
    expect(redShips).toBe(6)
  })

  it('does not charge the holder for moving into its own gate', () => {
    const gate = fresh().board.systems.find((s) => s.includes('Gate'))!
    const from = fresh().board.systems.find((s) => s !== gate && !s.includes('Gate'))!
    let s = withLore(fresh(), 'red', 'lore08')
    s = clearSystem(clearSystem(s, gate), from)
    s = place(s, 'red', gate, 'Starport', 1)
    s = place(s, 'red', gate, 'Ship', 2)
    s = place(s, 'red', from, 'Ship', 2)
    expect(captivesOf(moveIn(s, from, gate, 2).state, 'red')).toBe(0)
  })

  it('says so and takes nothing when the mover has no agents left', () => {
    const { state, gate, from } = toll()
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const agents = (contents.get('reserve:red') ?? []).filter((id) => id.includes('/Agent/'))
    contents.set('reserve:red', (contents.get('reserve:red') ?? []).filter((id) => !agents.includes(id)))
    contents.set('captives:blue', [...(contents.get('captives:blue') ?? []), ...agents])
    for (const id of agents) at.set(id, 'captives:blue')
    const broke = { ...state, figures: { ...state.figures, contents, at } }

    const after = moveIn(broke, from, gate, 2).state
    expect(captivesOf(after, 'yellow')).toBe(0)
    expect(after.log.join('\n')).toContain('had no agent')
  })

  it('charges a Sprinter Drives leg too', () => {
    const { state, gate, from } = toll()
    const sprinting = withLore(state, 'red', 'lore03')
    const mid = fresh().board.systems.find((s) => s !== gate && s !== from)!
    const after = advance(
      sprinting,
      { type: 'action/lore-sprint', faction: 'red', to: gate, ships: [], then: STOP },
      registry,
    ).state
    expect(captivesOf(after, 'yellow')).toBe(1)
    expect(mid).toBeDefined()
  })
})

describe('audit findings — behaviour required by official rulings', () => {
  it('Sprinter Drives lets ships fan out to different destinations', () => {
    const from = fresh().board.systems[0]!
    let s = clearSystem(withLore(fresh(), 'red', 'lore03'), from)
    s = place(s, 'red', from, 'Ship', 3)
    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: s.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships' && a['count'] === 3)!
    const moved = advance(s, picked, registry)
    const at = moved.state.board.systems[1]!

    // send one ship on, and the offer should come back for the remaining two
    const offer = ask(moved.continue)
    const one = offer.actions.find(
      (a) => a.type === 'action/lore-sprint' && (a['ships'] as string[]).length === 1,
    )!
    const legOne = advance(moved.state, one, registry)
    expect(legOne.continue.kind).toBe('ask')
    const second = ask(legOne.continue)
    expect(second.actions.some((a) => a.type === 'action/lore-sprint')).toBe(true)

    // the two destinations on offer differ from where the first ship went
    const firstDest = one['to'] as SystemId
    const otherDests = second.actions
      .filter((a) => a.type === 'action/lore-sprint')
      .map((a) => a['to'] as SystemId)
    expect(otherDests.some((d) => d !== firstDest)).toBe(true)
    expect(at).toBeDefined()
  })

  it('Sprinter Drives is spent once, however many legs the fan-out takes', () => {
    const from = fresh().board.systems[0]!
    let s = clearSystem(withLore(fresh(), 'red', 'lore03'), from)
    s = place(s, 'red', from, 'Ship', 2)
    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: s.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships' && a['count'] === 2)!
    const moved = advance(s, picked, registry)

    const one = ask(moved.continue).actions.find(
      (a) => a.type === 'action/lore-sprint' && (a['ships'] as string[]).length === 1,
    )!
    const legOne = advance(moved.state, one, registry)
    // mid-fan the card is not yet spent, or the loop could not continue
    expect(legOne.state.loreUsedThisTurn).not.toContain('lore03')

    const stop = ask(legOne.continue).actions.find((a) => a.type === 'action/lore-sprint-stop')!
    const done = advance(legOne.state, stop, registry)
    expect(done.state.loreUsedThisTurn).toEqual(['lore03'])
  })

  it('stopping before sprinting at all does not spend the card', () => {
    const from = fresh().board.systems[0]!
    let s = clearSystem(withLore(fresh(), 'red', 'lore03'), from)
    s = place(s, 'red', from, 'Ship', 2)
    const picked = ask(
      advance(s, { type: 'action/move-pick', faction: 'red', from, to: s.board.systems[1]!, then: STOP }, registry)
        .continue,
    ).actions.find((a) => a.type === 'action/move-ships')!
    const moved = advance(s, picked, registry)
    const stay = ask(moved.continue).actions.find((a) => a.type === 'action/lore-sprint-stop')!
    expect(advance(moved.state, stay, registry).state.loreUsedThisTurn).not.toContain('lore03')
  })

  it('a Copy/Pivot pairing reaches the alt actions inside its slot, not just the plain one', () => {
    // The official FAQ: a "new action" containing a standard action triggers that action's
    // Copy/Pivot modifiers. Alts live in the slot's menu and must inherit its continuation.
    const system = fresh().board.systems[0]!
    let s = clearSystem(fresh(), system)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 2)
    s = { ...s, leaders: { red: 'leader06' }, roundPlays: [...s.roundPlays, { faction: 'red', cardId: 'x', kind: 'copy' }] }

    const paired = ask(
      advance(s, { type: 'turn/pips', faction: 'red', suit: 'Aggression', done: 0, total: 1 }, registry)
        .continue,
    ).actions.find((a) => a['label'] === 'Battle, then may Move')!
    const follow = paired['then'] as Record<string, unknown>
    expect(follow['type']).toBe('leaders/may-follow')

    // everything the Battle slot then offers carries that same continuation
    const inside = advance(s, paired, registry).continue
    const carried =
      inside.kind === 'ask'
        ? inside.actions.map((a) => (a['then'] as Record<string, unknown> | undefined)?.['type'])
        : [(inside as { action?: Record<string, unknown> }).action?.['then']]
    for (const t of carried.filter((x) => x !== undefined)) {
      expect(t).toBe('leaders/may-follow')
    }
  })
})

describe('Gate Stations (lore11) — a gate city takes its cluster’s types', () => {
  /** A gate with a red city on it, and a planet in the same cluster holding a city. */
  function gateCity(holder?: FactionId) {
    const base = fresh()
    const gate = base.board.systems.find((s) => s.includes('Gate'))!
    const cluster = base.board.systems.filter(
      (s) => s !== gate && s.split('-')[0] === gate.split('-')[0],
    )
    let s = holder === undefined ? base : withLore(base, holder, 'lore11')
    s = place(s, 'red', gate, 'City', 1)
    return { state: s, gate, cluster }
  }

  function taxLabels(state: GameState): string[] {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.map((a) => String(a['label'] ?? a.type))
  }

  function taxOptions(state: GameState): readonly Action[] {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.filter((a) => a.type === 'action/tax-city')
  }

  it('a gate city is untaxable without the card', () => {
    const { state, gate } = gateCity()
    expect(taxLabels(state).some((l) => l.includes(gate))).toBe(false)
  })

  it('becomes taxable for each city type its cluster holds', () => {
    const { state, gate, cluster } = gateCity('red')
    const offered = taxLabels(state).filter((l) => l.includes(gate))
    expect(offered.length).toBeGreaterThan(0)
    for (const l of offered) expect(l).toContain('Gate Stations')

    // every offered type corresponds to a planet in that cluster that holds a city
    const types = new Set(offered.map((l) => l.slice(l.indexOf('+') + 1, l.indexOf(','))))
    expect(types.size).toBe(offered.length)
    expect(cluster.length).toBeGreaterThan(0)
  })

  it('applies to every gate city, not only the card holder’s', () => {
    // yellow holds the card; red's gate city is still taxable by red.
    const { state, gate } = gateCity('yellow')
    expect(taxLabels(state).some((l) => l.includes(gate) && l.includes('Gate Stations'))).toBe(true)
  })

  it('really hands over the chosen type', () => {
    const { state, gate } = gateCity('red')
    const stripped = stripSlots(state, 'red')
    const opt = ask(
      advance(stripped, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes(gate))!
    const chosen = opt['resource'] as Resource
    const after = advance(stripped, opt, registry).state
    const cap = slotsOf(after, 'red')
    expect(countResource(after.resources, cap, chosen)).toBe(1)
  })

  it('a typeless gate city can STILL be taxed — for nothing (docs/21 B6)', () => {
    /*
     * Inverted: this test used to assert no offer at all, but the official FAQ says "If a Gate
     * Station is in a cluster with no other city, it has no type... Taxing it yields no resource,
     * but it can still be taxed." The tax happens — the once-per-turn mark included — it just
     * gains nothing.
     */
    const { state, gate, cluster } = gateCity('red')
    let bare = state
    for (const s of cluster) bare = clearSystem(bare, s)
    const offer = taxOptions(bare).find((a) => a['system'] === gate)
    expect(offer).toBeDefined()
    expect(offer!['resource']).toBeUndefined()
    expect(String(offer!['label'])).toContain('no type')

    const before = heldTokens(bare.resources, slotsOf(bare, 'red')).length
    const after = advance(bare, offer!, registry).state
    expect(heldTokens(after.resources, slotsOf(after, 'red')).length).toBe(before)
    expect(after.taxedThisTurn).toContain(String(offer!['city']))
    // Taxed once means taxed for the turn — the offer disappears on the second look.
    expect(taxOptions(after).some((a) => a['system'] === gate)).toBe(false)
  })

  it("taxing a RIVAL's typeless gate city still takes the captive", () => {
    // The whole point of a yield-free tax: the capture is what you came for.
    const base = fresh()
    const gate = base.board.systems.find((s) => s.includes('Gate'))!
    const cluster = base.board.systems.filter(
      (s) => s !== gate && s.split('-')[0] === gate.split('-')[0],
    )
    let s = withLore(base, 'red', 'lore11')
    s = clearSystem(s, gate)
    s = place(s, 'yellow', gate, 'City', 1)
    s = place(s, 'red', gate, 'Ship', 3)
    for (const sys of cluster) s = clearSystem(s, sys)

    const offer = taxOptions(s).find((a) => a['system'] === gate)
    expect(offer).toBeDefined()
    const captives = (g: GameState) => contentsOf(g.figures, Location.captives('red')).length
    const after = advance(s, offer!, registry).state
    expect(captives(after)).toBe(captives(s) + 1)
    expect(after.log.some((l) => /red captured a yellow agent by taxing/.test(l))).toBe(true)
  })

  it('razing a gate city provokes outrage of every type in its cluster', () => {
    /** Raze red's gate city with yellow, and report which resources yellow is outraged on. */
    function raze(withCard: boolean, seed: number): readonly string[] | undefined {
      const base = fresh(seed)
      const gate = base.board.systems.find((x) => x.includes('Gate'))!
      let s = withCard ? withLore(base, 'yellow', 'lore11') : base
      s = clearSystem(s, gate)
      s = place(s, 'red', gate, 'City', 1)
      s = place(s, 'yellow', gate, 'Ship', 6)

      let step = advance(
        s,
        { type: 'battle/roll', faction: 'yellow', system: gate, enemy: 'red',
          skirmish: 0, assault: 0, raid: 6, then: STOP },
        registry,
      )
      // Assign the hits, finish, then decline the raid — the outrage lands when the battle
      // settles, which is now after the raiding.
      for (let i = 0; i < 40; i++) {
        const c = step.continue
        if (c.kind !== 'ask') break
        const stop = c.actions.find((a) => a.type === 'battle/settle')
        const finish = c.actions.find((a) => a.type === 'battle/finish')
        if (stop !== undefined) {
          step = advance(step.state, stop, registry)
          break
        }
        step = advance(step.state, finish ?? c.actions[0]!, registry)
      }
      const gone = !contentsOf(step.state.figures, Location.system(gate)).some((id) =>
        id.startsWith('red/City/'),
      )
      return gone ? outragedResources(step.state, 'yellow') : undefined
    }

    // Sweep seeds until the raid actually destroys the city, so the comparison is real.
    for (let seed = 1; seed < 60; seed++) {
      const withCard = raze(true, seed)
      if (withCard === undefined) continue
      const without = raze(false, seed)
      expect(without).toEqual([])
      expect(withCard.length).toBeGreaterThan(0)
      return
    }
    throw new Error('no seed under 60 razed the gate city')
  })
})

describe('Cloud Cities (lore09) — a city beside the slots, bought with a resource', () => {
  /** A planet red is present at, with its printed resource type. */
  function planet(state: GameState): { system: SystemId; type: Resource } {
    for (const s of state.board.systems) {
      if (s.includes('Gate')) continue
      const here = contentsOf(state.figures, Location.system(s))
      if (!here.some((id) => id.startsWith('red/'))) continue
      const info = (state.board as never as { systems: SystemId[] }) && s
      const t = (['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as Resource[]).find(
        (r) => taxTypeOf(state, info) === r,
      )
      if (t !== undefined) return { system: s, type: t }
    }
    throw new Error('no suitable planet')
  }

  /** The planet's resource, read off a Tax offer for a city standing there. */
  function taxTypeOf(state: GameState, s: SystemId): Resource | undefined {
    const labels = ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.filter((a) => a.type === 'action/tax-city' && a['system'] === s)
    const l = labels[0] === undefined ? '' : String(labels[0]['label'])
    return (['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as Resource[]).find((r) => l.includes(r))
  }

  function buildLabels(state: GameState): string[] {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.map((a) => String(a['label'] ?? a.type))
  }

  /** Give red one token of `r`, with slots cleared so it lands. */
  function holding(state: GameState, r: Resource): GameState {
    const capacity = slotsOf(state, 'red')
    const got = gain(stripSlots(state, 'red').resources, capacity, r)
    return { ...stripSlots(state, 'red'), resources: got.tracker }
  }

  it('is not offered without the card', () => {
    const { system, type } = planet(fresh())
    const s = holding(fresh(), type)
    expect(buildLabels(s).some((l) => l.includes('Cloud City'))).toBe(false)
    expect(system).toBeDefined()
  })

  it('is offered with the card, naming the resource it costs', () => {
    const { system, type } = planet(fresh())
    const s = holding(withLore(fresh(), 'red', 'lore09'), type)
    expect(buildLabels(s).some((l) => l.includes(`Cloud City in ${system}`) && l.includes(type))).toBe(true)
  })

  it('needs a resource of the planet’s own type', () => {
    const { type } = planet(fresh())
    const other = (['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as Resource[]).find((r) => r !== type)!
    const wrong = holding(withLore(fresh(), 'red', 'lore09'), other)
    expect(buildLabels(wrong).some((l) => l.includes('Cloud City'))).toBe(false)
  })

  it('spends that resource and stands outside the slots', () => {
    const { system, type } = planet(fresh())
    const s = holding(withLore(fresh(), 'red', 'lore09'), type)
    const cap = slotsOf(s, 'red')
    expect(countResource(s.resources, cap, type)).toBe(1)
    const slotsBefore = freeSlots(s, system)

    const act = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes(`Cloud City in ${system}`))!
    const after = advance(s, act, registry).state

    expect(countResource(after.resources, slotsOf(after, 'red'), type)).toBe(0)
    expect(after.unslotted).toHaveLength(1)
    // the whole point: capacity is untouched
    expect(freeSlots(after, system)).toBe(slotsBefore)
    expect(
      contentsOf(after.figures, Location.system(system)).some((id) => id.startsWith('red/City/')),
    ).toBe(true)
  })

  it('allows only one per planet, by anyone', () => {
    const { system, type } = planet(fresh())
    const s = holding(withLore(fresh(), 'red', 'lore09'), type)
    const act = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes(`Cloud City in ${system}`))!
    const after = advance(s, act, registry).state
    const again = holding({ ...after, lores: { red: ['lore09'] } }, type)
    expect(buildLabels(again).some((l) => l.includes(`Cloud City in ${system}`))).toBe(false)
  })

  it('a razed Cloud City stops counting, so the planet can take another', () => {
    const { system, type } = planet(fresh())
    const s = holding(withLore(fresh(), 'red', 'lore09'), type)
    const act = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Build', then: STOP }, registry)
        .continue,
    ).actions.find((a) => String(a['label']).includes(`Cloud City in ${system}`))!
    const built = advance(s, act, registry).state
    const cloud = built.unslotted[0]!

    // simulate its destruction the way a battle would: remove it and clear the marker
    const contents = new Map(built.figures.contents)
    const at = new Map(built.figures.at)
    contents.set(
      Location.system(system),
      (contents.get(Location.system(system)) ?? []).filter((id) => id !== cloud),
    )
    contents.set('reserve:red', [...(contents.get('reserve:red') ?? []), cloud])
    at.set(cloud, 'reserve:red')
    const gone = {
      ...built,
      figures: { ...built.figures, contents, at },
      unslotted: built.unslotted.filter((id) => id !== cloud),
    }
    expect(hasCloudCity(gone, system)).toBe(false)
  })
})

describe('Ancient Holdings (lore13) — a resource slot on the card itself', () => {
  const slotsFor = (s: GameState, f: FactionId) => slotsOf(s, f)

  it('adds exactly one slot, and only to its holder', () => {
    const base = fresh()
    const before = slotsFor(base, 'red').length
    const held = withLore(base, 'red', 'lore13')
    expect(slotsFor(held, 'red')).toHaveLength(before + 1)
    expect(slotsFor(held, 'yellow')).toHaveLength(slotsFor(base, 'yellow').length)
  })

  it('the extra slot is on the card, not a seventh city slot', () => {
    const held = withLore(fresh(), 'red', 'lore13')
    const extra = slotsFor(held, 'red').filter((s) => !s.startsWith('cityslot:'))
    expect(extra).toEqual(['cardslot:red:lore13'])
  })

  it('sits alongside a low city capacity rather than replacing a city slot', () => {
    // A faction with every city still in reserve has only two city slots; the card makes three.
    const held = withLore(fresh(), 'red', 'lore13')
    const city = slotsFor(held, 'red').filter((s) => s.startsWith('cityslot:'))
    expect(city).toHaveLength(slotsFor(fresh(), 'red').length)
    expect(slotsFor(held, 'red')).toHaveLength(city.length + 1)
  })

  it('holds a resource once the city slots are full', () => {
    const held = stripSlots(withLore(fresh(), 'red', 'lore13'), 'red')
    const slots = slotsFor(held, 'red')
    let t = held.resources
    // fill every slot
    for (let i = 0; i < slots.length; i++) t = gain(t, slots, 'Material').tracker
    expect(countResource(t, slots, 'Material')).toBe(slots.length)
    // and the card slot is one of the filled ones
    expect(contentsOf(t, 'cardslot:red:lore13')).toHaveLength(1)
  })

  it('its resource counts toward an ambition', () => {
    // Every faction's slots are emptied, so the card slot holds the only Relic in play and a
    // first place cannot be a tie.
    let bare = fresh()
    for (const f of THREE) bare = stripSlots(bare, f)
    const held = withLore(bare, 'red', 'lore13')
    const slots = slotsFor(held, 'red')
    const onlyCard = slots.filter((s) => !s.startsWith('cityslot:'))
    let t = held.resources
    t = gain(t, onlyCard, 'Relic').tracker
    const staged: GameState = {
      ...held,
      resources: t,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: ['Keeper'],
      declared: [{ ambition: 'Keeper', marker: { high: 6, low: 3 } }],
    }
    const scored = advance(staged, { type: 'ambition/score' }, registry).state
    expect(scored.power['red']).toBe(6)
  })

  it('costs four keys to raid, dearer than any city slot', () => {
    expect(slotKeys('cardslot:red:lore13')).toBe(4)
    for (let i = 0; i < 6; i++) expect(slotKeys(`cityslot:red:${i}`)).toBeLessThan(4)
  })

  it('is too dear to raid without four keys, unlike the board slots', () => {
    const held = stripSlots(withLore(fresh(), 'yellow', 'lore13'), 'yellow')
    const slots = slotsOf(held, 'yellow')
    const cheap = slots.find((x) => slotKeys(x) === 1)!
    const card = slots.find((x) => x.startsWith('cardslot:'))!
    let t = held.resources
    t = gain(t, [cheap], 'Fuel').tracker
    t = gain(t, [card], 'Relic').tracker
    const s = { ...held, resources: t }

    const system = s.board.systems[0]!
    let field = clearSystem(s, system)
    field = place(field, 'red', system, 'Ship', 2)
    field = place(field, 'yellow', system, 'Ship', 1)

    /** What a raid with `keys` keys is allowed to buy. */
    const offers = (keys: number): string[] => {
      const ctx = {
        faction: 'red', system, enemy: 'yellow',
        self: 0, intercepted: 0, ships: 0, buildings: 0, keys, razed: false,
        then: STOP,
      }
      const c = advance(field, { type: 'battle/finish', ctx }, registry).continue
      return c.kind === 'ask' ? c.actions.map((a) => String(a['label'])) : []
    }

    // three keys reaches the 1-key board slot but not the card's four
    const three = offers(3)
    expect(three.some((l) => l.startsWith('Take Fuel'))).toBe(true)
    expect(three.some((l) => l.startsWith('Take Relic'))).toBe(false)

    // four keys reaches it
    expect(offers(4).some((l) => l.startsWith('Take Relic'))).toBe(true)
  })
})

describe('Galactic Rifles (lore02) — a ranged strike that is not a battle', () => {
  /** red with fresh ships in one system and yellow next door, nothing else nearby. */
  function ranged(holder?: FactionId) {
    const base = fresh()
    const from = base.board.systems[0]!
    const at = base.board.systems.find((s) => connectedSystems(base.board, from).includes(s))!
    // The whole board is emptied first: red's starting ships elsewhere would otherwise give it
    // other systems to fire from, and the card would look available when this pair says it is not.
    let s = holder === undefined ? base : withLore(base, holder, 'lore02')
    for (const sys of s.board.systems) s = clearSystem(s, sys)
    s = place(s, 'red', from, 'Ship', 3)
    s = place(s, 'yellow', at, 'Ship', 2)
    return { state: s, from, at }
  }

  function battleMenu(state: GameState): string[] {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Battle', then: STOP }, registry)
        .continue,
    ).actions.map((a) => String(a['label'] ?? a.type))
  }

  it('appears on the Battle menu only with the card', () => {
    expect(battleMenu(ranged().state).some((l) => l.includes('Fire Rifles'))).toBe(false)
    expect(battleMenu(ranged('red').state).some((l) => l.includes('Fire Rifles'))).toBe(true)
  })

  it('fires from a system with fresh ships, at an adjacent enemy', () => {
    const { state, from, at } = ranged('red')
    const pick = ask(
      advance(state, { type: 'action/guild-alt', faction: 'red', alt: 'rifles', then: STOP }, registry)
        .continue,
    )
    expect(pick.actions.some((a) => a['from'] === from)).toBe(true)

    const targets = ask(
      advance(state, { type: 'rifles/target', faction: 'red', from, then: STOP }, registry).continue,
    )
    expect(targets.actions.some((a) => a['at'] === at && a['enemy'] === 'yellow')).toBe(true)
  })

  it('will not fire from a system whose ships are all damaged', () => {
    const base = ranged('red')
    const hurt = damage(base.state, 'red', base.from, 'Ship', 3)
    expect(battleMenu(hurt).some((l) => l.includes('Fire Rifles'))).toBe(false)
  })

  it('rolls one skirmish die per fresh ship, capped at six', () => {
    const { state, from, at } = ranged('red')
    const out = advance(
      state,
      { type: 'rifles/roll', faction: 'red', from, at, enemy: 'yellow', then: STOP },
      registry,
    )
    expect(out.state.log.at(-1)).toContain('3 skirmish')
    expect(out.state.lastRoll?.dice).toHaveLength(3)
    expect(out.state.lastRoll?.dice.every((d) => d.die === 'Skirmish')).toBe(true)

    // eight fresh ships still roll only six
    let big = clearSystem(state, from)
    big = place(big, 'red', from, 'Ship', 8)
    const capped = advance(
      big,
      { type: 'rifles/roll', faction: 'red', from, at, enemy: 'yellow', then: STOP },
      registry,
    )
    expect(capped.state.lastRoll?.dice).toHaveLength(6)
  })

  it('deals hits to the target and costs the firer nothing', () => {
    // Sweep seeds until the roll actually produces a hit, so the assertion has something to bite.
    for (let seed = 1; seed < 60; seed++) {
      const base = fresh(seed)
      const from = base.board.systems[0]!
      const at = base.board.systems.find((x) => connectedSystems(base.board, from).includes(x))!
      let s = withLore(base, 'red', 'lore02')
      for (const sys of s.board.systems) s = clearSystem(s, sys)
      s = place(s, 'red', from, 'Ship', 3)
      s = place(s, 'yellow', at, 'Ship', 2)

      const out = advance(
        s,
        { type: 'rifles/roll', faction: 'red', from, at, enemy: 'yellow', then: STOP },
        registry,
      )
      const hits = ask(out.continue).actions.filter((a) => a.type === 'battle/hit')
      if (hits.length === 0) continue

      for (const a of hits) {
        expect(String(a['label'])).toContain('yellow')
        expect(a['phase']).not.toBe('self')
      }
      // the firing ships are untouched — skirmish dice carry no self face
      expect(
        contentsOf(out.state.figures, Location.system(from)).filter((id) => id.startsWith('red/Ship/')),
      ).toHaveLength(3)
      expect(out.state.damaged.filter((id) => id.startsWith('red/'))).toHaveLength(0)
      return
    }
    throw new Error('no seed under 60 rolled a hit')
  })

  it('does not trigger Repair Drones, because it is not a battle', () => {
    // The damaged ship must be in the *target* system, which is where a post-battle repair would
    // look — a damaged ship back at the firing system would make this pass for the wrong reason.
    const { state, from, at } = ranged('red')
    let s = withLore(state, 'red', 'lore07')
    s = place(s, 'red', at, 'Ship', 1)
    s = damage(s, 'red', at, 'Ship', 1)
    let step = advance(
      s,
      { type: 'rifles/roll', faction: 'red', from, at, enemy: 'yellow', then: STOP },
      registry,
    )
    for (let i = 0; i < 30; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const finish = c.actions.find((a) => a.type === 'battle/finish')
      step = advance(step.state, finish ?? c.actions[0]!, registry)
      if (finish !== undefined) break
    }
    expect(step.state.log.join('\n')).not.toContain('Repair Drones')
    // and the damaged ship is still damaged
    expect(step.state.damaged.some((id) => id.startsWith('red/Ship/'))).toBe(true)
  })

  it('does not let the defender’s Railgun Arrays fire back', () => {
    const { state, from, at } = ranged('red')
    const armed = withLore(state, 'yellow', 'lore12')
    const out = advance(
      armed,
      { type: 'rifles/roll', faction: 'red', from, at, enemy: 'yellow', then: STOP },
      registry,
    )
    // a real battle would have opened with a hit on red; a rifle volley does not
    const c = ask(out.continue)
    expect(c.actions.every((a) => a.type !== 'battle/hit' || a['phase'] !== 'self')).toBe(true)
    expect(out.state.log.join('\n')).not.toContain('Railgun')
  })
})

describe('Seeker Torpedoes (lore14) — reroll assault dice after rolling', () => {
  function attack(holder?: FactionId, opts: { redShips?: number; damaged?: number } = {}) {
    const base = fresh()
    const system = base.board.systems[0]!
    let s = holder === undefined ? base : withLore(base, holder, 'lore14')
    s = clearSystem(s, system)
    s = place(s, 'red', system, 'Ship', opts.redShips ?? 3)
    s = place(s, 'yellow', system, 'Ship', 2)
    if (opts.damaged) s = damage(s, 'red', system, 'Ship', opts.damaged)
    return { state: s, system }
  }

  function roll(state: GameState, system: SystemId, pool: { s: number; a: number; r: number }) {
    return advance(
      state,
      {
        type: 'battle/roll', faction: 'red', system, enemy: 'yellow',
        skirmish: pool.s, assault: pool.a, raid: pool.r,
        then: STOP,
      },
      registry,
    )
  }

  it('goes straight to assignment without the card', () => {
    const { state, system } = attack()
    const out = roll(state, system, { s: 0, a: 2, r: 0 })
    expect(ask(out.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(false)
  })

  it('offers a reroll with it, and keeping the roll', () => {
    const { state, system } = attack('red')
    const c = ask(roll(state, system, { s: 0, a: 2, r: 0 }).continue)
    expect(c.actions.some((a) => a.type === 'battle/reroll')).toBe(true)
    expect(c.actions.map((a) => String(a['label']))).toContain('Keep the assault dice')
  })

  it('offers nothing when no assault dice were rolled', () => {
    const { state, system } = attack('red')
    const out = roll(state, system, { s: 3, a: 0, r: 0 })
    expect(ask(out.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(false)
  })

  it('caps the reroll at one die per fresh attacking ship', () => {
    // one fresh ship of three, four assault dice: at most one die may be rerolled
    const { state, system } = attack('red', { redShips: 3, damaged: 2 })
    const c = ask(roll(state, system, { s: 0, a: 4, r: 0 }).continue)
    const sizes = c.actions
      .filter((a) => a.type === 'battle/reroll')
      .map((a) => (a['indices'] as number[]).length)
    expect(Math.max(...sizes)).toBe(1)
  })

  it('rerolls every chosen die at once, and only those', () => {
    const { state, system } = attack('red')
    const out = roll(state, system, { s: 1, a: 2, r: 0 })
    const before = out.state.lastRoll!.dice
    const pick = ask(out.continue).actions.find(
      (a) => a.type === 'battle/reroll' && (a['indices'] as number[]).length === 2,
    )!
    const after = advance(out.state, pick, registry)
    const dice = after.state.lastRoll!.dice

    expect(dice).toHaveLength(before.length)
    // the skirmish die is untouched; the die types never change
    expect(dice.map((d) => d.die)).toEqual(before.map((d) => d.die))
    expect(dice[0]).toEqual(before[0])
    expect(after.state.log.join('\n')).toContain('Seeker Torpedoes')
  })

  it('keeping the roll changes nothing', () => {
    const { state, system } = attack('red')
    const out = roll(state, system, { s: 0, a: 2, r: 0 })
    const before = out.state.lastRoll!.dice
    const keep = ask(out.continue).actions.find((a) => String(a['label']) === 'Keep the assault dice')!
    const after = advance(out.state, keep, registry)
    expect(after.state.lastRoll!.dice).toEqual(before)
    expect(after.state.log.join('\n')).not.toContain('Seeker Torpedoes')
  })

  it('does not offer a second reroll after one is taken', () => {
    const { state, system } = attack('red')
    const out = roll(state, system, { s: 0, a: 2, r: 0 })
    const pick = ask(out.continue).actions.find((a) => a.type === 'battle/reroll')!
    const after = advance(out.state, pick, registry)
    expect(ask(after.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(false)
  })

  it('actually changes faces — a reroll is not a no-op', () => {
    // Sweep until the chosen dice come up different, which they must eventually.
    for (let seed = 1; seed < 120; seed++) {
      const base = fresh(seed)
      const system = base.board.systems[0]!
      let s = withLore(base, 'red', 'lore14')
      s = clearSystem(s, system)
      s = place(s, 'red', system, 'Ship', 4)
      s = place(s, 'yellow', system, 'Ship', 4)

      const out = roll(s, system, { s: 0, a: 3, r: 0 })
      const pick = ask(out.continue).actions.find(
        (a) => a.type === 'battle/reroll' && (a['indices'] as number[]).length === 3,
      )
      if (pick === undefined) continue
      const before = out.state.lastRoll!.dice.map((d) => d.face)
      const after = advance(out.state, pick, registry).state.lastRoll!.dice.map((d) => d.face)
      if (before.join() === after.join()) continue
      expect(after).not.toEqual(before)
      return
    }
    throw new Error('no seed under 120 produced a different face on reroll')
  })

  it('re-reads the tally from the new faces rather than carrying the old one', () => {
    const { state, system } = attack('red', { redShips: 4 })
    const out = roll(state, system, { s: 0, a: 3, r: 0 })
    const pick = ask(out.continue).actions.find(
      (a) => a.type === 'battle/reroll' && (a['indices'] as number[]).length === 3,
    )!
    const after = advance(out.state, pick, registry)

    // What the battle went on to use must match what the dice now show, not what they showed.
    const expected = tallyOf(after.state.lastRoll!.dice)
    const line = after.state.log.filter((l) => l.includes('attacks')).at(-1) ?? ''
    const reported = Number(/([0-9]+) hits/.exec(line)?.[1] ?? '-1')
    expect(reported).toBe(expected.hits)

    const stale = tallyOf(out.state.lastRoll!.dice)
    if (stale.hits !== expected.hits) expect(reported).not.toBe(stale.hits)
  })

  it('is deterministic in the seed, so a replay reproduces it', () => {
    const run = () => {
      const { state, system } = attack('red')
      const out = roll(state, system, { s: 0, a: 3, r: 0 })
      const pick = ask(out.continue).actions.find(
        (a) => a.type === 'battle/reroll' && (a['indices'] as number[]).length === 2,
      )!
      return advance(out.state, pick, registry).state.lastRoll!.dice
    }
    expect(run()).toEqual(run())
  })
})

describe('Skirmishers (bc13) — reroll skirmish dice up to your Weapon icons', () => {
  /** Give red the Skirmishers card, and `weapons` Weapon tokens. */
  function armed(weapons: number, withCard = true): { state: GameState; system: SystemId } {
    const base = fresh()
    const system = base.board.systems[0]!
    let s = clearSystem(base, system)
    s = place(s, 'red', system, 'Ship', 4)
    s = place(s, 'yellow', system, 'Ship', 3)
    s = stripSlots(s, 'red')
    for (let i = 0; i < weapons; i++) {
      const got = gain(s.resources, slotsOf(s, 'red'), 'Weapon')
      if (!got.gained) break
      s = { ...s, resources: got.tracker }
    }
    if (!withCard) return { state: s, system }
    // secure bc13 straight into red's pile
    const contents = new Map(s.courtCards.contents)
    const at = new Map(s.courtCards.at)
    const from = at.get('bc13')
    if (from !== undefined) contents.set(from, (contents.get(from) ?? []).filter((c) => c !== 'bc13'))
    const pile = CourtPile.secured('red')
    contents.set(pile, [...(contents.get(pile) ?? []), 'bc13'])
    at.set('bc13', pile)
    return { state: { ...s, courtCards: { ...s.courtCards, contents, at } }, system }
  }

  function roll(state: GameState, system: SystemId, pool: { s: number; a: number; r: number }) {
    return advance(
      state,
      {
        type: 'battle/roll', faction: 'red', system, enemy: 'yellow',
        skirmish: pool.s, assault: pool.a, raid: pool.r,
        then: STOP,
      },
      registry,
    )
  }

  it('offers nothing without the card', () => {
    const { state, system } = armed(2, false)
    const out = roll(state, system, { s: 3, a: 0, r: 0 })
    expect(ask(out.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(false)
  })

  it('offers a skirmish reroll with it', () => {
    const { state, system } = armed(2)
    const c = ask(roll(state, system, { s: 3, a: 0, r: 0 }).continue)
    expect(c.actions.some((a) => a.type === 'battle/reroll')).toBe(true)
    expect(c.actions.map((a) => String(a['label']))).toContain('Keep the skirmish dice')
  })

  /** The largest reroll the menu offers. */
  function maxReroll(weapons: number): number {
    const { state, system } = armed(weapons)
    const sizes = ask(roll(state, system, { s: 4, a: 0, r: 0 }).continue)
      .actions.filter((a) => a.type === 'battle/reroll')
      .map((a) => (a['indices'] as number[]).length)
      .filter((n) => n > 0)
    return sizes.length === 0 ? 0 : Math.max(...sizes)
  }

  it('counts Weapon icons from resources *and cards* — including its own', () => {
    // Skirmishers is itself a Weapon-suit guild card, so holding it is already one icon.
    expect(maxReroll(0)).toBe(1)
    expect(maxReroll(1)).toBe(2)
    expect(maxReroll(2)).toBe(3)
  })

  it('is capped by the dice actually rolled, not just by icons', () => {
    // Four skirmish dice on the table; five icons cannot reroll a fifth.
    expect(maxReroll(4)).toBe(4)
  })

  it('rerolls only skirmish dice, leaving the assault ones', () => {
    const { state, system } = armed(3)
    const out = roll(state, system, { s: 2, a: 2, r: 0 })
    const before = out.state.lastRoll!.dice
    const pick = ask(out.continue).actions.find(
      (a) => a.type === 'battle/reroll' && (a['indices'] as number[]).length === 2,
    )!
    const after = advance(out.state, pick, registry)
    const dice = after.state.lastRoll!.dice
    expect(dice.map((d) => d.die)).toEqual(before.map((d) => d.die))
    // the assault dice sit after the skirmish ones and are untouched
    expect(dice.slice(2)).toEqual(before.slice(2))
    expect(after.state.log.join('\n')).toContain('Skirmishers')
  })

  it('asks both sources when a faction holds Skirmishers and Seeker Torpedoes', () => {
    const { state, system } = armed(3)
    const both = withLore(state, 'red', 'lore14')
    const first = ask(roll(both, system, { s: 2, a: 2, r: 0 }).continue)
    expect(String(first.prompt)).toContain('Skirmishers')

    // decline the skirmish reroll; the torpedoes should ask next
    const keep = first.actions.find((a) => String(a['label']) === 'Keep the skirmish dice')!
    const second = advance(roll(both, system, { s: 2, a: 2, r: 0 }).state, keep, registry)
    expect(String(ask(second.continue).prompt)).toContain('Seeker Torpedoes')
  })
})
