/**
 * The seven standard actions a pip can buy.
 *
 * All seven are now implemented end to end: Move, Tax, Build, Repair, Battle
 * (dice.ts / rules/battle.ts) and — with the court deck — Influence and Secure (court.ts).
 *
 * Secured Guild cards can widen these menus: `withAlts` merges in whatever the faction's
 * cards add, mirroring HRF's `buildAlt` / `taxAlt` / … beside every `build` / `tax` / …
 * (guild-actions.ts). All six of HRF's base alts are live; the rest of the court's effects
 * live in prelude.ts, turn.ts and rules/vox.ts, and are mapped in docs/13-court.md.
 *
 * Every action returns to `then` (the next pip step) when done.
 */

import type { Action } from '../action.js'
import { system as systemInfo } from '../board.js'
import type { StandardAction } from '../cards.js'
import type { Continue } from '../continue.js'
import { Continue as C } from '../continue.js'
import {
  citiesInReserve,
  gateCityTypes,
  hasCloudCity,
  connectedSystems,
  freeSlots,
  planetResource,
  present,
  rules,
  systemsWherePresent,
  slotsOf,
} from '../control.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { provokeOutrage } from '../outrage.js'
import { Location, parseFigureId } from '../ids.js'
import type { FactionId, LocationId, Piece, SystemId } from '../ids.js'
import type { Resource } from '../resources.js'
import {
  CITY_SLOT_COUNT,
  RESOURCES,
  ResourceSlot,
  gain,
  heldTokens,
  parseResourceToken,
  slotCapacity,
  slotKeys,
  openSlots,
  overflowTokens,
  supplyOf,
  spendToken,
} from '../resources.js'
import type { GameState } from '../state.js'
import { contentsOf, move } from '../tracker.js'
import { CourtPile, courtCard, courtSlots } from '../court.js'
import { prunable } from '../guild-actions.js'
import { hasTrait } from '../leaders.js'
import {
  ANCIENT_HOLDINGS,
  CLOUD_CITIES,
  EMPATHS_BOND,
  TYRANTS_AUTHORITY,
  WARLORDS_CRUELTY,
  GATE_PORTS,
  GATE_STATIONS,
  SPRINTER_DRIVES,
  TOOL_PRIESTS,
  hasLore,
  loreActive,
} from '../lore.js'
import { copiedOrPivoted } from '../observe.js'
import {
  abductableSlots,
  altsFor,
  captivesOf,
  guideLanes,
  guildAlt,
  martyrPairs,
  rivalAgentsOn,
  shipsIn,
  tradeGiveOptions,
  tradeTargets,
  weaponReach,
} from '../guild-actions.js'
import { DeclareBattle, canBattle } from './battle.js'
import { VoxTrigger } from './vox.js'

/** The pip step to return to after an action resolves. Encoded, so it survives the journal. */
export interface PipReturn {
  readonly type: string
  readonly [k: string]: unknown
}

export const TakeAction = (
  faction: FactionId,
  action: StandardAction,
  then: PipReturn,
): Action => ({ type: 'action/take', faction, action, then })

function skip(faction: FactionId, then: PipReturn): Action {
  return { type: 'action/skip', faction, then, label: 'Cancel' }
}

const GuildAltAction = (faction: FactionId, alt: string, then: PipReturn): Action => ({
  type: 'action/guild-alt',
  faction,
  alt,
  then,
})

/**
 * Merge in whatever secured Guild cards add to this action — HRF's `buildAlt` / `taxAlt` /
 * … beside every `build` / `tax` / … (`game.scala:1549-1780`). A card does not replace an
 * action, it widens the menu that action opens.
 *
 * Called at every action site, including ones no card touches yet, so adding a card means a
 * registry entry plus its flow and nothing else.
 */
function withAlts(
  state: GameState,
  faction: FactionId,
  on: StandardAction,
  then: PipReturn,
  options: readonly Action[],
): Action[] {
  return [
    ...options,
    ...altsFor(state, faction, on).map((a) => ({
      ...GuildAltAction(faction, a.id, then),
      faction,
      label: a.label,
    })),
  ]
}

/** Cities in reserve -> resource-slot capacity. */
function reservePiece(state: GameState, faction: FactionId, piece: Piece): string | undefined {
  return contentsOf(state.figures, Location.reserve(faction)).find(
    (id) => parseFigureId(id).piece === piece,
  )
}

// --- Move ------------------------------------------------------------------

const MovePick = (faction: FactionId, from: SystemId, to: SystemId, then: PipReturn): Action => ({
  type: 'action/move-pick',
  faction,
  from,
  to,
  then,
})
const MoveShips = (
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  count: number,
  then: PipReturn,
): Action => ({ type: 'action/move-ships', faction, from, to, count, then })
const MoveMore = (
  faction: FactionId,
  to: SystemId,
  group: readonly string[],
  then: PipReturn,
): Action => ({ type: 'action/move-more', faction, to, group, then })
const MoveMoreGo = (
  faction: FactionId,
  to: SystemId,
  group: readonly string[],
  count: number,
  then: PipReturn,
): Action => ({ type: 'action/move-more-go', faction, to, group, count, then })

/**
 * Whether a fleet leaving `from` may keep going after reaching `to` — the **catapult**
 * (`game-movement.scala:84`). Three conditions: you have a **Starport** in the system you are
 * leaving, the destination is a **gate**, and no rival **rules** that gate.
 *
 * It chains: HRF passes `cascade = true` again for the next leg, so a fleet launched from a
 * starport can run along the gate ring until it stops at a planet or a rival-held gate.
 */
function canCatapult(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
): boolean {
  // Empath's Bond catapults from *any* starport, on the same "like they are Loyal" grant.
  const anyPort = loreActive(state, faction, EMPATHS_BOND)
  const hasStarport = contentsOf(state.figures, Location.system(from)).some((id) => {
    const f = parseFigureId(id)
    return (anyPort || f.color === faction) && f.piece === 'Starport'
  })
  /*
   * Ancient (Shaper, leader14): "You cannot Catapult **move** from starports, but you can
   * Catapult **move** from gates." It swaps what launches a catapult rather than adding to it —
   * a Shaper standing on its own starport gets nothing, and a Shaper on a gate carries on. The
   * destination and the rival-rule check are untouched, so the ring still stops at a held gate.
   */
  const launches = hasTrait(state, faction, 'Ancient') ? systemInfo(from).isGate : hasStarport
  if (!launches || !systemInfo(to).isGate) return false
  return !state.factions.some((e) => e !== faction && rules(state, e, to))
}

/** Ships this faction can move out of `system`, fresh ones first. */
function fleetAt(state: GameState, faction: FactionId, system: SystemId): string[] {
  const mine = contentsOf(state.figures, Location.system(system)).filter((id) => {
    const f = parseFigureId(id)
    return f.color === faction && f.piece === 'Ship'
  })
  // Fresh before damaged: which ships you take is a real choice in HRF, auto-resolved here.
  return [
    ...mine.filter((id) => !state.damaged.includes(id)),
    ...mine.filter((id) => state.damaged.includes(id)),
  ]
}

/**
 * Offer a Move: pick a system you have ships in and where they are going. Fleet size is the
 * next question, and a catapult continuation the one after that.
 */
function offerMove(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const system of state.board.systems) {
    const fleet = fleetAt(state, faction, system)
    if (fleet.length === 0) continue
    for (const dest of connectedSystems(state.board, system)) {
      const cat = canCatapult(state, faction, system, dest)
      options.push({
        ...MovePick(faction, system, dest, then),
        faction,
        label:
          `Move ${system} → ${dest} (${fleet.length} ship${fleet.length === 1 ? '' : 's'})` +
          (cat ? ' — and further' : ''),
      })
    }
  }
  const all = withAlts(state, faction, 'Move', then, options)
  if (all.length === 0) return C.then(then as Action)
  return C.ask(faction, [...all, skip(faction, then)], 'Move')
}

/** How many ships go. Any number may move together (`game-movement.scala:98`). */
/**
 * How many ships this faction may move in one go.
 *
 * Disorganized (Rebel) caps it at 2 — HRF `l.num.hi(2)` in game-movement.scala:104. It is a cap
 * on a *single* move, not on the turn: a second pip may move two more.
 */
function movableCount(state: GameState, faction: FactionId, fleet: number): number {
  return hasTrait(state, faction, 'Disorganized') ? Math.min(fleet, 2) : fleet
}

function offerFleetSize(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  then: PipReturn,
): Continue {
  const fleet = fleetAt(state, faction, from)
  if (fleet.length === 0) return C.then(then as Action)
  const options: Action[] = []
  for (let n = movableCount(state, faction, fleet.length); n >= 1; n--) {
    options.push({
      ...MoveShips(faction, from, to, n, then),
      faction,
      label: `Move ${n} ship${n === 1 ? '' : 's'} to ${to}`,
    })
  }
  return C.ask(faction, [...options, skip(faction, then)], `Move to ${to} — how many?`)
}

/**
 * Force Beams (lore16): "Guide (Move): Move any number of *any* ships (*even if not Loyal*) from a
 * system with a fresh Loyal starport to an adjacent system, or vice versa, ignoring **move**
 * modifiers in play areas."
 *
 * Two things make it unlike a Move, and both are the point of the card:
 *
 * - **The ships need not be yours.** A rival's fleet standing next to your starport can be pushed
 *   away from it, or dragged into it. `guideLanes` is keyed on the starport, not on the ships.
 * - **Nothing that keys on moving fires** — not the Gate Ports toll, not Sprinter Drives, not the
 *   catapult. So this deliberately does *not* go through `performMoveShips`; it puts the ships
 *   down and stops.
 *
 * The publisher's FAQ (cards.buriedgiant.com, ARCS-L16) rules on two of those three directly, and
 * they turn out to have **different reasons**:
 *
 *   > Q: Does this trigger Gate Ports? A: No, since this ignores move modifiers.
 *   > Q: Can you use Force Beams to do a Catapult Move? A: No, Force Beams is strictly to an
 *   > adjacent system. It cannot start a Catapult move.
 *
 * So the toll is off because it *is* a move modifier, while the catapult is off because Guide is
 * **strictly one leg to an adjacent system** — a reach limit, not a modifier. Sprinter Drives is
 * not in the FAQ but is squarely a card in a play area that modifies **move**, so the first
 * reason covers it.
 *
 * The distinction is worth keeping: it means "strictly adjacent" is the load-bearing rule for the
 * catapult, and a future card that grants extra reach would not sneak past it via the modifier
 * clause.
 *
 * **Disorganized (Rebel) is the modifier this clause is really for.** The leader card sits in your
 * play area and caps a Move at two ships, and lifting that cap is the card's best-known use. It
 * falls out here because Guide does not call `movableCount` — but *only* because of that, so it is
 * asserted by a test rather than left to whoever next edits this function.
 *
 * Errata: "in play areas" was added in the second printing. The card art in `assets/images/lore`
 * carries it, so this engine implements the second-printing text.
 */
function offerGuide(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const { from, to } of guideLanes(state, faction)) {
    const ships = shipsIn(state, from)
    if (ships.length === 0) continue
    options.push({
      type: 'action/guide-pick',
      faction,
      from,
      to,
      then,
      label: `Guide ${from} → ${to} (${ships.length} ship${ships.length === 1 ? '' : 's'})`,
    })
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, skip(faction, then)], 'Guide — along which lane?')
}

/**
 * Which ships travel, asked repeatedly until the player stops.
 *
 * **A loop, because one Guide may carry a mixed group.** "Move any number of *any* ships" is not
 * "any number of ships of one colour" — the card's best-known use is pulling some of your own
 * ships and some of a rival's into the same system together, so that the fight happens at odds you
 * chose. One pick per colour ends the action; picking, then being asked again along the same lane,
 * is what makes the group mixed while keeping each question a plain list.
 *
 * The lane is fixed by the time this runs, so every leg of the loop travels the same direction.
 * "Or vice versa" is a choice of lane, not something to re-decide per ship.
 */
