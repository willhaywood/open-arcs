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

import {
  Location,
  RuleRegistry,
  advance,
  botToAct,
  contentsOf,
  defaultRegistry,
  move,
  parseFigureId,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { ColorId, FactionId, Piece, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/**
 * Seed 1 step 43 — yellow's first gather ask, three ships on blue's two in 1-Arrow — with two
 * more yellow ships, a third blue ship and a blue City brought in from reserve, and the menu
 * reopened. Five dice with raid dice allowed is 55 pools whose rolls need several hit phases and a
 * raid, which is what a shared answer has to get right.
 */
function reinforcedGather(): { cur: RuleResult; asked: AskedThisTurn } {
  let cur: RuleResult = startGame(
    { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
    registry,
  )
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < 43; i++) {
    const step = stepBot(cur, standardBot, botToAct(cur, THREE)!, registry, asked)
    cur = step.result
    asked = step.asked
  }
  const roll = cur.continue.kind === 'ask' ? cur.continue.actions[0]! : undefined
  expect(roll?.type).toBe('battle/roll')
  const from = (color: ColorId, piece: Piece, n: number): string[] =>
    contentsOf(cur.state.figures, Location.reserve(color))
      .filter((id) => parseFigureId(id).piece === piece)
      .slice(0, n)
  const arriving = [
    ...from('yellow', 'Ship', 2),
    ...from('blue', 'Ship', 1),
    ...from('blue', 'City', 1),
  ]
  let figures = cur.state.figures
  for (const id of arriving) figures = move(figures, id, Location.system(String(roll!['system'])))
  const { faction, system, enemy, then } = roll!
  const reopen = { type: 'battle/target', faction, system, enemy, then }
  return { cur: advance({ ...cur.state, figures }, reopen, registry), asked }
}

/**
 * The default rules, counting the hits any probe assigns. With `unshared`, every roll also swaps
 * the damaged list for an equal copy. No bot can tell, and it stops `settle` sharing a battle's
 * resolution: the first shared ask must hold the decision's own board, object for object.
 */
function countingRegistry(unshared: boolean): { registry: RuleRegistry; hits: () => number } {
  let hits = 0
  const inner = defaultRegistry()
  const counting = new RuleRegistry()
  for (const id of inner.ids()) {
    const module = inner.get(id)
    counting.register({
      id,
      perform: (state, action) => {
        if (action.type === 'battle/hit') hits++
        const out = module.perform(state, action)
        const rolled = action.type === 'battle/roll' && out.continue.kind !== 'unhandled'
        if (!unshared || !rolled) return out
        return { ...out, state: { ...out.state, damaged: [...out.state.damaged] } }
      },
    })
  }
  return { registry: counting, hits: () => hits }
}

describe('the dice pool the bot collects', () => {
  it('shares hit assignments across pools and samples without changing a score', () => {
    /*
     * The pin on `BattleMemo` in `play.ts`. Every pool on a dice menu is probed five times and
     * every sample's hits are assigned through the bot, so a large menu took 20 s; sharing the
     * answers between samples that need the same one is what made it fast, and it is only worth
     * having if no candidate's score moves. Both halves are asserted: the scores match the unshared
     * run exactly, and the shared run really did assign fewer hits.
     */
    const { cur, asked } = reinforcedGather()
    const shared = countingRegistry(false)
    const unshared = countingRegistry(true)
    const a = stepBot(cur, standardBot, 'yellow', shared.registry, asked).decision
    const b = stepBot(cur, standardBot, 'yellow', unshared.registry, asked).decision

    expect(a.considered).toHaveLength(55)
    expect(a.considered?.map((c) => [c.action['label'], c.score])).toEqual(
      b.considered?.map((c) => [c.action['label'], c.score]),
    )
    expect(a.action).toBe(b.action)
    expect(shared.hits()).toBeLessThan(unshared.hits() / 2)
  })

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
