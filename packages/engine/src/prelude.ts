/**
 * The Prelude — spending resources after playing your card, before spending its pips.
 *
 * From the player board: "You may spend any resources in your turn's Prelude, after playing
 * an action card but before spending any of its pips. Outraged resources cannot be spent for
 * their Prelude action."
 *
 * Transcribed from haunt-roll-fail `arcs/game-common.scala:1632-1775` (`PreludeActionAction`),
 * which builds one menu entry per (held token x action it buys). This module is just the
 * table and the eligibility rules — the turn flow lives in `rules/turn.ts`.
 *
 * The grants are **not** the suit→action map, which is the tempting shortcut:
 *
 *   Material  Build, Repair      (happens to equal SUIT_ACTIONS.Construction)
 *   Fuel      Move               (Mobilization also buys Influence; Fuel does not)
 *   Relic     Secure
 *   Weapon    buys no action — it adds a Battle *option* to a non-Aggression card
 *   Psionic   whatever the LEAD card's suit buys — this one really is SUIT_ACTIONS
 *
 * Psionic keys off the lead card, not the card you played. A follower who pivoted into
 * another suit still copies the lead. HRF reads `factions.first.displayed.suit`, the
 * initiative holder's played card; we carry the same thing as `state.lead.suit`.
 */

import type { Action } from './action.js'
import { SUIT_ACTIONS, parseCardId } from './cards.js'
import type { StandardAction, Suit } from './cards.js'
import { CardLocation, Location, parseFigureId } from './ids.js'
import type { FactionId } from './ids.js'
import {
  ELDER_BROKER,
  FARSEERS,
  FUEL_CARTEL,
  GATEKEEPERS,
  MATERIAL_CARTEL,
  MINING_INTEREST,
  RELIC_FENCE,
  SHIPPING_INTEREST,
  SHIP_PLACERS,
  SILVER_TONGUES,
  SWORN_GUARDIANS,
  UNION_SUITS,
  loyalSuits,
  securedCards,
} from './court.js'
import { LORE_CLEARS_OUTRAGE, hasLore, loreCard } from './lore.js'
import { canSpendForPrelude, isOutraged } from './outrage.js'
import { citiesInReserve, rules, slotsOf } from './control.js'
import { heldTokens, openSlots, parseResourceToken, slotCapacity, supplyOf } from './resources.js'
import type { Resource } from './resources.js'
import type { GameState } from './state.js'
import { contentsOf } from './tracker.js'

/**
 * Entry into the Prelude, and so into the whole rest of the turn.
 *
 * It lives here rather than in `rules/turn.ts` because **both** the turn module (after a
 * follower's seize check) and the ambitions module (after the lead player declares or
 * declines) have to hand off to it, and a constructor in either would make those two modules
 * import each other. `ambitions.ts` previously kept its own copy of turn.ts's `turn/pips`
 * shape for exactly that reason, and that duplicate is what silently skipped this phase for
 * the lead player when it was first wired up.
 */
export const Prelude = (faction: FactionId, suit: Suit, pips: number): Action => ({
  type: 'turn/prelude',
  faction,
  suit,
  pips,
})

/** Actions each resource buys directly. Psionic and Weapon are special — see below. */
const DIRECT: Readonly<Record<Resource, readonly StandardAction[]>> = {
  Material: ['Build', 'Repair'],
  Fuel: ['Move'],
  Weapon: [],
  Relic: ['Secure'],
  Psionic: [],
}

/** What spending one token of `resource` can buy, given the suit of the lead card. */
export function preludeGrants(resource: Resource, leadSuit: Suit): readonly StandardAction[] {
  return resource === 'Psionic' ? (SUIT_ACTIONS[leadSuit] ?? []) : DIRECT[resource]
}

/**
 * Prelude abilities printed on secured Guild cards ("You may discard this to …",
 * `game-common.scala:1863-1877`). Unlike the alt actions, these cost the **card**, not a
 * resource — the card goes to the court discard when used.
 */
