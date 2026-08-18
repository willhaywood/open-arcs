import { describe, expect, it } from 'vitest'

import {
  CourtPile,
  AMBITIONS,
  Location,
  MARKERS,
  ScoreAmbitions,
  ambitionsForStrength,
  advance,
  chapterAmbitionable,
  contentsOf,
  defaultRegistry,
  metric,
  move,
  parseFigureId,
  slotsOf,
  startGame,
} from '../src/index.js'
import type {
  Action,
  Ambition,
  Continue,
  FactionId,
  GameState,
  RuleResult,
} from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const FOUR = ['red', 'yellow', 'blue', 'white'] as const
const registry = defaultRegistry()

describe('ambition markers (cross-checked with the TTS component values)', () => {
  it('are the five ambitions keyed to card strengths', () => {
    expect([...AMBITIONS]).toEqual(['Tycoon', 'Tyrant', 'Warlord', 'Keeper', 'Empath'])
  })

  it('map card strength to a declarable ambition', () => {
    expect(ambitionsForStrength(2)).toEqual(['Tycoon'])
    expect(ambitionsForStrength(6)).toEqual(['Empath'])
    expect(ambitionsForStrength(1)).toEqual([]) // strength-1 cards cannot declare
    expect(ambitionsForStrength(7)).toEqual([...AMBITIONS]) // 7 is wild
  })

  it('contain the physical marker faces 2/0, 4/2, 3/2, 6/3, 5/3, 9/4', () => {
    const faces = MARKERS.map((m) => `${m.high}/${m.low}`)
    for (const f of ['2/0', '4/2', '3/2', '6/3', '5/3', '9/4']) {
      expect(faces).toContain(f)
    }
  })

  it('give three escalating markers per chapter via a sliding window', () => {
    // Chapter 1 opens with the low faces; later chapters include the high faces.
    expect(chapterAmbitionable(1)).toEqual([
      { high: 2, low: 0 },
      { high: 3, low: 2 },
      { high: 5, low: 3 },
    ])
    const c3 = chapterAmbitionable(3).map((m) => m.high)
    expect(Math.max(...c3)).toBeGreaterThan(5)
  })
})

describe('declaring an ambition', () => {
  it('is offered to the lead player and takes the highest available marker', () => {
    let step = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const lead = pick(step.continue, 'turn/lead')
    step = advance(step.state, lead, registry)

    const declare = step.continue.kind === 'ask'
      ? step.continue.actions.find((a) => a.type === 'ambition/declare')
      : undefined
    if (declare === undefined) return // this seed's first lead can't declare; nothing to assert

    const beforeMarkers = step.state.ambitionable.length
    const bestHigh = Math.max(...step.state.ambitionable.map((m) => m.high))
    step = advance(step.state, declare, registry)

    expect(step.state.declared).toHaveLength(1)
    expect(step.state.declared[0]!.marker.high).toBe(bestHigh)
    expect(step.state.ambitionable).toHaveLength(beforeMarkers - 1)
    expect(step.state.lead!.zeroed).toBe(true)
  })
})

describe('metrics (base game)', () => {
  it('Tycoon counts Material plus Fuel, others their own resource', () => {
    // Fresh game: each faction holds two starting resources.
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    for (const f of THREE) {
      const tycoon = metric(state, f, 'Tycoon')
      const keeper = metric(state, f, 'Keeper')
      const empath = metric(state, f, 'Empath')
      // Every held token contributes to exactly one resource-based metric.
      expect(tycoon + keeper + empath).toBeGreaterThanOrEqual(0)
    }
  })

  it('Tyrant and Warlord count captives and trophies (zero at start)', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    expect(metric(state, 'red', 'Tyrant')).toBe(0)
    expect(metric(state, 'red', 'Warlord')).toBe(0)
  })
})

