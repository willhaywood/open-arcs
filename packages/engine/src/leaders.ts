/**
 * Leaders — the *Leaders and Lore* variant's asymmetric starts.
 *
 * Data only. Nothing here reads or writes game state: this is the printed content of the 16
 * leader cards, transcribed from haunt-roll-fail's `arcs/game-leaders.scala` and checked against
 * the card art in `assets/images/leader`. The draft, the setup override and the trait effects
 * are later phases — see docs/14-leaders-and-lore.md.
 *
 * A leader does three things, and it is worth keeping them separate because they land in
 * different parts of the engine:
 *
 *   1. **replaces the setup**, placing its own pieces at the board's A/B/C positions rather than
 *      the standard City+3 / Starport+3 / 2-per-fleet;
 *   2. **grants two starting resources**;
 *   3. **carries two or three traits**, which are read at decision points elsewhere.
 */

import type { FactionId, Piece } from './ids.js'
import type { Resource } from './resources.js'

/**
 * The *Leaders and Lore* variant's settings. Lives here rather than beside `NewGameOptions` so
 * that `state.ts` can hold it without importing the engine's entry point.
 */
export interface LeadersAndLoreOptions {
  /** Add the Leaders & Lore Pack: leaders 09-16 and lore 15-28. */
  readonly expansion?: boolean
  /** Add the two fan-made lore cards, which are in neither box. */
  readonly unofficialLore?: boolean
  /**
   * Lore cards each player drafts (1-5; HRF's `DoubleLore`..`PentaLore`). The higher settings
   * need more cards than a base-only deck holds — `maxLorePerPlayer` is the cap.
   */
  readonly lorePerPlayer?: number
}

/**
 * A leader's traits, by name. These are identifiers rather than behaviour — each one is read at
 * some existing decision point (battle, movement, actions, prelude) once effects land.
 *
 * Kept as a closed union so a typo in a leader's trait list is a compile error rather than an
 * effect that silently never fires.
 */
export const LEADER_TRAITS = [
  'Beloved', 'Just',
  'Attuned', 'Cryptic',
  'Insatiable', 'Lavish',
  'Ambitious', 'Callow',
  'Committed', 'Disorganized',
  'Tactical', 'Violent',
  'Charismatic', 'Generous',
  'Bold', 'Paranoid',
  'Learned', 'Academic',
  'Ruthless', 'Hated',
  'Tricky', 'Wary',
  'Connected', 'Influential', 'Proud',
  'Decentralized', 'Inspiring', 'Principled',
  'Mythic', 'Ancient',
  'Firebrand', 'Irregular',
  'Resilient', 'Greedy',
] as const
export type LeaderTrait = (typeof LEADER_TRAITS)[number]

export interface Leader {
  readonly id: string
  readonly name: string
  readonly traits: readonly LeaderTrait[]
  /** The two resources the leader starts with, filling the first free city slots. */
  readonly resources: readonly Resource[]
  /**
   * Pieces placed at each of the board's starting positions — A is the seat's first system, B
   * the second, C each fleet system. These replace the standard placement outright: Rebel opens
   * with a Starport and no City, Anarchist with no buildings at all, Feastbringer with two
   * Cities. See `docs/14` section 2.
   */
  readonly setupA: readonly Piece[]
  readonly setupB: readonly Piece[]
  readonly setupC: readonly Piece[]
  /**
   * `false` for the eight base-game leaders, `true` for the eight in the Leaders & Lore Pack.
   * The cards carry no printed set code — see docs/14 section 1 — so this comes from the box
   * contents: `leader01`-`08` base, `leader09`-`16` expansion.
   */
  readonly expansion: boolean
}

const leader = (
  id: string,
  name: string,
  traits: readonly LeaderTrait[],
  resources: readonly Resource[],
  setupA: readonly Piece[],
  setupB: readonly Piece[],
  setupC: readonly Piece[],
  expansion: boolean,
): Leader => ({ id, name, traits, resources, setupA, setupB, setupC, expansion })

// Shorthands: the setup lists are repetitive and the shape is what matters when reading them.
const C3: readonly Piece[] = ['City', 'Ship', 'Ship', 'Ship']
const P3: readonly Piece[] = ['Starport', 'Ship', 'Ship', 'Ship']
const S2: readonly Piece[] = ['Ship', 'Ship']
const S3: readonly Piece[] = ['Ship', 'Ship', 'Ship']
const S4: readonly Piece[] = ['Ship', 'Ship', 'Ship', 'Ship']

