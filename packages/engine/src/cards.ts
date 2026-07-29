/**
 * The action deck. Transcribed from haunt-roll-fail/arcs/game.scala:229-320.
 *
 * 28 cards: four suits x strengths 1-7, each with a fixed pip count (the number of
 * actions the card grants). At three players the strength-1 and strength-7 cards are
 * removed, leaving 20. See docs/06-turn-structure.md.
 */

import type { EntityId } from './tracker.js'

export const SUITS = ['Administration', 'Aggression', 'Construction', 'Mobilization'] as const
export type Suit = (typeof SUITS)[number]

/**
 * The seven standard actions a pip can buy. Which are available depends on the played
 * card's suit — see SUIT_ACTIONS.
 */
export const STANDARD_ACTIONS = [
  'Tax',
  'Build',
  'Repair',
  'Move',
  'Influence',
  'Secure',
  'Battle',
] as const
export type StandardAction = (typeof STANDARD_ACTIONS)[number]

/**
 * Suit -> the actions its pips may buy. Verified against game-common.scala:2082-2111.
 * Zeal and Wisdom (the Faithful campaign suit) are omitted; they arrive in phase 2.
 */
export const SUIT_ACTIONS: Readonly<Record<Suit, readonly StandardAction[]>> = {
  Construction: ['Build', 'Repair'],
  Administration: ['Tax', 'Repair', 'Influence'],
  Mobilization: ['Move', 'Influence'],
  Aggression: ['Battle', 'Move', 'Secure'],
}

export interface ActionCard {
  readonly suit: Suit
  readonly strength: number
  readonly pips: number
}

export function cardId(card: ActionCard): EntityId {
  return `${card.suit}-${card.strength}`
}

export function parseCardId(id: EntityId): ActionCard {
  const dash = id.lastIndexOf('-')
  const suit = id.slice(0, dash) as Suit
  const strength = Number(id.slice(dash + 1))
  const card = FULL_DECK.find((c) => c.suit === suit && c.strength === strength)
  if (card === undefined) throw new Error(`unknown card id: ${id}`)
  return card
}

// game.scala:289-320. Pip counts are per card, not derivable from strength.
const PIPS: Readonly<Record<Suit, readonly number[]>> = {
  //          str: 1  2  3  4  5  6  7
  Administration: [4, 4, 3, 3, 3, 2, 1],
  Aggression: [3, 3, 2, 2, 2, 2, 1],
  Construction: [4, 4, 3, 3, 2, 2, 1],
  Mobilization: [4, 4, 3, 3, 2, 2, 1],
}

export const FULL_DECK: readonly ActionCard[] = SUITS.flatMap((suit) =>
  [1, 2, 3, 4, 5, 6, 7].map((strength) => ({
    suit,
    strength,
    pips: PIPS[suit][strength - 1]!,
  })),
)

/**
 * The deck actually used, by player count. At three players the 1s and 7s are dropped
 * (game.scala:1330-1331). Four players use the full 28.
 */
export function deckFor(playerCount: number): readonly ActionCard[] {
  if (playerCount >= 4) return FULL_DECK
  return FULL_DECK.filter((c) => c.strength > 1 && c.strength < 7)
}

export const CHAPTER_HAND_SIZE = 6
