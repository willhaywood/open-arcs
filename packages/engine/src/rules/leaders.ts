/**
 * The *Leaders and Lore* draft, and the asymmetric setup it produces.
 *
 * This module is prepended to the rule chain when the variant is on (`createGame`), so it sees
 * `setup/seat` before the base setup module does and can seat factions itself. That is exactly
 * the interception docs/04 section 2.4 designed the chain for: base setup is not forked, it is
 * simply not reached.
 *
 * The flow, following haunt-roll-fail's `game-leaders.scala`:
 *
 *   1. **deal** one more leader than there are players, and `players + 1 + extra * players` lore,
 *      so the last to pick still has a choice;
 *   2. **draft** one card at a time — a leader if you have none, otherwise a lore — cycling in
 *      *reverse* seating order, until one leader and one lore are left;
 *   3. **seat** each faction with its leader's own pieces and resources instead of the board's
 *      standard opening.
 *
 * The draft order is a repeating reverse cycle, not a snake: HRF starts at `factions.last` and
 * each step takes the previous faction in seating order (`DraftNextAction`). With four players
 * that is white, blue, yellow, red, white, ... The counts work out exactly — every player takes
 * one leader and their lore quota, leaving precisely the two undealt cards the draft ends on.
 *
 * Trait effects (phase 3) are deliberately *not* all here. Only the ones that belong to this
 * module's own flow live in this file — Cryptic, which fires during the seating it performs, and
 * Ambitious, whose action it owns. The rest are single decisions inside base rules (dice limits,
 * fleet size, scoring), and there the honest implementation is a `hasTrait` check at the point of
 * the decision rather than an interception that would have to restate the whole computation.
 */

import type { Action } from '../action.js'
import { Continue as C } from '../continue.js'
import type { Continue } from '../continue.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import type { FactionId, Piece } from '../ids.js'
import { hasTrait, leaderCard, leaderPool } from '../leaders.js'
import { provokeOutrage } from '../outrage.js'
import { leadersNeeded, loreCard, lorePool, loreNeeded } from '../lore.js'
import { Prelude } from '../prelude.js'
import { RESOURCES, ResourceSlot, gain, slotCapacity, supplyOf } from '../resources.js'
import type { Resource } from '../resources.js'
import { citiesInReserve, slotsOf } from '../control.js'
import type { StandardAction, Suit } from '../cards.js'
import { TakeAction, canTake } from './standard-actions.js'
import type { PipReturn } from './standard-actions.js'
import { CourtPile, courtCard, courtSlots, securedCards } from '../court.js'
import { Location, parseFigureId } from '../ids.js'
import { contentsOf, move } from '../tracker.js'
import { shuffle } from '../rng.js'
import type { GameState } from '../state.js'
import { SeatSetup, seatFaction } from './setup.js'
import { overflowThen } from './standard-actions.js'
import { StartChapter } from './turn.js'

const DealDraft = (): Action => ({ type: 'leaders/deal' })
const DraftNext = (faction: FactionId): Action => ({ type: 'leaders/draft', faction })

/** How many lore each faction takes, defaulting to one. */
function lorePerPlayer(state: GameState): number {
  return state.leadersAndLore?.lorePerPlayer ?? 1
}

/**
 * Deal the draft pools from the seeded generator, so a replay of the same game deals the same
 * cards. The leftovers are simply never taken — see `draftComplete`.
 */
