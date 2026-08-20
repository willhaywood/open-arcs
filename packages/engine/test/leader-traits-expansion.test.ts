/**
 * Leaders and Lore, phase 5 — the Leaders & Lore Pack's trait effects (leaders 10-16).
 *
 * Same discipline as `leader-traits.test.ts`: each test pins one trait to the text printed on its
 * card, and every trait is paired with the same situation *without* the leader. The pairing is the
 * point — a trait that silently did nothing would pass a one-sided assertion, and a trait's
 * absence is indistinguishable from a base game.
 *
 * Traits are injected onto `state.leaders` where they can be, and drafted for real where they
 * cannot: the four setup traits fire during seating, so there is no "after the fact" to inject at.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  citiesInReserve,
  CourtPile,
  connectedSystems,
  contentsOf,
  countResource,
  defaultRegistry,
  freeSlots,
  gain,
  isOutraged,
  leaderCard,
  rules,
  slotCapacity,
  slotsOf,
  planetResource,
  securedCards,
  startGame,
  system as systemInfo,
} from '../src/index.js'
import type { Continue, FactionId, GameState, Resource, SystemId } from '../src/index.js'

type Ask = Extract<Continue, { kind: 'ask' }>

function ask(c: Continue): Ask {
  if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
  return c
}

function labels(c: Continue): string[] {
  return ask(c).actions.map((a) => String(a['label'] ?? a.type))
}

/**
 * A `then` for offers that are only inspected, never advanced past — `turn/lead-main` presents
 * red's own menu and stops there, without touching anything a trait test measures.
 */
const STOP = { type: 'turn/lead-main', faction: 'red' } as const

/** Move `n` of a colour's pieces from reserve into a system. */
function place(
  state: GameState,
  color: string,
  system: SystemId,
  piece: string,
  n: number,
): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const from = `reserve:${color}`
  const dest = Location.system(system)
  const moved = (contents.get(from) ?? [])
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  contents.set(from, (contents.get(from) ?? []).filter((id) => !moved.includes(id)))
  contents.set(dest, [...(contents.get(dest) ?? []), ...moved])
  for (const id of moved) at.set(id, dest)
  return { ...state, figures: { ...state.figures, contents, at } }
}

/**
 * Send every ship in a system back to reserve, so a test sets the balance of power itself.
 *
 * Ships only: the buildings are what these tests are taxing, and clearing them would empty the
 * very system under test.
 */
function clearShips(state: GameState, system: SystemId): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const dest = Location.system(system)
  const staying: string[] = []
  for (const id of contents.get(dest) ?? []) {
    if (!id.includes('/Ship/')) {
      staying.push(id)
      continue
    }
    const from = `reserve:${id.slice(0, id.indexOf('/'))}`
    contents.set(from, [...(contents.get(from) ?? []), id])
    at.set(id, from)
  }
  contents.set(dest, staying)
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

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

/** Give a faction a leader without running the draft. */
function withLeader(state: GameState, faction: FactionId, leaderId: string): GameState {
  return { ...state, leaders: { ...state.leaders, [faction]: leaderId } }
}

/**
 * Draft for real, sweeping seeds until red is *offered* the leader under test and takes it.
 *
 * Setup traits fire during the seating the draft leads into, so they cannot be injected onto
 * `state.leaders` the way a battle or tax trait can.
 */
