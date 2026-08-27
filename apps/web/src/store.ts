/**
 * The engine is the store. The UI holds no rules knowledge — it renders whatever
 * `Ask(faction, actions)` the engine hands back and calls `apply` when the user picks one.
 * Wired to React with a single useSyncExternalStore. See docs/02 section 6.
 *
 * Undo, save and load are the journal design paying off (docs/11): the store keeps the
 * game options, drives the engine through `applyExternal` so every choice is recorded, and
 * defers undo/save/load to the engine's replay functions.
 */

import {
  applyExternal,
  botToAct,
  defaultRegistry,
  loadGame,
  serializeGame,
  NO_ASKS,
  startGame,
  botForLevel,
  stepBot,
  undo as engineUndo,
} from '@arcs/engine'
import type {
  Action,
  AskedThisTurn,
  FactionId,
  GameState,
  NewGameOptions,
  RuleResult,
} from '@arcs/engine'
import { useSyncExternalStore } from 'react'

import { Session } from './multiplayer/session.js'
import type { SeatView } from './multiplayer/seat.js'
import { remember } from './multiplayer/link.js'
import type { GameLink } from './multiplayer/link.js'
import type { BotEvent } from './bot-events.js'
import { buildChapterReport, buildGameHistory, chapterEnded } from './chapter-report.js'
import type { ChapterReport, GameHistory } from './chapter-report.js'

type Listener = () => void

/**
 * The full-screen moment between chapters or at the game's end, when one is showing.
 *
 * `prevState` rides along with the chapter report because the scoring step destroys its own
 * evidence — the pre-scoring holdings the screen draws (resource tokens, trophies) exist only
 * in the snapshot from before the boundary.
 */
export type Interlude =
  | { kind: 'chapter'; report: ChapterReport; prevState: GameState }
  | { kind: 'gameOver' }

/** Milliseconds between bot actions — slow enough that each on-board event reads. */
const BOT_PACE = 1500

class GameStore {
  private result: RuleResult | null = null
  private options: NewGameOptions | null = null
  private readonly registry = defaultRegistry()
  private readonly listeners = new Set<Listener>()

  /**
   * The multiplayer session, when this game is a joined one.
   *
   * `null` for a local hotseat game, which stays the default and the way the rules are tested
   * (docs/17 section 7). Multiplayer is a second mode, not a replacement — so everything below has
   * to behave identically when this is null, and the two hooks that use it are the only places that
   * know it exists.
   */
  private session: Session | null = null

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getSnapshot = (): RuleResult | null => this.result

  /**
   * How many games have been started this session.
   *
   * Two games from the same seed are identical in state, so nothing the engine holds can tell them
   * apart — which is a problem for anything that should replay per game rather than per position.
   * The draft's deal animation keys off this; see `DraftScreen`.
   */
  generation = 0

  // --- bot seats ------------------------------------------------------------

  /**
   * Bot turns always run, paced so a human can follow (docs/19 section 2a) — the step/take-over
   * panel is gone; the pacing plus the on-board event visuals (`bot-events.ts`) are the whole
   * presentation. Presentation only — none of it reaches the journal, so a paced game and a
   * skipped one produce identical saves.
   */
  /** The last few bot actions, drawn on the board and the side surfaces as they happen. */
  botEvents: BotEvent[] = []
  private nextEventId = 1

  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * Questions already put to the seat currently acting, so a bot can tell re-entry from progress.
   *
   * Threaded here as well as in the arena's loop because a livelocked bot in the browser is a frozen
   * tab, which is the worst place to discover it. `stepBot` handles the turn boundary itself; the
   * store only has to drop it when the position is *rebuilt*, since after an undo or a load the
   * history describes a game that no longer exists.
   */
  private botAsked: AskedThisTurn = NO_ASKS

  private forgetBotTurn(): void {
    this.botAsked = NO_ASKS
  }

  /**
   * Bumped whenever bot *presentation* state changes — the event feed the surfaces draw.
   *
   * `getSnapshot` returns `this.result`, so `useSyncExternalStore` compares object identity and
   * bails out when the position has not moved. Every one of those fields can change without the
   * position moving, and switching mode silently did nothing as a result: the store updated, the
   * event fired, React re-used the old render. A separate primitive snapshot is what makes those
   * changes visible.
   */
  botUiVersion = 0

