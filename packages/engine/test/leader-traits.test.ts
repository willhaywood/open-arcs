/**
 * Leaders and Lore, phase 3 — the base game's trait effects.
 *
 * Each test pins one trait to the behaviour printed on its card, checked against the HRF line
 * cited in the implementation. The traits are injected onto `state.leaders` rather than drafted:
 * the draft is already covered by `leaders-draft.test.ts`, and dealing is seeded, so driving it
 * to hand a chosen leader to a chosen faction would test the shuffle rather than the trait.
 *
 * Every trait test is paired with the same situation *without* the leader. That pairing is the
 * point — a trait that silently did nothing would pass a one-sided assertion, and this is exactly
 * the failure mode phase 3 is prone to, since a trait's absence looks identical to a base game.
 */

import { describe, expect, it } from 'vitest'

import {
  CourtPile,
  Location,
  advance,
  citiesInReserve,
  contentsOf,
  countResource,
  courtCard,
  courtSlots,
  defaultRegistry,
  gain,
  hasTrait,
  slotsOf,
  isOutraged,
  leaderCard,
  rules,
  slotCapacity,
  startGame,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, Resource, SystemId } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

type Ask = Extract<Continue, { kind: 'ask' }>

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

/** Give a faction a leader without running the draft. */
function withLeader(state: GameState, faction: FactionId, leaderId: string): GameState {
  return { ...state, leaders: { ...state.leaders, [faction]: leaderId } }
}

/**
 * A `then` for offers that are only inspected, never advanced past.
 *
 * Actions that merely *offer* never run it. Actions that complete — Tax — do, so it has to be a
 * real action that terminates: `turn/lead-main` presents red's own menu and stops there, without
 * touching anything a trait test measures.
 */
const STOP = { type: 'turn/lead-main', faction: 'red' } as const

function ask(c: Continue): Ask {
  if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
  return c
}

function labels(c: Continue): string[] {
  return ask(c)
    .actions.map((a) => String(a['label'] ?? a.type))
}

/** Move `n` of a colour's pieces from reserve into a system. */
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

/** Empty a system so a test controls exactly who is in it. */
function clearSystem(state: GameState, system: SystemId): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const dest = Location.system(system)
  for (const id of contents.get(dest) ?? []) {
    const color = id.slice(0, id.indexOf('/'))
    const reserve = `reserve:${color}`
    contents.set(reserve, [...(contents.get(reserve) ?? []), id])
    at.set(id, reserve)
  }
  contents.set(dest, [])
  return { ...state, figures: { ...state.figures, contents, at } }
}

/** Record a card play for the round, which is how the engine knows a Copy or Pivot happened. */
function played(state: GameState, faction: FactionId, kind: 'lead' | 'copy' | 'pivot'): GameState {
  return { ...state, roundPlays: [...state.roundPlays, { faction, cardId: 'x', kind }] }
}

/** Return every resource token a faction holds to the supply, freeing all its slots. */
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

function give(state: GameState, faction: FactionId, r: Resource, n: number): GameState {
  const capacity = slotsOf(state, faction)
  let resources = state.resources
  for (let i = 0; i < n; i++) {
    const got = gain(resources, capacity, r)
    if (!got.gained) break
    resources = got.tracker
  }
  return { ...state, resources }
}

// ---------------------------------------------------------------------------

describe('hasTrait', () => {
  it('is false for every trait in a base game, so base rules are untouched', () => {
    const base = fresh()
    expect(base.leaders).toEqual({})
    expect(hasTrait(base, 'red', 'Committed')).toBe(false)
    expect(hasTrait(base, 'red', 'Just')).toBe(false)
  })

  it('reads the drafted leader, and only that faction', () => {
    const s = withLeader(fresh(), 'red', 'leader05')
    expect(leaderCard('leader05').name).toBe('Rebel')
    expect(hasTrait(s, 'red', 'Committed')).toBe(true)
    expect(hasTrait(s, 'red', 'Disorganized')).toBe(true)
    expect(hasTrait(s, 'yellow', 'Committed')).toBe(false)
    expect(hasTrait(s, 'red', 'Just')).toBe(false)
  })
})

describe('Committed (Rebel) — two extra battle dice', () => {
  /** The highest dice total the gather menu offers. */
  function maxTotal(state: GameState, system: SystemId, enemy: string): number {
    const c = advance(
      state,
      { type: 'battle/target', faction: 'red', system, enemy, then: STOP },
      registry,
    ).continue
    const totals = ask(c)
      .actions.filter((a) => a.type === 'battle/roll')
      .map((a) => (a['skirmish'] as number) + (a['assault'] as number) + (a['raid'] as number))
    return Math.max(...totals)
  }

  function contested(state: GameState): { state: GameState; system: SystemId } {
    const system = state.board.systems[0]!
    let s = clearSystem(state, system)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 2)
    return { state: s, system }
  }

  it('rolls at most one die per ship without the leader', () => {
    const { state, system } = contested(fresh())
    expect(maxTotal(state, system, 'yellow')).toBe(3)
  })

  it('rolls two dice more than it has ships with it', () => {
    const { state, system } = contested(withLeader(fresh(), 'red', 'leader05'))
    expect(maxTotal(state, system, 'yellow')).toBe(5)
  })

  it('does not lend the bonus to the other side', () => {
    const { state, system } = contested(withLeader(fresh(), 'yellow', 'leader05'))
    expect(maxTotal(state, system, 'yellow')).toBe(3)
  })
})

describe('Disorganized (Rebel) — never move more than 2 ships', () => {
  function sizes(state: GameState, from: SystemId, to: SystemId): number[] {
    const c = advance(
      state,
      { type: 'action/move-pick', faction: 'red', from, to, then: STOP },
      registry,
    ).continue
    return ask(c)
      .actions.filter((a) => a.type === 'action/move-ships')
      .map((a) => a['count'] as number)
  }

  function fleetOf4(state: GameState): { state: GameState; from: SystemId; to: SystemId } {
    const from = state.board.systems[0]!
    const to = state.board.systems[1]!
    let s = clearSystem(state, from)
    s = place(s, 'red', from, 'Ship', 4)
    return { state: s, from, to }
  }

  it('offers the whole fleet without the leader', () => {
    const { state, from, to } = fleetOf4(fresh())
    expect(sizes(state, from, to)).toEqual([4, 3, 2, 1])
  })

  it('offers at most two with it', () => {
    const { state, from, to } = fleetOf4(withLeader(fresh(), 'red', 'leader05'))
    expect(sizes(state, from, to)).toEqual([2, 1])
  })
})

describe('Insatiable (Fuel Drinker) and Attuned (Mystic) — a bonus resource when taxing', () => {
  /** Tax red's first city and report what red gained. */
  function taxAndCount(state: GameState, r: Resource): number {
    const city = contentsOf(state.figures, Location.system(state.board.systems[0]!)).find((id) =>
      id.startsWith('red/City/'),
    )
    // Find a system red actually has a city in, whatever the setup produced.
    let system = state.board.systems[0]!
    let found = city
    if (found === undefined) {
      for (const s of state.board.systems) {
        const c = contentsOf(state.figures, Location.system(s)).find((id) => id.startsWith('red/City/'))
        if (c !== undefined) {
          system = s
          found = c
          break
        }
      }
    }
    if (found === undefined) throw new Error('red has no city to tax')
    const after = advance(
      state,
      { type: 'action/tax-city', faction: 'red', system, city: found, then: STOP },
      registry,
    ).state
    const capacity = slotsOf(after, 'red')
    return countResource(after.resources, capacity, r)
  }

  /** Slots emptied first, so a gained resource always has somewhere to go. */
  function ready(leaderId: string | undefined, kind: 'lead' | 'copy' | 'pivot'): GameState {
    const base = stripSlots(fresh(), 'red')
    return played(leaderId === undefined ? base : withLeader(base, 'red', leaderId), 'red', kind)
  }

  it('gives the Fuel Drinker nothing extra on a Lead', () => {
    expect(taxAndCount(ready('leader03', 'lead'), 'Fuel')).toBe(
      taxAndCount(ready(undefined, 'lead'), 'Fuel'),
    )
  })

  it('gives the Fuel Drinker a Fuel alongside a Copy tax', () => {
    expect(taxAndCount(ready('leader03', 'copy'), 'Fuel')).toBe(
      taxAndCount(ready(undefined, 'copy'), 'Fuel') + 1,
    )
  })

  it('gives the Mystic a Psionic alongside a Pivot tax', () => {
    expect(taxAndCount(ready('leader02', 'pivot'), 'Psionic')).toBe(
      taxAndCount(ready(undefined, 'pivot'), 'Psionic') + 1,
    )
  })

  it('gives a leaderless faction nothing on a Copy', () => {
    expect(taxAndCount(ready(undefined, 'copy'), 'Fuel')).toBe(
      taxAndCount(ready(undefined, 'lead'), 'Fuel'),
    )
  })
})

