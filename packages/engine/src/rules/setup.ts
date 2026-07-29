/**
 * Setup, as rules rather than as a constructor.
 *
 * HRF runs setup through ordinary actions, which is precisely why the campaign can
 * intercept and replace parts of it without forking base setup. A
 * `function setupGame(): GameState` would have to be forked in phase 2.
 * See docs/04-scope-and-phasing.md section 2.4.
 */

import type { Action } from '../action.js'
import { Continue as C } from '../continue.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { system as systemInfo } from '../board.js'
import { AGENTS_PER_FACTION, BASE_COURT, CourtPile, courtSlots } from '../court.js'
import { CardLocation, Location, figureId } from '../ids.js'
import type { ColorId, Piece } from '../ids.js'
import { ANCIENT_HOLDINGS, hasLore } from '../lore.js'
import { shuffle } from '../rng.js'
import type { GameState } from '../state.js'
import type { Resource } from '../resources.js'
import { ResourceSlot, gain, registerResources, slotCapacity, usableSlots } from '../resources.js'
import { contentsOf, move, place, register } from '../tracker.js'
import { StartChapter } from './turn.js'

export const SHIPS_PER_FACTION = 15
export const CITIES_PER_FACTION = 5
export const STARPORTS_PER_FACTION = 5
// Agents come from court.ts, which owns them — they are the currency of the court and the
// real limit on influencing, not a setup constant.

export const StartSetup = (): Action => ({ type: 'setup/start' })
export const SeatSetup = (seat: number): Action => ({ type: 'setup/seat', seat })

/** Register every location this phase needs, then seat the factions one at a time. */
function performStartSetup(state: GameState): RuleResult {
  let figures = state.figures

  for (const s of state.board.systems) figures = register(figures, Location.system(s))
  for (const color of state.colors) figures = register(figures, Location.reserve(color))
  for (const faction of state.factions) {
    figures = register(figures, Location.trophies(faction))
    figures = register(figures, Location.captives(faction))
  }
  // Agents stand on court slots, so the slots are figure locations too.
  for (const n of courtSlots()) figures = register(figures, Location.court(n))
  figures = register(figures, Location.scrap())

  // Everything starts in reserve; seat setup moves pieces onto the board.
  for (const color of state.colors) {
    figures = place(figures, startingPieces(color), Location.reserve(color))
  }

  // Card locations: one deck and discard, plus a hand and played pile per faction.
  let cards = register(state.cards, CardLocation.deck())
  cards = register(cards, CardLocation.discard())
  for (const faction of state.factions) {
    cards = register(cards, CardLocation.hand(faction))
    cards = register(cards, CardLocation.played(faction))
  }

  // Resource supply and per-faction slots.
  const resources = registerResources(state.resources, state.factions)

  // The court: a shuffled deck, four display slots, a secured pile per faction, a discard.
  let courtCards = register(state.courtCards, CourtPile.deck())
  courtCards = register(courtCards, CourtPile.discard())
  for (const n of courtSlots()) courtCards = register(courtCards, CourtPile.slot(n))
  for (const faction of state.factions) {
    courtCards = register(courtCards, CourtPile.secured(faction))
  }
  const [order, rng] = shuffle(state.rng, BASE_COURT.map((c) => c.id))
  courtCards = place(courtCards, order, CourtPile.deck())
  // Deal the opening display, as HRF does via ReplenishMarketAction at chapter 0.
  for (const n of courtSlots()) {
    const top = contentsOf(courtCards, CourtPile.deck())[0]
    if (top === undefined) break
    courtCards = move(courtCards, top, CourtPile.slot(n))
  }

  return {
    state: { ...state, figures, cards, resources, courtCards, rng },
    continue: C.then(SeatSetup(0)),
  }
}

function startingPieces(color: ColorId): string[] {
  const of = (piece: Piece, n: number) =>
    Array.from({ length: n }, (_, i) => figureId(color, piece, i + 1))
  return [
    ...of('Ship', SHIPS_PER_FACTION),
    ...of('City', CITIES_PER_FACTION),
    ...of('Starport', STARPORTS_PER_FACTION),
    ...of('Agent', AGENTS_PER_FACTION),
  ]
}

/**
 * What a faction puts on the board at each of its three starting positions: A is the seat's
 * first system, B its second, C *each* fleet system.
 *
 * The base game's opening happens to be exactly the shape of a leader's card — City+3 ships,
 * Starport+3 ships, 2 ships per fleet — so leaders replace this list rather than needing a
 * parallel code path. See docs/14 section 2.
 */
