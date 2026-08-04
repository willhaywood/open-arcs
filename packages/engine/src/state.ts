/**
 * Game state. Immutable — every rule returns a new state sharing structure with the old.
 *
 * Two things here are load-bearing for phase 2:
 *
 *  - `ruleChain` is a list of module *ids*, held in state, not a static list assembled at
 *    startup. Fates attach mid-campaign (HRF: `game.expansions = fate.expansion +: ...`),
 *    so the chain has to be modifiable at runtime. Storing ids rather than functions also
 *    keeps state serializable. See docs/04 section 2.2.
 *  - `act` is carried even though phase 1 never leaves 0, so the campaign's act structure
 *    costs no save-format change. See docs/04 section 2.7.
 */

import type { BoardVariant } from './board.js'
import type { DieRoll } from './dice.js'
import type { LeadersAndLoreOptions } from './leaders.js'
import type { Suit } from './cards.js'
import type { ColorId, FactionId, SystemId } from './ids.js'
import type { Resource } from './resources.js'
import type { Rng } from './rng.js'
import type { Tracker } from './tracker.js'

export type RuleModuleId = string

/** The card currently leading the round, with the suit it was declared as. */
export interface Lead {
  readonly faction: FactionId
  readonly cardId: string
  readonly suit: Suit
  readonly strength: number
  readonly pips: number
  /** Set when the lead player declared an ambition — the card counts as strength 0. */
  readonly zeroed: boolean
}

export const AMBITIONS = ['Tycoon', 'Tyrant', 'Warlord', 'Keeper', 'Empath'] as const
export type Ambition = (typeof AMBITIONS)[number]

/** An ambition value box: `high` power to first place, `low` to second. */
export interface AmbitionMarker {
  readonly high: number
  readonly low: number
}

/** A marker placed on an ambition by declaring it. */
export interface Declaration {
  readonly ambition: Ambition
  readonly marker: AmbitionMarker
}

/**
 * A card played in the current round, and how. The physical board has a Lead slot and a
 * Surpass/Copy/Pivot slot; this is what fills them. Cleared at the start of each round.
 */
export interface RoundPlay {
  readonly faction: FactionId
  readonly cardId: string
  readonly kind: 'lead' | 'surpass' | 'copy' | 'pivot'
}

export interface GameState {
  readonly board: BoardVariant
  /** Seating order. */
  readonly factions: readonly FactionId[]
  /** Every color with pieces, including rules-driven NPC colors in the campaign. */
  readonly colors: readonly ColorId[]

  readonly ruleChain: readonly RuleModuleId[]

  readonly act: number
  readonly chapter: number
  readonly round: number

  readonly current: FactionId | undefined
  readonly figures: Tracker
  readonly cards: Tracker
  readonly resources: Tracker
  /** Court cards: the deck, the four display slots, each faction's secured pile, discard. */
  readonly courtCards: Tracker
  readonly rng: Rng

  /**
   * Cities taxed this turn, as figure ids — each City is taxed at most once per turn.
   * Tracked per city, not per system: 8 of the 18 planets have two building slots, so a
   * faction can hold two Cities in one system and may tax each. Mirrors HRF's
   * `f.taxed.cities` (game-common.scala:730, set at :744). Reset at end of turn.
   */
  readonly taxedThisTurn: readonly string[]

  /**
   * Buildings used to build a Ship this turn (figure ids). A Starport may produce at most
   * one Ship per turn — HRF's `worked` set, disabled with "built this turn"
   * (game-common.scala:916, set at :1019, cleared at :2142). Reset at end of turn.
   */
  readonly workedThisTurn: readonly string[]
  /**
   * Lore cards whose once-per-turn use is spent, cleared at end of turn.
   *
   * Separate from `workedThisTurn` (which tracks *buildings*) because these are cards, and HRF
   * keeps the same split — `f.used` for effects, `f.worked` for the things they act on.
   */
  readonly loreUsedThisTurn: readonly string[]
  /**
   * City figure ids standing **outside** their planet's building slots, which only Cloud Cities
   * (lore09) can produce. They are ordinary cities in every other respect — they rule, they can be
   * razed, they come off your player board — they just do not consume a slot, and they are how the
   * card's "max 1 per planet" is counted.
   */
  readonly unslotted: readonly string[]

  /**
   * Planets whose type has been changed by Mythic (Shaper, leader14), overriding the resource
   * printed on the board: "From now on, its planet type is the placed resource."
   *
   * A system present here has already been changed, which is also how the card's "cannot be
   * changed again with *Mythic*" is enforced — no separate used-list is needed. Read through
   * `planetResource`, never off `system(id).resource` directly.
   */
  readonly planetTypes: Readonly<Partial<Record<SystemId, Resource>>>

  /**
   * Court cards whose once-per-turn ability has been used (HRF's `f.used`). Reset with the
   * other per-turn limits at end of turn.
   */
  readonly usedThisTurn: readonly string[]