describe('Cryptic (Mystic) — starts outraged on Material and Fuel', () => {
  /**
   * Draft for real, sweeping seeds until red is *offered* the leader under test and takes it.
   * Cryptic fires during the seating the draft leads into, so it cannot be injected after the
   * fact the way the other traits can.
   */
  function seated(leaderId: string): GameState {
    for (let seed = 1; seed < 120; seed++) {
      let step = startGame(
        { board: 'Board3MixUp', factions: [...THREE], seed, leadersAndLore: { lorePerPlayer: 1 } },
        registry,
      )
      for (let i = 0; i < 200; i++) {
        const c = step.continue
        if (c.kind !== 'ask') break
        const takes = c.actions.filter((a) => a.type === 'leaders/take')
        if (takes.length === 0) break
        const wanted = c.faction === 'red' ? takes.find((a) => a['card'] === leaderId) : undefined
        step = advance(step.state, wanted ?? takes[0]!, registry)
      }
      if (step.state.leaders['red'] === leaderId) return step.state
    }
    throw new Error(`no seed under 120 let red draft ${leaderId}`)
  }

  it('is outraged on exactly Material and Fuel when the Mystic is seated', () => {
    // Seed 3 is chosen because it deals leader02; assert that rather than assume it.
    const s = seated('leader02')
    expect(s.leaders['red']).toBe('leader02')
    expect(isOutraged(s, 'red', 'Material')).toBe(true)
    expect(isOutraged(s, 'red', 'Fuel')).toBe(true)
    expect(isOutraged(s, 'red', 'Psionic')).toBe(false)
    expect(isOutraged(s, 'red', 'Relic')).toBe(false)
    expect(isOutraged(s, 'red', 'Weapon')).toBe(false)
  })

  it('leaves factions without the trait unoutraged', () => {
    const s = seated('leader02')
    for (const f of ['yellow', 'blue'] as const) {
      if (s.leaders[f] === 'leader02') continue
      expect(isOutraged(s, f, 'Material')).toBe(false)
      expect(isOutraged(s, f, 'Fuel')).toBe(false)
    }
  })
})

describe('Paranoid (Demagogue) — no securing a Guild card held by one agent', () => {
  function agents(state: GameState, who: string, slot: number, n: number): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const reserve = `reserve:${who}`
    const court = Location.court(slot)
    const picked = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`${who}/Agent/`)).slice(0, n)
    contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !picked.includes(id)))
    contents.set(court, [...(contents.get(court) ?? []), ...picked])
    for (const id of picked) at.set(id, court)
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  function secureLabels(state: GameState): string[] {
    return labels(
      advance(state, { type: 'action/take', faction: 'red', action: 'Secure', then: STOP }, registry)
        .continue,
    )
  }

  /** The first court slot holding a card of this kind. Slots are numbered from 1. */
  function slotOfKind(state: GameState, kind: 'guild' | 'vox'): number {
    for (const n of courtSlots(state.factions.length)) {
      const card = contentsOf(state.courtCards, CourtPile.slot(n))[0]
      if (card !== undefined && courtCard(card).kind === kind) return n
    }
    throw new Error(`no ${kind} card in court`)
  }

  it('secures a Guild card on one agent without the leader', () => {
    const base = fresh()
    const slot = slotOfKind(base, 'guild')
    const s = agents(base, 'red', slot, 1)
    expect(secureLabels(s).some((l) => l.startsWith('Secure'))).toBe(true)
  })

  it('cannot secure that same card with the leader', () => {
    const base = withLeader(fresh(), 'red', 'leader08')
    const slot = slotOfKind(base, 'guild')
    const s = agents(base, 'red', slot, 1)
    expect(secureLabels(s).some((l) => l.startsWith('Secure'))).toBe(false)
  })

  it('secures the same Guild card once a second agent is on it', () => {
    const base = withLeader(fresh(), 'red', 'leader08')
    const slot = slotOfKind(base, 'guild')
    const s = agents(base, 'red', slot, 2)
    expect(secureLabels(s).some((l) => l.startsWith('Secure'))).toBe(true)
  })

  it('leaves Vox cards alone, as the card says explicitly', () => {
    // The opening court is dealt from the seed and need not contain a Vox card at all.
    let base: GameState | undefined
    let slot = 0
    for (let seed = 1; seed < 60 && base === undefined; seed++) {
      const candidate = withLeader(fresh(seed), 'red', 'leader08')
      for (const n of courtSlots(candidate.factions.length)) {
        const card = contentsOf(candidate.courtCards, CourtPile.slot(n))[0]
        if (card !== undefined && courtCard(card).kind === 'vox') {
          base = candidate
          slot = n
          break
        }
      }
    }
    if (base === undefined) throw new Error('no seed under 60 dealt a Vox card into the court')
    expect(secureLabels(agents(base, 'red', slot, 1)).some((l) => l.startsWith('Secure'))).toBe(true)
  })
})

