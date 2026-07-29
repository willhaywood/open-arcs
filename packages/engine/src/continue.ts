/**
 * What a rule returns. Rules never mutate and return a value — they return the next step.
 *
 * This is the vocabulary the whole engine is built on, so it is closed and small.
 * `multiAsk` is included from the first commit even though nothing emits it yet: summits
 * need simultaneous decisions, and widening the return type of every rule later is a wide
 * error-prone change. See docs/04-scope-and-phasing.md section 2.6.
 */

import type { Action } from './action.js'
import type { FactionId } from './ids.js'

export interface Ask {
  readonly kind: 'ask'
  readonly faction: FactionId
  readonly actions: readonly Action[]
  readonly prompt?: string
}

/** Simultaneous decisions by several factions. Phase 2 (summits). */
export interface MultiAsk {
  readonly kind: 'multiAsk'
  readonly asks: readonly Ask[]
}

export interface Then {
  readonly kind: 'then'
  readonly action: Action
}

/** A checkpoint boundary — a natural place to snapshot or stop a rollout. */
export interface Milestone {
  readonly kind: 'milestone'
  readonly action: Action
  readonly label: string
}

export interface Log {
  readonly kind: 'log'
  readonly message: string
  readonly then: Continue
}

export interface GameOver {
  readonly kind: 'gameOver'
  readonly winners: readonly FactionId[]
  readonly reason: string
}

/** "Not my rule" — the dispatcher moves to the next module in the chain. */
export interface Unhandled {
  readonly kind: 'unhandled'
}

export type Continue = Ask | MultiAsk | Then | Milestone | Log | GameOver | Unhandled

export const Continue = {
  ask: (faction: FactionId, actions: readonly Action[], prompt?: string): Ask =>
    prompt === undefined ? { kind: 'ask', faction, actions } : { kind: 'ask', faction, actions, prompt },
  multiAsk: (asks: readonly Ask[]): MultiAsk => ({ kind: 'multiAsk', asks }),
  then: (action: Action): Then => ({ kind: 'then', action }),
  milestone: (label: string, action: Action): Milestone => ({ kind: 'milestone', action, label }),
  log: (message: string, then: Continue): Log => ({ kind: 'log', message, then }),
  gameOver: (winners: readonly FactionId[], reason: string): GameOver => ({
    kind: 'gameOver',
    winners,
    reason,
  }),
  unhandled: (): Unhandled => ({ kind: 'unhandled' }),
} as const

export const UNHANDLED: Unhandled = { kind: 'unhandled' }

/** True when the engine is waiting on a decision rather than able to step itself. */
export function isWaiting(c: Continue): c is Ask | MultiAsk {
  return c.kind === 'ask' || c.kind === 'multiAsk'
}

export function isTerminal(c: Continue): c is GameOver {
  return c.kind === 'gameOver'
}