export interface SeatPlacement {
  readonly a: readonly Piece[]
  readonly b: readonly Piece[]
  readonly c: readonly Piece[]
}

export const STANDARD_PLACEMENT: SeatPlacement = {
  a: ['City', 'Ship', 'Ship', 'Ship'],
  b: ['Starport', 'Ship', 'Ship', 'Ship'],
  c: ['Ship', 'Ship'],
}

/** "a City and 3 Ships" — for the log, since a leader's opening is not the standard one. */
function describe(pieces: readonly Piece[]): string {
  const counts = new Map<Piece, number>()
  for (const p of pieces) counts.set(p, (counts.get(p) ?? 0) + 1)
  const parts = [...counts].map(([piece, n]) =>
    n === 1 ? `a ${piece}` : `${n} ${piece}s`,
  )
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`
    : (parts[0] ?? 'nothing')
}

/**
 * Seat one faction: move its opening pieces out of reserve and give it its starting resources.
 *
 * Exported because the *Leaders and Lore* variant seats factions too, with the drafted leader's
 * pieces and resources rather than the board's defaults (`LeadersModule`). Keeping one
 * implementation means a leader cannot drift from the base game on anything but the lists.
 *
 * `resources` undefined means "take what the starting systems produce", which is the base rule;
 * a leader passes its own two instead.
 */
export function seatFaction(
  state: GameState,
  seat: number,
  placement: SeatPlacement,
  resources?: readonly Resource[],
): RuleResult {
  const faction = state.factions[seat]
  const start = state.board.starting[seat]

  if (faction === undefined || start === undefined) {
    // Setup done; the turn module owns chapters, rounds and turns from here.
    return { state, continue: C.milestone('setup complete', StartChapter()) }
  }

  const [systemA, systemB, fleetSystems] = start
  const reserve = Location.reserve(faction)
  let figures = state.figures

  const deploy = (pieces: readonly Piece[], to: string): void => {
    for (const piece of pieces) {
      const available = figures.contents
        .get(reserve)!
        .filter((id) => id.startsWith(`${faction}/${piece}/`))
      const next = available[0]
      if (next === undefined) {
        throw new Error(`${faction} has no ${piece} left in reserve, needed one for ${to}`)
      }
      figures = move(figures, next, Location.system(to))
    }
  }

  deploy(placement.a, systemA)
  deploy(placement.b, systemB)
  for (const fleet of fleetSystems) deploy(placement.c, fleet)

  // A faction still holds every city but the one it just placed, which is what its slot
  // capacity is derived from.
  const citiesLeft = CITIES_PER_FACTION - placement.a.filter((p) => p === 'City').length
    - placement.b.filter((p) => p === 'City').length
  // Built from the predicted count rather than `slotsOf`, because the pieces above have not been
  // committed to state yet. A faction that drafted Ancient Holdings brings its slot to setup too.
  const slots = usableSlots(faction, slotCapacity(citiesLeft))
  if (hasLore(state, faction, ANCIENT_HOLDINGS)) {
    slots.push(ResourceSlot.cardSlot(faction, ANCIENT_HOLDINGS))
  }

  // Base rule: gain what the two starting systems produce. A leader brings its own instead.
  const wanted: readonly Resource[] =
    resources ??
    [systemA, systemB]
      .map((sys) => systemInfo(sys).resource)
      .filter((r): r is string => r !== null)
      .map((r) => r as Resource)

  let tracker = state.resources
  const taken: string[] = []
  for (const r of wanted) {
    const result = gain(tracker, slots, r)
    tracker = result.tracker
    if (result.gained) taken.push(r)
  }

  const fleetNote =
    fleetSystems.length > 0 && placement.c.length > 0
      ? `, ${describe(placement.c)} in ${fleetSystems.join(', ')}`
      : ''
  const resNote = taken.length > 0 ? `, took ${taken.join(' + ')}` : ''
  const next: GameState = {
    ...state,
    figures,
    resources: tracker,
    log: [
      ...state.log,
      `${faction} placed ${describe(placement.a)} in ${systemA}, ` +
        `${describe(placement.b)} in ${systemB}${fleetNote}${resNote}`,
    ],
  }
  return { state: next, continue: C.then(SeatSetup(seat + 1)) }
}

export const SetupModule: RuleModule = {
  id: 'setup',
  perform(state: GameState, action: Action): RuleResult {
    switch (action.type) {
      case 'setup/start':
        return performStartSetup(state)
      case 'setup/seat':
        return seatFaction(state, action['seat'] as number, STANDARD_PLACEMENT)
      default:
        return unhandled(state)
    }
  },
}