describe('Just (Elder) on Tyrant and Violent (Warrior) on Empath', () => {
  /** A scored round with one declared ambition, and what each faction ended up with. */
  function scored(
    state: GameState,
    ambition: 'Tyrant' | 'Empath',
    marker: { high: number; low: number },
  ): Partial<Record<FactionId, number>> {
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: [ambition],
      declared: [{ ambition, marker }],
    }
    return advance(staged, { type: 'ambition/score' }, registry).state.power
  }

  /** red 3 captives, yellow 1: red first, yellow second. */
  function captives(state: GameState, faction: FactionId, from: string, n: number): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const reserve = `reserve:${from}`
    const pile = `captives:${faction}`
    const agents = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`${from}/Agent/`)).slice(0, n)
    contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !agents.includes(id)))
    contents.set(pile, [...(contents.get(pile) ?? []), ...agents])
    for (const a of agents) at.set(a, pile)
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  function tyrantRace(leaderFor?: FactionId): GameState {
    let s = fresh()
    s = captives(s, 'red', 'blue', 3)
    s = captives(s, 'yellow', 'blue', 1)
    return leaderFor === undefined ? s : withLeader(s, leaderFor, 'leader01')
  }

  it('pays a normal first place without the leader', () => {
    const power = scored(tyrantRace(), 'Tyrant', { high: 6, low: 3 })
    expect(power['red']).toBe(6)
    expect(power['yellow']).toBe(3)
  })

  it('pays the Elder the second-place value for winning Tyrant', () => {
    const power = scored(tyrantRace('red'), 'Tyrant', { high: 6, low: 3 })
    expect(power['red']).toBe(3)
    expect(power['yellow']).toBe(3)
  })

  it('pays the Elder nothing for placing second in Tyrant', () => {
    const power = scored(tyrantRace('yellow'), 'Tyrant', { high: 6, low: 3 })
    expect(power['red']).toBe(6)
    expect(power['yellow']).toBe(0)
  })

  it('drops the city bonus too, which is what "no bonus city Power" means', () => {
    // Four cities off the board leaves one in reserve: a 2 + 3 bonus on a normal first place.
    const onBoard = (s: GameState): GameState => {
      let out = s
      const systems = s.board.systems
      for (let i = 0; i < 4; i++) out = place(out, 'red', systems[i]!, 'City', 1)
      return out
    }
    const plain = scored(onBoard(tyrantRace()), 'Tyrant', { high: 6, low: 3 })
    const elder = scored(onBoard(tyrantRace('red')), 'Tyrant', { high: 6, low: 3 })
    expect(plain['red']).toBe(6 + 5)
    expect(elder['red']).toBe(3)
  })

  it('leaves the Elder alone on every ambition but Tyrant', () => {
    let s = stripSlots(stripSlots(fresh(), 'red'), 'yellow')
    s = give(s, 'red', 'Psionic', 3)
    s = give(s, 'yellow', 'Psionic', 1)
    const plain = scored(s, 'Empath', { high: 6, low: 3 })
    const elder = scored(withLeader(s, 'red', 'leader01'), 'Empath', { high: 6, low: 3 })
    expect(elder['red']).toBe(plain['red'])
  })

  it('does the same for the Warrior, on Empath instead', () => {
    // Slots emptied first: with the opening resources still in place both sides tie on Psionic,
    // and a tie pays the low value to everyone, which would hide the trait entirely.
    let s = stripSlots(stripSlots(fresh(), 'red'), 'yellow')
    s = give(s, 'red', 'Psionic', 3)
    s = give(s, 'yellow', 'Psionic', 1)
    const plain = scored(s, 'Empath', { high: 6, low: 3 })
    const warrior = scored(withLeader(s, 'red', 'leader06'), 'Empath', { high: 6, low: 3 })
    expect(plain['red']).toBe(6)
    expect(warrior['red']).toBe(3)
    // and not on Tyrant, which is the Elder's ambition
    const onTyrant = scored(withLeader(tyrantRace(), 'red', 'leader06'), 'Tyrant', { high: 6, low: 3 })
    expect(onTyrant['red']).toBe(6)
  })
})

describe('Lavish (Fuel Drinker) — Fuel burns when Tycoon is scored', () => {
  function scoreWith(state: GameState, declared: 'Tycoon' | 'Keeper'): GameState {
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: [declared],
      declared: [{ ambition: declared, marker: { high: 6, low: 3 } }],
    }
    return advance(staged, { type: 'ambition/score' }, registry).state
  }

  function fuelOf(state: GameState, faction: FactionId): number {
    return countResource(
      state.resources,
      slotsOf(state, faction),
      'Fuel',
    )
  }

  it('keeps its Fuel when Tycoon was not declared', () => {
    const s = give(stripSlots(withLeader(fresh(), 'red', 'leader03'), 'red'), 'red', 'Fuel', 2)
    expect(fuelOf(scoreWith(s, 'Keeper'), 'red')).toBe(2)
  })

  it('loses all of it when Tycoon was', () => {
    const s = give(stripSlots(withLeader(fresh(), 'red', 'leader03'), 'red'), 'red', 'Fuel', 2)
    expect(fuelOf(s, 'red')).toBe(2)
    expect(fuelOf(scoreWith(s, 'Tycoon'), 'red')).toBe(0)
  })

  it('burns only the Fuel Drinker, and only its Fuel', () => {
    let s = stripSlots(withLeader(fresh(), 'red', 'leader03'), 'red')
    s = stripSlots(s, 'yellow')
    s = give(s, 'red', 'Fuel', 1)
    s = give(s, 'red', 'Relic', 1)
    s = give(s, 'yellow', 'Fuel', 2)
    const after = scoreWith(s, 'Tycoon')
    expect(fuelOf(after, 'red')).toBe(0)
    expect(fuelOf(after, 'yellow')).toBe(2)
    const cap = slotsOf(after, 'red')
    expect(countResource(after.resources, cap, 'Relic')).toBe(1)
  })
})

describe('Ambitious (Upstart) — a free resource on declaring', () => {
  /** A variant game (so the leaders module is in the chain) with red forced onto a leader. */
  function variantWith(leaderId: string | undefined): GameState {
    let step = startGame(
      { board: 'Board3MixUp', factions: [...THREE], seed: 4, leadersAndLore: { lorePerPlayer: 1 } },
      registry,
    )
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      step = advance(step.state, takes[0]!, registry)
    }
    const seated = step.state
    return leaderId === undefined
      ? { ...seated, leaders: {} }
      : { ...seated, leaders: { ...seated.leaders, red: leaderId } }
  }

  function declare(state: GameState): Continue {
    return advance(
      state,
      { type: 'ambition/declare', faction: 'red', ambition: 'Tycoon', suit: 'Administration', pips: 1 },
      registry,
    ).continue
  }

  it('goes straight on without the leader', () => {
    const c = declare(variantWith(undefined))
    expect(labels(c).some((l) => l.startsWith('Gain '))).toBe(false)
  })

  it('offers every resource still in the supply, plus declining', () => {
    const c = declare(variantWith('leader04'))
    const offered = labels(c)
    for (const r of ['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic']) {
      expect(offered).toContain(`Gain ${r}`)
    }
    expect(offered).toContain('Done')
  })

  it('actually hands over the chosen resource', () => {
    const state = variantWith('leader04')
    const c = ask(declare(state))
    const before = advance(state, { type: 'ambition/declare', faction: 'red', ambition: 'Tycoon', suit: 'Administration', pips: 1 }, registry).state
    const pick = c.actions.find((a) => a['label'] === 'Gain Relic')!
    const after = advance(before, pick, registry).state
    const cap = slotsOf(after, 'red')
    const capBefore = slotsOf(before, 'red')
    expect(countResource(after.resources, cap, 'Relic')).toBe(
      countResource(before.resources, capBefore, 'Relic') + 1,
    )
  })
})