function performDeal(state: GameState): RuleResult {
  const opts = state.leadersAndLore ?? {}
  const players = state.factions.length

  const [leaderOrder, rng1] = shuffle(
    state.rng,
    leaderPool(opts.expansion ?? false).map((l) => l.id),
  )
  const [loreOrder, rng2] = shuffle(
    rng1,
    lorePool(opts.expansion ?? false, opts.unofficialLore ?? false).map((c) => c.id),
  )

  const leaders = leaderOrder.slice(0, leadersNeeded(players))
  const lores = loreOrder.slice(0, loreNeeded(players, lorePerPlayer(state)))

  if (leaders.length < leadersNeeded(players) || lores.length < loreNeeded(players, lorePerPlayer(state))) {
    // The start screen caps the lore setting against the chosen pool, so this is a wiring
    // error rather than something a player can do — say so plainly rather than dealing short.
    throw new Error(
      `not enough cards for a ${players}-player draft: ` +
        `${leaders.length}/${leadersNeeded(players)} leaders, ` +
        `${lores.length}/${loreNeeded(players, lorePerPlayer(state))} lore`,
    )
  }

  const next: GameState = {
    ...state,
    rng: rng2,
    draft: { leaders, lores },
    // Everything the deal did not reach stays in the box, in its shuffled order — Learned draws
    // from the top of it.
    unusedLore: loreOrder.slice(lores.length),
    log: [
      ...state.log,
      `Leaders and Lore: dealt ${leaders.length} leaders and ${lores.length} lore`,
    ],
  }
  // HRF starts the draft at the last seat and walks backwards.
  return { state: next, continue: C.then(DraftNext(state.factions[players - 1]!)) }
}

/** The faction that picks after `f`: the previous one in seating order, wrapping. */
function previousSeat(state: GameState, f: FactionId): FactionId {
  const seats = state.factions
  const i = seats.indexOf(f)
  return seats[(i - 1 + seats.length) % seats.length]!
}

/**
 * The draft ends when one leader and one lore remain — by then every faction has taken its
 * leader and its full lore quota, so there is nothing left anyone is allowed to take.
 */
function draftComplete(state: GameState): boolean {
  const draft = state.draft
  if (draft === undefined) return true
  return draft.leaders.length <= 1 && draft.lores.length <= 1
}

function performDraft(state: GameState, faction: FactionId): RuleResult {
  const draft = state.draft
  if (draft === undefined) return unhandled(state)

  if (draftComplete(state)) {
    // Leftovers go back in the box, and seating begins with the leaders now known.
    const next: GameState = {
      ...state,
      draft: undefined,
      // The one card the draft terminates on was never taken, so it joins the box too.
      unusedLore: [...state.unusedLore, ...draft.lores],
      log: [...state.log, 'Leaders and Lore: draft complete'],
    }
    return { state: next, continue: C.then(SeatSetup(0)) }
  }

  const held = state.lores[faction] ?? []
  const options: Action[] = []

  // One card per turn: a leader while you have none, then lore up to your quota.
  if (state.leaders[faction] === undefined) {
    for (const id of draft.leaders) {
      options.push({
        type: 'leaders/take',
        faction,
        card: id,
        kind: 'leader',
        label: `Take ${leaderCard(id).name}`,
      })
    }
  }
  if (held.length < lorePerPlayer(state)) {
    for (const id of draft.lores) {
      options.push({
        type: 'leaders/take',
        faction,
        card: id,
        kind: 'lore',
        label: `Take ${loreCard(id).name}`,
      })
    }
  }

  if (options.length === 0) {
    // This faction is already served; pass the pick along.
    return { state, continue: C.then(DraftNext(previousSeat(state, faction))) }
  }

  return {
    state,
    continue: C.ask(faction, options, `${faction} — draft a leader or lore card`),
  }
}

function performTake(
  state: GameState,
  faction: FactionId,
  card: string,
  kind: string,
): RuleResult {
  const draft = state.draft
  if (draft === undefined) return unhandled(state)

  const next: GameState =
    kind === 'leader'
      ? {
          ...state,
          draft: { ...draft, leaders: draft.leaders.filter((id) => id !== card) },
          leaders: { ...state.leaders, [faction]: card },
          log: [...state.log, `${faction} took ${leaderCard(card).name}`],
        }
      : {
          ...state,
          draft: { ...draft, lores: draft.lores.filter((id) => id !== card) },
          lores: { ...state.lores, [faction]: [...(state.lores[faction] ?? []), card] },
          log: [...state.log, `${faction} took ${loreCard(card).name}`],
        }

  return { state: next, continue: C.then(DraftNext(previousSeat(state, faction))) }
}

/**
 * Seat a faction with its leader's opening rather than the board's.
 *
 * The leader's `setupA`/`setupB`/`setupC` replace the standard City+3 / Starport+3 / 2-per-fleet
 * outright — Rebel opens with a Starport and no City, Anarchist with no buildings at all — and
 * its two printed resources replace whatever the starting systems would have produced.
 */
