/**
 * What a bot is, and the trivial one.
 *
 * The interfaces here are the ones docs/03 section 2 argues for and docs/19 section 2a settles.
 * They are deliberately fixed *before* any evaluation exists, because every one of them is
 * expensive to widen once call sites depend on the narrow version:
 *
 *   - A bot returns a **`BotDecision`, not an `Action`.** The reason has to come from the code that
 *     made the choice — reconstructing it afterwards from the board is guesswork that will
 *     eventually narrate something untrue (docs/19 section 2a). Retrofitting this once the UI, the
 *     arena and the diagnostic panel all expect a bare `Action` means touching all three.
 *   - A bot takes **`ObservedState`, never `GameState`.** Cheating is then a compile error rather
 *     than an oversight — the mistake HRF shipped, whose `cleanFor` is a no-op.
 *   - A bot is **pure and deterministic**. Two clients running the same bot on the same position
 *     must agree, or a multiplayer game forks by who posted first (docs/03 section 9a). Any
 *     randomness a later version needs comes from a journal-derived stream, never `Math.random()`.
 */

import type { Action } from '../action.js'
import type { ObservedState } from '../observe.js'

/** One candidate weighed, kept for the diagnostic panel (docs/19 section 2e). */
export interface Considered {
  readonly action: Action
  readonly score: number
  /** Optional term-level breakdown — "ambition +3.1, tempo −0.4". */
  readonly note?: string
  /**
   * Whether the anti-livelock gate would let this action be chosen — see `heuristic.ts`.
   *
   * Reported rather than filtered out, because the diagnostic panel shows everything that was
   * weighed. But it has to be *reported*, because a caller that re-ranks `considered` is otherwise
   * free to pick something the gate ruled out, and the gate's termination argument only holds if
   * every repeat strictly improves. `easy.ts` was doing exactly that, and hung one game in five.
   *
   * Absent means eligible: bots that have no gate leave it off.
   */
  readonly eligible?: boolean
}

export interface BotDecision {
  readonly action: Action
  /**
   * One line, written for a *player*: "Taking 2-Arrow — the last Fuel I need for Tycoon."
   *
   * Not a debug string. It is shown during the bot's turn (docs/19 section 2a), and because it
   * comes from the same computation as `action`, it cannot drift from what actually happened.
   */
  readonly because: string
  /**
   * Everything weighed, for the diagnostic panel. Absent for bots that do not evaluate.
   *
   * The panel must display *this*, not a re-run — a re-run debugs a different call, and hides any
   * accidental non-determinism precisely when it matters (docs/19 section 2e).
   */
  readonly considered?: readonly Considered[]
}

/**
 * Choose among the actions the engine is offering.
 *
 * `actions` comes straight from the `ask` — already legality-checked and `canTake`-filtered, which
 * is why docs/19 section 1 closes the `legalActions` prerequisite as satisfied by a different
 * shape. A bot never has to work out what is legal.
 */
/**
 * What one candidate action leads to.
 *
 * `repeats` exists because of a livelock the arena found on its first real run, and the reasoning
 * matters more than the flag: the bot faced `arrange your resource slots`, where swapping two
 * tokens is value-identical to `Done` — the value function prices resources by type, never by slot.
 * Tied, so the first offer won, and the first offer was a swap. Forever.
 *
 * **No pure position-scoring bot can escape that.** Identical position, identical choice, by
 * definition of purity — so the way out cannot be a weight. It has to be information, and the only
 * thing that separates "swap" from "Done" is that one leaves you facing the same question. The
 * harness holds the continuation and the bot does not, so the harness is the only place that can
 * see it. That is the same reason `Lookahead` exists at all.
 *
 * This stays deterministic across clients: it is computed from the position, not from history, so
 * two clients running the bot still agree (docs/03 section 9a).
 */
