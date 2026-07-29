/**
 * The alt-action hook — how a secured Guild card adds an option to a standard action.
 *
 * HRF offers `game.build(f, cost, then)` **and** `game.buildAlt(f, cost, guilds, then)` at
 * every action site (`game.scala:1549-1780`). The `*Alt` half walks the faction's lores,
 * abilities and guild cards and appends whatever extra options they grant. So a card does not
 * replace an action — it widens the menu that action opens.
 *
 * That is the shape reproduced here, minus lores and abilities (campaign). A `GuildAlt` says
 * which standard action's menu it joins, which card grants it, and any extra condition; the
 * flow for each lives in `rules/standard-actions.ts` beside the action it extends.
 *
 * Alt actions are *free* in the same sense the base action is: the pip is already spent on
 * the standard action, and choosing the alternative is what that pip buys.
 */

import { system as systemInfo } from './board.js'
import type { StandardAction } from './cards.js'
import { citiesInReserve, piecesOf, planetResource, rules, slotsOf } from './control.js'
import { BASE_COURT, courtSlots, hasGuild, securedCards } from './court.js'
import { Location, parseFigureId } from './ids.js'
import { hasLore } from './lore.js'
import { riflesSources } from './rules/battle.js'
import type { FactionId, SystemId } from './ids.js'
import { countResource, slotCapacity } from './resources.js'
import type { Resource } from './resources.js'
import type { GameState } from './state.js'
import { contentsOf } from './tracker.js'

const held = (state: GameState, faction: FactionId, r: Resource): number =>
  countResource(state.resources, slotsOf(state, faction), r)

/**
 * Court Enforcers' reach: your Weapon tokens **plus** your secured Weapon-suit guild cards
 * (`game.scala:1684`). Court Enforcers is itself Weapon-suited, so holding it is always worth
 * at least 1 — which is what makes the card self-starting.
 *
 * HRF's `countableResources` also folds in the Weapon Cartel's supply, but that card is
 * campaign-only and not in the base 25.
 */
export function weaponReach(state: GameState, faction: FactionId): number {
  const cards = securedCards(state, faction).filter(
    (id) => BASE_COURT.find((c) => c.id === id)?.suit === 'Weapon',
  ).length
  return held(state, faction, 'Weapon') + cards
}

/** Rival agents standing on court slot `n`. */
export function rivalAgentsOn(
  state: GameState,
  faction: FactionId,
  n: number,
): readonly string[] {
  return contentsOf(state.figures, Location.court(n)).filter(
    (id) => parseFigureId(id).color !== faction,
  )
}

/**
 * Slots Court Enforcers can abduct from: rivals present, and **strictly fewer** of them than
 * your Weapon reach (`game.scala:1686`). A well-defended card is out of reach.
 */
export function abductableSlots(state: GameState, faction: FactionId): readonly number[] {
  const reach = weaponReach(state, faction)
  return courtSlots().filter((n) => {
    const rivals = rivalAgentsOn(state, faction, n).length
    return rivals > 0 && rivals < reach
  })
}

export interface TradeTarget {
  readonly rival: FactionId
  readonly system: SystemId
  /** The planet's resource — what you take off the rival. */
  readonly take: Resource
}

/**
 * Elder Broker's Trade: a rival city standing in a system **you rule**, where that rival
 * actually holds the planet's resource (`game.scala:1760`, `game-guilds.scala:274-285`).
 * You take that resource and hand back one they do not have — see `tradeGiveOptions`.
 */
export function tradeTargets(state: GameState, faction: FactionId): readonly TradeTarget[] {
  const out: TradeTarget[] = []
  for (const s of state.board.systems) {
    const r = planetResource(state, s) ?? null
    if (r === null || !rules(state, faction, s)) continue
    for (const rival of state.factions) {
      if (rival === faction) continue
      if (piecesOf(state, rival, s, 'City') === 0) continue
      if (held(state, rival, r) === 0) continue
      out.push({ rival, system: s, take: r })
    }
  }
  return out
}

