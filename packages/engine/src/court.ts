/**
 * The court: the row of face-up cards Influence and Secure operate on.
 *
 * Transcribed from haunt-roll-fail `arcs/game-base.scala:115-149` (the base deck) and
 * `arcs/game-common.scala:1074-1210` (Influence, Secure, capture, replenish). Card art is in
 * `game-assets/court/bc01..bc31.webp`, matching HRF's ids exactly.
 *
 * Structure:
 *   - **31 cards**: 25 Guild cards (bc01-bc25) and 6 Vox cards (bc26-bc31).
 *   - **4 display slots** in the base game (`market = 1.to(4)`; the campaign adds slot 0,
 *     the Imperial Council).
 *   - **10 agents** per faction, which is the real limit on how much you can influence.
 *
 * Two rules here are the whole point of the subsystem:
 *
 *   - **Securing needs a strict majority.** HRF disables the option when your agent count on
 *     a card is `<=` the best any single rival has (`game-common.scala:1170`). A tie is not
 *     enough.
 *   - **Securing takes prisoners.** Your own agents go back to your reserve, but every rival
 *     agent on the card becomes **your captive** (`CaptureAgentsCourtCardAction`). That is
 *     the base game's source of captives, and so of the Tyrant ambition.
 */

import type { FactionId, LocationId } from './ids.js'
import type { Resource } from './resources.js'

/**
 * Cards whose effects are referenced by name elsewhere in the rules. Named so the guards
 * read as rules rather than as magic strings.
 */
export const SKIRMISHERS = 'bc13'
export const SWORN_GUARDIANS = 'bc22'
export const SECRET_ORDER = 'bc18'
export const LATTICE_SPIES = 'bc16'
export const GALACTIC_BARDS = 'bc25'
export const RELIC_FENCE = 'bc24'
export const SILVER_TONGUES = 'bc20'
export const FARSEERS = 'bc17'
export const MINING_INTEREST = 'bc02'
export const SHIPPING_INTEREST = 'bc09'
export const MATERIAL_CARTEL = 'bc03'
export const FUEL_CARTEL = 'bc06'
export const GATEKEEPERS = 'bc08'
export const ELDER_BROKER = 'bc23'

/** Cards whose Prelude places three ships in a system you rule (`game-common.scala:1814`). */
export const SHIP_PLACERS: readonly string[] = ['bc12', 'bc13', 'bc14', 'bc15']

/** Union cards: each takes a played card of its suit (`game-common.scala:1810`). */
export const UNION_SUITS: Readonly<Record<string, string>> = {
  bc04: 'Administration',
  bc05: 'Construction',
  bc10: 'Mobilization',
  bc11: 'Aggression',
}

export const COURT_SLOTS = 4
export const AGENTS_PER_FACTION = 10

export type CourtCardKind = 'guild' | 'vox'

export interface CourtCard {
  readonly id: string
  readonly name: string
  readonly kind: CourtCardKind
  /** Guild cards only: the resource the guild deals in (`GuildEffect`'s suit). */
  readonly suit?: Resource
  /**
   * Guild cards only: the key cost to raid this card off its holder in battle
   * (`game-battle.scala:416`). Not ambition points — secured cards do not score.
   */
  readonly keys?: number
  /**
   * The five **Loyal** guilds. Holding one lets you spend *any* resource for that suit's
   * Prelude action, and ignores outrage on that suit (`game-common.scala:1683-1760`, where
   * every condition reads `(r.is(X) && !outraged(X)) || f.hasGuild(LoyalX)`).
   */
  readonly loyal?: boolean
}

const guild = (
  id: string,
  name: string,
  suit: Resource,
  keys: number,
  loyal = false,
): CourtCard => ({ id, name, kind: 'guild', suit, keys, loyal })
const vox = (id: string, name: string): CourtCard => ({ id, name, kind: 'vox' })

