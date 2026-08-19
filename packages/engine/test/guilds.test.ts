import { describe, expect, it } from 'vitest'

import {
  slotsOf,
  BASE_COURT,
  CourtPile,
  advance,
  citiesInReserve,
  Location,
  contentsOf,
  countResource,
  courtCard,
  defaultRegistry,
  metric,
  move,
  Continue as C,
  gain,
  unhandled,
  hasGuild,
  loyalSuits,
  preludeOffers,
  provokeOutrage,
  CardLocation,
  abductableSlots,
  UNION_SUITS,
  guildPreludes,
  parseCardId,
  rivalAgentsOn,
  securedCards,
  slotCapacity,
  tradeGiveOptions,
  tradeTargets,
  weaponReach,
  startGame,
  supplyOf,
} from '../src/index.js'
import { system as systemInfo } from '../src/index.js'
import type { Continue, GameState, Resource } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

/** Put a court card into any faction's secured pile. */
function withCard2(
  state: GameState,
  faction: 'red' | 'yellow' | 'blue',
  cardId: string,
): GameState {
  const contents = new Map(state.courtCards.contents)
  const at = new Map(state.courtCards.at)
  const pile = CourtPile.secured(faction)
  const from = at.get(cardId)
  if (from !== undefined) {
    contents.set(from, (contents.get(from) ?? []).filter((c) => c !== cardId))
  }
  contents.set(pile, [...(contents.get(pile) ?? []), cardId])
  at.set(cardId, pile)
  return { ...state, courtCards: { ...state.courtCards, contents, at } }
}

/** Put a guild card straight into a faction's secured pile. */
function withCard(state: GameState, faction: 'red', cardId: string): GameState {
  const contents = new Map(state.courtCards.contents)
  const at = new Map(state.courtCards.at)
  const pile = CourtPile.secured(faction)
  const from = at.get(cardId)
  if (from !== undefined) {
    contents.set(from, (contents.get(from) ?? []).filter((c) => c !== cardId))
  }
  contents.set(pile, [...(contents.get(pile) ?? []), cardId])
  at.set(cardId, pile)
  return { ...state, courtCards: { ...state.courtCards, contents, at } }
}

function give(state: GameState, faction: 'red', r: Resource, n = 1): GameState {
  const capacity = slotsOf(state, faction)
  let resources = state.resources
  for (let i = 0; i < n; i++) {
    const got = gain(resources, capacity, r)
    if (!got.gained) break
    resources = got.tracker
  }
  return { ...state, resources }
}

