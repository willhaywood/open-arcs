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

import { advance, applyExternal, defaultRegistry, rng } from '../index.js'
import { observe } from '../observe.js'
import { trivialBot } from './bot.js'

import type { RuleRegistry, RuleResult } from '../dispatch.js'
import type { FactionId } from '../ids.js'
import type { Action } from '../action.js'
import type { Continue } from '../continue.js'
import type { GameState } from '../state.js'
import type { ObservedState } from '../observe.js'
import type { Bot, BotDecision, Probe, RolloutOptions } from './bot.js'

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
 * Actions that decline an optional step between choosing a card and spending its pips.
 *
 * **This couples the harness to two rule-module action types, knowingly.** The alternative is
 * recognising "the step is optional" structurally, which the engine does not express — and the cost
 * of being wrong here is small and self-limiting: `settle` only advances past an ask that offers one
 * of these, so a renamed or missing type makes it stop early and score where it used to. Degraded,
 * never incorrect.
 */
const DECLINE = ['ambition/skip-declare', 'turn/prelude-done']

/**
 * Advance a hypothetical position to the point where this turn's actions actually begin.
 *
 * **The lead decision is scored at the wrong moment, and this is the fix.** `advance` stops at the
 * next ask, so probing "lead Mobilization-5" lands on the declare prompt or the Prelude — before the
 * board has moved. The card has left your hand and bought nothing yet, so every card scores as pure
 * cost while `Pass` scores as free. Measured over 12 three-player games, that produced 8 passes for
 * every lead and 2.5 mean power against the trivial bot's 10.7 (docs/19 section 2g).
 *
 * The real defect is subtler than "not far enough ahead": candidates were compared **at different
 * points in the game**. `Pass` ends your turn, so it was scored after your turn; a card was scored
 * three decisions before yours had happened. Settling puts every candidate on the same horizon —
 * the moment the turn's pips are about to be spent — which is what makes the comparison mean
 * anything.
 *
 * It declines the optional steps on the way rather than playing them well. That is deliberate: the
 * bot will be asked those questions for real and will evaluate them then, so choosing here would
 * pre-empt a decision with a guess. Declining values a card at what it is *guaranteed* to buy.
 *
 * **This is honestly no longer one-ply**, and calling it that would be a fiction (docs/19 section 2f
 * option 2). It is one decision, evaluated at a comparable horizon.
 */
/**
 * How many action pips the faction still has to spend at this ask, or 0.
 *
 * Dug out of the `turn/pips` continuation the pip options carry, the same way the action tray finds
 * it — and for the same reason: **it is not in the state**. `state.lead.pips` is the round's lead,
 * not the acting player's own card, which is exactly the mix-up that once labelled a pivoted
 * Aggression turn "Construction 2".
 *
 * `total - done + 1` because `then` describes the state *after* the pip about to be taken.
 */
function pipsAhead(cont: Continue, faction: FactionId): number {
  if (cont.kind !== 'ask' || cont.faction !== faction) return 0
  const dig = (v: unknown, depth = 0): Record<string, unknown> | undefined => {
    if (depth > 6 || v === null || typeof v !== 'object') return undefined
    const o = v as Record<string, unknown>
    if (o['type'] === 'turn/pips') return o
    return dig(o['then'], depth + 1)
  }
  for (const a of cont.actions) {
    const hit = dig(a['then'])
    if (hit === undefined) continue
    const done = Number(hit['done'])
    const total = Number(hit['total'])
    if (!Number.isFinite(done) || !Number.isFinite(total)) continue
    return Math.max(0, total - done + 1)
  }
  return 0
}

/**
 * How far `settle` will go before giving up and scoring where it got to.
 *
 * A guard against an unforeseen cycle rather than a budget: a real sub-flow is two or three asks
 * (choose a system, choose a target, gather dice), so anything approaching this is a loop.
 */
const SETTLE_LIMIT = 10

/**
 * How many times a random outcome is sampled before it is judged.
 *
 * One sample stops the cheating but replaces it with noise — the bot would pick a dice pool off a
 * single imaginary roll, which is worse than a human picking by odds. A handful of samples is enough
 * for more dice to beat fewer, which is the judgement that was missing. Only paid where randomness
 * is actually consumed, so ordinary Move and Build probes are unaffected.
 */
const SAMPLES = 5