function offerGuideMore(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  then: PipReturn,
  moved = false,
): Continue {
  const ships = shipsIn(state, from)
  // Nothing left to carry: the lane is empty, so the action is simply over.
  if (ships.length === 0) return C.then(then as Action)

  const colors = [...new Set(ships.map((id) => parseFigureId(id).color))]
  const options: Action[] = []
  for (const color of colors) {
    const mine = ships.filter((id) => parseFigureId(id).color === color)
    for (let n = mine.length; n >= 1; n--) {
      options.push({
        type: 'action/guide-move',
        faction,
        from,
        to,
        color,
        count: n,
        then,
        label: `Guide ${n} ${color} ship${n === 1 ? '' : 's'} to ${to}`,
      })
    }
  }
  // Before anything has moved this is still a free exit; after, it is "that is the whole group".
  const stop: Action = moved
    ? { ...(then as Action), faction, label: `Send no more to ${to}` }
    : skip(faction, then)
  return C.ask(
    faction,
    [...options, stop],
    `Guide ${from} → ${to} — which ships?${moved ? ' (any more?)' : ''}`,
  )
}

function performGuide(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  color: string,
  count: number,
  then: PipReturn,
): RuleResult {
  // Fresh before damaged, matching `fleetAt` — which ships go is not a decision the card asks for.
  const here = shipsIn(state, from).filter((id) => parseFigureId(id).color === color)
  const group = [
    ...here.filter((id) => !state.damaged.includes(id)),
    ...here.filter((id) => state.damaged.includes(id)),
  ].slice(0, count)
  if (group.length === 0) return { state, continue: C.then(then as Action) }

  let figures = state.figures
  for (const id of group) figures = move(figures, id, Location.system(to))
  const next: GameState = {
    ...state,
    figures,
    log: [
      ...state.log,
      `${faction} guided ${group.length} ${color} ship${group.length === 1 ? '' : 's'} ${from} → ${to} (Force Beams)`,
    ],
  }
  // No catapult, no Sprint, no toll — but the lane stays open, so the group can be mixed.
  return { state: next, continue: offerGuideMore(next, faction, from, to, then, true) }
}

/**
 * Survival Overrides (lore18): "Martyr (Move): Destroy 1 fresh Loyal ship on the map to destroy 1
 * ship that is not Loyal in its system, taking it as a Trophy. (*Your Loyal ship does not become a
 * Trophy.*)"
 *
 * The parenthetical is the whole subtlety, and it matches how a battle already settles: a piece of
 * *yours* that dies goes back to your reserve, only an enemy's becomes a trophy. So the martyr
 * goes home and the victim goes to the trophy pile.
 *
 * "Destroy" is unconditional on both sides — a damaged victim is destroyed outright rather than
 * repaired-then-hit, and a fresh one does not merely become damaged. It is not a battle hit.
 */
function offerMartyr(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const { system, martyr, victims } of martyrPairs(state, faction)) {
    for (const victim of victims) {
      const v = parseFigureId(victim)
      options.push({
        type: 'action/martyr',
        faction,
        system,
        martyr,
        victim,
        then,
        label: `Martyr a ship in ${system} to destroy a ${v.color} ship`,
      })
    }
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, skip(faction, then)], 'Martyr — which ship, and whose?')
}

function performMartyr(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  martyr: string,
  victim: string,
  then: PipReturn,
): RuleResult {
  const here = contentsOf(state.figures, Location.system(system))
  // Both must still be standing here: an offer built before some other effect moved them is stale.
  if (!here.includes(martyr) || !here.includes(victim)) {
    return { state, continue: C.then(then as Action) }
  }
  const v = parseFigureId(victim)
  let figures = move(state.figures, martyr, Location.reserve(faction))
  figures = move(figures, victim, Location.trophies(faction))
  const next: GameState = {
    ...state,
    figures,
    // Neither is on the board any more, so neither can still be damaged.
    damaged: state.damaged.filter((id) => id !== martyr && id !== victim),
    log: [
      ...state.log,
      `${faction} martyred a ship in ${system} to destroy a ${v.color} Ship (trophy)`,
    ],
  }
  return { state: next, continue: C.then(then as Action) }
}

/**
 * Gate Ports (lore08), second half: "When Rival ships take a move into a gate you control with a
 * fresh Loyal starport, capture 1 agent of that Rival."
 *
 * Applied to the state **before** the fleet arrives, which is not incidental. HRF runs the check
 * ahead of `l --> d` (game-movement.scala:127), so the defender's rule of the gate is judged
 * without the incoming ships counted — a fleet large enough to break that rule on arrival still
 * pays the toll on the way in, which is the point of the card.
 *
 * The agent comes from the mover's *reserve* and becomes the holder's captive. A mover with no
 * agent left simply loses nothing; HRF logs that rather than substituting another piece.
 *
 * Every leg of a move triggers it, catapult continuations and Sprinter Drives included, because
 * HRF puts it in the single move primitive that all of them re-enter.
 */
function gatePortsCapture(state: GameState, mover: FactionId, to: SystemId): GameState {
  if (!systemInfo(to).isGate) return state
  let next = state
  for (const holder of state.factions) {
    if (holder === mover) continue
    if (!hasLore(next, holder, GATE_PORTS)) continue
    if (!rules(next, holder, to)) continue
    const fresh = contentsOf(next.figures, Location.system(to)).some((id) => {
      const f = parseFigureId(id)
      return f.color === holder && f.piece === 'Starport' && !next.damaged.includes(id)
    })
    if (!fresh) continue

    const agent = reservePiece(next, mover, 'Agent')
    if (agent === undefined) {
      next = { ...next, log: [...next.log, `${mover} had no agent for ${holder} to capture`] }
      continue
    }
    next = {
      ...next,
      figures: move(next.figures, agent, Location.captives(holder)),
      log: [...next.log, `${holder} captured a ${mover} agent (Gate Ports)`],
    }
  }
  return next
}

function performMoveShips(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  count: number,
  then: PipReturn,
): RuleResult {
  const group = fleetAt(state, faction, from).slice(0, count)
  if (group.length === 0) return { state, continue: C.then(then as Action) }

  const cat = canCatapult(state, faction, from, to)
  // The toll is charged against the board as it stands, before these ships land.
  const tolled = gatePortsCapture(state, faction, to)
  let figures = tolled.figures
  for (const id of group) figures = move(figures, id, Location.system(to))

  const next: GameState = {
    ...tolled,
    figures,
    log: [
      ...tolled.log,
      `${faction} moved ${group.length} ship${group.length === 1 ? '' : 's'} ${from} → ${to}`,
    ],
  }
  // A catapult lets the same group carry on from the gate it just reached.
  if (cat) {
    return { state: next, continue: offerMoveMore(next, faction, to, group, then) }
  }
  // Sprinter Drives resolves *after* all catapult movement, which the card says explicitly, so
  // it is offered only once the catapult chain above has declined to continue.
  return { state: next, continue: offerSprint(next, faction, to, group, then) }
}

/**
 * Sprinter Drives (lore03): "When you move fresh Loyal ships, you may move any of them one more
 * time."
 *
 * Only the **fresh** ships of the group that just moved may go again — the card is explicit that
 * damaged ships come along for the first move but not the second.
 *
 * **Each ship may reach its own destination.** The official errata says so, and it is why this is
 * a loop rather than one group move: after each leg the remaining fresh ships are offered again
 * from the same system, so a fleet can fan out. The card is spent only once the player stops,
 * which is what `started` distinguishes — re-entering mid-fan must not be blocked by the
 * once-per-turn gate it is about to set.
 *
 * The same errata rewrites the trigger to "when you move fresh Loyal ships, **except using
 * Sprinter Drives**", closing the loop where a sprint would trigger another sprint. Nothing here
 * re-offers on the sprint's own arrival, so that is already the behaviour.
 */
function offerSprint(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  group: readonly string[],
  then: PipReturn,
  started = false,
): Continue {
  if (!started) {
    if (!hasLore(state, faction, SPRINTER_DRIVES)) return C.then(then as Action)
    if (state.loreUsedThisTurn.includes(SPRINTER_DRIVES)) return C.then(then as Action)
  }

  const here = new Set(contentsOf(state.figures, Location.system(from)))
  const fresh = group.filter((id) => here.has(id) && !state.damaged.includes(id))
  const stop: Action = { type: 'action/lore-sprint-stop', faction, then, spent: started, label: started ? 'Done sprinting' : 'Stay put' }
  if (fresh.length === 0) return started ? C.then(stop) : C.then(then as Action)

  const options: Action[] = []
  for (const dest of connectedSystems(state.board, from)) {
    for (let n = fresh.length; n >= 1; n--) {
      options.push({
        type: 'action/lore-sprint',
        faction,
        from,
        to: dest,
        ships: fresh.slice(0, n),
        rest: fresh.slice(n),
        then,
        label: `Sprint ${n} ship${n === 1 ? '' : 's'} on to ${dest}`,
      })
    }
  }
  if (options.length === 0) return started ? C.then(stop) : C.then(then as Action)
  return C.ask(faction, [...options, stop], `Sprinter Drives — move again from ${from}?`)
}

function performSprint(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  to: SystemId,
  ships: readonly string[],
  rest: readonly string[],
  then: PipReturn,
): RuleResult {
  const tolled = gatePortsCapture(state, faction, to)
  let figures = tolled.figures
  for (const id of ships) figures = move(figures, id, Location.system(to))
  const next: GameState = {
    ...tolled,
    figures,
    log: [...tolled.log, `${faction} sprinted ${ships.length} ship(s) to ${to} (Sprinter Drives)`],
  }
  // Ships still behind may fan out to somewhere else before the card is spent.
  if (rest.length > 0) {
    return { state: next, continue: offerSprint(next, faction, from, rest, then, true) }
  }
  return { state: spendSprint(next), continue: C.then(then as Action) }
}

/** The card is spent once, however many legs the fan-out took. */
function spendSprint(state: GameState): GameState {
  if (state.loreUsedThisTurn.includes(SPRINTER_DRIVES)) return state
  return { ...state, loreUsedThisTurn: [...state.loreUsedThisTurn, SPRINTER_DRIVES] }
}

/**
 * The fleet has landed on a gate and may continue. The chain stays live for each further
 * leg, so it can run the gate ring — HRF re-enters with `cascade = true`.
 */
function offerMoveMore(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  group: readonly string[],
  then: PipReturn,
): Continue {
  const here = new Set(contentsOf(state.figures, Location.system(from)))
  const alive = group.filter((id) => here.has(id))
  if (alive.length === 0) return C.then(then as Action)

  const options: Action[] = []
  for (const dest of connectedSystems(state.board, from)) {
    const onward =
      systemInfo(dest).isGate &&
      !state.factions.some((e) => e !== faction && rules(state, e, dest))
    options.push({
      ...MoveMore(faction, dest, alive, then),
      faction,
      label: `Continue to ${dest}${onward ? ' — and further' : ''}`,
    })
  }
  const done: Action = { type: 'action/skip', faction, then, label: 'Stop here' }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, done], `Catapult — continue from ${from}?`)
}

/**
 * How many of the fleet carry on to `to`. The rest **stay where they are**, which is the
 * point of a catapult run: HRF re-asks its ship combinations at every leg
 * (`game-movement.scala:97-115`), so a fleet can drop a ship at each gate as it goes.
 */
function offerMoveMoreSize(
  state: GameState,
  faction: FactionId,
  to: SystemId,
  group: readonly string[],
  then: PipReturn,
): Continue {
  const alive = presentGroup(state, group)
  if (alive.length === 0) return C.then(then as Action)
  if (alive.length === 1) {
    // No choice to make with a single ship; skip the question.
    return C.then(MoveMoreGo(faction, to, alive, 1, then))
  }
  const options: Action[] = []
  for (let n = alive.length; n >= 1; n--) {
    const left = alive.length - n
    options.push({
      ...MoveMoreGo(faction, to, alive, n, then),
      faction,
      label:
        `Continue ${n} ship${n === 1 ? '' : 's'} to ${to}` +
        (left > 0 ? ` (leave ${left} behind)` : ''),
    })
  }
  const stop: Action = { type: 'action/skip', faction, then, label: 'Stop here' }
  return C.ask(faction, [...options, stop], `Continue to ${to} — how many?`)
}

/** Members of a moving group still standing where we left them. */
function presentGroup(state: GameState, group: readonly string[]): string[] {
  const at = state.figures.at
  const home = group.length > 0 ? at.get(group[0]!) : undefined
  return group.filter((id) => at.get(id) === home)
}