function performSeat(state: GameState, seat: number): Continue | RuleResult {
  const faction = state.factions[seat]
  if (faction === undefined) {
    // Every faction is seated. Learned draws its extra lore now — "after **setup**" on the card,
    // and after *all* the seating, which is what the official note about leader setup steps says.
    const scholar = state.factions.find((f) => hasTrait(state, f, 'Learned'))
    if (scholar !== undefined) return { state, continue: offerLearned(state, scholar) }
    return seatFaction(state, seat, { a: [], b: [], c: [] })
  }

  const id = state.leaders[faction]
  if (id === undefined) return unhandled(state)
  const leader = leaderCard(id)

  const result = seatFaction(
    state,
    seat,
    { a: leader.setupA, b: leader.setupB, c: leader.setupC },
    leader.resources,
  )
  return {
    ...result,
    state: applySetupTraits(
      {
        ...result.state,
        log: [...result.state.log, `${faction} leads as the ${leader.name}`],
      },
      faction,
    ),
  }
}

/**
 * Return `n` of a faction's unplaced pieces to the box.
 *
 * Scrapping is out of the game, not back to reserve: `Location.scrap()` is a location nothing
 * draws from. Takes from the **back** of the reserve so the pieces already placed on the board
 * by the seating step are untouched — reserve order is placement order.
 */
function scrapFromReserve(
  state: GameState,
  faction: FactionId,
  piece: Piece,
  n: number,
): GameState {
  const held = contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === piece,
  )
  const doomed = held.slice(-n)
  if (doomed.length === 0) return state
  let figures = state.figures
  for (const id of doomed) figures = move(figures, id, Location.scrap())
  return {
    ...state,
    figures,
    log: [
      ...state.log,
      `${faction} scrapped ${doomed.length} ${piece}${doomed.length === 1 ? '' : 's'} (their leader)`,
    ],
  }
}

/**
 * Traits that land during setup, before anyone has taken a turn.
 *
 * All four do their work by *removing* something, and they run **after** the leader's pieces and
 * two starting resources are placed — HRF's ordering, and the only one that makes sense for
 * Decentralized, which scraps from what is left in reserve once the board is set.
 *
 *   **Cryptic** (Mystic) puts an agent on the Material and Fuel outrage slots, which is exactly
 *   the state `provokeOutrage` produces — HRF sets the same field (`f.outraged ++= $(Material,
 *   Fuel)`, game-leaders.scala:271). A Mystic starting with a Fuel would have it discarded by its
 *   own outrage; the printed resources are Psionic and Relic, so it cannot bite today.
 *
 *   **Greedy** (Quartermaster) is the same rule with one slot: "place an agent on your Material
 *   Outrage slot".
 *
 *   **Hated** (Overseer): "scrap 2 Loyal ships and 3 Loyal agents". Three agents is the sharpest
 *   cost in the set — it is a third of the court reach for the whole game.
 *
 *   **Decentralized** (Anarchist): "scrap your 2 leftmost cities from your player board". Cities
 *   on the player board *are* cities in reserve, and slot capacity is read off that count
 *   (`slotCapacity`), so scrapping two both removes two buildable cities and uncovers two more
 *   resource slots. Nothing extra is needed to model the uncovering — it falls out of the count.
 *   The Anarchist places no cities at setup, so this is 5 in reserve down to 3: capacity 2 to 4.
 */
function applySetupTraits(state: GameState, faction: FactionId): GameState {
  let next = state
  if (hasTrait(next, faction, 'Cryptic')) {
    for (const r of ['Material', 'Fuel'] as const) next = provokeOutrage(next, faction, r)
  }
  if (hasTrait(next, faction, 'Greedy')) next = provokeOutrage(next, faction, 'Material')
  if (hasTrait(next, faction, 'Hated')) {
    next = scrapFromReserve(next, faction, 'Ship', 2)
    next = scrapFromReserve(next, faction, 'Agent', 3)
  }
  if (hasTrait(next, faction, 'Decentralized')) next = scrapFromReserve(next, faction, 'City', 2)
  return next
}

