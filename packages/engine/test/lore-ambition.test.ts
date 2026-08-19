/**
 * The ambition-paired expansion lore (19-28).
 *
 * All ten print **"While <Ambition> is declared"**, which is the reason they are one batch: the
 * gate is a single helper (`loreActive`) and each card's effect hangs off it. Every test here
 * therefore checks the same two things — that the effect happens with the ambition declared, and
 * that it does *not* happen without it. A card that ignored its gate would pass a one-sided test.
 *
 * Five also print "Prelude: You may discard this to clear your <resource> Outrage". That half is
 * deliberately *not* gated — the card prints only "Prelude" there — and is tested separately.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  connectedSystems,
  contentsOf,
  countResource,
  defaultRegistry,
  isOutraged,
  loreActive,
  slotsOf,
  startGame,
  system as systemInfo,
} from '../src/index.js'
import type { Ambition, Continue, GameState } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()
const STOP = { type: 'turn/lead-main', faction: 'red' } as const

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state

const withLore = (s: GameState, f: 'red' | 'yellow', ...ids: string[]): GameState => ({
  ...s,
  lores: { ...s.lores, [f]: ids },
})

const declared = (s: GameState, a: Ambition): GameState => ({
  ...s,
  declared: [...s.declared, { ambition: a, marker: { high: 6, low: 3 } }],
})

const ask = (c: Continue): Extract<Continue, { kind: 'ask' }> => {
  if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
  return c
}
const labels = (c: Continue): string[] => ask(c).actions.map((a) => String(a['label'] ?? a.type))

const prelude = (s: GameState): Continue =>
  advance(s, { type: 'turn/prelude', faction: 'red', suit: 'Construction', pips: 1 }, registry)
    .continue

/** Give a faction `n` of a resource, slots emptied first so it always lands. */
function give(s: GameState, f: 'red' | 'yellow', r: string, n: number): GameState {
  const contents = new Map(s.resources.contents)
  const at = new Map(s.resources.at)
  for (let i = 0; i < 6; i++) {
    for (const t of contents.get(`cityslot:${f}:${i}`) ?? []) {
      const sup = `supply:${t.slice(0, t.indexOf('#'))}`
      contents.set(sup, [...(contents.get(sup) ?? []), t])
      at.set(t, sup)
    }
    contents.set(`cityslot:${f}:${i}`, [])
  }
  for (let i = 0; i < n; i++) {
    const sup = `supply:${r}`
    const token = (contents.get(sup) ?? [])[0]
    if (token === undefined) break
    contents.set(sup, (contents.get(sup) ?? []).filter((t) => t !== token))
    contents.set(`cityslot:${f}:${i}`, [token])
    at.set(token, `cityslot:${f}:${i}`)
  }
  return { ...s, resources: { ...s.resources, contents, at } }
}

/**
 * Give several resources at once. `give` empties the slots first, so calling it twice keeps only
 * the second lot — anything needing a mix has to place them in one pass.
 */
function giveMix(s: GameState, f: 'red' | 'yellow', want: Record<string, number>): GameState {
  const contents = new Map(s.resources.contents)
  const at = new Map(s.resources.at)
  for (let i = 0; i < 6; i++) {
    for (const t of contents.get(`cityslot:${f}:${i}`) ?? []) {
      const sup = `supply:${t.slice(0, t.indexOf('#'))}`
      contents.set(sup, [...(contents.get(sup) ?? []), t])
      at.set(t, sup)
    }
    contents.set(`cityslot:${f}:${i}`, [])
  }
  let slot = 0
  for (const [r, n] of Object.entries(want)) {
    for (let i = 0; i < n; i++) {
      const sup = `supply:${r}`
      const token = (contents.get(sup) ?? [])[0]
      if (token === undefined) break
      contents.set(sup, (contents.get(sup) ?? []).filter((t) => t !== token))
      contents.set(`cityslot:${f}:${slot}`, [token])
      at.set(token, `cityslot:${f}:${slot}`)
      slot++
    }
  }
  return { ...s, resources: { ...s.resources, contents, at } }
}