export type GuildPrelude =
  /** Relic Fence: spend any resource to gain a Relic. */
  | { kind: 'relic-fence'; card: string; spend: Resource }
  /** Silver Tongues: steal a resource, or a guild card, from a rival. */
  | { kind: 'silver-tongues-resource'; card: string; rival: FactionId; resource: Resource }
  | { kind: 'silver-tongues-card'; card: string; rival: FactionId; stolen: string }
  /** Farseers: discard your hand and draw the same number again. */
  | { kind: 'farseers'; card: string }
  /** Mining / Shipping Interest: fill every open slot with one resource type. */
  | { kind: 'fill-slots'; card: string; resource: Resource }
  /** Material / Fuel Cartel: steal that one resource from a rival. */
  | { kind: 'cartel'; card: string; rival: FactionId; resource: Resource }
  /** The four Unions: take a card of their suit out of a played pile. */
  | { kind: 'take-played'; card: string; taken: string; from: FactionId }
  /** Gatekeepers: a ship at every gate. */
  | { kind: 'gates'; card: string }
  /** Prison Wardens / Skirmishers / Court Enforcers / Loyal Marines: 3 ships in a ruled system. */
  | { kind: 'ships'; card: string; system: string }
  /** Elder Broker: one Material, one Fuel, one Weapon. */
  | { kind: 'gain-three'; card: string }

export type PreludeOffer =
  /** Spend `resource` to take `action` once, for free. */
  | { kind: 'action'; resource: Resource; action: StandardAction }
  /**
   * Spend `resource` so this turn's card can Battle even though its suit cannot. Normally
   * that resource is a Weapon, but Loyal Marines lets any held resource buy it — so the
   * offer carries the token actually spent rather than assuming one.
   */
  | { kind: 'battle-option'; resource: Resource }
  /** Spend a token for nothing, to free the slot. */
  | { kind: 'discard'; resource: Resource }

/** Distinct resource types the faction can actually spend (usable slots only). */
export function spendable(state: GameState, faction: FactionId): Resource[] {
  const capacity = slotsOf(state, faction)
  const held = heldTokens(state.resources, capacity).map(
    (id) => parseResourceToken(id).resource,
  )
  return [...new Set(held)]
}

/**
 * Everything on offer this Prelude.
 *
 * `playedSuit` is the suit this faction is acting in (a pivot changes it); `leadSuit` is the
 * lead card's suit, which is what Psionic copies.
 */
export function preludeOffers(
  state: GameState,
  faction: FactionId,
  playedSuit: Suit,
  leadSuit: Suit,
): PreludeOffer[] {
  const offers: PreludeOffer[] = []
  const held = spendable(state, faction)
  const loyal = loyalSuits(state, faction)

  for (const resource of held) {
    // HRF writes every one of these conditions as
    //   (r.is(X) && !outraged(X)) || f.hasGuild(LoyalX)
    // so a Loyal guild does two things at once: it lets *any* resource buy that suit's
    // action, and it ignores outrage on that suit. Both fall out of unioning the grants.
    const grants = new Set<StandardAction>()
    if (canSpendForPrelude(state, faction, resource)) {
      for (const a of preludeGrants(resource, leadSuit)) grants.add(a)
    }
    for (const suit of loyal) {
      for (const a of preludeGrants(suit, leadSuit)) grants.add(a)
    }
    for (const action of grants) offers.push({ kind: 'action', resource, action })
  }

  // A Weapon adds Battle to a card that could not otherwise battle. Aggression already can,
  // and the option cannot be bought twice (`.!(f.anyBattle)`, game-common.scala:1738).
  // One offer per resource that could pay for it, since Loyal Marines widens that to any.
  if (playedSuit !== 'Aggression' && !state.anyBattle) {
    for (const resource of held) {
      const pays =
        (resource === 'Weapon' && canSpendForPrelude(state, faction, 'Weapon')) ||
        loyal.includes('Weapon')
      if (pays) offers.push({ kind: 'battle-option', resource })
    }
  }

  for (const resource of held) offers.push({ kind: 'discard', resource })

  return offers
}

/**
 * What the faction's secured Guild cards offer this Prelude.
 *
 * Each is once-only because using it discards the card, so no `usedThisTurn` bookkeeping is
 * needed — that is only for abilities that leave the card in play (Galactic Bards).
 */
/** A lore card's Prelude ability: which card, and what discarding it does. */
export interface LorePrelude {
  card: string
  clears: readonly Resource[]
  label: string
}