describe('Tactical (Warrior) and Charismatic (Feastbringer) — a second action on one pip', () => {
  /** The pip menu for a suit, as labels. */
  function menu(state: GameState, suit: string): string[] {
    return labels(
      advance(state, { type: 'turn/pips', faction: 'red', suit, done: 0, total: 1 }, registry)
        .continue,
    )
  }

  function menuActions(state: GameState, suit: string): readonly Action[] {
    return ask(
      advance(state, { type: 'turn/pips', faction: 'red', suit, done: 0, total: 1 }, registry)
        .continue,
    ).actions
  }

  /** Red and yellow ships together, so both Battle and Move are live. */
  function contested(state: GameState): GameState {
    const system = state.board.systems[0]!
    let s = clearSystem(state, system)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 2)
    return s
  }

  describe('Tactical', () => {
    const warrior = (kind: 'lead' | 'copy') =>
      played(withLeader(contested(fresh()), 'red', 'leader06'), 'red', kind)

    it('leaves the menu alone on a Lead', () => {
      const m = menu(warrior('lead'), 'Aggression')
      expect(m).toContain('Battle')
      expect(m).toContain('Move')
      expect(m.some((l) => l.includes('then'))).toBe(false)
    })

    it('leaves the menu alone without the leader', () => {
      const m = menu(played(contested(fresh()), 'red', 'copy'), 'Aggression')
      expect(m.some((l) => l.includes('then'))).toBe(false)
    })

    it('pairs the battle with a move both ways round on a Copy', () => {
      const m = menu(warrior('copy'), 'Aggression')
      expect(m).toContain('Battle, then may Move')
      expect(m).toContain('Move, then may Battle')
      expect(m).not.toContain('Battle')
      expect(m).not.toContain('Move')
    })

    it('attaches the follow-up as the action’s continuation, not a separate pip', () => {
      const chosen = menuActions(warrior('copy'), 'Aggression').find(
        (a) => a['label'] === 'Battle, then may Move',
      )!
      const then = chosen['then'] as Record<string, unknown>
      expect(then['type']).toBe('leaders/may-follow')
      expect(then['act']).toBe('Move')
      // and the pip step it eventually returns to is untouched
      expect((then['then'] as Record<string, unknown>)['type']).toBe('turn/pips')
    })

    it('reaches Move from a suit that has none, once a Weapon grants the Battle', () => {
      // Administration buys Tax/Repair/Influence; a spent Weapon adds Battle but never Move.
      const s = { ...warrior('copy'), anyBattle: true }
      const m = menu(s, 'Administration')
      expect(m).toContain('Move, then must Battle')
      expect(m).toContain('Battle, then may Move')
    })

    it('does not add that entry when the suit already offers Move', () => {
      expect(menu(warrior('copy'), 'Aggression')).not.toContain('Move, then must Battle')
    })
  })

  describe('Charismatic', () => {
    /** Red alone on a court card, so Secure is live. */
    function withSecurable(state: GameState): GameState {
      const contents = new Map(state.figures.contents)
      const at = new Map(state.figures.at)
      const court = Location.court(courtSlots(state.factions.length)[0]!)
      const picked = (contents.get('reserve:red') ?? []).filter((id) => id.startsWith('red/Agent/')).slice(0, 2)
      contents.set('reserve:red', (contents.get('reserve:red') ?? []).filter((id) => !picked.includes(id)))
      contents.set(court, [...(contents.get(court) ?? []), ...picked])
      for (const id of picked) at.set(id, court)
      return { ...state, figures: { ...state.figures, contents, at } }
    }

    const feast = (kind: 'lead' | 'copy') =>
      played(withLeader(withSecurable(contested(fresh())), 'red', 'leader07'), 'red', kind)

    it('leaves the menu alone on a Lead', () => {
      const m = menu(feast('lead'), 'Aggression')
      expect(m).toContain('Secure')
      expect(m.some((l) => l.includes('then'))).toBe(false)
    })

    it('pairs the secure with an influence both ways round on a Copy', () => {
      const m = menu(feast('copy'), 'Aggression')
      expect(m).toContain('Secure, then may Influence')
      expect(m).toContain('Influence, then must Secure')
      expect(m).not.toContain('Secure')
    })

    it('reaches Influence, which the Aggression suit does not itself offer', () => {
      expect(menu(played(withSecurable(contested(fresh())), 'red', 'copy'), 'Aggression')).not.toContain(
        'Influence',
      )
      const chosen = menuActions(feast('copy'), 'Aggression').find(
        (a) => a['label'] === 'Influence, then must Secure',
      )!
      expect(chosen['action']).toBe('Influence')
      expect((chosen['then'] as Record<string, unknown>)['type']).toBe('leaders/must-follow')
    })
  })

  describe('the follow-up step itself', () => {
    /** A variant game, so the leaders module is in the chain to handle the follow-up. */
    function variant(): GameState {
      let step = startGame(
        { board: 'Board3MixUp', factions: [...THREE], seed: 4, leadersAndLore: { lorePerPlayer: 1 } },
        registry,
      )
      for (let i = 0; i < 200; i++) {
        const c = step.continue
        if (c.kind !== 'ask') break
        const takes = c.actions.filter((a) => a.type === 'leaders/take')
        if (takes.length === 0) break
        step = advance(step.state, takes[0]!, registry)
      }
      return contested(step.state)
    }

    it('offers the bonus action, or skipping it, when it is a may', () => {
      const c = advance(
        variant(),
        { type: 'leaders/may-follow', faction: 'red', act: 'Move', then: STOP },
        registry,
      ).continue
      expect(labels(c)).toEqual(['Move', 'Skip the Move'])
    })

    it('takes a required follow-up without asking', () => {
      const c = advance(
        variant(),
        { type: 'leaders/must-follow', faction: 'red', act: 'Move', then: STOP },
        registry,
      ).continue
      expect(labels(c).some((l) => l.startsWith('Move'))).toBe(true)
      expect(labels(c)).not.toContain('Skip the Move')
    })

    it('carries on when a required follow-up turns out to be impossible', () => {
      // No ships anywhere means no battle to be had after the move.
      let s = variant()
      for (const sys of s.board.systems) s = clearSystem(s, sys)
      const out = advance(
        s,
        { type: 'leaders/must-follow', faction: 'red', act: 'Battle', then: STOP },
        registry,
      )
      expect(out.state.log.join('\n')).toContain('had no Battle to take')
      expect(out.continue.kind).toBe('ask')
    })
  })
})

