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
  defaultRegistry,
  loadGame,
  serializeGame,
  startGame,
  undo as engineUndo,
} from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'
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

  start(options: NewGameOptions): void {
    this.options = options
    this.generation += 1
    this.result = startGame(options, this.registry)
    this.emit()
  }

  apply(action: Action): void {
    if (this.result === null) return
    this.result = applyExternal(this.result, action, this.registry)
    this.emit()
  }

  undo(): void {
    if (this.result === null || this.options === null) return
    this.result = engineUndo(this.options, this.result, this.registry)
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
    const { options, result } = loadGame(json, this.registry)
    this.options = options
    this.result = result
    this.emit()
  }

  reset(): void {
    this.result = null
    this.options = null
    this.emit()
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const store = new GameStore()

export function useGame(): RuleResult | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
