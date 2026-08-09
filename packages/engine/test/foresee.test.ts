/**
 * `Foresee` — rivals' replies, honestly blind to their real hands.
 *
 * The load-bearing test here is the no-cheat property: two games differing ONLY in which hidden
 * cards the rivals hold must foresee **identical** replies. That is the whole contract — the reply
 * model plays sampled hands, so the truth cannot reach it — and it is exactly the property the
 * docs/19 section 2k dice fix established for randomness, arriving through cards. The mutation
 * "let rivals reply from their true hands" must fail it.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  botToAct,
  contentsOf,
  defaultRegistry,
  moveAll,
  observe,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { Action, Bot, FactionId, Foresee, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/**
 * Drive a real game to an ask at or past `minSteps` that offers `turn/pass`.
 *
 * A **lead** ask, in other words: passing belongs to the initiative holder, and a follower must
 * play a card (rulebook p10). These tests foresee through a pass because it is the shortest line
 * that genuinely hands play to the rivals — so the fixture has to seek the ask that offers one,
 * rather than any card play. Seeking "a card play" was enough while followers could also pass; the
 * moment that stopped, the fixture started landing on follow menus with nothing to pass with.
 */
function midGame(seed: number, minSteps: number): RuleResult {
  let cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < minSteps + 400; i++) {
    const c = cur.continue
    if (i >= minSteps && c.kind === 'ask' && c.actions.some((a) => a.type === 'turn/pass')) {
      return cur
    }
    const f = botToAct(cur, THREE)
    if (f === undefined) break
    const step = stepBot(cur, standardBot, f, registry, asked)
    cur = step.result
    asked = step.asked
  }
  throw new Error('no ask offering turn/pass reached — fixture broke')
}

/**
 * The path every test foresees through: `turn/pass`, which hands play on in one action.
 *
 * Load-bearing, and the first version got it wrong: a one-action *card* path lands on this
 * faction's own declare or Prelude ask, so the reply drive stopped before any rival moved and
 * every test passed vacuously — deals "agreed" because no sampled card was ever played. Passing
 * hands the ask straight to the next player, which is the shortest honest way to make the rivals
 * actually reply.
 */
function passPath(result: RuleResult): [Action] {
  const c = result.continue
  if (c.kind !== 'ask') throw new Error('expected an ask')
  const pass = c.actions.find((a) => a.type === 'turn/pass')
  if (pass === undefined) throw new Error('fixture must offer turn/pass')
  return [pass]
}

function captureForesee(result: RuleResult): { foresee: Foresee; faction: FactionId } {
  let captured: Foresee | undefined
  const grabber: Bot = {
    id: 'grabber',
    decide(_o, actions, _l, _r, _e, foresee) {
      captured = foresee
      return { action: actions[0]!, because: 'capturing foresee' }
    },
  }
  const faction = botToAct(result, THREE)!
  stepBot(result, grabber, faction, registry)
  expect(captured).toBeDefined()
  return { foresee: captured!, faction }
}

/**
 * Rearrange the hidden zones as thoroughly as the rules of the pool allow — every zone keeps its
 * exact size, and only cards this faction cannot see move.
 *
 * As thoroughly as possible, because subtler versions did not make the test bite: with the
 * no-cheat mutation applied (rivals replying from true hands), a single swapped card happened not
 * to change the rival's next play and the property passed by coincidence while the leak was live.
 * And the deck alone cannot absorb a whole hand — at three players 18 of 20 cards are dealt, so
 * the deck holds two for the entire chapter. So the shuffle here runs across BOTH rivals' hands
 * and the deck together: the same trade the real determinization makes, applied to the truth.
 */
function swapHiddenCards(state: GameState, self: FactionId): GameState {
  const rivals = state.factions.filter((f) => f !== self)
  const zones = [...rivals.map((r) => CardLocation.hand(r)), CardLocation.deck()]
  const sizes = zones.map((z) => contentsOf(state.cards, z).length)
  const pool = zones.flatMap((z) => [...contentsOf(state.cards, z)])
  expect(pool.length, 'there are hidden cards to rearrange').toBeGreaterThan(3)
  // Deterministic derangement-ish rotation: every card moves as far as the pool allows.
  const rotated = [...pool.slice(sizes[0]!), ...pool.slice(0, sizes[0]!)]
  let cards = state.cards
  let cursor = 0
  for (let i = 0; i < zones.length; i++) {
    cards = moveAll(cards, rotated.slice(cursor, cursor + sizes[i]!), zones[i]!)
    cursor += sizes[i]!
  }
  return { ...state, cards }
}

describe('foresee', () => {
  it('replies identically when only the rivals’ hidden cards differ — the no-cheat property', () => {
    const base = midGame(1, 40)
    const f = botToAct(base, THREE)!
    const altered: RuleResult = { ...base, state: swapHiddenCards(base.state, f) }

    const path = passPath(base)

    const a = captureForesee(base)
    const b = captureForesee(altered)
    const seen = a.foresee(path, { deals: 2 })
    const seenAltered = b.foresee(path, { deals: 2 })

    expect(seen.length).toBe(2)
    expect(JSON.stringify(seen)).toBe(JSON.stringify(seenAltered))
  })

  it('is deterministic: the same call twice, byte for byte', () => {
    const base = midGame(2, 40)
    const path = passPath(base)
    const one = captureForesee(base).foresee(path, { deals: 2 })
    const two = captureForesee(base).foresee(path, { deals: 2 })
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
  })

  it('lands back on self’s ask, or the game’s end', () => {
    const base = midGame(1, 40)
    const { foresee, faction } = captureForesee(base)
    for (const seen of foresee(passPath(base), { deals: 2 })) {
      // The reply drive stops when the ask returns to self (current === faction) or the game ends.
      expect(seen.isOver || seen.current === faction).toBe(true)
    }
  })

  it('deals differ from each other and from the truth’s replies being fixed', () => {
    /*
     * Two deals are two different imagined worlds — if they always agreed, the averaging in the
     * bot would be decoration and `deals: 1` would be an undetectable mutation. Positions after
     * replies from different sampled hands should differ at least sometimes; this seed was checked
     * to be such a case.
     */
    const base = midGame(1, 40)
    const { foresee } = captureForesee(base)
    const seen = foresee(passPath(base), { deals: 3 })
    expect(seen.length).toBe(3)
    const distinct = new Set(seen.map((s) => JSON.stringify(s)))
    expect(distinct.size, 'sampled worlds actually vary').toBeGreaterThan(1)
  })

  it('self’s own hand is never touched by the deal', () => {
    const base = midGame(2, 40)
    const { foresee, faction } = captureForesee(base)
    const before = observe(base.state, faction).hand
    // Passing plays no card, so the hand on the far side must be exactly a subset of what we held
    // — a sampled card appearing in OUR hand would mean the deal touched the wrong zone.
    for (const seen of foresee(passPath(base), { deals: 2 })) {
      for (const id of seen.hand) {
        expect(before.includes(id), `card ${id} appeared from nowhere`).toBe(true)
      }
    }
  })
})
