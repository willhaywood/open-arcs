/**
 * The beam-search bot (`search.ts`) and the `Explore` capability behind it (`play.ts`).
 *
 * Two regressions are pinned here because both actually happened while building this, and neither
 * is visible in a type or a crash:
 *
 *   - **A shared beam starved roots.** Pruning on intermediate value culled just-led cards — pure
 *     cost until their pips are spent — and the bot chose Pass on turn one, the exact pathology
 *     docs/19 section 2h fixed in V1. The per-root beam is what guarantees every candidate is
 *     judged at the settled horizon.
 *   - **Lines drowned in the arrange sub-flow.** Value-neutral swaps filled every beam to its depth
 *     cap, the pips were never reached, and every card scored as "played, bought nothing" — Pass
 *     again, from a different direction. The per-line cycle gate is V1's strictly-improving-repeat
 *     rule applied inside hypothetical lines, where `stepBot`'s turn history cannot see.
 */

import { describe, expect, it } from 'vitest'

import {
  botToAct,
  defaultRegistry,
  observe,
  rivalBot,
  searchBot,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { Bot, Explore, FactionId, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const opening = (seed: number): RuleResult =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry)

/** Capture the `Explore` the harness builds, by deciding once with a bot that only grabs it. */
function captureExplore(result: RuleResult): Explore {
  let captured: Explore | undefined
  const grabber: Bot = {
    id: 'grabber',
    decide(_o, actions, _l, _r, explore) {
      captured = explore
      return { action: actions[0]!, because: 'capturing explore' }
    },
  }
  stepBot(result, grabber, botToAct(result, THREE)!, registry)
  expect(captured).toBeDefined()
  return captured!
}

describe('the search bot', () => {
  it('plays a card on turn one, with every root searched to a terminal', () => {
    /*
     * The double regression test. Without per-root beams this position considered two roots and
     * chose Pass; without the cycle gate it considered all seven and still chose Pass, every card
     * line having burnt its depth on resource-slot swaps. Both fixes are needed for what a human
     * would call the obvious behaviour: open the game by playing a card.
     */
    const cur = opening(1)
    const f = botToAct(cur, THREE)!
    const d = stepBot(cur, searchBot(), f, registry, NO_ASKS).decision
    expect(d.action.type).not.toBe('turn/pass')
    // Every offered root reached a terminal and is on the diagnostic panel.
    const c = cur.continue
    expect(c.kind).toBe('ask')
    expect(d.considered?.length).toBe(c.kind === 'ask' ? c.actions.length : -1)
  })

  it('follows with a card where the arrange sub-flow used to drown every line', () => {
    /*
     * Seed 3, step 7: yellow's follow, and the position the cycle-gate bug was diagnosed on. The
     * Prelude offers "arrange your resource slots", whose value-neutral swaps are re-offered
     * forever; without the per-line gate every card line burnt its full depth swapping two tokens
     * and Pass won by default. Seed 1's opening has no arrange to drown in, which is why the
     * turn-one test above cannot catch the gate being dropped — this one exists to.
     */
    let cur = opening(3)
    let asked = NO_ASKS
    for (let i = 0; i < 7; i++) {
      const step = stepBot(cur, standardBot, botToAct(cur, THREE)!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)!
    expect(f).toBe('yellow')
    const d = stepBot(cur, searchBot(), f, registry, asked).decision
    expect(d.action.type).not.toBe('turn/pass')
  })

  it('diverges from standard where the searched line justifies it', () => {
    // Seed 3, first card play: standard leads Construction-2 off the flat pip price; the beam,
    // having actually played both turns out, leads Mobilization-4. Pinned so a silent fallback to
    // the delegate (which decides exactly like standard here) fails this test.
    const cur = opening(3)
    const f = botToAct(cur, THREE)!
    const std = stepBot(cur, standardBot, f, registry, NO_ASKS).decision
    const srch = stepBot(cur, searchBot(), f, registry, NO_ASKS).decision
    expect(String(std.action['label'])).toBe('Lead Construction-2')
    expect(String(srch.action['label'])).toBe('Lead Mobilization-4')
  })

  it('is deterministic: the same position searches to the same decision', () => {
    const cur = opening(2)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, searchBot(), f, registry, NO_ASKS).decision
    const b = stepBot(cur, searchBot(), f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
    expect(a.because).toBe(b.because)
    expect(a.considered?.map((c) => c.score)).toEqual(b.considered?.map((c) => c.score))
  })

  it('degrades to the delegate when the harness cannot explore', () => {
    const cur = opening(3)
    const f = botToAct(cur, THREE)!
    const c = cur.continue
    if (c.kind !== 'ask') throw new Error('expected an ask')
    // Called directly, with no explore and no lookahead — a caller like the arena's shard boundary
    // could look like this. A weaker bot, not a broken game: it must decide, and it must decide
    // the way its delegate would. `standardBot` IS the delegate's configuration by construction —
    // the same weights and fitness, rival intent off since the measurement went against it.
    const observed = observe(cur.state, f)
    const fell = searchBot().decide(observed, c.actions)
    const delegate = standardBot.decide(observed, c.actions)
    expect(JSON.stringify(fell.action)).toBe(JSON.stringify(delegate.action))
  })
})

describe('the Explore capability', () => {
  it('is a pure function of the path: cached prefixes change nothing', () => {
    const cur = opening(1)
    const c = cur.continue
    if (c.kind !== 'ask') throw new Error('expected an ask')
    const first = c.actions[0]!

    /*
     * The incremental walk (which reads cached prefixes) is compared against the same path built
     * in **one call on a fresh capture** (which advances every step itself and reads nothing).
     * The single call is the cache-free ground truth, and the difference matters: an off-by-one
     * that cached the *pre*-advance state under a path's key still returned correct answers from
     * every call that built its own prefix — the poison only surfaced when a later call re-read a
     * cached two-step entry. Comparing two identical walks missed it, because both drank from
     * identically poisoned caches.
     */
    const walked = captureExplore(cur)
    const a = walked([first])
    expect(a).toBeDefined()
    const second = a!.actions[0]!
    const b = walked([first, second])
    expect(b).toBeDefined()
    const third = b!.actions[0]!
    const incremental = walked([first, second, third])

    const direct = captureExplore(cur)([first, second, third])

    expect(JSON.stringify(incremental?.observed)).toBe(JSON.stringify(direct?.observed))
    expect(incremental?.prompt).toBe(direct?.prompt)
    expect(incremental?.actions.length).toBe(direct?.actions.length)
  })

  it('samples a line through randomness more than once', () => {
    // Drive with trivial play until an ask offers a battle roll, then explore through it.
    let cur = opening(1)
    for (let i = 0; i < 500; i++) {
      const c = cur.continue
      if (c.kind !== 'ask') break
      const roll = c.actions.find((a) => a.type === 'battle/roll')
      if (roll !== undefined) {
        const explore = captureExplore(cur)
        const probe = explore([roll])
        expect(probe).toBeDefined()
        expect(probe!.samples.length).toBeGreaterThan(1)
        return
      }
      const f = botToAct(cur, THREE)!
      cur = stepBot(cur, { id: 't', decide: (_o, a) => ({ action: a[0]!, because: '' }) }, f, registry).result
    }
    throw new Error('no battle roll reached in 500 trivial steps — fixture broke')
  })

  it('reports an inapplicable path as undefined, not as an error', () => {
    const cur = opening(1)
    const explore = captureExplore(cur)
    expect(explore([{ type: 'action/no-such-thing', faction: 'red' }])).toBeUndefined()
    expect(explore([])).toBeUndefined()
  })
})