function performMoveMore(
  state: GameState,
  faction: FactionId,
  to: SystemId,
  group: readonly string[],
  then: PipReturn,
): RuleResult {
  return { state, continue: offerMoveMoreSize(state, faction, to, group, then) }
}

function performMoveMoreGo(
  state: GameState,
  faction: FactionId,
  to: SystemId,
  group: readonly string[],
  count: number,
  then: PipReturn,
): RuleResult {
  const going = presentGroup(state, group).slice(0, count)
  if (going.length === 0) return { state, continue: C.then(then as Action) }

  const tolled = gatePortsCapture(state, faction, to)
  let figures = tolled.figures
  for (const id of going) figures = move(figures, id, Location.system(to))

  const left = group.length - going.length
  const next: GameState = {
    ...tolled,
    figures,
    log: [
      ...tolled.log,
      `${faction} continued ${going.length} ship${going.length === 1 ? '' : 's'} to ${to}` +
        (left > 0 ? ` (${left} stayed behind)` : ''),
    ],
  }
  /*
   * May the chain carry on from here? Judged on the board **before** these ships landed.
   *
   * The FAQ is explicit about the timing — a catapult stops at "a gate controlled by a Rival
   * *(counted just before your ships move in)*" — and reading it after the move is the whole bug.
   * A rival holding a gate with two fresh ships rules it; move three ships in and *you* rule it, so
   * a post-move test says nobody is blocking and the chain runs on. Reported from play as
   * catapulting straight through a gate held by two fresh enemy ships.
   *
   * `state` is the pre-move board, which is also what `canCatapult` uses for the opening leg, so
   * both ends of the chain now agree about when control is counted.
   */
  const onward =
    systemInfo(to).isGate && !state.factions.some((e) => e !== faction && rules(state, e, to))
  if (onward) return { state: next, continue: offerMoveMore(next, faction, to, going, then) }
  return { state: next, continue: C.then(then as Action) }
}

// --- Tax -------------------------------------------------------------------

const TaxCity = (faction: FactionId, system: SystemId, then: PipReturn): Action => ({
  type: 'action/tax-city',
  faction,
  system,
  then,
})

/**
 * Tax a system where the faction has a city, gaining that planet's resource. Each city may
 * be taxed once per turn. Phase 1 taxes the faction's own cities only; taxing a ruled
 * rival's city (and the capture that follows) is deferred.
 */
/**
 * Cities in `s` this faction may tax right now, its own and its rivals'.
 *
 * "Gain 1 resource at a Loyal or Controlled city." The two halves have different requirements:
 *
 *   - **Your own city** is taxable wherever it stands; ruling is *not* required. That is what makes
 *     Callow (Upstart) — "you can only tax Loyal cities if you control them" — a real cost. Loyal
 *     means *your own*, so the trait restricts by ruling, not by ownership.
 *   - **A rival's city** is taxable only in a system you **rule**, and taxing it captures one of
 *     that rival's agents (see `performTaxCity`).
 *
 * Each city may be taxed once per turn, which `taxedThisTurn` tracks by figure id, so a rival's
 * city and your own in the same system are counted separately.
 */
function taxableAt(state: GameState, faction: FactionId, s: SystemId): string[] {
  const ruled = rules(state, faction, s)
  // Inspiring (Anarchist, leader13) swaps the requirement for taxing a rival from *ruling* the
  // system to merely having ships in it: "In systems with Loyal ships, you may tax Rival cities
  // ignoring control". The trait is worthless to a faction that also rules, so it only ever adds.
  const inspired =
    hasTrait(state, faction, 'Inspiring') && fleetAt(state, faction, s).length > 0

  /*
   * Warlord's Cruelty (lore23): "While Warlord is declared, you may tax cities that you already
   * taxed this turn." It lifts the once-per-turn limit rather than granting a second tax, so it
   * simply drops out of the filter below.
   */
  const relentless = loreActive(state, faction, WARLORDS_CRUELTY)
  /*
   * Empath's Bond (lore20): "you may **tax** *any* cities ... like they are Loyal." So a rival's
   * city stops needing the system to be ruled and is taxed on the same terms as your own — which
   * is what "like they are Loyal" means. The captive it would normally take is suppressed in
   * `performTaxCity`; the card says "Don't take Captives" out loud.
   */
  const bonded = loreActive(state, faction, EMPATHS_BOND)

  return contentsOf(state.figures, Location.system(s)).filter((id) => {
    const f = parseFigureId(id)
    if (f.piece !== 'City') return false
    if (!relentless && state.taxedThisTurn.includes(id)) return false
    if (f.color === faction) {
      // Principled (Anarchist): "You cannot tax Loyal cities." Loyal means *your own* — the same
      // reading as Callow, and the trait that pays for Inspiring.
      if (hasTrait(state, faction, 'Principled')) return false
      return !hasTrait(state, faction, 'Callow') || ruled
    }
    // Only a rival's — an unowned or Empire city is not a faction and cannot be taxed for a captive.
    return (ruled || inspired || bonded) && state.factions.includes(f.color as FactionId)
  })
}

/**
 * Empty building slots the Anarchist may tax, as synthetic ids.
 *
 * Inspiring: "you may tax empty building slots like Loyal cities". A slot is not a figure, so it
 * has no id to track a once-per-turn limit by — these ids exist for `taxedThisTurn` and for
 * nothing else, and are never placed in any tracker. Numbered rather than identified, because
 * empty slots on a planet are interchangeable.
 *
 * "Like Loyal cities" is doing the work here: taxing one gains the planet's resource and captures
 * nobody, because no rival owns it.
 */
function taxableSlotsAt(state: GameState, faction: FactionId, s: SystemId): string[] {
  if (!hasTrait(state, faction, 'Inspiring')) return []
  if (fleetAt(state, faction, s).length === 0) return []
  return Array.from({ length: freeSlots(state, s) }, (_, i) => `emptyslot:${s}:${i}`).filter(
    (id) => !state.taxedThisTurn.includes(id),
  )
}

/** True for one of Inspiring's synthetic empty-slot ids, which is not a figure at all. */
const isEmptySlot = (id: string): boolean => id.startsWith('emptyslot:')

/** Whose city this is, when it belongs to a rival of `faction`. */
function cityOwner(state: GameState, faction: FactionId, city: string): FactionId | undefined {
  if (isEmptySlot(city)) return undefined
  const color = parseFigureId(city).color
  if (color === faction) return undefined
  return state.factions.find((f) => f === (color as FactionId))
}

/**
 * Can this tax have **no effect whatsoever**?
 *
 * Taxing an exhausted supply is legal — the rulebook does not forbid it and `gain` simply reports
 * `gained: false` — but offering an action that provably does nothing is how the bot came to spend
 * a fifth of its taxes on air (20% of 251 across six games). `performTurn` already declines to
 * stall on a suit that can buy nothing; this is the same idea one level down.
 *
 * **Conservative by construction, and that direction is the whole safety argument.** A tax is not
 * only a resource grab — `performTaxCity` can also capture an agent, pay a leader's bonus, trigger
 * Mythic and trigger Ruthless. Saying "nothing" when something was possible deletes a legal move,
 * which would be a real rules bug traded for a cosmetic one; saying "something" when nothing was
 * possible merely leaves a useless option on the menu. So every clause below must be *certain*, and
 * the two trait gates are read from `mythicTokens` / `canRuthless` rather than restated, because a
 * restatement is exactly what would drift and start hiding useful taxes.
 */
function taxGainsNothing(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  city: string,
  resource: Resource | undefined,
): boolean {
  // No known resource means we cannot reason about the supply at all — keep the option.
  if (resource === undefined) return false
  if (supplyOf(state.resources, resource).length > 0) return false
  /*
   * The capture, read the way `performTaxCity` reads it: Empath's Bond taxes a rival's city
   * *without* the usual capture, so under the Bond even a rival's city gains nothing here.
   */
  const owner = loreActive(state, faction, EMPATHS_BOND)
    ? undefined
    : cityOwner(state, faction, city)
  if (owner !== undefined) return false
  // A leader's bonus resource is still a gain, if any of them is still in the supply.
  for (const r of taxBonusResources(state, faction)) {
    if (supplyOf(state.resources, r).length > 0) return false
  }
  if (mythicTokens(state, faction, system, city).length > 0) return false
  if (canRuthless(state, faction, system, city)) return false
  return true
}

function offerTax(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const s of state.board.systems) {
    // Gate Stations (lore11) makes a gate city taxable for any type its cluster holds, so a gate
    // offers one option per type rather than the single printed resource a planet has.
    for (const city of taxableAt(state, faction, s)) {
      for (const r of gateCityTypes(state, s)) {
        if (taxGainsNothing(state, faction, s, city, r)) continue
        options.push({
          ...TaxCity(faction, s, then),
          city,
          resource: r,
          faction,
          label:
            cityOwner(state, faction, city) === undefined
              ? `Tax ${s} (+${r}, Gate Stations)`
              : `Tax ${cityOwner(state, faction, city)!}'s city in ${s} (+${r}, Gate Stations)`,
        })
      }
    }
    if (planetResource(state, s) === undefined) continue
    // One option per City, not per system — a 2-slot planet can hold two of your Cities,
    // and each may be taxed once. Cities already taxed this turn are withheld.
    for (const city of taxableAt(state, faction, s)) {
      if (taxGainsNothing(state, faction, s, city, planetResource(state, s))) continue
      const owner = cityOwner(state, faction, city)
      options.push({
        ...TaxCity(faction, s, then),
        city,
        faction,
        label:
          owner === undefined
            ? `Tax ${s} (+${planetResource(state, s)})`
            : `Tax ${owner}'s city in ${s} (+${planetResource(state, s)}, capture an agent)`,
      })
    }
    // Inspiring's empty building slots, taxed "like Loyal cities" — the planet's resource, and
    // no captive, since nobody owns an empty slot.
    for (const slot of taxableSlotsAt(state, faction, s)) {
      if (taxGainsNothing(state, faction, s, slot, planetResource(state, s))) continue
      options.push({
        ...TaxCity(faction, s, then),
        city: slot,
        faction,
        label: `Tax an empty slot in ${s} (+${planetResource(state, s)}, Inspiring)`,
      })
    }
  }
  const all = withAlts(state, faction, 'Tax', then, options)
  if (all.length === 0) return C.then(then as Action)
  return C.ask(faction, [...all, skip(faction, then)], 'Tax')
}

/**
 * Insatiable (Fuel Drinker) and Attuned (Mystic): a bonus resource alongside the taxed one,
 * but **only when this turn's pips came from a Copy or a Pivot**.
 *
 * HRF gates both on `along = x == Pip && (f.copy || f.pivot)` (game-common.scala:766, 775-782),
 * so a Lead or a Surpass gets nothing. Both traits can be held at once in principle, so this
 * returns a list rather than one resource.
 */
function taxBonusResources(state: GameState, faction: FactionId): Resource[] {
  if (!copiedOrPivoted(state, faction)) return []
  const bonus: Resource[] = []
  if (hasTrait(state, faction, 'Insatiable')) bonus.push('Fuel')
  if (hasTrait(state, faction, 'Attuned')) bonus.push('Psionic')
  // Firebrand (Agitator, leader15): "When you Copy or Pivot in order to tax, you gain 1 Weapon
  // along with the taxed resource." Word for word the same shape as the two above.
  if (hasTrait(state, faction, 'Firebrand')) bonus.push('Weapon')
  return bonus
}