/** Return every token a faction holds to the supply. */
function stripSlots(state: GameState, faction: 'red' | 'yellow' | 'blue'): GameState {
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

/** Strip a faction's slots so a test controls exactly what is held. */
function onlyHolding(state: GameState, faction: 'red', r: Resource, n = 1): GameState {
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
  return give({ ...state, resources: { ...state.resources, contents, at } }, faction, r, n)
}

const actionsFor = (offers: ReturnType<typeof preludeOffers>) =>
  offers.filter((o) => o.kind === 'action').map((o) => (o as { action: string }).action)

describe('guild card data', () => {
  it('gives every guild card a suit and a raid-key cost, and no vox card either', () => {
    for (const c of BASE_COURT) {
      if (c.kind === 'guild') {
        expect(c.suit).toBeDefined()
        expect(c.keys).toBeGreaterThan(0)
      } else {
        expect(c.suit).toBeUndefined()
        expect(c.keys).toBeUndefined()
      }
    }
  })

  it('has exactly the five Loyal guilds, one per resource, each worth 3 keys', () => {
    const loyal = BASE_COURT.filter((c) => c.loyal === true)
    expect(loyal.map((c) => c.name)).toEqual([
      'Loyal Engineers',
      'Loyal Pilots',
      'Loyal Marines',
      'Loyal Empaths',
      'Loyal Keepers',
    ])
    expect(new Set(loyal.map((c) => c.suit)).size).toBe(5)
    for (const c of loyal) expect(c.keys).toBe(3)
  })
})

describe('holder queries', () => {
  it('reports nothing secured at the start', () => {
    const state = fresh()
    expect(securedCards(state, 'red')).toEqual([])
    expect(loyalSuits(state, 'red')).toEqual([])
    expect(hasGuild(state, 'red', 'bc01')).toBe(false)
  })

  it('reports a secured card and its loyal suit', () => {
    const state = withCard(fresh(), 'red', 'bc01') // Loyal Engineers, Material
    expect(hasGuild(state, 'red', 'bc01')).toBe(true)
    expect(loyalSuits(state, 'red')).toEqual(['Material'])
    // A non-loyal guild confers no suit.
    expect(loyalSuits(withCard(fresh(), 'red', 'bc02'), 'red')).toEqual([])
  })
})

/**
 * HRF writes every Prelude condition as `(r.is(X) && !outraged(X)) || f.hasGuild(LoyalX)`,
 * so a Loyal guild does two things at once: any resource buys that suit's action, and
 * outrage on that suit stops nothing.
 */
describe('Loyal guilds in the Prelude', () => {
  it('normally, a Fuel token buys only Move', () => {
    const state = onlyHolding(fresh(), 'red', 'Fuel')
    expect(actionsFor(preludeOffers(state, 'red', 'Mobilization', 'Mobilization'))).toEqual(['Move'])
  })

  it('Loyal Engineers lets a Fuel token buy Build and Repair too', () => {
    const state = withCard(onlyHolding(fresh(), 'red', 'Fuel'), 'red', 'bc01')
    const got = actionsFor(preludeOffers(state, 'red', 'Mobilization', 'Mobilization'))
    expect(got).toContain('Move') // its own grant survives
    expect(got).toContain('Build')
    expect(got).toContain('Repair')
  })

  it('and ignores outrage on its own suit', () => {
    let state = onlyHolding(fresh(), 'red', 'Material')
    state = provokeOutrage(state, 'red', 'Material')
    state = give(state, 'red', 'Material') // regain one after the discard
    // Outraged: Material buys nothing.
    expect(actionsFor(preludeOffers(state, 'red', 'Construction', 'Construction'))).toEqual([])
    // With Loyal Engineers it buys again.
    const loyal = withCard(state, 'red', 'bc01')
    expect(actionsFor(preludeOffers(loyal, 'red', 'Construction', 'Construction'))).toContain('Build')
  })

  it('confers only its own suit, not every suit', () => {
    const state = withCard(onlyHolding(fresh(), 'red', 'Fuel'), 'red', 'bc01')
    // Loyal Engineers is Material: Build/Repair. It must not hand out Secure (Relic's).
    expect(actionsFor(preludeOffers(state, 'red', 'Mobilization', 'Mobilization'))).not.toContain(
      'Secure',
    )
  })

  it('Loyal Marines lets a non-Weapon token buy the Battle option', () => {
    const plain = onlyHolding(fresh(), 'red', 'Fuel')
    expect(preludeOffers(plain, 'red', 'Mobilization', 'Mobilization').some((o) => o.kind === 'battle-option')).toBe(
      false,
    )

    const marines = withCard(plain, 'red', 'bc15')
    const offer = preludeOffers(marines, 'red', 'Mobilization', 'Mobilization').find(
      (o) => o.kind === 'battle-option',
    )
    expect(offer).toBeDefined()
    // The offer must name the token actually spent — a Weapon is not held, and paying for
    // one that is not there throws.
    expect((offer as { resource: Resource }).resource).toBe('Fuel')
  })

  it('the Battle option a Loyal Marines player buys is actually payable', () => {
    let state = withCard(onlyHolding(fresh(), 'red', 'Fuel'), 'red', 'bc15')
    const offers = preludeOffers(state, 'red', 'Mobilization', 'Mobilization')
    const battle = offers.find((o) => o.kind === 'battle-option')!
    // Drive it through the real action, which is where a hardcoded Weapon would throw.
    const step = advance(
      state,
      {
        type: 'turn/prelude-battle',
        faction: 'red',
        resource: (battle as { resource: Resource }).resource,
        suit: 'Mobilization',
        pips: 1,
      },
      registry,
    )
    expect(step.state.anyBattle).toBe(true)
    expect(step.state.log.at(-1)).toMatch(/spent Fuel in Prelude/)
  })

  it('an Aggression card gains no Battle option — it already has one', () => {
    const state = withCard(onlyHolding(fresh(), 'red', 'Weapon'), 'red', 'bc15')
    expect(
      preludeOffers(state, 'red', 'Aggression', 'Aggression').some((o) => o.kind === 'battle-option'),
    ).toBe(false)
  })
})

describe('guild names match the art ids', () => {
  it('every id resolves to the card the deck lists', () => {
    for (const c of BASE_COURT) expect(courtCard(c.id).name).toBe(c.name)
  })
})

// --- the alt-action hook ---------------------------------------------------

/** Give a faction `n` captives taken from `from`. */
function withCaptives(state: GameState, faction: 'red', from: 'yellow', n: number): GameState {
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

/**
 * Alt flows loop back to `then` when they run out (Press Gang stops when the captives do), so
 * `then` has to be an action the registry actually handles and that halts. This module parks
 * on an ask, which `advance` stops at.
 */
const STOP = { type: 'test/stop' } as const
const terminal = defaultRegistry().register({
  id: 'test-terminal',
  perform: (state: GameState, action: { type: string }) =>
    action.type === 'test/stop'
      ? { state, continue: C.ask('red', [{ type: 'test/stop', faction: 'red', label: 'stop' }], 'stop') }
      : unhandled(state),
})

/** `perform` only consults modules named in `state.ruleChain`, so the stop module joins it. */
const stoppable = (state: GameState): GameState => ({
  ...state,
  ruleChain: [...state.ruleChain, 'test-terminal'],
})

const take = (state: GameState, faction: 'red', action: string) =>
  advance(stoppable(state), { type: 'action/take', faction, action, then: STOP }, terminal)

const labels = (c: Continue): string[] =>
  c.kind === 'ask' ? c.actions.map((a) => (a.label as string | undefined) ?? '') : []

describe('the alt-action hook', () => {
  it('adds nothing when the faction holds no guild card', () => {
    const c = take(fresh(), 'red', 'Build').continue
    expect(labels(c).some((l) => /Manufacture|Synthesize|Press Gang/.test(l))).toBe(false)
  })

  it('Mining Interest adds Manufacture to the Build menu, and only Build', () => {
    const state = withCard(fresh(), 'red', 'bc02')
    expect(labels(take(state, 'red', 'Build').continue)).toContain('Manufacture — gain 1 Material')
    expect(labels(take(state, 'red', 'Tax').continue).join()).not.toMatch(/Manufacture/)
  })

  it('Shipping Interest adds Synthesize', () => {
    const state = withCard(fresh(), 'red', 'bc09')
    expect(labels(take(state, 'red', 'Build').continue)).toContain('Synthesize — gain 1 Fuel')
  })

  it('Manufacture and Synthesize actually gain the resource', () => {
    for (const [card, alt, r] of [
      ['bc02', 'manufacture', 'Material'],
      ['bc09', 'synthesize', 'Fuel'],
    ] as const) {
      const state = onlyHolding(withCard(fresh(), 'red', card), 'red', 'Relic', 0)
      const capacity = slotsOf(state, 'red')
      const before = countResource(state.resources, capacity, r)
      const step = advance(
        stoppable(state),
        { type: 'action/guild-alt', faction: 'red', alt, then: STOP },
        terminal,
      )
      expect(countResource(step.state.resources, capacity, r)).toBe(before + 1)
    }
  })

  it('Prison Wardens offers Press Gang on Build and Execute on Influence — only with captives', () => {
    const noCaptives = withCard(fresh(), 'red', 'bc12')
    expect(labels(take(noCaptives, 'red', 'Build').continue).join()).not.toMatch(/Press Gang/)

    const armed = withCaptives(noCaptives, 'red', 'yellow', 2)
    expect(labels(take(armed, 'red', 'Build').continue)).toContain(
      'Press Gang — return captives for resources',
    )
    expect(labels(take(armed, 'red', 'Influence').continue)).toContain(
      'Execute — captives to trophies',
    )
  })

  it('Execute moves a captive to trophies — Tyrant points into Warlord points', () => {
    const state = withCaptives(withCard(fresh(), 'red', 'bc12'), 'red', 'yellow', 2)
    expect(metric(state, 'red', 'Tyrant')).toBe(2)
    expect(metric(state, 'red', 'Warlord')).toBe(0)

    const step = advance(
      stoppable(state),
      { type: 'action/execute', faction: 'red', then: STOP },
      terminal,
    )
    expect(metric(step.state, 'red', 'Tyrant')).toBe(1)
    expect(metric(step.state, 'red', 'Warlord')).toBe(1)
  })

  it('Press Gang returns the captive to its OWNER, and gains the chosen resource', () => {
    const state = withCaptives(withCard(fresh(), 'red', 'bc12'), 'red', 'yellow', 1)
    const capacity = slotsOf(state, 'red')
    const before = countResource(state.resources, capacity, 'Relic')
    const yellowReserve = contentsOf(state.figures, Location.reserve('yellow')).length

    const step = advance(
      stoppable(state),
      { type: 'action/pressgang', faction: 'red', resource: 'Relic', then: STOP },
      terminal,
    )

    expect(metric(step.state, 'red', 'Tyrant')).toBe(0)
    expect(countResource(step.state.resources, capacity, 'Relic')).toBe(before + 1)
    // Back to yellow, not into red's reserve — it was never red's piece.
    expect(contentsOf(step.state.figures, Location.reserve('yellow'))).toHaveLength(yellowReserve + 1)
    expect(contentsOf(step.state.figures, Location.reserve('red')).some((id) => id.startsWith('yellow/'))).toBe(
      false,
    )
  })

  it('losing the card removes the option', () => {
    const armed = withCaptives(withCard(fresh(), 'red', 'bc12'), 'red', 'yellow', 1)
    expect(labels(take(armed, 'red', 'Influence').continue).join()).toMatch(/Execute/)
    // Same state, card sitting in the court instead of red's pile.
    const without = withCaptives(fresh(), 'red', 'yellow', 1)
    expect(labels(take(without, 'red', 'Influence').continue).join()).not.toMatch(/Execute/)
  })
})

// --- Abduct (Court Enforcers) and Trade (Elder Broker) ----------------------

/** Stand `n` agents of `who` on court slot `slot`. */
function agentsOnSlot(state: GameState, who: 'yellow' | 'blue' | 'red', slot: number, n: number): GameState {
  const contents = new Map(state.figures.contents)
  const at = new Map(state.figures.at)
  const reserve = `reserve:${who}`
  const court = Location.court(slot)
  const agents = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`${who}/Agent/`)).slice(0, n)
  contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !agents.includes(id)))
  contents.set(court, [...(contents.get(court) ?? []), ...agents])
  for (const a of agents) at.set(a, court)
  return { ...state, figures: { ...state.figures, contents, at } }
}

