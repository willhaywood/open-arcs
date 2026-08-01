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

import { baselineBot, feasibilityBot, goalBot, heuristicBot, heuristicBotWith, rolloutBot, trivialBot } from '@arcs/engine'
import type { Bot, Weights } from '@arcs/engine'

import { readFileSync } from 'node:fs'

/** Where `npm run fit` writes, and what `heuristic:fitted` reads. */
const FITTED = 'packages/engine/src/ai/fitted-weights.json'

export type BotSpec =
  | { readonly kind: 'trivial' }
  | { readonly kind: 'baseline' }
  | { readonly kind: 'goal' }
  | { readonly kind: 'feasible' }
  | {
      readonly kind: 'heuristic'
      /** Evaluator weights; omitted means the hand-set ones. Sent as data so a shard can rebuild it. */
      readonly weights?: Readonly<Record<string, number>>
    }
  | {
      readonly kind: 'rollout'
      readonly samples: number
      readonly lookaheadTurns: number
      readonly maxSteps: number
      readonly untilChapterEnd?: boolean
    }

export function buildBot(spec: BotSpec): Bot {
  switch (spec.kind) {
    case 'baseline':
      return baselineBot
    case 'goal':
      return goalBot
    case 'feasible':
      return feasibilityBot
    case 'trivial':
      return trivialBot
    case 'heuristic':
      return spec.weights === undefined
        ? heuristicBot
        : heuristicBotWith(spec.weights as Weights, 'heuristic-fitted')
    case 'rollout':
      return rolloutBot({
        samples: spec.samples,
        lookaheadTurns: spec.lookaheadTurns,
        maxSteps: spec.maxSteps,
        ...(spec.untilChapterEnd === true ? { untilChapterEnd: true } : {}),
      })
  }
}

/** Parse a `--seats` entry: `trivial`, `heuristic`, `rollout[:samples:turns]`, `rollout:4:chapter`. */
export function parseSpec(name: string): BotSpec {
  const [kind, ...rest] = name.trim().split(':')
  if (kind === 'trivial') return { kind: 'trivial' }
  if (kind === 'baseline') return { kind: 'baseline' }
  if (kind === 'goal') return { kind: 'goal' }
  if (kind === 'feasible') return { kind: 'feasible' }
  if (kind === 'heuristic') {
    // `heuristic:fitted` plays the weights `npm run fit` last wrote.
    if (rest[0] !== 'fitted') return { kind: 'heuristic' }
    /*
     * Generated rather than committed, so this fails loudly when it is missing. Every fitted set
     * measured so far plays worse than the hand-set weights (docs/19 sections 3f-3i), which is why
     * one is not kept in the tree: it would read as a recommendation.
     */
    try {
      return {
        kind: 'heuristic',
        weights: JSON.parse(readFileSync(FITTED, 'utf8')) as Record<string, number>,
      }
    } catch {
      throw new Error(`No fitted weights at ${FITTED} — run \`npm run fit\` first.`)
    }
  }
  if (kind === 'rollout') {
    // `rollout:4:chapter` plays each sample to the end of the chapter instead of counting turns.
    const chapter = rest[1] === 'chapter'
    return {
      kind: 'rollout',
      samples: Number(rest[0] ?? 4),
      lookaheadTurns: chapter ? 0 : Number(rest[1] ?? 2),
      maxSteps: Number(rest[2] ?? (chapter ? 1200 : 400)),
      ...(chapter ? { untilChapterEnd: true } : {}),
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
