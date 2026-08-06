/**
 * What the bot is going for this chapter.
 *
 * docs/19 section 2b: a one-ply maximiser has no goals, and a full chapter played by the trivial
 * bot showed exactly what that costs — three of four factions declared Tycoon, none held the
 * Material to score it, and the chapter ended `{red:0, yellow:0, blue:0, white:0}`. Declaring
 * scored well *at that instant*; nothing carried the consequence forward.
 *
 * ## Derived, never remembered
 *
 * `intentFor` is a pure function of `ObservedState`, recomputed at every decision. It must be:
 *
 * - The journal holds actions, not the bot's mind. Remembered intent dies on reload, so a loaded
 *   game would silently play to a different plan than the one that produced its first half.
 * - In multiplayer any client may run a bot (docs/03 section 9a). Two clients with different
 *   remembered intent choose differently, and the game forks by who posted first.
 *
 * ## Why it does not flap
 *
 * Stability comes from the *inputs*, not from hysteresis bolted on afterwards. Intent reads only
 * slow-moving things — declared markers, what is still declarable, structural fitness, the clock.
 *
 * **It deliberately does not read the resources it is about to spend.** That is the subtle one: if
 * appetite for Tycoon rose with Material in hand, then spending Material mid-turn would lower it
 * mid-turn, and the bot would contradict itself between two actions of the same turn. Resources
 * feed the *value function*; structure feeds intent. That separation is what makes a memoryless
 * plan hold still.
 */

