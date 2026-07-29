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
  contentsOf,
  countResource,
  defaultRegistry,
  isOutraged,
  loreActive,
  slotsOf,
  startGame,
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