function seated(leaderId: string): GameState {
  for (let seed = 1; seed < 400; seed++) {
    let step = startGame(
      {
        board: 'Board3MixUp',
        factions: [...THREE],
        seed,
        // `expansion` defaults to false, and leaders 09-16 are only dealt when it is on.
        leadersAndLore: { expansion: true, lorePerPlayer: 1 },
      },
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
  throw new Error(`no seed under 400 let red draft ${leaderId}`)
}

/** Pieces of one type a faction still has in reserve. */
function reserve(state: GameState, faction: FactionId, piece: string): number {
  return contentsOf(state.figures, Location.reserve(faction)).filter((id) =>
    id.startsWith(`${faction}/${piece}/`),
  ).length
}

/** Pieces of one type this faction has had scrapped — out of the game, not back to reserve. */
function scrapped(state: GameState, faction: FactionId, piece: string): number {
  return contentsOf(state.figures, Location.scrap()).filter((id) =>
    id.startsWith(`${faction}/${piece}/`),
  ).length
}

/** A rival of red who does not share red's leader, for the paired "without the trait" half. */
function rival(state: GameState): FactionId {
  const other = (['yellow', 'blue'] as const).find((f) => state.leaders[f] !== state.leaders['red'])
  if (other === undefined) throw new Error('no rival with a different leader')
  return other
}

// ---------------------------------------------------------------------------

describe('Hated (Overseer, leader10) — scrap 2 Loyal ships and 3 Loyal agents in setup', () => {
  it('scraps exactly 2 ships and 3 agents, out of the game rather than back to reserve', () => {
    const s = seated('leader10')
    expect(leaderCard('leader10').name).toBe('Overseer')
    expect(scrapped(s, 'red', 'Ship')).toBe(2)
    expect(scrapped(s, 'red', 'Agent')).toBe(3)
    expect(scrapped(s, 'red', 'City')).toBe(0)
    expect(scrapped(s, 'red', 'Starport')).toBe(0)
  })

  it('costs the Overseer reserve the rivals keep', () => {
    const s = seated('leader10')
    const other = rival(s)
    expect(reserve(s, 'red', 'Agent')).toBe(reserve(s, other, 'Agent') - 3)
    // Ships: the Overseer's own opening places the standard 8, so the gap is the scrapping alone
    // only when the rival opened the same way. Assert the scrap, and that nothing came back.
    expect(reserve(s, 'red', 'Ship')).toBeLessThan(reserve(s, other, 'Ship') + 1)
    expect(scrapped(s, other, 'Ship')).toBe(0)
    expect(scrapped(s, other, 'Agent')).toBe(0)
  })
})

describe('Decentralized (Anarchist, leader13) — scrap the 2 leftmost cities', () => {
  it('scraps 2 cities, which uncovers two more resource slots', () => {
    const s = seated('leader13')
    expect(leaderCard('leader13').name).toBe('Anarchist')
    expect(scrapped(s, 'red', 'City')).toBe(2)
    // The Anarchist places no city at setup, so all 5 start in reserve; scrapping 2 leaves 3.
    expect(citiesInReserve(s, 'red')).toBe(3)
    // Capacity is read off that count, so the uncovering needs no separate rule.
    expect(slotCapacity(citiesInReserve(s, 'red'))).toBe(4)
  })

  it('a rival without the trait keeps its cities and its narrower board', () => {
    const s = seated('leader13')
    const other = rival(s)
    expect(scrapped(s, other, 'City')).toBe(0)
    expect(slotCapacity(citiesInReserve(s, other))).toBeLessThan(
      slotCapacity(citiesInReserve(s, 'red')),
    )
  })
})

describe('Greedy (Quartermaster, leader16) — an agent on the Material Outrage slot', () => {
  it('starts outraged on Material and nothing else', () => {
    const s = seated('leader16')
    expect(leaderCard('leader16').name).toBe('Quartermaster')
    expect(isOutraged(s, 'red', 'Material')).toBe(true)
    for (const r of ['Fuel', 'Psionic', 'Relic', 'Weapon'] as const) {
      expect(isOutraged(s, 'red', r)).toBe(false)
    }
  })

  it('leaves a rival without the trait unoutraged', () => {
    const s = seated('leader16')
    expect(isOutraged(s, rival(s), 'Material')).toBe(false)
  })

  it('scraps nothing — it is an outrage marker, not a cost in pieces', () => {
    const s = seated('leader16')
    expect(scrapped(s, 'red', 'Agent')).toBe(0)
    expect(scrapped(s, 'red', 'Ship')).toBe(0)
  })
})

describe('Proud (Noble, leader12) — Power only for an outright first place', () => {
  /** A scored round with one declared ambition, and what each faction ended up with. */
  function scored(
    state: GameState,
    marker: { high: number; low: number },
  ): Partial<Record<FactionId, number>> {
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: ['Tyrant'],
      declared: [{ ambition: 'Tyrant', marker }],
    }
    return advance(staged, { type: 'ambition/score' }, registry).state.power
  }

  /** Move `n` of `from`'s agents into `faction`'s captives — the Tyrant metric. */
  function captives(state: GameState, faction: FactionId, from: string, n: number): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const reserve = `reserve:${from}`
    const pile = `captives:${faction}`
    const agents = (contents.get(reserve) ?? [])
      .filter((id) => id.startsWith(`${from}/Agent/`))
      .slice(0, n)
    contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !agents.includes(id)))
    contents.set(pile, [...(contents.get(pile) ?? []), ...agents])
    for (const a of agents) at.set(a, pile)
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  /** red 3 captives, yellow 1: red wins outright, yellow places second. */
  const race = (): GameState => captives(captives(fresh(), 'red', 'blue', 3), 'yellow', 'blue', 1)
  /** red and yellow both on 2: a tie for first, nobody second. */
  const tied = (): GameState => captives(captives(fresh(), 'red', 'blue', 2), 'yellow', 'blue', 2)

  it('pays an outright win in full — the trait costs nothing when you actually win', () => {
    const plain = scored(race(), { high: 6, low: 3 })
    const noble = scored(withLeader(race(), 'red', 'leader12'), { high: 6, low: 3 })
    expect(leaderCard('leader12').name).toBe('Noble')
    expect(plain['red']).toBe(6)
    expect(noble['red']).toBe(6)
  })

  it('pays nothing for a tied first place, which the base game pays the low value for', () => {
    const plain = scored(tied(), { high: 6, low: 3 })
    const noble = scored(withLeader(tied(), 'red', 'leader12'), { high: 6, low: 3 })
    expect(plain['red']).toBe(3)
    expect(plain['yellow']).toBe(3)
    expect(noble['red']).toBe(0)
    // The rival in the same tie is untouched — this is not a change to how ties are scored.
    expect(noble['yellow']).toBe(3)
  })

  it('pays nothing for second place', () => {
    const plain = scored(race(), { high: 6, low: 3 })
    const noble = scored(withLeader(race(), 'yellow', 'leader12'), { high: 6, low: 3 })
    expect(plain['yellow']).toBe(3)
    expect(noble['yellow']).toBe(0)
    expect(noble['red']).toBe(6)
  })

  it('keeps the city bonus on an outright win — it withholds nothing from first place', () => {
    const onBoard = (s: GameState): GameState => {
      const contents = new Map(s.figures.contents)
      const at = new Map(s.figures.at)
      const reserve = 'reserve:red'
      const cities = (contents.get(reserve) ?? []).filter((id) => id.startsWith('red/City/')).slice(0, 4)
      contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !cities.includes(id)))
      for (let i = 0; i < cities.length; i++) {
        const dest = Location.system(s.board.systems[i]!)
        contents.set(dest, [...(contents.get(dest) ?? []), cities[i]!])
        at.set(cities[i]!, dest)
      }
      return { ...s, figures: { ...s.figures, contents, at } }
    }
    const noble = scored(withLeader(onBoard(race()), 'red', 'leader12'), { high: 6, low: 3 })
    expect(noble['red']).toBe(6 + 5)
  })
})

describe('Firebrand (Agitator, leader15) — a Weapon alongside a Copy or Pivot tax', () => {
  /** Tax red's first city and report how much of `r` red ends up holding. */
  function taxAndCount(state: GameState, r: Resource): number {
    let system = state.board.systems[0]!
    let city: string | undefined
    for (const s of state.board.systems) {
      const c = contentsOf(state.figures, Location.system(s)).find((id) =>
        id.startsWith('red/City/'),
      )
      if (c !== undefined) {
        system = s
        city = c
        break
      }
    }
    if (city === undefined) throw new Error('red has no city to tax')
    const after = advance(
      state,
      { type: 'action/tax-city', faction: 'red', system, city, then: STOP },
      registry,
    ).state
    return countResource(after.resources, slotsOf(after, 'red'), r)
  }

  /** Slots emptied first, so a gained resource always has somewhere to go. */
  function ready(leaderId: string | undefined, kind: 'lead' | 'copy' | 'pivot'): GameState {
    const base = stripSlots(fresh(), 'red')
    return played(leaderId === undefined ? base : withLeader(base, 'red', leaderId), 'red', kind)
  }

  it('gives the Agitator a Weapon alongside a Copy tax', () => {
    expect(leaderCard('leader15').name).toBe('Agitator')
    expect(taxAndCount(ready('leader15', 'copy'), 'Weapon')).toBe(
      taxAndCount(ready(undefined, 'copy'), 'Weapon') + 1,
    )
  })

  it('gives the Agitator a Weapon alongside a Pivot tax', () => {
    expect(taxAndCount(ready('leader15', 'pivot'), 'Weapon')).toBe(
      taxAndCount(ready(undefined, 'pivot'), 'Weapon') + 1,
    )
  })

  it('gives nothing on a Lead — the trait is "when you Copy or Pivot in order to tax"', () => {
    expect(taxAndCount(ready('leader15', 'lead'), 'Weapon')).toBe(
      taxAndCount(ready(undefined, 'lead'), 'Weapon'),
    )
  })
})