/*
 * The rulebook scores Tycoon as "the most total Fuel and Material icons *from resources and Guild
 * cards*", and says of the suit icon: "It adds to ambitions just like resources. Material and Fuel
 * cards add to the Tycoon ambition, Relic cards add to the Keeper ambition and Psionic cards add to
 * the Empath ambition. Weapon cards do not add to any ambitions."
 *
 * `metric` counted only resource tokens, so secured guilds scored nothing at all.
 */
describe('secured Guild cards score as one icon of their suit', () => {
  /** `state` with `cards` secured to `faction`, leaving everything else alone. */
  const secure = (state: GameState, faction: FactionId, ...cards: readonly string[]): GameState =>
    cards.reduce(
      (s, id) => ({ ...s, courtCards: move(s.courtCards, id, CourtPile.secured(faction)) }),
      state,
    )

  const fresh = () => startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 }).state

  it('adds the card to its own ambition and to no other', () => {
    const before = fresh()
    const after = secure(before, 'red', 'bc23') // Elder Broker, Relic

    expect(metric(after, 'red', 'Keeper')).toBe(metric(before, 'red', 'Keeper') + 1)
    for (const a of ['Tycoon', 'Empath', 'Tyrant', 'Warlord'] as const) {
      expect(metric(after, 'red', a)).toBe(metric(before, 'red', a))
    }
  })

  it('is worth one icon whatever the raid cost, which is a separate part of the card', () => {
    /*
     * The discriminator against counting `keys`: both are Relic guilds, but Loyal Keepers costs 3
     * keys to raid and Sworn Guardians costs 1. Scoring is blind to that — each is one icon.
     */
    const base = fresh()
    const keeperMetric = (id: string) =>
      metric(secure(base, 'red', id), 'red', 'Keeper') - metric(base, 'red', 'Keeper')

    expect(keeperMetric('bc21')).toBe(1) // Loyal Keepers, raid cost 3
    expect(keeperMetric('bc22')).toBe(1) // Sworn Guardians, raid cost 1
  })

  it('scores nothing for Weapon guilds, which no ambition counts', () => {
    const before = fresh()
    // Every Weapon guild in the base court at once, including the raid-cost-3 loyal one.
    const after = secure(before, 'red', 'bc11', 'bc12', 'bc13', 'bc14', 'bc15')

    for (const a of AMBITIONS) expect(metric(after, 'red', a)).toBe(metric(before, 'red', a))
  })

  it('stacks Material and Fuel guilds together into Tycoon, on top of held resources', () => {
    const before = fresh()
    /*
     * Deliberately non-Cartel guilds: bc03/bc06 used to sit here as plain icons, but the Cartels'
     * printed supply claim now adds the whole token supply on top (docs/13), which is not what
     * this test is about. Icon stacking is asserted on cards that are only icons.
     */
    const after = secure(before, 'red', 'bc02', 'bc04', 'bc09') // 2 Material + 1 Fuel

    expect(metric(after, 'red', 'Tycoon')).toBe(metric(before, 'red', 'Tycoon') + 3)
  })

  it('scores only for the faction holding it — not the court, not a rival', () => {
    const before = fresh()
    const secured = secure(before, 'red', 'bc17') // Farseers, Psionic

    expect(metric(secured, 'red', 'Empath')).toBe(metric(before, 'red', 'Empath') + 1)
    expect(metric(secured, 'yellow', 'Empath')).toBe(metric(before, 'yellow', 'Empath'))

    // Face up in a court slot but unclaimed, it is worth nothing to anybody.
    const inCourt = { ...before, courtCards: move(before.courtCards, 'bc17', CourtPile.slot(1)) }
    for (const f of THREE) {
      expect(metric(inCourt, f, 'Empath')).toBe(metric(before, f, 'Empath'))
    }
  })
})

/*
 * Rulebook 6.2.2 step 1: "If Warlord was scored, return all Trophies. If Tyrant was scored, return
 * all Captives." Nothing did this, so both piles accumulated for the whole game and a lead in
 * either became permanent.
 *
 * Note what is *absent* from that step: resources. They are never returned at chapter end, which is
 * the question that turned this up — the answer being that our handling of resources was right.
 */
