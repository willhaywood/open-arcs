/**
 * What a faction can *earn*, as opposed to what it currently holds.
 *
 * docs/19 section 4, step 1. The gap this closes was found by inspecting a real decision: red held
 * two Material, was merely tied for Tycoon, and declared it on a margin of 0.01 — while a bot with
 * three cities on Material planets and Administration in hand would decline, because
 * `metric('Tycoon')` is Material and Fuel **held right now** and nothing anywhere projects income.
 * The bot is an inventory player rather than a planner, and this is the missing input.
 *
 * ## Structure only, deliberately
 *
 * Income is counted from **cities standing on planets that produce the resource** and nothing else.
 * Notably *not* from the hand, even though holding Administration is exactly what lets you tax.
 *
 * That is the anti-flap rule of section 2b, which is easy to violate here and expensive to get
 * wrong: a bot's own hand changes *during its turn*, so an income estimate that read card suits
 * would fall the moment a card was played, and the bot would argue with itself between two of its
 * own actions. Cities and planets barely move within a turn, which is what makes them safe to read —
 * the same reason the original design read structure rather than resources.
 *
 * Hand-based capacity is a real signal and a later step; it needs measuring against the flap tests
 * before it can be trusted, not assuming.
 */

import { planetResource } from '../control.js'
import { AMBITIONS } from '../state.js'
import { Location, contentsOf, parseFigureId } from '../index.js'
import type { FactionId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { Resource } from '../resources.js'
import type { Ambition } from '../state.js'

/** Which ambition each resource feeds. Weapons feed battle rather than an ambition. */
const FEEDS: Readonly<Partial<Record<Resource, Ambition>>> = {
  Material: 'Tycoon',
  Fuel: 'Tycoon',
  Relic: 'Keeper',
  Psionic: 'Empath',
}

/**
 * Cities a faction holds, by the ambition the planet under them feeds.
 *
 * One city on a Material planet is one unit of income: it can be taxed once a turn, and what it
 * yields is what that planet produces. No attempt is made to discount for reachability or for
 * whether the pips will be available — that is a scale question for the weight, not a shape question
 * for the feature.
 */
export function incomeFor(
  observed: ObservedState,
  self: FactionId,
): ReadonlyMap<Ambition, number> {
  const out = new Map<Ambition, number>(AMBITIONS.map((a) => [a, 0]))
  for (const system of observed.board.systems) {
    const resource = planetResource(observed, system)
    if (resource === undefined) continue
    const ambition = FEEDS[resource]
    if (ambition === undefined) continue
    const cities = contentsOf(observed.figures, Location.system(system)).filter((id) => {
      const f = parseFigureId(id)
      return f.color === self && f.piece === 'City'
    }).length
    if (cities > 0) out.set(ambition, (out.get(ambition) ?? 0) + cities)
  }
  return out
}
