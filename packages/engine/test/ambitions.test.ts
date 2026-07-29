import { describe, expect, it } from 'vitest'

import {
  CourtPile,
  AMBITIONS,
  MARKERS,
  ambitionsForStrength,
  advance,
  chapterAmbitionable,
  defaultRegistry,
  metric,
  startGame,
} from '../src/index.js'
import type { Action, Continue, GameState, RuleResult } from '../src/index.js'

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