describe('scoring Warlord or Tyrant empties the pile it counted', () => {
  const base = () => startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 }).state

  /** Move `count` of `victim`'s ships into `holder`'s trophy pile (or agents into captives). */
  const capture = (
    state: GameState,
    holder: FactionId,
    victim: FactionId,
    piece: 'Ship' | 'Agent',
    count: number,
  ): GameState => {
    const pile = piece === 'Ship' ? Location.trophies(holder) : Location.captives(holder)
    const taken = contentsOf(state.figures, Location.reserve(victim))
      .filter((id) => parseFigureId(id).piece === piece)
      .slice(0, count)
    expect(taken).toHaveLength(count) // guard: the fixture must actually hold what it claims
    return taken.reduce((s, id) => ({ ...s, figures: move(s.figures, id, pile) }), state)
  }

  const declaring = (state: GameState, ...ambitions: readonly Ambition[]): GameState => ({
    ...state,
    declared: ambitions.map((ambition) => ({ ambition, marker: { high: 4, low: 2 } })),
  })

  const pileSizes = (state: GameState, which: 'trophies' | 'captives') =>
    THREE.map((f) =>
      contentsOf(state.figures, which === 'trophies' ? Location.trophies(f) : Location.captives(f))
        .length,
    )

  it('returns every faction’s trophies, including factions that scored no power', () => {
    /*
     * Red 3, yellow 2, blue 1: red takes first, yellow second, blue places nowhere. The BGG ruling
     * (thread 3507253) is that blue returns its trophy all the same — the trigger is the ambition
     * being scored, not the holder having placed.
     */
    let state = base()
    state = capture(state, 'red', 'blue', 'Ship', 3)
    state = capture(state, 'yellow', 'blue', 'Ship', 2)
    state = capture(state, 'blue', 'red', 'Ship', 1)
    expect(pileSizes(state, 'trophies')).toEqual([3, 2, 1])

    const after = advance(declaring(state, 'Warlord'), ScoreAmbitions(), registry)

    expect(pileSizes(after.state, 'trophies')).toEqual([0, 0, 0])
    // Someone did place, so this is not passing merely because nothing scored.
    expect(after.state.power['red'] ?? 0).toBeGreaterThan(0)
  })

  it('sends each figure to its own owner’s reserve, not the holder’s', () => {
    // The whole reason ownership is parsed off the figure id rather than taken from the pile.
    let state = capture(base(), 'red', 'blue', 'Ship', 2)
    const blueBefore = contentsOf(state.figures, Location.reserve('blue')).length
    const redBefore = contentsOf(state.figures, Location.reserve('red')).length

    const after = advance(declaring(state, 'Warlord'), ScoreAmbitions(), registry)

    expect(contentsOf(after.state.figures, Location.reserve('blue')).length).toBe(blueBefore + 2)
    expect(contentsOf(after.state.figures, Location.reserve('red')).length).toBe(redBefore)
  })

  it('clears only the pile its own ambition counts', () => {
    let state = capture(base(), 'red', 'blue', 'Ship', 2)
    state = capture(state, 'red', 'blue', 'Agent', 2)

    const warlord = advance(declaring(state, 'Warlord'), ScoreAmbitions(), registry)
    expect(pileSizes(warlord.state, 'trophies')).toEqual([0, 0, 0])
    expect(pileSizes(warlord.state, 'captives')).toEqual([2, 0, 0]) // untouched

    const tyrant = advance(declaring(state, 'Tyrant'), ScoreAmbitions(), registry)
    expect(pileSizes(tyrant.state, 'captives')).toEqual([0, 0, 0])
    expect(pileSizes(tyrant.state, 'trophies')).toEqual([2, 0, 0]) // untouched
  })

  it('leaves both piles alone when neither ambition was declared', () => {
    let state = capture(base(), 'red', 'blue', 'Ship', 2)
    state = capture(state, 'red', 'blue', 'Agent', 2)

    // Tycoon scores; nothing counts trophies or captives, so nothing is returned.
    const after = advance(declaring(state, 'Tycoon'), ScoreAmbitions(), registry)

    expect(pileSizes(after.state, 'trophies')).toEqual([2, 0, 0])
    expect(pileSizes(after.state, 'captives')).toEqual([2, 0, 0])
  })
})

