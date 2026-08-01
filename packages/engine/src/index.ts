/**
 * @arcs/engine — rules, state and serialization for Arcs.
 *
 * Contract (docs/02-technology-choice.md section 4.1):
 *   - zero runtime dependencies
 *   - no DOM: runs identically in a browser, in Node and in a Worker
 *   - pure: (state, action) => Continue, no IO, no clock, no global randomness
 *   - immutable state with structural sharing
 */

export * from './ids.js'
export * from './rng.js'
export * from './tracker.js'
export * from './board.js'
export * from './action.js'
export * from './continue.js'
export * from './state.js'
export * from './dispatch.js'
export * from './observe.js'
export * from './ai/bot.js'
export * from './ai/intent.js'
export * from './ai/value.js'
export * from './ai/income.js'
export * from './ai/heuristic.js'
export * from './ai/baseline.js'
export * from './ai/goal.js'
export * from './ai/play.js'
export * from './ai/rollout.js'
export * from './ai/arena.js'
export * from './cards.js'
export * from './resources.js'
export * from './outrage.js'
export * from './prelude.js'
export * from './court.js'
export * from './leaders.js'
export * from './lore.js'
export * from './guild-actions.js'
export * from './control.js'
export * from './dice.js'
export {
  CITIES_PER_FACTION,
  SHIPS_PER_FACTION,
  STARPORTS_PER_FACTION,
  SetupModule,
  StartSetup,
} from './rules/setup.js'
export { TurnModule, StartChapter } from './rules/turn.js'
export { StandardActionsModule, canTake } from './rules/standard-actions.js'
export {
  AmbitionsModule,
  MARKERS,
  chapterAmbitionable,
  ambitionsForStrength,
  metric,
} from './rules/ambitions.js'
export { BattleModule, canBattle } from './rules/battle.js'
export { LeadersModule } from './rules/leaders.js'
export { VoxModule } from './rules/vox.js'

import { board } from './board.js'
import { RuleRegistry, advance } from './dispatch.js'
import type { RuleResult } from './dispatch.js'
import type { ColorId, FactionId } from './ids.js'
import { rng } from './rng.js'
import { AmbitionsModule } from './rules/ambitions.js'
import { LeadersModule } from './rules/leaders.js'
import { BattleModule } from './rules/battle.js'
import { SetupModule, StartSetup } from './rules/setup.js'
import { StandardActionsModule } from './rules/standard-actions.js'
import { TurnModule } from './rules/turn.js'
import { VoxModule } from './rules/vox.js'
import { AMBITIONS } from './state.js'
import type { LeadersAndLoreOptions } from './leaders.js'
import type { GameState } from './state.js'
import { emptyTracker } from './tracker.js'

export interface NewGameOptions {
  /** Required, never defaulted — see docs/05-board-topology.md section 2. */
  readonly board: string
  readonly factions: readonly FactionId[]
  readonly seed: number
  /** Campaign only. Phase 2 adds 'empire', 'blights', 'free'. */
  readonly npcColors?: readonly ColorId[]
  /** Omitted for a base game; present to play with leaders and lore. */
  readonly leadersAndLore?: LeadersAndLoreOptions
  /**
   * Seats played by a bot.
   *
   * **Here rather than beside the save because replay needs it.** The journal records actions, not
   * who chose them, so a bot's game replays byte-for-byte as a human's — but a *loaded* game has to
   * know whether to compute blue's turn or wait for a human, and without this it stalls forever on
   * a player who is not there. It is a property of how the game was set up, which is what `options`
   * is for. See docs/19 section 2 and docs/03 section 9a.
   */
  readonly bots?: readonly FactionId[]
}

export function defaultRegistry(): RuleRegistry {
  return new RuleRegistry()
    .register(LeadersModule)
    .register(SetupModule)
    .register(TurnModule)
    .register(AmbitionsModule)
    .register(StandardActionsModule)
    .register(BattleModule)
    .register(VoxModule)
}