/** Move `n` of `from`'s pieces into red's trophies or captives. */
function take(
  s: GameState,
  pile: 'trophies' | 'captives',
  from: string,
  kind: string,
  n: number,
): GameState {
  const contents = new Map(s.figures.contents)
  const at = new Map(s.figures.at)
  const res = `reserve:${from}`
  const got = (contents.get(res) ?? []).filter((i) => i.startsWith(`${from}/${kind}/`)).slice(0, n)
  contents.set(res, (contents.get(res) ?? []).filter((i) => !got.includes(i)))
  const dest = pile === 'trophies' ? Location.trophies('red') : Location.captives('red')
  contents.set(dest, [...(contents.get(dest) ?? []), ...got])
  for (const g of got) at.set(g, dest)
  return { ...s, figures: { ...s.figures, contents, at } }
}

/** Put `n` of a colour's pieces into a system, straight from its reserve. */
function place(s: GameState, color: string, system: string, piece: string, n: number): GameState {
  const contents = new Map(s.figures.contents)
  const at = new Map(s.figures.at)
  const from = `reserve:${color}`
  const dest = Location.system(system as never)
  const moved = (contents.get(from) ?? [])
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  contents.set(from, (contents.get(from) ?? []).filter((id) => !moved.includes(id)))
  contents.set(dest, [...(contents.get(dest) ?? []), ...moved])
  for (const id of moved) at.set(id, dest)
  return { ...s, figures: { ...s.figures, contents, at } }
}

/** Clear a system so a test owns what stands there. */
function clear(s: GameState, system: string): GameState {
  const contents = new Map(s.figures.contents)
  const at = new Map(s.figures.at)
  const dest = Location.system(system as never)
  for (const id of contents.get(dest) ?? []) {
    const color = id.slice(0, id.indexOf('/'))
    contents.set(`reserve:${color}`, [...(contents.get(`reserve:${color}`) ?? []), id])
    at.set(id, `reserve:${color}`)
  }
  contents.set(dest, [])
  return { ...s, figures: { ...s.figures, contents, at } }
}

const offer = (s: GameState, which: string): Continue =>
  advance(s, { type: 'action/take', faction: 'red', action: which, then: STOP }, registry).continue

// ---------------------------------------------------------------------------

describe('the shared gate', () => {
  it('needs the card AND the ambition, and does not care who declared it', () => {
    const base = withLore(fresh(), 'red', 'lore23')
    expect(loreActive(base, 'red', 'lore23')).toBe(false) // held, undeclared
    expect(loreActive(declared(base, 'Warlord'), 'red', 'lore23')).toBe(true)
    expect(loreActive(declared(fresh(), 'Warlord'), 'red', 'lore23')).toBe(false) // declared, not held
  })

  it('gates on the card\'s own ambition, not any ambition', () => {
    const s = declared(withLore(fresh(), 'red', 'lore23'), 'Tycoon')
    expect(loreActive(s, 'red', 'lore23')).toBe(false)
  })
})

describe('Warlord\'s Cruelty (lore23) — tax a city you already taxed', () => {
  function taxable(s: GameState): string[] {
    const c = advance(s, { type: 'action/take', faction: 'red', action: 'Tax', then: STOP }, registry)
    return labels(c.continue).filter((l) => l.startsWith('Tax '))
  }
  /** Red's first city, already taxed this turn. */
  function spent(s: GameState): GameState {
    for (const sys of s.board.systems) {
      const city = contentsOf(s.figures, Location.system(sys)).find((f) => f.startsWith('red/City/'))
      if (city !== undefined) return { ...s, taxedThisTurn: [city] }
    }
    throw new Error('red has no city')
  }

  it('a spent city is off the menu without the card', () => {
    const before = taxable(fresh()).length
    expect(taxable(spent(fresh())).length).toBe(before - 1)
  })

  it('and back on it with Warlord declared', () => {
    const s = declared(withLore(spent(fresh()), 'red', 'lore23'), 'Warlord')
    expect(taxable(s).length).toBe(taxable(fresh()).length)
  })

  it('but not while Warlord is undeclared', () => {
    const s = withLore(spent(fresh()), 'red', 'lore23')
    expect(taxable(s).length).toBe(taxable(fresh()).length - 1)
  })
})