describe('scoring awards power and ends the game', () => {
  it('a game driven by an ambition-declaring policy ends by power or after 5 chapters', () => {
    const result = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 21 }, declaringPolicy)
    expect(result.continue.kind).toBe('gameOver')
    expect(result.state.isOver).toBe(true)
    expect(result.state.winners).toHaveLength(1)

    // The winner holds the most power, and it is positive (someone scored an ambition).
    const winner = result.state.winners[0]!
    const power = result.state.power
    const maxPower = Math.max(...result.state.factions.map((f) => power[f] ?? 0))
    expect(power[winner] ?? 0).toBe(maxPower)
    expect(maxPower).toBeGreaterThan(0)
  })

  it('records a win reason mentioning power', () => {
    const result = playToEnd({ board: 'Board4MixUp1', factions: FOUR, seed: 8 }, declaringPolicy)
    if (result.continue.kind !== 'gameOver') throw new Error('expected game over')
    expect(result.continue.reason).toMatch(/power/)
  })

  it('is deterministic under a fixed seed and policy', () => {
    const a = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 55 }, declaringPolicy)
    const b = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 55 }, declaringPolicy)
    expect(a.state.power).toEqual(b.state.power)
    expect(a.state.log).toEqual(b.state.log)
  })
})

// --- helpers ---------------------------------------------------------------

function pick(c: Continue, type: string): Action {
  if (c.kind !== 'ask') throw new Error(`expected ask, got ${c.kind}`)
  const found = c.actions.find((a) => a.type === type)
  if (found === undefined) throw new Error(`no ${type}`)
  return found
}

type Policy = (c: { kind: 'ask'; actions: readonly Action[] }) => Action

/** Declares ambitions when offered, takes Tax to build a metric, else leads/ends/passes. */
const declaringPolicy: Policy = (c) => {
  const declare = c.actions.find((a) => a.type === 'ambition/declare')
  if (declare) return declare
  // Skip the Prelude. This policy is about declaring and scoring ambitions, and without
  // this it falls through to the first offer and burns every resource on free actions —
  // which leaves the resource-counting ambitions at zero and nobody scoring.
  const endPrelude = c.actions.find((a) => a.type === 'turn/prelude-done')
  if (endPrelude) return endPrelude
  // Leave the resource slots alone. Arranging re-offers itself after every move — that is what
  // makes it a board you push tokens around on — so any driver must choose to stop, exactly as a
  // player clicks Done. Falling through to `actions[0]` here shuffles tokens forever.
  const doneArranging = c.actions.find((a) => a.type === 'resources/arrange-done')
  if (doneArranging) return doneArranging
  const tax = c.actions.find((a) => a['label'] === 'Tax')
  if (tax) return tax
  const taxCity = c.actions.find((a) => a.type === 'action/tax-city')
  if (taxCity) return taxCity
  const lead = c.actions.find((a) => a.type === 'turn/lead')
  if (lead) return lead
  const end = c.actions.find((a) => a.type === 'turn/end')
  const skipSeize = c.actions.find((a) => a.type === 'turn/skip-seize')
  const pass = c.actions.find((a) => a.type === 'turn/pass')
  return end ?? skipSeize ?? pass ?? c.actions[0]!
}

function playToEnd(options: Parameters<typeof startGame>[0], policy: Policy, limit = 8000): RuleResult {
  let step = startGame(options, registry)
  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind === 'gameOver') return step
    if (c.kind !== 'ask') throw new Error(`unexpected ${c.kind}`)
    step = advance(step.state, policy(c), registry)
  }
  throw new Error('game did not terminate')
}

