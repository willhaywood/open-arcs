/**
 * Fit the evaluator's weights from self-play instead of arguing about them.
 *
 *   npm run fit -- --games 150 --jobs 12
 *   npm run fit -- --games 90 --jobs 12 --iterations 3
 *
 * ## Why fitting, and why not the arena
 *
 * Every weight in `WEIGHTS` was chosen by argument (docs/19 section 2d.7), and the arena — the only
 * thing entitled to judge them — has a measured noise floor of 12-21 points of win rate at 120 games
 * (section 3c). Tuning by "change a weight, run the arena" cannot work: one bit of signal per game
 * against that much noise.
 *
 * Regression uses a far richer signal. `valueOf`'s own docstring claims every term is "power the
 * faction can expect to end up with" — a testable claim *and* a training target. Sample a position,
 * record each faction's features, and when the game ends record what they actually scored. Every
 * sampled position of every faction is a row, so 150 games gives tens of thousands.
 *
 * ## Iteration, and the trap inside it
 *
 * `--iterations n` makes this policy iteration rather than a single regression: each round's games
 * are played with the previous round's weights. That is the textbook loop — evaluate the policy,
 * act greedily on the estimate, repeat — and it is also where it can come apart. The greedy step is
 * not guaranteed to improve anything when the value estimate is poor, and each round then learns
 * from worse play than the last. Round-by-round output is printed for exactly that reason, and every
 * round's weights are written so a run can be picked apart afterwards.
 *
 * ## What it does not settle
 *
 * A better predictor of the outcome under today's policy is not automatically a better guide to
 * action. The arena has the last word: `--seats heuristic:fitted`.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import { FEATURES } from '@arcs/engine'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const games = Number(flag('games') ?? 60)
const jobs = Math.max(1, Number(flag('jobs') ?? 8))
const seed = Number(flag('seed') ?? 10_000)
const ridge = Number(flag('ridge') ?? 1)
const out = flag('out') ?? 'packages/engine/src/ai/fitted-weights.json'
const iterations = Math.max(1, Number(flag('iterations') ?? 1))
const board = flag('board') ?? 'Board3Frontiers'
const factions = board.startsWith('Board3')
  ? ['red', 'yellow', 'blue']
  : ['red', 'yellow', 'blue', 'white']

const p = FEATURES.length

/**
 * Solve `A w = b` by Gaussian elimination with partial pivoting.
 *
 * Written out rather than pulled in: the engine has zero runtime dependencies and a 17x17 solve is
 * thirty lines. Partial pivoting is not optional — several features are near-collinear (fresh and
 * damaged ships move together), and without it the elimination divides by something near zero.
 */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r
    }
    const tmp = M[col]!
    M[col] = M[pivot]!
    M[pivot] = tmp
    const d = M[col]![col]!
    if (Math.abs(d) < 1e-12) continue
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r]![col]! / d
      if (factor === 0) continue
      for (let c = col; c <= n; c++) M[r]![c]! -= factor * M[col]![c]!
    }
  }
  return Array.from({ length: n }, (_, i) => {
    const d = M[i]![i]!
    return Math.abs(d) < 1e-12 ? 0 : M[i]![n]! / d
  })
}

interface Row {
  readonly x: readonly number[]
  readonly y: number
}

const collect = async (weights: Record<string, number> | undefined): Promise<Row[]> =>
  new Promise((resolve, reject) => {
    const rows: Row[] = []
    let done = 0
    let failed = 0
    for (let shard = 0; shard < jobs; shard++) {
      const job = {
        games,
        seed,
        board,
        factions,
        shard,
        jobs,
        ...(weights === undefined ? {} : { weights }),
      }
      const child = spawn('npx', ['vite-node', 'scripts/fit-collect.ts', JSON.stringify(job)], {
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      let buffer = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) if (line.trim() !== '') rows.push(JSON.parse(line) as Row)
      })
      child.on('exit', (code) => {
        if (code !== 0) failed++
        if (++done === jobs) {
          if (failed > 0) reject(new Error(`${failed} shards failed`))
          else resolve(rows)
        }
      })
    }
  })