function performTaxCity(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  then: PipReturn,
  city: string,
  chosen?: Resource,
): RuleResult {
  // A gate has no printed resource; the type comes from the option that was picked.
  const resource = chosen ?? (planetResource(state, system) as Resource)
  const taxed = gain(state.resources, slotsOf(state, faction), resource, ResourceSlot.overflow(faction))
  const { tracker } = taxed
  const note = taxed.gained
    ? `+${resource}`
    : taxed.overflowed
      ? `${resource} — no room, choose what to keep`
      : `${resource} lost (none left in supply)`
  let resources = tracker
  const log = [...state.log, `${faction} taxed ${system} (${note})`]

  /*
   * "Taxing Rival captures an agent." Collecting from someone else's city takes one of their
   * agents out of reserve and into your captives — the base game's other source of captives
   * besides securing, and so of Tyrant scoring. A rival with no agents left simply loses nothing.
   */
  let figures = state.figures
  // "Don't take Captives" — the Bond taxes a rival's city without the usual capture.
  const owner = loreActive(state, faction, EMPATHS_BOND)
    ? undefined
    : cityOwner(state, faction, city)
  if (owner !== undefined) {
    const agent = reservePiece(state, owner, 'Agent')
    if (agent === undefined) {
      log.push(`${owner} had no agent for ${faction} to capture`)
    } else {
      figures = move(figures, agent, Location.captives(faction))
      log.push(`${faction} captured a ${owner} agent by taxing`)
    }
  }
  for (const r of taxBonusResources(state, faction)) {
    const extra = gain(resources, slotsOf(state, faction), r, ResourceSlot.overflow(faction))
    resources = extra.tracker
    log.push(
      extra.gained || extra.overflowed
        ? `${faction} gained ${r} from their leader`
        : `${faction} could not gain ${r} from their leader (none in supply)`,
    )
  }
  const next: GameState = {
    ...state,
    figures,
    resources,
    taxedThisTurn: [...state.taxedThisTurn, city],
    log,
  }
  // Mythic comes after the overflow is settled, so the Shaper reshapes the planet holding what it
  // actually ended up with rather than what it briefly had in hand.
  const after = Mythic(faction, system, city, Ruthless(faction, system, city, 'tax', then, resource))
  return { state: next, continue: overflowThen(next, faction, after) }
}

// --- Mythic (Shaper, leader14) ----------------------------------------------

const Mythic = (
  faction: FactionId,
  system: SystemId,
  city: string,
  then: PipReturn,
): Action => ({ type: 'leaders/mythic', faction, system, city, then })

const MythicPlace = (
  faction: FactionId,
  system: SystemId,
  token: string,
  then: PipReturn,
): Action => ({ type: 'leaders/mythic-place', faction, system, token, then })

/**
 * Mythic: "After you **tax** a city, you may place 1 resource you have over the planet's resource
 * icon. From now on, its planet type is the placed resource, and its planet type cannot be
 * changed again with *Mythic*."
 *
 * Three limits, all read off state rather than tracked separately:
 *
 *   - **a city**, so Inspiring's empty slots do not trigger it;
 *   - **a planet**, so a gate — which prints no icon to cover — is out;
 *   - **not already changed**, which `state.planetTypes` already records.
 *
 * The token is spent to the supply rather than moved onto the map: the board carries no location
 * for a resource sitting on a planet, and nothing in the rules ever takes one back off. What it
 * leaves behind is the type change, which is the whole effect.
 *
 * One option per distinct type held, because two Fuel are the same choice.
 */
/**
 * The tokens Mythic could reshape this planet with, or `[]` when it cannot fire at all.
 *
 * Split out of `offerMythic` so `taxGainsNothing` can ask the same question without restating the
 * gates. Restating them is the failure mode that matters here: the filter withholds a tax option,
 * so a gate that drifts out of sync would start hiding a *useful* tax — a rules bug traded for a
 * cosmetic one.
 */
function mythicTokens(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  city: string,
): readonly string[] {
  if (!hasTrait(state, faction, 'Mythic')) return []
  if (isEmptySlot(city)) return []
  if (systemInfo(system).isGate) return []
  if (state.planetTypes[system] !== undefined) return []
  const out: string[] = []
  const seen = new Set<Resource>()
  for (const token of heldTokens(state.resources, slotsOf(state, faction))) {
    const r = parseResourceToken(token).resource
    if (seen.has(r) || r === planetResource(state, system)) continue
    seen.add(r)
    out.push(token)
  }
  return out
}

function offerMythic(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  city: string,
  then: PipReturn,
): Continue {
  const tokens = mythicTokens(state, faction, system, city)
  const options: Action[] = tokens.map((token) => ({
    ...MythicPlace(faction, system, token, then),
    faction,
    label: `Reshape ${system} into a ${parseResourceToken(token).resource} planet (Mythic)`,
  }))
  if (options.length === 0) return C.then(then as Action)
  return C.ask(
    faction,
    [...options, { ...skip(faction, then), label: 'Leave the planet as it is' }],
    `${faction} — Mythic: reshape ${system}?`,
  )
}

function performMythicPlace(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  token: string,
  then: PipReturn,
): RuleResult {
  const r = parseResourceToken(token).resource
  const next: GameState = {
    ...state,
    resources: spendToken(state.resources, token),
    planetTypes: { ...state.planetTypes, [system]: r },
    log: [...state.log, `${faction} reshaped ${system} into a ${r} planet (Mythic)`],
  }
  return { state: next, continue: C.then(then as Action) }
}

// --- Build -----------------------------------------------------------------

const BuildPiece = (
  faction: FactionId,
  piece: Piece,
  system: SystemId,
  then: PipReturn,
): Action => ({ type: 'action/build', faction, piece, system, then })

/**
 * Build a City or Starport into an open building slot of a system the faction rules, or a
 * Ship at one of its starports. Phase 1 requires *ruling* the system for a building (the
 * base rule is presence with an open slot for cities/starports at a starport you rule —
 * simplified here to ruled-and-open-slot). Upgrades, gate stations and bunkers are
 * deferred.
 */
function offerBuild(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  const hasCityPiece = reservePiece(state, faction, 'City') !== undefined
  const hasPortPiece = reservePiece(state, faction, 'Starport') !== undefined
  const hasShipPiece = reservePiece(state, faction, 'Ship') !== undefined

  for (const s of systemsWherePresent(state, faction)) {
    const slotFree = freeSlots(state, s) > 0
    const ruled = rules(state, faction, s)
    if (slotFree && ruled && hasCityPiece) {
      options.push({ ...BuildPiece(faction, 'City', s, then), faction, label: `Build City in ${s}` })
    }
    if (slotFree && ruled && hasPortPiece) {
      options.push({
        ...BuildPiece(faction, 'Starport', s, then),
        faction,
        label: `Build Starport in ${s}`,
      })
    }
    // A Ship may be built at a friendly Starport — but each Starport produces at most one
    // Ship per turn, so they are offered individually and used ones are withheld.
    if (hasShipPiece) {
      // Empath's Bond builds at *any* starport, not just your own.
      const anyPort = loreActive(state, faction, EMPATHS_BOND)
      const starports = contentsOf(state.figures, Location.system(s)).filter((id) => {
        const f = parseFigureId(id)
        return (anyPort || f.color === faction) && f.piece === 'Starport'
      })
      const available = starports.filter((id) => !state.workedThisTurn.includes(id))
      if (available.length > 0) {
        options.push({
          ...BuildPiece(faction, 'Ship', s, then),
          starport: available[0]!,
          faction,
          label: `Build Ship in ${s}`,
        })
      }
      // Tool Priests (lore01): "build 1 ship at any city you control", once per turn. HRF adds
      // the cities of systems you rule to the same shipyard list (game-common.scala:875) and
      // gates it on no city having been worked yet — so *any* colour's city counts, as the
      // card's "yes, even Rival cities you control!" says out loud.
      const city = toolPriestCity(state, faction, s)
      if (city !== undefined) {
        options.push({
          ...BuildPiece(faction, 'Ship', s, then),
          starport: city,
          faction,
          label: `Summon Ship in ${s} (Tool Priests)`,
        })
      }
    }

    /*
     * Tyrant's Authority (lore26): "Annex (Build): While Tyrant is declared, replace **any** city
     * or starport you control with a Loyal city or starport, respectively."
     *
     * "You control" is ruling the system, and "any" means a rival's — annexing your own would be
     * a no-op. The replaced piece goes home to its owner's reserve, which is what the card's
     * "(Cities return to player boards)" says: a returned city goes back onto that player's board,
     * covering a resource slot again, which `citiesInReserve` already models.
     *
     * It is a Build, so it needs a piece of the same kind in your own reserve to put down.
     */
    if (loreActive(state, faction, TYRANTS_AUTHORITY) && rules(state, faction, s)) {
      for (const id of contentsOf(state.figures, Location.system(s))) {
        const f = parseFigureId(id)
        if (f.piece !== 'City' && f.piece !== 'Starport') continue
        if (f.color === faction) continue
        if (reservePiece(state, faction, f.piece) === undefined) continue
        options.push({
          ...BuildPiece(faction, f.piece, s, then),
          annex: id,
          faction,
          label: `Annex ${f.color}'s ${f.piece} in ${s} (Tyrant's Authority)`,
        })
      }
    }

    const cloud = cloudCityCost(state, faction, s)
    if (cloud !== undefined && hasCityPiece) {
      options.push({
        ...BuildPiece(faction, 'City', s, then),
        cloud: true,
        pay: cloud,
        faction,
        label: `Build Cloud City in ${s} (pay ${cloud})`,
      })
    }

    for (const gate of gateBuilds(state, faction, s)) {
      if (gate.piece === 'City' && !hasCityPiece) continue
      if (gate.piece === 'Starport' && !hasPortPiece) continue
      options.push({
        ...BuildPiece(faction, gate.piece, s, then),
        faction,
        label: `Build ${gate.piece} on ${s} (${gate.card})`,
      })
    }
  }

  const all = withAlts(state, faction, 'Build', then, options)
  if (all.length === 0) return C.then(then as Action)
  return C.ask(faction, [...all, skip(faction, then)], 'Build')
}

/**
 * A city in `s` that Tool Priests could summon a ship at, if the card allows it right now.
 *
 * The once-per-turn limit is HRF's `f.worked.cities.none`: it is spent when *any* city has been
 * worked this turn, not per city. `workedThisTurn` already records worked buildings, so the city
 * is passed as the `starport` that `performBuild` marks — the same mechanism, no new state.
 */
function toolPriestCity(state: GameState, faction: FactionId, s: SystemId): string | undefined {
  if (!hasLore(state, faction, TOOL_PRIESTS)) return undefined
  if (!rules(state, faction, s)) return undefined
  const cities = contentsOf(state.figures, Location.system(s)).filter(
    (id) => parseFigureId(id).piece === 'City',
  )
  const workedACity = state.workedThisTurn.some((id) => parseFigureId(id).piece === 'City')
  if (workedACity) return undefined
  return cities[0]
}

/**
 * Cloud Cities (lore09): "You may build cities on planets outside their building slots, max 1 per
 * planet. This costs 1 resource of the planet type."
 *
 * Returns the resource that must be paid, or undefined when the card cannot be used here. Three
 * things have to hold: the system is a planet with a type, nobody has already put a cloud city on
 * it, and you hold a resource matching that type.
 *
 * **Slots are irrelevant** — that is the point of the card. It is the one way to build a city on a
 * planet whose slots are full, or one you do not rule, so the offer deliberately does not consult
 * `freeSlots` or `rules`. HRF gates it on presence alone (game-common.scala:829).
 *
 * "Max 1 per planet" counts *cloud* cities, not cities in general, and not per faction: a planet
 * with a slotted city may still take one, and once one is there nobody may add a second. That
 * matches the official ruling that a card's "max 1" counts only what that card placed — which is
 * what `state.unslotted` records.
 */
function cloudCityCost(state: GameState, faction: FactionId, s: SystemId): Resource | undefined {
  if (!hasLore(state, faction, CLOUD_CITIES)) return undefined
  const info = systemInfo(s)
  if (info.isGate) return undefined
  const type = RESOURCES.find((r) => r === info.resource)
  if (type === undefined) return undefined
  if (hasCloudCity(state, s)) return undefined
  return tokenOfResource(state, faction, type) === undefined ? undefined : type
}

/** One of this faction's held tokens of `r`, if any. */
function tokenOfResource(state: GameState, faction: FactionId, r: Resource): string | undefined {
  const capacity = slotsOf(state, faction)
  return heldTokens(state.resources, capacity).find(
    (id) => parseResourceToken(id).resource === r,
  )
}

/**
 * Buildings two lore cards allow on a **gate**, which normally has none.
 *
 * Gates carry no building slots at all — `freeSlots` reads `buildingSlots ?? 0` — so the ordinary
 * offer above can never place anything there. Gate Stations (lore11) opens gates to cities and
 * Gate Ports (lore08) to starports, and each card's "max 1 per gate" is **one of yours**, not one
 * in total: HRF gates on `f.at(_).cities.none` / `f.at(_).starports.none`
 * (game-common.scala:847-851), so two factions may each hold a building on the same gate.
 *
 * Presence is enough — ruling is not required, unlike a slotted system. That is HRF's `present`
 * rather than `present.%(f.rules)`, and it is what makes these cards a way *into* a contested
 * gate rather than a reward for already owning it.
 */