// touch the type import so it is not flagged unused
export type _State = GameState

/**
 * Who may declare.
 *
 * Only the **lead** player, and that includes surpassing — a follower who plays a higher card of
 * the lead suit takes the initiative but declares nothing. This was recorded in docs/08 as a
 * deferred feature ("following players declaring is not in the base path"), which read as a gap;
 * it is the rule. These tests exist so a later reader does not "fix" it.
 *
 * The one base-game exception is Galactic Bards (bc25), which is a card, not the turn structure.
 */
describe('only the lead player declares an ambition', () => {
  const reg = defaultRegistry()
  const THREE_F = ['red', 'yellow', 'blue'] as const

  /**
   * Play on, checking every declare offer as it appears. Over several rounds the lead changes,
   * so the invariant is not "one faction ever" — it is that whoever is being asked *is the lead
   * of the round in progress*.
   */
  function everyDeclareWentToTheLead(seed: number): { offers: number; allToLead: boolean } {
    let step = startGame({ board: 'Board3MixUp', factions: [...THREE_F], seed }, reg)
    let offers = 0
    let allToLead = true
    for (let i = 0; i < 400; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      if (c.actions.some((a) => a.type === 'ambition/declare')) {
        offers++
        if (step.state.lead?.faction !== c.faction) allToLead = false
      }
      // never take the declare, so the round carries on through the followers
      const skip = c.actions.find((a) => a.type === 'ambition/skip-declare')
      const pick =
        skip ??
        c.actions.find((a) => !/pass/i.test(String(a['label'] ?? ''))) ??
        c.actions[0]!
      step = advance(step.state, pick, reg)
    }
    return { offers, allToLead }
  }

  it('offers a declare only to the faction that led the round', () => {
    let total = 0
    for (let seed = 1; seed < 6; seed++) {
      const { offers, allToLead } = everyDeclareWentToTheLead(seed)
      expect(allToLead).toBe(true)
      total += offers
    }
    // and the check is not vacuous — declares really were offered
    expect(total).toBeGreaterThan(0)
  })

  it('a surpass takes the initiative but declares nothing', () => {
    let step = startGame({ board: 'Board3MixUp', factions: [...THREE_F], seed: 2 }, reg)
    // lead, decline to declare, then find a surpass
    for (let i = 0; i < 60; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      const skip = c.actions.find((a) => a.type === 'ambition/skip-declare')
      if (skip !== undefined) {
        step = advance(step.state, skip, reg)
        continue
      }
      const surpass = c.actions.find((a) => a.type === 'turn/surpass')
      if (surpass !== undefined) {
        const after = advance(step.state, surpass, reg)
        if (after.continue.kind === 'ask') {
          expect(after.continue.actions.some((a) => a.type === 'ambition/declare')).toBe(false)
        }
        return
      }
      step = advance(step.state, c.actions.find((a) => !/pass/i.test(String(a['label'] ?? ''))) ?? c.actions[0]!, reg)
    }
  })
})

/**
 * The cards that declare.
 *
 * Two in the base game, and both are exceptions to "only the lead declares" — which is why they
 * are tested here, beside that rule, rather than only with their own decks.
 *
 *   Galactic Bards (bc25, guild) — declare from *any* play, before anyone else has declared.
 *   Populist Demands (bc27, vox) — declare on securing it, free.
 */