/**
 * What a faction may do *because* it has declared — HRF's `AmbitionDeclaredAction`
 * (game-common.scala:1436), which is a loop rather than a single prompt.
 *
 * Each effect is offered once and hands back here with itself added to `used`, so a Demagogue who
 * is also somehow Ambitious could take both, in either order, and neither twice. That shape comes
 * straight from HRF and is worth keeping even though the base game's two carriers are different
 * leaders: it is what makes the menu composable when more of these arrive.
 *
 * With nothing left to offer it goes straight on, so the menu never appears with only an exit.
 */
function offerAfterDeclare(
  state: GameState,
  faction: FactionId,
  suit: Suit,
  pips: number,
  used: readonly string[],
): Continue {
  const then = Prelude(faction, suit, pips)
  const options: Action[] = []

  // Bold (Demagogue): influence any number of court cards, once each, for no pips.
  if (hasTrait(state, faction, 'Bold') && !used.includes('Bold') && hasAgent(state, faction)) {
    options.push({
      type: 'leaders/bold',
      faction,
      suit,
      pips,
      used,
      influenced: [],
      label: 'Influence any number of court cards',
    })
  }

  // Ambitious (Upstart): one resource of your choice, if the supply still has it.
  if (hasTrait(state, faction, 'Ambitious') && !used.includes('Ambitious')) {
    for (const r of RESOURCES) {
      if (supplyOf(state.resources, r).length === 0) continue
      options.push({
        type: 'leaders/ambitious-gain',
        faction,
        resource: r,
        suit,
        pips,
        used,
        label: `Gain ${r}`,
      })
    }
  }

  if (options.length === 0) return C.then(then)
  return C.ask(
    faction,
    [...options, { ...then, faction, label: 'Done' }],
    `${faction} declared — their leader offers more`,
  )
}

function performAmbitiousGain(
  state: GameState,
  faction: FactionId,
  resource: Resource,
  suit: Suit,
  pips: number,
  used: readonly string[],
): RuleResult {
  const capacity = slotsOf(state, faction)
  const { tracker, gained } = gain(state.resources, capacity, resource, ResourceSlot.overflow(faction))
  return {
    state: {
      ...state,
      resources: tracker,
      log: [
        ...state.log,
        gained
          ? `${faction} gained ${resource} from their leader`
          : `${faction} could not hold the ${resource} from their leader (no open slot)`,
      ],
    },
    continue: offerAfterDeclare({ ...state, resources: tracker }, faction, suit, pips, [
      ...used,
      'Ambitious',
    ]),
  }
}

/**
 * Bold (Demagogue): "you may influence any number of cards in the Court once."
 *
 * A loop over the court, each slot available once (`influenced` remembers which), costing no pip
 * and stopping when the agents run out — HRF's `BoldMainAction` (game-leaders.scala:337). The
 * placement itself is the base `action/influence`, so an agent is spent exactly as it would be
 * normally; only the pip is free.
 *
 * Backing out before placing anything is a **cancel** and does not spend the trait; stopping after
 * placing at least one is **done** and does. That is HRF's `cancelIf(influenced.none)` /
 * `doneIf(influenced.any)` pair, and it matters: a player who opens the menu and changes their
 * mind has not used their leader's once-per-declaration ability.
 */
function offerBold(
  state: GameState,
  faction: FactionId,
  suit: Suit,
  pips: number,
  used: readonly string[],
  influenced: readonly number[],
): Continue {
  const started = influenced.length > 0
  const back: Action = {
    type: 'leaders/after-declare',
    faction,
    suit,
    pips,
    // Cancelling before placing anything leaves the trait unspent; stopping after placing uses it.
    used: started ? [...used, 'Bold'] : used,
  }
  const exit: Action = { ...back, label: started ? 'Done' : 'Cancel' }
  if (!hasAgent(state, faction)) return C.then(back)

  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => cardIn(state, n) !== undefined && !influenced.includes(n))
    .map((n) => ({
      type: 'action/influence',
      faction,
      slot: n,
      then: {
        type: 'leaders/bold',
        faction,
        suit,
        pips,
        used,
        influenced: [...influenced, n],
      },
      label: `Influence ${courtCard(cardIn(state, n)!).name}`,
    }))

  if (options.length === 0) return C.then(back)
  return C.ask(faction, [...options, exit], `${faction} — influence the court (their leader)`)
}

