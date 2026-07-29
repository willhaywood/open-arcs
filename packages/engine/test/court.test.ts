import { describe, expect, it } from 'vitest'

import {
  AGENTS_PER_FACTION,
  BASE_COURT,
  COURT_SLOTS,
  CourtPile,
  Location,
  advance,
  contentsOf,
  courtCard,
  courtSlots,
  defaultRegistry,
  metric,
  startGame,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, RuleResult } from '../src/index.js'

const FOUR = ['red', 'yellow', 'blue', 'white'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed }, registry).state
}

const agentsOn = (s: GameState, n: number, f: string) =>
  contentsOf(s.figures, Location.court(n)).filter((id) => id.startsWith(`${f}/Agent/`)).length

describe('the deck', () => {
  it('is HRF\'s 31 base cards: 25 guild, 6 vox', () => {
    expect(BASE_COURT).toHaveLength(31)
    expect(BASE_COURT.filter((c) => c.kind === 'guild')).toHaveLength(25)
    expect(BASE_COURT.filter((c) => c.kind === 'vox')).toHaveLength(6)
    expect(BASE_COURT.map((c) => c.id)).toEqual(
      Array.from({ length: 31 }, (_, i) => `bc${String(i + 1).padStart(2, '0')}`),
    )
  })

  it('has no duplicate ids and every id resolves', () => {
    expect(new Set(BASE_COURT.map((c) => c.id)).size).toBe(31)
    for (const c of BASE_COURT) expect(courtCard(c.id)).toEqual(c)
  })
})

describe('setup', () => {
  it('deals four face-up cards and keeps the rest as deck', () => {
    const state = fresh()
    const filled = courtSlots().filter((n) => contentsOf(state.courtCards, CourtPile.slot(n)).length)
    expect(filled).toHaveLength(COURT_SLOTS)
    expect(contentsOf(state.courtCards, CourtPile.deck())).toHaveLength(31 - COURT_SLOTS)
  })

  it('shuffles — two seeds do not deal the same court', () => {
    const open = (s: GameState) => courtSlots().map((n) => contentsOf(s.courtCards, CourtPile.slot(n))[0])
    expect(open(fresh(1))).not.toEqual(open(fresh(2)))
  })

  it('gives every faction ten agents, all in reserve', () => {
    const state = fresh()
    for (const f of FOUR) {
      const inReserve = contentsOf(state.figures, Location.reserve(f)).filter((id) =>
        id.startsWith(`${f}/Agent/`),
      )
      expect(inReserve).toHaveLength(AGENTS_PER_FACTION)
    }
  })
})

describe('influence and secure, driven through a real game', () => {
  const run = drive(15)

  it('places agents on court cards', () => {
    expect(run.influences).toBeGreaterThan(0)
  })

  it('never loses an agent — every one is in reserve, on a card, or a captive', () => {
    expect(run.agentsConserved).toBe(true)
  })

  it('only ever secures on a strict majority', () => {
    expect(run.secures).toBeGreaterThan(0)
    expect(run.securedWithoutMajority).toBe(0)
  })

  it('turns rival agents on the secured card into captives', () => {
    expect(run.captures).toBeGreaterThan(0)
  })

  it('unblocks the Tyrant ambition, which could never score before', () => {
    expect(run.tyrantNonZero).toBeGreaterThan(0)
  })

  it('refills the slot while the deck lasts', () => {
    expect(run.slotsAlwaysFull).toBe(true)
  })

  it('keeps guild cards and discards vox cards', () => {
    expect(run.guildsSecured).toBeGreaterThan(0)
    expect(run.strayCards).toBe(0)
  })
})

// --- driver ----------------------------------------------------------------

type Ask = Extract<Continue, { kind: 'ask' }>

