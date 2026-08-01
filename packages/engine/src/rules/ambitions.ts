/**
 * Ambitions: declaration and chapter-end scoring — the win condition.
 *
 * Cross-checked against two references. The marker values and "strength-1 cannot declare"
 * are confirmed by the Tabletop Simulator mod (Quinnsicle/arcs_tts, src/AmbitionMarkers.lua)
 * against the physical components; the procedure (metrics, first/second scoring, the
 * per-chapter marker window) is from haunt-roll-fail (arcs/game.scala, game-common.scala).
 * See docs/08-ambitions.md.
 *
 * Five ambitions, each keyed to a card strength:
 *   Tycoon 2, Tyrant 3, Warlord 4, Keeper 5, Empath 6.  Strength 7 declares any; 1 none.
 *
 * Each is scored by a metric; first place takes the marker's high value, second its low.
 */

import type { Action } from '../action.js'
import type { Suit } from '../cards.js'
import { Continue as C } from '../continue.js'
import { citiesInReserve, slotsOf } from '../control.js'
import type { Resource } from '../resources.js'
import type { SlotView } from '../control.js'
import { CourtPile, SECRET_ORDER, courtCard, hasGuild, securedCards } from '../court.js'
import { Prelude } from '../prelude.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { Location } from '../ids.js'
import type { FactionId } from '../ids.js'
import { hasTrait } from '../leaders.js'
import {
  countResource,
  heldTokens,
  parseResourceToken,
  slotCapacity,
  spendToken,
} from '../resources.js'
import { AMBITIONS } from '../state.js'
import type { Ambition, AmbitionMarker, GameState } from '../state.js'
import { contentsOf, move } from '../tracker.js'

/** Card strength that declares each ambition; a 7 declares any. Exported so the AI reads it here. */
export const AMBITION_STRENGTH: Readonly<Record<Ambition, number>> = {
  Tycoon: 2,
  Tyrant: 3,
  Warlord: 4,
  Keeper: 5,
  Empath: 6,
}

/**
 * The flat marker pool (game.scala:1363). The three physical markers show low faces
 * {2/0, 3/2, 5/3} and high faces {4/2, 6/3, 9/4}; a chapter's three available markers are
 * a sliding window into this list, so later chapters escalate. Confirmed against the TTS
 * component values.
 */
export const MARKERS: readonly AmbitionMarker[] = [
  { high: 2, low: 0 },
  { high: 3, low: 2 },
  { high: 5, low: 3 },
  { high: 4, low: 2 },
  { high: 6, low: 3 },
  { high: 9, low: 4 },
  { high: 4, low: 2 },
  { high: 6, low: 3 },
]

/** The three markers available to declare in a given (1-based) chapter. */
export function chapterAmbitionable(chapter: number): AmbitionMarker[] {
  const start = Math.max(0, chapter - 1)
  return MARKERS.slice(start, start + 3)
}

/** Which ambitions a card of this strength may declare. */
export function ambitionsForStrength(strength: number): readonly Ambition[] {
  if (strength === 7) return AMBITIONS
  return AMBITIONS.filter((a) => AMBITION_STRENGTH[a] === strength)
}

/** What `metric` reads — widened so a bot's `ObservedState` satisfies it too. See `SlotView`. */
export interface MetricView extends SlotView {
  readonly resources: GameState['resources']
  /** Secured Guild cards score too; see `metric`. */
  readonly courtCards: GameState['courtCards']
}

/**
 * The scored quantity for a faction (base game — game.scala:1152).
 *
 * **Secured Guild cards count, and they were missing.** The rulebook scores Tycoon as "the most
 * total Fuel and Material icons **from resources and Guild cards**", and says of a Guild card's
 * suit: *"This suit icon matches one of the resources. It adds to ambitions just like resources.
 * Material and Fuel cards add to the Tycoon ambition, Relic cards add to the Keeper ambition, and
 * Psionic cards add to the Empath ambition."*
 *
 * Two details the card data makes easy to get wrong:
 *
 *   - **One icon per card, not `keys` of them.** `keys` is the *raid cost* — how many raid symbols
 *     an attacker spends to steal the card — and is unrelated to scoring. A comment in `court.ts`
 *     previously asserted the opposite, that secured cards do not score at all.
 *   - **Weapon guilds score nothing**, exactly as Weapon tokens do not: the rulebook says so
 *     outright, and it falls out here because no ambition asks for Weapons.
 */