/**
 * Lore Prelude abilities on offer.
 *
 * Only the five outrage-clearing cards today. Offered **only when there is outrage to clear** —
 * "you may discard this to clear your Weapon Outrage" is not a choice worth showing to someone
 * who is not outraged, and discarding a live card for nothing is a trap rather than an option.
 */
export function lorePreludes(state: GameState, faction: FactionId): LorePrelude[] {
  const out: LorePrelude[] = []
  for (const [card, clears] of Object.entries(LORE_CLEARS_OUTRAGE)) {
    if (!hasLore(state, faction, card)) continue
    const bites = clears.filter((r) => isOutraged(state, faction, r))
    if (bites.length === 0) continue
    out.push({
      card,
      clears,
      label: `${loreCard(card).name} — clear your ${bites.join(' and ')} outrage`,
    })
  }
  return out
}

export function guildPreludes(state: GameState, faction: FactionId): GuildPrelude[] {
  const out: GuildPrelude[] = []
  const cards = securedCards(state, faction)
  const mine = spendable(state, faction)

  // Relic Fence — trade any resource for a Relic, if one is left in the supply.
  if (cards.includes(RELIC_FENCE) && supplyOf(state.resources, 'Relic').length > 0) {
    for (const spend of mine) out.push({ kind: 'relic-fence', card: RELIC_FENCE, spend })
  }

  // Silver Tongues — steal a resource or a guild card from a rival. Sworn Guardians blocks
  // both, exactly as it blocks a battle raid.
  if (cards.includes(SILVER_TONGUES)) {
    for (const rival of state.factions) {
      if (rival === faction) continue
      if (securedCards(state, rival).includes(SWORN_GUARDIANS)) continue
      for (const resource of spendable(state, rival)) {
        out.push({ kind: 'silver-tongues-resource', card: SILVER_TONGUES, rival, resource })
      }
      for (const stolen of securedCards(state, rival)) {
        out.push({ kind: 'silver-tongues-card', card: SILVER_TONGUES, rival, stolen })
      }
    }
  }

  // Farseers — throw your hand back and draw as many again.
  if (cards.includes(FARSEERS)) out.push({ kind: 'farseers', card: FARSEERS })

  // Mining / Shipping Interest — top every open slot up with one resource.
  for (const [card, resource] of [
    [MINING_INTEREST, 'Material'],
    [SHIPPING_INTEREST, 'Fuel'],
  ] as const) {
    if (cards.includes(card) && openSlots(state.resources, slotsOf(state, faction)).length > 0) {
      out.push({ kind: 'fill-slots', card, resource })
    }
  }

  // Material / Fuel Cartel — take that resource off a rival. Sworn Guardians blocks it.
  for (const [card, resource] of [
    [MATERIAL_CARTEL, 'Material'],
    [FUEL_CARTEL, 'Fuel'],
  ] as const) {
    if (!cards.includes(card)) continue
    for (const rival of state.factions) {
      if (rival === faction) continue
      if (securedCards(state, rival).includes(SWORN_GUARDIANS)) continue
      if (spendable(state, rival).includes(resource)) {
        out.push({ kind: 'cartel', card, rival, resource })
      }
    }
  }

  // The Unions — take a played card of their suit out of the round.
  for (const [card, suit] of Object.entries(UNION_SUITS)) {
    if (!cards.includes(card)) continue
    for (const from of state.factions) {
      for (const played of contentsOf(state.cards, CardLocation.played(from))) {
        if (parseCardId(played).suit !== suit) continue
        out.push({ kind: 'take-played', card, taken: played, from })
      }
    }
  }

  // Gatekeepers — a ship at every gate.
  if (cards.includes(GATEKEEPERS) && shipsInReserve(state, faction) > 0) {
    out.push({ kind: 'gates', card: GATEKEEPERS })
  }

  // Three ships into one system you rule.
  for (const card of SHIP_PLACERS) {
    if (!cards.includes(card) || shipsInReserve(state, faction) === 0) continue
    for (const s of state.board.systems) {
      if (rules(state, faction, s)) out.push({ kind: 'ships', card, system: s })
    }
  }

  // Elder Broker — one each of Material, Fuel and Weapon.
  if (cards.includes(ELDER_BROKER)) out.push({ kind: 'gain-three', card: ELDER_BROKER })

  return out
}

function shipsInReserve(state: GameState, faction: FactionId): number {
  return contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  ).length
}
