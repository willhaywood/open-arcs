/**
 * Rivals scored under their own intent (`rival.ts`).
 *
 * Three layers, because each catches a mutation the others cannot:
 *
 *   - `valueOf` with `rivalIntent` must actually use it — caught by a position where a rival's own
 *     goals price their board higher than ours would.
 *   - The **default must not move**: `heuristicBot` shares this code path with the frozen baseline,
 *     and `baseline.test.ts` pins whole games, but the identity here names the cause directly when
 *     that starts failing.
 *   - The option must reach a **decision**. The first two pass with `heuristicBotWith` silently
 *     dropping `opts`, which is exactly the kind of wiring gap mutation testing keeps finding — so
 *     a real game position where `rivalBot` and `standardBot` choose differently is pinned.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  STANDARD_WEIGHTS,
  WEIGHTS,
  botToAct,
  contentsOf,
  defaultRegistry,
  feasibility,
  heuristicBotWith,
  intentFor,
  move,
  observe,
  playGameAt,
  rivalBot,
  standardBot,
  startGame,
  valueOf,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry).state

/** Yellow with a pile of trophies: their own intent leans Warlord; red's does not. */
function yellowWarlike(base: GameState): GameState {
  let s: GameState = {
    ...base,
    declared: [...base.declared, { ambition: 'Warlord', marker: { high: 6, low: 3 } }],
  }
  const spare = contentsOf(s.figures, Location.reserve('blue')).slice(0, 6)
  for (const id of spare) s = { ...s, figures: move(s.figures, id, Location.trophies('yellow')) }
  return s
}

describe('valueOf with rival intent', () => {
  it('prices a warlike rival higher under their own intent than under ours', () => {
    const s = yellowWarlike(fresh())
    const obs = observe(s, 'red')
    const red = intentFor(obs, 'red')
    /*
     * Red backs off a Warlord a rival has locked up (the contest term), so red's intent gives the
     * declared marker a low bias — and with it, yellow's trophies a low price. Yellow's own intent
     * leans into it. The rival-aware value must therefore be *lower* for red: the same board, with
     * the opponent's standing finally priced at what it is worth to them.
     */
    const one = valueOf(obs, 'red', red, WEIGHTS)
    const aware = valueOf(obs, 'red', red, WEIGHTS, (o, rival) => intentFor(o, rival))
    expect(aware).toBeLessThan(one)
  })

  it('reproduces the default exactly when the rival intent is our own', () => {
    // The identity that guards the frozen baseline: the parameter must be a pure widening.
    const s = yellowWarlike(fresh())
    const obs = observe(s, 'red')
    const red = intentFor(obs, 'red')
    expect(valueOf(obs, 'red', red, WEIGHTS, () => red)).toBe(valueOf(obs, 'red', red, WEIGHTS))
  })
})

describe('the rival-intent bot', () => {
  it('reaches a different decision than standard on a real position', () => {
    /*
     * Seed 1, step 187, found by sweeping full games for the first disagreement. Red declines to
     * declare under `standardBot` and declares Tycoon under `rivalBot` — seeing what the rivals are
     * going for is what makes the marker worth taking. Pinning the step (not just "they differ
     * somewhere") is what makes a silent `opts`-dropping regression fail here rather than pass on a
     * different disagreement.
     *
     * Re-swept whenever the legal action set moves, which it has five times now — the pin names a
     * point in a *driven game*, so this is maintenance rather than a surprise. The disagreement it
     * lands on has changed shape too: it used to be a tax, and after the dice-selection fix the
     * first divergence is a declaration.
     */
    let cur: RuleResult = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry)
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 187; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, standardBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)
    expect(f).toBe('red')
    const standard = stepBot(cur, standardBot, f!, registry, asked).decision
    const rival = stepBot(cur, rivalBot, f!, registry, asked).decision
    expect(String(standard.action['label'])).toContain('Do not declare')
    expect(String(rival.action['label'])).toContain('Declare Tycoon')
  })

  it('scores rivals under the RIVAL’s intent, not a recomputation of its own', () => {
    /*
     * The mutation the pinned test above cannot catch, found by running it: computing the *acting*
     * faction's intent inside the rival lambda — a one-token mistake — moves many of the same
     * decisions, because recomputing anyone's intent moves them. What distinguishes the two is a
     * position where the rival's own goals price their board differently from ours, and seed 1
     * step 79 is the first such divergence (found by sweeping): red declares under
     * rival-aware scoring, and skips the declaration under the wrong-faction variant.
     *
     * Re-swept whenever the legal action set moves — 311 -> 313 -> 171 -> 79 so far. The pin names a
     * point in a driven game, so this is maintenance rather than a surprise.
     */
    const wrongFaction = heuristicBotWith(STANDARD_WEIGHTS, 'wrong-faction', feasibility, {
      rivalIntent: (obs, _rival) => intentFor(obs, obs.self, feasibility),
    })
    let cur: RuleResult = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry)
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 79; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, rivalBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)
    expect(f).toBe('red')
    const right = stepBot(cur, rivalBot, f!, registry, asked).decision
    const wrong = stepBot(cur, wrongFaction, f!, registry, asked).decision
    expect(right.action.type).toBe('ambition/declare')
    expect(wrong.action.type).toBe('ambition/skip-declare')
  })

  it('finishes the game that livelocked under probed-state rival intents', () => {
    /*
     * Arena seed 245, game index 732 of the noise run: the first version of rival intent — intents
     * recomputed on each probed state — cycled Prelude → arrange → swap → Done for 20,000 actions,
     * because a value function that moves under each candidate breaks the strictly-improving-repeat
     * gate's termination argument, and because a rival's contest term reads *my* holdings, so my
     * own discards could shift their imputed intent (+0.018 for burning a Material). Per-decision
     * intents fixed both; this pins the game finishing, so any return of probed-state recomputation
     * fails loudly rather than as one unfinished arena game in a thousand.
     */
    const bots = [rivalBot, standardBot, { ...rivalBot, id: 'rival-intent [twin]' }]
    const o = playGameAt(
      bots,
      732,
      { seed: 1, board: 'Board3Frontiers', factions: [...THREE] },
      registry,
    )
    expect(o.seed).toBe(245)
    expect(o.finished, o.reason).toBe(true)
  })

  it('is deterministic: the same position decides the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, rivalBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, rivalBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
    expect(a.because).toBe(b.because)
  })
})