export function metric(state: MetricView, faction: FactionId, ambition: Ambition): number {
  const slots = slotsOf(state, faction)
  const res = (r: Parameters<typeof countResource>[2]) =>
    countResource(state.resources, slots, r)
  // A secured Guild card contributes a single icon of its suit.
  const guilds = (r: Resource): number =>
    securedCards(state, faction).filter((id) => courtCard(id).suit === r).length
  const held = (r: Resource): number => res(r) + guilds(r)
  switch (ambition) {
    case 'Tycoon':
      return held('Material') + held('Fuel')
    case 'Keeper':
      return held('Relic')
    case 'Empath':
      return held('Psionic')
    case 'Tyrant':
      return contentsOf(state.figures, Location.captives(faction)).length
    case 'Warlord':
      return contentsOf(state.figures, Location.trophies(faction)).length
  }
}

// --- action constructors ---------------------------------------------------

export const CheckDeclare = (
  faction: FactionId,
  suit: string,
  strength: number,
  pips: number,
): Action => ({ type: 'ambition/check-declare', faction, suit, strength, pips })

const Declare = (
  faction: FactionId,
  ambition: Ambition,
  suit: string,
  pips: number,
): Action => ({ type: 'ambition/declare', faction, ambition, suit, pips })

const SkipDeclare = (faction: FactionId, suit: string, pips: number): Action => ({
  type: 'ambition/skip-declare',
  faction,
  suit,
  pips,
})

export const ScoreAmbitions = (): Action => ({ type: 'ambition/score' })
const CheckWin = (): Action => ({ type: 'ambition/check-win' })

// The chapter machinery lives in the turn module; mirrored by shape to avoid a cycle.
// The hand-off after a declaration is the *Prelude*, not the pip loop — `Prelude` is
// exported from prelude.ts precisely so both modules can reach it without importing
// each other. A local copy of turn.ts's `turn/pips` shape used to live here, and it
// skipped the whole Prelude phase for the lead player.
const StartChapter = (): Action => ({ type: 'chapter/start' })

// --- declaration -----------------------------------------------------------

function performCheckDeclare(
  state: GameState,
  faction: FactionId,
  suit: string,
  strength: number,
  pips: number,
): RuleResult {
  const eligible = ambitionsForStrength(strength)
  // An ambition can only be declared while a marker is available this chapter.
  const canDeclare = eligible.length > 0 && state.ambitionable.length > 0
  if (!canDeclare) {
    return { state, continue: C.then(Prelude(faction, suit as Suit, pips)) }
  }
  const options: Action[] = eligible.map((a) => ({
    ...Declare(faction, a, suit, pips),
    faction,
    label: `Declare ${a}`,
  }))
  return {
    state,
    continue: C.ask(
      faction,
      [...options, { ...SkipDeclare(faction, suit, pips), faction, label: 'Do not declare' }],
      `${faction} may declare an ambition`,
    ),
  }
}

/**
 * Spend the best available marker on `ambition`.
 *
 * Split out because a declaration does **not** always come from an action card: Populist
 * Demands (Vox, bc27) declares one for free. Zeroing the played card is a consequence of
 * declaring *off your card*, so it stays in `performDeclare` and not here.
 */
export function takeAmbitionMarker(
  state: GameState,
  faction: FactionId,
  ambition: Ambition,
): GameState {
  if (state.ambitionable.length === 0) return state
  // The highest-value available marker (game-common.scala uses ambitionable.last).
  const best = state.ambitionable.reduce((a, b) => (b.high > a.high ? b : a))
  const idx = state.ambitionable.indexOf(best)
  // Read before the marker lands: Connected asks whether this ambition was *already* declared.
  const wasFresh = !state.declared.some((d) => d.ambition === ambition)
  const taken: GameState = {
    ...state,
    ambitionable: state.ambitionable.filter((_, i) => i !== idx),
    declared: [...state.declared, { ambition, marker: best }],
    log: [...state.log, `${faction} declared ${ambition} (${best.high}/${best.low})`],
  }
  return wasFresh ? connected(taken, faction) : taken
}

/**
 * Connected (Noble, leader12): "When you **declare an ambition** that's not declared, draw and
 * secure the top card of the Court deck. (You can't use its Prelude action now.)"
 *
 * It lives here rather than in the post-declare menu because it is not a choice — the card is
 * drawn and secured outright — and because declaring does not always come from an action card:
 * Populist Demands declares for free and this fires off that too.
 *
 * The parenthesis needs no code. A Prelude action is bought by *spending a resource* of the
 * card's suit, which this does not touch, and the Prelude has already been passed by the time a
 * declaration resolves; nothing offers the freshly secured card's action this turn.
 */
