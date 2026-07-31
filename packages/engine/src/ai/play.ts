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
import type { Continue } from '../continue.js'
import type { GameState } from '../state.js'
import type { Bot, BotDecision, Probe } from './bot.js'

/** Is this seat played by a bot? */
export function isBotSeat(bots: readonly FactionId[] | undefined, faction: FactionId): boolean {
  return bots?.includes(faction) === true
}

/**
 * Which bot plays which seat, when they are not all the same one.
 *
 * The arena needs this and nothing else does yet — a head-to-head is meaningless if both sides are
 * the same bot. It is a widening rather than a second loop because the alternative is the arena
 * owning its own copy of `runBots`, and the moment those two diverge the thing being measured is no
 * longer the thing that plays.
 */
export type BotSeats = Readonly<Partial<Record<FactionId, Bot>>>

/**
 * Resolve the bot for a seat, accepting either one bot for every seat or a table.
 *
 * Discriminated on `decide` rather than on shape: a `BotSeats` is a plain record whose values are
 * bots, so nothing about its keys distinguishes it, but only a `Bot` can decide.
 */
export function botFor(bot: Bot | BotSeats, faction: FactionId): Bot {
  if (typeof (bot as Bot).decide === 'function') return bot as Bot
  const seat = (bot as BotSeats)[faction]
  if (seat === undefined) {
    // A seat marked as a bot with no bot to play it is a setup fault, and silently substituting one
    // would quietly measure the wrong matchup.
    throw new Error(`botFor: no bot assigned to ${faction}`)
  }
  return seat
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
 * The questions already put to the acting faction this turn, in the order they were first asked.
 *
 * **The prompt turns out to be the right key rather than a convenient one.** The engine writes
 * progress into it — `red — action 2 of 3 (Aggression)` — so spending a pip asks a *different*
 * question and is never mistaken for going in circles, while `red — arrange your resource slots` is
 * byte-identical every time you re-enter it, which is exactly the loop this catches.
 *
 * **The order is what makes it usable, and that took two wrong versions to see.** A plain set says
 * "you have been here before" and nothing else — so it condemned `Done` (which returns to the
 * Prelude, also already asked) exactly as hard as the pointless swap that never leaves. Both
 * re-enter; only one is going backwards. Positions give the difference: unwinding to an *earlier*
 * question is how a sub-decision ends, and re-entering one at the same depth or deeper is how a bot
 * goes in circles.
 *
 * **Scoped to the turn, and that scope is load-bearing.** Kept for the whole game it would mark
 * every prompt a faction has ever seen, and since most pip actions lead to a prompt some earlier
 * turn also produced, the bot would start preferring whatever ends its turn — feeding the very
 * passing bug this work exists to fix. Within one turn, prompts either carry progress or genuinely
 * repeat, so the signal is clean.
 *
 * **The turn it belongs to is carried here, and `stepBot` resets on its own.** Leaving that to
 * callers is what makes the scope silently wrong: the obvious boundary — the acting seat changing —
 * is not one. A faction whose turn ends a round then *leads* the next, so two of its turns run
 * back to back with nobody else asked between them. That version merged them, marked a prompt from
 * the previous turn as already-seen, and left the bot with nothing eligible. Three callers thread
 * this; none of them should have to know that.
 */
export interface AskedThisTurn {
  /** Which turn these belong to; a different one starts over. */
  readonly turn: string
  /** Prompt to the position it was first asked at, within this turn. */
  readonly prompts: ReadonlyMap<string, number>
}

export const NO_ASKS: AskedThisTurn = { turn: '', prompts: new Map() }

/**
 * Which turn a position is in.
 *
 * Act, chapter, round and whose turn it is — the four things that change exactly when a turn does
 * and never during one.
 */
function turnKey(state: GameState): string {
  return `${state.act}:${state.chapter}:${state.round}:${state.current ?? '-'}`
}

export interface BotStep {
  readonly result: RuleResult
  readonly decision: BotDecision
  /** Pass back into the next `stepBot` for the same faction's turn; drop it when the seat changes. */
  readonly asked: AskedThisTurn
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
  asked: AskedThisTurn = NO_ASKS,
): BotStep {
  if (result.continue.kind !== 'ask') {
    throw new Error('stepBot: called when the engine is not asking')
  }
  // A new turn starts over, decided here so no caller has to recognise a turn boundary.
  const turn = turnKey(result.state)
  const history = asked.turn === turn ? asked.prompts : new Map<string, number>()
  /*
   * One-ply lookahead, supplied here because only this function holds the full state. Each probe
   * uses `advance` rather than `applyExternal`: a considered-and-rejected move must not reach the
   * journal, and these are hypotheticals, not plays.
   */
  // Hoisted: one registry per decision, not one per candidate probed.
  const reg = registry ?? defaultRegistry()
  const asking = result.continue
  // The question being answered counts as asked, which is what makes a one-step loop a repeat.
  const seen =
    asking.prompt === undefined || history.has(asking.prompt)
      ? history
      : new Map([...history, [asking.prompt, history.size] as const])
  const depth = asking.prompt === undefined ? seen.size : (seen.get(asking.prompt) ?? seen.size)

  const lookahead = (action: Action): Probe | undefined => {
    try {
      const next = advance(result.state, action, reg)
      const c = next.continue
      /*
       * Going in circles is landing back on a question already put this turn **without unwinding**.
       *
       * The livelock that motivated this ran Prelude → arrange → Done → Prelude: three prompts, no
       * two consecutive ones alike, so only turn-scoped history sees it at all. But history alone
       * over-fires — `Done` returns to the Prelude, which is equally "already asked" — and gating
       * the exit left the bot with nothing but swaps. Comparing *positions* separates them: `Done`
       * goes back to something earlier and is how the sub-decision finishes; the swap returns to
       * the question being answered right now and is how it never does.
       *
       * Unprompted asks abstain. The UI words those itself, so there is nothing to compare, and a
       * wrong `true` would suppress a legitimate action where a wrong `false` costs a tie-break.
       */
      const at =
        c.kind === 'ask' && c.faction === faction && c.prompt !== undefined
          ? seen.get(c.prompt)
          : undefined
      return { observed: observe(next.state, faction), repeats: at !== undefined && at >= depth }
    } catch {
      return undefined
    }
  }
  const decision = bot.decide(observe(result.state, faction), result.continue.actions, lookahead)
  return {
    result: applyExternal(result, decision.action, registry),
    decision,
    asked: { turn, prompts: seen },
  }
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
  bot: Bot | BotSeats,
  registry?: RuleRegistry,
  stuckAfter = 100_000,
): { result: RuleResult; decisions: readonly BotDecision[] } {
  const decisions: BotDecision[] = []
  let current = result
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < stuckAfter; i++) {
    const faction = botToAct(current, bots)
    if (faction === undefined) return { result: current, decisions }
    const step = stepBot(current, botFor(bot, faction), faction, registry, asked)
    current = step.result
    asked = step.asked
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
  bot: Bot | BotSeats,
  count: number,
  registry?: RuleRegistry,
): { result: RuleResult; decisions: readonly BotDecision[] } {
  const decisions: BotDecision[] = []
  let current = result
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < count; i++) {
    const faction = botToAct(current, bots)
    if (faction === undefined) break
    const step = stepBot(current, botFor(bot, faction), faction, registry, asked)
    current = step.result
    asked = step.asked
    decisions.push(step.decision)
  }
  return { result: current, decisions }
}