function gateBuilds(
  state: GameState,
  faction: FactionId,
  s: SystemId,
): { piece: Piece; card: string }[] {
  if (!systemInfo(s).isGate) return []
  const mine = (piece: Piece): boolean =>
    contentsOf(state.figures, Location.system(s)).some((id) => {
      const f = parseFigureId(id)
      return f.color === faction && f.piece === piece
    })
  const out: { piece: Piece; card: string }[] = []
  if (hasLore(state, faction, GATE_STATIONS) && !mine('City')) {
    out.push({ piece: 'City', card: 'Gate Stations' })
  }
  if (hasLore(state, faction, GATE_PORTS) && !mine('Starport')) {
    out.push({ piece: 'Starport', card: 'Gate Ports' })
  }
  return out
}

function performBuild(
  state: GameState,
  faction: FactionId,
  piece: Piece,
  system: SystemId,
  then: PipReturn,
  starport?: string,
  cloud?: boolean,
  pay?: Resource,
  annex?: string,
): RuleResult {
  const id = reservePiece(state, faction, piece)
  if (id === undefined) {
    return {
      state: { ...state, log: [...state.log, `${faction} had no ${piece} to build`] },
      continue: C.then(then as Action),
    }
  }
  let resources = state.resources
  if (cloud === true && pay !== undefined) {
    const token = tokenOfResource(state, faction, pay)
    if (token === undefined) {
      return {
        state: { ...state, log: [...state.log, `${faction} had no ${pay} to pay for a Cloud City`] },
        continue: C.then(then as Action),
      }
    }
    resources = spendToken(resources, token)
  }
  /*
   * An annexed piece leaves first, so the slot it occupied is free for the replacement. Home to
   * its owner's reserve — a city returning to that player's board is the card's own wording.
   */
  let figures = state.figures
  const annexLog: string[] = []
  if (annex !== undefined) {
    const a = parseFigureId(annex)
    figures = move(figures, annex, Location.reserve(a.color))
    annexLog.push(`${faction} annexed ${a.color}'s ${a.piece} in ${system}`)
  }
  figures = move(figures, id, Location.system(system))

  /*
   * "Build ships damaged in Rival-controlled systems." Scoped to the Bond, because it is the
   * parenthetical on the Bond's own grant — an ordinary build at your own starport is unaffected.
   */
  const contested =
    piece === 'Ship' &&
    loreActive(state, faction, EMPATHS_BOND) &&
    state.factions.some((f) => f !== faction && rules(state, f, system))
  // The Starport that produced this Ship is spent for the rest of the turn.
  const workedThisTurn =
    starport === undefined ? state.workedThisTurn : [...state.workedThisTurn, starport]
  return {
    state: {
      ...state,
      figures,
      resources,
      workedThisTurn,
      damaged: contested ? [...state.damaged, id] : state.damaged,
      unslotted: cloud === true ? [...state.unslotted, id] : state.unslotted,
      log: [
        ...state.log,
        ...annexLog,
        cloud === true
          ? `${faction} built a Cloud City in ${system} (paid ${String(pay)})`
          : `${faction} built a ${piece} in ${system}${contested ? ' (damaged — Rival-controlled)' : ''}`,
      ],
    },
    // Ruthless triggers on building a Ship *at a building*, which is what `starport` names —
    // a Tool Priests city included, since the card says "build a ship at a starport" and that
    // card is what makes a city one for the turn.
    continue:
      piece === 'Ship' && starport !== undefined
        ? C.then(Ruthless(faction, system, starport, 'build', then))
        : C.then(then as Action),
  }
}

// --- Ruthless (Overseer, leader10) ------------------------------------------

/** Marker for the once-per-turn limit, in the same list the lore one-shots use. */
const RUTHLESS = 'Ruthless'

/*
 * `resource` rides the whole Ruthless chain, and it is not optional decoration.
 *
 * Ruthless re-takes the action with the building it just hit, and for a **gate** city there is no
 * printed resource to re-derive: Gate Stations picks the type when the tax is offered, so the
 * choice lives only in the original action. Without it here, `performRuthlessAgain` called
 * `performTaxCity` with `undefined` and the re-tax crashed on `supply:undefined`. Latent until
 * followers stopped being able to pass, which changed how far games run.
 */
const Ruthless = (
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): Action => ({ type: 'leaders/ruthless', faction, system, building, kind, then, resource })

const RuthlessAgain = (
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): Action => ({ type: 'leaders/ruthless-again', faction, system, building, kind, then, resource })

const RuthlessHit = (
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): Action => ({ type: 'leaders/ruthless-hit', faction, system, building, kind, then, resource })

/**
 * Ruthless: "Once per turn, when you **tax** any city or **build** a ship at a starport, you may
 * hit the building to take that action again with it. If you destroy a Loyal city, you Provoke
 * Outrage. (If you destroy a Rival city, Provoke Outrage and Ransack the Court.)"
 *
 * The card distinguishes *hitting* from *destroying*, which is exactly this engine's two-stage
 * model: a hit damages a fresh building and destroys an already-damaged one. So a first use
 * usually only damages, and the outrage clause bites the second time — or the first, on a
 * building a battle already hurt.
 *
 * "Any city" is literal: taxing a Rival's city and then hitting *their* city is on the table, and
 * is the reading the parenthesis about Rival cities depends on to mean anything at all.
 *
 * Inspiring's synthetic empty slots are excluded — there is no building there to hit.
 */
/**
 * Can Ruthless still fire on this building? Split out of `offerRuthless` for the same reason
 * `mythicTokens` is: `taxGainsNothing` must read the gates rather than restate them.
 */
function canRuthless(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  building: string,
): boolean {
  if (!hasTrait(state, faction, RUTHLESS)) return false
  if (state.loreUsedThisTurn.includes(RUTHLESS)) return false
  if (isEmptySlot(building)) return false
  // The building has to still be standing to be hit — a battle may have taken it since.
  return contentsOf(state.figures, Location.system(system)).includes(building)
}

function offerRuthless(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): Continue {
  if (!canRuthless(state, faction, system, building)) return C.then(then as Action)

  const p = parseFigureId(building)
  const dies = state.damaged.includes(building)
  const verb = kind === 'tax' ? 'tax it again' : 'build another Ship'
  return C.ask(
    faction,
    [
      {
        ...RuthlessHit(faction, system, building, kind, then, resource),
        faction,
        label: `Hit the ${p.color} ${p.piece} in ${system} and ${verb}${dies ? ' (destroys it)' : ''}`,
      },
      { ...skip(faction, then), label: 'Spare the building' },
    ],
    `${faction} — Ruthless: squeeze the ${p.piece} in ${system}?`,
  )
}

function performRuthlessHit(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): RuleResult {
  const p = parseFigureId(building)
  const destroyed = state.damaged.includes(building)

  let next: GameState = {
    ...state,
    loreUsedThisTurn: [...state.loreUsedThisTurn, RUTHLESS],
  }

  if (destroyed) {
    /*
     * Home to its owner's reserve rather than to the Overseer's trophies. Trophies are a battle's
     * spoils — the card grants none, and taking them would quietly feed Tyrant scoring off an
     * action that never mentions it.
     */
    next = {
      ...next,
      figures: move(next.figures, building, Location.reserve(p.color)),
      damaged: next.damaged.filter((id) => id !== building),
      unslotted: next.unslotted.filter((id) => id !== building),
      log: [...next.log, `${faction} destroyed the ${p.color} ${p.piece} in ${system} (Ruthless)`],
    }
    // Outrage is provoked by destroying a **city**, either side's; a starport provokes none.
    if (p.piece === 'City') {
      const r = planetResource(next, system)
      if (r !== undefined) next = provokeOutrage(next, faction, r)
      for (const t of gateCityTypes(next, system)) next = provokeOutrage(next, faction, t)
    }
  } else {
    next = {
      ...next,
      damaged: [...next.damaged, building],
      log: [...next.log, `${faction} hit the ${p.color} ${p.piece} in ${system} (Ruthless)`],
    }
  }

  /*
   * Ransacking follows a destroyed **Rival** city, and is offered before the repeated action so
   * the court step and the action it interrupts do not have to be threaded together — the repeat
   * is simply what the ransack continues to.
   */
  const repeat = RuthlessAgain(faction, system, building, kind, then, resource)
  const victim = destroyed && p.piece === 'City' ? cityOwner(next, faction, building) : undefined
  if (victim === undefined) return { state: next, continue: C.then(repeat) }
  return { state: next, continue: offerRuthlessRansack(next, faction, victim, repeat) }
}

/** Take the action again with the building just hit — the second half of Ruthless. */
function performRuthlessAgain(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  building: string,
  kind: 'tax' | 'build',
  then: PipReturn,
  resource?: Resource,
): RuleResult {
  // Taken directly, so the once-per-turn limits the first use already spent do not stop it.
  return kind === 'tax'
    ? performTaxCity(state, faction, system, then, building, resource)
    : performBuild(state, faction, 'Ship', system, then, building)
}

/**
 * The Ransack the parenthesis calls for, on the same terms as a battle's: one card, only from
 * slots the victim has an agent on, and never against Beloved.
 */
function offerRuthlessRansack(
  state: GameState,
  faction: FactionId,
  victim: FactionId,
  then: Action,
): Continue {
  if (hasTrait(state, victim, 'Beloved')) {
    return C.log(`${victim} cannot be ransacked (their leader)`, C.then(then))
  }
  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => cardInSlot(state, n) !== undefined)
    .filter((n) =>
      contentsOf(state.figures, Location.court(n)).some(
        (id) => parseFigureId(id).color === victim,
      ),
    )
    .map((n) => ({
      type: 'action/ransack',
      faction,
      slot: n,
      then,
      label: `Ransack ${courtCard(cardInSlot(state, n)!).name}`,
    }))
  if (options.length === 0) return C.then(then)
  return C.ask(
    faction,
    [...options, { ...then, faction, label: 'Ransack nothing' }],
    `${faction} destroyed a ${victim} city — ransack the court?`,
  )
}

// --- Repair ----------------------------------------------------------------

const RepairPiece = (faction: FactionId, figure: string, then: PipReturn): Action => ({
  type: 'action/repair',
  faction,
  figure,
  then,
})

/** Repair un-damages one of the faction's damaged pieces. Unblocked by the battle damage state. */
function offerRepair(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const mine = state.damaged.filter((id) => parseFigureId(id).color === faction)
  const options: Action[] = mine.map((id) => ({
    ...RepairPiece(faction, id, then),
    faction,
    label: `Repair ${id}`,
  }))
  const all = withAlts(state, faction, 'Repair', then, options)
  if (all.length === 0) return C.then(then as Action)
  return C.ask(faction, [...all, skip(faction, then)], 'Repair')
}

function performRepair(
  state: GameState,
  faction: FactionId,
  figure: string,
  then: PipReturn,
): RuleResult {
  return {
    state: {
      ...state,
      damaged: state.damaged.filter((id) => id !== figure),
      log: [...state.log, `${faction} repaired ${figure}`],
    },
    continue: C.then(then as Action),
  }
}

// --- court: influence & secure ---------------------------------------------

const InfluenceSlot = (faction: FactionId, slot: number, then: PipReturn): Action => ({
  type: 'action/influence',
  faction,
  slot,
  then,
})
const SecureSlot = (faction: FactionId, slot: number, then: PipReturn): Action => ({
  type: 'action/secure',
  faction,
  slot,
  then,
})

/** The card face-up in slot `n`, if any. */
function cardInSlot(state: GameState, n: number): string | undefined {
  return contentsOf(state.courtCards, CourtPile.slot(n))[0]
}

/** Agents on slot `n` belonging to `color`. */
function agentsOn(state: GameState, n: number, color: string): string[] {
  return contentsOf(state.figures, Location.court(n)).filter(
    (id) => parseFigureId(id).color === color,
  )
}

