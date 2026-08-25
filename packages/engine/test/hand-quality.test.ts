/**
 * The residual hand, priced by its cards (`handPips` / `handTopCard`, switched on in `hand.ts`).
 *
 * The evaluator's only hand feature was `tempo` — a count — so every pair of candidate card plays
 * that bought the same board this turn while leaving different hands behind scored identically.
 * Most of what is pinned here is the **guard** and the **identity**: rivals' hands are hidden, so
 * the features must be absent for them, and the default weights are 0 so the frozen baseline and
 * `standardBot` do not move.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  HAND_WEIGHTS,
  WEIGHTS,
  botToAct,
  contentsOf,
  defaultRegistry,
  featuresOf,
  handBot,
  intentFor,
  move,
  observe,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import { valueOf } from '../src/ai/value.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']
const FOUR: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']

/*
 * Four players for the constructed hands: the 3-player deck strips the 1s and 7s, so the exact
 * card ids these tests deal only exist in a 4-player game — the same reason
 * `declare-ready.test.ts` runs at four.
 */
const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed }, registry).state

/** Empty a hand, then deal it exactly the given cards — the `declare-ready.test.ts` helper. */
const handOf = (state: GameState, faction: FactionId, ids: readonly string[]): GameState => {
  let s = state
  for (const id of contentsOf(s.cards, CardLocation.hand(faction))) {
    s = { ...s, cards: move(s.cards, id, CardLocation.discard()) }
  }
  for (const id of ids) s = { ...s, cards: move(s.cards, id, CardLocation.hand(faction)) }
  return s
}

const features = (s: GameState, of: FactionId) => {
  const o = observe(s, 'red')
  return featuresOf(o, of, intentFor(o, 'red'))
}

describe('the hand features', () => {
  it('sum pips and take the top strength, from the printed card table', () => {
    // Administration-1 is 4 pips, Aggression-6 is 2, Administration-7 is 1 (PIPS, cards.ts).
    const x = features(handOf(fresh(), 'red', ['Administration-1', 'Aggression-6', 'Administration-7']), 'red')
    expect(x.handPips).toBe(4 + 2 + 1)
    expect(x.handTopCard).toBe(7)
  })

  it('are zero on an empty hand', () => {
    const x = features(handOf(fresh(), 'red', []), 'red')
    expect(x.handPips).toBe(0)
    expect(x.handTopCard).toBe(0)
  })

  it('are ABSENT for rivals — their hands are hidden', () => {
    /*
     * The guard this feature cannot ship without. `observed.hand` is always the observing
     * faction's own hand, so scoring a rival with it would price yellow as holding red's cards —
     * and the relative `valueOf` would then subtract my own hand from myself. Same guard as
     * `declareReadiness`, same reasoning.
     */
    const s = handOf(fresh(), 'red', ['Administration-1', 'Administration-7'])
    const x = features(s, 'yellow')
    expect(x.handPips).toBe(0)
    expect(x.handTopCard).toBe(0)
  })

  it('leaves the shipped weights unmoved, and genuinely moves under HAND_WEIGHTS', () => {
    /*
     * The two hands hold the same count (tempo equal) and the same strengths {1, 2} (declare
     * profile equal); only the suits differ, so only the pips do — Administration-2 is 4,
     * Aggression-2 is 3. Under `WEIGHTS` (weight 0) the values must be identical, or the frozen
     * baseline has moved. Under `HAND_WEIGHTS` the 8-pip hand must beat the 7-pip hand, or the
     * experiment measures nothing.
     */
    const a = handOf(fresh(), 'red', ['Administration-1', 'Administration-2'])
    const b = handOf(fresh(), 'red', ['Administration-1', 'Aggression-2'])
    const oa = observe(a, 'red')
    const ob = observe(b, 'red')
    const intent = intentFor(oa, 'red')
    expect(valueOf(oa, 'red', intent, WEIGHTS)).toBe(valueOf(ob, 'red', intent, WEIGHTS))
    expect(valueOf(oa, 'red', intent, HAND_WEIGHTS)).toBeGreaterThan(
      valueOf(ob, 'red', intent, HAND_WEIGHTS),
    )
  })

  it('has both weights genuinely on in HAND_WEIGHTS', () => {
    // The cheap needle for the weight-zeroing mutations, as standard-bot.test.ts pins battleUnlocked.
    expect(HAND_WEIGHTS.handPips).toBeGreaterThan(0)
    expect(HAND_WEIGHTS.handTopCard).toBeGreaterThan(0)
    expect(WEIGHTS.handPips).toBe(0)
    expect(WEIGHTS.handTopCard).toBe(0)
  })
})

describe('the hand-quality bot', () => {
  it('keeps the 4-pip card and leads the middling one where a blind bot burns it', () => {
    /*
     * Seed 1 step 187, the first Lead/Pivot divergence — found by running the actual mutation
     * (both weights zeroed in `HAND_WEIGHTS`) and diffing `handBot`'s own choices across a
     * standard-driven game, the method levels.test.ts records after two proxy-built sweeps pinned
     * vacuous positions. Re-swept for the round-end discard fix (docs/22), which re-deals every
     * chapter-2+ hand.
     *
     * Yellow pivots with Aggression-4 and keeps Construction-4 in hand; the blind bot pivots with
     * the Construction-4, burning the 4-pip card for a one-action turn. The direction is the one
     * the original sweep found fifteen times over: spend the middle, keep the pips and the top
     * card.
     */
    let cur: RuleResult = startGame(
      { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
      registry,
    )
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 187; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, standardBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)
    expect(f).toBe('yellow')
    const decision = stepBot(cur, handBot, f!, registry, asked).decision
    expect(String(decision.action['label'])).toBe('Pivot with Aggression-4')
  })

  it('is deterministic: the same position decides the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, handBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, handBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })
})
