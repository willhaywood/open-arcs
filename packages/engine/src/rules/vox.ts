/**
 * Vox card triggers — what happens when one is secured.
 *
 * Transcribed from haunt-roll-fail `arcs/game-base.scala:208-297`, with disposal from
 * `game-common.scala:346-360, 627-665`.
 *
 * A Vox card is not kept: it fires once and goes. Two disposals, and the difference matters:
 *
 *   - **Discard** (five of the six) — into the court discard.
 *   - **Bury** (Song of Freedom) — back into the court *deck*, which is then shuffled. So
 *     Song of Freedom can come round again; the others cannot until Guild Struggle recycles
 *     the discard, and even then only *guild* cards go back (`game-common.scala:347`).
 *
 * Securing a Vox card is otherwise a normal secure: the captives are already taken and the
 * slot already refilled by the time these run.
 */

import type { Action } from '../action.js'
import { system as systemInfo } from '../board.js'
import { Continue as C } from '../continue.js'
import type { Continue } from '../continue.js'
import { rules } from '../control.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { CourtPile, SWORN_GUARDIANS, courtCard } from '../court.js'
import { CardLocation, Location, parseFigureId } from '../ids.js'
import type { FactionId, SystemId } from '../ids.js'
import { provokeOutrage } from '../outrage.js'
import { RESOURCES } from '../resources.js'
import type { Resource } from '../resources.js'
import { shuffle } from '../rng.js'
import type { Ambition, GameState } from '../state.js'
import { contentsOf, move, moveAll } from '../tracker.js'
import { takeAmbitionMarker } from './ambitions.js'

/** Entry point: fire the Vox card `card` just secured by `faction`, then continue to `then`. */
export const VoxTrigger = (faction: FactionId, card: string, then: unknown): Action => ({
  type: 'vox/trigger',
  faction,
  card,
  then,
})

const Done = (faction: FactionId, card: string, then: unknown, bury = false): Action => ({
  type: 'vox/done',
  faction,
  card,
  then,
  bury,
})

const skip = (faction: FactionId, card: string, then: unknown, bury = false): Action => ({
  ...Done(faction, card, then, bury),
  faction,
  label: 'Skip',
})

/** Ships a faction can still place. */
function shipsInReserve(state: GameState, faction: FactionId): string[] {
  return contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  )
}

// --- the six ---------------------------------------------------------------

/** Call to Action (bc31): draw one action card. */
function callToAction(state: GameState, faction: FactionId, card: string, then: unknown): RuleResult {
  const top = contentsOf(state.cards, CardLocation.deck())[0]
  if (top === undefined) {
    return {
      state: { ...state, log: [...state.log, `${faction} drew nothing — the deck is empty`] },
      continue: C.then(Done(faction, card, then)),
    }
  }
  return {
    state: {
      ...state,
      cards: move(state.cards, top, CardLocation.hand(faction)),
      log: [...state.log, `${faction} drew a card with Call to Action`],
    },
    continue: C.then(Done(faction, card, then)),
  }
}

/**
 * Populist Demands (bc27): declare an ambition, free. Uses the same marker-taking as a normal
 * declaration but **does not zero a played card** — that is a consequence of declaring off
 * your action card, not of declaring as such.
 */
function populistDemands(state: GameState, faction: FactionId, card: string, then: unknown): Continue {
  if (state.ambitionable.length === 0) {
    return C.then(Done(faction, card, then))
  }
  const options: Action[] = state.ambitions.map((a) => ({
    type: 'vox/populist',
    faction,
    ambition: a,
    card,
    then,
    label: `Declare ${a}`,
  }))
  return C.ask(faction, [...options, skip(faction, card, then)], 'Populist Demands — declare an ambition')
}