export interface Probe {
  /** The first sample. Equivalent to `samples[0]`, kept for bots that do not average. */
  readonly observed: ObservedState
  /**
   * The action leaves this bot facing the same question — it did not advance the game.
   *
   * A hint, not a prohibition. An action that repeats the ask but genuinely *improves* the position
   * is fine and common — taking one pip of several. What is never right is choosing to repeat a
   * question when it gains nothing.
   */
  readonly repeats: boolean
  /**
   * Action pips this turn still has to spend, once the position settles.
   *
   * **Here rather than in `ObservedState` because it is not in the state.** Pips live on the
   * continuation (docs/19 section 1.5), so `valueOf` structurally cannot see them — and that is
   * precisely why leading a card scored as pure cost. The card left your hand, which the tempo term
   * charges for, and bought three actions, which nothing counted.
   *
   * Zero when the turn is over or the position never reaches the pip phase, which is what makes
   * `Pass` comparable: passing buys no actions, and now says so.
   *
   * **Zero also means "cannot tell", which is why rollbacks must not be candidates.** An action
   * landing mid-resolution — the dice of a battle it just started — has no pip ask to read and
   * reports 0, while a `Cancel` beside it returns to the pip ask and reports 1. That paid the bot
   * half a pip to abandon each fight, and it cancelled 31 battles for every 4 it rolled. The fix is
   * `refuses` in the heuristic bot, which drops rollbacks before anything is weighed — pricing them
   * differently was tried first and measurably cost 3 power a game, because the same adjustment
   * also docked the legitimate `Done` that ends a sub-decision.
   */
  readonly actionsAhead: number
  /**
   * The position after this action, sampled — several times when the outcome is random.
   *
   * **A probe must not see the roll that will really happen.** `state.rng` is a seeded generator
   * carried in the state, and `advance` is pure, so every candidate was probed from the *same*
   * generator and returned the exact dice that choice would produce. Committing it then reproduced
   * them, because the real generator had never moved. The bot was picking pools by outcome rather
   * than by odds — measurably: it chose two dice over three, which no honest evaluator does, because
   * that particular roll came up better.
   *
   * Nothing was reaching into hidden state. `ObservedState` correctly hides rivals' hands and strips
   * `rng`. The bot simply asked the engine what would happen and a deterministic engine told it the
   * truth about the future — the same trap docs/03 flags in HRF, arriving through randomness rather
   * than through cards.
   *
   * So probes run on a **derived generator**, independent of the real one and reproducible from the
   * journal, which keeps two clients in agreement (docs/03 section 9a). Where randomness is actually
   * consumed there is more than one sample, and a bot should average over all of them: one sample
   * removes the cheating but replaces it with noise, and averaging is what turns the choice back
   * into a judgement about odds.
   */
  readonly samples: readonly ObservedState[]
}

/**
 * Apply an action and report where it leads, as *this bot* would see it.
 *
 * The harness supplies it, because scoring a move means applying it and only the caller holds the
 * full `GameState` — handing that to the bot would undo the whole point of `ObservedState`. So the
 * one-ply lookahead docs/03 section 2 describes is split: the harness advances, the bot sees the
 * result through the same redaction as everything else.
 *
 * Returns `undefined` when the action cannot be applied — a bot must cope rather than assume.
 */
export type Lookahead = (action: Action) => Probe | undefined

/**
 * Where a multi-step line of play lands.
 *
 * The V3 counterpart of `Probe`, for a bot that searches *sequences* rather than pricing single
 * actions. Same division of labour as `Lookahead` and `Rollout`: the harness applies the line,
 * because only it holds the full `GameState`; the bot sees the landing position through the same
 * redaction as everything else.
 */
export interface PathProbe {
  /** The landing position in the salt-0 world. Equivalent to `samples[0]`. */
  readonly observed: ObservedState
  /**
   * The landing position under several derived generators — more than one only when the line
   * consumed randomness. A line through a battle must be judged on odds, not on one imaginary
   * roll: the same argument as `Probe.samples`, compounded over however many rolls the line made.
   */
  readonly samples: readonly ObservedState[]
  /**
   * What the landing ask offers this faction, or `[]` when the line has left its hands — the turn
   * passed to a rival, the game ended, or the engine stopped asking. `[]` is what tells a search
   * the line is complete rather than extendable.
   */
  readonly actions: readonly Action[]
  /** The landing ask still belongs to this faction. Redundant with `actions.length` today, kept explicit. */
  readonly mine: boolean
  /**
   * The landing ask's prompt, when it has one. A search needs it for the same reason `stepBot`
   * keeps `AskedThisTurn`: the engine writes progress into prompts ("action 2 of 3"), so a line
   * that lands on a byte-identical prompt without improving the position is going in circles — the
   * arrange sub-flow's value-neutral swaps filled every beam to its depth cap before this existed,
   * and each card line scored as "played, bought nothing".
   */
  readonly prompt?: string
}

/**
 * Apply a whole line of actions hypothetically and report where it lands.
 *
 * `path` starts from the ask being decided: `explore([a])` is `lookahead(a)` without the settling,
 * and `explore([a, b, c])` is the position three of this faction's answers deep. Returns
 * `undefined` when any step of the line cannot be applied — a searched line that has become
 * illegal is a dead branch, not an error.
 *
 * Like every probe, lines run on derived generators (`probeFrom`), never the game's own — a search
 * that saw the real dice would be the section 2k oracle compounded over every step of every line.
 */
export type Explore = (path: readonly Action[]) => PathProbe | undefined