import { metric, rivalHoldings } from '../rules/ambitions.js'
import { AMBITIONS } from '../state.js'
import { Location, contentsOf, parseFigureId } from '../index.js'
import type { FactionId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { Ambition } from '../state.js'

export interface ChapterIntent {
  /** How hard each ambition is being contested, 0..1, summing to 1. */
  readonly pursuing: ReadonlyMap<Ambition, number>
  /** The strongest one, for narration and for quick tests. */
  readonly leading: Ambition
  /** One line, player-facing: "holding Material for Tycoon". */
  readonly summary: string
}

/** Power a marker pays for first place — the size of the prize. */
const payoutOf = (high: number): number => high

/**
 * How well set up this faction is to *win* an ambition, ignoring what it might buy this turn.
 *
 * Structural rather than material on purpose. Tycoon fitness is not "how much Material do I hold"
 * — that is the thing intent must not read — but "how many cities and slots do I have to keep
 * holding it with". Warlord and Tyrant are the exception: trophies and captives *are* the
 * structure, since they cannot be spent away.
 */
/**
 * How well a faction is set up to *win* an ambition, ignoring what it might buy this turn.
 *
 * A parameter rather than a fixed function so a stronger answer can be swapped in and measured
 * against this one — `heuristicBot` is the frozen baseline (docs/19 section 4) and changing this in
 * place would move the baseline along with the thing being compared to it.
 */
export type Fitness = (observed: ObservedState, self: FactionId, ambition: Ambition) => number

export const structuralFitness: Fitness = (observed, self, ambition) => {
  const mine = (piece: string): number =>
    observed.board.systems.reduce(
      (n, s) =>
        n +
        contentsOf(observed.figures, Location.system(s)).filter((id) => {
          const f = parseFigureId(id)
          return f.color === self && f.piece === piece
        }).length,
      0,
    )

  switch (ambition) {
    case 'Tycoon':
      // Cities tax, and taxing is where Material and Fuel come from.
      return 1 + mine('City') * 0.8 + mine('Starport') * 0.3
    case 'Keeper':
    case 'Empath':
      // Relics and Psionics come off specific planets, so reach matters more than buildings.
      return 1 + mine('City') * 0.5 + mine('Ship') * 0.15
    case 'Warlord':
    case 'Tyrant':
      /*
       * Trophies and captives are the one case where reading my own metric is safe: they cannot be
       * spent, so they do not move within my turn. (Warlord's Terror and Tyrant's Ego do return
       * one for an action — rare enough to accept, and it moves intent in the honest direction.)
       */
      return 1 + metric(observed, self, ambition) * 1.2 + mine('Ship') * 0.2
  }
}


/**
 * How strong the opposition is. 0 = clear run, approaching 1 = someone has it locked up.
 *
 * **Measured from rivals only, never relative to my own holdings** — and getting that wrong is what
 * the flap test caught. The first version was `(best − mine) / (best + mine + 1)`, which reads my
 * own Material for Tycoon, so *spending* Material raised the contest and lowered my appetite for
 * the very ambition I was spending it on, between two actions of the same turn.
 *
 * The precise requirement is that intent must not move across **my own** actions. Rivals' positions
 * do not change during my turn, so reading them is safe; reading mine is not. That is the whole
 * distinction, and it is why this takes the field's best rather than a difference.
 */
function contest(observed: ObservedState, self: FactionId, ambition: Ambition): number {
  // Includes the two-player phantom: a fixed pile of resources is still something to contest.
  const best = Math.max(0, ...rivalHoldings(observed, self, ambition))
  // Saturating rather than linear: the gap between 6 and 8 matters far less than 0 and 2.
  return best / (best + 4)
}

export function intentFor(
  observed: ObservedState,
  self: FactionId,
  fitness: Fitness = structuralFitness,
): ChapterIntent {
  const declared = new Map(observed.declared.map((d) => [d.ambition, d.marker]))
  const bestAvailable = Math.max(0, ...observed.ambitionable.map((m) => m.high))

  const raw = new Map<Ambition, number>()
  for (const a of AMBITIONS) {
    const marker = declared.get(a)
    /*
     * An undeclared ambition is worth what it *would* pay if declared, discounted — it is a
     * prospect, not a prize. Without the discount the bot chases every unclaimed ambition equally
     * and commits to none, which is the drift this exists to prevent.
     */
    const payout = marker === undefined ? bestAvailable * 0.5 : payoutOf(marker.high)
    if (payout <= 0) {
      raw.set(a, 0.01)
      continue
    }
    const appetite = payout * fitness(observed, self, a) * (1 - contest(observed, self, a))
    /*
     * Already declared *by anyone* is stickier: the marker is on the board, the payout is real, and
     * a chapter spent half-committed to something nobody declared scores nothing. This is the
     * hysteresis — from an input that does not flap, rather than from remembering last turn.
     *
     * **Untested, and knowingly so.** Removing this multiplier fails nothing: declaring already
     * changes the `payout` term above, so every test that looks like it covers stickiness is
     * actually detecting that. An isolating test needs a position where payout is equal and only
     * declaredness differs, and the first attempt at one passed for an unrelated reason — a test
     * that misdescribes itself is worse than none. Left as an untested weight for the arena to
     * judge (docs/19 section 2d.7), not as a claim that it is right.
     */
    raw.set(a, Math.max(0.01, appetite * (marker === undefined ? 1 : 1.4)))
  }

  const total = [...raw.values()].reduce((n, v) => n + v, 0)
  const pursuing = new Map<Ambition, number>()
  for (const [a, v] of raw) pursuing.set(a, v / total)

  const leading = [...pursuing.entries()].sort((x, y) => y[1] - x[1])[0]![0]
  return { pursuing, leading, summary: summarise(leading, pursuing.get(leading) ?? 0, declared) }
}

const HOLDING: Readonly<Record<Ambition, string>> = {
  Tycoon: 'Material and Fuel',
  Keeper: 'Relics',
  Empath: 'Psionics',
  Warlord: 'trophies',
  Tyrant: 'captives',
}

/** The narration seed. `because` lines build on this, so it is written for a player. */
function summarise(
  leading: Ambition,
  weight: number,
  declared: ReadonlyMap<Ambition, unknown>,
): string {
  const how = weight > 0.4 ? 'going hard for' : weight > 0.25 ? 'working toward' : 'leaning toward'
  const state = declared.has(leading) ? 'declared' : 'undeclared'
  return `${how} ${leading} (${state}) — ${HOLDING[leading]}`
}