/**
 * Generous (Feastbringer): "To declare an ambition, you must give 1 Guild card to your Rival with
 * the least Power."
 *
 * A **cost**, not a bonus, so it is taken before the declaration rather than after: this module is
 * prepended to the chain and sees `ambition/declare` ahead of the base rules, offers the gift, and
 * only then re-issues the same action carrying `generous: 'paid'` so the interception does not
 * repeat. Paying first is what lets the whole thing be declined — **forfeit declaring** is a real
 * option (HRF's `withExtras(then.as("Forfeit declaring", a))`), and it is the only one left when
 * you hold no Guild cards, which is how the card's "must" is enforced.
 *
 * The recipient is every rival tied for the least Power, so the giver chooses among them.
 */
function offerGenerous(
  state: GameState,
  faction: FactionId,
  declare: Action,
  forfeit: Action,
): Continue {
  const rivals = state.factions.filter((f) => f !== faction)
  const least = Math.min(...rivals.map((f) => state.power[f] ?? 0))
  const poorest = rivals.filter((f) => (state.power[f] ?? 0) === least)
  const paid: Action = { ...declare, generous: 'paid' }

  const options: Action[] = []
  for (const card of securedCards(state, faction)) {
    for (const to of poorest) {
      options.push({
        type: 'leaders/generous-give',
        faction,
        card,
        to,
        then: paid,
        label: `Give ${courtCard(card).name} to ${to}`,
      })
    }
  }
  return C.ask(
    faction,
    [...options, forfeit],
    `${faction} must give a Guild card to declare (their leader)`,
  )
}

/**
 * Generous is a cost on **every** declare path — the official FAQ, asked about Populist Demands
 * outright: "Giving away a Guild is a mandatory cost for all declares" (docs/21 B2). Besides the
 * standard `ambition/declare`, two actions take a marker directly and are intercepted here the
 * same way: Populist Demands' free declaration and Tycoon's Ambition's Prelude one. Each path
 * keeps its own way out, since forfeiting must land wherever declining would have.
 */
function generousIntercept(state: GameState, action: Action): RuleResult | undefined {
  const faction = action['faction'] as FactionId
  if (action['generous'] === 'paid') return undefined
  if (!hasTrait(state, faction, 'Generous')) return undefined

  const forfeit: Action =
    action.type === 'vox/populist'
      ? {
          type: 'vox/done',
          faction,
          card: action['card'],
          then: action['then'],
          bury: false,
          label: `Forfeit declaring ${String(action['ambition'])}`,
        }
      : action.type === 'turn/prelude-tycoon'
        ? {
            ...Prelude(faction, action['suit'] as Suit, action['pips'] as number),
            faction,
            label: `Forfeit declaring ${String(action['ambition'])}`,
          }
        : {
            type: 'ambition/skip-declare',
            faction,
            suit: action['suit'],
            pips: action['pips'],
            label: `Forfeit declaring ${String(action['ambition'])}`,
          }
  return { state, continue: offerGenerous(state, faction, action, forfeit) }
}

function performGenerousGive(
  state: GameState,
  faction: FactionId,
  card: string,
  to: FactionId,
  then: Action,
): RuleResult {
  return {
    state: {
      ...state,
      courtCards: move(state.courtCards, card, CourtPile.secured(to)),
      log: [...state.log, `${faction} gave ${courtCard(card).name} to ${to} (their leader)`],
    },
    continue: C.then(then),
  }
}

/** An agent still in reserve, which is what influencing needs. */
function hasAgent(state: GameState, faction: FactionId): boolean {
  return contentsOf(state.figures, Location.reserve(faction)).some(
    (id) => parseFigureId(id).piece === 'Agent',
  )
}