/**
 * Influence: place one agent from reserve onto a court card
 * (`game-common.scala:1086` — `f.reserve --> Agent --> Influence(n)`).
 *
 * Needs an agent in reserve and a card in the slot; an empty slot cannot be influenced
 * (HRF disables it with `.!(m.none)`).
 */
function offerInfluence(state: GameState, faction: FactionId, then: PipReturn): Continue {
  if (reservePiece(state, faction, 'Agent') === undefined) {
    return C.ask(state.current ?? faction, [skip(faction, then)], `${faction} has no agents left`)
  }
  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => cardInSlot(state, n) !== undefined)
    .map((n) => ({
      ...InfluenceSlot(faction, n, then),
      faction,
      label: `Influence ${courtCard(cardInSlot(state, n)!).name}`,
    }))
  const all = withAlts(state, faction, 'Influence', then, options)
  if (all.length === 0) {
    return C.ask(faction, [skip(faction, then)], 'the court is empty')
  }
  return C.ask(faction, [...all, skip(faction, then)], `${faction} — Influence`)
}

function performInfluence(
  state: GameState,
  faction: FactionId,
  slot: number,
  then: PipReturn,
  again?: boolean,
): RuleResult {
  const agent = reservePiece(state, faction, 'Agent')
  if (agent === undefined) throw new Error(`${faction} has no agent to place`)
  const card = cardInSlot(state, slot)
  const next: GameState = {
    ...state,
    figures: move(state.figures, agent, Location.court(slot)),
    log: [
      ...state.log,
      `${faction} influenced ${card === undefined ? `slot ${slot}` : courtCard(card).name}`,
    ],
  }
  /*
   * Influential (Noble, leader12): "When you Copy or Pivot to **influence**, you may influence
   * twice." Twice, not repeatedly — `again` marks the second one so it cannot chain, and the
   * second is offered rather than taken, because "may" is on the card and a Noble short of agents
   * may want to keep one.
   *
   * Gated on Copy or Pivot the same way Insatiable and Attuned are, so a Lead gets one influence.
   */
  const twice =
    again !== true && hasTrait(next, faction, 'Influential') && copiedOrPivoted(next, faction)
  if (!twice) return { state: next, continue: C.then(then as Action) }
  return { state: next, continue: offerSecondInfluence(next, faction, then) }
}

/** The Noble's second influence: the same menu, marked so it cannot buy a third. */
function offerSecondInfluence(state: GameState, faction: FactionId, then: PipReturn): Continue {
  if (reservePiece(state, faction, 'Agent') === undefined) return C.then(then as Action)
  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => cardInSlot(state, n) !== undefined)
    .map((n) => ({
      ...InfluenceSlot(faction, n, then),
      faction,
      again: true,
      label: `Influence ${courtCard(cardInSlot(state, n)!).name} again`,
    }))
  if (options.length === 0) return C.then(then as Action)
  return C.ask(
    faction,
    [...options, skip(faction, then)],
    `${faction} — Influential: influence a second card?`,
  )
}

/**
 * Secure: take a court card you hold a **strict** majority of agents on.
 *
 * HRF disables the option when your count is `<=` the best any one rival has
 * (`game-common.scala:1170`) — a tie is not enough, which is the whole tension of the court.
 */
function canSecure(state: GameState, faction: FactionId, n: number): boolean {
  const card = cardInSlot(state, n)
  if (card === undefined) return false
  const mine = agentsOn(state, n, faction).length
  if (mine === 0) return false
  // Paranoid (Demagogue): Guild cards need more than a single agent of your own. Vox cards are
  // explicitly exempt on the card, and HRF gates on `m.first.is[GuildCard]` the same way
  // (game-common.scala:1170). The card's "ignore this if you Ransack the Court" escape has
  // nothing to attach to yet — the engine does not model Ransack.
  if (hasTrait(state, faction, 'Paranoid') && courtCard(card).kind === 'guild' && mine <= 1) {
    return false
  }
  const best = Math.max(
    0,
    ...state.factions.filter((f) => f !== faction).map((f) => agentsOn(state, n, f).length),
  )
  return mine > best
}

function offerSecure(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => canSecure(state, faction, n))
    .map((n) => ({
      ...SecureSlot(faction, n, then),
      faction,
      label: `Secure ${courtCard(cardInSlot(state, n)!).name}`,
    }))
  const all = withAlts(state, faction, 'Secure', then, options)
  if (all.length === 0) {
    return C.ask(faction, [skip(faction, then)], `${faction} controls no court card`)
  }
  return C.ask(faction, [...all, skip(faction, then)], `${faction} — Secure`)
}

/**
 * Taking the card, and the prisoners with it (`CaptureAgentsCourtCardAction`):
 * your own agents go home to reserve, every **rival** agent on the card becomes your
 * captive. This is the base game's only source of captives, and so of Tyrant scoring.
 *
 * The slot is then refilled from the deck (`ReplenishMarketAction`).
 */
/**
 * Secure a court card, or take one by force.
 *
 * `asTrophies` is the Ransack difference: securing normally makes every rival agent on the card
 * your **captive**, but a card taken by ransacking a razed city takes them as **trophies**
 * instead — the rulebook is explicit that they are "Trophies, not Captives". Everything else about
 * taking the card is identical, which is why this is one function.
 */
function performSecure(
  state: GameState,
  faction: FactionId,
  slot: number,
  then: PipReturn,
  asTrophies = false,
): RuleResult {
  const cardId = cardInSlot(state, slot)
  if (cardId === undefined) throw new Error(`no card in court slot ${slot}`)
  const card = courtCard(cardId)

  let figures = state.figures
  let captured = 0
  for (const id of contentsOf(state.figures, Location.court(slot))) {
    if (parseFigureId(id).color === faction) {
      figures = move(figures, id, Location.reserve(faction))
    } else {
      figures = move(figures, id, asTrophies ? Location.trophies(faction) : Location.captives(faction))
      captured++
    }
  }

  // Guild cards are kept; a Vox card triggers and is discarded. Neither has its effect yet.
  const destination = card.kind === 'guild' ? CourtPile.secured(faction) : CourtPile.discard()
  let courtCards = move(state.courtCards, cardId, destination)

  const log = [
    ...state.log,
    asTrophies ? `${faction} ransacked ${card.name}` : `${faction} secured ${card.name}`,
  ]
  if (captured > 0) {
    log.push(
      asTrophies
        ? `${faction} took ${captured} agent(s) as trophies`
        : `${faction} captured ${captured} agent(s)`,
    )
  }

  // Refill the slot from the top of the deck; an exhausted deck simply leaves it empty.
  const top = contentsOf(courtCards, CourtPile.deck())[0]
  if (top !== undefined) {
    courtCards = move(courtCards, top, CourtPile.slot(slot))
  } else {
    log.push('No cards left to refill the court')
  }

  const next: GameState = { ...state, figures, courtCards, log }
  // A Vox card fires as it is secured, then disposes of itself (rules/vox.ts). Guild cards
  // are simply kept.
  return {
    state: next,
    continue:
      card.kind === 'vox'
        ? C.then(VoxTrigger(faction, cardId, then))
        : C.then(then as Action),
  }
}

// --- guild alt actions -----------------------------------------------------

const PressgangOne = (
  faction: FactionId,
  resource: Resource,
  then: PipReturn,
): Action => ({ type: 'action/pressgang', faction, resource, then })
const ExecuteOne = (faction: FactionId, then: PipReturn): Action => ({
  type: 'action/execute',
  faction,
  then,
})

// --- the resource slots: arriving, rearranging, discarding --------------------

/*
 * "When you take or are given a resource you may rearrange any resources in your resource slots,
 * but you must discard resources you cannot hold."
 *
 * Both clauses, in one step. The old implementation had only the second, and justified skipping
 * the first by calling the slots interchangeable — which they are not. `CITY_SLOT_KEYS` is
 * `[3, 1, 1, 2, 1, 3]` and `offerRaid` enumerates one option **per occupied slot at that slot's
 * price**, so where a token sits decides how cheaply a rival can steal it. Arranging your board is
 * a real defensive decision, and it was being made for you by arrival order.
 *
 * Three situations reach this step, and they are the same screen:
 *
 *   1. **Something arrived with no room.** The token waits in `overflow:<faction>` and cannot stay
 *      there — either it displaces one of yours, or it goes.
 *   2. **Capacity shrank.** A building returning to its owner's reserve raises cities-in-reserve
 *      and lowers `slotCapacity`, so a token can end up in a slot that is no longer usable. It is
 *      "a resource you cannot hold" and must be moved or discarded.
 *   3. **You simply want to rearrange**, which the rule allows whenever a resource lands.
 *
 * The first two are forced — `arrange-done` is not offered until the board is legal. The third is
 * free, and is why `Done` exists at all.
 */

/** Every slot a faction owns, usable or not — the full row, which is what the screen draws. */
function allSlotsOf(state: GameState, faction: FactionId): LocationId[] {
  const all: LocationId[] = []
  for (let i = 0; i < CITY_SLOT_COUNT; i++) all.push(ResourceSlot.citySlot(faction, i))
  all.push(ResourceSlot.cardSlot(faction, ANCIENT_HOLDINGS))
  return all
}

/** Tokens sitting in a slot this faction can no longer use — "resources you cannot hold". */
function strandedTokens(state: GameState, faction: FactionId): string[] {
  const usable = slotsOf(state, faction)
  return allSlotsOf(state, faction)
    .filter((slot) => !usable.includes(slot))
    .flatMap((slot) => contentsOf(state.resources, slot))
}

/** Is the board legal to leave? Nothing waiting to land, nothing in a slot you cannot use. */
function slotsSettled(state: GameState, faction: FactionId): boolean {
  return (
    overflowTokens(state.resources, faction).length === 0 &&
    strandedTokens(state, faction).length === 0
  )
}

/**
 * Continue, unless the slots need attention — or a resource just landed and there is something
 * worth rearranging.
 *
 * Every path that can gain a resource ends through here, so the step cannot be honoured by one
 * caller and skipped by another. With a settled board and nothing to arrange it is exactly
 * `C.then(then)`.
 */
export function overflowThen(state: GameState, faction: FactionId, then: PipReturn): Continue {
  if (slotsSettled(state, faction)) return C.then(then as Action)
  return offerArrange(state, faction, then)
}

/** The optional entry: arrange the slots, then come back to whatever asked. */
export function arrangeThen(state: GameState, faction: FactionId, then: PipReturn): Continue {
  return offerArrange(state, faction, then)
}

/**
 * The slots as a board to be arranged, offered as the moves that arrangement is made of.
 *
 * One action per legal drop, which is what keeps this an ordinary enumerable ask rather than a
 * free-form payload the engine would have to validate: a drag is a `arrange-move`, and undo steps
 * back one drag. The screen renders exactly these and invents nothing.
 *
 *   - **move** a token into an **empty** slot;
 *   - **swap** two held tokens, by dropping one onto the other — free, nothing is lost;
 *   - **land** an arriving token onto an occupied slot, which **ejects** the occupant to the
 *     supply. This is the old overflow discard, expressed as the thing you physically do;
 *   - **discard** a token outright, which is how an arriving token is refused and how a stranded
 *     one is shed.
 */
/**
 * Repositioning moves allowed per arrange step, after which only settling moves and `Done` remain.
 *
 * Six, because the board has six city slots: any arrangement is reachable from any other well
 * inside that, so the cap cannot stop a player reaching the row they want. It exists to bound the
 * *cycle*, not to ration the decision — see `GameState.arrangeMoves` for why the cycle is unique to
 * this menu and why capping it here rather than teaching each bot to detect loops.
 */
export const ARRANGE_MOVE_CAP = 6