/** The base game's court deck, in HRF's order (`BaseCards.base`). */
export const BASE_COURT: readonly CourtCard[] = [
  guild('bc01', 'Loyal Engineers', 'Material', 3, true),
  guild('bc02', 'Mining Interest', 'Material', 2),
  guild('bc03', 'Material Cartel', 'Material', 2),
  guild('bc04', 'Admin Union', 'Material', 2),
  guild('bc05', 'Construction Union', 'Material', 2),
  guild('bc06', 'Fuel Cartel', 'Fuel', 2),
  guild('bc07', 'Loyal Pilots', 'Fuel', 3, true),
  guild('bc08', 'Gatekeepers', 'Fuel', 2),
  guild('bc09', 'Shipping Interest', 'Fuel', 2),
  guild('bc10', 'Spacing Union', 'Fuel', 2),
  guild('bc11', 'Arms Union', 'Weapon', 2),
  guild('bc12', 'Prison Wardens', 'Weapon', 2),
  guild('bc13', 'Skirmishers', 'Weapon', 2),
  guild('bc14', 'Court Enforcers', 'Weapon', 2),
  guild('bc15', 'Loyal Marines', 'Weapon', 3, true),
  guild('bc16', 'Lattice Spies', 'Psionic', 2),
  guild('bc17', 'Farseers', 'Psionic', 2),
  guild('bc18', 'Secret Order', 'Psionic', 2),
  guild('bc19', 'Loyal Empaths', 'Psionic', 3, true),
  guild('bc20', 'Silver Tongues', 'Psionic', 2),
  guild('bc21', 'Loyal Keepers', 'Relic', 3, true),
  guild('bc22', 'Sworn Guardians', 'Relic', 1),
  guild('bc23', 'Elder Broker', 'Relic', 2),
  guild('bc24', 'Relic Fence', 'Relic', 2),
  guild('bc25', 'Galactic Bards', 'Relic', 1),
  vox('bc26', 'Mass Uprising'),
  vox('bc27', 'Populist Demands'),
  vox('bc28', 'Outrage Spreads'),
  vox('bc29', 'Song of Freedom'),
  vox('bc30', 'Guild Struggle'),
  vox('bc31', 'Call to Action'),
]

const BY_ID = new Map(BASE_COURT.map((c) => [c.id, c]))

export function courtCard(id: string): CourtCard {
  const found = BY_ID.get(id)
  if (found === undefined) throw new Error(`unknown court card: ${id}`)
  return found
}

/** Where court *cards* live. Agents standing on a slot live in `Location.court(n)`. */
export const CourtPile = {
  deck: (): LocationId => 'court:deck',
  slot: (n: number): LocationId => `court:slot:${n}`,
  /** Guild cards a faction has secured and now holds. */
  secured: (f: FactionId): LocationId => `court:secured:${f}`,
  discard: (): LocationId => 'court:discard',
} as const

export function courtSlots(): readonly number[] {
  return Array.from({ length: COURT_SLOTS }, (_, i) => i + 1)
}


// --- queries on what a faction holds ---------------------------------------

/** Guild cards `faction` has secured, as card ids. */
export function securedCards(state: GameStateLike, faction: FactionId): readonly string[] {
  return state.courtCards.contents.get(CourtPile.secured(faction)) ?? []
}

export function hasGuild(state: GameStateLike, faction: FactionId, cardId: string): boolean {
  return securedCards(state, faction).includes(cardId)
}

/**
 * The suits a faction is Loyal in. Holding Loyal Engineers means every resource you hold can
 * buy Material's Prelude action, and outrage on Material stops none of it.
 */
export function loyalSuits(state: GameStateLike, faction: FactionId): readonly Resource[] {
  const out: Resource[] = []
  for (const id of securedCards(state, faction)) {
    const card = BY_ID.get(id)
    if (card?.loyal === true && card.suit !== undefined) out.push(card.suit)
  }
  return out
}

/** Structural minimum, so this module does not have to import GameState and cycle. */
interface GameStateLike {
  readonly courtCards: { readonly contents: ReadonlyMap<string, readonly string[]> }
}
