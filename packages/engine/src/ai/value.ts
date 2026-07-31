/**
 * What a position is worth, in units of expected power.
 *
 * docs/19 section 2d.4. Every term is expressed as power the faction can expect to end up with,
 * which is what makes them addable — a city and three Material are otherwise incomparable — and
 * what makes the resulting number mean something rather than being an index.
 *
 * **Relative, not absolute** (docs/03 section 3.1): the value of a position is your power minus the
 * best opponent's. A move that gains you 2 and gives a rival 3 is bad, and an absolute score cannot
 * say so.
 *
 * **Every multiplier here is a starting point.** They were chosen by argument, not evidence, and
 * the arena exists to move them (docs/19 section 2d.7). Any number that survives to V2 untouched
 * should be treated as suspicious rather than confirmed.
 */

import { metric } from '../rules/ambitions.js'
import { AMBITIONS } from '../state.js'
import {
  CourtPile,
  Location,
  contentsOf,
  countResource,
  courtCard,
  courtSlots,
  parseFigureId,
  slotsOf,
} from '../index.js'
import type { FactionId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { Resource } from '../resources.js'
import type { Ambition } from '../state.js'
import type { ChapterIntent } from './intent.js'

/** Which resource each ambition scores, for pricing what is held. */
const FEEDS: Readonly<Partial<Record<Ambition, readonly Resource[]>>> = {
  Tycoon: ['Material', 'Fuel'],
  Keeper: ['Relic'],
  Empath: ['Psionic'],
}

/** One named contribution, kept so the diagnostic panel can itemise a decision. */
export interface Term {
  readonly name: string
  readonly power: number
}

/**
 * Intent moves weights; it never branches (docs/19 section 2c, following Civ V).
 *
 * An ambition the bot is not pursuing keeps **half** weight rather than zero — a free Relic is
 * still a free Relic, and a bot that ignores everything off-plan is exploitable. One pursued hard
 * reaches 2×.
 */
const bias = (intent: ChapterIntent, ambition: Ambition): number =>
  0.5 + 1.5 * (intent.pursuing.get(ambition) ?? 0)

/** The ambition a guild's resource feeds, inverted from `FEEDS`. */
const AMBITION_OF: Readonly<Partial<Record<Resource, Ambition>>> = {
  Material: 'Tycoon',
  Fuel: 'Tycoon',
  Relic: 'Keeper',
  Psionic: 'Empath',
}

/**
 * What one court card is worth to hold, rather than a flat rate for any of them.
 *
 * Three things the card data already carries, so no per-card table has to be authored:
 *
 *   - **`suit`** — the resource the guild deals in, which ties the card straight to an ambition and
 *     therefore to `intent`. A Fuel guild is worth far more to a bot going for Tycoon, and that is
 *     the whole reason to prefer one card over another.
 *   - **`keys`** — what it costs a rival to raid the card off you. The designers' own measure of how
 *     good it is, and free to read.
 *   - **`kind`** — a Vox card is discarded when taken rather than held, so it is a one-shot effect
 *     and priced low and flat. Pretending it is a lasting asset would be worse than crude.
 *
 * Every number is a starting point for the arena, like the rest of this file.
 */
function courtWorth(id: string, intent: ChapterIntent): number {
  const card = courtCard(id)
  if (card.kind !== 'guild') return 0.6
  const strength = 0.9 + (card.keys ?? 1) * 0.5
  const ambition = card.suit === undefined ? undefined : AMBITION_OF[card.suit]
  return strength * (ambition === undefined ? 1 : bias(intent, ambition))
}

function pieces(observed: ObservedState, self: FactionId, piece: string): string[] {
  const out: string[] = []
  for (const s of observed.board.systems) {
    for (const id of contentsOf(observed.figures, Location.system(s))) {
      const f = parseFigureId(id)
      if (f.color === self && f.piece === piece) out.push(id)
    }
  }
  return out
}

/** Expected power for one faction, itemised. */
export function termsFor(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
): readonly Term[] {
  const terms: Term[] = []

  // Realised power. The only certain term, so it is worth exactly itself.
  terms.push({ name: 'power', power: observed.power[self] ?? 0 })

  /*
   * Ambition standing — the dominant term mid-chapter. Worth the payout scaled by how clearly you
   * are winning it, because a marker you are second on pays the low value and one you are losing
   * pays nothing.
   */
  for (const d of observed.declared) {
    const mine = metric(observed, self, d.ambition)
    const best = Math.max(
      0,
      ...observed.factions.filter((f) => f !== self).map((f) => metric(observed, f, d.ambition)),
    )
    const share = mine === 0 && best === 0 ? 0 : mine > best ? 1 : mine === best ? 0.5 : 0.2
    terms.push({
      name: `${d.ambition} standing`,
      power: d.marker.high * share * bias(intent, d.ambition),
    })
  }

  /*
   * Resources, priced by the ambition they feed (docs/03 section 3.3). A Material is worth nothing
   * in itself — it is worth the Tycoon it might win, so an undeclared Tycoon makes it near-free.
   * The small floor keeps a bot from throwing resources away entirely, since they buy Prelude
   * actions whatever is declared.
   */
  const slots = slotsOf(observed, self)
  const declared = new Set(observed.declared.map((d) => d.ambition))
  for (const ambition of AMBITIONS) {
    const feeds = FEEDS[ambition]
    if (feeds === undefined) continue
    const held = feeds.reduce((n, r) => n + countResource(observed.resources, slots, r), 0)
    if (held === 0) continue
    const live = declared.has(ambition) ? 1 : 0.25
    terms.push({
      name: `${ambition} resources`,
      power: held * 0.45 * live * bias(intent, ambition),
    })
  }
  // Weapons feed battle rather than an ambition, so they are priced flat.
  const weapons = countResource(observed.resources, slots, 'Weapon')
  if (weapons > 0) terms.push({ name: 'weapons', power: weapons * 0.25 })

  // Buildings: power at scoring, plus everything they unlock — tax income, build sites, capacity.
  const cities = pieces(observed, self, 'City').length
  const ports = pieces(observed, self, 'Starport').length
  if (cities > 0) terms.push({ name: 'cities', power: cities * 2.0 })
  if (ports > 0) terms.push({ name: 'starports', power: ports * 1.2 })

  /*
   * Ships, fresh worth far more than damaged — a damaged ship rules nothing, which the catapult bug
   * in docs/15 confirmed the engine agrees with.
   */
  const ships = pieces(observed, self, 'Ship')
  const fresh = ships.filter((id) => !observed.damaged.includes(id)).length
  const hurt = ships.length - fresh
  if (ships.length > 0) terms.push({ name: 'ships', power: fresh * 0.35 + hurt * 0.1 })

  /*
   * The court, in two halves: what is held, and what is being contested.
   *
   * The second half is the one that changes behaviour. Securing needs *more* agents on a card than
   * anyone else, so it is a build-up — and a flat "1.1 per secured card" priced only the finished
   * article, leaving the first Influence worth exactly nothing. One ply then never took it, so the
   * agents never accumulated and the card was never secured: 11 influences, 0 secures and 1 card
   * taken across a whole three-player game. The same shape of blind spot as leading a card, and the
   * same fix — price the progress, not just the result.
   */
  for (const id of contentsOf(observed.courtCards, CourtPile.secured(self))) {
    terms.push({ name: `court ${courtCard(id).name}`, power: courtWorth(id, intent) })
  }

  for (const slot of courtSlots()) {
    const id = contentsOf(observed.courtCards, CourtPile.slot(slot))[0]
    if (id === undefined) continue
    const on = (f: FactionId): number =>
      contentsOf(observed.figures, Location.court(slot)).filter(
        (a) => parseFigureId(a).color === f,
      ).length
    const mine = on(self)
    if (mine === 0) continue
    const best = Math.max(0, ...observed.factions.filter((f) => f !== self).map(on))
    /*
     * How likely the card is to end up yours, since `canSecure` is `mine > best`. Ahead is worth
     * more than level, because only ahead can actually take it.
     *
     * **Deliberately a small fraction, and the first version got this wrong.** At 0.6 a claim banked
     * most of the card's value for free, so paying a pip to actually secure it bought only the
     * remaining 0.4 and scored as a loss — the bot was offered Secure 15 times in a game and
     * declined all 15. A claim has to be worth enough to reach for and little enough that closing it
     * is clearly worth an action.
     */
    const claim = mine > best ? 0.25 : mine === best ? 0.12 : 0.05
    terms.push({
      name: `court claim ${courtCard(id).name}`,
      power: courtWorth(id, intent) * claim,
    })
  }

  // Trophies and captives are already counted by their ambition standing; this is their floor.
  const trophies = contentsOf(observed.figures, Location.trophies(self)).length
  const captives = contentsOf(observed.figures, Location.captives(self)).length
  if (trophies > 0) terms.push({ name: 'trophies', power: trophies * 0.3 })
  if (captives > 0) terms.push({ name: 'captives', power: captives * 0.3 })

  // Tempo. Small on purpose — easy to over-price, and hard to justify beyond "cards are options".
  terms.push({ name: 'tempo', power: (observed.handSizes[self] ?? 0) * 0.15 })

  return terms
}

const sum = (terms: readonly Term[]): number => terms.reduce((n, t) => n + t.power, 0)

/**
 * The position's worth to `self`, relative to the best opponent.
 *
 * Opponents are scored with `self`'s own intent, which is a deliberate simplification: modelling
 * what each rival is going for is a V2 concern, and using one intent for everyone at least prices
 * their positions on the same scale as ours.
 */
export function valueOf(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
): number {
  const mine = sum(termsFor(observed, self, intent))
  const best = Math.max(
    0,
    ...observed.factions.filter((f) => f !== self).map((f) => sum(termsFor(observed, f, intent))),
  )
  return mine - best
}

/** The top few contributions, for the `because` line and the diagnostic panel. */
export function topTerms(terms: readonly Term[], n = 3): string {
  return [...terms]
    .filter((t) => t.power !== 0)
    .sort((a, b) => Math.abs(b.power) - Math.abs(a.power))
    .slice(0, n)
    .map((t) => `${t.name} ${t.power >= 0 ? '+' : ''}${t.power.toFixed(1)}`)
    .join(', ')
}
