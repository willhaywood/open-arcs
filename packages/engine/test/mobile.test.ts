/**
 * The shipped bot does not walk in circles.
 *
 * Movement was tie-broken by offer order (no feature reads ship positions), which walked fleets
 * A -> B -> A at 14% of all moves. `moveReversal` is the fix; this drives real games and counts
 * the exact waste the report named: a leg reversing one the same faction made this round. The
 * contrast case pins that the term, not luck, is what does it.
 */

import { describe, expect, it } from 'vitest'

import {
  NO_ASKS,
  botToAct,
  defaultRegistry,
  mobileBot,
  standardBot,
  startGame,
  stepBot,
} from '../src/index.js'
import type { Bot, FactionId, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const TWO: readonly FactionId[] = ['red', 'yellow']

/** Same-round A->B->A reversals over one driven game. */
function reversals(bot: Bot, seed: number, steps = 700): { moves: number; reversals: number } {
  let cur: RuleResult = startGame({ board: 'Board2Frontiers', factions: [...TWO], seed }, registry)
  let asked = NO_ASKS
  let round = cur.state.round
  const legs = new Map<string, Set<string>>()
  let moves = 0
  let undone = 0
  for (let i = 0; i < steps && cur.continue.kind === 'ask'; i++) {
    const f = botToAct(cur, TWO)
    if (f === undefined) break
    const s = stepBot(cur, bot, f, registry, asked)
    const a = s.decision.action
    if (cur.state.round !== round) {
      round = cur.state.round
      legs.clear()
    }
    if (a.type === 'action/move-pick') {
      moves++
      const set = legs.get(f) ?? new Set()
      if (set.has(`${a['to']}->${a['from']}`)) undone++
      set.add(`${a['from']}->${a['to']}`)
      legs.set(f, set)
    }
    cur = s.result
    asked = s.asked
  }
  return { moves, reversals: undone }
}

describe('purposeful movement', () => {
  it('the shipped bot never reverses its own leg within a round', () => {
    for (const seed of [1, 5, 9]) {
      const r = reversals(mobileBot, seed)
      expect(r.moves, `seed ${seed} actually moved`).toBeGreaterThan(0)
      expect(r.reversals, `seed ${seed}`).toBe(0)
    }
  })

  it('and the contrast holds: without the term, the same games do circle', () => {
    // Not vacuous — the old bot reverses on these seeds, so the zero above is the term working.
    const total = [1, 5, 9].reduce((n, seed) => n + reversals(standardBot, seed).reversals, 0)
    expect(total).toBeGreaterThan(0)
  })
})