export interface ForeseeOptions {
  /**
   * Determinized deals of the rivals' hands, outcomes averaged by the bot.
   *
   * One deal judges the replies off a single imaginary distribution of the unseen cards — the
   * hand-shaped version of judging a roll by one sample. A few deals make it a judgement about
   * what rivals *could* hold, which is all this faction is entitled to know.
   */
  readonly deals: number
  /** Step cap for the reply drive; a reply that stalls is scored where it stopped. */
  readonly maxSteps?: number
}

/**
 * Apply a line, then let the rivals answer it: play every other faction's turns until the ask
 * returns to self, and report how the position looks on the far side — once per deal.
 *
 * The V4 counterpart of `Explore`, and the one place the engine models opponents at all. Two rules
 * make it honest:
 *
 *   - **Rivals play sampled hands, never their real ones.** Their true hands are hidden from this
 *     faction, and a reply computed from them is the docs/19 section 2k oracle wearing cards
 *     instead of dice. The harness deals each rival a hand from the unseen pool — deck, rivals'
 *     hands and discard pooled together, which is exactly this faction's information set — under a
 *     journal-derived generator, so it is reproducible on any client and independent of the truth.
 *   - **The reply model is fixed.** Rivals are played by the shipped one-ply bot, the measured
 *     opponent, and nothing about the line being judged can change how they are modeled.
 */
export type Foresee = (
  path: readonly Action[],
  options: ForeseeOptions,
) => readonly ObservedState[]

export interface RolloutOptions {
  /** Playouts per candidate; averaged, so this is the accuracy-against-noise dial. */
  readonly samples: number
  /**
   * Turns to play past your own before scoring.
   *
   * 0 stops at the end of your own turn — enough to see what the card actually bought. Higher lets
   * rivals reply, which is the thing a static evaluator cannot do at all.
   */
  readonly lookaheadTurns: number
  /** Hard ceiling on engine steps per playout, so an unexpected loop cannot hang a turn. */
  readonly maxSteps: number
  /**
   * Play to the end of the chapter instead of counting turns, and score once ambitions have paid.
   *
   * **The only horizon at which a rollout sees something the evaluator cannot.** A short playout is
   * scored by the same `valueOf` the bot would have used anyway, so it is a noisy re-measurement of
   * the evaluator rather than new evidence — which is why a two-turn horizon left V2 level with V1
   * over 120 games. At chapter end the ambitions have actually scored and `power` is realised, so
   * the payoff a static evaluator can only guess at is present in the position being measured.
   *
   * Costs a whole chapter of engine steps per playout, so it is the expensive option by a wide
   * margin and `maxSteps` is what stops it running away.
   */
  readonly untilChapterEnd?: boolean
}

/**
 * Play an action out to a horizon and report how the position looks, several times over.
 *
 * The V2 counterpart of `Lookahead`, and split for the same reason: a rollout has to **drive the
 * engine**, and only the harness holds the full `GameState`. Handing that to a bot to drive would
 * undo the redaction that makes cheating a compile error, so the harness plays and the bot judges.
 *
 * **The options come from the caller, not the harness.** They were briefly a harness constant, which
 * silently made every configuration identical — two bots built with different horizons played the
 * same games and the arena compared them to each other. How deep to look is the bot's policy.
 *
 * Returns an empty array when the harness cannot roll out, which a bot must treat as "evaluate this
 * some other way" rather than as "this action is worthless".
 */
export type Rollout = (action: Action, options: RolloutOptions) => readonly ObservedState[]

export interface Bot {
  readonly id: string
  /**
   * `lookahead` is absent for callers that cannot supply it. A bot that needs it must degrade
   * rather than throw: an evaluator with no lookahead is a worse bot, not a broken game.
   */
  decide(
    observed: ObservedState,
    actions: readonly Action[],
    lookahead?: Lookahead,
    rollout?: Rollout,
    explore?: Explore,
    foresee?: Foresee,
  ): BotDecision
}

/**
 * Takes the first thing offered.
 *
 * Exists to prove the seat plumbing — options, the turn loop, the pacing, the diagnostic panel —
 * end to end *before* there is any evaluation to blame a bad game on. docs/19 section 5 sequences
 * it deliberately: a bot that plays badly but visibly is the right thing to debug presentation
 * against, and it keeps `because` honest from the first line, since "first legal action" is exactly
 * what it is doing.
 *
 * It is also the control in the arena. A V1 that cannot beat this convincingly is not working.
 */
export const trivialBot: Bot = {
  id: 'trivial',
  decide(_observed, actions) {
    const action = actions[0]
    if (action === undefined) {
      // The engine never asks with nothing to choose, so this is a wiring fault, not a game state.
      throw new Error('trivialBot: asked to decide with no actions on offer')
    }
    return { action, because: 'first legal action' }
  },
}