/**
 * The same position with a generator that is *not* the one the game will use.
 *
 * Derived from the journal length rather than from `state.rng`, so it is reproducible on any client
 * holding the same journal — which is what keeps two clients running the bot in agreement — while
 * being independent of the roll that will really happen. The salt separates samples from each other.
 *
 * Every candidate at a decision is sampled with the *same* salts, deliberately: comparing options
 * under common random numbers is what lets a real difference between them show through the noise.
 */
function probeFrom(state: GameState, salt: number): GameState {
  return { ...state, rng: rng((state.journal.length + 1) * 0x9e3779b1 + salt * 0x85ebca77) }
}

function settle(
  result: RuleResult,
  faction: FactionId,
  reg: RuleRegistry,
  resolve: (result: RuleResult, actions: readonly Action[]) => Action,
): RuleResult {
  let current = result
  /*
   * Prompts already resolved inside this settle, so a sub-flow that can be re-entered — arranging
   * resource slots, which offers value-neutral swaps forever — costs one step rather than the whole
   * budget. `stepBot`'s own history cannot help here: none of this is happening in the real game.
   */
  const visited = new Set<string>()

  for (let i = 0; i < SETTLE_LIMIT; i++) {
    const c = current.continue
    if (c.kind !== 'ask' || c.faction !== faction) return current
    // The horizon: the turn's actions are about to be spent, which is what candidates are compared at.
    if (pipsAhead(c, faction) > 0) return current
    if (c.prompt !== undefined && visited.has(c.prompt)) return current
    if (c.prompt !== undefined) visited.add(c.prompt)

    /*
     * Decline optional steps, resolve mandatory ones.
     *
     * Declining is right for a step the bot will be asked for real and can evaluate then — the
     * declare prompt, the Prelude — where choosing here would pre-empt a real decision with a guess.
     * A *sub-flow* is different: "Battle — choose a system" is not a separate decision, it is the
     * rest of the one being scored, and stopping there is what made Battle, Move, Build and Secure
     * score identically. All of them lead to a sub-ask before the board has moved, so they tied and
     * offer order decided: the bot battled because Battle was listed first and never once secured a
     * court card, though it was offered 15 times a game.
     */
    const decline = c.actions.find((a) => DECLINE.includes(a.type))
    current = advance(current.state, decline ?? resolve(current, c.actions), reg)
  }
  return current
}

/**
 * Every outcome worth weighing for one action, as this bot would see them.
 *
 * One sample unless the action actually consumed randomness — detected by the generator having
 * moved, which is exact and costs nothing, rather than by guessing from the action's type.
 */
function sampleOutcomes(
  state: GameState,
  action: Action,
  reg: RuleRegistry,
  faction: FactionId,
): readonly ObservedState[] {
  const base = probeFrom(state, 0)
  const first = advance(base, action, reg)
  const out = [observe(first.state, faction)]
  // The generator moving is what "random" means here; a Move or a Build leaves it untouched.
  if (first.state.rng.seed === base.rng.seed) return out
  for (let i = 1; i < SAMPLES; i++) {
    try {
      out.push(observe(advance(probeFrom(state, i), action, reg).state, faction))
    } catch {
      // A sample that cannot be applied is dropped rather than allowed to sink the whole candidate.
    }
  }
  return out
}

/** The extra settled samples for a random action, beyond the first the caller already has. */
function settledSamples(
  state: GameState,
  action: Action,
  faction: FactionId,
  reg: RuleRegistry,
  resolve: (result: RuleResult, actions: readonly Action[]) => Action,
): readonly ObservedState[] {
  const base = probeFrom(state, 0)
  const first = advance(base, action, reg)
  if (first.state.rng.seed === base.rng.seed) return []
  const out: ObservedState[] = []
  for (let i = 1; i < SAMPLES; i++) {
    try {
      const settled = settle(advance(probeFrom(state, i), action, reg), faction, reg, resolve)
      out.push(observe(settled.state, faction))
    } catch {
      // As above: a failed sample is one fewer opinion, not a reason to discard the candidate.
    }
  }
  return out
}

/**
 * Play a position forward with a cheap policy and report how it looks to `self`.
 *
 * Stops at the first of: the horizon in turns, the step ceiling, or the game ending. `trivialBot`
 * drives it — see `rollout.ts` for why a weak policy is the only affordable one, and why that is the
 * honest limit of V2 as built.
 */