  private emitBotUi(): void {
    this.botUiVersion += 1
    this.emit()
  }

  getBotUiSnapshot = (): number => this.botUiVersion

  /** Whose turn it is, if a bot should take it. */
  botTurn(): FactionId | undefined {
    if (this.result === null) return undefined
    return botToAct(this.result, this.options?.bots)
  }

  /** The seats played by bots, for surfaces that must not treat them as local players. */
  botSeats(): readonly FactionId[] {
    return this.options?.bots ?? []
  }

  // --- interludes -----------------------------------------------------------

  /*
   * Chapter scoring happens inside a single engine step — the milestone never surfaces as a
   * continue — so the store watches for the boundary itself: every path that moves the position
   * hands its before/after pair to `detectInterlude`. Presentation only, like the bot events:
   * nothing here reaches the journal.
   */
  interlude: Interlude | null = null
  private interludeVersion = 0
  getInterludeSnapshot = (): number => this.interludeVersion

  private openInterlude(v: Interlude): void {
    this.interlude = v
    this.interludeVersion += 1
    this.emit()
  }

  private clearInterlude(): void {
    if (this.interlude === null) return
    this.interlude = null
    this.interludeVersion += 1
  }

  /** Close the screen and, after a beat, let the bots play on. */
  dismissInterlude(): void {
    this.clearInterlude()
    this.emit()
    this.scheduleBot(BOT_PACE * 2)
  }

  /** The "View summary" path: a finished game's screen can always be brought back. */
  reopenGameOver(): void {
    if (this.result?.state.isOver === true) this.openInterlude({ kind: 'gameOver' })
  }

  /** Whether every seat is a bot — the interlude auto-dismisses then, so the show keeps rolling. */
  allBots(): boolean {
    const bots = this.botSeats()
    return this.result !== null && this.result.state.factions.every((f) => bots.includes(f))
  }

  /** Every chapter's scoring, rebuilt from the journal. Only meaningful once the game is over. */
  history(): GameHistory | null {
    if (this.result === null || this.options === null || !this.result.state.isOver) return null
    return buildGameHistory(this.options, this.result.state.journal, this.registry)
  }

  /**
   * Open the right screen for the boundary just crossed, if one was. Returns true when a chapter
   * interlude opened — the caller must then *not* re-arm the bot timer, so play holds under the
   * screen; `dismissInterlude` re-arms it.
   *
   * Game over needs no pause (there is no next bot move) and takes precedence: the final
   * chapter's scoring never bumps the counter and appears inside the game-over history instead
   * of as a second stacked screen.
   */
  private detectInterlude(prev: RuleResult): boolean {
    const next = this.result
    if (next === null) return false
    if (next.state.isOver && !prev.state.isOver) {
      this.openInterlude({ kind: 'gameOver' })
      return false
    }
    /*
     * `prev.chapter >= 1` guards the draft: a Leaders & Lore game sits at chapter 0 until the
     * last pick, so the 0 -> 1 bump is the game *starting*, not a chapter ending.
     */
    if (prev.state.chapter >= 1 && chapterEnded(prev.state, next.state)) {
      // The hold is enforced here, not left to the caller: any timer already armed when the
      // boundary is crossed would play a move under the screen.
      this.clearBotTimer()
      this.openInterlude({
        kind: 'chapter',
        report: buildChapterReport(prev.state, next.state),
        prevState: prev.state,
      })
      return true
    }
    return false
  }

  /**
   * Whether bot seats may run at all.
   *
   * **False in a joined game, deliberately.** Bot moves are applied by `stepBotOnce`, which sets
   * state directly rather than going through `apply` — so they would never reach the publish hook.
   * Every client would compute its own bot move, keep it locally, and then append the server's
   * entries on top of it: divergence, silently, with no error anywhere.
   *
   * docs/17 section 6a has the real design — whichever client notices a bot's turn computes and
   * posts it, with the `expectedLength` check making the race harmless. It also names the price:
   * the bot must be **deterministic** given observed state and a journal-derived seed, or two
   * clients disagree and the game forks by who posted first. That is true of the current evaluator
   * and not of a rollout bot, so it is a decision to make rather than an oversight to fix quietly.
   *
   * Until then, refusing to run is the honest behaviour. A missing feature is recoverable; a
   * corrupted journal is not.
   */
  botsAvailable(): boolean {
    return this.session === null
  }

