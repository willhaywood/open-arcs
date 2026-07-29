/**
 * The rule chain and its dispatcher.
 *
 * A rule module is a pure function from (state, action) to (state, Continue). The
 * dispatcher walks the chain in order and the first module that does not return
 * `unhandled` wins. That is what lets campaign modules sit ahead of base modules and
 * intercept without base rules knowing they exist.
 */

import type { Action } from './action.js'
import { encodeAction } from './action.js'
import type { Continue } from './continue.js'
import { UNHANDLED, isWaiting } from './continue.js'
import type { GameState, RuleModuleId } from './state.js'

export interface RuleResult {
  readonly state: GameState
  readonly continue: Continue
}

export interface RuleModule {
  readonly id: RuleModuleId
  perform(state: GameState, action: Action): RuleResult
}

/** Convenience for modules: "not mine". */
export function unhandled(state: GameState): RuleResult {
  return { state, continue: UNHANDLED }
}

export class RuleRegistry {
  readonly #modules = new Map<RuleModuleId, RuleModule>()

  register(module: RuleModule): this {
    if (this.#modules.has(module.id)) {
      throw new Error(`rule module already registered: ${module.id}`)
    }
    this.#modules.set(module.id, module)
    return this
  }

  get(id: RuleModuleId): RuleModule {
    const found = this.#modules.get(id)
    if (found === undefined) throw new Error(`rule module not registered: ${id}`)
    return found
  }

  ids(): readonly RuleModuleId[] {
    return [...this.#modules.keys()]
  }
}

/** Apply one action. Throws if no module in the chain handles it. */
export function perform(
  state: GameState,
  action: Action,
  registry: RuleRegistry,
): RuleResult {
  for (const id of state.ruleChain) {
    const result = registry.get(id).perform(state, action)
    if (result.continue.kind !== 'unhandled') return result
  }
  throw new Error(`no rule module handled action: ${encodeAction(action)}`)
}

export interface AdvanceOptions {
  /** Guard against a rule cycle. */
  readonly maxSteps?: number
}

/**
 * Apply an action, then keep stepping while the engine can proceed without input.
 * Stops at an ask, a multi-ask or game over.
 *
 * This is the loop rollouts extend: same code, the bot answers the asks.
 */
export function advance(
  state: GameState,
  action: Action,
  registry: RuleRegistry,
  options: AdvanceOptions = {},
): RuleResult {
  const maxSteps = options.maxSteps ?? 10_000
  let result = perform(state, action, registry)
  let steps = 0

  for (;;) {
    if (++steps > maxSteps) {
      throw new Error(`rule chain did not settle after ${maxSteps} steps`)
    }

    const c = result.continue
    if (c.kind === 'log') {
      result = { state: { ...result.state, log: [...result.state.log, c.message] }, continue: c.then }
      continue
    }
    if (c.kind === 'then' || c.kind === 'milestone') {
      result = perform(result.state, c.action, registry)
      continue
    }
    if (isWaiting(c) || c.kind === 'gameOver') return result

    throw new Error(`unexpected continue in advance: ${(c as Continue).kind}`)
  }
}