describe('Bold (Demagogue) and Generous (Feastbringer) — the declare-time traits', () => {
  /** A drafted variant game, so the leaders module is in the chain, with red's leader forced. */
  function variant(leaderId: string | undefined, seed = 4): GameState {
    let step = startGame(
      { board: 'Board3MixUp', factions: [...THREE], seed, leadersAndLore: { lorePerPlayer: 1 } },
      registry,
    )
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      step = advance(step.state, takes[0]!, registry)
    }
    const seated = step.state
    return leaderId === undefined
      ? { ...seated, leaders: {} }
      : { ...seated, leaders: { ...seated.leaders, red: leaderId } }
  }

  const DECLARE = {
    type: 'ambition/declare',
    faction: 'red',
    ambition: 'Tycoon',
    suit: 'Administration',
    pips: 1,
  } as const

  /** Put a guild card into a faction's secured pile. */
  function secured(state: GameState, faction: FactionId, cardId: string): GameState {
    const contents = new Map(state.courtCards.contents)
    const at = new Map(state.courtCards.at)
    const from = at.get(cardId)
    if (from !== undefined) {
      contents.set(from, (contents.get(from) ?? []).filter((c) => c !== cardId))
    }
    const pile = CourtPile.secured(faction)
    contents.set(pile, [...(contents.get(pile) ?? []), cardId])
    at.set(cardId, pile)
    return { ...state, courtCards: { ...state.courtCards, contents, at } }
  }

  function aGuildCard(state: GameState): string {
    for (const n of courtSlots(state.factions.length)) {
      const card = contentsOf(state.courtCards, CourtPile.slot(n))[0]
      if (card !== undefined && courtCard(card).kind === 'guild') return card
    }
    throw new Error('no guild card in court')
  }

  describe('Bold', () => {
    it('offers the court loop after declaring, and only with the leader', () => {
      expect(labels(advance(variant(undefined), DECLARE, registry).continue)).not.toContain(
        'Influence any number of court cards',
      )
      expect(labels(advance(variant('leader08'), DECLARE, registry).continue)).toContain(
        'Influence any number of court cards',
      )
    })

    it('lets each court card be influenced once, then stops offering it', () => {
      const s = variant('leader08')
      const first = ask(advance(s, DECLARE, registry).continue)
      const open = first.actions.find((a) => a.type === 'leaders/bold')!
      const loop = ask(advance(s, open, registry).continue)
      const influences = loop.actions.filter((a) => a.type === 'action/influence')
      expect(influences.length).toBeGreaterThan(1)

      // take one, and that slot should be gone from the next pass
      const taken = influences[0]!
      const after = ask(advance(s, taken, registry).continue)
      const slots = after.actions.filter((a) => a.type === 'action/influence').map((a) => a['slot'])
      expect(slots).not.toContain(taken['slot'])
      expect(slots.length).toBe(influences.length - 1)
    })

    it('really places an agent, and reads Cancel before anything is placed', () => {
      const s = variant('leader08')
      const open = ask(advance(s, DECLARE, registry).continue).actions.find(
        (a) => a.type === 'leaders/bold',
      )!
      const loop = ask(advance(s, open, registry).continue)
      expect(labels(loop)).toContain('Cancel')

      const before = contentsOf(s.figures, Location.reserve('red')).length
      const influence = loop.actions.find((a) => a.type === 'action/influence')!
      const next = advance(s, influence, registry)
      expect(contentsOf(next.state.figures, Location.reserve('red')).length).toBe(before - 1)
      expect(labels(next.continue)).toContain('Done')
      expect(labels(next.continue)).not.toContain('Cancel')
    })

    it('is offered once — taking it removes it from the menu', () => {
      const s = variant('leader08')
      const open = ask(advance(s, DECLARE, registry).continue).actions.find(
        (a) => a.type === 'leaders/bold',
      )!
      const loop = ask(advance(s, open, registry).continue)
      const influence = loop.actions.find((a) => a.type === 'action/influence')!
      const placed = advance(s, influence, registry)
      const done = ask(placed.continue).actions.find((a) => a['label'] === 'Done')!
      const back = advance(placed.state, done, registry)
      // back at the after-declare menu, Bold spent
      expect(labels(back.continue)).not.toContain('Influence any number of court cards')
    })
  })

  describe('Generous', () => {
    it('demands a Guild card before the declaration, and does not take a marker yet', () => {
      const base = variant('leader07')
      const card = aGuildCard(base)
      const s = secured(base, 'red', card)
      const out = advance(s, DECLARE, registry)
      expect(labels(out.continue).some((l) => l.startsWith('Give '))).toBe(true)
      expect(out.state.declared).toEqual(base.declared)
    })

    it('offers only the poorest rivals as recipients', () => {
      const base = variant('leader07')
      const card = aGuildCard(base)
      const s = { ...secured(base, 'red', card), power: { red: 0, yellow: 5, blue: 1 } }
      const given = labels(advance(s, DECLARE, registry).continue).filter((l) => l.startsWith('Give '))
      expect(given.some((l) => l.endsWith('to blue'))).toBe(true)
      expect(given.some((l) => l.endsWith('to yellow'))).toBe(false)
    })

    it('hands the card over and then declares for real', () => {
      const base = variant('leader07')
      const card = aGuildCard(base)
      const s = { ...secured(base, 'red', card), power: { red: 0, yellow: 5, blue: 1 } }
      const give = ask(advance(s, DECLARE, registry).continue).actions.find(
        (a) => a.type === 'leaders/generous-give',
      )!
      const after = advance(s, give, registry)
      expect(contentsOf(after.state.courtCards, CourtPile.secured('blue'))).toContain(card)
      expect(contentsOf(after.state.courtCards, CourtPile.secured('red'))).not.toContain(card)
      expect(after.state.declared.length).toBe(base.declared.length + 1)
      expect(after.state.declared.at(-1)!.ambition).toBe('Tycoon')
    })

    it('leaves forfeiting as the only option when it holds no Guild card', () => {
      const s = variant('leader07')
      expect(contentsOf(s.courtCards, CourtPile.secured('red'))).toHaveLength(0)
      const out = advance(s, DECLARE, registry)
      expect(labels(out.continue)).toEqual(['Forfeit declaring Tycoon'])
      // and forfeiting really does not declare
      const forfeit = ask(out.continue).actions[0]!
      expect(advance(s, forfeit, registry).state.declared).toEqual(s.declared)
    })

    it('charges Populist Demands too — a mandatory cost for ALL declares (docs/21 B2)', () => {
      /*
       * The official FAQ, asked about exactly this: "Can I declare without giving away a Guild
       * card if I have none, or if I'm using Populist Demands? No. Giving away a Guild is a
       * mandatory cost for all declares." The free declaration used to bypass the gift.
       */
      const base = variant('leader07')
      const card = aGuildCard(base)
      const s = secured(base, 'red', card)
      const populist = {
        type: 'vox/populist',
        faction: 'red',
        ambition: 'Tycoon',
        card: 'bc27',
        then: { type: 'turn/lead-main', faction: 'red' },
      }
      const out = advance(s, populist, registry)
      expect(labels(out.continue).some((l) => l.startsWith('Give '))).toBe(true)
      expect(out.state.declared).toEqual(s.declared)

      const give = ask(out.continue).actions.find((a) => a.type === 'leaders/generous-give')!
      const after = advance(s, give, registry)
      expect(after.state.declared.length).toBe(s.declared.length + 1)

      // Forfeiting is a real way out and declares nothing.
      const forfeit = ask(out.continue).actions.find((a) =>
        String(a['label']).startsWith('Forfeit'),
      )!
      expect(advance(s, forfeit, registry).state.declared).toEqual(s.declared)
    })

    it("charges Tycoon's Ambition's Prelude declare as well", () => {
      const base = variant('leader07')
      const card = aGuildCard(base)
      const s = secured(base, 'red', card)
      const tycoon = {
        type: 'turn/prelude-tycoon',
        faction: 'red',
        ambition: 'Warlord',
        suit: 'Administration',
        pips: 1,
      }
      const out = advance(s, tycoon, registry)
      expect(labels(out.continue).some((l) => l.startsWith('Give '))).toBe(true)
      expect(out.state.declared).toEqual(s.declared)
      const give = ask(out.continue).actions.find((a) => a.type === 'leaders/generous-give')!
      const after = advance(s, give, registry)
      expect(after.state.declared.at(-1)!.ambition).toBe('Warlord')
    })

    it('does not intercept a faction without the trait', () => {
      const s = variant(undefined)
      const out = advance(s, DECLARE, registry)
      expect(labels(out.continue).some((l) => l.startsWith('Give '))).toBe(false)
      expect(out.state.declared.length).toBe(s.declared.length + 1)
    })
  })
})

describe('Callow (Upstart) — tax only the cities you rule', () => {
  /** A system holding a red city, plus however many ships each side needs to settle the rule. */
  function city(opts: { redShips?: number; yellowShips?: number; leader?: boolean }) {
    const base = fresh()
    const { system } = (() => {
      for (const s of base.board.systems) {
        const c = contentsOf(base.figures, Location.system(s)).find((id) => id.startsWith('red/City/'))
        if (c !== undefined) return { system: s }
      }
      throw new Error('red has no city')
    })()
    let s = opts.leader === true ? withLeader(base, 'red', 'leader04') : base
    // Clear the system of ships, then set the balance of power explicitly.
    const contents = new Map(s.figures.contents)
    const at = new Map(s.figures.at)
    const here = Location.system(system)
    for (const id of contents.get(here) ?? []) {
      if (!id.includes('/Ship/')) continue
      const color = id.slice(0, id.indexOf('/'))
      contents.set(here, (contents.get(here) ?? []).filter((x) => x !== id))
      contents.set(`reserve:${color}`, [...(contents.get(`reserve:${color}`) ?? []), id])
      at.set(id, `reserve:${color}`)
    }
    s = { ...s, figures: { ...s.figures, contents, at } }
    if (opts.redShips) s = place(s, 'red', system, 'Ship', opts.redShips)
    if (opts.yellowShips) s = place(s, 'yellow', system, 'Ship', opts.yellowShips)
    return { state: s, system }
  }

  function taxOffers(state: GameState, system: SystemId): number {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.filter((a) => a.type === 'action/tax-city' && a['system'] === system).length
  }

  it('a Loyal city is taxable without ruling, which is the base rule', () => {
    const { state, system } = city({ redShips: 1, yellowShips: 4 })
    expect(rules(state, 'red', system)).toBe(false)
    expect(taxOffers(state, system)).toBe(1)
  })

  it('the Upstart cannot tax a city it does not rule', () => {
    const { state, system } = city({ redShips: 1, yellowShips: 4, leader: true })
    expect(rules(state, 'red', system)).toBe(false)
    expect(taxOffers(state, system)).toBe(0)
  })

  it('the Upstart can tax the same city once it rules the system', () => {
    const { state, system } = city({ redShips: 5, yellowShips: 1, leader: true })
    expect(rules(state, 'red', system)).toBe(true)
    expect(taxOffers(state, system)).toBe(1)
  })

  it('leaves other factions alone', () => {
    const { state, system } = city({ redShips: 1, yellowShips: 4 })
    const elsewhere = withLeader(state, 'yellow', 'leader04')
    expect(taxOffers(elsewhere, system)).toBe(1)
  })
})