  stepBotOnce(): void {
    if (this.result === null || !this.botsAvailable()) return
    const faction = this.botTurn()
    if (faction === undefined) return
    const prev = this.result
    // The log lines appended by this one action are the event's own narration (bot-events.ts).
    const logBefore = prev.state.log.length
    const out = stepBot(prev, botForLevel(this.options?.botLevel), faction, this.registry, this.botAsked)
    this.result = out.result
    this.botAsked = out.asked
    this.botEvents = [
      ...this.botEvents.slice(-7),
      {
        id: this.nextEventId++,
        faction,
        action: out.decision.action,
        lines: out.result.state.log.slice(logBefore),
        at: performance.now(),
      },
    ]
    this.emitBotUi()
    // A chapter interlude holds the game: the timer re-arms when it is dismissed.
    if (!this.detectInterlude(prev)) this.scheduleBot()
  }

  /**
   * Queue the next bot action.
   *
   * Cleared on every state change so undo, load and a new game cannot leave a timer running into a
   * position it was not scheduled for — the bug that turns a paced bot into one that plays a move
   * you already took back.
   */
  private scheduleBot(delay: number = BOT_PACE): void {
    this.clearBotTimer()
    // See `botsAvailable` — a bot seat in a joined game would diverge silently.
    if (!this.botsAvailable()) return
    if (this.botTurn() === undefined) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.stepBotOnce()
    }, delay)
  }

  private clearBotTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  // --- multiplayer ----------------------------------------------------------

  /**
   * Join a game over the network. The session owns polling; this owns the state it writes into.
   */
  async joinSession(baseUrl: string, link: GameLink): Promise<void> {
    this.leaveSession()
    this.clearBotTimer()
    const session = new Session(baseUrl, link, {
      current: () => this.result,
      adopt: (options, result) => {
        this.options = options
        this.result = result
        this.generation += 1
        this.botEvents = []
        this.clearInterlude()
        this.emit()
        // Adopting a finished game shows its summary, same as loading one.
        if (result.state.isOver) this.openInterlude({ kind: 'gameOver' })
      },
      applyRemote: (action) => {
        if (this.result === null) return
        /*
         * The second hook. Identical to `apply` except that it does **not** publish — an action that
         * arrived from the server must not be sent back to it, which would append it twice.
         */
        const prev = this.result
        this.result = applyExternal(prev, action, this.registry)
        this.emit()
        // Screens show for every client; dismissal is local. Bots are off in joined games.
        this.detectInterlude(prev)
      },
    })
    this.session = session
    remember(link)
    await session.join()
  }

  leaveSession(): void {
    this.session?.leave()
    this.session = null
  }

  /** The joined game's link, or `null` when playing locally. */
  sessionLink(): GameLink | null {
    return this.session?.link ?? null
  }

  /** A spectator holds no seat and may watch only. */
  isSpectator(): boolean {
    return this.session?.isSpectator ?? false
  }

  /**
   * What this client is: playing every seat, holding one, or watching.
   *
   * The one question the whole seat boundary is built on, and it is three-valued on purpose —
   * "hotseat" and "spectator" both mean "no single faction" and want opposite behaviour. Which
   * faction a token belongs to is answered by the server, because the token is opaque and the
   * client cannot decode it (`session.ts`).
   */
  seatView(): SeatView {
    if (this.session === null) return { kind: 'hotseat' }
    const faction = this.session.faction
    // Before the join read lands there is no seat to name; watching is the safe reading of that.
    /*
     * The one cast in the seat boundary, and the right place for it: the server answers with a
     * plain string because it must not import the engine's `FactionId` (docs/17 rule 4), so this is
     * where an untyped wire value becomes a domain type.
     */
    return faction === null ? { kind: 'spectator' } : { kind: 'seat', faction: faction as FactionId }
  }

  /**
   * Whether this client may take `action` itself.
   *
   * Always true in a hotseat game — playing every seat is the point of hotseat, and the rules are
   * tested through it. In a joined game it is true only for your own faction: a spectator may take
   * nothing, and neither may you on someone else's behalf.
   *
   * The check is here rather than only in the components because of *optimism*. A move is applied
   * locally before it is published (`session.ts`), so an action that the server would reject must
   * never be applied either — otherwise the board shows a move that no other client will ever see,
   * and it survives until the next resync. Refusing at the door keeps local and remote in step.
   */
  mayAct(action: Action): boolean {
    const view = this.seatView()
    if (view.kind === 'hotseat') return true
    if (view.kind === 'spectator') return false
    const actor = action['faction']
    // An action with no actor is engine-internal, not a player's move, so the seat says nothing.
    return typeof actor !== 'string' || actor === view.faction
  }

  start(options: NewGameOptions): void {
    // Starting a local game abandons any joined one; they are different games by definition.
    this.leaveSession()
    this.clearBotTimer()
    this.forgetBotTurn()
    this.options = options
    this.generation += 1
    this.result = startGame(options, this.registry)
    this.botEvents = []
    this.clearInterlude()
    this.emit()
    this.scheduleBot()
  }

  apply(action: Action): void {
    if (this.result === null) return
    if (!this.mayAct(action)) return
    this.clearBotTimer()
    /*
     * The first hook. Read the length *before* applying: that is what the server compares against,
     * and it is what makes a double-tap or a stale tab a no-op rather than a duplicated action.
     */
    const expectedLength = this.result.state.journal.length
    const prev = this.result
    this.result = applyExternal(prev, action, this.registry)
    this.emit()
    /*
     * Published without waiting. The move is already on screen, and the only outcome needing a
     * response is a conflict — which `Session.publish` resolves by replaying the authoritative
     * journal, so there is nothing here to await or unwind.
     */
    void this.session?.publish(action, expectedLength)
    // A human's own action can end the chapter too; the interlude then holds the bots.
    if (!this.detectInterlude(prev)) this.scheduleBot()
  }

  undo(): void {
    if (this.result === null || this.options === null) return
    /*
     * Undo must not let the bot immediately replay the action you just took back. With no panel to
     * resume from, stopping outright would deadlock a bot turn instead — so the next bot step is
     * rescheduled with a grace delay: long enough to undo again (each undo re-arms it), no button
     * needed.
     */
    this.clearBotTimer()
    this.forgetBotTurn()
    this.result = engineUndo(this.options, this.result, this.registry)
    this.botEvents = []
    this.clearInterlude()
    this.emit()
    this.scheduleBot(BOT_PACE * 2)
  }

  canUndo(): boolean {
    return (this.result?.state.journal.length ?? 0) > 0
  }

  /** JSON for a save file, or null if no game is in progress. */
  toJSON(): string | null {
    if (this.result === null || this.options === null) return null
    return serializeGame(this.options, this.result)
  }

  /** Load a save file's JSON. Throws (with a clear message) on a bad file. */
  load(json: string): void {
    this.clearBotTimer()
    this.forgetBotTurn()
    const { options, result } = loadGame(json, this.registry)
    this.options = options
    this.result = result
    this.botEvents = []
    this.clearInterlude()
    /*
     * Firing off a bot move the instant a file opens is startling — a save parked on a bot's
     * decision is usually opened to look at it. The grace delay gives a beat to look (and Undo
     * re-arms the same delay) without needing a resume button.
     */
    this.emit()
    // A finished save opens on its summary.
    if (result.state.isOver) this.openInterlude({ kind: 'gameOver' })
    this.scheduleBot(BOT_PACE * 2)
  }

  reset(): void {
    this.clearBotTimer()
    this.forgetBotTurn()
    this.botEvents = []
    this.clearInterlude()
    this.result = null
    this.options = null
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const store = new GameStore()

/**
 * Subscribe to bot presentation state — mode, pace, last decision, override count.
 *
 * Separate from `useGame` because those change without the position changing, and `useGame`'s
 * snapshot is the position. A component showing both needs both.
 */
export function useBotUi(): number {
  return useSyncExternalStore(store.subscribe, store.getBotUiSnapshot, store.getBotUiSnapshot)
}

/** Subscribe to the interlude — the chapter/game-over screen state, separate from the position. */
export function useInterlude(): number {
  return useSyncExternalStore(store.subscribe, store.getInterludeSnapshot, store.getInterludeSnapshot)
}

export function useGame(): RuleResult | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