/** What you may hand back: a type you hold and the rival does not. */
export function tradeGiveOptions(
  state: GameState,
  faction: FactionId,
  rival: FactionId,
): readonly Resource[] {
  return (['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as const).filter(
    (r) => held(state, faction, r) > 0 && held(state, rival, r) === 0,
  )
}

export interface GuildAlt {
  readonly id: string
  /** Court card, or lore card when `source` says so, that grants it. */
  readonly card: string
  /**
   * Where the card is held. Guild cards are secured into the court pile; lore is held from the
   * draft, so the two are looked up differently. Absent means guild, which keeps every existing
   * entry unchanged.
   */
  readonly source?: 'guild' | 'lore'
  readonly label: string
  /** The standard action whose menu this joins. */
  readonly on: StandardAction
  /** Extra condition beyond holding the card — HRF's `&& f.captives.any` and friends. */
  readonly available?: (state: GameState, faction: FactionId) => boolean
}

const captives = (state: GameState, faction: FactionId): readonly string[] =>
  contentsOf(state.figures, Location.captives(faction))

const hasCaptives = (state: GameState, faction: FactionId): boolean =>
  captives(state, faction).length > 0

/** Base-game guild alt actions — all six of HRF's base set. */
export const GUILD_ALTS: readonly GuildAlt[] = [
  // Mining Interest — "Manufacture (Build): Gain 1 Material."
  { id: 'manufacture', card: 'bc02', label: 'Manufacture — gain 1 Material', on: 'Build' },
  // Shipping Interest — the Fuel twin of Manufacture.
  { id: 'synthesize', card: 'bc09', label: 'Synthesize — gain 1 Fuel', on: 'Build' },
  // Prison Wardens — "Pressgang (Build): Return any number of your Captives to gain any 1
  // resource for each."
  {
    id: 'pressgang',
    card: 'bc12',
    label: 'Press Gang — return captives for resources',
    on: 'Build',
    available: hasCaptives,
  },
  // Prison Wardens — "Execute (Influence): Move any number of your Captives to your
  // Trophies." Converts Tyrant points into Warlord points.
  {
    id: 'execute',
    card: 'bc12',
    label: 'Execute — captives to trophies',
    on: 'Influence',
    available: hasCaptives,
  },
  // Court Enforcers — "Abduct (Battle)": take every rival agent off a lightly-held court card.
  {
    id: 'abduct',
    card: 'bc14',
    label: 'Abduct — rival agents from a court card',
    on: 'Battle',
    available: (state, faction) => abductableSlots(state, faction).length > 0,
  },
  // Elder Broker — "Trade (Tax)": swap a resource with a rival whose city you rule.
  {
    id: 'trade',
    card: 'bc23',
    label: 'Trade — swap a resource with a rival',
    on: 'Tax',
    available: (state, faction) =>
      tradeTargets(state, faction).length > 0 &&
      tradeTargets(state, faction).some(
        (t) => tradeGiveOptions(state, faction, t.rival).length > 0,
      ),
  },
]

/**
 * Alternative actions granted by *lore* rather than guild cards.
 *
 * Kept as a separate table rather than mixed into `GUILD_ALTS` so that the two decks stay
 * visibly distinct — they are held differently, and only lore is part of the variant. They are
 * unioned at lookup, so an action's menu shows both without either table knowing about the other.
 */
/** Your cities that have not already been taxed this turn — what Nurture can act on. */
export function taxableCities(state: GameState, faction: FactionId): readonly string[] {
  const out: string[] = []
  for (const s of state.board.systems) {
    if (planetResource(state, s) === undefined) continue
    for (const id of contentsOf(state.figures, Location.system(s))) {
      const f = parseFigureId(id)
      if (f.color === faction && f.piece === 'City' && !state.taxedThisTurn.includes(id)) out.push(id)
    }
  }
  return out
}

/** Your cities and starports on the board — what Prune can swap for the other kind. */
export function prunable(state: GameState, faction: FactionId): readonly string[] {
  const out: string[] = []
  for (const s of state.board.systems) {
    for (const id of contentsOf(state.figures, Location.system(s))) {
      const f = parseFigureId(id)
      if (f.color === faction && (f.piece === 'City' || f.piece === 'Starport')) out.push(id)
    }
  }
  return out
}

export const LORE_ALTS: readonly GuildAlt[] = [
  // Galactic Rifles — "Fire Rifles (Battle)": a ranged strike into an adjacent system.
  {
    id: 'rifles',
    card: 'lore02',
    source: 'lore',
    label: 'Fire Rifles — strike an adjacent system',
    on: 'Battle',
    available: (state, faction) => riflesSources(state, faction).length > 0,
  },
  // Living Structures — "Nurture (Build): Tax a Loyal city."
  {
    id: 'nurture',
    card: 'lore10',
    source: 'lore',
    label: 'Nurture — tax one of your cities',
    on: 'Build',
    available: (state, faction) => taxableCities(state, faction).length > 0,
  },
  // Living Structures — "Prune (Repair): Replace a Loyal starport with a Loyal city or vice versa."
  {
    id: 'prune',
    card: 'lore10',
    source: 'lore',
    label: 'Prune — swap one of your buildings',
    on: 'Repair',
    available: (state, faction) => prunable(state, faction).length > 0,
  },
]

const ALL_ALTS = [...GUILD_ALTS, ...LORE_ALTS]

const BY_ID = new Map(ALL_ALTS.map((a) => [a.id, a]))

export function guildAlt(id: string): GuildAlt {
  const found = BY_ID.get(id)
  if (found === undefined) throw new Error(`unknown guild alt: ${id}`)
  return found
}

/** The alt options `faction` may take instead of the plain `on` action, right now. */
export function altsFor(
  state: GameState,
  faction: FactionId,
  on: StandardAction,
): readonly GuildAlt[] {
  return ALL_ALTS.filter(
    (a) =>
      a.on === on &&
      (a.source === 'lore' ? hasLore(state, faction, a.card) : hasGuild(state, faction, a.card)) &&
      (a.available === undefined || a.available(state, faction)),
  )
}

export function captivesOf(state: GameState, faction: FactionId): readonly string[] {
  return captives(state, faction)
}
