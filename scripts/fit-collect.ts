/**
 * One shard of self-play data collection: play games, emit `(features, final power)` rows.
 *
 * Not run by hand — `scripts/fit-weights.ts` spawns these, the same way the arena spawns its shards
 * and for the same reason (a game is ~16s serially, and fitting wants hundreds).
 *
 * ## What a row is, and why the target is final power
 *
 * `valueOf`'s own docstring says every term is "power the faction can expect to end up with". That
 * is a claim nobody has ever checked, and it is also a **regression target**: sample a position, note
 * each faction's features, and when the game ends note what they actually scored. Fitting weights so
 * that `w · x` predicts final power makes the evaluator mean literally what it says it means.
 *
 * Fitting to *final power* rather than to win/loss matters for sample efficiency. A win/loss signal
 * gives one bit per game, which against the arena's measured noise floor is hopeless. Every sampled
 * position of every faction of every game is a training row, so a few hundred games gives tens of
 * thousands.
 *
 * Positions are sampled every `SAMPLE_EVERY` decisions rather than every decision: consecutive
 * positions are nearly identical and would just multiply near-duplicate rows.
 */

import {
  botToAct,
  defaultRegistry,
  featuresOf,
  heuristicBot,
  intentFor,
  observe,
  startGame,
  stepBot,
  FEATURES,
  NO_ASKS,
} from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

interface CollectJob {
  readonly games: number
  readonly seed: number
  readonly board: string
  readonly factions: readonly string[]
  readonly shard: number
  readonly jobs: number
}

const job = JSON.parse(process.argv[2] ?? '{}') as CollectJob
const reg = defaultRegistry()
const factions = job.factions as readonly FactionId[]

/** Decisions between samples. Consecutive positions barely differ, so sampling every one is waste. */
const SAMPLE_EVERY = 12
/** A game that has not ended by here is stuck; its rows would have no honest target. */
const MAX_STEPS = 20_000

for (let g = job.shard; g < job.games; g += job.jobs) {
  let r = startGame(
    { board: job.board, factions: [...factions], seed: job.seed + g, bots: [...factions] },
    reg,
  )
  let asked = NO_ASKS
  const rows: { f: FactionId; x: readonly number[] }[] = []

  let steps = 0
  for (; steps < MAX_STEPS; steps++) {
    const who = botToAct(r, factions)
    if (who === undefined) break
    if (steps % SAMPLE_EVERY === 0) {
      for (const f of factions) {
        const o = observe(r.state, f)
        const x = featuresOf(o, f, intentFor(o, f))
        rows.push({ f, x: FEATURES.map((k) => x[k]) })
      }
    }
    const step = stepBot(r, heuristicBot, who, reg, asked)
    r = step.result
    asked = step.asked
  }

  // Only finished games have an honest target: a stalled game never paid its ambitions.
  if (r.continue.kind !== 'gameOver') continue
  const finalPower = r.state.power
  for (const row of rows) {
    process.stdout.write(`${JSON.stringify({ x: row.x, y: finalPower[row.f] ?? 0 })}\n`)
  }
}
