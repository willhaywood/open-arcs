/**
 * Cross-round foresight (`ForeseeOptions.rounds`, `replies.rounds` — search-v5).
 *
 * The reply drive historically stopped at the first return of control; `rounds: 2` plays through
 * the actor's own next turn (by the same reply policy) and the rivals' answer to it. Built for the
 * docs/19 section 18 game, where the winning card play's entire value lives in the next round —
 * initiative retained into a lead that declares Empath and consumes the last worthwhile marker —
 * and section 19 proved no end-of-turn feature can substitute.
 *
 * The pin here is the section 18 position itself, adjudicated by the section 17 oracle: at game 44
 * step 505 both `Pass` and `Lead Mobilization-5` roll out 12/12 wins for red and
 * `Lead Administration-4` rolls out 0/12 — so the assertion is "chooses an oracle-winning move",
 * not one specific label. Every configuration without the cross-round horizon prefers the 0/12
 * move by ~12 points, which is what the mutations below re-create.
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

/** The section 18 position: arena game 44, step 505, red (hard) to lead in chapter 5 round 4. */
function gamePosition(): { cur: RuleResult; asked: AskedThisTurn; f: FactionId } {
  const hard = searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 } })
  const seats = seatsForGame([hard, standardBot], TWO, 44)
  const seed = seedForGame(1, 44, TWO.length)
  let cur: RuleResult = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let step = 0; step < 505; step++) {
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
  it('corrects the section 18 blunder: an oracle-winning move over the 0/12 one', () => {
    /*
     * Adjudicated by rollout, not by taste: Pass and Lead Mobilization-5 both won 12 of 12
     * salted continuations from this position; Lead Administration-4 won 0 of 12 — yet every
     * same-horizon configuration prefers it by ~12 points (docs/19 sections 18-19). The
     * cross-round bot must pick one of the winning moves and rank the losing one below its pick.
     */
    const { cur, asked, f } = gamePosition()
    const v5 = searchBot({ width: 3, depth: 14, replies: { roots: 3, deals: 2, rounds: 2 } })
    const decision = stepBot(cur, v5, f, registry, asked).decision
    const label = String(decision.action['label'])
    expect(['Pass', 'Lead Mobilization-5']).toContain(label)
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