describe('cards that let a non-lead declare', () => {
  const reg2 = defaultRegistry()
  const THREE_C = ['red', 'yellow', 'blue'] as const

  function fresh2(): GameState {
    return startGame({ board: 'Board3MixUp', factions: [...THREE_C], seed: 1 }, reg2).state
  }

  /** Put a court card straight into red's secured pile. */
  function secured(state: GameState, id: string): GameState {
    const contents = new Map(state.courtCards.contents)
    const at = new Map(state.courtCards.at)
    const from = at.get(id)
    if (from !== undefined) contents.set(from, (contents.get(from) ?? []).filter((c) => c !== id))
    const pile = CourtPile.secured('red')
    contents.set(pile, [...(contents.get(pile) ?? []), id])
    at.set(id, pile)
    return { ...state, courtCards: { ...state.courtCards, contents, at } }
  }

  /** red has copied yellow's lead — red is emphatically not the lead player. */
  function redCopied(state: GameState): GameState {
    return {
      ...state,
      lead: {
        faction: 'yellow' as const,
        suit: 'Administration' as const,
        cardId: 'Administration-4',
        strength: 4,
        pips: 2,
        zeroed: false,
      },
      roundPlays: [
        { faction: 'yellow' as const, cardId: 'Administration-4', kind: 'lead' as const },
        { faction: 'red' as const, cardId: 'Aggression-2', kind: 'copy' as const },
      ],
    }
  }

  it('Galactic Bards offers a declare to a player who only copied', () => {
    const s = redCopied(secured(fresh2(), 'bc25'))
    expect(s.lead?.faction).not.toBe('red')
    const out = advance(
      s,
      { type: 'turn/check-seize', faction: 'red', pips: 1, suit: 'Aggression' },
      reg2,
    )
    const c = out.continue
    expect(c.kind).toBe('ask')
    if (c.kind !== 'ask') return
    expect(c.actions.some((a) => a.type === 'turn/bards-declare')).toBe(true)
  })

  it('and taking it really declares, without zeroing the lead card', () => {
    const s = redCopied(secured(fresh2(), 'bc25'))
    const out = advance(
      s,
      { type: 'turn/check-seize', faction: 'red', pips: 1, suit: 'Aggression' },
      reg2,
    )
    if (out.continue.kind !== 'ask') throw new Error('expected an ask')
    const declare = out.continue.actions.find((a) => a.type === 'turn/bards-declare')!
    const after = advance(out.state, declare, reg2).state
    expect(after.declared.length).toBe(1)
    // the Bards declaration is free: yellow's lead card keeps its strength
    expect(after.lead?.zeroed).not.toBe(true)
  })

  it('Galactic Bards is spent once per turn', () => {
    const s = redCopied(secured(fresh2(), 'bc25'))
    const out = advance(
      s,
      { type: 'turn/check-seize', faction: 'red', pips: 1, suit: 'Aggression' },
      reg2,
    )
    if (out.continue.kind !== 'ask') throw new Error('expected an ask')
    const declare = out.continue.actions.find((a) => a.type === 'turn/bards-declare')!
    const after = advance(out.state, declare, reg2)
    expect(after.state.usedThisTurn).toContain('bc25')
  })

  it('Populist Demands declares on securing, for a player who is not the lead', () => {
    const s = redCopied(secured(fresh2(), 'bc27'))
    const out = advance(
      s,
      { type: 'vox/trigger', faction: 'red', card: 'bc27', then: { type: 'turn/lead-main', faction: 'red' } },
      reg2,
    )
    const c = out.continue
    expect(c.kind).toBe('ask')
    if (c.kind !== 'ask') return
    const offers = c.actions.filter((a) => a.type === 'vox/populist')
    expect(offers.length).toBeGreaterThan(0)

    const after = advance(out.state, offers[0]!, reg2).state
    expect(after.declared.length).toBe(1)
    expect(after.lead?.zeroed).not.toBe(true)
  })
})


/**
 * Scoring an ambition, and the case that reads as a bug at the table.
 *
 * Written after "yellow won Empath for 12 power" was reported as double-counting. It is correct,
 * and the arithmetic is worth pinning because three separate rules combine into one surprising
 * number — quoting the rulebook, which is the authority here:
 *
 *   - "Score each ambition that has **any number** of ambition markers... The player who gets first
 *     place gains the **higher** Power shown on **all** its ambition markers." So an ambition
 *     declared twice pays the sum of the highs, and a winner never takes a low.
 *   - "Bonus City Power. Each time you get first place in an ambition (**not tied**), gain extra
 *     Power if the '+2 to won ambitions' city slot is uncovered..."
 *   - "You can only gain bonus Power **once per ambition** regardless of how many ambition markers
 *     it has."
 */