/**
 * Mass Uprising (bc26): "Choose a cluster on the map. **You place 1 ship in each system of that
 * cluster.** Discard this card."
 *
 * **One per system, and not a choice of systems** — a divergence from HRF, which enumerates every
 * combination of systems in the cluster as though you were spending a budget of four ships
 * wherever you liked. That reading lets you stack two ships in one system and leave another empty,
 * which "1 ship in each system" forbids, and it asks a question the card never asks.
 *
 * The only genuine decision is when your reserve cannot fill the cluster: the card does not say
 * what happens then, so the systems that get one are the player's choice. That is the sole case
 * that still prompts — see `uprisingPlacement`, which excludes systems already given a ship.
 */
function massUprising(state: GameState, faction: FactionId, card: string, then: unknown): Continue {
  if (shipsInReserve(state, faction).length === 0) return C.then(Done(faction, card, then))
  const clusters = [...new Set(state.board.systems.map((s) => systemInfo(s).cluster))].sort()
  const options: Action[] = clusters.map((n) => {
    const size = state.board.systems.filter((s) => systemInfo(s).cluster === n).length
    const ships = Math.min(size, shipsInReserve(state, faction).length)
    return {
      type: 'vox/uprising',
      faction,
      cluster: n,
      left: ships,
      card,
      then,
      label:
        ships < size
          ? `Rise up in cluster ${n} (only ${ships} ship${ships === 1 ? '' : 's'} in reserve)`
          : `Rise up in cluster ${n} (1 ship in each of ${size} systems)`,
    }
  })
  return C.ask(faction, [...options, skip(faction, card, then)], 'Mass Uprising — choose a cluster')
}

/**
 * Fill the cluster, one ship per system.
 *
 * `placed` is the systems already given a ship by this card, and excluding them is what enforces
 * "1 ship in **each** system" — without it the same system could take the whole reserve.
 *
 * With enough ships there is nothing to decide, so nothing is asked: the remaining systems are
 * filled outright. A prompt appears only when the reserve is short, which the card does not cover
 * and where the player must therefore pick.
 */
function uprisingPlacement(
  state: GameState,
  faction: FactionId,
  cluster: number,
  left: number,
  card: string,
  then: unknown,
  placed: readonly string[] = [],
): Continue {
  const remaining = state.board.systems.filter(
    (s) => systemInfo(s).cluster === cluster && !placed.includes(s),
  )
  const ships = shipsInReserve(state, faction).length
  if (left <= 0 || ships === 0 || remaining.length === 0) {
    return C.then(Done(faction, card, then))
  }

  // Enough to fill what is left: no decision, so take the next system rather than ask.
  if (ships >= remaining.length && left >= remaining.length) {
    return C.then({
      type: 'vox/uprising-place',
      faction,
      cluster,
      left,
      system: remaining[0]!,
      placed: [...placed],
      card,
      then,
    })
  }

  const options: Action[] = remaining.map((s) => ({
    type: 'vox/uprising-place',
    faction,
    cluster,
    left,
    system: s,
    placed: [...placed],
    card,
    then,
    label: `Place a ship in ${s} (${left} left, one per system)`,
  }))
  return C.ask(faction, [...options, skip(faction, card, then)], `Mass Uprising — cluster ${cluster}`)
}

/**
 * Guild Struggle (bc30): steal a Guild card from a rival, then shuffle the court discard's
 * **guild cards** back into the deck (`game-common.scala:347` — Vox cards stay discarded).
 */
function guildStruggle(state: GameState, faction: FactionId, card: string, then: unknown): Continue {
  const options: Action[] = []
  for (const rival of state.factions) {
    if (rival === faction) continue
    const held = contentsOf(state.courtCards, CourtPile.secured(rival))
    for (const c of held) {
      // Sworn Guardians shields the holder's *other* cards — it can itself be taken
      // (`game-guilds.scala:100` excludes the card being stolen from the check).
      if (c !== SWORN_GUARDIANS && held.includes(SWORN_GUARDIANS)) continue
      options.push({
        type: 'vox/steal-guild',
        faction,
        from: rival,
        stolen: c,
        card,
        then,
        label: `Steal ${courtCard(c).name} from ${rival}`,
      })
    }
  }
  // The recycle happens either way, so "skip" still runs the shuffle.
  return C.ask(
    faction,
    [...options, { ...skip(faction, card, then), label: 'Steal nothing' }],
    'Guild Struggle',
  )
}