/** All 16 leaders, in card order (`game-leaders.scala`, `Leaders.all`). */
export const LEADERS: readonly Leader[] = [
  // --- base game (01-08) ---
  leader('leader01', 'Elder', ['Beloved', 'Just'], ['Relic', 'Material'], C3, P3, S2, false),
  leader('leader02', 'Mystic', ['Attuned', 'Cryptic'], ['Psionic', 'Relic'], C3, P3, S2, false),
  leader('leader03', 'Fuel Drinker', ['Insatiable', 'Lavish'], ['Fuel', 'Fuel'], C3, P3, S2, false),
  leader('leader04', 'Upstart', ['Ambitious', 'Callow'], ['Psionic', 'Material'],
    ['City', 'Ship', 'Ship', 'Ship', 'Ship'], P3, S2, false),
  leader('leader05', 'Rebel', ['Committed', 'Disorganized'], ['Material', 'Weapon'],
    ['Starport', 'Ship', 'Ship', 'Ship', 'Ship'], S4, S2, false),
  leader('leader06', 'Warrior', ['Tactical', 'Violent'], ['Weapon', 'Material'], C3, P3, S2, false),
  leader('leader07', 'Feastbringer', ['Charismatic', 'Generous'], ['Relic', 'Material'],
    C3, C3, S3, false),
  leader('leader08', 'Demagogue', ['Bold', 'Paranoid'], ['Psionic', 'Weapon'], C3, P3, S2, false),

  // --- Leaders & Lore Pack (09-16) ---
  leader('leader09', 'Archivist', ['Learned', 'Academic'], ['Relic', 'Relic'], C3, C3, S2, true),
  leader('leader10', 'Overseer', ['Ruthless', 'Hated'], ['Fuel', 'Material'], C3, P3, S2, true),
  leader('leader11', 'Corsair', ['Tricky', 'Wary'], ['Fuel', 'Weapon'],
    ['Starport', 'Ship', 'Ship', 'Ship', 'Ship'], S3, S2, true),
  leader('leader12', 'Noble', ['Connected', 'Influential', 'Proud'], ['Psionic', 'Psionic'],
    C3, P3, S2, true),
  leader('leader13', 'Anarchist', ['Decentralized', 'Inspiring', 'Principled'], ['Relic', 'Weapon'],
    S4, S3, S2, true),
  leader('leader14', 'Shaper', ['Mythic', 'Ancient'], ['Relic', 'Material'], C3, S3, S3, true),
  leader('leader15', 'Agitator', ['Firebrand', 'Irregular'], ['Fuel', 'Material'],
    C3, ['Starport', 'Ship', 'Ship', 'Ship', 'Ship'], S2, true),
  leader('leader16', 'Quartermaster', ['Resilient', 'Greedy'], ['Fuel', 'Weapon'],
    ['Starport', 'Ship', 'Ship', 'Ship', 'Ship'], S3, S2, true),
]

const BY_ID = new Map(LEADERS.map((l) => [l.id, l]))

export function leaderCard(id: string): Leader {
  const found = BY_ID.get(id)
  if (found === undefined) throw new Error(`unknown leader: ${id}`)
  return found
}

/** The leaders in play: the base eight, plus the expansion eight when it is enabled. */
export function leaderPool(expansion: boolean): readonly Leader[] {
  return expansion ? LEADERS : LEADERS.filter((l) => !l.expansion)
}

/**
 * Does this faction's drafted leader carry `trait`?
 *
 * The single question every trait effect asks, and the reason base rules can read traits without
 * depending on the variant: with the variant off `state.leaders` is empty and this is always
 * false, so a trait check costs nothing and changes nothing in a base game.
 *
 * The parameter is typed structurally rather than as `GameState` on purpose — `state.ts` imports
 * this module for `LeadersAndLoreOptions`, so importing `GameState` back would be a cycle.
 */
export function hasTrait(
  state: { readonly leaders: Partial<Record<FactionId, string>> },
  faction: FactionId,
  trait: LeaderTrait,
): boolean {
  const id = state.leaders[faction]
  return id === undefined ? false : leaderCard(id).traits.includes(trait)
}
