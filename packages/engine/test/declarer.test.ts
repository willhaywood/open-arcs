/**
 * `declarerBot`: the probe resolves the declare prompt instead of declining it (`Bot.settleDeclares`).
 *
 * Three properties. It changes only lead decisions — a follower is never asked to declare, so a
 * difference anywhere else would mean the flag leaked into some other sub-flow. It does change real
 * leads, so the flag is not decoration. And it does not cheat: Farseers' look follows a declaration
 * and lists a rival's real hand, so with Farseers held, a lead's score must not depend on what the
 * rivals are holding.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  CourtPile,
  RuleRegistry,
  FARSEERS,
  advance,
  botToAct,
  contentsOf,
  declarerBot,
  defaultRegistry,
  mobileBot,
  move,
  moveAll,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { Action, FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/** Drive a three-player game with normal deciding, for `steps` decisions. */
function drive(seed: number, steps: number): { cur: RuleResult; asked: AskedThisTurn } {
  let cur: RuleResult = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < steps; i++) {
    const f = botToAct(cur, THREE)
    if (f === undefined) break
    const s = stepBot(cur, mobileBot, f, registry, asked)
    cur = s.result
    asked = s.asked
  }
  return { cur, asked }
}

/** The default rules, recording the type of every action any probe performs through them. */
function recordingRegistry(): { registry: RuleRegistry; performed: string[] } {
  const performed: string[] = []
  const inner = defaultRegistry()
  const recording = new RuleRegistry()
  for (const id of inner.ids()) {
    const module = inner.get(id)
    recording.register({
      id,
      perform: (state, action) => {
        performed.push(action.type)
        return module.perform(state, action)
      },
    })
  }
  return { registry: recording, performed }
}

const isLeadAsk = (r: RuleResult): boolean =>
  r.continue.kind === 'ask' && r.continue.actions.some((a) => a.type === 'turn/lead')

/** Every hidden card the leader cannot see — the rivals' hands and the deck — rotated between them. */
function rotateHiddenCards(state: GameState, self: FactionId): GameState {
  const zones = [
    ...state.factions.filter((f) => f !== self).map((f) => CardLocation.hand(f)),
    CardLocation.deck(),
  ]
  const sizes = zones.map((z) => contentsOf(state.cards, z).length)
  const pool = zones.flatMap((z) => [...contentsOf(state.cards, z)])
  const rotated = [...pool.slice(sizes[0]!), ...pool.slice(0, sizes[0]!)]
  let cards = state.cards
  let cursor = 0
  zones.forEach((z, i) => {
    cards = moveAll(cards, rotated.slice(cursor, cursor + sizes[i]!), z)
    cursor += sizes[i]!
  })
  return { ...state, cards }
}

describe('declarerBot', () => {
  it('differs from normal only at lead decisions, and does change some', () => {
    let cur: RuleResult = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry)
    let asked: AskedThisTurn = NO_ASKS
    let leadsChanged = 0
    for (let step = 0; step < 200; step++) {
      const f = botToAct(cur, THREE)
      if (f === undefined) break
      const normal = stepBot(cur, mobileBot, f, registry, asked)
      const declarer = stepBot(cur, declarerBot, f, registry, asked)
      if (JSON.stringify(normal.decision.action) !== JSON.stringify(declarer.decision.action)) {
        expect(isLeadAsk(cur), `step ${step} changed a non-lead decision`).toBe(true)
        leadsChanged++
      }
      cur = normal.result
      asked = normal.asked
    }
    expect(leadsChanged).toBeGreaterThan(0)
  })

  it('scores a lead the same whatever the rivals hold, with Farseers in hand', () => {
    const { cur, asked } = drive(1, 33)
    expect(isLeadAsk(cur)).toBe(true)
    const f = botToAct(cur, THREE)!
    const withFarseers: RuleResult = {
      ...cur,
      state: { ...cur.state, courtCards: move(cur.state.courtCards, FARSEERS, CourtPile.secured(f)) },
    }

    // Not vacuous: some lead here declares, and declaring reaches Farseers' look at a real hand.
    const reachesFarseers = (cur.continue.kind === 'ask' ? cur.continue.actions : []).some((lead: Action) => {
      if (lead.type !== 'turn/lead') return false
      const led = advance(withFarseers.state, lead, registry)
      if (led.continue.kind !== 'ask') return false
      const declare = led.continue.actions.find((a) => a.type === 'ambition/declare')
      if (declare === undefined) return false
      const after = advance(led.state, declare, registry)
      return (
        after.continue.kind === 'ask' &&
        after.continue.actions.some((a) => a.type === 'ambition/farseers-look')
      )
    })
    expect(reachesFarseers).toBe(true)

    /*
     * The mechanism, which is what can actually fail: no probe may perform the look. Scores alone
     * cannot show it here — the leaked hand happens not to move any lead's value in this position,
     * which is the usual case — but a probe that looks has read a rival's real hand whatever it
     * then decides.
     */
    const { registry: recording, performed } = recordingRegistry()
    stepBot(withFarseers, declarerBot, f, recording, asked)
    expect(performed).toContain('ambition/declare')
    expect(performed).toContain('ambition/farseers-skip')
    expect(performed).not.toContain('ambition/farseers-look')

    const other: RuleResult = { ...withFarseers, state: rotateHiddenCards(withFarseers.state, f) }
    expect(contentsOf(other.state.cards, CardLocation.hand(f))).toEqual(
      contentsOf(withFarseers.state.cards, CardLocation.hand(f)),
    )
    const scores = (r: RuleResult): string =>
      JSON.stringify(
        stepBot(r, declarerBot, f, registry, asked).decision.considered?.map((c) => [c.action.type, c.action['label'], c.score]),
      )
    expect(scores(other)).toBe(scores(withFarseers))
  })
})
