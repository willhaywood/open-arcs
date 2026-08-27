/**
 * Bot actions as on-board events.
 *
 * The BotPanel used to narrate bot turns in prose beside the map; docs/19 section 2a's pacing
 * survives it, but the narration moved onto the board itself: each action a bot takes becomes a
 * `BotEvent`, and the surfaces draw it where it happened — a pulse on the system a ship landed
 * in, an arrow along a move, a flash on the court card that was influenced. This module is the
 * store-side half: the event record and the pure derivations the surfaces share.
 */

import type { Action, FactionId } from '@arcs/engine'

export interface BotEvent {
  /** Monotonic per session, so React keys and prune logic never collide. */
  readonly id: number
  readonly faction: FactionId
  readonly action: Action
  /** The `state.log` lines this one action appended — the engine's own prose for it. */
  readonly lines: readonly string[]
  /** `performance.now()` when the action was applied. */
  readonly at: number
}

/** How long an event's visuals live, in ms. The pace leaves most of this visible per action. */
export const EVENT_LIFE_MS = 2600

export interface Placement {
  readonly kind: 'pulse' | 'arrow' | 'battle'
  readonly system?: string
  readonly from?: string
  readonly to?: string
}

/** Action types whose system field points at a fight rather than a placement. */
const BATTLE_TYPES = /^(battle\/|rifles\/|action\/martyr$)/

/**
 * Where on the map an action happened, or `null` for actions with no board location.
 *
 * Deliberately generic: any action carrying `from` + `to` reads as a movement, and any action
 * carrying a system-shaped field (`system`, `at`, `to`) reads as something happening *there* —
 * builds, taxes, vox placements, `turn/gates-place`, `turn/ships-place` and reinforcements all
 * fall out of the field scan without being named. Court, ambition and card-play actions carry
 * none of these fields and return `null`; their surfaces flash instead (`liveFlash` below).
 */
export function derivePlacement(action: Action): Placement | null {
  const str = (k: string): string | undefined => {
    const v = action[k]
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const from = str('from')
  const to = str('to')
  // A movement names both ends; `from` alone (e.g. a Union's take) is not a map location pair.
  if (from !== undefined && to !== undefined && from.includes('-') && to.includes('-')) {
    return { kind: 'arrow', from, to }
  }
  const system = str('system') ?? str('at')
  if (system === undefined || !system.includes('-')) return null
  return { kind: BATTLE_TYPES.test(action.type) ? 'battle' : 'pulse', system }
}

/**
 * The one-line caption drawn beside the event: the engine's own first log line for the action
 * when there is one (they read like "blue built a Ship in 1-Hex"), else the action's label.
 */
export function caption(event: BotEvent): string {
  const line = event.lines[0]
  if (line !== undefined) return line
  const label = event.action['label']
  return typeof label === 'string' ? `${event.faction}: ${label}` : event.faction
}

/** Which court slot an event flashes, if any. */
export function courtFlashSlot(action: Action): number | undefined {
  if (action.type !== 'action/influence' && action.type !== 'action/secure' && action.type !== 'action/ransack') {
    return undefined
  }
  const slot = action['slot']
  return typeof slot === 'number' ? slot : undefined
}

/** Which ambition row an event flashes, if any. */
export function ambitionFlash(action: Action): string | undefined {
  if (
    action.type !== 'ambition/declare' &&
    action.type !== 'vox/populist' &&
    action.type !== 'turn/prelude-tycoon'
  ) {
    return undefined
  }
  const ambition = action['ambition']
  return typeof ambition === 'string' ? ambition : undefined
}

/** Which just-played action card an event flashes, if any. */
export function playedCardFlash(action: Action): string | undefined {
  if (
    action.type !== 'turn/lead' &&
    action.type !== 'turn/surpass' &&
    action.type !== 'turn/copy' &&
    action.type !== 'turn/pivot'
  ) {
    return undefined
  }
  const card = action['card']
  return typeof card === 'string' ? card : undefined
}

/** Events still worth drawing, newest last. */
export function liveEvents(events: readonly BotEvent[], now: number): BotEvent[] {
  return events.filter((e) => now - e.at < EVENT_LIFE_MS)
}

/**
 * The newest live event a surface should flash for, through its own picker
 * (`courtFlashSlot`, `ambitionFlash`, `playedCardFlash`).
 *
 * The `id` is part of the result so the surface can *key* the flashed element by it — a keyed
 * remount is what restarts the CSS animation when two consecutive events hit the same target.
 */
export function liveFlash<T>(
  events: readonly BotEvent[],
  now: number,
  pick: (action: Action) => T | undefined,
): { value: T; id: number } | undefined {
  for (const e of [...liveEvents(events, now)].reverse()) {
    const value = pick(e.action)
    if (value !== undefined) return { value, id: e.id }
  }
  return undefined
}