/**
 * Song of Freedom (bc29): free a City in a system you rule — **anyone's**, including your own
 * — returning it to its owner's reserve. Then you may seize the initiative if nobody has and
 * you are not already leading. The card is **buried**, not discarded.
 */
function songOfFreedom(state: GameState, faction: FactionId, card: string, then: unknown): Continue {
  const options: Action[] = []
  for (const s of state.board.systems) {
    if (!rules(state, faction, s)) continue
    for (const id of contentsOf(state.figures, Location.system(s))) {
      if (parseFigureId(id).piece !== 'City') continue
      options.push({
        type: 'vox/free-city',
        faction,
        system: s,
        city: id,
        card,
        then,
        label: `Free ${parseFigureId(id).color}'s city in ${s}`,
      })
    }
  }
  if (options.length === 0) return C.then(Done(faction, card, then, true))
  return C.ask(
    faction,
    [...options, skip(faction, card, then, true)],
    'Song of Freedom — free a city',
  )
}

/** Outrage Spreads (bc28): pick a resource; **every** faction provokes outrage of it. */
function outrageSpreads(state: GameState, faction: FactionId, card: string, then: unknown): Continue {
  const options: Action[] = RESOURCES.map((r) => ({
    type: 'vox/outrage',
    faction,
    resource: r,
    card,
    then,
    label: `Spread ${r} outrage`,
  }))
  return C.ask(faction, [...options, skip(faction, card, then)], 'Outrage Spreads — choose a resource')
}

// --- disposal --------------------------------------------------------------

function finish(
  state: GameState,
  faction: FactionId,
  card: string,
  then: unknown,
  bury: boolean,
): RuleResult {
  const name = courtCard(card).name
  if (!bury) {
    // `performSecure` already put it in the discard; nothing more to do.
    return {
      state: { ...state, log: [...state.log, `${name} discarded`] },
      continue: C.then(then as Action),
    }
  }
  // Bury: back into the deck, which is then shuffled — so it can come round again.
  const buried: GameState = { ...state, courtCards: move(state.courtCards, card, CourtPile.deck()) }
  const shuffled = shuffleCourtDeck(buried)
  return {
    state: {
      ...shuffled,
      log: [...shuffled.log, `${name} buried in the court deck, which was shuffled`],
    },
    continue: C.then(then as Action),
  }
}

/**
 * Shuffle the court deck. `move` appends, so reordering means emptying the pile and re-adding
 * in the new order — the discard is a scratch space here, and every card comes straight back.
 */
function shuffleCourtDeck(state: GameState): GameState {
  const deck = [...contentsOf(state.courtCards, CourtPile.deck())]
  if (deck.length < 2) return state
  const [order, rng] = shuffle(state.rng, deck)
  let courtCards = moveAll(state.courtCards, deck, CourtPile.discard())
  courtCards = moveAll(courtCards, order, CourtPile.deck())
  return { ...state, courtCards, rng }
}

// --- module ----------------------------------------------------------------