function playOut(
  from: RuleResult,
  self: FactionId,
  reg: RuleRegistry,
  turns: number,
  maxSteps: number,
): ObservedState {
  let current = from
  const startedIn = turnKey(current.state)
  const seen = new Set<string>([startedIn])
  let leftOwnTurn = false

  for (let i = 0; i < maxSteps; i++) {
    const c = current.continue
    if (c.kind !== 'ask') break
    const here = turnKey(current.state)
    if (here !== startedIn) leftOwnTurn = true
    if (leftOwnTurn) {
      seen.add(here)
      // `seen` includes your own turn, so the horizon counts turns *past* it.
      if (seen.size > turns + 1) break
    }
    try {
      current = advance(
        current.state,
        trivialBot.decide(observe(current.state, c.faction), c.actions).action,
        reg,
      )
    } catch {
      // A playout that cannot continue is scored where it stopped, not discarded.
      break
    }
  }
  return observe(current.state, self)
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

  /*
   * How a sub-flow gets played out while scoring: the bot's own judgement, one ply deep.
   *
   * Reusing `bot.decide` rather than a separate policy keeps the two consistent — a bot that would
   * choose this system for real chooses it here — and it costs no new interface. The inner lookahead
   * deliberately does *not* settle again: without that, scoring one candidate would resolve a
   * sub-flow whose every candidate resolves a sub-flow, and the work would compound. One ply inside
   * the sub-flow is enough to tell a good target from a bad one, which is all this has to do.
   */
  const resolve = (at: RuleResult, options: readonly Action[]): Action => {
    const shallow = (action: Action): Probe | undefined => {
      try {
        const samples = sampleOutcomes(at.state, action, reg, faction)
        const after = advance(probeFrom(at.state, 0), action, reg)
        return {
          observed: samples[0]!,
          samples,
          repeats: false,
          actionsAhead: pipsAhead(after.continue, faction),
        }
      } catch {
        return undefined
      }
    }
    return bot.decide(observe(at.state, faction), options, shallow).action
  }

  /*
   * The V2 half: play a candidate out several times and hand back the positions.
   *
   * Built here for the same reason as `lookahead` — driving the engine needs the full state, which a
   * bot must never hold. Each sample is re-seeded from the journal so the playout is reproducible on
   * any client and independent of the roll the game will really make; without that a rollout would
   * be played against the actual future, which is docs/19 section 2k's oracle compounded over every
   * simulated turn rather than a single roll.
   *
   * **Offered at every ask; the bot decides where to spend it.** Which decisions deserve a rollout
   * is a bot's policy, not the harness's business — putting the test here made the bot's own guard
   * unreachable, which a mutation caught by passing every test with the guard removed. The harness
   * provides the capability and costs nothing until it is called.
   */
  const rollout = (action: Action, options: RolloutOptions): readonly ObservedState[] => {
    const out: ObservedState[] = []
    for (let s = 0; s < options.samples; s++) {
      try {
        const seeded = advance(probeFrom(result.state, s + 977), action, reg)
        out.push(playOut(seeded, faction, reg, options.lookaheadTurns, options.maxSteps))
      } catch {
        // One fewer opinion, not a reason to drop the candidate.
      }
    }
    return out
  }

  const lookahead = (action: Action): Probe | undefined => {
    try {
      const next = advance(probeFrom(result.state, 0), action, reg)
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
      /*
       * The two halves read different positions on purpose. `repeats` asks where the game goes
       * *next*, so it uses the immediate continuation — settling first would step over the very
       * re-entry it exists to catch. The value is read after settling, because that is the horizon
       * candidates have to share to be comparable.
       */
      const settled = settle(next, faction, reg, resolve)
      /*
       * `repeats` and `actionsAhead` come from the first sample alone: both are questions about the
       * shape of the game — which question comes next, how many pips are left — and neither is
       * affected by how the dice fall.
       */
      return {
        observed: observe(settled.state, faction),
        samples: [
          observe(settled.state, faction),
          ...settledSamples(result.state, action, faction, reg, resolve),
        ],
        repeats: at !== undefined && at >= depth,
        actionsAhead: pipsAhead(settled.continue, faction),
      }
    } catch {
      return undefined
    }
  }
  const decision = bot.decide(
    observe(result.state, faction),
    result.continue.actions,
    lookahead,
    rollout,
  )
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
