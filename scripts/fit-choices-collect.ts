/**
 * Collect *choices* rather than positions: two futures from one position, and what each was worth.
 *
 * ## Why this and not the position collector
 *
 * `fit-collect.ts` samples a position and records what that faction eventually scored. It learns
 * what **correlates** with winning, and sections 3f–3h measured where that leads: weapons fitted at
 * −1.59 because the players holding weapons are the ones in trouble, and a bot 46 points worse. No
 * amount of iterating or shrinking fixed it, because the confound is in the data, not the fit.
 *
 * This intervenes instead. At a decision, take two different candidate actions from the **same**
 * position, play each out, and record the difference in final power. Everything about the position —
 * who is ahead, how the chapter is going, which markers are out — is identical in both branches, so
 * it **cancels in the difference**. What is left is what the choice itself was worth.
 *
 * That is the whole point: a feature that merely marks being behind contributes equally to both
 * branches and drops out, while a feature that actually causes a better outcome does not.
 *
 * ## Common random numbers
 *
 * Both branches are played from the *same* derived generator, so the two futures differ by the
 * action and not by the dice. Without that, a pair's label is mostly a record of who rolled better,
 * and the signal drowns — the same variance-reduction argument the probe sampling uses (section 2k).
 */

import {
  advance,
  botToAct,
  defaultRegistry,
  featuresOf,
  heuristicBot,
  intentFor,
  observe,
  playoutChoice,
  startGame,
  stepBot,
  FEATURES,
  NO_ASKS,
} from '@arcs/engine'
import type { FactionId, RuleResult } from '@arcs/engine'

interface Job {
  readonly games: number
  readonly seed: number
  readonly board: string
  readonly factions: readonly string[]
  readonly shard: number
  readonly jobs: number
}

const job = JSON.parse(process.argv[2] ?? '{}') as Job
const reg = defaultRegistry()
const factions = job.factions as readonly FactionId[]

/** Decisions between sampled choices. Consecutive positions offer nearly the same choice. */
const SAMPLE_EVERY = 10
/** A playout that has not ended by here is stuck, and its label would be meaningless. */
const PLAYOUT_STEPS = 4_000
const MAX_STEPS = 20_000

/** Play to the end of the game with the light policy and report everyone's final power. */
function toEnd(from: RuleResult): Readonly<Partial<Record<FactionId, number>>> | undefined {
  let current = from
  for (let i = 0; i < PLAYOUT_STEPS; i++) {
    const c = current.continue
    if (c.kind !== 'ask') break
    try {
      current = advance(current.state, playoutChoice(c.actions), reg)
    } catch {
      return undefined
    }
  }
  // Only a finished game has an honest final score; a truncated one would label the pair wrongly.
  return current.continue.kind === 'gameOver' ? current.state.power : undefined
}

for (let g = job.shard; g < job.games; g += job.jobs) {
  let r = startGame(
    { board: job.board, factions: [...factions], seed: job.seed + g, bots: [...factions] },
    reg,
  )
  let asked = NO_ASKS

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const who = botToAct(r, factions)
    if (who === undefined) break
    const c = r.continue

    if (steps % SAMPLE_EVERY === 0 && c.kind === 'ask' && c.actions.length >= 2) {
      /*
       * Two candidates from the same position. The first and last on offer rather than a random
       * pair: they are the most likely to differ meaningfully, and picking deterministically keeps
       * the collection reproducible from the seed alone.
       */
      const a = c.actions[0]!
      const b = c.actions[c.actions.length - 1]!
      // One generator for both branches, so they differ by the action and not by the dice.
      const seeded = { ...r.state, rng: { seed: ((g + 1) * 0x9e3779b1 + steps * 0x85ebca77) >>> 0 } }

      try {
        const ra = advance(seeded, a, reg)
        const rb = advance(seeded, b, reg)
        const pa = toEnd(ra)
        const pb = toEnd(rb)
        if (pa !== undefined && pb !== undefined) {
          const oa = observe(ra.state, who)
          const ob = observe(rb.state, who)
          const xa = featuresOf(oa, who, intentFor(oa, who))
          const xb = featuresOf(ob, who, intentFor(ob, who))
          /*
           * Relative power, matching what `valueOf` actually computes — mine minus the best rival's.
           * Scoring the pair on absolute power would reward a branch that lifts everyone.
           */
          const rel = (p: Readonly<Partial<Record<FactionId, number>>>): number =>
            (p[who] ?? 0) -
            Math.max(0, ...factions.filter((f) => f !== who).map((f) => p[f] ?? 0))
          process.stdout.write(
            `${JSON.stringify({
              d: FEATURES.map((k) => xa[k] - xb[k]),
              y: rel(pa) - rel(pb),
            })}\n`,
          )
        }
      } catch {
        // A pair that will not apply is simply not collected.
      }
    }

    const step = stepBot(r, heuristicBot, who, reg, asked)
    r = step.result
    asked = step.asked
  }
}