describe('Ransack the Court, and Beloved (Elder)', () => {
  /** red attacking yellow, with a yellow agent on a court card and a yellow city to raze. */
  /**
   * Beloved's own step is dispatched by the leaders module, which is only in the rule chain when
   * the variant was switched on at `startGame` — so the Elder cases are built from a real variant
   * game rather than by injecting a leader into a base one.
   */
  function variantBase(): GameState {
    let step = startGame(
      { board: 'Board3MixUp', factions: [...THREE], seed: 4, leadersAndLore: { lorePerPlayer: 1 } },
      registry,
    )
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      step = advance(step.state, takes[0]!, registry)
    }
    return step.state
  }

  function siege(opts: { elder?: boolean } = {}) {
    const base = opts.elder === true ? variantBase() : fresh()
    const system = base.board.systems[0]!
    let s = opts.elder === true ? withLeader(base, 'yellow', 'leader01') : base
    s = clearSystem(s, system)
    s = place(s, 'red', system, 'Ship', 4)
    s = place(s, 'yellow', system, 'City', 1)
    // Already damaged, so a single building hit destroys it — a fresh building only takes damage.
    const city = contentsOf(s.figures, Location.system(system)).find((id) => id.startsWith('yellow/City/'))!
    s = { ...s, damaged: [...s.damaged, city] }

    // a yellow agent on the first court slot, so there is something to ransack
    const slot = courtSlots(s.factions.length).find((n) => contentsOf(s.courtCards, CourtPile.slot(n))[0] !== undefined)!
    const contents = new Map(s.figures.contents)
    const at = new Map(s.figures.at)
    const agent = (contents.get('reserve:yellow') ?? []).find((id) => id.includes('/Agent/'))!
    contents.set('reserve:yellow', (contents.get('reserve:yellow') ?? []).filter((i) => i !== agent))
    contents.set(Location.court(slot), [...(contents.get(Location.court(slot)) ?? []), agent])
    at.set(agent, Location.court(slot))
    return { state: { ...s, figures: { ...s.figures, contents, at } }, system, slot, agent }
  }

  /** Raze the city by assigning a building hit, and stop at whatever comes next. */
  function raze(state: GameState, system: SystemId) {
    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 0, intercepted: 0, ships: 0, buildings: 1, keys: 0, razed: false,
      then: STOP,
    }
    let step = advance(state, { type: 'battle/hit', ctx, phase: 'buildings', target: contentsOf(state.figures, Location.system(system)).find((id) => id.startsWith('yellow/City/'))! }, registry)
    for (let i = 0; i < 10; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const finish = c.actions.find((a) => a.type === 'battle/finish')
      if (finish === undefined) break
      step = advance(step.state, finish, registry)
      break
    }
    return step
  }

  it('razing a city offers a ransack of a card the defender holds', () => {
    const { state, system, slot } = siege()
    const out = raze(state, system)
    const c = ask(out.continue)
    expect(c.actions.some((a) => a.type === 'action/ransack' && a['slot'] === slot)).toBe(true)
    expect(c.actions.map((a) => String(a['label']))).toContain('Ransack nothing')
  })

  it('takes the card and the agents on it as trophies, not captives', () => {
    const { state, system, slot } = siege()
    const out = raze(state, system)
    const take = ask(out.continue).actions.find((a) => a.type === 'action/ransack')!
    const after = advance(out.state, take, registry)

    expect(contentsOf(after.state.courtCards, CourtPile.secured('red')).length).toBeGreaterThan(0)
    expect(contentsOf(after.state.figures, Location.trophies('red')).some((id) => id.includes('yellow/Agent'))).toBe(true)
    expect(contentsOf(after.state.figures, Location.captives('red')).some((id) => id.includes('yellow/Agent'))).toBe(false)
    expect(after.state.log.join('\n')).toContain('ransacked')
    expect(slot).toBeDefined()
  })

  it('offers nothing when the defender has no agent in court', () => {
    const { state, system, agent } = siege()
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    for (const n of courtSlots(state.factions.length)) {
      contents.set(Location.court(n), (contents.get(Location.court(n)) ?? []).filter((i) => i !== agent))
    }
    contents.set('reserve:yellow', [...(contents.get('reserve:yellow') ?? []), agent])
    at.set(agent, 'reserve:yellow')
    const bare = { ...state, figures: { ...state.figures, contents, at } }
    const out = raze(bare, system)
    if (out.continue.kind === 'ask') {
      expect(ask(out.continue).actions.some((a) => a.type === 'action/ransack')).toBe(false)
    }
  })

  it('Beloved forbids rivals ransacking the Elder', () => {
    const { state, system } = siege({ elder: true })
    const out = raze(state, system)
    if (out.continue.kind === 'ask') {
      expect(ask(out.continue).actions.some((a) => a.type === 'action/ransack')).toBe(false)
    }
    expect(out.state.log.join('\n')).toContain('cannot be ransacked')
  })

  it('Beloved gives the defender a free influence once the attacker takes trophies', () => {
    const { state, system } = siege({ elder: true })
    const out = raze(state, system)
    // the razed city became a red trophy, so the Elder's own step is owed
    const c = out.continue
    expect(c.kind).toBe('ask')
    const askc = ask(c)
    expect(askc.faction).toBe('yellow')
    expect(askc.actions.some((a) => a.type === 'action/influence')).toBe(true)
    expect(askc.actions.map((a) => String(a['label']))).toContain('Decline')
  })

  it('and that influence really places a yellow agent', () => {
    const { state, system } = siege({ elder: true })
    const out = raze(state, system)
    const inf = ask(out.continue).actions.find((a) => a.type === 'action/influence')!
    const before = contentsOf(out.state.figures, Location.reserve('yellow')).filter((i) => i.includes('/Agent/')).length
    const after = advance(out.state, inf, registry)
    expect(
      contentsOf(after.state.figures, Location.reserve('yellow')).filter((i) => i.includes('/Agent/')).length,
    ).toBe(before - 1)
  })

  it('gives no such step to a defender without the leader', () => {
    const { state, system } = siege()
    const out = raze(state, system)
    const c = out.continue
    if (c.kind === 'ask') expect(ask(c).faction).not.toBe('yellow')
  })
})

