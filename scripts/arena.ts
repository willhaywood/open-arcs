/**
 * Run the arena and print the table.
 *
 * A script rather than a test: it is slow, and its output is a number to read rather than an
 * assertion to satisfy. The fast seeded version that keeps this from rotting lives in
 * `test/arena.test.ts`.
 *
 *   npm run arena                                  # 8 games, heuristic against three trivial
 *   npm run arena -- --games 120 --jobs 8          # 120 games across 8 processes
 *   npm run arena -- --seats heuristic,rollout:4:2,trivial
 *   npm run arena -- --games 60 --noise            # add a twin of seat 1 to measure the noise floor
 *   npm run arena -- --seed 500 --verbose
 *
 * `--seats` takes bot ids in seat order and the arena rotates them between games, so every bot plays
 * every seat. Repeats are the point — three trivial against one heuristic is the baseline question.
 *
 * ## Why `--jobs`, and why `--noise` is not optional in practice
 *
 * The arena's first serious use showed it could not do its job. Two **identical** bot configurations,
 * 30 games with seats rotated, came out 20 points of win rate apart — so no difference smaller than
 * that means anything, and 30 games took ten minutes. Ranking bots needs hundreds of games, which at
 * that speed is hours.
 *
 * Games are completely independent and nothing large crosses a process boundary, so `--jobs` is the
 * cheapest possible fix: near-linear speedup, no engine changes, and identical results — shards pick
 * games *by index* using the same `seatsForGame`/`seedForGame` the serial path uses.
 *
 * `--noise` duplicates the first seat's bot under a second name. The gap between the twins is the
 * noise floor for that run, and any comparison not clearing it is not a result. It costs one seat.
 */

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'

import { defaultRegistry, formatReport, playGameAt, reportFrom } from '@arcs/engine'
import type { FactionId, GameOutcome } from '@arcs/engine'

import { buildBot, parseSpec } from './bot-spec.js'
import type { ArenaJob, BotSpec } from './bot-spec.js'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const games = Number(flag('games') ?? 8)
const seed = Number(flag('seed') ?? 1)
const verbose = argv.includes('--verbose')
const noise = argv.includes('--noise')
const jobs = Math.max(1, Number(flag('jobs') ?? 1))

const names = (flag('seats') ?? 'heuristic,trivial,trivial,trivial').split(',')
const specs: BotSpec[] = names.map(parseSpec)
const board = flag('board') ?? (specs.length === 3 ? 'Board3Frontiers' : 'Board4MixUp1')
const factions = (
  specs.length === 3 ? ['red', 'yellow', 'blue'] : ['red', 'yellow', 'blue', 'white']
) as FactionId[]

/*
 * The twin takes the last seat rather than being appended, so the seat count still matches the
 * board. Measuring the noise floor costs you an opponent, which is the honest trade.
 */
if (noise) specs[specs.length - 1] = specs[0]!

const bots = specs.map(buildBot)
/*
 * Ids must be distinct for the report to separate the twins, and only the twin is renamed — so the
 * table shows a bot beside a copy of itself and the gap between them is readable directly.
 */
const ids = bots.map((b, i) => (noise && i === specs.length - 1 ? `${b.id} [twin]` : b.id))
const labelled = bots.map((b, i) => ({ ...b, id: ids[i]! }))

console.log(
  `Arena: ${ids.join(' vs ')} — ${games} games from seed ${seed}` +
    ` on ${board}, ${jobs} job${jobs === 1 ? '' : 's'}` +
    (jobs > 1 ? ` (of ${availableParallelism()} cores)` : ''),
)
if (noise) console.log('Noise floor: the last two seats are the same bot; their gap is the floor.\n')
else console.log('')

const report = (outcomes: readonly GameOutcome[], ms: number): void => {
  console.log(`${verbose ? '\n' : ''}${formatReport(reportFrom(outcomes, ids, factions, ms))}`)
}

const show = (o: GameOutcome, i: number): void => {
  if (!verbose && o.finished) return
  // Unfinished games always print: they are the ones worth chasing, and silence would hide them.
  const who = o.winner === undefined ? '—' : `${o.winner} (${o.seats[o.winner] ?? '?'})`
  console.log(
    `  #${String(i + 1).padStart(4)} seed ${o.seed}  ${o.finished ? 'ok  ' : 'STOP'}  ` +
      `${o.actions} actions, ch${o.chapters}, winner ${who}${o.tied ? ' [tie-break]' : ''}`,
  )
}

const started = Date.now()

if (jobs === 1) {
  const registry = defaultRegistry()
  const outcomes: GameOutcome[] = []
  for (let i = 0; i < games; i++) {
    const o = playGameAt(labelled, i, { seed, board, factions }, registry)
    outcomes.push(o)
    show(o, i)
  }
  report(outcomes, Date.now() - started)
} else {
  /*
   * Outcomes are collected into a slot per game index rather than appended, so the report does not
   * depend on which shard finished first. A parallel run and a serial run of the same seed produce
   * the same table, which is the property that makes `--jobs` safe to use for real measurements.
   */
  const collected = new Array<GameOutcome | undefined>(games)
  let done = 0
  let failed = 0

  const finish = (): void => {
    const outcomes = collected.filter((o): o is GameOutcome => o !== undefined)
    if (outcomes.length < games) {
      console.log(`\n! ${games - outcomes.length} games produced no result (shard failure)`)
    }
    report(outcomes, Date.now() - started)
    process.exit(failed > 0 ? 1 : 0)
  }

  for (let shard = 0; shard < jobs; shard++) {
    const job: ArenaJob = {
      specs,
      ids,
      games,
      seed,
      board,
      factions,
      shard,
      jobs,
    }
    const child = spawn('npx', ['vite-node', 'scripts/arena-shard.ts', JSON.stringify(job)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      // Shards emit one JSON object per line; the last fragment may be incomplete.
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        const { index, outcome } = JSON.parse(line) as { index: number; outcome: GameOutcome }
        collected[index] = outcome
        show(outcome, index)
      }
    })

    child.on('exit', (code) => {
      if (code !== 0) failed++
      done++
      if (done === jobs) finish()
    })
  }
}