describe('the Keeper\'s pair — what a raider may take', () => {
  /** red raids yellow with 4 keys; yellow holds `held` and has secured `cards`. */
  function raid(opts: { yellowLore?: string[]; yellowHas?: string; redHas?: string; cards?: string[] }) {
    let s = fresh()
    if (opts.yellowHas !== undefined) s = give(s, 'yellow', opts.yellowHas, 2)
    if (opts.redHas !== undefined) s = give(s, 'red', opts.redHas, 1)
    if (opts.cards !== undefined) {
      const cc = s.courtCards
      const contents = new Map(cc.contents)
      const at = new Map(cc.at)
      for (const [k, v] of contents) contents.set(k, v.filter((id) => !opts.cards!.includes(id)))
      contents.set('court:secured:yellow', opts.cards)
      for (const id of opts.cards) at.set(id, 'court:secured:yellow')
      s = { ...s, courtCards: { ...cc, contents, at } }
    }
    if (opts.yellowLore !== undefined) {
      s = withLore(s, 'yellow', ...opts.yellowLore)
      s = declared(s, 'Keeper')
    }
    return advance(
      s,
      {
        type: 'battle/finish',
        ctx: {
          faction: 'red', system: '2-Arrow', enemy: 'yellow',
          self: 0, intercepted: 0, ships: 0, buildings: 0, keys: 4, razed: false,
          then: STOP,
        },
      },
      registry,
    ).continue
  }
  const takes = (c: Continue, kind: string): number =>
    c.kind === 'ask' ? c.actions.filter((a) => a.type === 'battle/raid-take' && a['kind'] === kind).length : 0

  it('Trust: a raider cannot take a resource type it already holds', () => {
    const open = raid({ yellowHas: 'Fuel', redHas: 'Relic' })
    const shut = raid({ yellowHas: 'Fuel', redHas: 'Fuel', yellowLore: ['lore21'] })
    expect(takes(open, 'resource')).toBeGreaterThan(0)
    expect(takes(shut, 'resource')).toBe(0)
  })

  it('Trust: leaves types the raider does not hold alone', () => {
    const c = raid({ yellowHas: 'Fuel', redHas: 'Relic', yellowLore: ['lore21'] })
    expect(takes(c, 'resource')).toBeGreaterThan(0)
  })

  it('Trust: does nothing while Keeper is undeclared', () => {
    let s = give(give(fresh(), 'yellow', 'Fuel', 2), 'red', 'Fuel', 1)
    s = withLore(s, 'yellow', 'lore21') // held, NOT declared
    const c = advance(s, {
      type: 'battle/finish',
      ctx: { faction: 'red', system: '2-Arrow', enemy: 'yellow', self: 0, intercepted: 0,
             ships: 0, buildings: 0, keys: 4, razed: false, then: STOP },
    }, registry).continue
    expect(takes(c, 'resource')).toBeGreaterThan(0)
  })

  it('Solidarity: a Guild card is safe while its owner holds that suit', () => {
    // Sworn Guardians (bc22) is Relic-suited; holding a Relic protects it.
    const open = raid({ cards: ['bc23'], yellowHas: 'Fuel' })
    const shut = raid({ cards: ['bc23'], yellowHas: 'Relic', yellowLore: ['lore22'] })
    expect(takes(open, 'card')).toBeGreaterThan(0)
    expect(takes(shut, 'card')).toBe(0)
  })

  it('Solidarity: a card whose suit you do not hold is still takeable', () => {
    const c = raid({ cards: ['bc23'], yellowHas: 'Fuel', yellowLore: ['lore22'] })
    expect(takes(c, 'card')).toBeGreaterThan(0)
  })
})