function offerArrange(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const usable = slotsOf(state, faction)
  const waiting = overflowTokens(state.resources, faction)
  const stranded = strandedTokens(state, faction)
  const held = heldTokens(state.resources, usable)
  const repositioned = state.arrangeMoves ?? 0
  const options: Action[] = []

  // Anything that is not already settled where it belongs may be picked up: the arrivals, the
  // stranded, and everything you are holding.
  const movable = [...waiting, ...stranded, ...held]

  for (const token of movable) {
    const from = state.resources.at.get(token)
    const r = parseResourceToken(token).resource
    for (const slot of usable) {
      if (slot === from) continue
      const occupant = contentsOf(state.resources, slot)[0]
      const arriving = from === undefined || !usable.includes(from)
      /*
       * Shuffling a token you already hold is optimisation, and the only move that can cycle. Once
       * the cap is reached it stops being offered — but an *arriving* token must always be able to
       * land, or a full row could never be settled and `Done` would never appear.
       */
      if (!arriving && repositioned >= ARRANGE_MOVE_CAP) continue
      if (occupant === undefined) {
        options.push({
          type: 'resources/arrange-move',
          faction,
          token,
          to: slot,
          then,
          label: `Put the ${r} in a ${slotKeys(slot)}-key slot`,
        })
      } else if (arriving) {
        // No room, so something has to go: the occupant is ejected as this one lands.
        options.push({
          type: 'resources/arrange-move',
          faction,
          token,
          to: slot,
          eject: occupant,
          then,
          label: `Land the ${r} here, discarding ${parseResourceToken(occupant).resource}`,
        })
      } else {
        options.push({
          type: 'resources/arrange-move',
          faction,
          token,
          to: slot,
          swap: occupant,
          then,
          label: `Swap the ${r} with ${parseResourceToken(occupant).resource}`,
        })
      }
    }
    options.push({
      type: 'resources/arrange-discard',
      faction,
      token,
      then,
      label: `Discard the ${r}`,
    })
  }

  if (slotsSettled(state, faction)) {
    options.push({ type: 'resources/arrange-done', faction, then, label: 'Done' })
  }

  const prompt =
    waiting.length > 0
      ? `${faction} has no room for a ${parseResourceToken(waiting[0]!).resource} — make room or let it go`
      : stranded.length > 0
        ? `${faction} can no longer hold every resource — discard down to ${usable.length}`
        : `${faction} — arrange your resource slots`
  return C.ask(faction, options, prompt)
}

function performArrangeMove(
  state: GameState,
  faction: FactionId,
  token: string,
  to: LocationId,
  eject: string | undefined,
  swap: string | undefined,
  then: PipReturn,
): RuleResult {
  const from = state.resources.at.get(token)
  let resources = state.resources
  const log = [...state.log]

  if (eject !== undefined) {
    resources = spendToken(resources, eject)
    log.push(`${faction} discarded ${parseResourceToken(eject).resource} (no room)`)
  } else if (swap !== undefined && from !== undefined) {
    // Both are the faction's own, so nothing is lost — they change places.
    resources = move(resources, swap, from)
  }
  resources = move(resources, token, to)
  log.push(
    swap === undefined
      ? `${faction} moved ${parseResourceToken(token).resource} into a ${slotKeys(to)}-key slot`
      : `${faction} swapped ${parseResourceToken(token).resource} with ` +
        `${parseResourceToken(swap).resource} (${slotKeys(to)}-key slot)`,
  )

  /*
   * Only repositioning counts against the cap. A move that lands an arriving token, ejects or
   * discards consumes one, so those already terminate; counting them could exhaust the budget
   * before the row is legal and leave no way to settle it.
   */
  const repositioning = eject === undefined && from !== undefined && slotsOf(state, faction).includes(from)
  const next: GameState = {
    ...state,
    resources,
    log,
    arrangeMoves: (state.arrangeMoves ?? 0) + (repositioning ? 1 : 0),
  }
  return { state: next, continue: offerArrange(next, faction, then) }
}

function performArrangeDiscard(
  state: GameState,
  faction: FactionId,
  token: string,
  then: PipReturn,
): RuleResult {
  const next: GameState = {
    ...state,
    resources: spendToken(state.resources, token),
    log: [...state.log, `${faction} discarded ${parseResourceToken(token).resource} (no room)`],
  }
  return { state: next, continue: offerArrange(next, faction, then) }
}

function performOverflowDiscard(
  state: GameState,
  faction: FactionId,
  token: string,
  keep: string | undefined,
  then: PipReturn,
): RuleResult {
  let resources = spendToken(state.resources, token)
  const log = [...state.log, `${faction} discarded ${parseResourceToken(token).resource} (no room)`]
  if (keep !== undefined) {
    // The discard freed a slot; the token that was waiting takes it.
    const open = openSlots(resources, slotsOf(state, faction))[0]
    if (open !== undefined) resources = move(resources, keep, open)
  }
  const next: GameState = { ...state, resources, log }
  // More than one may have arrived at once.
  return { state: next, continue: overflowThen(next, faction, then) }
}

function gaining(state: GameState, faction: FactionId, r: Resource, how: string): GameState {
  const { tracker, gained, overflowed } = gain(
    state.resources,
    slotsOf(state, faction),
    r,
    ResourceSlot.overflow(faction),
  )
  return {
    ...state,
    resources: tracker,
    log: [
      ...state.log,
      `${faction} ${how} ${r}${gained || overflowed ? '' : ' — none left in supply'}`,
    ],
  }
}

/**
 * Press Gang (Prison Wardens, on Build): return a captive to gain any one resource, as often
 * as you have captives (`game-guilds.scala:146-165`). HRF loops one captive at a time and so
 * does this, which is also why it needs no multi-select.
 *
 * The captive goes back to **its owner's** reserve, not the captor's — it was never the
 * captor's piece.
 */
function offerPressgang(state: GameState, faction: FactionId, then: PipReturn): Continue {
  if (captivesOf(state, faction).length === 0) return C.then(then as Action)
  const options: Action[] = RESOURCES.filter(
    (r) => contentsOf(state.resources, ResourceSlot.supply(r)).length > 0,
  ).map((r) => ({
    ...PressgangOne(faction, r, then),
    faction,
    label: `Return a captive → gain ${r}`,
  }))
  const done: Action = { type: 'action/skip', faction, then, label: 'Done' }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, done], `Press Gang — ${captivesOf(state, faction).length} captive(s)`)
}

function performPressgang(
  state: GameState,
  faction: FactionId,
  resource: Resource,
  then: PipReturn,
): RuleResult {
  const captive = captivesOf(state, faction)[0]
  if (captive === undefined) return { state, continue: C.then(then as Action) }
  const owner = parseFigureId(captive).color
  let next: GameState = {
    ...state,
    figures: move(state.figures, captive, Location.reserve(owner)),
  }
  next = gaining(next, faction, resource, `pressganged a ${owner} agent for`)
  // Loop back, exactly as PressgangMainAction does.
  return { state: next, continue: offerPressgang(next, faction, then) }
}

/**
 * Execute (Prison Wardens, on Influence): move captives to your trophies
 * (`game-guilds.scala:167-177`) — Tyrant points converted into Warlord points. Offered one at
 * a time; captives are interchangeable for both metrics, so which one is never a decision.
 */
function offerExecute(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const n = captivesOf(state, faction).length
  if (n === 0) return C.then(then as Action)
  const done: Action = { type: 'action/skip', faction, then, label: 'Done' }
  return C.ask(
    faction,
    [{ ...ExecuteOne(faction, then), faction, label: 'Execute a captive → trophy' }, done],
    `Execute — ${n} captive(s)`,
  )
}

function performExecute(state: GameState, faction: FactionId, then: PipReturn): RuleResult {
  const captive = captivesOf(state, faction)[0]
  if (captive === undefined) return { state, continue: C.then(then as Action) }
  const next: GameState = {
    ...state,
    figures: move(state.figures, captive, Location.trophies(faction)),
    log: [...state.log, `${faction} executed a captive (captive → trophy)`],
  }
  return { state: next, continue: offerExecute(next, faction, then) }
}

const AbductSlot = (faction: FactionId, slot: number, then: PipReturn): Action => ({
  type: 'action/abduct',
  faction,
  slot,
  then,
})
const TradeGive = (
  faction: FactionId,
  rival: FactionId,
  take: Resource,
  give: Resource,
  then: PipReturn,
): Action => ({ type: 'action/trade', faction, rival, take, give, then })

/**
 * Abduct (Court Enforcers, on Battle): take **every** rival agent off one court card into
 * your captives (`game-guilds.scala:190-200`). Only from cards held by fewer rivals than your
 * Weapon reach — a well-defended card is out of reach.
 */
function offerAbduct(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const slots = abductableSlots(state, faction)
  if (slots.length === 0) return C.then(then as Action)
  const options: Action[] = slots.map((n) => {
    const card = contentsOf(state.courtCards, CourtPile.slot(n))[0]
    const n_ = rivalAgentsOn(state, faction, n).length
    return {
      ...AbductSlot(faction, n, then),
      faction,
      label: `Abduct ${n_} agent(s) from ${card === undefined ? `slot ${n}` : courtCard(card).name}`,
    }
  })
  return C.ask(faction, [...options, skip(faction, then)], `Abduct (reach ${weaponReach(state, faction)})`)
}

function performAbduct(
  state: GameState,
  faction: FactionId,
  slot: number,
  then: PipReturn,
): RuleResult {
  let figures = state.figures
  const taken = rivalAgentsOn(state, faction, slot)
  for (const id of taken) figures = move(figures, id, Location.captives(faction))
  const card = contentsOf(state.courtCards, CourtPile.slot(slot))[0]
  return {
    state: {
      ...state,
      figures,
      log: [
        ...state.log,
        `${faction} abducted ${taken.length} agent(s) from ${
          card === undefined ? `slot ${slot}` : courtCard(card).name
        }`,
      ],
    },
    continue: C.then(then as Action),
  }
}

/**
 * Trade (Elder Broker, on Tax): take the planet's resource off a rival whose city stands in a
 * system you rule, and hand back a type they do not have
 * (`game-guilds.scala:274-297`). A swap, not a theft — which is why the give-back leg is a
 * second decision rather than an afterthought.
 */
function offerTrade(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const t of tradeTargets(state, faction)) {
    for (const give of tradeGiveOptions(state, faction, t.rival)) {
      options.push({
        ...TradeGive(faction, t.rival, t.take, give, then),
        faction,
        label: `Take ${t.take} from ${t.rival} (${t.system}), give ${give}`,
      })
    }
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, skip(faction, then)], 'Trade')
}

function performTrade(
  state: GameState,
  faction: FactionId,
  rival: FactionId,
  take: Resource,
  give: Resource,
  then: PipReturn,
): RuleResult {
  const rivalSlots = slotsOf(state, rival)
  const takeToken = heldTokens(state.resources, rivalSlots).find(
    (id) => parseResourceToken(id).resource === take,
  )
  const giveToken = heldTokens(state.resources, slotsOf(state, faction)).find(
    (id) => parseResourceToken(id).resource === give,
  )
  if (takeToken === undefined || giveToken === undefined) {
    return { state, continue: C.then(then as Action) }
  }

  // Free both slots before refilling, so a full board can still swap.
  let resources = spendToken(state.resources, takeToken)
  resources = spendToken(resources, giveToken)
  const mine = gain(resources, slotsOf(state, faction), take, ResourceSlot.overflow(faction))
  resources = mine.tracker
  const theirs = gain(resources, rivalSlots, give, ResourceSlot.overflow(rival))
  resources = theirs.tracker
  const next: GameState = {
    ...state,
    resources,
    log: [...state.log, `${faction} traded ${give} to ${rival} for ${take}`],
  }

  return {
    state: next,
    // Both sides can be over capacity after a swap; each resolves its own before play continues.
    continue: overflowThen(next, faction, {
      type: 'action/overflow-check',
      faction: rival,
      then,
    }),
  }
}

/** Route an alt to its flow. One case per registry entry. */
/**
 * Prune (Living Structures, lore10): "Replace a Loyal starport with a Loyal city or vice versa."
 *
 * A swap, not a build: the standing building goes back to reserve and its opposite comes out, so
 * it needs one of the *other* kind in reserve to be possible. Offered per building, since which
 * one you convert is the whole decision.
 */
function offerPrune(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const id of prunable(state, faction)) {
    const from = parseFigureId(id).piece
    const to: Piece = from === 'City' ? 'Starport' : 'City'
    if (reservePiece(state, faction, to) === undefined) continue
    const where = state.figures.at.get(id)
    options.push({
      type: 'action/lore-prune',
      faction,
      figure: id,
      to,
      then,
      label: `Prune ${from} to ${to}${where === undefined ? '' : ` in ${where.replace('system:', '')}`}`,
    })
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, skip(faction, then)], 'Prune')
}