describe('Anarchist (leader13) — Principled and Inspiring rewrite who may be taxed', () => {
  /** A system red has a city in, cleared of ships so a test sets the balance itself. */
  function redCity(): { state: GameState; system: SystemId; city: string } {
    const base = fresh()
    for (const s of base.board.systems) {
      const c = contentsOf(base.figures, Location.system(s)).find((id) => id.startsWith('red/City/'))
      if (c !== undefined) return { state: clearShips(base, s), system: s, city: c }
    }
    throw new Error('red has no city')
  }

  /** A system yellow has a city in, cleared of ships. */
  function yellowCity(): { state: GameState; system: SystemId } {
    const base = fresh()
    for (const s of base.board.systems) {
      const c = contentsOf(base.figures, Location.system(s)).find((id) =>
        id.startsWith('yellow/City/'),
      )
      if (c !== undefined) return { state: clearShips(base, s), system: s }
    }
    throw new Error('yellow has no city')
  }

  const taxLabels = (state: GameState): string[] =>
    labels(advance(state, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry).continue)

  it('Principled: the Anarchist cannot tax its own city, which a base faction can', () => {
    const { state, system, city } = redCity()
    expect(contentsOf(state.figures, Location.system(system))).toContain(city)
    const plain = place(state, 'red', system, 'Ship', 3)
    const anarchist = withLeader(plain, 'red', 'leader13')

    expect(rules(plain, 'red', system)).toBe(true)
    // A base faction taxes its own city here; the Anarchist is offered nothing in this system.
    expect(taxLabels(plain).some((l) => l.startsWith(`Tax ${system} (+`))).toBe(true)
    expect(taxLabels(anarchist).some((l) => l.startsWith(`Tax ${system} (+`))).toBe(false)
  })

  it('Inspiring: taxes a Rival city in a system it does not rule but has ships in', () => {
    const { state, system } = yellowCity()
    // Yellow rules: two ships to red's one. Red may not tax the city in a base game.
    let s = place(state, 'yellow', system, 'Ship', 2)
    s = place(s, 'red', system, 'Ship', 1)
    expect(rules(s, 'red', system)).toBe(false)

    const anarchist = withLeader(s, 'red', 'leader13')
    expect(taxLabels(s).some((l) => l.includes(`yellow's city in ${system}`))).toBe(false)
    expect(taxLabels(anarchist).some((l) => l.includes(`yellow's city in ${system}`))).toBe(true)
  })

  it('Inspiring: needs ships there — presence is the requirement it swaps ruling for', () => {
    const { state, system } = yellowCity()
    const noShips = place(state, 'yellow', system, 'Ship', 2)
    const anarchist = withLeader(noShips, 'red', 'leader13')
    expect(taxLabels(anarchist).some((l) => l.includes(`yellow's city in ${system}`))).toBe(false)
  })

  it('Inspiring: taxes empty building slots like Loyal cities, once each per turn', () => {
    // A planet with room left in it and a resource to gain — the yellow-city planet is full.
    const base = fresh()
    const system = base.board.systems.find(
      (id) => freeSlots(base, id) > 0 && systemInfo(id).resource !== null,
    )
    if (system === undefined) throw new Error('no planet with an open building slot')
    const s = place(base, 'red', system, 'Ship', 1)
    const open = freeSlots(s, system)
    expect(open).toBeGreaterThan(0)

    const anarchist = withLeader(s, 'red', 'leader13')
    const here = (state: GameState): number =>
      taxLabels(state).filter((l) => l.includes(`empty slot in ${system}`)).length
    expect(here(s)).toBe(0)
    expect(here(anarchist)).toBe(open)

    // Taxing one takes it off the table for the rest of the turn.
    const taxed = advance(
      anarchist,
      {
        type: 'action/tax-city',
        faction: 'red',
        system,
        city: `emptyslot:${system}:0`,
        then: STOP,
      },
      registry,
    ).state
    expect(here(taxed)).toBe(open - 1)
  })

  it('Inspiring: an empty slot captures nobody — nobody owns it', () => {
    const base = fresh()
    const system = base.board.systems.find(
      (id) => freeSlots(base, id) > 0 && systemInfo(id).resource !== null,
    )
    if (system === undefined) throw new Error('no planet with an open building slot')
    const anarchist = withLeader(place(base, 'red', system, 'Ship', 1), 'red', 'leader13')
    const before = contentsOf(anarchist.figures, `captives:red`).length
    const after = advance(
      anarchist,
      {
        type: 'action/tax-city',
        faction: 'red',
        system,
        city: `emptyslot:${system}:0`,
        then: STOP,
      },
      registry,
    ).state
    expect(contentsOf(after.figures, `captives:red`).length).toBe(before)
  })
})