describe('Beloved needs the attacker to have actually taken trophies', () => {
  /** A variant game where yellow is the Elder and red is attacking with a damaged ship. */
  function skirmish() {
    let step = startGame(
      { board: 'Board3MixUp', factions: [...THREE], seed: 4, leadersAndLore: { lorePerPlayer: 1 } },
      registry,
    )
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      step = advance(step.state, takes[0]!, registry)
    }
    const base = withLeader(step.state, 'yellow', 'leader01')
    const system = base.board.systems[0]!
    let s = clearSystem(base, system)
    s = place(s, 'red', system, 'Ship', 2)
    s = place(s, 'yellow', system, 'Ship', 2)
    // one of red's own ships is already damaged, so a self-hit destroys it
    const mine = contentsOf(s.figures, Location.system(system)).find((id) => id.startsWith('red/Ship/'))!
    return { state: { ...s, damaged: [...s.damaged, mine] }, system, mine }
  }

  it('does not fire when the attacker destroyed only its own ship', () => {
    const { state, system, mine } = skirmish()
    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 1, intercepted: 1, ships: 0, buildings: 0, keys: 0, razed: false,
      then: STOP,
    }
    let step = advance(state, { type: 'battle/hit', ctx, phase: 'self', target: mine }, registry)
    // red's own loss goes home to reserve, not to anyone's trophies
    expect(contentsOf(step.state.figures, Location.trophies('red'))).toHaveLength(0)

    const finish = ask(step.continue).actions.find((a) => a.type === 'battle/finish')!
    step = advance(step.state, finish, registry)
    // the turn goes straight on: no Elder step is owed
    expect(step.state.log.join('\n')).not.toContain('defended and lost pieces')
    if (step.continue.kind === 'ask') expect(ask(step.continue).faction).not.toBe('yellow')
  })

  it('does fire once the attacker destroys something of the defender’s', () => {
    const { state, system } = skirmish()
    const theirs = contentsOf(state.figures, Location.system(system)).find((id) => id.startsWith('yellow/Ship/'))!
    const hurt = { ...state, damaged: [...state.damaged, theirs] }
    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 0, intercepted: 0, ships: 1, buildings: 0, keys: 0, razed: false,
      then: STOP,
    }
    let step = advance(hurt, { type: 'battle/hit', ctx, phase: 'ships', target: theirs }, registry)
    expect(contentsOf(step.state.figures, Location.trophies('red')).length).toBeGreaterThan(0)

    const finish = ask(step.continue).actions.find((a) => a.type === 'battle/finish')!
    step = advance(step.state, finish, registry)
    expect(ask(step.continue).faction).toBe('yellow')
  })
})

describe('Paranoid’s ransack exception — "Ignore this if you Ransack the Court"', () => {
  /** Put `n` agents of a colour onto a court slot. */
  function agentsOn(state: GameState, who: string, slot: number, n: number): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const reserve = `reserve:${who}`
    const court = Location.court(slot)
    const picked = (contents.get(reserve) ?? []).filter((id) => id.includes('/Agent/')).slice(0, n)
    contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !picked.includes(id)))
    contents.set(court, [...(contents.get(court) ?? []), ...picked])
    for (const id of picked) at.set(id, court)
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  function guildSlot(state: GameState): number {
    for (const n of courtSlots(state.factions.length)) {
      const card = contentsOf(state.courtCards, CourtPile.slot(n))[0]
      if (card !== undefined && courtCard(card).kind === 'guild') return n
    }
    throw new Error('no guild card in court')
  }

  /** A variant game with red as the Demagogue, besieging a damaged yellow city. */
  function demagogueSiege() {
    let step = startGame(
      { board: 'Board3MixUp', factions: [...THREE], seed: 4, leadersAndLore: { lorePerPlayer: 1 } },
      registry,
    )
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      step = advance(step.state, takes[0]!, registry)
    }
    const base = withLeader(step.state, 'red', 'leader08')
    const system = base.board.systems[0]!
    let s = clearSystem(base, system)
    s = place(s, 'red', system, 'Ship', 4)
    s = place(s, 'yellow', system, 'City', 1)
    const city = contentsOf(s.figures, Location.system(system)).find((id) => id.startsWith('yellow/City/'))!
    s = { ...s, damaged: [...s.damaged, city] }
    return { state: s, system, city }
  }

  it('the Demagogue still cannot *secure* a lightly-held Guild card', () => {
    const { state } = demagogueSiege()
    const slot = guildSlot(state)
    const s = agentsOn(state, 'red', slot, 1)
    const labels = ask(
      advance(s, { type: 'action/take', faction: 'red', action: 'Secure', then: STOP }, registry)
        .continue,
    ).actions.map((a) => String(a['label'] ?? a.type))
    expect(labels.some((l) => l.startsWith('Secure'))).toBe(false)
  })

  it('but may ransack that same card, because the exception ignores the restriction', () => {
    const { state, system, city } = demagogueSiege()
    const slot = guildSlot(state)
    let s = agentsOn(state, 'red', slot, 1)
    s = agentsOn(s, 'yellow', slot, 1)
    const cardId = contentsOf(s.courtCards, CourtPile.slot(slot))[0]!

    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 0, intercepted: 0, ships: 0, buildings: 1, keys: 0, razed: false,
      then: STOP,
    }
    let step = advance(s, { type: 'battle/hit', ctx, phase: 'buildings', target: city }, registry)
    const finish = ask(step.continue).actions.find((a) => a.type === 'battle/finish')!
    step = advance(step.state, finish, registry)

    const offer = ask(step.continue).actions.find(
      (a) => a.type === 'action/ransack' && a['slot'] === slot,
    )
    expect(offer).toBeDefined()

    // and taking it really works, agents to trophies
    const after = advance(step.state, offer!, registry)
    expect(contentsOf(after.state.courtCards, CourtPile.secured('red'))).toContain(cardId)
    expect(
      contentsOf(after.state.figures, Location.trophies('red')).some((id) => id.includes('yellow/Agent')),
    ).toBe(true)
  })
})

