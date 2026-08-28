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

import { CardLocation, advance, applyExternal, defaultRegistry, encodeAction, rng } from '../index.js'
import { contentsOf, moveAll } from '../tracker.js'
import { shuffle } from '../rng.js'
import { observe } from '../observe.js'
import { refuses } from './heuristic.js'
import { standardBot } from './goal.js'

import type { RuleRegistry, RuleResult } from '../dispatch.js'
import type { FactionId } from '../ids.js'
import type { Action } from '../action.js'
import type { Continue } from '../continue.js'
import type { GameState } from '../state.js'
import type { ObservedState } from '../observe.js'
import type { Bot, BotDecision, Explore, Foresee, PathProbe, Probe, RolloutOptions } from './bot.js'

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
  /**
   * Movement legs already taken this turn, oldest first. What a "don't undo your own move" term
   * reads: the prompts above encode which *questions* were asked, never which systems the fleet
   * came from, and the circling bug lived exactly in that blindness.
   */
  readonly moves: readonly { from: string; to: string }[]
}

export const NO_ASKS: AskedThisTurn = { turn: '', prompts: new Map(), moves: [] }

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
/**
 * The same position with every rival's hand re-dealt from the unseen pool.
 *
 * Pool = deck + rivals' hands + discard: exactly the zones `observe` hides from `self`, so a
 * sampled hand is any hand this faction cannot rule out. Sizes are preserved everywhere — the
 * count of a hand is public, its contents are not — and `self`'s own hand never moves. The
 * shuffle consumes the state's generator and the advanced generator is kept, so the deal and the
 * play that follows it draw from one derived stream.
 */
function dealRivals(state: GameState, self: FactionId): GameState {
  const rivals = state.factions.filter((f) => f !== self)
  const hands = rivals.map((r) => [...contentsOf(state.cards, CardLocation.hand(r))])
  const deck = [...contentsOf(state.cards, CardLocation.deck())]
  const discard = [...contentsOf(state.cards, CardLocation.discard())]
  /*
   * Sorted before shuffling, and the sort is the no-cheat property holding. Two states with the
   * same information set — same unseen cards, same sizes — can differ in which hidden zone each
   * card physically sits in, and a shuffle is order-sensitive: pool them in zone order and the
   * truth leaks through the indices, producing different deals for observer-identical worlds. The
   * test that caught this swapped one card between a rival's hand and the deck and watched the
   * replies change.
   */
  const pool = [...hands.flat(), ...deck, ...discard].sort()
  if (pool.length === 0) return state

  const [shuffled, nextRng] = shuffle(state.rng, pool)

  /*
   * **Everything is parked before anything is dealt, and that is the second half of the no-cheat
   * property.**
   *
   * `move` returns the tracker untouched when a card is already at its destination, so a dealt hand
   * built in place keeps whichever cards happened to be there in their original positions and
   * appends the rest. The *set* is then correct while the *order* still encodes where the cards
   * really were — and order is not cosmetic: it is the order `hand()` returns, so it is the order
   * the reply bot sees its options in, and ties break on it. Two observer-identical worlds produced
   * different leads through nothing but that.
   *
   * Parking the whole pool in `self`'s hand first makes every card arrive from somewhere else, so
   * each zone ends up in exactly the dealt order. Self's hand is the one card zone that is never
   * part of the pool, and every parked card is dealt back out again, so it holds precisely its own
   * cards when this returns.
   */
  let cards = moveAll(state.cards, pool, CardLocation.hand(self))
  let cursor = 0
  const take = (n: number): string[] => shuffled.slice(cursor, (cursor += n))
  for (let i = 0; i < rivals.length; i++) {
    cards = moveAll(cards, take(hands[i]!.length), CardLocation.hand(rivals[i]!))
  }
  cards = moveAll(cards, take(deck.length), CardLocation.deck())
  cards = moveAll(cards, take(discard.length), CardLocation.discard())
  return { ...state, cards, rng: nextRng }
}

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
 * How a playout picks its moves: a light, ordered preference over action types.
 *
 * **A rollout is only as good as the policy inside it**, and the first version used `trivialBot` —
 * first legal action. That is not merely weak, it is *biased*: it never taxes deliberately, never
 * builds toward anything, and takes whatever the engine happens to offer first. A rollout therefore
 * scored the position an arbitrary continuation reaches, which is why V2 came out indistinguishable
 * from V1 over 120 games. There was nothing worth simulating inside the simulation.
 *
 * **It is a preference table and not an evaluation, and that is a cost decision with evidence.** The
 * obvious fix — greedy on `valueOf`, the same function the bot decides with — was written first and
 * measured: it needs an `advance` and a full evaluation *per candidate per step*, roughly twenty
 * thousand of each per card play, and a single three-player game did not finish in ten minutes. That
 * is the standard trap with playout policies: they run tens of thousands of times, so they have to
 * be cheap in a way a decision procedure does not.
 *
 * So this ranks by what the action *is*, needing no lookahead at all. Crude, but it encodes the two
 * things `trivialBot` got wrong — it builds and taxes rather than drifting, and it plays a card
 * rather than passing — which is what a rollout needs its continuation to do before the payoff of a
 * card can show up in it.
 */