describe('Abduct — Court Enforcers on Battle', () => {
  it('reach is Weapon tokens plus secured Weapon-suit cards', () => {
    const bare = onlyHolding(fresh(), 'red', 'Relic', 1)
    expect(weaponReach(bare, 'red')).toBe(0)
    // Court Enforcers is itself Weapon-suited, so holding it is worth 1 on its own.
    expect(weaponReach(withCard(bare, 'red', 'bc14'), 'red')).toBe(1)
    // A Weapon token adds to it.
    const armed = onlyHolding(withCard(fresh(), 'red', 'bc14'), 'red', 'Weapon', 1)
    expect(weaponReach(armed, 'red')).toBe(2)
  })

  it('reaches a card held by fewer rivals than that, and not one held by more', () => {
    let state = onlyHolding(withCard(fresh(), 'red', 'bc14'), 'red', 'Relic', 1) // reach 1
    state = agentsOnSlot(state, 'yellow', 1, 1) // 1 rival agent, not < 1
    expect(abductableSlots(state, 'red')).toEqual([])

    // reach 2 now clears a single defender
    const stronger = onlyHolding(state, 'red', 'Weapon', 1)
    expect(abductableSlots(stronger, 'red')).toContain(1)
  })

  it('ignores your own agents when measuring the defence', () => {
    let state = onlyHolding(withCard(fresh(), 'red', 'bc14'), 'red', 'Weapon', 1) // reach 2
    state = agentsOnSlot(state, 'red', 2, 3) // your own crowd does not block you
    state = agentsOnSlot(state, 'yellow', 2, 1)
    expect(abductableSlots(state, 'red')).toContain(2)
  })

  it('joins the Battle menu without displacing Battle itself', () => {
    // Battle already opens its own "which system" ask, so the test is what is *in* the menu.
    expect(labels(take(fresh(), 'red', 'Battle').continue).join()).not.toMatch(/Abduct/)

    let state = onlyHolding(withCard(fresh(), 'red', 'bc14'), 'red', 'Weapon', 1)
    state = agentsOnSlot(state, 'yellow', 1, 1)
    const c = take(state, 'red', 'Battle').continue
    expect(c.kind).toBe('ask')
    expect(labels(c)).toContain('Battle') // the plain action survives
    expect(labels(c).join()).toMatch(/Abduct/)
  })

  it('takes every rival agent on the card as captives, leaving yours alone', () => {
    let state = onlyHolding(withCard(fresh(), 'red', 'bc14'), 'red', 'Weapon', 2) // reach 3
    state = agentsOnSlot(state, 'yellow', 1, 2)
    state = agentsOnSlot(state, 'red', 1, 1)

    const step = advance(
      stoppable(state),
      { type: 'action/abduct', faction: 'red', slot: 1, then: STOP },
      terminal,
    )
    expect(metric(step.state, 'red', 'Tyrant')).toBe(2)
    expect(rivalAgentsOn(step.state, 'red', 1)).toHaveLength(0)
    // Red's own agent is still standing on the card.
    expect(contentsOf(step.state.figures, Location.court(1)).filter((id) => id.startsWith('red/'))).toHaveLength(1)
  })
})