describe('Taxing a Rival city — "Gain 1 resource at a Loyal or Controlled city"', () => {
  /** A system holding a yellow city, with the balance of ships set explicitly. */
  function contested(opts: { redShips: number; yellowShips: number }) {
    const base = fresh()
    let system: SystemId | undefined
    for (const s of base.board.systems) {
      if (contentsOf(base.figures, Location.system(s)).some((id) => id.startsWith('yellow/City/'))) {
        system = s
        break
      }
    }
    if (system === undefined) throw new Error('yellow has no city')

    // clear ships, then set who rules
    const contents = new Map(base.figures.contents)
    const at = new Map(base.figures.at)
    const here = Location.system(system)
    for (const id of contents.get(here) ?? []) {
      if (!id.includes('/Ship/')) continue
      const color = id.slice(0, id.indexOf('/'))
      contents.set(here, (contents.get(here) ?? []).filter((x) => x !== id))
      contents.set(`reserve:${color}`, [...(contents.get(`reserve:${color}`) ?? []), id])
      at.set(id, `reserve:${color}`)
    }
    let s: GameState = { ...base, figures: { ...base.figures, contents, at } }
    s = place(s, 'red', system, 'Ship', opts.redShips)
    s = place(s, 'yellow', system, 'Ship', opts.yellowShips)
    return { state: s, system }
  }

  function taxOffers(state: GameState, system: SystemId) {
    return ask(
      advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    ).actions.filter((a) => a.type === 'action/tax-city' && a['system'] === system)
  }

  it('is not offered where the rival is not ruled', () => {
    const { state, system } = contested({ redShips: 1, yellowShips: 4 })
    expect(rules(state, 'red', system)).toBe(false)
    expect(taxOffers(state, system)).toHaveLength(0)
  })

  it('is offered once red rules the system, and says whose city it is', () => {
    const { state, system } = contested({ redShips: 5, yellowShips: 1 })
    expect(rules(state, 'red', system)).toBe(true)
    const offers = taxOffers(state, system)
    expect(offers).toHaveLength(1)
    expect(String(offers[0]!['label'])).toContain("yellow's city")
    expect(String(offers[0]!['label'])).toContain('capture an agent')
  })

  it('gains the resource and captures one of that rival’s agents', () => {
    const { state, system } = contested({ redShips: 5, yellowShips: 1 })
    const bare = stripSlots(state, 'red')
    const offer = taxOffers(bare, system)[0]!
    const agentsBefore = contentsOf(bare.figures, Location.reserve('yellow')).filter((i) => i.includes('/Agent/')).length

    const after = advance(bare, offer, registry).state
    expect(contentsOf(after.figures, Location.captives('red')).some((i) => i.includes('yellow/Agent'))).toBe(true)
    expect(contentsOf(after.figures, Location.reserve('yellow')).filter((i) => i.includes('/Agent/')).length).toBe(agentsBefore - 1)
    // and a resource actually landed, without reading it back out of the log that reports it
    const held = (st: GameState): number =>
      (['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as Resource[]).reduce(
        (n, r) => n + countResource(st.resources, slotsOf(st, 'red'), r),
        0,
      )
    expect(held(after)).toBe(held(bare) + 1)
  })

  it('taxes each city once per turn, counting a rival’s separately from your own', () => {
    const { state, system } = contested({ redShips: 5, yellowShips: 1 })
    const withMine = place(state, 'red', system, 'City', 1)
    expect(taxOffers(withMine, system)).toHaveLength(2)

    const first = taxOffers(withMine, system)[0]!
    const after = advance(withMine, first, registry).state
    const left = taxOffers(after, system)
    expect(left).toHaveLength(1)
    expect(left[0]!['city']).not.toBe(first['city'])
  })

  it('says so and takes nothing when the rival has no agents left', () => {
    const { state, system } = contested({ redShips: 5, yellowShips: 1 })
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const agents = (contents.get('reserve:yellow') ?? []).filter((i) => i.includes('/Agent/'))
    contents.set('reserve:yellow', (contents.get('reserve:yellow') ?? []).filter((i) => !agents.includes(i)))
    contents.set('captives:blue', [...(contents.get('captives:blue') ?? []), ...agents])
    for (const id of agents) at.set(id, 'captives:blue')
    const broke = { ...state, figures: { ...state.figures, contents, at } }

    const after = advance(broke, taxOffers(broke, system)[0]!, registry).state
    expect(contentsOf(after.figures, Location.captives('red'))).toHaveLength(0)
    expect(after.log.join('\n')).toContain('had no agent')
  })
})

describe('Learned (Archivist) — draw 5 lore, keep 2, scrap 3', () => {
  /** Draft until the Archivist is taken, and stop at whatever setup leads to. */
  function drafted(): { result: ReturnType<typeof advance>; who: FactionId } {
    for (let seed = 1; seed < 200; seed++) {
      let step = startGame(
        {
          board: 'Board3MixUp',
          factions: [...THREE],
          seed,
          leadersAndLore: { expansion: true, lorePerPlayer: 1 },
        },
        registry,
      )
      let offered = false
      for (let i = 0; i < 300; i++) {
        const c = step.continue
        if (c.kind !== 'ask') break
        const takes = c.actions.filter((a) => a.type === 'leaders/take')
        if (takes.length === 0) break
        const arch = takes.find((a) => a['card'] === 'leader09')
        if (arch !== undefined) offered = true
        step = advance(step.state, arch ?? takes[0]!, registry)
      }
      const who = THREE.find((f) => step.state.leaders[f] === 'leader09')
      if (offered && who !== undefined) return { result: step, who }
    }
    throw new Error('no seed under 200 offered the Archivist')
  }

  /** The same sweep, but never taking the Archivist. */
  function withoutArchivist() {
    let step = startGame(
      {
        board: 'Board3MixUp',
        factions: [...THREE],
        seed: 5,
        leadersAndLore: { expansion: true, lorePerPlayer: 1 },
      },
      registry,
    )
    for (let i = 0; i < 300; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const takes = c.actions.filter((a) => a.type === 'leaders/take')
      if (takes.length === 0) break
      const notArch = takes.find((a) => a['card'] !== 'leader09') ?? takes[0]!
      step = advance(step.state, notArch, registry)
    }
    return step
  }

  it('asks the Archivist to keep 2 of 5 after setup', () => {
    const { result, who } = drafted()
    const c = ask(result.continue)
    expect(c.faction).toBe(who)
    const options = c.actions.filter((a) => a.type === 'leaders/learned')
    expect(options.length).toBe(10) // 5 choose 2
    for (const a of options) {
      expect((a['keep'] as string[]).length).toBe(2)
      expect((a['drawn'] as string[]).length).toBe(5)
    }
  })

  it('keeps exactly the two chosen, on top of the drafted quota', () => {
    const { result, who } = drafted()
    const before = (result.state.lores[who] ?? []).length
    const pick = ask(result.continue).actions.find((a) => a.type === 'leaders/learned')!
    const after = advance(result.state, pick, registry).state

    const held = after.lores[who] ?? []
    expect(held).toHaveLength(before + 2)
    for (const id of pick['keep'] as string[]) expect(held).toContain(id)
  })

  it('scraps the other three — all five leave the box', () => {
    const { result } = drafted()
    const boxBefore = result.state.unusedLore.length
    const pick = ask(result.continue).actions.find((a) => a.type === 'leaders/learned')!
    const after = advance(result.state, pick, registry)

    expect(after.state.unusedLore).toHaveLength(boxBefore - 5)
    for (const id of pick['drawn'] as string[]) expect(after.state.unusedLore).not.toContain(id)
    // and the three not kept went nowhere else
    const scrapped = (pick['drawn'] as string[]).filter((id) => !(pick['keep'] as string[]).includes(id))
    for (const id of scrapped) {
      for (const f of THREE) expect(after.state.lores[f] ?? []).not.toContain(id)
    }
    expect(after.state.log.join('\n')).toContain('scrapped')
  })

  it('lets the game start once it has chosen', () => {
    const { result } = drafted()
    const pick = ask(result.continue).actions.find((a) => a.type === 'leaders/learned')!
    const after = advance(result.state, pick, registry)
    // play has begun: somebody is being asked to lead
    expect(after.continue.kind).toBe('ask')
    expect(after.state.log.join('\n')).toContain('Chapter 1')
  })

  it('does not interrupt a game nobody drafted it in', () => {
    const step = withoutArchivist()
    expect(THREE.some((f) => step.state.leaders[f] === 'leader09')).toBe(false)
    if (step.continue.kind === 'ask') {
      expect(step.continue.actions.some((a) => a.type === 'leaders/learned')).toBe(false)
    }
    expect(step.state.log.join('\n')).toContain('Chapter 1')
  })
})

describe('Academic (Archivist) — the Tycoon twin of Just and Violent', () => {
  function scored(state: GameState, ambition: 'Tycoon', marker: { high: number; low: number }) {
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: [ambition],
      declared: [{ ambition, marker }],
    }
    return advance(staged, { type: 'ambition/score' }, registry).state.power
  }

  function race(leaderFor?: FactionId): GameState {
    let s = fresh()
    for (const f of THREE) s = stripSlots(s, f)
    s = give(s, 'red', 'Material', 3)
    s = give(s, 'yellow', 'Material', 1)
    return leaderFor === undefined ? s : withLeader(s, leaderFor, 'leader09')
  }

  it('pays a normal first place without the leader', () => {
    const power = scored(race(), 'Tycoon', { high: 6, low: 3 })
    expect(power['red']).toBe(6)
    expect(power['yellow']).toBe(3)
  })

  it('pays the Archivist the second-place value for winning Tycoon', () => {
    expect(scored(race('red'), 'Tycoon', { high: 6, low: 3 })['red']).toBe(3)
  })

  it('pays the Archivist nothing for placing second', () => {
    expect(scored(race('yellow'), 'Tycoon', { high: 6, low: 3 })['yellow']).toBe(0)
  })

  it('leaves other ambitions alone', () => {
    let s = fresh()
    for (const f of THREE) s = stripSlots(s, f)
    s = give(s, 'red', 'Relic', 3)
    s = give(s, 'yellow', 'Relic', 1)
    const staged = (st: GameState) => ({
      ...st, power: { red: 0, yellow: 0, blue: 0 },
      ambitions: ['Keeper' as const], declared: [{ ambition: 'Keeper' as const, marker: { high: 6, low: 3 } }],
    })
    const plain = advance(staged(s), { type: 'ambition/score' }, registry).state.power
    const arch = advance(staged(withLeader(s, 'red', 'leader09')), { type: 'ambition/score' }, registry).state.power
    expect(arch['red']).toBe(plain['red'])
  })
})
