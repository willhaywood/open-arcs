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
  declareBot,
  stepBot,
  undo as engineUndo,
} from '@arcs/engine'
import type {
  Action,
  AskedThisTurn,
  BotDecision,
  FactionId,
  NewGameOptions,
  RuleResult,
} from '@arcs/engine'
import { useSyncExternalStore } from 'react'

type Listener = () => void

class GameStore {
  private result: RuleResult | null = null
  private options: NewGameOptions | null = null
  private readonly registry = defaultRegistry()
  private readonly listeners = new Set<Listener>()

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
   * How bot turns are driven.
   *
   * `run` plays them paced so a human can follow (docs/19 section 2a); `step` waits for you to
   * advance each one; `off` hands the turn back so you can play the seat yourself (section 2e).
   * Presentation only — none of it reaches the journal, so a paced game and a skipped one produce
   * identical saves.
   */
  botMode: 'run' | 'step' | 'off' = 'run'
  /** Milliseconds between bot actions in `run`. */
  botPace = 800
  /** The last decision a bot made, for the banner and the diagnostic panel. */
  lastDecision: BotDecision | null = null
  /**
   * Decisions a human took over instead of the bot.
   *
   * Counted because the journal cannot tell afterwards who chose an action, so a game where you
   * played half the bot's turns is indistinguishable from one it played alone. Tuning against that
   * would be tuning against yourself — docs/19 section 2e.
   */
  overrides = 0

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
   * Bumped whenever bot *presentation* state changes — mode, pace, the last decision, overrides.
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

  setBotMode(mode: 'run' | 'step' | 'off'): void {
    this.botMode = mode
    this.clearBotTimer()
    this.emitBotUi()
    if (mode === 'run') this.scheduleBot()
  }

  setBotPace(ms: number): void {
    this.botPace = ms
    this.emitBotUi()
  }

  /** Take exactly one bot action now — the Step button, and the engine of `run`. */
  stepBotOnce(): void {
    if (this.result === null) return
    const faction = this.botTurn()
    if (faction === undefined) return
    const out = stepBot(this.result, declareBot, faction, this.registry, this.botAsked)
    this.result = out.result
    this.botAsked = out.asked
    this.lastDecision = out.decision
    this.emitBotUi()
    if (this.botMode === 'run') this.scheduleBot()
  }

  /**
   * Queue the next bot action.
   *
   * Cleared on every state change so undo, load and a new game cannot leave a timer running into a
   * position it was not scheduled for — the bug that turns a paced bot into one that plays a move
   * you already took back.
   */
  private scheduleBot(): void {
    this.clearBotTimer()
    if (this.botMode !== 'run' || this.botTurn() === undefined) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.stepBotOnce()
    }, this.botPace)
  }

  private clearBotTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  start(options: NewGameOptions): void {
    this.clearBotTimer()
    this.forgetBotTurn()
    this.options = options
    this.generation += 1
    this.result = startGame(options, this.registry)
    this.lastDecision = null
    this.overrides = 0
    this.emit()
    this.scheduleBot()
  }

  apply(action: Action): void {
    if (this.result === null) return
    /*
     * A human answering an Ask addressed to a bot seat is a *take-over*, and it is counted. The
     * journal records the action either way, so nothing downstream can tell — which is precisely
     * why the count has to be kept here, at the only moment it is knowable.
     */
    if (this.botTurn() !== undefined) {
      this.overrides += 1
      this.botUiVersion += 1
    }
    this.clearBotTimer()
    this.result = applyExternal(this.result, action, this.registry)
    this.emit()
    this.scheduleBot()
  }

  undo(): void {
    if (this.result === null || this.options === null) return
    /*
     * Undo stops the bot rather than stepping back and letting it immediately replay the action you
     * just took back. Resuming is an explicit choice, which is what makes undo usable for inspecting
     * a bot's turn at all.
     */
    this.clearBotTimer()
    this.forgetBotTurn()
    this.botMode = 'step'
    this.result = engineUndo(this.options, this.result, this.registry)
    this.lastDecision = null
    this.emit()
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
    this.lastDecision = null
    this.overrides = 0
    /*
     * A loaded game starts stepped, not running. `options.bots` means the seats resume as bots, but
     * firing off a paced turn the instant a file opens is startling — and if the save was parked on
     * a bot's decision to inspect, running would destroy the thing you opened it to look at.
     */
    this.botMode = 'step'
    this.emit()
  }

  reset(): void {
    this.clearBotTimer()
    this.forgetBotTurn()
    this.lastDecision = null
    this.overrides = 0
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

export function useGame(): RuleResult | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
