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
 * Last re-recorded when scoring Warlord or Tyrant began returning all trophies or captives, which
 * had never happened (rulebook 6.2.2 step 1, see `performScore`). All three seeds moved, and the
 * spread narrowed markedly — which is the point of the rule: those two ambitions no longer compound
 * for whoever led them first.
 */
/*
 * Regenerated for two rules fixes, both of which changed the **legal action set** rather than the
 * bot. The evaluator is untouched throughout — `weightsMatchBaseline` above still passes — which is
 * the exception the note describes rather than a redefinition of the frozen baseline.
 *
 *   - `offerTax` stopped offering a tax that provably could not do anything (exhausted supply, own
 *     city, no trait able to fire).
 *   - A *follower* stopped being offered Pass (rulebook p10: a follower must play a card; passing
 *     belongs to the initiative holder). Bots can no longer skip a turn for free, so cards get
 *     spent, which moves games the most of anything here.
 *
 * These numbers are for both together, recomputed after merging — neither branch's figures were
 * right for the combination. Values before either fix, for the record:
 * [11,30,33], [27,25,16], [27,25,28].
 */
/*
 * Re-recorded again for a third rules fix, same exception: **the defender takes destroyed attacking
 * pieces as Trophies** (rulebook p14, verbatim in both printings). Destroyed attacker ships were
 * going home to reserve, so a defender who wrecked a fleet by interception got nothing at all and
 * Warlord only ever paid the aggressor.
 *
 * The direction of the move is the confirmation that this is the rule and not a slip: the spread
 * collapses on every seed — [32,6,9] to [41,37,26], [7,35,17] to [26,35,37] — because losing a
 * battle now yields the loser's opponent something, and the runaway that trophies-for-attacking-only
 * produced is gone. Values before this fix:
 * [32,6,9], [55,20,17], [7,35,17].
 */
/*
 * Re-recorded for a **third category** the note above does not cover, and it is worth naming: this
 * time neither the evaluator nor the legal action set changed. `weightsMatchBaseline` still passes,
 * and `offerGather` offers exactly the pools it always did — only their *order* changed, plus a new
 * action-level risk term in `heuristic.ts` that sits outside `valueOf` the way `PIP_VALUE` does.
 *
 * What moved is **tie resolution**. Every tie-break downstream keeps the earliest candidate, and the
 * gather menu enumerated smallest-first, so "one skirmish die" won every tie the evaluator could not
 * separate — measured, a risk-free maximum was passed over in 10.9% of gather menus.
 *
 * Only seed 1 moved. Seeds 2 and 3 are byte-identical to the previous recording, which is the shape
 * you would expect from a change that touches battles and nothing else. Values before this fix:
 * [41,37,26], [15,20,38], [26,35,37].
 */
/*
 * Re-recorded for the court-audit rules fixes (docs/20 A1-A5, B1-B2): Gatekeepers' gate dice,
 * Relic Fence keeping itself, the Interests' Build riders, Farseers rebuilt, Call to Action's
 * draw source — the usual rules-fix exception; `weightsMatchBaseline` still passes. Only seed 3
 * moved this time. Values before: [32,33,2], [15,20,38], [26,35,37]; after the B2 Sworn
 * Guardians fix landed on the same branch, seed 3 moved again: [13,43,35] -> [13,43,23].
 */
/*
 * Re-recorded for the Leaders & Lore audit's base-rule fixes (docs/21 A1+A2): building needs
 * presence, not rule (7.2.1), and a piece built where anyone else rules arrives damaged (7.2.2).
 * Build options exist in every game, so all three seeds moved — the usual rules-fix exception;
 * `weightsMatchBaseline` still passes. Values before: [32,33,2], [15,20,38], [13,43,23].
 */
/*
 * Re-recorded for the round-end discard fix (docs/22): played cards are discarded at every round
 * end (5.4.1), a pass ends the round (5.1.2), and the chapter's undealt remainder goes to the
 * discard. All three seeds moved — every chapter-2+ deal changes, because the chapter reshuffle
 * now runs from the deck's canonical order rather than the cards' arrival order (the same change
 * that makes future pile refactors unable to move a deal again). The usual rules-fix exception;
 * `weightsMatchBaseline` still passes. Values before: [39,27,17], [28,27,24], [9,37,7].
 */
/*
 * Re-recorded for the raid-overflow rules fix — the usual rules-fix exception;
 * `weightsMatchBaseline` still passes. A raided resource stolen into a full row used to go
 * straight back to the supply ("no room, lost"); it now waits in overflow and the raider chooses
 * what to discard, like every other gain. Only seed 2 moved — the only golden game where a
 * baseline bot raided a resource with its own row full. Values before: [35,16,18], [41,9,23],
 * [21,18,37].
 */
const GOLDEN = [
  [35, 16, 18],
  [47, 13, 19],
  [21, 18, 37],
]
