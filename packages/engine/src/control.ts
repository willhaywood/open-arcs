/**
 * System control and presence, from haunt-roll-fail/arcs/game.scala:765-773, 1445.
 *
 * Base game: a faction's rule value in a system is its (undamaged) ship count; a faction
 * rules a system when its rule value strictly exceeds every other color's. Presence is
 * simply having any piece there. Free building slots are the planet's slot count minus the
 * buildings already there.
 *
 * Damage, flagship and the campaign's regent/Empire rules are deferred — noted at each
 * function.
 */

import { connected, system as systemInfo } from './board.js'
import type { BoardVariant } from './board.js'
import { Location, parseFigureId } from './ids.js'
import type { ColorId, FactionId, LocationId, Piece, SystemId } from './ids.js'
import { ANCIENT_HOLDINGS, GATE_STATIONS, hasLore } from './lore.js'
import { RESOURCES, ResourceSlot, slotCapacity, usableSlots } from './resources.js'
import type { Resource } from './resources.js'
import type { GameState } from './state.js'
import { contentsOf } from './tracker.js'

function figuresAt(state: GameState, s: SystemId) {
  return contentsOf(state.figures, Location.system(s)).map(parseFigureId)
}

export function piecesOf(state: GameState, color: ColorId, s: SystemId, piece: Piece): number {
  return figuresAt(state, s).filter((f) => f.color === color && f.piece === piece).length
}

export function present(state: GameState, color: ColorId, s: SystemId): boolean {
  return figuresAt(state, s).some((f) => f.color === color)
}

/**
 * What a colour is worth toward ruling a system: its **fresh ships**, and nothing else.
 *
 * "You control a system and its contents if you have more fresh ships there than each Rival."
 * Damaged ships do not count — a tipped ship holds nothing. Nor do buildings: a city gives you no
 * claim on the space around it, which is why a fleet can sit on top of someone's world and tax it.
 *
 * This was previously a plain ship count, damaged ones included, which let a wrecked fleet keep
 * ruling. It matters widely because ruling gates taxing (yours and rivals'), building, gate
 * builds, the Gate Ports toll, the catapult and Tool Priests. HRF is the same expression,
 * `l.diff(damaged).count(Ship)` (game.scala:943), minus the campaign flagship bonus.
 */
export function ruleValue(state: GameState, color: ColorId, s: SystemId): number {
  return contentsOf(state.figures, Location.system(s)).filter((id) => {
    const f = parseFigureId(id)
    return f.color === color && f.piece === 'Ship' && !state.damaged.includes(id)
  }).length
}

/** True when `color` strictly out-values every other color present-or-not in `s`. */
export function rules(state: GameState, color: ColorId, s: SystemId): boolean {
  const mine = ruleValue(state, color, s)
  if (mine === 0) return false
  const best = Math.max(...state.colors.filter((c) => c !== color).map((c) => ruleValue(state, c, s)))
  return mine > best
}

/**
 * A planet's resource type *as it now stands* — the board's printed icon unless Mythic (Shaper)
 * has covered it with a token.
 *
 * Every rule that asks what a planet produces goes through here rather than reading
 * `system(id).resource`, so a changed planet is changed for taxing, for the guild cards that
 * count planet types, and for the outrage a razed city provokes. The one deliberate exception is
 * setup's initial seeding, which runs before any leader could have acted.
 */
/**
 * What a planet produces when taxed.
 *
 * Takes the narrowest thing that answers the question rather than a whole `GameState`, so the AI can
 * ask it from an `ObservedState` — a bot re-implementing which planets make Material would be the
 * same rules knowledge in two places, and the copy would be the one that goes stale.
 */
export function planetResource(
  state: { readonly planetTypes: Readonly<Partial<Record<SystemId, Resource>>> },
  s: SystemId,
): Resource | undefined {
  const changed = state.planetTypes[s]
  if (changed !== undefined) return changed
  return RESOURCES.find((r) => r === systemInfo(s).resource)
}

