/**
 * Cross-round foresight (`ForeseeOptions.rounds`, `replies.rounds` — search-v5).
 *
 * The reply drive historically stopped at the first return of control; `rounds: 2` plays through
 * the actor's own next turn (by the same reply policy) and the rivals' answer to it. Built for the
 * docs/19 section 18 game, where the winning card play's entire value lives in the next round —
 * initiative retained into a lead that declares Empath and consumes the last worthwhile marker —
 * and section 19 proved no end-of-turn feature can substitute.
 *
 * The pin here was the section 18 position itself, adjudicated by the section 17 oracle: at game
 * 44 step 505, `Pass` and `Lead Mobilization-5` rolled out 12/12 for red and
 * `Lead Administration-4` 0/12, with every same-horizon configuration preferring the 0/12 move.
 *
 * **Re-derived twice since.** The docs/21 A1+A2 build rules and then the docs/22 round-end
 * discard fix each re-dealt every driven game, so the historical position is unreachable. The
 * same 12-salted-rollout oracle re-adjudicated every late red lead menu in the current drive: the
 * game now resolves early — one chapter-4 menu is lost whatever red leads (all 0-1/12), the
 * rest are won whatever red leads (12/12) — and the least vacuous is **step 429, chapter 4**,
 * where `Lead Mobilization-2` and `Lead Administration-4` roll out 12/12 and `Pass` 11/12. The
 * plain-horizon bot also picks a winning move there, so the original v4-blunder contrast no
 * longer reproduces in this game — the feature's discriminating evidence stays in docs/19
 * sections 18-19; this test is its regression floor: the shipped cross-round bot must keep
 * choosing an oracle-winning move.
 */

import { describe, expect, it } from 'vitest'

import {
  botToAct,
  defaultRegistry,
  searchBot,
  seatsForGame,
  seedForGame,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const TWO: readonly FactionId[] = ['red', 'yellow']

/** The re-derived oracle position: arena game 44, step 429, red (hard) to lead in chapter 4. */
function gamePosition(): { cur: RuleResult; asked: AskedThisTurn; f: FactionId } {
  const hard = searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 } })
  const seats = seatsForGame([hard, standardBot], TWO, 44)
  const seed = seedForGame(1, 44, TWO.length)
  let cur: RuleResult = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let step = 0; step < 429; step++) {
    const f = botToAct(cur, TWO)
    expect(f, `the drive reached step ${step} with a bot to act`).toBeDefined()
    const s = stepBot(cur, (seats as never as Record<FactionId, typeof hard>)[f!], f!, registry, asked)
    cur = s.result
    asked = s.asked
  }
  const f = botToAct(cur, TWO)
  expect(f).toBe('red')
  return { cur, asked, f: f! }
}

describe('rounds defaults to the reply horizon', () => {
  it('an explicit rounds: 1 is the same bot as no rounds at all', () => {
    /*
     * Behaviour preservation beyond the untouched suite: `rounds: 1` must be byte-identical to
     * the pre-`rounds` v4, id included, so no shipped configuration moved.
     */
    const a = searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 } })
    const b = searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1, rounds: 1 } })
    expect(b.id).toBe(a.id)
    const cur = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed: 3 }, registry)
    const f = botToAct(cur, TWO)!
    const da = stepBot(cur, a, f, registry, NO_ASKS).decision
    const db = stepBot(cur, b, f, registry, NO_ASKS).decision
    expect(JSON.stringify(db.action)).toBe(JSON.stringify(da.action))
  })
})

describe('the cross-round horizon', () => {
  it('chooses the oracle-winning lead at the re-derived game-44 position', () => {
    /*
     * Adjudicated by rollout, not by taste: from this position `Lead Mobilization-2` and
     * `Lead Administration-4` each won 12 of 12 salted standard-bot continuations and `Pass`
     * 11 of 12 (re-run for docs/22 — see the file docstring). The shipped cross-round bot must
     * keep picking one of the oracle-winning moves.
     */
    const { cur, asked, f } = gamePosition()
    const v5 = searchBot({ width: 3, depth: 14, replies: { roots: 3, deals: 2, rounds: 2 } })
    const decision = stepBot(cur, v5, f, registry, asked).decision
    expect(['Lead Mobilization-2', 'Lead Administration-4']).toContain(String(decision.action['label']))
  })

  it('is deterministic: the same position decides the same way twice', () => {
    const cur = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed: 2 }, registry)
    const f = botToAct(cur, TWO)!
    const v5 = searchBot({ width: 3, depth: 14, replies: { roots: 3, deals: 2, rounds: 2 } })
    const a = stepBot(cur, v5, f, registry, NO_ASKS).decision
    const b = stepBot(cur, v5, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })
})