describe('Trade — Elder Broker on Tax', () => {
  /**
   * Clear a resource-bearing system on this board, then put red ships (to rule it) and a
   * yellow city in it. The system is chosen from the board rather than hardcoded — the
   * 3-player layouts use a subset of clusters, so a fixed id may not exist.
   */
  function contested(state: GameState): { state: GameState; system: string; resource: Resource } {
    const system = state.board.systems.find(
      (s) => systemInfo(s).resource !== null && systemInfo(s).buildingSlots !== null,
    )!
    const resource = systemInfo(system).resource as Resource
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const key = `system:${system}`
    // Empty it first, so nobody else's setup ships contest the rule check.
    for (const id of contents.get(key) ?? []) {
      const owner = id.slice(0, id.indexOf('/'))
      const reserve = `reserve:${owner}`
      contents.set(reserve, [...(contents.get(reserve) ?? []), id])
      at.set(id, reserve)
    }
    contents.set(key, [])
    const place = (who: string, piece: string, n: number) => {
      const reserve = `reserve:${who}`
      const picks = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`${who}/${piece}/`)).slice(0, n)
      contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !picks.includes(id)))
      contents.set(key, [...(contents.get(key) ?? []), ...picks])
      for (const p of picks) at.set(p, key)
    }
    place('red', 'Ship', 4)
    place('yellow', 'City', 1)
    return { state: { ...state, figures: { ...state.figures, contents, at } }, system, resource }
  }

  /** A ruled system with a yellow city, yellow holding the planet resource, red holding one
   *  type yellow does not. */
  function ready() {
    const base = contested(withCard(fresh(), 'red', 'bc23'))
    const give: Resource = base.resource === 'Relic' ? 'Psionic' : 'Relic'
    const yCap = slotsOf(base.state, 'yellow')
    let state = stripSlots(base.state, 'yellow')
    state = { ...state, resources: gain(state.resources, yCap, base.resource).tracker }
    state = onlyHolding(state, 'red', give, 1)
    return { ...base, state, give, yCap, rCap: slotsOf(state, 'red') }
  }

  it('offers nothing without a rival city in a system you rule', () => {
    const state = withCard(fresh(), 'red', 'bc23')
    expect(tradeTargets(state, 'red')).toEqual([])
  })

  it('targets the planet resource the rival actually holds', () => {
    const base = contested(withCard(fresh(), 'red', 'bc23'))
    const stripped = stripSlots(base.state, 'yellow')
    // Yellow holds none of it yet, so there is nothing to take.
    expect(tradeTargets(stripped, 'red').some((t) => t.system === base.system)).toBe(false)

    const yCap = slotsOf(stripped, 'yellow')
    const withRes = {
      ...stripped,
      resources: gain(stripped.resources, yCap, base.resource).tracker,
    }
    const t = tradeTargets(withRes, 'red').find((x) => x.system === base.system)
    expect(t).toBeDefined()
    expect(t!.take).toBe(base.resource)
    expect(t!.rival).toBe('yellow')
  })

  it('you may only hand back a type the rival does not have', () => {
    const r = ready()
    // Red must actually hold the contested type, or the exclusion is never tested.
    const rCap = slotsOf(r.state, 'red')
    const both = { ...r.state, resources: gain(r.state.resources, rCap, r.resource).tracker }
    expect(countResource(both.resources, rCap, r.resource)).toBe(1)

    const give = tradeGiveOptions(both, 'red', 'yellow')
    expect(give).toContain(r.give)
    expect(give).not.toContain(r.resource) // yellow already has it, so it is no use to them
  })

  it('swaps both ways', () => {
    const r = ready()
    const step = advance(
      stoppable(r.state),
      {
        type: 'action/trade',
        faction: 'red',
        rival: 'yellow',
        take: r.resource,
        give: r.give,
        then: STOP,
      },
      terminal,
    )
    expect(countResource(step.state.resources, r.rCap, r.resource)).toBe(1)
    expect(countResource(step.state.resources, r.rCap, r.give)).toBe(0)
    expect(countResource(step.state.resources, r.yCap, r.give)).toBe(1)
  })
})

// --- the remaining seven ---------------------------------------------------

/** Seeks battles with the biggest raid pool, which is what actually steals resources. */
const raidPolicy = (c: Extract<Continue, { kind: 'ask' }>) => {
  const rolls = c.actions.filter((a) => a.type === 'battle/roll')
  if (rolls.length > 0) {
    const score = (x: (typeof rolls)[number]) => Number(x['raid'] ?? 0) * 100 + Number(x['skirmish'] ?? 0)
    return rolls.reduce((best, a) => (score(a) > score(best) ? a : best))
  }
  for (const t of ['battle/system', 'battle/target', 'battle/declare']) {
    const a = c.actions.find((x) => x.type === t)
    if (a) return a
  }
  return (
    c.actions.find((a) => a['label'] === 'Battle') ??
    c.actions.find((a) => a.type === 'action/move-ship') ??
    c.actions.find((a) => a['label'] === 'Move') ??
    c.actions.find((a) => a.type === 'turn/prelude-done') ??
    c.actions.find((a) => a.type === 'turn/lead') ??
    c.actions.find((a) => a.type === 'turn/surpass') ??
    c.actions.find((a) => a.type === 'turn/pivot') ??
    c.actions.find((a) => a.type === 'turn/copy') ??
    c.actions.find((a) => a.type === 'turn/end') ??
    c.actions.find((a) => a.type === 'turn/skip-seize') ??
    c.actions.find((a) => a.type === 'ambition/skip-declare') ??
    c.actions.find((a) => a.type === 'turn/pass') ??
    c.actions[0]!
  )
}