function connected(state: GameState, faction: FactionId): GameState {
  if (!hasTrait(state, faction, 'Connected')) return state
  const top = contentsOf(state.courtCards, CourtPile.deck())[0]
  if (top === undefined) return state
  return {
    ...state,
    courtCards: move(state.courtCards, top, CourtPile.secured(faction)),
    log: [...state.log, `${faction} drew and secured ${courtCard(top).name} (Connected)`],
  }
}

function performDeclare(
  state: GameState,
  faction: FactionId,
  ambition: Ambition,
  suit: string,
  pips: number,
): RuleResult {
  const taken = takeAmbitionMarker(state, faction, ambition)
  // Declaring off your action card also zeroes it for surpass purposes — unless Secret Order
  // covers this ambition (`game-common.scala:1420`), which is the whole card.
  const shielded =
    hasGuild(state, faction, SECRET_ORDER) && (ambition === 'Keeper' || ambition === 'Empath')
  const lead = taken.lead && !shielded ? { ...taken.lead, zeroed: true } : taken.lead
  // Ambitious (Upstart) and Bold (Demagogue) both hang off *having declared*. The leaders module
  // owns that menu, so declaring hands off to it and it returns here by continuing to the Prelude.
  // Guarded by the traits, which are always false with the variant off, so a base game never
  // routes into an action no loaded module would handle.
  const bonus =
    hasTrait(taken, faction, 'Ambitious') || hasTrait(taken, faction, 'Bold')
  const next = bonus
    ? AfterDeclare(faction, suit as Suit, pips)
    : Prelude(faction, suit as Suit, pips)
  return { state: { ...taken, lead }, continue: C.then(next) }
}

const AfterDeclare = (faction: FactionId, suit: Suit, pips: number): Action => ({
  type: 'leaders/after-declare',
  faction,
  suit,
  pips,
  /** Which post-declare effects have already been taken — each is offered once. */
  used: [],
})

// --- scoring ---------------------------------------------------------------

/**
 * Score every declared ambition, awarding power. First place (a unique leader with a
 * positive metric) takes the summed high values plus a bonus for having few cities in
 * reserve; a unique runner-up takes the summed low. A tie for first awards each tied leader
 * the low value and no high. game-common.scala:2335-2500.
 */
/**
 * Just (Elder) on Tyrant, Violent (Warrior) on Empath, Academic (Archivist) on Tycoon: one rule,
 * one ambition each.
 *
 * First place pays the second-place value and forfeits the city bonus; second place pays
 * nothing. Both cards word it identically, and HRF implements them as two lines in the same
 * place, so they share one predicate here.
 */
function demotesFirst(state: GameState, faction: FactionId, ambition: Ambition): boolean {
  if (ambition === 'Tyrant' && hasTrait(state, faction, 'Just')) return true
  if (ambition === 'Empath' && hasTrait(state, faction, 'Violent')) return true
  // Academic (Archivist) is the same rule again, on Tycoon — the Archivist's other trait, and
  // word-for-word identical on the card.
  if (ambition === 'Tycoon' && hasTrait(state, faction, 'Academic')) return true
  return false
}

/**
 * Lavish (Fuel Drinker): all your Fuel is discarded once Tycoon has been declared this scoring.
 *
 * Note this fires whether or not the Fuel Drinker had anything to do with Tycoon — the card is a
 * flat downside on the ambition being scored at all. HRF keys on `game.declared.contains(Tycoon)`
 * (game-common.scala:2670); the card says "was scored", which for a declared ambition is the
 * same moment.
 */
function applyLavish(state: GameState): GameState {
  if (!state.declared.some((d) => d.ambition === 'Tycoon')) return state
  let resources = state.resources
  const log = [...state.log]
  for (const faction of state.factions) {
    if (!hasTrait(state, faction, 'Lavish')) continue
    const capacity = slotsOf(state, faction)
    const fuel = heldTokens(resources, capacity).filter(
      (t) => parseResourceToken(t).resource === 'Fuel',
    )
    if (fuel.length === 0) continue
    for (const token of fuel) resources = spendToken(resources, token)
    log.push(`${faction} discarded ${fuel.length} Fuel (their leader)`)
  }
  return { ...state, resources, log }
}