describe('the spoils pair — spend what you have taken', () => {
  it('Warlord\'s Terror trades a trophy for an Influence, returning it to its owner', () => {
    const base = take(withLore(fresh(), 'red', 'lore24'), 'trophies', 'yellow', 'Ship', 1)
    expect(labels(prelude(base)).some((l) => /Terror/.test(l))).toBe(false)

    const live = declared(base, 'Warlord')
    const offer = ask(prelude(live)).actions.find((a) => a.type === 'turn/prelude-spoils')!
    const after = advance(live, offer, registry)
    expect(contentsOf(after.state.figures, Location.trophies('red'))).toHaveLength(0)
    /*
     * Back to *yellow's* reserve, not red's. Counted rather than tested for presence: yellow's
     * reserve is full of ships anyway, so "yellow has a ship" is true whatever happens and a
     * mutation sending the piece to red's reserve slipped straight through it.
     */
    const ships = (g: GameState, f: string): number =>
      contentsOf(g.figures, Location.reserve(f as never)).filter((i) => i.startsWith('yellow/Ship/')).length
    expect(ships(after.state, 'yellow')).toBe(ships(live, 'yellow') + 1)
    expect(ships(after.state, 'red')).toBe(0)
    expect(ask(after.continue).prompt).toContain('Influence')
  })

  it('Tyrant\'s Ego does the same with a captive, for a Secure', () => {
    // Secure is filtered out when nothing is securable, so red needs a majority somewhere first.
    const agents = (s: GameState): GameState => {
      const contents = new Map(s.figures.contents)
      const at = new Map(s.figures.at)
      const mine = (contents.get('reserve:red') ?? []).filter((i) => i.startsWith('red/Agent/')).slice(0, 2)
      contents.set('reserve:red', (contents.get('reserve:red') ?? []).filter((i) => !mine.includes(i)))
      contents.set(Location.court(1), [...(contents.get(Location.court(1)) ?? []), ...mine])
      for (const a of mine) at.set(a, Location.court(1))
      return { ...s, figures: { ...s.figures, contents, at } }
    }
    const base = agents(take(withLore(fresh(), 'red', 'lore25'), 'captives', 'blue', 'Agent', 1))
    expect(labels(prelude(base)).some((l) => /Ego/.test(l))).toBe(false) // Tyrant undeclared

    const live = declared(base, 'Tyrant')
    const offer = ask(prelude(live)).actions.find((a) => a.type === 'turn/prelude-spoils')
    expect(offer).toBeDefined()
    expect(String(offer!['act'])).toBe('Secure')
  })

  it('neither is offered with an empty pile', () => {
    const s = declared(withLore(fresh(), 'red', 'lore24'), 'Warlord')
    expect(labels(prelude(s)).some((l) => /Terror/.test(l))).toBe(false)
  })
})

describe('Tycoon\'s Charm (lore28) — trade Material and Fuel', () => {
  it('trades one for one, and only with Tycoon declared', () => {
    const base = give(withLore(fresh(), 'red', 'lore28'), 'red', 'Material', 2)
    expect(labels(prelude(base)).some((l) => /Charm/.test(l))).toBe(false)

    const live = declared(base, 'Tycoon')
    const offer = ask(prelude(live)).actions.find(
      (a) => a.type === 'turn/prelude-charm' && a['gain'] === 'Relic',
    )!
    const after = advance(live, offer, registry).state
    const slots = slotsOf(after, 'red')
    expect(countResource(after.resources, slots, 'Material')).toBe(1)
    expect(countResource(after.resources, slots, 'Relic')).toBe(1)
  })

  it('offers nothing to trade when you hold no Material or Fuel', () => {
    const s = declared(give(withLore(fresh(), 'red', 'lore28'), 'red', 'Relic', 2), 'Tycoon')
    expect(labels(prelude(s)).some((l) => /Charm — trade/.test(l))).toBe(false)
  })
})