describe('Sworn Guardians (bc22) — nothing of yours is stealable', () => {
  /**
   * The raid is internal to `resolveBattle`, so this is an A/B over identical seeds. The
   * victim is **chosen from the control run** rather than assumed — fixing on one faction
   * made the test vacuous, because that faction happened never to be raided and the "never
   * raided" leg then passed with the guard deleted.
   */
  function raidVictims(protect?: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (let seed = 1; seed <= 25; seed++) {
      const opts = {
        board: 'Board4MixUp1',
        factions: ['red', 'yellow', 'blue', 'white'] as const,
        seed,
      }
      let step = startGame(opts, registry)
      if (protect !== undefined) {
        step = { ...step, state: withCard2(step.state as GameState, protect as 'red', 'bc22') }
      }
      for (let i = 0; i < 12000; i++) {
        const c = step.continue
        if (c.kind === 'gameOver') break
        if (c.kind !== 'ask') break
        step = advance(step.state, raidPolicy(c), registry)
      }
      const log = step.state.log
      for (let i = 1; i < log.length; i++) {
        // Raiding is now itemised — 'red raided Fuel from yellow' — rather than counted.
        if (!/ raided .+ from /.test(log[i]!)) continue
        const prior = log.slice(0, i).reverse().find((l) => / attacks /.test(l)) ?? ''
        const atk = / attacks (\w+) in/.exec(prior)
        if (atk) out[atk[1]!] = (out[atk[1]!] ?? 0) + 1
      }
    }
    return out
  }

  it('is never raided in a driven game, though it would be without the card', () => {
    const control = raidVictims()
    const entries = Object.entries(control).sort((a, b) => b[1] - a[1])
    expect(entries.length, 'the policy must raid somebody').toBeGreaterThan(0)

    const [victim, losses] = entries[0]!
    expect(losses).toBeGreaterThan(0)

    // Same seeds, same policy, with the card on the faction that was being raided.
    expect(raidVictims(victim)[victim] ?? 0).toBe(0)
  })

  it('shields the holder’s other guild cards from Guild Struggle, but not itself', () => {
    let state = withCard2(fresh(), 'yellow', 'bc22')
    state = withCard2(state, 'yellow', 'bc02')
    const c = advance(
      stoppable(state),
      { type: 'vox/trigger', faction: 'red', card: 'bc30', then: STOP },
      terminal,
    ).continue
    const ls = labels(c).join(' ')
    expect(ls).toMatch(/Sworn Guardians/) // it can be taken
    expect(ls).not.toMatch(/Mining Interest/) // the card it shields cannot
  })
})

describe('Secret Order (bc18) — Keeper and Empath do not zero your card', () => {
  const declaring = (state: GameState, ambition: string) =>
    advance(
      stoppable({
        ...state,
        ambitionable: [{ high: 5, low: 3 }],
        lead: {
          faction: 'red' as const,
          cardId: 'Aggression-4',
          suit: 'Aggression' as const,
          strength: 4,
          pips: 2,
          zeroed: false,
        },
      }),
      { type: 'ambition/declare', faction: 'red', ambition, suit: 'Aggression', pips: 2 },
      terminal,
    )

  it('normally zeroes the played card', () => {
    expect(declaring(fresh(), 'Keeper').state.lead?.zeroed).toBe(true)
  })

  it('does not, for Keeper or Empath, when held', () => {
    const held = withCard2(fresh(), 'red', 'bc18')
    expect(declaring(held, 'Keeper').state.lead?.zeroed).toBe(false)
    expect(declaring(held, 'Empath').state.lead?.zeroed).toBe(false)
  })

  it('still zeroes for the other three ambitions', () => {
    const held = withCard2(fresh(), 'red', 'bc18')
    for (const a of ['Tycoon', 'Tyrant', 'Warlord']) {
      expect(declaring(held, a).state.lead?.zeroed, a).toBe(true)
    }
  })
})

describe('Lattice Spies (bc16) — seize by burning the card', () => {
  it('adds the option and discards the card when taken', () => {
    const state = withCard2(fresh(), 'red', 'bc16')
    const c = advance(
      stoppable(state),
      { type: 'turn/check-seize', faction: 'red', pips: 2, suit: 'Aggression' },
      terminal,
    ).continue
    expect(labels(c)).toContain('Seize with Lattice Spies')

    const step = advance(
      stoppable(state),
      { type: 'turn/lattice-seize', faction: 'red', pips: 2, suit: 'Aggression' },
      terminal,
    )
    expect(step.state.seized).toBe('red')
    expect(contentsOf(step.state.courtCards, CourtPile.secured('red'))).not.toContain('bc16')
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc16')
  })
})