/** One fit: standardise, ridge-regress through the normal equations, report held-out error. */
function fit(rows: readonly Row[]): {
  weights: Record<string, number>
  rmse: number
  base: number
} {
  /*
   * Held out by position in the stream, which is by *game* — a shard emits a game's rows together.
   * Rows from one game share a target and are heavily correlated, so a random split would leak the
   * answer across it and report a fit far better than it is.
   */
  const cut = Math.floor(rows.length * 0.8)
  const train = rows.slice(0, cut)
  const test = rows.slice(cut)

  /*
   * Standardised before fitting, because ridge penalises every weight equally while the raw features
   * are on wildly different scales — power reaches 30 where a court claim is a fraction. Unscaled,
   * the penalty would fall almost entirely on the small features.
   */
  const mean = Array.from(
    { length: p },
    (_, j) => train.reduce((n, r) => n + r.x[j]!, 0) / train.length,
  )
  const sd = Array.from({ length: p }, (_, j) => {
    const v = train.reduce((n, r) => n + (r.x[j]! - mean[j]!) ** 2, 0) / train.length
    // A feature that never varies carries no information; 1 leaves its fitted weight at zero.
    return Math.sqrt(v) < 1e-9 ? 1 : Math.sqrt(v)
  })
  const z = (r: Row): number[] => Array.from({ length: p }, (_, j) => (r.x[j]! - mean[j]!) / sd[j]!)

  // Normal equations with an intercept column, ridged on the slopes only.
  const A = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0))
  const b = new Array<number>(p + 1).fill(0)
  for (const r of train) {
    const v = [1, ...z(r)]
    for (let i = 0; i <= p; i++) {
      b[i]! += v[i]! * r.y
      for (let j = 0; j <= p; j++) A[i]![j]! += v[i]! * v[j]!
    }
  }
  for (let i = 1; i <= p; i++) A[i]![i]! += ridge

  const sol = solve(A, b)
  const intercept = sol[0]!
  const zw = sol.slice(1)

  const err = (set: readonly Row[]): number =>
    Math.sqrt(
      set.reduce((n, r) => {
        const pred = intercept + z(r).reduce((m, v, j) => m + v * zw[j]!, 0)
        return n + (pred - r.y) ** 2
      }, 0) / Math.max(1, set.length),
    )
  const m = test.reduce((n, r) => n + r.y, 0) / Math.max(1, test.length)
  const base = Math.sqrt(test.reduce((n, r) => n + (r.y - m) ** 2, 0) / Math.max(1, test.length))

  /*
   * Back out of standardised space, then drop the intercept: `valueOf` is *relative* — mine minus
   * the best opponent's — so any constant cancels.
   */
  return {
    weights: Object.fromEntries(FEATURES.map((f, j) => [f, zw[j]! / sd[j]!])),
    rmse: err(test),
    base,
  }
}

const started = Date.now()
let weights: Record<string, number> | undefined = undefined

for (let round = 1; round <= iterations; round++) {
  const playedBy = weights === undefined ? 'hand-set' : `round ${round - 1}`
  console.log(`\n--- round ${round}: ${games} self-play games played with the ${playedBy} weights`)
  const rows = await collect(weights)
  if (rows.length < p * 20) throw new Error(`too few rows (${rows.length}) to fit ${p} weights`)

  const result = fit(rows)
  weights = result.weights
  const r2 = 1 - (result.rmse / result.base) ** 2
  console.log(
    `  ${rows.length} rows   held-out RMSE ${result.rmse.toFixed(2)}` +
      `  (mean baseline ${result.base.toFixed(2)}, R2 ${r2.toFixed(3)})`,
  )
  for (const f of FEATURES) {
    console.log(`    ${f.padEnd(22)} ${(weights[f] ?? 0).toFixed(3).padStart(9)}`)
  }
  // Every round is kept, so a run that degrades can be picked apart rather than just discarded.
  writeFileSync(out.replace('.json', `-r${round}.json`), `${JSON.stringify(weights, null, 2)}\n`)
}

writeFileSync(out, `${JSON.stringify(weights, null, 2)}\n`)
console.log(`\nwritten to ${out} — total ${((Date.now() - started) / 1000).toFixed(0)}s`)
console.log('Fitting predicts the outcome; it does not prove better play. Ask the arena:')
console.log(
  '  npm run arena -- --games 120 --jobs 12 --seats heuristic:fitted,heuristic,heuristic --noise',
)
