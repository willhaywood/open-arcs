/**
 * How the bot chooses a dice pool (`offerGather` ordering, and the interception risk premium).
 *
 * Reported from play: the bots do not always collect the maximum dice. Measured over 12 games, the
 * bot passed over a pool that was both **maximum and risk-free** in 10.9% of gather menus, left
 * 2.03 dice unused on average, and a third of those cases were exact ties.
 *
 * Two causes, and they need separate pins because either fix alone leaves the other in place:
 *
 *   - **Offer order decided the ties.** Every tie-break downstream keeps the earliest candidate, and
 *     `offerGather` enumerated smallest-first, so "one skirmish die" won whenever scoring could not
 *     separate the options. Pinned in `battle.test.ts`, which owns the menu.
 *   - **Interception is a tail event five samples cannot see.** It fires on any intercept face and
 *     then costs one hit per *fresh defending ship*, so it is rare and expensive — the shape that
 *     survives sampling badly. Pinned here, at a decision it flips.
 */

import { describe, expect, it } from 'vitest'

import { botToAct, defaultRegistry, standardBot, startGame } from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

describe('the dice pool the bot collects', () => {
  it('takes the whole fleet in skirmish over the same size in assault', () => {
    /*
     * Seed 1 step 43, the first gather ask of the game and the first decision the risk premium
     * flips — found by sweeping both versions over six seeds and diffing.
     *
     * Yellow can roll three dice. It took `1S 2A 0R` before and takes `3S 0A 0R` now: **the same
     * number of dice**, so this is not about pool size at all. It is the composition. Two assault
     * dice buy about 0.33 extra expected hits over two skirmish, and pay for them with one expected
     * self-hit — which since the p14 trophy fix goes to the *defender's* trophies — plus a 1-in-3
     * chance of interception costing a further hit per fresh defending ship.
     *
     * Pinning the step rather than "they differ somewhere" is what makes the risk term silently
     * dropping out fail *here*, rather than passing on some unrelated later disagreement.
     */
    let cur: RuleResult = startGame(
      { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
      registry,
    )
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 43; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, standardBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)
    expect(f).toBe('yellow')
    const decision = stepBot(cur, standardBot, f!, registry, asked).decision
    expect(String(decision.action['label'])).toBe('Roll 3S 0A 0R')
  })

  it('is deterministic: the same position collects the same pool twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, standardBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, standardBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })
})