  /** Figure ids currently damaged (a fresh piece takes one hit to damage, another to destroy). */
  readonly damaged: readonly string[]

  // --- Leaders and Lore (docs/14) ---
  /** The variant's settings, or undefined for a base game. */
  readonly leadersAndLore: LeadersAndLoreOptions | undefined
  /** The leader each faction drafted, by card id. */
  readonly leaders: Readonly<Partial<Record<FactionId, string>>>
  /** The lore cards each faction drafted and holds. */
  readonly lores: Readonly<Partial<Record<FactionId, readonly string[]>>>
  /**
   * Cards dealt for the draft and not yet taken. Present only while drafting, and cleared when
   * it ends — the leftovers are returned to the box, as HRF does (`game-leaders.scala`).
   */
  /**
   * Lore that reached nobody: the shuffled remainder of the deck after dealing, plus whatever the
   * draft ended on. Kept because Learned (Archivist) draws from it after setup — HRF's
   * `unusedLores`. Empty in a base game and for a variant nobody drafts the Archivist in.
   */
  readonly unusedLore: readonly string[]

  readonly draft:
    | { readonly leaders: readonly string[]; readonly lores: readonly string[] }
    | undefined

  /**
   * The most recent battle roll, kept only so the UI can show the dice and animate them. It
   * is a *view* of what the seeded RNG already produced during `battle/roll`, set there and
   * cleared when the battle finishes; nothing in the rules reads it. Survives replay because
   * it is recomputed on the same roll.
   */
  readonly lastRoll: { readonly dice: readonly DieRoll[] } | undefined

  /**
   * Resource types each faction is outraged at, and so cannot spend for that resource's
   * Prelude action. Destroying a City in battle outrages the **attacker** — see
   * `outrage.ts` and docs/09 section 3a. Nothing clears it in the base game.
   */
  readonly outraged: Readonly<Partial<Record<FactionId, readonly Resource[]>>>

  /**
   * A Weapon spent in the Prelude lets this turn's card Battle even when its suit cannot
   * (HRF's `f.anyBattle`). Bought at most once, and reset at end of turn.
   */
  readonly anyBattle: boolean

  // --- round / turn state ---
  /** Seating rotated so index 0 currently holds initiative. */
  readonly initiativeOrder: readonly FactionId[]
  readonly lead: Lead | undefined
  /** Cards played this round, in order — fills the board's Lead / Surpass slots. */
  readonly roundPlays: readonly RoundPlay[]
  /** Faction that has seized initiative this round, if any. */
  readonly seized: FactionId | undefined
  /** Consecutive passes by factions still holding cards. */
  readonly passed: number

  // --- ambitions / scoring ---
  readonly ambitions: readonly Ambition[]
  /** Markers available to declare this chapter. */
  readonly ambitionable: readonly AmbitionMarker[]
  /** Markers placed on ambitions this chapter by declaration. */
  readonly declared: readonly Declaration[]
  /** Accumulated power per faction — the score. Only seated factions are present. */
  readonly power: Readonly<Partial<Record<FactionId, number>>>

  /**
   * Repositioning moves made in the arrange step currently open, reset when it closes.
   *
   * The arrange menu is the one place in the game whose options form a **cycle**: with a free slot
   * you may shuffle a held token between slots forever, each move a legal position the engine will
   * re-offer. Everywhere else a repeat spends something — a pip, a token, a piece — and so
   * terminates on its own.
   *
   * Bounding it here makes termination a property of the rules rather than something every bot has
   * to rediscover. Three separate bots have livelocked on this menu: `trivialBot` (which takes the
   * first option offered and so never reached `Done`), and any evaluator that finds two arrangements
   * equal — which is common, since resources of the same kind are interchangeable.
   *
   * Only *repositioning* is counted. Landing an arrival, ejecting and discarding all consume a
   * token, so they already terminate, and capping them could strand a player with an illegal row
   * and no way to make it legal — a dead end, which is worse than a loop. See `ARRANGE_MOVE_CAP`.
   */
  readonly arrangeMoves?: number

  /** Every external action applied so far — the save format. */
  readonly journal: readonly string[]
  readonly log: readonly string[]
  readonly isOver: boolean
  readonly winners: readonly FactionId[]
}

export function withState(state: GameState, patch: Partial<GameState>): GameState {
  return { ...state, ...patch }
}

/** Push a module onto the front of the chain, so it intercepts ahead of existing rules. */
export function prependRuleModule(state: GameState, id: RuleModuleId): GameState {
  if (state.ruleChain.includes(id)) return state
  return { ...state, ruleChain: [id, ...state.ruleChain] }
}

export function appendLog(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] }
}

export function recordJournal(state: GameState, encoded: string): GameState {
  return { ...state, journal: [...state.journal, encoded] }
}
