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
import { declareReadiness } from './declare-ready.js'
import { incomeFor } from './income.js'
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

/**
 * The named quantities a position presents, before any weight is applied.
 *
 * **Splitting these from the weights is what makes the evaluator fittable at all.** `valueOf` is a
 * linear function — a dot product of these features with `WEIGHTS` — and every number in `WEIGHTS`
 * was chosen by argument rather than evidence. Written this way they become data: measurable from
 * self-play, comparable between candidate sets, and replaceable without touching this file.
 *
 * The features deliberately keep the *shape* of each term and expose only its scale. Ambition
 * standing stays `marker.high x share x bias`, because how a marker's payout scales with how clearly
 * you are winning is a rule of the game, not a weight; what is free is how much the whole thing is
 * worth relative to a city. That keeps the parameter count near a dozen instead of near fifty, which
 * matters when the arena's noise floor is what has to confirm any change.
 */
export const FEATURES = [
  'power',
  'standing',
  'resourcesDeclared',
  'resourcesUndeclared',
  'incomeDeclared',
  'incomeUndeclared',
  'declareReady',
  'weapons',
  'cities',
  'starports',
  'shipsFresh',
  'shipsDamaged',
  'courtSecured',
  'courtClaimAhead',
  'courtClaimLevel',
  'courtClaimBehind',
  'trophies',
  'captives',
  'tempo',
] as const

export type Feature = (typeof FEATURES)[number]
export type Weights = Readonly<Record<Feature, number>>
export type Features = Readonly<Record<Feature, number>>

/**
 * The hand-set weights, in units of expected power.
 *
 * Every one is a starting point chosen by argument (docs/19 section 2d.7). They are the baseline any
 * fitted set has to beat, and the arena is the only thing entitled to say whether it does.
 */
export const WEIGHTS: Weights = {
  power: 1,
  standing: 1,
  resourcesDeclared: 0.45,
  resourcesUndeclared: 0.1125,
  /*
   * Income is **off by default**, which is the point of adding it this way. `heuristicBot` is the
   * frozen baseline (docs/19 section 4) and a weight of zero leaves it byte-identical, so the new
   * signal can be measured by a bot that turns it on rather than by silently moving the thing it is
   * being compared against. `GOAL_WEIGHTS` in `goal.ts` is where it is switched on.
   */
  incomeDeclared: 0,
  incomeUndeclared: 0,
  /*
   * Also off by default, and for the same reason: the frozen baseline must stay byte-identical so a
   * bot that switches this on can be attributed a difference. `GOAL_WEIGHTS` turns it on.
   */
  declareReady: 0,
  weapons: 0.25,
  cities: 2.0,
  starports: 1.2,
  shipsFresh: 0.35,
  shipsDamaged: 0.1,
  courtSecured: 1,
  courtClaimAhead: 0.25,
  courtClaimLevel: 0.12,
  courtClaimBehind: 0.05,
  trophies: 0.3,
  captives: 0.3,
  tempo: 0.15,
}

const zero = (): Record<Feature, number> =>
  Object.fromEntries(FEATURES.map((f) => [f, 0])) as Record<Feature, number>

