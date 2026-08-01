/**
 * The golden game: proof that the frozen baseline has not drifted.
 *
 * `baselineBot` exists so every later change has something to be measured against (docs/19 section
 * 4). That only works if it genuinely does not move — and it shares its whole code path with
 * `heuristicBot`, so a change to `featuresOf`, `intentFor`, `settle` or the decision loop would
 * silently change the baseline along with the thing under test, and the comparison would quietly
 * become meaningless rather than failing.
 *
 * So the baseline is pinned by its *behaviour*: fixed seeds, exact outcomes. Any change to the
 * shared evaluator fails here and names itself, which is the moment to decide whether the change is
 * an improvement worth a **new** bot or an accident worth reverting. Updating these numbers is
 * therefore never routine — it means the frozen baseline has been redefined, and the old one is gone.
 */

import { describe, expect, it } from 'vitest'

import {
  BASELINE_WEIGHTS,
  baselineBot,
  defaultRegistry,
  playGameAt,
  weightsMatchBaseline,
} from '../src/index.js'
import type { FactionId } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

describe('the frozen baseline', () => {
  it('still holds the weights it was frozen with', () => {
    // A cheap, direct check that reports the *cause* when the golden games below start failing.
    expect(weightsMatchBaseline()).toBe(true)
    expect(BASELINE_WEIGHTS.cities).toBe(2.0)
  })

  it('plays fixed seeds to exactly the same outcomes', () => {
    /*
     * Three *distinct* seeds. Game indices 0, 3 and 6 rather than 0, 1 and 2 because seeds are held
     * across a rotation (section 3c) — consecutive indices are the same board with the seats
     * shuffled, and with three identical bots that is literally the same game, so it would triple
     * the runtime and add no coverage.
     *
     * Asserted on final power per faction: a whole game's play reduced to three numbers, and nothing
     * meaningful can change in the evaluator without moving them.
     */
    const bots = [baselineBot, baselineBot, baselineBot]
    const outcomes = [0, 3, 6].map((i) =>
      playGameAt(bots, i, { seed: 1, board: 'Board3Frontiers', factions: THREE }, registry),
    )

    for (const o of outcomes) expect(o.finished).toBe(true)

    /*
     * If these numbers need changing, the baseline has been redefined and the previous one no longer
     * exists to measure against — which is a decision, not a maintenance chore.
     */
    expect(outcomes.map((o) => THREE.map((f) => o.power[f] ?? 0))).toEqual(GOLDEN)
  })
})

/**
 * Final power for red, yellow, blue on seeds 1, 2 and 3, played by three copies of the baseline.
 *
 * See the note at the top before editing: changing these normally redefines the frozen baseline, and
 * the one being replaced no longer exists to measure anything against.
 *
 * The exception is a **rules** fix, where the bot has not changed but the game it is playing has.
 * `weightsMatchBaseline` above still passing is what tells the two cases apart: if the weights are
 * intact and these numbers moved, the evaluator is untouched and the board underneath it was wrong.
 * Re-recording is then the only option — the previous numbers pinned the bug.
 *
 * Last re-recorded when secured Guild cards began scoring toward Tycoon, Keeper and Empath, which
 * they had never done (see `metric`). Seed 1 is unchanged; seeds 2 and 3 moved.
 */
const GOLDEN = [
  [11, 43, 5],
  [24, 37, 39],
  [20, 28, 50],
]