/** Court-hungry: secure when possible, else influence, else buy those actions with a pip. */
function policy(c: Ask): Action {
  const sec = c.actions.find((a) => a.type === 'action/secure')
  if (sec) return sec
  const inf = c.actions.find((a) => a.type === 'action/influence')
  if (inf) return inf
  const menu =
    c.actions.find((a) => a['action'] === 'Secure') ?? c.actions.find((a) => a['action'] === 'Influence')
  if (menu) return menu
  const done = c.actions.find((a) => a.type === 'turn/prelude-done')
  if (done) return done
  const lead = c.actions.find((a) => a.type === 'turn/lead')
  if (lead) return lead
  const follow =
    c.actions.find((a) => a.type === 'turn/surpass') ??
    c.actions.find((a) => a.type === 'turn/pivot') ??
    c.actions.find((a) => a.type === 'turn/copy')
  if (follow) return follow
  return (
    c.actions.find((a) => a.type === 'turn/end') ??
    c.actions.find((a) => a.type === 'turn/skip-seize') ??
    c.actions.find((a) => a.type === 'ambition/skip-declare') ??
    c.actions.find((a) => a.type === 'turn/pass') ??
    c.actions[0]!
  )
}

function drive(seeds: number) {
  let influences = 0
  let secures = 0
  let captures = 0
  let guildsSecured = 0
  let tyrantNonZero = 0
  let securedWithoutMajority = 0
  let agentsConserved = true
  let slotsAlwaysFull = true
  let strayCards = 0

  for (let seed = 1; seed <= seeds; seed++) {
    let step: RuleResult = startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed }, registry)
    for (let i = 0; i < 12000; i++) {
      const c = step.continue
      if (c.kind === 'gameOver') break
      if (c.kind !== 'ask') throw new Error(`unexpected ${c.kind}`)

      const picked = policy(c)
      const before = step.state

      if (picked.type === 'action/secure') {
        const n = picked['slot'] as number
        const f = picked['faction'] as FactionId
        const best = Math.max(0, ...FOUR.filter((x) => x !== f).map((x) => agentsOn(before, n, x)))
        if (agentsOn(before, n, f) <= best) securedWithoutMajority++
        const card = contentsOf(before.courtCards, CourtPile.slot(n))[0]
        if (card && courtCard(card).kind === 'guild') guildsSecured++
      }

      step = advance(before, picked, registry)

      if (picked.type === 'action/influence') influences++
      if (picked.type === 'action/secure') {
        secures++
        for (const f of FOUR) {
          captures +=
            contentsOf(step.state.figures, Location.captives(f)).length -
            contentsOf(before.figures, Location.captives(f)).length
        }
      }

      // Conservation: 10 agents per faction, always somewhere.
      for (const f of FOUR) {
        const inReserve = contentsOf(step.state.figures, Location.reserve(f)).filter((id) =>
          id.startsWith(`${f}/Agent/`),
        ).length
        const onCards = courtSlots().reduce((n, s) => n + agentsOn(step.state, s, f), 0)
        const held = FOUR.reduce(
          (n, g) =>
            n +
            contentsOf(step.state.figures, Location.captives(g)).filter((id) =>
              id.startsWith(`${f}/Agent/`),
            ).length,
          0,
        )
        if (inReserve + onCards + held !== AGENTS_PER_FACTION) agentsConserved = false
      }

      const deckLeft = contentsOf(step.state.courtCards, CourtPile.deck()).length
      const filled = courtSlots().filter(
        (n) => contentsOf(step.state.courtCards, CourtPile.slot(n)).length > 0,
      ).length
      if (deckLeft > 0 && filled < COURT_SLOTS) slotsAlwaysFull = false
    }

    // Every card is accounted for: deck, a slot, someone's secured pile, or the discard.
    const s = step.state
    const seen =
      contentsOf(s.courtCards, CourtPile.deck()).length +
      courtSlots().reduce((n, k) => n + contentsOf(s.courtCards, CourtPile.slot(k)).length, 0) +
      FOUR.reduce((n, f) => n + contentsOf(s.courtCards, CourtPile.secured(f)).length, 0) +
      contentsOf(s.courtCards, CourtPile.discard()).length
    if (seen !== 31) strayCards++

    for (const f of FOUR) if (metric(s, f, 'Tyrant') > 0) tyrantNonZero++
  }

  return {
    influences,
    secures,
    captures,
    guildsSecured,
    tyrantNonZero,
    securedWithoutMajority,
    agentsConserved,
    slotsAlwaysFull,
    strayCards,
  }
}