describe('Galactic Bards (bc25) — a free declaration before the seize', () => {
  const played = { faction: 'red' as const, cardId: 'Aggression-4', kind: 'lead' as const }

  it('offers only ambitions matching the played card’s strength', () => {
    const state = {
      ...withCard2(fresh(), 'red', 'bc25'),
      roundPlays: [played],
      ambitionable: [{ high: 5, low: 3 }],
      declared: [],
    }
    const c = advance(
      stoppable(state),
      { type: 'turn/check-seize', faction: 'red', pips: 2, suit: 'Aggression' },
      terminal,
    ).continue
    const offered = labels(c).filter((l) => l.includes('Galactic Bards') && l.startsWith('Declare'))
    expect(offered.length).toBeGreaterThan(0)
    // Strength 4 maps to Warlord in the standard mapping; never everything.
    expect(offered.length).toBeLessThan(5)
  })

  it('is once per turn', () => {
    const state = {
      ...withCard2(fresh(), 'red', 'bc25'),
      roundPlays: [played],
      ambitionable: [{ high: 5, low: 3 }],
      declared: [],
      usedThisTurn: ['bc25'],
    }
    const c = advance(
      stoppable(state),
      { type: 'turn/check-seize', faction: 'red', pips: 2, suit: 'Aggression' },
      terminal,
    ).continue
    expect(labels(c).join()).not.toMatch(/Galactic Bards/)
  })

  it('is off once anyone has declared', () => {
    const state = {
      ...withCard2(fresh(), 'red', 'bc25'),
      roundPlays: [played],
      ambitionable: [{ high: 5, low: 3 }],
      declared: [{ ambition: 'Tycoon' as const, marker: { high: 9, low: 4 } }],
    }
    const c = advance(
      stoppable(state),
      { type: 'turn/check-seize', faction: 'red', pips: 2, suit: 'Aggression' },
      terminal,
    ).continue
    expect(labels(c).join()).not.toMatch(/Galactic Bards/)
  })
})

describe('Guild Prelude abilities — the card is the cost', () => {
  it('Relic Fence trades a resource for a Relic and KEEPS itself', () => {
    // This test used to assert the card discarded itself — the docs/20 A4 defect, pinned as if
    // it were the rule. The card reads "Once per turn, you may discard 1 resource": the resource
    // is the whole cost.
    const state = onlyHolding(withCard2(fresh(), 'red', 'bc24'), 'red', 'Fuel', 1)
    const cap = slotsOf(state, 'red')
    const step = advance(
      stoppable(state),
      {
        type: 'turn/prelude-guild',
        faction: 'red',
        ability: 'relic-fence',
        card: 'bc24',
        spend: 'Fuel',
        suit: 'Aggression',
        pips: 1,
      },
      terminal,
    )
    expect(countResource(step.state.resources, cap, 'Relic')).toBe(1)
    expect(countResource(step.state.resources, cap, 'Fuel')).toBe(0)
    expect(securedCards(step.state, 'red')).toContain('bc24')
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).not.toContain('bc24')
  })

  it('Silver Tongues steals a resource, and Sworn Guardians blocks it', () => {
    let state = withCard2(fresh(), 'red', 'bc20')
    const offers = guildPreludes(state, 'red')
    expect(offers.some((o) => o.kind === 'silver-tongues-resource')).toBe(true)

    state = withCard2(state, 'yellow', 'bc22')
    const guarded = guildPreludes(state, 'red')
    expect(
      guarded.some((o) => o.kind === 'silver-tongues-resource' && o.rival === 'yellow'),
    ).toBe(false)
  })

  it('Farseers throws the hand back and draws as many again', () => {
    const state = withCard2(fresh(), 'red', 'bc17')
    const before = contentsOf(state.cards, CardLocation.hand('red'))
    expect(before.length).toBeGreaterThan(0)

    const step = advance(
      stoppable(state),
      {
        type: 'turn/prelude-guild',
        faction: 'red',
        ability: 'farseers',
        card: 'bc17',
        suit: 'Aggression',
        pips: 1,
      },
      terminal,
    )
    const after = contentsOf(step.state.cards, CardLocation.hand('red'))
    // Draws up to the hand size, but the deck is the limit — at three players setup deals
    // 18 of 20 cards, so a full redraw is simply not available and the log says so.
    const deckBefore = contentsOf(state.cards, CardLocation.deck()).length
    expect(after).toHaveLength(Math.min(before.length, deckBefore))
    expect(after).not.toEqual(before) // a genuinely different hand
    expect(contentsOf(step.state.cards, CardLocation.deck())).toHaveLength(0)
    expect(step.state.log.at(-1)).toMatch(/redrew \d+ of \d+ card/)
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc17')
  })
})

// --- Prelude "discard this to…" abilities -----------------------------------

const preludeGuild = (state: GameState, extra: Record<string, unknown>) =>
  advance(
    stoppable(state),
    { type: 'turn/prelude-guild', faction: 'red', suit: 'Aggression', pips: 1, ...extra },
    terminal,
  )