describe('the outrage-clearing half — five cards, one channel', () => {
  const cases: [string, string, string][] = [
    ['lore19', 'Psionic', "Empath's Vision"],
    ['lore21', 'Relic', "Keeper's Trust"],
    ['lore23', 'Weapon', "Warlord's Cruelty"],
    ['lore25', 'Weapon', "Tyrant's Ego"],
    ['lore28', 'Material', "Tycoon's Charm"],
  ]

  for (const [id, resource, name] of cases) {
    it(`${name} clears ${resource} outrage, discarding itself`, () => {
      const s: GameState = {
        ...withLore(fresh(), 'red', id),
        outraged: { red: [resource] as never },
      }
      const offer = ask(prelude(s)).actions.find((a) => a.type === 'turn/prelude-lore')
      expect(offer).toBeDefined()
      const after = advance(s, offer!, registry).state
      expect(isOutraged(after, 'red', resource as never)).toBe(false)
      expect(after.lores['red'] ?? []).not.toContain(id)
    })
  }

  it('is NOT gated on the ambition — the card prints only "Prelude" there', () => {
    const s: GameState = { ...withLore(fresh(), 'red', 'lore23'), outraged: { red: ['Weapon'] as never } }
    expect(loreActive(s, 'red', 'lore23')).toBe(false) // Warlord undeclared
    expect(labels(prelude(s)).some((l) => /Cruelty/.test(l))).toBe(true)
  })

  it('is not offered when there is no outrage to clear', () => {
    expect(labels(prelude(withLore(fresh(), 'red', 'lore23'))).some((l) => /Cruelty/.test(l))).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe("Tycoon's Ambition (lore27)", () => {
  /*
   * "Prelude: While Tycoon is declared, before taking any other actions, you may discard all of
   * your Material and Fuel to declare exactly 1 undeclared ambition. Do not place the zero
   * marker."
   */
  const setup = (): GameState =>
    give(declared(withLore(fresh(), 'red', 'lore27'), 'Tycoon'), 'red', 'Material', 2)

  it('offers one option per undeclared ambition, and none for Tycoon itself', () => {
    const s = setup()
    const offered = labels(prelude(s)).filter((l) => l.startsWith("Tycoon's Ambition"))
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.some((l) => l.endsWith('Tycoon'))).toBe(false)
    for (const a of s.ambitions) {
      if (s.declared.some((d) => d.ambition === a)) continue
      expect(offered.some((l) => l.endsWith(a))).toBe(true)
    }
  })

  it('is not offered without Tycoon declared, nor without the card', () => {
    const noAmbition = give(withLore(fresh(), 'red', 'lore27'), 'red', 'Material', 2)
    expect(labels(prelude(noAmbition)).some((l) => l.startsWith("Tycoon's"))).toBe(false)
    const noCard = give(declared(fresh(), 'Tycoon'), 'red', 'Material', 2)
    expect(labels(prelude(noCard)).some((l) => l.startsWith("Tycoon's"))).toBe(false)
  })

  it('IS offered holding neither Material nor Fuel — the FAQ allows a zero-cost use (docs/21 A4)', () => {
    /*
     * Inverted: this test used to pin a `fuelish > 0` gate, but the official FAQ is explicit —
     * "You can use its ability even if you have zero Material and Fuel." Discarding all of
     * nothing is a legal cost, and the free declaration is the whole prize.
     */
    const empty = give(declared(withLore(fresh(), 'red', 'lore27'), 'Tycoon'), 'red', 'Relic', 2)
    const act = ask(prelude(empty)).actions.find((a) =>
      String(a['label']).startsWith("Tycoon's Ambition"),
    )
    expect(act).toBeDefined()
    const after = advance(empty, act!, registry).state
    expect(after.declared.length).toBeGreaterThan(1)
    // The Relics are untouched — only Material and Fuel are named by the cost.
    expect(countResource(after.resources, slotsOf(after, 'red'), 'Relic')).toBe(2)
  })

  it('discards ALL Material and Fuel, not just one, and declares the ambition', () => {
    const mixed = giveMix(declared(withLore(fresh(), 'red', 'lore27'), 'Tycoon'), 'red', {
      Material: 2,
      Fuel: 1,
    })
    const held = (g: GameState, r: string): number =>
      countResource(g.resources, slotsOf(g, 'red'), r as never)
    expect(held(mixed, 'Material')).toBe(2)
    expect(held(mixed, 'Fuel')).toBe(1)

    const act = ask(prelude(mixed)).actions.find((a) =>
      String(a['label']).startsWith("Tycoon's Ambition"),
    )!
    const after = advance(mixed, act, registry).state
    expect(held(after, 'Material')).toBe(0)
    expect(held(after, 'Fuel')).toBe(0)
    expect(after.declared.map((d) => d.ambition)).toContain(act['ambition'])
  })

  it('does NOT zero the played card — that is the whole point of the card', () => {
    // Needs a real lead to be worth anything: `zeroed` on an absent lead would pass vacuously.
    const led: GameState = {
      ...setup(),
      lead: {
        faction: 'red',
        cardId: '5-Construction',
        suit: 'Construction',
        strength: 5,
        pips: 1,
        zeroed: false,
      },
    }
    const act = ask(prelude(led)).actions.find((a) => a.type === 'turn/prelude-tycoon')!
    const after = advance(led, act, registry).state
    expect(after.lead).toBeDefined()
    expect(after.lead?.zeroed).toBe(false)
    // The marker was still taken — this is a real declaration, just an unzeroed one.
    expect(after.declared.map((d) => d.ambition)).toContain(act['ambition'])
  })

  it('declares once — the ambition it took is gone from the menu on return', () => {
    // A Relic is held back so the Prelude still has something to show; discarding all Material
    // and Fuel otherwise empties the menu and the Prelude hands straight on to the pips.
    const s = giveMix(declared(withLore(fresh(), 'red', 'lore27'), 'Tycoon'), 'red', {
      Material: 1,
      Relic: 1,
    })
    const first = ask(prelude(s)).actions.find((a) => a.type === 'turn/prelude-tycoon')!
    const back = advance(s, first, registry)
    // Still in the Prelude — the Relic survived the discard, so the menu has not emptied.
    expect(ask(back.continue).actions.some((a) => a.type === 'turn/prelude-done')).toBe(true)
    const still = labels(back.continue)
    expect(still).not.toContain(String(first['label']))
    /*
     * Other undeclared ambitions are STILL offered, even with the Material gone — the FAQ's
     * zero-cost ruling (docs/21 A4). Only the one just declared has left the menu.
     */
    expect(still.some((l) => l.startsWith("Tycoon's Ambition"))).toBe(true)
  })
})

describe("Tyrant's Authority (lore26)", () => {
  /*
   * "Annex (Build): While Tyrant is declared, replace any city or starport you control with a
   * Loyal city or starport, respectively. (Cities return to player boards.)"
   */
  /** A system red rules outright, holding one of yellow's buildings. */
  const annexable = (
    kind: 'City' | 'Starport',
    lore = 'lore26',
    ambition: Ambition = 'Tyrant',
  ): { s: GameState; system: string } => {
    const base = fresh()
    const system = base.board.systems[0]!
    const staged = place(place(clear(base, system), 'yellow', system, kind, 1), 'red', system, 'Ship', 3)
    return { s: declared(withLore(staged, 'red', lore), ambition), system }
  }

  it("annexes a rival's city, and offers nothing for your own pieces", () => {
    const { s, system } = annexable('City')
    const offered = labels(offer(s, 'Build')).filter((l) => l.startsWith('Annex'))
    expect(offered).toEqual([`Annex yellow's City in ${system} (Tyrant's Authority)`])
  })

  it('replaces the piece: theirs goes home, yours takes its place', () => {
    const { s, system } = annexable('City')
    const act = ask(offer(s, 'Build')).actions.find((a) => a['annex'] !== undefined)!
    const after = advance(s, act, registry).state
    const here = contentsOf(after.figures, Location.system(system as never))
    expect(here.some((f) => f.startsWith('yellow/City/'))).toBe(false)
    expect(here.filter((f) => f.startsWith('red/City/')).length).toBe(1)
    // "Cities return to player boards" — back in yellow's reserve, not destroyed.
    expect(contentsOf(after.figures, `reserve:yellow`).some((f) => f.startsWith('yellow/City/'))).toBe(
      true,
    )
  })

  it('replaces like for like — a Starport becomes a Starport', () => {
    const { s, system } = annexable('Starport')
    const act = ask(offer(s, 'Build')).actions.find((a) => a['annex'] !== undefined)!
    expect(act['piece']).toBe('Starport')
    const after = advance(s, act, registry).state
    const here = contentsOf(after.figures, Location.system(system as never))
    expect(here.filter((f) => f.startsWith('red/Starport/')).length).toBe(1)
    expect(here.some((f) => f.startsWith('yellow/Starport/'))).toBe(false)
  })

  it('is not offered without Tyrant declared, nor without the card', () => {
    const noAmbition = annexable('City', 'lore26', 'Empath')
    expect(labels(offer(noAmbition.s, 'Build')).some((l) => l.startsWith('Annex'))).toBe(false)
    const noCard = annexable('City', 'lore01')
    expect(labels(offer(noCard.s, 'Build')).some((l) => l.startsWith('Annex'))).toBe(false)
  })

  it('is not offered in a system you do not rule', () => {
    const base = fresh()
    const system = base.board.systems[0]!
    // Yellow's city plus enough yellow ships that red is present but does not rule.
    const staged = place(
      place(place(clear(base, system), 'yellow', system, 'City', 1), 'yellow', system, 'Ship', 4),
      'red',
      system,
      'Ship',
      1,
    )
    const s = declared(withLore(staged, 'red', 'lore26'), 'Tyrant')
    expect(labels(offer(s, 'Build')).some((l) => l.startsWith('Annex'))).toBe(false)
  })
})

describe("Empath's Bond (lore20)", () => {
  /*
   * "While Empath is declared, you may tax any cities, and build ships and Catapult move with any
   * starports, like they are Loyal. (Don't take Captives. Build ships damaged in Rival-controlled
   * systems.)"
   */
  /** Yellow's building in a system red is merely present in — not ruling. */
  const rivalHeld = (
    kind: 'City' | 'Starport',
    lore = 'lore20',
    ambition: Ambition = 'Empath',
  ): { s: GameState; system: string } => {
    const base = fresh()
    const system = base.board.systems[0]!
    const staged = place(
      place(place(clear(base, system), 'yellow', system, kind, 1), 'yellow', system, 'Ship', 4),
      'red',
      system,
      'Ship',
      1,
    )
    return { s: declared(withLore(staged, 'red', lore), ambition), system }
  }

  it("taxes a rival's city in a system you do not rule", () => {
    const { s, system } = rivalHeld('City')
    expect(labels(offer(s, 'Tax')).some((l) => l.includes(system))).toBe(true)
    const off = rivalHeld('City', 'lore20', 'Tyrant')
    expect(labels(offer(off.s, 'Tax')).some((l) => l.includes(system))).toBe(false)
  })

  it('takes no Captive when it does — the card says so out loud', () => {
    const { s } = rivalHeld('City')
    const act = ask(offer(s, 'Tax')).actions.find((a) => a.type === 'action/tax-city')!
    const after = advance(s, act, registry).state
    expect(contentsOf(after.figures, Location.captives('red')).length).toBe(
      contentsOf(s.figures, Location.captives('red')).length,
    )
  })

  it("builds a ship at a rival's starport", () => {
    const { s, system } = rivalHeld('Starport')
    expect(labels(offer(s, 'Build'))).toContain(`Build Ship in ${system}`)
    const off = rivalHeld('Starport', 'lore20', 'Tyrant')
    expect(labels(offer(off.s, 'Build'))).not.toContain(`Build Ship in ${system}`)
  })

  it('and that ship arrives damaged, because a Rival controls the system', () => {
    const { s, system } = rivalHeld('Starport')
    const act = ask(offer(s, 'Build')).actions.find(
      (a) => a.type === 'action/build' && a['piece'] === 'Ship',
    )!
    const after = advance(s, act, registry).state
    const fresh_ = contentsOf(after.figures, Location.system(system as never)).filter((f) =>
      f.startsWith('red/Ship/'),
    )
    expect(fresh_.some((f) => after.damaged.includes(f))).toBe(true)
  })

  it("Catapult moves out of a rival's starport", () => {
    const base = fresh()
    // A non-gate system next to a gate, cleared so only what this test places stands there.
    const from = base.board.systems.find(
      (id) =>
        !systemInfo(id).isGate &&
        connectedSystems(base.board, id).some((n) => systemInfo(n).isGate),
    )!
    const to = connectedSystems(base.board, from).find((id) => systemInfo(id).isGate)!
    const staged = place(
      place(clear(clear(base, from), to), 'yellow', from, 'Starport', 1),
      'red',
      from,
      'Ship',
      2,
    )
    // No red starport here — the catapult can only be the Bond's doing.
    expect(
      contentsOf(staged.figures, Location.system(from)).some((f) => f.startsWith('red/Starport/')),
    ).toBe(false)

    const catapults = (g: GameState): boolean =>
      labels(offer(g, 'Move')).includes(`Move ${from} → ${to} (2 ships) — and further`)

    expect(catapults(declared(withLore(staged, 'red', 'lore20'), 'Empath'))).toBe(true)
    // Without the ambition it is an ordinary move, no catapult.
    expect(catapults(declared(withLore(staged, 'red', 'lore20'), 'Tyrant'))).toBe(false)
  })

  it('builds undamaged where no Rival controls the system', () => {
    const base = fresh()
    const system = base.board.systems[0]!
    // Red rules it, and the starport it builds from is yellow's.
    const staged = place(
      place(place(clear(base, system), 'yellow', system, 'Starport', 1), 'red', system, 'Ship', 4),
      'red',
      system,
      'City',
      1,
    )
    const s = declared(withLore(staged, 'red', 'lore20'), 'Empath')
    const act = ask(offer(s, 'Build')).actions.find(
      (a) => a.type === 'action/build' && a['piece'] === 'Ship' && a['starport'] !== undefined,
    )!
    const after = advance(s, act, registry).state
    const ships = contentsOf(after.figures, Location.system(system as never)).filter((f) =>
      f.startsWith('red/Ship/'),
    )
    expect(ships.every((f) => !after.damaged.includes(f))).toBe(true)
  })
})