describe('Corsair (leader11) — Wary caps the pool, Tricky rerolls the raid dice', () => {
  /** A system red attacks yellow in, with a building so raid dice are legal. */
  function contested(leaderFor?: FactionId): { state: GameState; system: SystemId } {
    const base = fresh()
    const system = base.board.systems.find(
      (id) => contentsOf(base.figures, Location.system(id)).some((f) => f.startsWith('yellow/City/')),
    )
    if (system === undefined) throw new Error('yellow has no city')
    let s = clearShips(leaderFor === undefined ? base : withLeader(base, leaderFor, 'leader11'), system)
    s = place(s, 'red', system, 'Ship', 6)
    s = place(s, 'yellow', system, 'Ship', 1)
    return { state: s, system }
  }

  /** Every (skirmish, assault) pair the gather menu offers. */
  function pools(state: GameState, system: SystemId): { s: number; a: number; r: number }[] {
    const c = advance(
      state,
      { type: 'battle/target', faction: 'red', system, enemy: 'yellow', then: STOP },
      registry,
    ).continue
    return ask(c)
      .actions.filter((a) => a.type === 'battle/roll')
      .map((a) => ({ s: a['skirmish'] as number, a: a['assault'] as number, r: a['raid'] as number }))
  }

  it('Wary: no pool has more assault dice than skirmish dice', () => {
    const plain = contested()
    const corsair = contested('red')
    expect(pools(plain.state, plain.system).some((p) => p.a > p.s)).toBe(true)
    expect(pools(corsair.state, corsair.system).some((p) => p.a > p.s)).toBe(false)
    // It caps rather than empties: equal counts are still on offer.
    expect(pools(corsair.state, corsair.system).some((p) => p.a === p.s && p.a > 0)).toBe(true)
  })

  it('Wary: leaves the defender alone — it is an attacking restriction', () => {
    const other = contested('yellow')
    expect(pools(other.state, other.system).some((p) => p.a > p.s)).toBe(true)
  })

  function roll(state: GameState, system: SystemId, pool: { s: number; a: number; r: number }) {
    return advance(
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
  }

  /** How many *different* resource types red holds — what Tricky counts. */
  function distinct(state: GameState): number {
    const slots = slotsOf(state, 'red')
    return (['Material', 'Fuel', 'Weapon', 'Psionic', 'Relic'] as const).filter(
      (r) => countResource(state.resources, slots, r) > 0,
    ).length
  }

  /** Give red up to `n` distinct resource types, having emptied its slots first. */
  function kinds(state: GameState, n: number): GameState {
    const all = ['Material', 'Fuel', 'Weapon', 'Psionic', 'Relic'] as const
    let s = stripSlots(state, 'red')
    for (const r of all.slice(0, n)) {
      const got = gain(s.resources, slotsOf(s, 'red'), r)
      if (got.gained) s = { ...s, resources: got.tracker }
    }
    return s
  }

  it('Tricky: offers a raid reroll, and no reroll at all without the leader', () => {
    const plain = contested()
    const corsair = contested('red')
    const withoutIt = roll(kinds(plain.state, 3), plain.system, { s: 0, a: 0, r: 2 })
    const withIt = roll(kinds(corsair.state, 3), corsair.system, { s: 0, a: 0, r: 2 })
    expect(ask(withoutIt.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(false)
    expect(ask(withIt.continue).actions.some((a) => a.type === 'battle/reroll')).toBe(true)
  })

  it('Tricky: rerolls up to the number of different resources, not the number of tokens', () => {
    /** The largest reroll the menu offers. */
    const widest = (state: GameState, system: SystemId): number => {
      const out = roll(state, system, { s: 0, a: 0, r: 4 })
      const sizes = ask(out.continue)
        .actions.filter((a) => a.type === 'battle/reroll')
        .map((a) => (a['indices'] as number[]).length)
      return sizes.length === 0 ? 0 : Math.max(...sizes)
    }
    // Slot capacity is what it is, so the expectation is read off the board rather than assumed.
    const two = contested('red')
    const many = contested('red')
    const narrow = kinds(two.state, 2)
    const broad = kinds(many.state, 5)
    expect(widest(narrow, two.system)).toBe(distinct(narrow))
    expect(widest(broad, many.system)).toBe(distinct(broad))
    expect(distinct(broad)).toBeGreaterThan(distinct(narrow))

    // Several tokens of *one* type is one different resource, so it buys a single reroll —
    // however many tokens fit. This is the half a token count would get wrong.
    let deep = stripSlots(many.state, 'red')
    for (let i = 0; i < 4; i++) {
      const got = gain(deep.resources, slotsOf(deep, 'red'), 'Fuel')
      if (got.gained) deep = { ...deep, resources: got.tracker }
    }
    expect(countResource(deep.resources, slotsOf(deep, 'red'), 'Fuel')).toBeGreaterThan(1)
    expect(distinct(deep)).toBe(1)
    expect(widest(deep, many.system)).toBe(1)
  })
})

describe('Irregular (Agitator, leader15) — intercept strikes with Weapons, not with ships', () => {
  /**
   * Red attacks yellow with a pool that is *all* assault dice, so an intercept face is likely,
   * and sweep seeds until one actually comes up — the roll is seeded, so this pins a real roll
   * rather than stubbing the dice.
   */
  function intercepted(opts: {
    leader?: boolean
    yellowShips: number
    weapons: number
  }): { self: number; state: GameState; weaponsAfter: number } {
    for (let seed = 1; seed < 300; seed++) {
      const base = startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
      const system = base.board.systems[0]!
      let s = clearShips(base, system)
      s = place(s, 'red', system, 'Ship', 4)
      s = place(s, 'yellow', system, 'Ship', opts.yellowShips)
      s = stripSlots(s, 'yellow')
      for (let i = 0; i < opts.weapons; i++) {
        const got = gain(s.resources, slotsOf(s, 'yellow'), 'Weapon')
        if (got.gained) s = { ...s, resources: got.tracker }
      }
      if (opts.leader === true) s = withLeader(s, 'yellow', 'leader15')

      const out = advance(
        s,
        {
          type: 'battle/roll',
          faction: 'red',
          system,
          enemy: 'yellow',
          skirmish: 0,
          assault: 4,
          raid: 0,
          then: STOP,
        },
        registry,
      )
      if (!out.state.log.join('\n').includes(', intercept,')) continue
      const ctx = ask(out.continue).actions[0]?.['ctx'] as
        | { self: number; intercepted: number }
        | undefined
      if (ctx === undefined) continue
      return {
        // `intercepted` is the interception alone; `self` also folds in the dice's own
        // self-damage faces, which have nothing to do with this trait.
        self: ctx.intercepted,
        state: out.state,
        weaponsAfter: countResource(out.state.resources, slotsOf(out.state, 'yellow'), 'Weapon'),
      }
    }
    throw new Error('no seed under 300 rolled an intercept')
  }

  it('takes hits from the defender\'s Weapon icons rather than its fresh ships', () => {
    // One defending ship, three Weapons: a base game strikes for 1, the Agitator for 3.
    const plain = intercepted({ yellowShips: 1, weapons: 3 })
    const agitator = intercepted({ leader: true, yellowShips: 1, weapons: 3 })
    expect(agitator.self).toBeGreaterThan(plain.self)
    expect(agitator.state.log.join('\n')).toContain('Irregular')
  })

  it('still bites with no fresh defending ships at all — the fleet is not what strikes', () => {
    const plain = intercepted({ yellowShips: 0, weapons: 2 })
    const agitator = intercepted({ leader: true, yellowShips: 0, weapons: 2 })
    expect(plain.self).toBe(0)
    expect(agitator.self).toBeGreaterThan(0)
  })

  it('discards one Weapon as the price, once for the battle', () => {
    const agitator = intercepted({ leader: true, yellowShips: 1, weapons: 3 })
    const plain = intercepted({ yellowShips: 1, weapons: 3 })
    expect(plain.weaponsAfter).toBe(3)
    expect(agitator.weaponsAfter).toBe(2)
  })

  it('costs nothing when the defender holds no Weapon to discard', () => {
    const agitator = intercepted({ leader: true, yellowShips: 1, weapons: 0 })
    expect(agitator.weaponsAfter).toBe(0)
    expect(agitator.state.log.join('\n')).not.toContain('discarded a Weapon')
  })
})

describe('Resilient (Quartermaster, leader16) — repair per starport you control', () => {
  /** Damage `n` of a colour's ships in a system. */
  function damage(state: GameState, color: string, system: SystemId, n: number): GameState {
    const hurt = contentsOf(state.figures, Location.system(system))
      .filter((id) => id.startsWith(`${color}/Ship/`))
      .slice(0, n)
    return { ...state, damaged: [...state.damaged, ...hurt] }
  }

  /** Settle a finished battle between red and yellow in `system`, and report red's damage. */
  function settle(state: GameState, system: SystemId): GameState {
    return advance(
      state,
      {
        type: 'battle/settle',
        ctx: {
          faction: 'red',
          system,
          enemy: 'yellow',
          self: 0,
          intercepted: 0,
          ships: 0,
          buildings: 0,
          keys: 0,
          razed: false,
          then: STOP,
        },
      },
      registry,
    ).state
  }

  /** Send every starport on the map back to reserve, so a test owns the count outright. */
  function clearStarports(state: GameState): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    for (const sys of state.board.systems) {
      const here = Location.system(sys)
      const staying: string[] = []
      for (const id of contents.get(here) ?? []) {
        if (!id.includes('/Starport/')) {
          staying.push(id)
          continue
        }
        const from = `reserve:${id.slice(0, id.indexOf('/'))}`
        contents.set(from, [...(contents.get(from) ?? []), id])
        at.set(id, from)
      }
      contents.set(here, staying)
    }
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  /** Starports standing in systems red rules — exactly what the trait counts. */
  function controlledPorts(state: GameState): number {
    let n = 0
    for (const sys of state.board.systems) {
      if (!rules(state, 'red', sys)) continue
      n += contentsOf(state.figures, Location.system(sys)).filter((id) =>
        id.includes('/Starport/'),
      ).length
    }
    return n
  }

  /**
   * A battle system red rules, with every other starport swept off the map so `ports` is the
   * total red controls rather than merely the ones this helper placed.
   */
  function fought(opts: { leader?: boolean; ports: number; portColor?: string; hurt: number }) {
    const base = clearStarports(fresh())
    const system = base.board.systems[0]!
    let s = clearShips(base, system)
    s = place(s, 'red', system, 'Ship', 5)
    s = place(s, 'yellow', system, 'Ship', 1)
    if (opts.ports > 0) s = place(s, opts.portColor ?? 'red', system, 'Starport', opts.ports)
    s = damage(s, 'red', system, opts.hurt)
    if (opts.leader === true) s = withLeader(s, 'red', 'leader16')
    return { state: s, system }
  }

  const damagedRed = (s: GameState): number => s.damaged.filter((id) => id.startsWith('red/')).length

  it('repairs nothing without the leader', () => {
    const { state, system } = fought({ ports: 2, hurt: 3 })
    expect(controlledPorts(state)).toBe(2)
    expect(damagedRed(settle(state, system))).toBe(3)
  })

  it('repairs one ship per starport it controls', () => {
    const { state, system } = fought({ leader: true, ports: 2, hurt: 3 })
    expect(controlledPorts(state)).toBe(2)
    expect(damagedRed(settle(state, system))).toBe(1)
  })

  it('counts a Rival starport in a system it rules — "Even Rival ones!"', () => {
    const mine = fought({ leader: true, ports: 1, hurt: 3 })
    const theirs = fought({ leader: true, ports: 1, portColor: 'yellow', hurt: 3 })
    expect(rules(theirs.state, 'red', theirs.system)).toBe(true)
    expect(controlledPorts(theirs.state)).toBe(1)
    expect(damagedRed(settle(theirs.state, theirs.system))).toBe(
      damagedRed(settle(mine.state, mine.system)),
    )
    expect(damagedRed(settle(theirs.state, theirs.system))).toBe(2)
  })

  it('repairs nothing with no starport under its control', () => {
    const { state, system } = fought({ leader: true, ports: 0, hurt: 3 })
    expect(controlledPorts(state)).toBe(0)
    expect(damagedRed(settle(state, system))).toBe(3)
  })

  it('never repairs more ships than are damaged', () => {
    const { state, system } = fought({ leader: true, ports: 2, hurt: 1 })
    expect(damagedRed(settle(state, system))).toBe(0)
  })

  it('ignores a starport in a system it does not rule — control is the requirement', () => {
    const { state, system } = fought({ leader: true, ports: 1, hurt: 3 })
    // A second starport parked in a system yellow rules outright must not count for red.
    const elsewhere = state.board.systems.find((id) => id !== system)!
    let s = place(clearShips(state, elsewhere), 'yellow', elsewhere, 'Ship', 3)
    s = place(s, 'yellow', elsewhere, 'Starport', 1)
    expect(rules(s, 'red', elsewhere)).toBe(false)
    expect(controlledPorts(s)).toBe(1)
    // Still 1 controlled starport, so still exactly one repair.
    expect(damagedRed(settle(s, system))).toBe(2)
  })

  it('repairs the defender too — "after any battle with you", not just the attacker', () => {
    const base = clearStarports(fresh())
    const system = base.board.systems[0]!
    let s = clearShips(base, system)
    s = place(s, 'red', system, 'Ship', 1)
    s = place(s, 'yellow', system, 'Ship', 5)
    s = place(s, 'yellow', system, 'Starport', 2)
    const hurt = contentsOf(s.figures, Location.system(system))
      .filter((id) => id.startsWith('yellow/Ship/'))
      .slice(0, 3)
    s = { ...s, damaged: [...s.damaged, ...hurt] }

    const damagedYellow = (g: GameState): number =>
      g.damaged.filter((id) => id.startsWith('yellow/')).length
    const plain = settle(s, system)
    const quartermaster = settle(withLeader(s, 'yellow', 'leader16'), system)
    expect(damagedYellow(plain)).toBe(3)
    expect(damagedYellow(quartermaster)).toBe(1)
  })
})

describe('Ancient (Shaper, leader14) — catapult from gates, never from starports', () => {
  /**
   * Whether the Move menu offers to carry on past `to` — the catapult, which the menu marks
   * "— and further" on the leg that earns it.
   */
  function catapults(state: GameState, from: SystemId, to: SystemId): boolean {
    const c = advance(
      state,
      { type: 'action/take', faction: 'red', action: 'Move', then: STOP },
      registry,
    ).continue
    return labels(c).includes(`Move ${from} → ${to} (2 ships) — and further`)
  }

  it('a starport launches a base faction and not the Shaper', () => {
    const base = fresh()
    // A planet with a red starport, next to a gate. The gate is emptied first: a rival ruling the
    // destination blocks the catapult for everyone, which would hide the trait.
    const from = base.board.systems.find(
      (id) =>
        !systemInfo(id).isGate &&
        contentsOf(base.figures, Location.system(id)).some((f) => f.startsWith('red/Starport/')) &&
        connectedSystems(base.board, id).some((n) => systemInfo(n).isGate),
    )
    if (from === undefined) throw new Error('red has no starport next to a gate')
    const to = connectedSystems(base.board, from).find((id) => systemInfo(id).isGate)!

    const s = place(clearShips(clearShips(base, from), to), 'red', from, 'Ship', 2)
    expect(catapults(s, from, to)).toBe(true)
    expect(catapults(withLeader(s, 'red', 'leader14'), from, to)).toBe(false)
    expect(leaderCard('leader14').name).toBe('Shaper')
  })

  it('a gate launches the Shaper and not a base faction', () => {
    const base = fresh()
    // Gate to gate, with no starport anywhere near: nothing a base faction may catapult from.
    let from: SystemId | undefined
    let to: SystemId | undefined
    for (const id of base.board.systems) {
      if (!systemInfo(id).isGate) continue
      const next = connectedSystems(base.board, id).find((n) => systemInfo(n).isGate)
      if (next !== undefined) {
        from = id
        to = next
        break
      }
    }
    if (from === undefined || to === undefined) throw new Error('no gate adjacent to another gate')

    const s = place(clearShips(clearShips(base, from), to), 'red', from, 'Ship', 2)
    expect(
      contentsOf(s.figures, Location.system(from)).some((f) => f.startsWith('red/Starport/')),
    ).toBe(false)
    expect(catapults(s, from, to)).toBe(false)
    expect(catapults(withLeader(s, 'red', 'leader14'), from, to)).toBe(true)
  })
})

describe('Noble (leader12) — Connected secures on a fresh declaration', () => {
  /** Declare `ambition` for `faction`, and report what it holds afterwards. */
  function declare(state: GameState, faction: FactionId, ambition: 'Tycoon' | 'Tyrant'): GameState {
    return advance(
      state,
      { type: 'ambition/declare', faction, ambition, suit: 'Material', pips: 1 },
      registry,
    ).state
  }

  it('draws and secures the top court card on a fresh declaration', () => {
    const base = fresh()
    const top = contentsOf(base.courtCards, CourtPile.deck())[0]!
    const plain = declare(base, 'red', 'Tycoon')
    const noble = declare(withLeader(base, 'red', 'leader12'), 'red', 'Tycoon')
    expect(securedCards(plain, 'red')).toHaveLength(0)
    expect(securedCards(noble, 'red')).toEqual([top])
    expect(noble.log.join('\n')).toContain('Connected')
  })

  it('does nothing when the ambition is already declared', () => {
    const base = withLeader(fresh(), 'red', 'leader12')
    const already: GameState = {
      ...base,
      declared: [{ ambition: 'Tycoon', marker: { high: 6, low: 3 } }],
    }
    expect(securedCards(declare(already, 'red', 'Tycoon'), 'red')).toHaveLength(0)
    // A *different* ambition is still fresh, so it still pays.
    expect(securedCards(declare(already, 'red', 'Tyrant'), 'red')).toHaveLength(1)
  })

  it('leaves a faction without the trait alone', () => {
    const base = withLeader(fresh(), 'yellow', 'leader12')
    expect(securedCards(declare(base, 'red', 'Tycoon'), 'red')).toHaveLength(0)
  })

  it('a Farseers drawn by Connected does not peek on the same declaration (docs/21 B4)', () => {
    /*
     * The official FAQ: "If I secure Farseers, does Connected trigger? No. Farseers being drawn
     * as a result of Connected does not see the timing window to then trigger its ability."
     * Eligibility is judged on the pre-declare hold, so the freshly secured card stays quiet —
     * and a Farseers held BEFORE declaring still peeks (the positive control).
     */
    const moveCourt = (state: GameState, card: string, to: string): GameState => {
      const contents = new Map(state.courtCards.contents)
      const at = new Map(state.courtCards.at)
      const from = at.get(card)!
      contents.set(from, (contents.get(from) ?? []).filter((c) => c !== card))
      contents.set(to, [card, ...(contents.get(to) ?? []).filter((c) => c !== card)])
      at.set(card, to)
      return { ...state, courtCards: { ...state.courtCards, contents, at } }
    }
    const DECLARE = {
      type: 'ambition/declare',
      faction: 'red',
      ambition: 'Tycoon',
      suit: 'Material',
      pips: 1,
    } as const

    const noble = moveCourt(withLeader(fresh(), 'red', 'leader12'), 'bc17', CourtPile.deck())
    const out = advance(noble, DECLARE, registry)
    expect(securedCards(out.state, 'red')).toEqual(['bc17'])
    expect(
      out.continue.kind === 'ask' &&
        out.continue.actions.some((a) => String(a.type).startsWith('ambition/farseers')),
    ).toBe(false)

    const holder = moveCourt(fresh(), 'bc17', CourtPile.secured('red'))
    const peek = advance(holder, DECLARE, registry).continue
    expect(
      peek.kind === 'ask' && peek.actions.some((a) => a.type === 'ambition/farseers-look'),
    ).toBe(true)
  })
})

describe('Influential (Noble, leader12) — a Copy or Pivot influences twice', () => {
  function influence(state: GameState, slot: number, again?: boolean) {
    return advance(
      state,
      { type: 'action/influence', faction: 'red', slot, then: STOP, ...(again === true ? { again: true } : {}) },
      registry,
    )
  }

  const ready = (leader: boolean, kind: 'lead' | 'copy' | 'pivot'): GameState =>
    played(leader ? withLeader(fresh(), 'red', 'leader12') : fresh(), 'red', kind)

  it('offers a second influence after a Copy', () => {
    const out = influence(ready(true, 'copy'), 1)
    expect(ask(out.continue).actions.some((a) => a.type === 'action/influence')).toBe(true)
    expect(labels(out.continue).some((l) => l.endsWith('again'))).toBe(true)
  })

  /** Is a second influence on offer? `then` is itself a menu, so the kind alone proves nothing. */
  const offersAgain = (c: Continue): boolean =>
    c.kind === 'ask' && c.actions.some((a) => a['again'] === true)

  it('offers nothing extra after a Lead, or without the leader', () => {
    expect(offersAgain(influence(ready(true, 'lead'), 1).continue)).toBe(false)
    expect(offersAgain(influence(ready(false, 'copy'), 1).continue)).toBe(false)
  })

  it('places a second agent when the second influence is taken', () => {
    const first = influence(ready(true, 'pivot'), 1)
    const second = ask(first.continue).actions.find((a) => a.type === 'action/influence')!
    const after = advance(first.state, second, registry)
    const onCourt = (g: GameState): number =>
      [1, 2, 3, 4].reduce(
        (n, k) => n + contentsOf(g.figures, Location.court(k)).filter((id) => id.startsWith('red/')).length,
        0,
      )
    expect(onCourt(first.state)).toBe(1)
    expect(onCourt(after.state)).toBe(2)
    // Twice, not repeatedly — the second influence offers no third.
    expect(offersAgain(after.continue)).toBe(false)
  })

  it('lets the Noble decline the second — the card says "may"', () => {
    const first = influence(ready(true, 'copy'), 1)
    expect(ask(first.continue).actions.some((a) => a.type === 'action/skip')).toBe(true)
  })
})

describe('Mythic (Shaper, leader14) — reshape a planet you taxed', () => {
  /**
   * A planet red has a city on, red's slots emptied, and `hold` copies of a resource that is
   * **not** the planet's own type — reshaping a planet into what it already is would be no change,
   * and the offer correctly withholds it.
   */
  function taxable(opts: { leader?: boolean; hold?: number } = {}) {
    const base = fresh()
    let system: SystemId | undefined
    let city: string | undefined
    for (const id of base.board.systems) {
      const c = contentsOf(base.figures, Location.system(id)).find((f) => f.startsWith('red/City/'))
      if (c !== undefined && !systemInfo(id).isGate) {
        system = id
        city = c
        break
      }
    }
    if (system === undefined || city === undefined) throw new Error('red has no city on a planet')

    const printed = planetResource(base, system)
    const other = (['Material', 'Fuel', 'Weapon', 'Psionic', 'Relic'] as const).find(
      (r) => r !== printed,
    )!
    let s = stripSlots(base, 'red')
    for (let i = 0; i < (opts.hold ?? 0); i++) {
      const got = gain(s.resources, slotsOf(s, 'red'), other)
      if (got.gained) s = { ...s, resources: got.tracker }
    }
    if (opts.leader === true) s = withLeader(s, 'red', 'leader14')
    return { state: s, system, city, other, printed }
  }

  const tax = (state: GameState, system: SystemId, city: string) =>
    advance(state, { type: 'action/tax-city', faction: 'red', system, city, then: STOP }, registry)

  it('offers a reshape after taxing, and nothing without the leader', () => {
    const plain = taxable({ hold: 2 })
    const shaper = taxable({ leader: true, hold: 2 })
    expect(labels(tax(plain.state, plain.system, plain.city).continue).some((l) => l.includes('Mythic'))).toBe(false)
    expect(labels(tax(shaper.state, shaper.system, shaper.city).continue).some((l) => l.includes('Mythic'))).toBe(true)
  })

  it('changes the planet type from then on, and spends the token', () => {
    const { state, system, city, other, printed } = taxable({ leader: true, hold: 2 })
    expect(printed).not.toBe(other)

    const out = tax(state, system, city)
    const reshape = ask(out.continue).actions.find((a) => a.type === 'leaders/mythic-place')!
    const held = countResource(out.state.resources, slotsOf(out.state, 'red'), other)
    const after = advance(out.state, reshape, registry).state

    expect(planetResource(after, system)).toBe(other)
    expect(countResource(after.resources, slotsOf(after, 'red'), other)).toBe(held - 1)
    expect(after.log.join('\n')).toContain('Mythic')
  })

  it('the new type is what taxing that planet now gains', () => {
    const { state, system, city, other } = taxable({ leader: true, hold: 2 })
    const out = tax(state, system, city)
    const reshape = ask(out.continue).actions.find((a) => a.type === 'leaders/mythic-place')!
    const after = advance(out.state, reshape, registry).state
    // A new turn, so the city may be taxed again.
    const nextTurn: GameState = { ...after, taxedThisTurn: [] }
    const labelsNow = labels(
      advance(nextTurn, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
        .continue,
    )
    expect(labelsNow).toContain(`Tax ${system} (+${other})`)
  })

  it('cannot reshape the same planet twice', () => {
    const { state, system, city } = taxable({ leader: true, hold: 2 })
    const out = tax(state, system, city)
    const reshape = ask(out.continue).actions.find((a) => a.type === 'leaders/mythic-place')!
    const after = advance(out.state, reshape, registry).state
    const again = tax({ ...after, taxedThisTurn: [] }, system, city)
    expect(labels(again.continue).some((l) => l.includes('Mythic'))).toBe(false)
  })

  it('offers nothing when the Shaper holds no resource to place', () => {
    const { state, system, city } = taxable({ leader: true, hold: 0 })
    // The taxed resource itself lands in a slot, and matching the planet's own type is no change.
    const offered = labels(tax(state, system, city).continue).filter((l) => l.includes('Mythic'))
    expect(offered).toHaveLength(0)
  })

  it('does not fire off Inspiring\'s empty slots — the card says "after you tax a **city**"', () => {
    /*
     * Reached by dispatching the tax directly. No dealt game can offer this — empty-slot taxing
     * comes only from Inspiring, which is the Anarchist's, and a faction has one leader — so this
     * pins the guard's intent rather than a situation the menus can produce.
     */
    const { state, system } = taxable({ leader: true, hold: 2 })
    const out = tax(state, system, `emptyslot:${system}:0`)
    expect(labels(out.continue).some((l) => l.includes('Mythic'))).toBe(false)
    expect(planetResource(out.state, system)).toBe(planetResource(state, system))
  })

  it('lets the Shaper decline', () => {
    const { state, system, city } = taxable({ leader: true, hold: 2 })
    const out = tax(state, system, city)
    expect(labels(out.continue)).toContain('Leave the planet as it is')
  })
})

describe('Ruthless (Overseer, leader10) — hit a building to use it twice', () => {
  /** A planet with red's city, red ruling it, slots cleared so gains always land. */
  function taxed(opts: { leader?: boolean; hurt?: boolean } = {}) {
    const base = fresh()
    let system: SystemId | undefined
    let city: string | undefined
    for (const id of base.board.systems) {
      const c = contentsOf(base.figures, Location.system(id)).find((f) => f.startsWith('red/City/'))
      if (c !== undefined && !systemInfo(id).isGate) {
        system = id
        city = c
        break
      }
    }
    if (system === undefined || city === undefined) throw new Error('red has no city on a planet')
    let s = stripSlots(base, 'red')
    if (opts.hurt === true) s = { ...s, damaged: [...s.damaged, city] }
    if (opts.leader === true) s = withLeader(s, 'red', 'leader10')
    return { state: s, system, city }
  }

  const tax = (state: GameState, system: SystemId, city: string) =>
    advance(state, { type: 'action/tax-city', faction: 'red', system, city, then: STOP }, registry)

  it('offers the squeeze after taxing, and nothing without the leader', () => {
    const plain = taxed()
    const overseer = taxed({ leader: true })
    expect(labels(tax(plain.state, plain.system, plain.city).continue).some((l) => l.startsWith('Hit the'))).toBe(false)
    expect(labels(tax(overseer.state, overseer.system, overseer.city).continue).some((l) => l.startsWith('Hit the'))).toBe(true)
  })

  it('damages a fresh building and taxes again', () => {
    const { state, system, city } = taxed({ leader: true })
    const first = tax(state, system, city)
    const held = countResource(first.state.resources, slotsOf(first.state, 'red'), planetResource(state, system)!)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry).state

    expect(after.damaged).toContain(city)
    expect(contentsOf(after.figures, Location.system(system))).toContain(city)
    expect(countResource(after.resources, slotsOf(after, 'red'), planetResource(state, system)!)).toBe(held + 1)
  })

  it('destroys a building already damaged, and provokes outrage for a city', () => {
    const { state, system, city } = taxed({ leader: true, hurt: true })
    const first = tax(state, system, city)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry).state

    expect(contentsOf(after.figures, Location.system(system))).not.toContain(city)
    // Home to its owner's reserve, not to the Overseer's trophies.
    expect(contentsOf(after.figures, Location.reserve('red'))).toContain(city)
    expect(contentsOf(after.figures, Location.trophies('red'))).not.toContain(city)
    expect(isOutraged(after, 'red', planetResource(state, system)!)).toBe(true)
  })

  it('is once per turn', () => {
    const { state, system, city } = taxed({ leader: true })
    const first = tax(state, system, city)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry).state
    const second = tax({ ...after, taxedThisTurn: [] }, system, city)
    expect(labels(second.continue).some((l) => l.startsWith('Hit the'))).toBe(false)
  })

  it('lets the Overseer spare the building', () => {
    const { state, system, city } = taxed({ leader: true })
    expect(labels(tax(state, system, city).continue)).toContain('Spare the building')
  })

  it('offers a Ransack when the destroyed city was a Rival\'s', () => {
    // Red rules a system holding a damaged yellow city, and taxes it.
    const base = fresh()
    let system: SystemId | undefined
    let city: string | undefined
    for (const id of base.board.systems) {
      const c = contentsOf(base.figures, Location.system(id)).find((f) =>
        f.startsWith('yellow/City/'),
      )
      if (c !== undefined && !systemInfo(id).isGate) {
        system = id
        city = c
        break
      }
    }
    if (system === undefined || city === undefined) throw new Error('yellow has no city')

    let s = place(clearShips(stripSlots(base, 'red'), system), 'red', system, 'Ship', 3)
    s = { ...s, damaged: [...s.damaged, city] }
    // Yellow needs an agent in court for there to be anything to ransack.
    const contents = new Map(s.figures.contents)
    const at = new Map(s.figures.at)
    const agent = (contents.get('reserve:yellow') ?? []).find((id) => id.startsWith('yellow/Agent/'))!
    contents.set('reserve:yellow', (contents.get('reserve:yellow') ?? []).filter((id) => id !== agent))
    contents.set(Location.court(1), [...(contents.get(Location.court(1)) ?? []), agent])
    at.set(agent, Location.court(1))
    s = { ...s, figures: { ...s.figures, contents, at } }

    expect(rules(s, 'red', system)).toBe(true)
    const overseer = withLeader(s, 'red', 'leader10')
    const first = tax(overseer, system, city)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry)
    expect(labels(after.continue).some((l) => l.startsWith('Ransack'))).toBe(true)
    expect(labels(after.continue)).toContain('Ransack nothing')
  })

  it('fires off building a Ship at a starport, and builds another', () => {
    const base = fresh()
    const system = base.board.systems.find((id) =>
      contentsOf(base.figures, Location.system(id)).some((f) => f.startsWith('red/Starport/')),
    )
    if (system === undefined) throw new Error('red has no starport')
    const port = contentsOf(base.figures, Location.system(system)).find((f) =>
      f.startsWith('red/Starport/'),
    )!
    const overseer = withLeader(base, 'red', 'leader10')
    const ships = (g: GameState): number =>
      contentsOf(g.figures, Location.system(system)).filter((f) => f.startsWith('red/Ship/')).length

    const build = (g: GameState) =>
      advance(
        g,
        { type: 'action/build', faction: 'red', piece: 'Ship', system, starport: port, then: STOP },
        registry,
      )

    const plain = build(base)
    expect(labels(plain.continue).some((l) => l.startsWith('Hit the'))).toBe(false)

    const first = build(overseer)
    expect(labels(first.continue).some((l) => l.startsWith('Hit the'))).toBe(true)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry).state

    // One ship from the build, a second from the squeeze; the starport is damaged, not gone.
    expect(ships(after)).toBe(ships(base) + 2)
    expect(after.damaged).toContain(port)
    expect(contentsOf(after.figures, Location.system(system))).toContain(port)
    // A starport is not a city, so nothing is outraged by hitting one.
    expect(after.outraged['red'] ?? []).toHaveLength(0)
  })

  it('settles the slots when destroying its own city shrinks capacity', () => {
    /*
     * Ruthless is the first thing in the game that sends a building home to its owner's reserve,
     * which raises cities-in-reserve and *lowers* slot capacity. A token in a slot that is no
     * longer usable would be stranded — invisible to `slotsOf`, so uncountable, unspendable and
     * unraidable. The arrange step has to catch it, and it does because the repeated tax gains.
     */
    const { state, system, city } = taxed({ leader: true, hurt: true })
    // Two held; the tax itself fills the third, so nothing overflows before Ruthless is offered.
    let s = state
    for (const r of ['Fuel', 'Material'] as const) {
      const got = gain(s.resources, slotsOf(s, 'red'), r)
      if (got.gained) s = { ...s, resources: got.tracker }
    }
    expect(slotsOf(s, 'red')).toHaveLength(3)

    const first = tax(s, system, city)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry)

    // The city is gone, so the board is down to two slots.
    expect(slotsOf(after.state, 'red')).toHaveLength(2)
    // And the player is being made to settle it rather than left holding a dead token.
    const c = ask(after.continue)
    expect(c.actions.some((a) => a.type === 'resources/arrange-discard')).toBe(true)
    expect(c.actions.some((a) => a.type === 'resources/arrange-done')).toBe(false)
  })

  it('offers no Ransack for destroying its own city', () => {
    const { state, system, city } = taxed({ leader: true, hurt: true })
    const first = tax(state, system, city)
    const hit = ask(first.continue).actions.find((a) => a.type === 'leaders/ruthless-hit')!
    const after = advance(first.state, hit, registry)
    expect(labels(after.continue).some((l) => l.startsWith('Ransack'))).toBe(false)
  })
})
