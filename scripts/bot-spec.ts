/**
 * A bot described as data, so it can cross a process boundary.
 *
 * The arena parallelises by running shards in separate processes, and a `Bot` cannot be sent to one
 * — it is a closure over its options. A spec can: it is JSON, it names everything that affects play,
 * and both sides build the same bot from it.
 *
 * Keeping the id derived from the spec rather than passed alongside it is what stops the two
 * drifting: a run whose worker built `rollout(4x2)` and whose report said `rollout(4x0)` would be
 * measuring one thing and printing another, and nothing downstream could tell.
 */

import { heuristicBot, rolloutBot, trivialBot } from '@arcs/engine'
import type { Bot } from '@arcs/engine'

export type BotSpec =
  | { readonly kind: 'trivial' }
  | { readonly kind: 'heuristic' }
  | {
      readonly kind: 'rollout'
      readonly samples: number
      readonly lookaheadTurns: number
      readonly maxSteps: number
    }

export function buildBot(spec: BotSpec): Bot {
  switch (spec.kind) {
    case 'trivial':
      return trivialBot
    case 'heuristic':
      return heuristicBot
    case 'rollout':
      return rolloutBot({
        samples: spec.samples,
        lookaheadTurns: spec.lookaheadTurns,
        maxSteps: spec.maxSteps,
      })
  }
}

/** Parse a `--seats` entry: `trivial`, `heuristic`, or `rollout[:samples:turns]`. */
export function parseSpec(name: string): BotSpec {
  const [kind, ...rest] = name.trim().split(':')
  if (kind === 'trivial') return { kind: 'trivial' }
  if (kind === 'heuristic') return { kind: 'heuristic' }
  if (kind === 'rollout') {
    return {
      kind: 'rollout',
      samples: Number(rest[0] ?? 4),
      lookaheadTurns: Number(rest[1] ?? 2),
      maxSteps: Number(rest[2] ?? 400),
    }
  }
  throw new Error(`Unknown bot "${name}" — known: trivial, heuristic, rollout[:samples:turns]`)
}

/**
 * Everything a shard needs to play its games, and the parent needs to aggregate them.
 *
 * Sent as one JSON argument. Small by construction — the whole point of parallelising *games* rather
 * than decisions is that nothing large has to cross the boundary.
 */
export interface ArenaJob {
  readonly specs: readonly BotSpec[]
  /**
   * The id to report each seat's bot under, in seat order.
   *
   * Sent explicitly rather than derived, because two seats can hold the *same* configuration under
   * different names — which is exactly how the noise floor is measured. Leaving the shard to derive
   * ids from specs gave both twins the same name, so one row of the table showed 0 games and the
   * other silently double-counted. The parent and the shard must agree on names, so the parent says.
   */
  readonly ids: readonly string[]
  readonly games: number
  readonly seed: number
  readonly board: string
  readonly factions: readonly string[]
  readonly stuckAfter?: number
  /** Which games this shard plays: indices `shard`, `shard + jobs`, `shard + 2*jobs`, … */
  readonly shard: number
  readonly jobs: number
}