/** What a position presents to one faction, unweighted. */
export function featuresOf(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
): Features {
  const x = zero()

  // Realised power. The only certain quantity here.
  x.power = observed.power[self] ?? 0

  /*
   * Ambition standing — the dominant term mid-chapter. The payout scaled by how clearly you are
   * winning it, because a marker you are second on pays the low value and one you are losing pays
   * nothing.
   */
  for (const d of observed.declared) {
    const mine = metric(observed, self, d.ambition)
    const best = Math.max(
      0,
      ...observed.factions.filter((f) => f !== self).map((f) => metric(observed, f, d.ambition)),
    )
    const share = mine === 0 && best === 0 ? 0 : mine > best ? 1 : mine === best ? 0.5 : 0.2
    x.standing += d.marker.high * share * bias(intent, d.ambition)
  }

  /*
   * Resources, priced by the ambition they feed (docs/03 section 3.3). A Material is worth nothing
   * in itself — it is worth the Tycoon it might win. Declared and undeclared are separate features
   * rather than one scaled by a constant, so how much cheaper a speculative resource is can be
   * fitted rather than asserted.
   */
  const slots = slotsOf(observed, self)
  const declared = new Set(observed.declared.map((d) => d.ambition))
  for (const ambition of AMBITIONS) {
    const feeds = FEEDS[ambition]
    if (feeds === undefined) continue
    const held = feeds.reduce((n, r) => n + countResource(observed.resources, slots, r), 0)
    if (held === 0) continue
    const scaled = held * bias(intent, ambition)
    if (declared.has(ambition)) x.resourcesDeclared += scaled
    else x.resourcesUndeclared += scaled
  }
  x.weapons = countResource(observed.resources, slots, 'Weapon')

  /*
   * What the position can *earn*, as opposed to what it holds — cities standing on planets that
   * produce the resource an ambition scores. Split declared from undeclared for the same reason the
   * held resources are: income toward something nobody has declared is a prospect, not a prize.
   */
  const income = incomeFor(observed, self)
  for (const ambition of AMBITIONS) {
    const earned = income.get(ambition) ?? 0
    if (earned === 0) continue
    const scaled = earned * bias(intent, ambition)
    if (declared.has(ambition)) x.incomeDeclared += scaled
    else x.incomeUndeclared += scaled
  }

  // Buildings: power at scoring, plus everything they unlock — tax income, build sites, capacity.
  x.cities = pieces(observed, self, 'City').length
  x.starports = pieces(observed, self, 'Starport').length

  /*
   * Ships, fresh separated from damaged — a damaged ship rules nothing, which the catapult bug in
   * docs/15 confirmed the engine agrees with.
   */
  const ships = pieces(observed, self, 'Ship')
  x.shipsFresh = ships.filter((id) => !observed.damaged.includes(id)).length
  x.shipsDamaged = ships.length - x.shipsFresh

  /*
   * The court, in two halves: what is held, and what is being contested. Securing needs *more*
   * agents on a card than anyone else, so it is a build-up, and pricing only the finished article
   * left the first Influence worth exactly nothing (docs/19 section 2i).
   */
  for (const id of contentsOf(observed.courtCards, CourtPile.secured(self))) {
    x.courtSecured += courtWorth(id, intent)
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
    const worth = courtWorth(id, intent)
    // `canSecure` is `mine > best`, so the three cases are ahead, level and behind.
    if (mine > best) x.courtClaimAhead += worth
    else if (mine === best) x.courtClaimLevel += worth
    else x.courtClaimBehind += worth
  }

  // Trophies and captives are already counted by their ambition standing; this is their floor.
  x.trophies = contentsOf(observed.figures, Location.trophies(self)).length
  x.captives = contentsOf(observed.figures, Location.captives(self)).length

  /*
   * Being in a position to *declare* what this faction wants — a card of the right strength, a
   * marker still free, and the initiative to lead with it. Nothing else here knows any of those,
   * which is what makes it the first of these additions with no existing proxy.
   */
  x.declareReady = declareReadiness(observed, self, intent)

  // Tempo — cards are options. Easy to over-price, and hard to justify beyond that.
  x.tempo = observed.handSizes[self] ?? 0

  return x
}

/** Expected power for one faction, itemised — features times the weights in force. */
export function termsFor(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
  weights: Weights = WEIGHTS,
): readonly Term[] {
  const x = featuresOf(observed, self, intent)
  return FEATURES.map((f) => ({ name: f, power: x[f] * weights[f] })).filter((t) => t.power !== 0)
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
  weights: Weights = WEIGHTS,
): number {
  const score = (f: FactionId): number => {
    const x = featuresOf(observed, f, intent)
    let total = 0
    for (const k of FEATURES) total += x[k] * weights[k]
    return total
  }
  const mine = score(self)
  const best = Math.max(0, ...observed.factions.filter((f) => f !== self).map(score))
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