function cardIn(state: GameState, slot: number): string | undefined {
  return contentsOf(state.courtCards, CourtPile.slot(slot))[0]
}

/**
 * A follow-up action attached to a pip by Tactical or Charismatic. Built in `rules/turn.ts`,
 * which chooses the pairings; this side only runs whichever one was chosen.
 *
 * Whether the follow-up is possible is settled **here, after the primary action has resolved** —
 * that is the entire point of the "before" orderings. Moving into a contested system is what
 * makes a battle available, so asking before the move would refuse the very case the Warrior's
 * card exists for.
 */
function offerFollow(
  state: GameState,
  faction: FactionId,
  act: StandardAction,
  then: PipReturn,
  required: boolean,
): RuleResult {
  if (!canTake(state, faction, act, then)) {
    // A `must` that cannot be met is not a rules violation — you may move somewhere with nothing
    // to fight. The pip is spent either way, so the turn simply carries on.
    return {
      state: required
        ? { ...state, log: [...state.log, `${faction} had no ${act} to take (their leader)`] }
        : state,
      continue: C.then(then as Action),
    }
  }
  if (required) return { state, continue: C.then(TakeAction(faction, act, then)) }
  return {
    state,
    continue: C.ask(
      faction,
      [
        { ...TakeAction(faction, act, then), faction, label: act },
        { ...(then as Action), faction, label: `Skip the ${act}` },
      ],
      `${faction} may also ${act} (their leader)`,
    ),
  }
}

/**
 * Beloved (Elder), first half: "After defending in battle, you may influence if the attacker took
 * any Trophies."
 *
 * The battle module decides *whether* this is owed and hands the turn here; this side only asks.
 * The ask belongs to the **defender**, not the player taking the turn, which is the reason it is a
 * step of its own — everything else in a battle is the attacker's decision.
 *
 * It is a free influence: no pip is spent, and an agent is placed exactly as the standard action
 * would place one. Declining is always available.
 */
function offerBeloved(state: GameState, faction: FactionId, then: Action): Continue {
  if (!hasAgent(state, faction)) return C.then(then)
  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => cardIn(state, n) !== undefined)
    .map((n) => ({
      type: 'action/influence',
      faction,
      slot: n,
      then,
      label: `Influence ${courtCard(cardIn(state, n)!).name}`,
    }))
  if (options.length === 0) return C.then(then)
  return C.ask(
    faction,
    [...options, { ...then, faction, label: 'Decline' }],
    `${faction} defended and lost pieces — influence (their leader)`,
  )
}

/**
 * Learned (Archivist, leader09): "After setup, gain 2 extra lore cards — draw 5 lore, keep 2, and
 * scrap the other 3 (returning them to the box)."
 *
 * The five come off the top of what the deal left over, which is why `state.unusedLore` keeps the
 * remainder in its shuffled order rather than throwing it away. All five leave the box whichever
 * two are kept — the other three are scrapped, not returned to the pool.
 *
 * A short box is not an error: a deck already exhausted by a large draft simply offers fewer than
 * five, and the Archivist keeps up to two of them. Nothing in the base deck can reach that, but a
 * 4-player x5 draft on the expansion comes close enough to be worth not crashing over.
 *
 * It runs once, after the last faction is seated, and continues straight to the chapter — it does
 * not return through the seating loop, which would offer it again.
 */
function offerLearned(state: GameState, faction: FactionId): Continue {
  const drawn = state.unusedLore.slice(0, 5)
  if (drawn.length === 0) return C.milestone('setup complete', StartChapter())

  const keep = Math.min(2, drawn.length)
  const options: Action[] = pairsOf(drawn, keep).map((pick) => ({
    type: 'leaders/learned',
    faction,
    keep: pick,
    drawn,
    label: `Keep ${pick.map((id) => loreCard(id).name).join(' and ')}`,
  }))
  return C.ask(
    faction,
    options,
    `${faction} drew ${drawn.length} lore — keep ${keep} (their leader)`,
  )
}