describe('Prelude discard abilities', () => {
  it('Mining Interest fills every open slot with Material', () => {
    const state = stripSlots(withCard2(fresh(), 'red', 'bc02'), 'red')
    const cap = slotsOf(state, 'red')
    expect(countResource(state.resources, cap, 'Material')).toBe(0)

    const step = preludeGuild(state, { ability: 'fill-slots', card: 'bc02', resource: 'Material' })
    expect(countResource(step.state.resources, cap, 'Material')).toBe(cap.length)
    expect(contentsOf(step.state.courtCards, CourtPile.discard())).toContain('bc02')
  })

  it('…and steals instead once the supply runs dry', () => {
    let state = stripSlots(withCard2(fresh(), 'red', 'bc02'), 'red')
    // Drain the Material supply into blue, leaving one there to be taken.
    const bCap = slotsOf(state, 'blue')
    state = stripSlots(state, 'blue')
    let resources = state.resources
    for (const t of [...contentsOf(resources, 'supply:Material')]) {
      resources = { ...resources, ...(() => {
        const contents = new Map(resources.contents)
        const at = new Map(resources.at)
        contents.set('supply:Material', (contents.get('supply:Material') ?? []).filter((x) => x !== t))
        contents.set('scrap', [...(contents.get('scrap') ?? []), t])
        at.set(t, 'scrap')
        return { contents, at }
      })() }
    }
    state = { ...state, resources }
    state = { ...state, resources: gain(state.resources, bCap, 'Material').tracker }
    // Put one Material back in blue's hands by moving it from scrap.
    const scrapped = contentsOf(state.resources, 'scrap')[0]!
    {
      const contents = new Map(state.resources.contents)
      const at = new Map(state.resources.at)
      contents.set('scrap', (contents.get('scrap') ?? []).filter((x) => x !== scrapped))
      contents.set('cityslot:blue:0', [...(contents.get('cityslot:blue:0') ?? []), scrapped])
      at.set(scrapped, 'cityslot:blue:0')
      state = { ...state, resources: { ...state.resources, contents, at } }
    }
    expect(contentsOf(state.resources, 'supply:Material')).toHaveLength(0)
    expect(countResource(state.resources, bCap, 'Material')).toBeGreaterThan(0)

    const step = preludeGuild(state, { ability: 'fill-slots', card: 'bc02', resource: 'Material' })
    const rCap = slotsOf(step.state, 'red')
    expect(countResource(step.state.resources, rCap, 'Material')).toBeGreaterThan(0)
    expect(step.state.log.at(-1)).toMatch(/stealing/)
  })

  it('a Cartel takes its one resource off a rival', () => {
    let state = withCard2(fresh(), 'red', 'bc03')
    state = stripSlots(state, 'red')
    const bCap = slotsOf(state, 'blue')
    state = stripSlots(state, 'blue')
    state = { ...state, resources: gain(state.resources, bCap, 'Material').tracker }

    const step = preludeGuild(state, {
      ability: 'cartel',
      card: 'bc03',
      rival: 'blue',
      resource: 'Material',
    })
    expect(countResource(step.state.resources, bCap, 'Material')).toBe(0)
    expect(
      countResource(step.state.resources, slotsOf(step.state, 'red'), 'Material'),
    ).toBe(1)
  })

  it('a Union takes a played card of its suit into your hand', () => {
    // Pick the Union to match a card yellow actually holds, so this never silently skips.
    const base = fresh()
    const card = contentsOf(base.cards, CardLocation.hand('yellow'))[0]!
    const suit = parseCardId(card).suit
    const union = Object.entries(UNION_SUITS).find(([, s]) => s === suit)![0]

    let state = withCard2(base, 'red', union)
    state = { ...state, cards: move(state.cards, card, CardLocation.played('yellow')) }

    // It must be on offer, not just performable.
    expect(guildPreludes(state, 'red').some((g) => g.kind === 'take-played' && g.taken === card)).toBe(
      true,
    )

    const step = preludeGuild(state, {
      ability: 'take-played',
      card: union,
      taken: card,
      from: 'yellow',
    })
    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).toContain(card)
    expect(contentsOf(step.state.cards, CardLocation.played('yellow'))).not.toContain(card)
  })

  it('Gatekeepers puts a ship on every gate', () => {
    const state = withCard2(fresh(), 'red', 'bc08')
    const gates = state.board.systems.filter((s) => systemInfo(s).isGate)
    expect(gates.length).toBeGreaterThan(0)

    const step = preludeGuild(state, { ability: 'gates', card: 'bc08' })
    for (const g of gates) {
      expect(
        contentsOf(step.state.figures, Location.system(g)).filter((id) => id.startsWith('red/Ship/')).length,
        g,
      ).toBeGreaterThan(0)
    }
  })

  it('a ship-placer puts three ships in one system', () => {
    const state = withCard2(fresh(), 'red', 'bc13')
    const system = state.board.systems[0]!
    const before = contentsOf(state.figures, Location.system(system)).filter((id) =>
      id.startsWith('red/Ship/'),
    ).length

    const step = preludeGuild(state, { ability: 'ships', card: 'bc13', system })
    expect(
      contentsOf(step.state.figures, Location.system(system)).filter((id) => id.startsWith('red/Ship/')),
    ).toHaveLength(before + 3)
  })

  it('Elder Broker gains one each of Material, Fuel and Weapon', () => {
    const state = stripSlots(withCard2(fresh(), 'red', 'bc23'), 'red')
    const cap = slotsOf(state, 'red')
    const step = preludeGuild(state, { ability: 'gain-three', card: 'bc23' })
    let total = 0
    for (const r of ['Material', 'Fuel', 'Weapon'] as const) {
      total += countResource(step.state.resources, cap, r)
    }
    expect(total).toBe(Math.min(3, cap.length))
  })

  it('every one of them discards its own card', () => {
    for (const [card, extra] of [
      ['bc02', { ability: 'fill-slots', resource: 'Material' }],
      ['bc08', { ability: 'gates' }],
      ['bc23', { ability: 'gain-three' }],
    ] as const) {
      const state = withCard2(fresh(), 'red', card)
      const step = preludeGuild(state, { card, ...extra })
      expect(contentsOf(step.state.courtCards, CourtPile.discard()), card).toContain(card)
      expect(contentsOf(step.state.courtCards, CourtPile.secured('red')), card).not.toContain(card)
    }
  })
})