const PLAYOUT_ORDER: readonly string[] = [
  // Grow the position: buildings are the engine, and taxing is what feeds it.
  'action/build',
  'action/tax-city',
  // Court cards are lasting abilities; securing beats merely reaching for one.
  'action/secure',
  'action/influence',
  // Finish fights already started rather than leaving them half-resolved.
  'battle/roll',
  'battle/hit',
  'battle/target',
  'battle/system',
  'action/battle',
  'action/repair',
  // Then ordinary board play.
  'action/move-ships',
  'action/move-pick',
  'action/take',
  // Play a card rather than sit the round out — the whole reason V1 needed pips priced.
  'turn/lead',
  'turn/pivot',
  'turn/copy',
  'turn/surpass',
]

/** Actions that end a turn or give something up; last resort in a playout. */
const PLAYOUT_LAST: readonly string[] = ['turn/pass', 'turn/end', 'action/skip']

function playoutRank(action: Action): number {
  if (refuses(action)) return 1000
  if (PLAYOUT_LAST.includes(action.type)) return 900
  const i = PLAYOUT_ORDER.indexOf(action.type)
  return i === -1 ? 500 : i
}

/** Pick a playout move: best rank, earliest offer among equals — no lookahead, no evaluation. */
export function playoutChoice(actions: readonly Action[]): Action {
  let best = actions[0]!
  let bestRank = Number.POSITIVE_INFINITY
  for (const action of actions) {
    const rank = playoutRank(action)
    if (rank < bestRank) {
      bestRank = rank
      best = action
    }
  }
  return best
}

/**
 * Play a position forward with a cheap policy and report how it looks to `self`.
 *
 * Stops at the first of: the horizon in turns, the step ceiling, or the game ending.
 *
 * **The policy is a parameter purely so it can be held constant against the default.** Testing
 * `playoutChoice` on its own leaves the single line that calls it unverified — a mutation pointing
 * this at `actions[0]` passed every test. The first attempt at a wiring test compared this against a
 * hand-rolled loop and passed for the wrong reason: the loop had no turn horizon, so the two
 * differed however the policy was wired. Same function, same horizon, different policy is the only
 * comparison that isolates it.
 */