/** Every combination of exactly `n` items, in order. */
function pairsOf(items: readonly string[], n: number): string[][] {
  if (n === 0) return [[]]
  const out: string[][] = []
  const walk = (start: number, acc: string[]): void => {
    if (acc.length === n) {
      out.push([...acc])
      return
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!)
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

function performLearned(
  state: GameState,
  faction: FactionId,
  drawn: readonly string[],
  keep: readonly string[],
): RuleResult {
  const scrapped = drawn.filter((id) => !keep.includes(id))
  const log = [...state.log, `${faction} drew ${drawn.length} lore and kept ${keep.length} (their leader)`]
  if (scrapped.length > 0) {
    log.push(`${scrapped.length} lore scrapped, returned to the box`)
  }
  const next: GameState = {
    ...state,
    lores: { ...state.lores, [faction]: [...(state.lores[faction] ?? []), ...keep] },
    // Every card drawn leaves the box, kept or scrapped.
    unusedLore: state.unusedLore.filter((id) => !drawn.includes(id)),
    log,
  }
  return { state: next, continue: C.milestone('setup complete', StartChapter()) }
}

export const LeadersModule: RuleModule = {
  id: 'leaders',
  perform(state: GameState, action: Action): RuleResult {
    // Nothing here applies to a base game.
    if (state.leadersAndLore === undefined) return unhandled(state)

    switch (action.type) {
      case 'leaders/deal':
        return performDeal(state)
      case 'leaders/draft':
        return performDraft(state, action['faction'] as FactionId)
      case 'leaders/take':
        return performTake(
          state,
          action['faction'] as FactionId,
          action['card'] as string,
          action['kind'] as string,
        )

      /*
       * Seating is intercepted rather than replaced: the first time it is reached the draft has
       * not happened, so it runs instead; afterwards every faction has a leader and this module
       * seats them. The base module never sees the action while the variant is on.
       */
      case 'setup/seat': {
        const seat = action['seat'] as number
        const everyoneHasOne = state.factions.every((f) => state.leaders[f] !== undefined)
        if (!everyoneHasOne) {
          return state.draft === undefined
            ? { state, continue: C.then(DealDraft()) }
            : { state, continue: C.then(DraftNext(state.factions[state.factions.length - 1]!)) }
        }
        return performSeat(state, seat) as RuleResult
      }

      case 'leaders/learned':
        return performLearned(
          state,
          action['faction'] as FactionId,
          action['drawn'] as readonly string[],
          action['keep'] as readonly string[],
        )

      case 'leaders/beloved':
        return {
          state,
          continue: offerBeloved(
            state,
            action['faction'] as FactionId,
            action['then'] as Action,
          ),
        }

      case 'leaders/may-follow':
      case 'leaders/must-follow':
        return offerFollow(
          state,
          action['faction'] as FactionId,
          action['act'] as StandardAction,
          action['then'] as PipReturn,
          action.type === 'leaders/must-follow',
        )

      case 'leaders/after-declare':
        return {
          state,
          continue: offerAfterDeclare(
            state,
            action['faction'] as FactionId,
            action['suit'] as Suit,
            action['pips'] as number,
            (action['used'] as readonly string[]) ?? [],
          ),
        }

      case 'leaders/bold':
        return {
          state,
          continue: offerBold(
            state,
            action['faction'] as FactionId,
            action['suit'] as Suit,
            action['pips'] as number,
            (action['used'] as readonly string[]) ?? [],
            (action['influenced'] as readonly number[]) ?? [],
          ),
        }

      case 'leaders/generous-give':
        return performGenerousGive(
          state,
          action['faction'] as FactionId,
          action['card'] as string,
          action['to'] as FactionId,
          action['then'] as Action,
        )

      case 'ambition/declare':
      case 'vox/populist':
      case 'turn/prelude-tycoon': {
        // A cost paid before any marker is taken — see `generousIntercept` (docs/21 B2).
        return generousIntercept(state, action) ?? unhandled(state)
      }

      case 'leaders/ambitious-gain':
        return performAmbitiousGain(
          state,
          action['faction'] as FactionId,
          action['resource'] as Resource,
          action['suit'] as Suit,
          action['pips'] as number,
          (action['used'] as readonly string[]) ?? [],
        )

      default:
        return unhandled(state)
    }
  },
}