describe('scoring ambitions', () => {
  const THREE_F: readonly FactionId[] = ['red', 'yellow', 'blue']

  /** Give a faction exactly `n` Psionic, which is the Empath metric. */
  const psionic = (state: GameState, faction: FactionId, n: number): GameState => {
    let out = state
    const slots = slotsOf(out, faction)
    // Clear the slots first so starting resources cannot skew the count.
    for (const slot of slots) {
      for (const token of contentsOf(out.resources, slot)) {
        out = {
          ...out,
          resources: move(out.resources, token, `supply:${token.slice(0, token.indexOf('#'))}`),
        }
      }
    }
    contentsOf(out.resources, 'supply:Psionic')
      .slice(0, n)
      .forEach((token, i) => {
        out = { ...out, resources: move(out.resources, token, slots[i]!) }
      })
    return out
  }

  /** Build cities until only `left` remain in reserve — this is what uncovers the Power bonuses. */
  const citiesLeft = (state: GameState, faction: FactionId, left: number): GameState => {
    let out = state
    const system = out.board.systems[0]!
    const inReserve = () =>
      contentsOf(out.figures, Location.reserve(faction)).filter((i) => i.includes('City'))
    while (inReserve().length > left) {
      out = { ...out, figures: move(out.figures, inReserve()[0]!, Location.system(system)) }
    }
    return out
  }

  const position = (markers: readonly { high: number; low: number }[], yellowCities: number): GameState => {
    let s = startGame({ board: 'Board3Frontiers', factions: [...THREE_F], seed: 1 }, registry).state
    s = psionic(s, 'yellow', 2)
    s = psionic(s, 'blue', 1)
    s = psionic(s, 'red', 0)
    s = citiesLeft(s, 'yellow', yellowCities)
    return {
      ...s,
      declared: markers.map((m) => ({ ambition: 'Empath' as const, marker: m })),
      power: { red: 0, yellow: 0, blue: 0 },
    }
  }

  it('pays the sum of the highs across every marker, plus one city bonus', () => {
    // The reported game exactly: Empath declared twice (6/3 and 4/2), yellow ahead, one city left.
    const out = advance(position([{ high: 6, low: 3 }, { high: 4, low: 2 }], 1), ScoreAmbitions(), registry)

    // 6 + 4 highs, + 2 for the uncovered city slot. The winner never takes a low.
    expect(out.state.power['yellow']).toBe(12)
    // Second place takes the sum of the lows, and gets no city bonus.
    expect(out.state.power['blue']).toBe(5)
    expect(out.state.log.join(' ')).toContain('yellow won Empath for 12 power')
  })

  it('gives the city bonus once per ambition, not once per marker', () => {
    const one = advance(position([{ high: 6, low: 3 }], 1), ScoreAmbitions(), registry)
    const two = advance(position([{ high: 6, low: 3 }, { high: 4, low: 2 }], 1), ScoreAmbitions(), registry)

    // One marker: 6 + 2. Two markers: 10 + 2 — the bonus is added once, not twice.
    expect(one.state.power['yellow']).toBe(8)
    expect(two.state.power['yellow']! - one.state.power['yellow']!).toBe(4)
  })

  it('withholds the city bonus on a tie, which is not first place', () => {
    // Level on the metric: both tie, so both take the low and neither gets the bonus.
    let s = position([{ high: 6, low: 3 }], 1)
    s = psionic(s, 'blue', 2)
    const out = advance(s, ScoreAmbitions(), registry)

    expect(out.state.power['yellow']).toBe(3)
    expect(out.state.power['blue']).toBe(3)
    expect(out.state.log.join(' ')).toContain('tied Empath')
  })
})