function performPrune(
  state: GameState,
  faction: FactionId,
  figure: string,
  to: Piece,
  then: PipReturn,
): RuleResult {
  const replacement = reservePiece(state, faction, to)
  const where = state.figures.at.get(figure)
  if (replacement === undefined || where === undefined) {
    return { state, continue: C.then(then as Action) }
  }
  // The old building goes home first, so its slot is free for the one replacing it.
  let figures = move(state.figures, figure, Location.reserve(faction))
  figures = move(figures, replacement, where)
  return {
    state: {
      ...state,
      figures,
      // A pruned building is a new one: whatever the old one had done this turn does not carry,
      // and a pruned Cloud City stops being one — the replacement takes an ordinary slot.
      damaged: state.damaged.filter((id) => id !== figure),
      unslotted: state.unslotted.filter((id) => id !== figure),
      log: [
        ...state.log,
        `${faction} pruned a ${parseFigureId(figure).piece} into a ${to} (Living Structures)`,
      ],
    },
    continue: C.then(then as Action),
  }
}

function offerGuildAlt(
  state: GameState,
  faction: FactionId,
  alt: string,
  then: PipReturn,
): RuleResult {
  switch (guildAlt(alt).id) {
    case 'manufacture': {
      const next = gaining(state, faction, 'Material', 'manufactured')
      return { state: next, continue: overflowThen(next, faction, then) }
    }
    case 'synthesize': {
      const next = gaining(state, faction, 'Fuel', 'synthesized')
      return { state: next, continue: overflowThen(next, faction, then) }
    }
    case 'pressgang':
      return { state, continue: offerPressgang(state, faction, then) }
    case 'execute':
      return { state, continue: offerExecute(state, faction, then) }
    case 'abduct':
      return { state, continue: offerAbduct(state, faction, then) }
    case 'trade':
      return { state, continue: offerTrade(state, faction, then) }
    // Living Structures (lore10). Nurture is simply a Tax bought with a Build pip, so it reuses
    // the Tax offer rather than restating which cities are taxable.
    case 'nurture':
      return { state, continue: offerTax(state, faction, then) }
    case 'prune':
      return { state, continue: offerPrune(state, faction, then) }
    // Force Beams (lore16) and Survival Overrides (lore18). Both are Move alts and neither is a
    // move: see their own flows below for what that costs them.
    case 'guide':
      return { state, continue: offerGuide(state, faction, then) }
    case 'martyr':
      return { state, continue: offerMartyr(state, faction, then) }
    // Galactic Rifles (lore02). The flow lives in the battle module, which owns the dice and the
    // hit assignment it borrows.
    case 'rifles':
      return { state, continue: C.then({ type: 'rifles/from', faction, then }) }
    default:
      return { state, continue: C.then(then as Action) }
  }
}

/** What taking `which` opens up. One place, so the guard below cannot drift from the flow. */
export function offerFor(
  state: GameState,
  faction: FactionId,
  which: StandardAction,
  then: PipReturn,
): Continue {
  switch (which) {
    case 'Move':
      return offerMove(state, faction, then)
    case 'Tax':
      return offerTax(state, faction, then)
    case 'Build':
      return offerBuild(state, faction, then)
    case 'Repair':
      return offerRepair(state, faction, then)
    case 'Battle': {
      // Battle needs no menu of its own; a guild alt on it is the only thing that adds one.
      const alts = withAlts(state, faction, 'Battle', then, [])
      if (alts.length === 0) return C.then(DeclareBattle(faction, then))
      const declare: Action = { ...DeclareBattle(faction, then), faction, label: 'Battle' }
      return C.ask(faction, [declare, ...alts], 'Battle')
    }
    case 'Influence':
      return offerInfluence(state, faction, then)
    case 'Secure':
      return offerSecure(state, faction, then)
    default:
      // All seven standard actions are handled above. A new one reaching here is a bug in
      // the suit map, not a rule to skip quietly.
      throw new Error(`no handler for standard action: ${String(which)}`)
  }
}

/**
 * Whether taking `which` could actually do anything.
 *
 * Without this a pip is spent on Repair with nothing damaged, or Tax with no untaxed city,
 * and simply vanishes — the action falls straight through to the next pip. HRF disables such
 * options with a printed reason; we keep them off the menu entirely, which needs no new
 * concept in the `Ask` model.
 *
 * It is answered by *building the real offer* rather than by a second set of predicates, so
 * the guard cannot disagree with what the action would go on to do. The only special case is
 * Battle, whose offer is a hand-off rather than a menu.
 */
export function canTake(
  state: GameState,
  faction: FactionId,
  which: StandardAction,
  then: PipReturn,
): boolean {
  if (which === 'Battle') {
    return canBattle(state, faction) || altsFor(state, faction, 'Battle').length > 0
  }
  const offer = offerFor(state, faction, which, then)
  // A `then` means the offer had nothing to show and handed the turn straight on.
  if (offer.kind !== 'ask') return false
  // Influence and Secure still ask when empty, to explain why; a menu of only escapes counts
  // as nothing to do.
  return offer.actions.some((a) => a.type !== 'action/skip')
}

// --- dispatch --------------------------------------------------------------

export const StandardActionsModule: RuleModule = {
  id: 'standard-actions',
  perform(state: GameState, action: Action): RuleResult {
    switch (action.type) {
      case 'action/take': {
        const faction = action['faction'] as FactionId
        const which = action['action'] as StandardAction
        const then = action['then'] as PipReturn
        return { state, continue: offerFor(state, faction, which, then) }
      }
      case 'action/move-pick':
        return {
          state,
          continue: offerFleetSize(
            state,
            action['faction'] as FactionId,
            action['from'] as SystemId,
            action['to'] as SystemId,
            action['then'] as PipReturn,
          ),
        }
      case 'action/move-ships':
        return performMoveShips(
          state,
          action['faction'] as FactionId,
          action['from'] as SystemId,
          action['to'] as SystemId,
          action['count'] as number,
          action['then'] as PipReturn,
        )
      case 'action/move-more':
        return performMoveMore(
          state,
          action['faction'] as FactionId,
          action['to'] as SystemId,
          action['group'] as readonly string[],
          action['then'] as PipReturn,
        )
      case 'action/move-more-go':
        return performMoveMoreGo(
          state,
          action['faction'] as FactionId,
          action['to'] as SystemId,
          action['group'] as readonly string[],
          action['count'] as number,
          action['then'] as PipReturn,
        )
      case 'action/tax-city':
        return performTaxCity(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['then'] as PipReturn,
          action['city'] as string,
          action['resource'] as Resource | undefined,
        )
      case 'action/build':
        return performBuild(
          state,
          action['faction'] as FactionId,
          action['piece'] as Piece,
          action['system'] as SystemId,
          action['then'] as PipReturn,
          action['starport'] as string | undefined,
          action['cloud'] as boolean | undefined,
          action['pay'] as Resource | undefined,
          action['annex'] as string | undefined,
        )
      case 'action/lore-sprint':
        return performSprint(
          state,
          action['faction'] as FactionId,
          action['from'] as SystemId,
          action['to'] as SystemId,
          action['ships'] as readonly string[],
          (action['rest'] as readonly string[]) ?? [],
          action['then'] as PipReturn,
        )
      case 'action/lore-sprint-stop':
        return {
          state: action['spent'] === true ? spendSprint(state) : state,
          continue: C.then(action['then'] as Action),
        }
      case 'action/lore-prune':
        return performPrune(
          state,
          action['faction'] as FactionId,
          action['figure'] as string,
          action['to'] as Piece,
          action['then'] as PipReturn,
        )
      case 'action/guide-pick':
        return {
          state,
          continue: offerGuideMore(
            state,
            action['faction'] as FactionId,
            action['from'] as SystemId,
            action['to'] as SystemId,
            action['then'] as PipReturn,
          ),
        }
      case 'action/guide-move':
        return performGuide(
          state,
          action['faction'] as FactionId,
          action['from'] as SystemId,
          action['to'] as SystemId,
          action['color'] as string,
          action['count'] as number,
          action['then'] as PipReturn,
        )
      case 'action/martyr':
        return performMartyr(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['martyr'] as string,
          action['victim'] as string,
          action['then'] as PipReturn,
        )
      case 'action/guild-alt':
        return offerGuildAlt(
          state,
          action['faction'] as FactionId,
          action['alt'] as string,
          action['then'] as PipReturn,
        )
      case 'action/abduct':
        return performAbduct(
          state,
          action['faction'] as FactionId,
          action['slot'] as number,
          action['then'] as PipReturn,
        )
      case 'action/trade':
        return performTrade(
          state,
          action['faction'] as FactionId,
          action['rival'] as FactionId,
          action['take'] as Resource,
          action['give'] as Resource,
          action['then'] as PipReturn,
        )
      case 'action/pressgang':
        return performPressgang(
          state,
          action['faction'] as FactionId,
          action['resource'] as Resource,
          action['then'] as PipReturn,
        )
      case 'action/execute':
        return performExecute(
          state,
          action['faction'] as FactionId,
          action['then'] as PipReturn,
        )
      case 'leaders/ruthless':
        return {
          state,
          continue: offerRuthless(
            state,
            action['faction'] as FactionId,
            action['system'] as SystemId,
            action['building'] as string,
            action['kind'] as 'tax' | 'build',
            action['then'] as PipReturn,
            action['resource'] as Resource | undefined,
          ),
        }
      case 'leaders/ruthless-hit':
        return performRuthlessHit(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['building'] as string,
          action['kind'] as 'tax' | 'build',
          action['then'] as PipReturn,
          action['resource'] as Resource | undefined,
        )
      case 'leaders/ruthless-again':
        return performRuthlessAgain(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['building'] as string,
          action['kind'] as 'tax' | 'build',
          action['then'] as PipReturn,
          action['resource'] as Resource | undefined,
        )
      case 'leaders/mythic':
        return {
          state,
          continue: offerMythic(
            state,
            action['faction'] as FactionId,
            action['system'] as SystemId,
            action['city'] as string,
            action['then'] as PipReturn,
          ),
        }
      case 'leaders/mythic-place':
        return performMythicPlace(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['token'] as string,
          action['then'] as PipReturn,
        )
      case 'action/influence':
        return performInfluence(
          state,
          action['faction'] as FactionId,
          action['slot'] as number,
          action['then'] as PipReturn,
          action['again'] as boolean | undefined,
        )
      // Ransack takes a court card by force after a razed city; the battle module offers it, but
      // securing lives here, so the action is handled here and the import stays one-directional.
      case 'action/overflow-check':
        return {
          state,
          continue: overflowThen(
            state,
            action['faction'] as FactionId,
            action['then'] as PipReturn,
          ),
        }
      case 'resources/arrange-move':
        return performArrangeMove(
          state,
          action['faction'] as FactionId,
          action['token'] as string,
          action['to'] as LocationId,
          action['eject'] as string | undefined,
          action['swap'] as string | undefined,
          action['then'] as PipReturn,
        )
      case 'resources/arrange-discard':
        return performArrangeDiscard(
          state,
          action['faction'] as FactionId,
          action['token'] as string,
          action['then'] as PipReturn,
        )
      case 'resources/arrange-done':
        // The step is over, so the repositioning budget resets for the next one.
        return { state: { ...state, arrangeMoves: 0 }, continue: C.then(action['then'] as Action) }
      /*
       * No longer offered — the arrange step above replaced it. Still handled, because journals
       * recorded before that change contain it and a save is only a journal: dropping the case
       * would make every one of them fail to replay.
       */
      case 'action/overflow-discard':
        return performOverflowDiscard(
          state,
          action['faction'] as FactionId,
          action['token'] as string,
          action['keep'] as string | undefined,
          action['then'] as PipReturn,
        )
      case 'action/ransack':
        return performSecure(
          state,
          action['faction'] as FactionId,
          action['slot'] as number,
          action['then'] as PipReturn,
          true,
        )
      case 'action/secure':
        return performSecure(
          state,
          action['faction'] as FactionId,
          action['slot'] as number,
          action['then'] as PipReturn,
        )
      case 'action/repair':
        return performRepair(
          state,
          action['faction'] as FactionId,
          action['figure'] as string,
          action['then'] as PipReturn,
        )
      case 'action/skip':
        return { state, continue: C.then(action['then'] as Action) }
      default:
        return unhandled(state)
    }
  },
}
