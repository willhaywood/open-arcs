/**
 * Driving a bot seat.
 *
 * One function, used by three callers that must not diverge: the hotseat loop, the arena, and
 * (later) whichever multiplayer client notices it is a bot's turn. If each wrote its own loop they
 * would drift on the details that matter — when to stop, what counts as a bot seat, whether the
 * action goes through `applyExternal`.
 *
 * **Decisions land through `applyExternal` like any other.** That is what keeps a bot's game
 * replayable: the journal records the action, not who chose it, so a bot game and a human game of
 * the same moves are the same file (docs/03 section 9a).
 */

import { advance, applyExternal, defaultRegistry } from '../index.js'
import { observe } from '../observe.js'
import type { RuleRegistry, RuleResult } from '../dispatch.js'
import type { FactionId } from '../ids.js'
import type { Action } from '../action.js'
import type { ObservedState } from '../observe.js'
import type { Bot, BotDecision } from './bot.js'

/** Is this seat played by a bot? */
export function isBotSeat(bots: readonly FactionId[] | undefined, faction: FactionId): boolean {
  return bots?.includes(faction) === true
}

/**
 * Should a bot act on this result, and if so, whose turn is it?
 *
 * Returns `undefined` when the game is waiting on a human, is over, or is mid-resolution. Callers
 * poll this rather than tracking turn state themselves.
 */
export function botToAct(
  result: RuleResult,
  bots: readonly FactionId[] | undefined,
): FactionId | undefined {
  if (result.continue.kind !== 'ask') return undefined
  const faction = result.continue.faction
  return isBotSeat(bots, faction) ? faction : undefined
}

/**
 * Take exactly one bot decision, and apply it.
 *
 * **One action, not a whole turn.** The caller drives the loop, which is what lets the UI pace the
 * actions apart (docs/19 section 2a), the diagnostic panel pause between them (section 2e), and the
 * arena run flat out — the same function at three speeds.
 */
export function stepBot(
  result: RuleResult,
  bot: Bot,
  faction: FactionId,
  registry?: RuleRegistry,
): { result: RuleResult; decision: BotDecision } {
  if (result.continue.kind !== 'ask') {
    throw new Error('stepBot: called when the engine is not asking')
  }
  /*
   * One-ply lookahead, supplied here because only this function holds the full state. Each probe
   * uses `advance` rather than `applyExternal`: a considered-and-rejected move must not reach the
   * journal, and these are hypotheticals, not plays.
   */
  // Hoisted: one registry per decision, not one per candidate probed.
  const reg = registry ?? defaultRegistry()
  const lookahead = (action: Action): ObservedState | undefined => {
    try {
      return observe(advance(result.state, action, reg).state, faction)
    } catch {
      return undefined
    }
  }
  const decision = bot.decide(observe(result.state, faction), result.continue.actions, lookahead)
  return { result: applyExternal(result, decision.action, registry), decision }
}

/**
 * Play consecutive bot decisions until a human is asked or the game ends.
 *
 * **`stuckAfter` is a safety net, not a budget**, and the distinction is worth keeping sharp — I
 * conflated them first time and the tests failed for the wrong reason. A bot that somehow fails to
 * advance the game would otherwise spin forever, which in the browser is a frozen tab rather than
 * an error, so reaching it *throws*. It should be far above any real run: an all-bot game runs to
 * thousands of actions perfectly legitimately.
 *
 * To play a bounded number of actions — a paced UI, a stepping panel — call `stepBot` in your own
 * loop. That is the caller's business, not a mode of this function.
 */
export function runBots(
  result: RuleResult,
  bots: readonly FactionId[] | undefined,
  bot: Bot,
  registry?: RuleRegistry,
  stuckAfter = 100_000,
): { result: RuleResult; decisions: readonly BotDecision[] } {
  const decisions: BotDecision[] = []
  let current = result
  for (let i = 0; i < stuckAfter; i++) {
    const faction = botToAct(current, bots)
    if (faction === undefined) return { result: current, decisions }
    const step = stepBot(current, bot, faction, registry)
    current = step.result
    decisions.push(step.decision)
  }
  throw new Error(
    `runBots: ${stuckAfter} consecutive bot actions without reaching a human — the bot is stuck`,
  )
}

/**
 * Play at most `count` bot decisions, stopping early if a human is asked or the game ends.
 *
 * The bounded counterpart to `runBots`, for callers that want to advance a little: a stepping
 * diagnostic, a test that needs a game part-played. Returns quietly at the bound — reaching it is
 * the normal case, not a fault.
 */
export function stepBots(
  result: RuleResult,
  bots: readonly FactionId[] | undefined,
  bot: Bot,
  count: number,
  registry?: RuleRegistry,
): { result: RuleResult; decisions: readonly BotDecision[] } {
  const decisions: BotDecision[] = []
  let current = result
  for (let i = 0; i < count; i++) {
    const faction = botToAct(current, bots)
    if (faction === undefined) break
    const step = stepBot(current, bot, faction, registry)
    current = step.result
    decisions.push(step.decision)
  }
  return { result: current, decisions }
}