/** Open building slots: planet capacity minus buildings present. Gates have none. */
export function freeSlots(state: GameState, s: SystemId): number {
  const info = systemInfo(s)
  const capacity = info.buildingSlots ?? 0
  // A Cloud City stands beside the slots rather than in one, so it never consumes capacity.
  const buildings = contentsOf(state.figures, Location.system(s)).filter((id) => {
    const f = parseFigureId(id)
    return (f.piece === 'City' || f.piece === 'Starport') && !state.unslotted.includes(id)
  }).length
  return Math.max(0, capacity - buildings)
}

/** A city already standing outside the slots here — the "max 1 per planet" the card allows. */
export function hasCloudCity(state: GameState, s: SystemId): boolean {
  return contentsOf(state.figures, Location.system(s)).some((id) => state.unslotted.includes(id))
}

export function systemsWherePresent(state: GameState, color: FactionId): SystemId[] {
  return state.board.systems.filter((s) => present(state, color, s))
}

/** Cities a faction still holds in reserve. Drives resource-slot capacity and the scoring bonus. */
/**
 * The slice of state that resource-slot maths reads.
 *
 * Named so `ObservedState` satisfies it too. A bot has to compute what it holds and what an
 * ambition would score, and duplicating that arithmetic into the AI would be two copies of a rule —
 * the mistake docs/03 section 2 calls out in HRF, which keeps a second scalar just for rollouts.
 * Widening the parameter instead means there is one implementation and the bot cannot drift from
 * the engine.
 */
export interface SlotView {
  readonly figures: GameState['figures']
  readonly lores: GameState['lores']
}

export function citiesInReserve(state: SlotView, faction: FactionId): number {
  return contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'City',
  ).length
}

/** Re-exported for callers building move/build option lists. */
export function connectedSystems(board: BoardVariant, from: SystemId): readonly SystemId[] {
  return connected(board, from)
}

/**
 * The resource types a **gate city** counts as, under Gate Stations (lore11).
 *
 * "A gate city's type matches all cities in its cluster." A gate has no resource of its own, so
 * without this card a city standing on one is untaxable and provokes no outrage; with it, the
 * city takes on the types of every *planet* in its cluster that currently holds a city.
 *
 * **The effect is global while the card is in play, not the holder's alone.** The card says
 * "*Players* may tax it" and "if it is destroyed" without naming an owner, so it modifies how gate
 * cities work rather than granting their owner a privilege.
 *
 * Empty for anything that is not a gate, and empty when nobody holds the card — so every caller
 * can ask unconditionally and a base game is unaffected.
 */
export function gateCityTypes(state: GameState, s: SystemId): readonly Resource[] {
  const info = systemInfo(s)
  if (!info.isGate) return []
  if (!state.factions.some((f) => hasLore(state, f, GATE_STATIONS))) return []

  const types = new Set<Resource>()
  for (const other of state.board.systems) {
    const o = systemInfo(other)
    if (o.isGate || o.cluster !== info.cluster) continue
    if (!figuresAt(state, other).some((f) => f.piece === 'City')) continue
    const r = RESOURCES.find((x) => x === o.resource)
    if (r !== undefined) types.add(r)
  }
  return [...types]
}

/**
 * Every resource slot a faction can currently use: its city slots, opened by building cities, plus
 * the one on Ancient Holdings (lore13) if it holds that card.
 *
 * This is the single producer — everything that gains, spends, counts for an ambition or is raided
 * asks here, so the card slot cannot be visible to one of those and invisible to another.
 */
export function slotsOf(state: SlotView, faction: FactionId): LocationId[] {
  const slots = usableSlots(faction, slotCapacity(citiesInReserve(state, faction)))
  if (hasLore(state, faction, ANCIENT_HOLDINGS)) {
    slots.push(ResourceSlot.cardSlot(faction, ANCIENT_HOLDINGS))
  }
  return slots
}