export const VoxModule: RuleModule = {
  id: 'vox',
  perform(state: GameState, action: Action): RuleResult {
    const faction = action['faction'] as FactionId
    const card = action['card'] as string
    const then = action['then']

    switch (action.type) {
      case 'vox/trigger': {
        switch (card) {
          case 'bc26':
            return { state, continue: massUprising(state, faction, card, then) }
          case 'bc27':
            return { state, continue: populistDemands(state, faction, card, then) }
          case 'bc28':
            return { state, continue: outrageSpreads(state, faction, card, then) }
          case 'bc29':
            return { state, continue: songOfFreedom(state, faction, card, then) }
          case 'bc30':
            return { state, continue: guildStruggle(state, faction, card, then) }
          case 'bc31':
            return callToAction(state, faction, card, then)
          default:
            return { state, continue: C.then(Done(faction, card, then)) }
        }
      }

      case 'vox/populist': {
        const taken = takeAmbitionMarker(state, faction, action['ambition'] as Ambition)
        return { state: taken, continue: C.then(Done(faction, card, then)) }
      }

      case 'vox/uprising':
        return {
          state,
          continue: uprisingPlacement(
            state,
            faction,
            action['cluster'] as number,
            action['left'] as number,
            card,
            then,
          ),
        }

      case 'vox/uprising-place': {
        const ship = shipsInReserve(state, faction)[0]
        const system = action['system'] as SystemId
        const left = (action['left'] as number) - 1
        if (ship === undefined) return { state, continue: C.then(Done(faction, card, then)) }
        const next: GameState = {
          ...state,
          figures: move(state.figures, ship, Location.system(system)),
          log: [...state.log, `${faction} rose up — a ship placed in ${system}`],
        }
        const placed = [...((action['placed'] as readonly string[] | undefined) ?? []), system]
        return {
          state: next,
          continue: uprisingPlacement(
            next,
            faction,
            action['cluster'] as number,
            left,
            card,
            then,
            placed,
          ),
        }
      }

      case 'vox/steal-guild': {
        const stolen = action['stolen'] as string
        const from = action['from'] as FactionId
        const next: GameState = {
          ...state,
          courtCards: move(state.courtCards, stolen, CourtPile.secured(faction)),
          log: [...state.log, `${faction} stole ${courtCard(stolen).name} from ${from}`],
        }
        return { state: recycleDiscard(next), continue: C.then(Done(faction, card, then)) }
      }

      case 'vox/free-city': {
        const city = action['city'] as string
        const owner = parseFigureId(city).color
        const next: GameState = {
          ...state,
          figures: move(state.figures, city, Location.reserve(owner)),
          damaged: state.damaged.filter((id) => id !== city),
          log: [
            ...state.log,
            `${faction} freed ${owner}'s city in ${action['system'] as string}`,
          ],
        }
        // You may seize, but only if nobody has and you are not already leading.
        if (next.seized === undefined && next.initiativeOrder[0] !== faction) {
          return {
            state: next,
            continue: C.ask(
              faction,
              [
                { type: 'vox/free-seize', faction, card, then, label: 'Seize the initiative' },
                skip(faction, card, then, true),
              ],
              'Song of Freedom',
            ),
          }
        }
        return { state: next, continue: C.then(Done(faction, card, then, true)) }
      }

      case 'vox/free-seize':
        return {
          state: {
            ...state,
            seized: faction,
            log: [...state.log, `${faction} seized the initiative (Song of Freedom)`],
          },
          continue: C.then(Done(faction, card, then, true)),
        }

      case 'vox/outrage': {
        const r = action['resource'] as Resource
        // Everyone, starting with the securing faction and going round in seating order.
        const order = state.factions
        const start = Math.max(0, order.indexOf(faction))
        let next = state
        for (let i = 0; i < order.length; i++) {
          next = provokeOutrage(next, order[(start + i) % order.length]!, r)
        }
        return { state: next, continue: C.then(Done(faction, card, then)) }
      }

      case 'vox/done':
        return finish(state, faction, card, then, action['bury'] === true)

      default:
        return unhandled(state)
    }
  },
}

/** Guild cards from the court discard go back into the deck, which is then shuffled. */
function recycleDiscard(state: GameState): GameState {
  const guilds = contentsOf(state.courtCards, CourtPile.discard()).filter(
    (id) => courtCard(id).kind === 'guild',
  )
  if (guilds.length === 0) return state
  const returned: GameState = {
    ...state,
    courtCards: moveAll(state.courtCards, guilds, CourtPile.deck()),
  }
  const shuffled = shuffleCourtDeck(returned)
  return {
    ...shuffled,
    log: [...shuffled.log, `${guilds.length} guild card(s) returned to the court deck, shuffled`],
  }
}