function performScore(state: GameState): RuleResult {
  const power: Partial<Record<FactionId, number>> = { ...state.power }
  const log = [...state.log]
  const winners: FactionId[] = []

  for (const ambition of state.ambitions) {
    const markers = state.declared.filter((d) => d.ambition === ambition).map((d) => d.marker)
    if (markers.length === 0) continue

    const high = markers.reduce((n, m) => n + m.high, 0)
    const low = markers.reduce((n, m) => n + m.low, 0)

    const scores = state.factions
      .map((f) => ({ faction: f, value: metric(state, f, ambition) }))
      .filter((s) => s.value > 0)

    if (scores.length === 0) {
      log.push(`No one scored ${ambition}`)
      continue
    }

    const max = Math.max(...scores.map((s) => s.value))
    const leaders = scores.filter((s) => s.value === max).map((s) => s.faction)

    if (leaders.length === 1) {
      const first = leaders[0]!
      const bonus =
        (citiesInReserve(state, first) < 2 ? 2 : 0) + (citiesInReserve(state, first) < 1 ? 3 : 0)
      // Just (Elder, on Tyrant) and Violent (Warrior, on Empath) replace a first place outright
      // with the second-place value — HRF reassigns `p` wholesale (game-common.scala:2397), which
      // is what the card means by "don't get bonus city Power": the city bonus goes too.
      const demoted = demotesFirst(state, first, ambition)
      const won = demoted ? low : high + bonus
      power[first] = (power[first] ?? 0) + won
      winners.push(first)
      log.push(
        demoted
          ? `${first} won ${ambition} but takes only ${won} power (their leader)`
          : `${first} won ${ambition} for ${won} power`,
      )

      const runnerValue = Math.max(...scores.filter((s) => s.value < max).map((s) => s.value), 0)
      const runners = scores.filter((s) => s.value === runnerValue && runnerValue > 0)
      if (runners.length === 1) {
        const second = runners[0]!.faction
        // The same two traits zero a second place (game-common.scala:2483), and Proud zeroes
        // anything that is not an outright win.
        const zeroed = demotesFirst(state, second, ambition) || hasTrait(state, second, 'Proud')
        const got = zeroed ? 0 : low
        power[second] = (power[second] ?? 0) + got
        log.push(
          zeroed
            ? `${second} placed second in ${ambition} but takes no power (their leader)`
            : `${second} placed second in ${ambition} for ${got} power`,
        )
      }
    } else {
      // Tie for first: each tied leader takes the low value; no first place awarded.
      for (const f of leaders) {
        // Proud (Noble): "you only gain Power if you get first place (not tied)". A tie is
        // explicitly not first place, so a Proud faction takes nothing from one — the trait's
        // whole cost, since tying is the common outcome it now refuses.
        const proud = hasTrait(state, f, 'Proud')
        power[f] = (power[f] ?? 0) + (proud ? 0 : low)
        log.push(
          proud
            ? `${f} tied ${ambition} but takes no power (their leader)`
            : `${f} tied ${ambition} for ${low} power`,
        )
      }
    }
  }

  return {
    state: applyLavish({ ...state, power, winners, log }),
    continue: C.then(CheckWin()),
  }
}

function performCheckWin(state: GameState): RuleResult {
  const threshold = 39 - state.factions.length * 3
  const maxPower = Math.max(...state.factions.map((f) => state.power[f] ?? 0))
  const finalChapter = state.chapter >= 5

  if (maxPower >= threshold || finalChapter) {
    const winner = state.factions.reduce((a, b) =>
      (state.power[b] ?? 0) > (state.power[a] ?? 0) ? b : a,
    )
    const reason =
      maxPower >= threshold
        ? `${winner} reached ${maxPower} power (threshold ${threshold})`
        : `game ended after 5 chapters; ${winner} leads with ${maxPower} power`
    return {
      state: { ...state, isOver: true, winners: [winner] },
      continue: C.gameOver([winner], reason),
    }
  }
  return { state, continue: C.milestone('chapter end', StartChapter()) }
}

// --- module ----------------------------------------------------------------

export const AmbitionsModule: RuleModule = {
  id: 'ambitions',
  perform(state: GameState, action: Action): RuleResult {
    switch (action.type) {
      case 'ambition/check-declare':
        return performCheckDeclare(
          state,
          action['faction'] as FactionId,
          action['suit'] as string,
          action['strength'] as number,
          action['pips'] as number,
        )
      case 'ambition/declare':
        return performDeclare(
          state,
          action['faction'] as FactionId,
          action['ambition'] as Ambition,
          action['suit'] as string,
          action['pips'] as number,
        )
      case 'ambition/skip-declare':
        return {
          state,
          continue: C.then(
            Prelude(
              action['faction'] as FactionId,
              action['suit'] as Suit,
              action['pips'] as number,
            ),
          ),
        }
      case 'ambition/score':
        return performScore(state)
      case 'ambition/check-win':
        return performCheckWin(state)
      default:
        return unhandled(state)
    }
  },
}