describe("the Cartels' supply clauses (bc03 / bc06)", () => {
  /*
   * The printed cards: "You keep the <Fuel/Material> supply on here. (You add it to Tycoon but
   * can't spend it.) After scoring, Rivals discard all <Fuel/Material>." — docs/13. Only the
   * Prelude steal was implemented for a long time; these pin the other two clauses.
   */

  it("the holder counts the entire supply toward Tycoon; a rival doesn't", () => {
    let state = withCard2(fresh(), 'red', 'bc06')
    state = stripSlots(state, 'red')
    const supply = supplyOf(state.resources, 'Fuel').length
    expect(supply).toBeGreaterThan(0)
    // Red holds no tokens: its Tycoon count is the card's own Fuel-suit icon plus the whole supply.
    expect(metric(state, 'red', 'Tycoon')).toBe(1 + supply)
    // Blue's count is whatever it holds — the supply claim is the holder's alone.
    const blueBefore = metric(stripSlots(fresh(), 'blue'), 'blue', 'Tycoon')
    expect(metric(stripSlots(state, 'blue'), 'blue', 'Tycoon')).toBe(blueBefore)
  })

  it('holding both Cartels claims both supplies', () => {
    let state = withCard2(withCard2(fresh(), 'red', 'bc06'), 'red', 'bc03')
    state = stripSlots(state, 'red')
    const fuel = supplyOf(state.resources, 'Fuel').length
    const material = supplyOf(state.resources, 'Material').length
    // Two suit icons (one per card) plus both supplies.
    expect(metric(state, 'red', 'Tycoon')).toBe(2 + fuel + material)
  })

  it('after ANY scoring, rivals discard that resource — Tycoon undeclared', () => {
    /*
     * The timing pin. The card says "After scoring", with no Tycoon gate, and the recorded
     * decision (docs/13) is the verbatim reading: every chapter scoring while held. This stages a
     * KEEPER-only scoring, so a future "only when Tycoon scored" gate fails here by name.
     */
    let state = withCard2(fresh(), 'red', 'bc06')
    for (const f of ['red', 'yellow', 'blue'] as const) {
      state = stripSlots(state, f)
      state = { ...state, resources: gain(state.resources, slotsOf(state, f), 'Fuel').tracker }
    }
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: ['Keeper'],
      declared: [{ ambition: 'Keeper', marker: { high: 6, low: 3 } }],
    }
    const after = advance(staged, { type: 'ambition/score' }, registry).state
    const fuelOf = (s: GameState, f: 'red' | 'yellow' | 'blue') =>
      countResource(s.resources, slotsOf(s, f), 'Fuel')
    expect(fuelOf(after, 'yellow')).toBe(0)
    expect(fuelOf(after, 'blue')).toBe(0)
    // The holder keeps its own Fuel — the card strips Rivals only.
    expect(fuelOf(after, 'red')).toBe(1)
    expect(after.log.filter((l) => /discarded 1 Fuel \(Fuel Cartel\)/.test(l))).toHaveLength(2)
    // The snowball: the discards land in the supply, which the holder counts from now on.
    expect(metric(after, 'red', 'Tycoon')).toBe(
      1 /* held token */ + 1 /* suit icon */ + supplyOf(after.resources, 'Fuel').length,
    )
  })

  it('two Cartels under two holders strip along their own resource only', () => {
    let state = withCard2(withCard2(fresh(), 'red', 'bc06'), 'yellow', 'bc03')
    for (const f of ['red', 'yellow'] as const) {
      state = stripSlots(state, f)
      let tracker = gain(state.resources, slotsOf(state, f), 'Fuel').tracker
      tracker = gain(tracker, slotsOf(state, f), 'Material').tracker
      state = { ...state, resources: tracker }
    }
    const staged: GameState = {
      ...state,
      power: { red: 0, yellow: 0, blue: 0 },
      ambitions: ['Keeper'],
      declared: [{ ambition: 'Keeper', marker: { high: 6, low: 3 } }],
    }
    const after = advance(staged, { type: 'ambition/score' }, registry).state
    const count = (f: 'red' | 'yellow', r: Resource) =>
      countResource(after.resources, slotsOf(after, f), r)
    // Red holds the Fuel Cartel: keeps Fuel, loses Material to yellow's Material Cartel.
    expect(count('red', 'Fuel')).toBe(1)
    expect(count('red', 'Material')).toBe(0)
    // Yellow holds the Material Cartel: keeps Material, loses Fuel to red's Fuel Cartel.
    expect(count('yellow', 'Material')).toBe(1)
    expect(count('yellow', 'Fuel')).toBe(0)
  })
})

describe('Relic Fence keeps itself (bc24, docs/20 A4)', () => {
  /*
   * "Prelude: Once per turn, you may discard 1 resource to gain 1 Relic." The resource is the
   * whole cost — the audit found the generic guild-prelude `spent` helper burning the card, which
   * turned a reusable once-per-turn engine into a one-shot.
   */
  function fenced(): GameState {
    let state = withCard2(fresh(), 'red', 'bc24')
    state = stripSlots(state, 'red')
    state = { ...state, resources: gain(state.resources, slotsOf(state, 'red'), 'Material').tracker }
    return state
  }

  it('gains the Relic, keeps the card, and marks the turn', () => {
    const state = fenced()
    const step = preludeGuild(state, { ability: 'relic-fence', card: 'bc24', spend: 'Material' })
    expect(countResource(step.state.resources, slotsOf(step.state, 'red'), 'Relic')).toBe(1)
    expect(securedCards(step.state, 'red')).toContain('bc24')
    expect(step.state.usedThisTurn).toContain('bc24')
    expect(step.state.log.at(-1)).toMatch(/traded Material for a Relic \(Relic Fence\)/)
  })

  it('is not offered again in the same turn, and returns next turn', () => {
    const state = { ...fenced(), usedThisTurn: ['bc24'] }
    const offers = guildPreludes(state, 'red')
    expect(offers.some((o) => o.kind === 'relic-fence')).toBe(false)
    const nextTurn = { ...state, usedThisTurn: [] }
    expect(guildPreludes(nextTurn, 'red').some((o) => o.kind === 'relic-fence')).toBe(true)
  })
})

describe("usedThisTurn resets at end of turn (the Bards' once-per-game bug, docs/20 A4)", () => {
  it('performEndTurn clears the per-turn card uses', () => {
    /*
     * Found while fixing Relic Fence: the per-turn reset list in performEndTurn never included
     * usedThisTurn, so Galactic Bards' "once per turn" was once per game. Pinned via the reset
     * itself: a state carrying uses must leave turn/end without them.
     */
    const base = fresh()
    const marked: GameState = { ...base, usedThisTurn: ['bc25', 'bc24'] }
    const after = advance(marked, { type: 'turn/end', faction: 'red' }, registry)
    expect(after.state.usedThisTurn).toEqual([])
  })
})