export function playOut(
  from: RuleResult,
  self: FactionId,
  reg: RuleRegistry,
  turns: number,
  maxSteps: number,
  policy: (actions: readonly Action[]) => Action = playoutChoice,
  untilChapterEnd = false,
): ObservedState {
  let current = from
  const startedIn = turnKey(current.state)
  const startChapter = current.state.chapter
  const seen = new Set<string>([startedIn])
  let leftOwnTurn = false

  for (let i = 0; i < maxSteps; i++) {
    const c = current.continue
    if (c.kind !== 'ask') break
    /*
     * Chapter end is the point where ambitions have paid and `power` is realised, so stopping the
     * moment the chapter number moves scores the position *after* the payoff rather than before it.
     */
    if (untilChapterEnd) {
      if (current.state.chapter !== startChapter) break
    } else {
      const here = turnKey(current.state)
      if (here !== startedIn) leftOwnTurn = true
      if (leftOwnTurn) {
        seen.add(here)
        // `seen` includes your own turn, so the horizon counts turns *past* it.
        if (seen.size > turns + 1) break
      }
    }
    try {
      current = advance(current.state, policy(c.actions), reg)
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
        out.push(
          playOut(
            seeded,
            faction,
            reg,
            options.lookaheadTurns,
            options.maxSteps,
            playoutChoice,
            options.untilChapterEnd === true,
          ),
        )
      } catch {
        // One fewer opinion, not a reason to drop the candidate.
      }
    }
    return out
  }

  /*
   * The V3 half: apply a whole line of this faction's answers and report where it lands.
   *
   * **The prefix cache is what makes a beam affordable, and it must be a pure optimisation.** A
   * search extends lines one action at a time, so without the cache every extension replays its
   * whole prefix — O(depth) advances per node instead of one. The cache keys on the encoded line,
   * which is exact: `encodeAction` is the journal's own serialisation, so two paths share a key
   * precisely when they are the same actions in the same order. The separator is `'\u0000'`
   * because encoded actions can themselves contain spaces (labels do), so a space-joined key made
   * two different paths collide — written as the escape sequence, never the raw byte, which turns
   * the file binary in the eyes of every grep. Scoped to this one decision, like everything else
   * built here, so no state leaks between decisions and purity holds.
   *
   * Randomness is handled the way `settledSamples` handles it: the salt-0 world answers first, and
   * if the line moved the generator it is re-applied whole under further salts — a salt whose line
   * throws is one fewer opinion. Re-applying whole rather than caching per-salt keeps the cache
   * from multiplying, and the expensive case (a line through a battle) is exactly the case where
   * honesty about odds is worth the replay.
   */
  const exploreCache = new Map<string, RuleResult>()
  const explore: Explore = (path: readonly Action[]): PathProbe | undefined => {
    if (path.length === 0) return undefined
    try {
      // Longest cached prefix, then advance the remainder — one advance per new node in a search.
      let start = 0
      let current: RuleResult | undefined
      const keys = path.map((a) => encodeAction(a))
      for (let i = path.length - 1; i >= 1; i--) {
        const hit = exploreCache.get(keys.slice(0, i).join('\u0000'))
        if (hit !== undefined) {
          start = i
          current = hit
          break
        }
      }
      let at = current ?? advance(probeFrom(result.state, 0), path[0]!, reg)
      if (current === undefined) {
        start = 1
        exploreCache.set(keys.slice(0, 1).join('\u0000'), at)
      }
      for (let i = start; i < path.length; i++) {
        at = advance(at.state, path[i]!, reg)
        exploreCache.set(keys.slice(0, i + 1).join('\u0000'), at)
      }

      const landed = observe(at.state, faction)
      const samples: ObservedState[] = [landed]
      // The generator moving is what "random" means here, exactly as `sampleOutcomes` reads it.
      if (at.state.rng.seed !== probeFrom(result.state, 0).rng.seed) {
        for (let s = 1; s < SAMPLES; s++) {
          try {
            let re = advance(probeFrom(result.state, s), path[0]!, reg)
            for (let i = 1; i < path.length; i++) re = advance(re.state, path[i]!, reg)
            samples.push(observe(re.state, faction))
          } catch {
            // One fewer opinion, not a reason to drop the line.
          }
        }
      }

      const c = at.continue
      const mine = c.kind === 'ask' && c.faction === faction
      return {
        observed: landed,
        samples,
        actions: mine ? c.actions : [],
        mine,
        ...(mine && c.prompt !== undefined ? { prompt: c.prompt } : {}),
      }
    } catch {
      return undefined
    }
  }

  /*
   * The V4 half: apply a line, then let the rivals answer it.
   *
   * ## Determinized BEFORE the path is applied, and the order is load-bearing
   *
   * Rivals must reply from **sampled** hands — their true hands are hidden from this faction, and
   * a reply computed from them is the section 2k oracle wearing cards instead of dice. The swap
   * happens on the base state, before the line is replayed on top, because the engine builds a
   * rival's ask *from their hand*: swap after landing and the pending ask still lists their true
   * cards, so the reply would either play a card the swapped hand does not hold or leak the truth
   * anyway. Swapping first, the whole machine downstream — asks included — sees only the sample.
   * This faction's own line replays identically on the swapped state, because nothing in its own
   * turn's legality reads a rival's hand.
   *
   * ## The pool is exactly this faction's information set
   *
   * Deck, every rival's hand, and the discard, pooled and re-dealt with sizes preserved. Those are
   * precisely the zones `observe` hides; `played` piles and the court are public and stay put.
   * A rival's sampled hand can therefore contain any card this faction cannot account for — which
   * is the honest meaning of "they could be holding anything".
   *
   * ## Replies are played by the shipped bot, on the ordinary machinery
   *
   * Each reply decision goes through `stepBot` with `standardBot` — the measured opponent, the
   * proven-terminating one — threading `AskedThisTurn` exactly as `runBots` does. The drive stops
   * when the ask returns to this faction, the game ends, or the step cap cuts it; a reply that
   * stalls is scored where it stopped rather than discarded.
   */
  const foresee: Foresee = (path, options) => {
    const out: ObservedState[] = []
    const cap = options.maxSteps ?? 200
    for (let d = 0; d < options.deals; d++) {
      try {
        /*
         * One generator per deal drives the shuffle, the replayed line and the replies alike —
         * derived from the journal, so any client reproduces it, and offset well away from the
         * salts `sampleOutcomes` and `rollout` use so the streams never collide.
         */
        const base = probeFrom(result.state, 4000 + d)
        const swapped = dealRivals(base, faction)
        let at: RuleResult = { ...result, state: swapped }
        for (const a of path) at = advance(at.state, a, reg)

        /*
         * The drive ends at the Nth **fresh return** of control — a transition from someone
         * else's ask (or the start) back to this faction's. Counting transitions rather than
         * self-asks is load-bearing: during this faction's own played-through turn every ask is
         * its own, and counting those would end a `rounds: 2` drive on the second prompt of its
         * own prelude instead of a round later.
         *
         * `rounds: 1` breaks before stepping this faction at all, exactly as this loop always
         * did. Deeper horizons step *everyone* with the same reply policy — a deliberately weaker
         * self-model than the beam (docs/19 section 20); recursing here would multiply cost by
         * the beam's branching for a judgement section 7 says is not the binding constraint.
         */
        const rounds = options.rounds ?? 1
        let asked: AskedThisTurn = NO_ASKS
        let returns = 0
        /*
         * Starts false so an immediate self-ask counts as return #1 — a beam line can end
         * mid-turn at its depth cap, and the old loop stopped on that ask without stepping;
         * `rounds: 1` must do exactly the same.
         */
        let prevSelf = false
        for (let i = 0; i < cap; i++) {
          const c = at.continue
          if (c.kind !== 'ask') break
          const self = c.faction === faction
          if (self && !prevSelf) {
            returns++
            if (returns >= rounds) break
          }
          prevSelf = self
          const step = stepBot(at, standardBot, c.faction, reg, asked)
          at = step.result
          asked = step.asked
        }
        out.push(observe(at.state, faction))
      } catch {
        // One fewer opinion, not a reason to drop the line.
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
        undoes:
          action.type === 'action/move-pick' &&
          history === asked.prompts &&
          asked.moves.some((m) => m.from === action['to'] && m.to === action['from']),
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
    explore,
    foresee,
  )
  const moves = asked.turn === turn ? asked.moves : []
  return {
    result: applyExternal(result, decision.action, registry),
    decision,
    asked: {
      turn,
      prompts: seen,
      moves:
        decision.action.type === 'action/move-pick'
          ? [...moves, { from: String(decision.action['from']), to: String(decision.action['to']) }]
          : moves,
    },
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
