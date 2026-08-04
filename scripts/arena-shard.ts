/**
 * One shard of a parallel arena run: play a slice of the games, print each outcome as JSON.
 *
 * Not meant to be run by hand — `scripts/arena.ts` spawns these. It exists as a separate process
 * rather than a worker thread because the scripts are TypeScript run through `vite-node`, and a
 * `worker_threads` worker would need its own TS pipeline. A process boundary needs none, and the
 * data crossing it is a few hundred bytes per game either way.
 *
 * **Games are picked by index, not by a private counter** — shard `k` of `n` plays games
 * `k, k+n, k+2n, …`. Interleaving rather than splitting into blocks keeps the shards balanced when
 * game length varies, and picking by index is what makes a parallel run play *exactly* the same
 * games as a serial one: `seatsForGame` and `seedForGame` are shared with `runArena`, so game 7 is
 * the same matchup on the same seed whoever plays it.
 */

import { defaultRegistry, playGameAt } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'

import { buildBot } from './bot-spec.js'
import type { ArenaJob } from './bot-spec.js'

const job = JSON.parse(process.argv[2] ?? '{}') as ArenaJob
const registry = defaultRegistry()
/*
 * Ids come from the job, not from the spec: two seats may run the same configuration under
 * different names (the noise floor), and `playGame` records seats by `bot.id`.
 */
const bots = job.specs.map((spec, i) => ({ ...buildBot(spec), id: job.ids[i] ?? buildBot(spec).id }))
const factions = job.factions as readonly FactionId[]

for (let i = job.shard; i < job.games; i += job.jobs) {
  const outcome = playGameAt(
    bots,
    i,
    {
      seed: job.seed,
      board: job.board,
      factions,
      ...(job.stuckAfter === undefined ? {} : { stuckAfter: job.stuckAfter }),
      ...(job.leadersAndLore === undefined ? {} : { leadersAndLore: job.leadersAndLore }),
    },
    registry,
  )
  // One line per game, so the parent can stream them rather than wait for the shard to finish.
  process.stdout.write(`${JSON.stringify({ index: i, outcome })}\n`)
}