export function createGame(options: NewGameOptions): GameState {
  const variant = board(options.board)

  if (options.factions.length === 0) throw new Error('a game needs at least one faction')
  if (variant.starting.length > 0 && options.factions.length !== variant.starting.length) {
    throw new Error(
      `board ${variant.name} seats ${variant.starting.length} factions, got ${options.factions.length}`,
    )
  }

  return {
    board: variant,
    factions: [...options.factions],
    colors: [...options.factions, ...(options.npcColors ?? [])],
    ruleChain:
      options.leadersAndLore === undefined
        ? ['setup', 'turn', 'ambitions', 'standard-actions', 'battle', 'vox']
        : ['leaders', 'setup', 'turn', 'ambitions', 'standard-actions', 'battle', 'vox'],
    act: 0,
    chapter: 0,
    round: 0,
    current: undefined,
    figures: emptyTracker(),
    cards: emptyTracker(),
    resources: emptyTracker(),
    courtCards: emptyTracker(),
    taxedThisTurn: [],
    workedThisTurn: [],
    loreUsedThisTurn: [],
    unslotted: [],
    planetTypes: {},
    unusedLore: [],
    usedThisTurn: [],
    damaged: [],
    lastRoll: undefined,
    leadersAndLore: options.leadersAndLore,
    leaders: {},
    lores: {},
    draft: undefined,
    outraged: {},
    anyBattle: false,
    rng: rng(options.seed),
    initiativeOrder: [...options.factions],
    lead: undefined,
    roundPlays: [],
    seized: undefined,
    passed: 0,
    ambitions: [...AMBITIONS],
    ambitionable: [],
    declared: [],
    power: Object.fromEntries(options.factions.map((f) => [f, 0])),
    journal: [],
    log: [],
    isOver: false,
    winners: [],
  }
}

/** Create a game and run setup to the first decision point. */
export function startGame(
  options: NewGameOptions,
  registry: RuleRegistry = defaultRegistry(),
): RuleResult {
  return advance(createGame(options), StartSetup(), registry)
}

// --- journal: undo / save / load -------------------------------------------
//
// A game is its options plus the ordered list of external (player-chosen) actions. Because
// the engine is deterministic — all randomness is the seeded RNG in state — replaying that
// list from a fresh game reproduces the exact state. That single fact gives undo, save and
// load for free. See docs/01 section 3.4 and docs/11-persistence.md.

import { decodeAction, encodeAction } from './action.js'
import type { Action } from './action.js'

/**
 * Apply a player-chosen action and record it in the journal. This is the recording
 * counterpart to `advance`; the UI and the arena drive games through it so the journal
 * stays authoritative.
 */
export function applyExternal(
  result: RuleResult,
  action: Action,
  registry: RuleRegistry = defaultRegistry(),
): RuleResult {
  const next = advance(result.state, action, registry)
  return {
    ...next,
    state: { ...next.state, journal: [...result.state.journal, encodeAction(action)] },
  }
}

/** Rebuild a game from its options and a journal of encoded external actions. */
export function replayGame(
  options: NewGameOptions,
  journal: readonly string[],
  registry: RuleRegistry = defaultRegistry(),
): RuleResult {
  let result = startGame(options, registry)
  for (const encoded of journal) {
    result = applyExternal(result, decodeAction(encoded), registry)
  }
  return result
}

/** Step back one external action by replaying the journal minus its last entry. */
export function undo(
  options: NewGameOptions,
  result: RuleResult,
  registry: RuleRegistry = defaultRegistry(),
): RuleResult {
  const journal = result.state.journal
  if (journal.length === 0) return result
  return replayGame(options, journal.slice(0, -1), registry)
}

export const SAVE_VERSION = 1

export interface SavedGame {
  readonly version: number
  readonly options: NewGameOptions
  readonly journal: readonly string[]
}

/** Serialize a game to a portable, diffable JSON string. Tiny — it is the journal, not state. */
export function serializeGame(options: NewGameOptions, result: RuleResult): string {
  const save: SavedGame = {
    version: SAVE_VERSION,
    options,
    journal: result.state.journal,
  }
  return JSON.stringify(save, null, 2)
}

/** Parse and rebuild a saved game. Throws with a clear message on a bad or wrong-version file. */
export function loadGame(
  json: string,
  registry: RuleRegistry = defaultRegistry(),
): { options: NewGameOptions; result: RuleResult } {
  let save: SavedGame
  try {
    save = JSON.parse(json) as SavedGame
  } catch {
    throw new Error('not a valid save file (invalid JSON)')
  }
  if (save.version !== SAVE_VERSION) {
    throw new Error(`unsupported save version ${save.version} (expected ${SAVE_VERSION})`)
  }
  if (save.options === undefined || !Array.isArray(save.journal)) {
    throw new Error('save file is missing options or journal')
  }
  return { options: save.options, result: replayGame(save.options, save.journal, registry) }
}
