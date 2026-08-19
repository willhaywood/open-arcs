/**
 * Battle. The largest single rule in Arcs (747 lines in haunt-roll-fail); this is a
 * faithful base-game core. Dice faces are confirmed identical between HRF and the TTS mod
 * (see dice.ts). Flow and resolution follow HRF's game-battle.scala. See docs/09-battle.md.
 *
 * Sequence:
 *   declare  — pick a system where you have ships and an enemy is present
 *   target   — pick the enemy color
 *   gather   — choose a dice pool (skirmish/assault/raid), total <= your ships
 *   roll     — roll via the seeded RNG in state
 *   assign   — the attacker places each hit on a piece, one at a time
 *
 * Resolution:
 *   self hits (OwnDamage) + interception (if any intercept rolled, the defender's fresh
 *     ship count) are placed by the attacker on their own ships;
 *   ship hits are placed on enemy ships, overflowing to buildings once no enemy ship remains;
 *   building hits are placed on enemy buildings;
 *   destroyed enemy pieces become the attacker's trophies, and destroyed attacking ships
 *     become the *defender's* — both directions, rulebook p14 (this is how Warlord scores);
 *   raid keys steal resources from the enemy;
 *   razing a City outrages the *attacker* for that world's resource (see outrage.ts).
 *
 * Hit allocation is player-directed, matching HRF's AssignHitsAction (game-battle.scala:474):
 * the attacker chooses which of their own and the enemy's pieces each hit lands on, within
 * each phase. Still deferred and flagged in docs/09: reroll effects, allies, flagships and
 * agent capture are not modelled.
 */

import type { Action } from '../action.js'
import { rerollAt, rollPoolDetailed, tallyOf } from '../dice.js'
import type { DieRoll } from '../dice.js'
import type { Continue } from '../continue.js'
import { Continue as C } from '../continue.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { Location, parseFigureId } from '../ids.js'
import type { ColorId, FactionId, SystemId } from '../ids.js'
import { weaponReach } from '../guild-actions.js'
import { hasTrait } from '../leaders.js'
import {
  EMPATHS_VISION,
  HIDDEN_HARBORS,
  KEEPERS_SOLIDARITY,
  KEEPERS_TRUST,
  MIRROR_PLATING,
  PREDICTIVE_SENSORS,
  RAIDER_EXOSUITS,
  RAILGUN_ARRAYS,
  SEEKER_TORPEDOES,
  REPAIR_DRONES,
  SIGNAL_BREAKER,
  hasLore,
  loreActive,
} from '../lore.js'
import { asResource, provokeOutrage } from '../outrage.js'
import {
  RESOURCES,
  ResourceSlot,
  countResource,
  slotKeys,
  slotCapacity,
  openSlots,
  parseResourceToken,
  spendToken,
} from '../resources.js'
import { system as systemInfo } from '../board.js'
import {
  citiesInReserve,
  connectedSystems,
  gateCityTypes,
  planetResource,
  rules,
  slotsOf,
} from '../control.js'
import {
  CourtPile,
  SKIRMISHERS,
  SWORN_GUARDIANS,
  courtCard,
  courtSlots,
  GATEKEEPERS,
  hasGuild,
  securedCards,
} from '../court.js'
import type { Resource } from '../resources.js'
import type { GameState } from '../state.js'
import type { PipReturn } from './standard-actions.js'
import { contentsOf, move } from '../tracker.js'

// --- action constructors ---------------------------------------------------

export const DeclareBattle = (faction: FactionId, then: PipReturn): Action => ({
  type: 'battle/declare',
  faction,
  then,
})
const TargetBattle = (
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  then: PipReturn,
): Action => ({ type: 'battle/target', faction, system, enemy, then })
const RollBattle = (
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  skirmish: number,
  assault: number,
  raid: number,
  then: PipReturn,
): Action => ({ type: 'battle/roll', faction, system, enemy, skirmish, assault, raid, then })

// --- helpers ---------------------------------------------------------------

const isShip = (piece: string) => piece === 'Ship'
const isBuilding = (piece: string) => piece === 'City' || piece === 'Starport'

/**
 * The parts of the state these three read: the map and the pieces on it, both public.
 *
 * Widened from `GameState` so `canBattle` can also be asked of an `ObservedState` — the AI's
 * evaluator needs "is there a battle to be had", and it must read *this* rather than keep a copy,
 * because this is the same predicate `canTake` uses to decide whether Battle reaches the pip menu.
 * A valuation that prices an option the engine would not offer is worse than no valuation.
 */
type Battlefield = Pick<GameState, 'board' | 'figures'>

function piecesAt(state: Battlefield, s: SystemId, color: ColorId, kind: (p: string) => boolean) {
  return contentsOf(state.figures, Location.system(s)).filter((id) => {
    const f = parseFigureId(id)
    return f.color === color && kind(f.piece)
  })
}

/**
 * The chance a dice pool triggers interception, and how many hits it would cost if it does.
 *
 * **Why this is computed rather than sampled.** Interception fires when *any* intercept face is
 * rolled, and it then hits the attacker once per fresh defending ship — so it is a tail event with
 * a large, position-dependent magnitude. `SAMPLES` in `play.ts` is 5, and five rolls of a single
 * assault die show no intercept at all 40% of the time, so the bot was choosing pools on estimates
 * that mostly had not seen the thing that makes them expensive.
 *
 * Face counts are the rules fact, and they live here beside the roll tables they come from
 * (docs/09 section 1): **assault** carries an intercept on 1 face of 6, **raid** on 2 of 6, and
 * **skirmish** on none — which is the whole reason skirmish is the safe die.
 *
 * The pricing of the risk is deliberately *not* here. This returns what the rules say; what a hit
 * is worth is the evaluator's business (`heuristic.ts`).
 */
export function interceptionRisk(
  state: Battlefield & { readonly damaged: readonly string[] },
  system: SystemId,
  enemy: ColorId,
  assault: number,
  raid: number,
): { readonly chance: number; readonly hits: number } {
  const chance = 1 - (5 / 6) ** assault * (4 / 6) ** raid
  const hits = piecesAt(state, system, enemy, isShip).filter(
    (id) => !state.damaged.includes(id),
  ).length
  return { chance, hits }
}

function enemiesAt(state: Battlefield, s: SystemId, self: FactionId): ColorId[] {
  const colors = new Set<ColorId>()
  for (const id of contentsOf(state.figures, Location.system(s))) {
    const f = parseFigureId(id)
    if (f.color !== self) colors.add(f.color)
  }
  return [...colors]
}

// --- declare / target / gather ---------------------------------------------

/**
 * Is there any battle to declare? Used to keep Battle off the pip menu when it could only
 * burn the pip — see `canTake` in standard-actions.ts.
 */
export function canBattle(state: Battlefield, faction: FactionId): boolean {
  return state.board.systems.some(
    (s) =>
      piecesAt(state, s, faction, isShip).length > 0 && enemiesAt(state, s, faction).length > 0,
  )
}

function offerDeclare(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = []
  for (const s of state.board.systems) {
    if (piecesAt(state, s, faction, isShip).length === 0) continue
    if (enemiesAt(state, s, faction).length === 0) continue
    options.push({ type: 'battle/system', faction, system: s, then, label: `Battle in ${s}` })
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, cancel(faction, then)], 'Battle — choose a system')
}

function offerTarget(state: GameState, faction: FactionId, system: SystemId, then: PipReturn): Continue {
  const enemies = enemiesAt(state, system, faction)
  if (enemies.length === 1) {
    return openBattle(state, faction, system, enemies[0]!, then)
  }
  const options: Action[] = enemies.map((e) => ({
    ...TargetBattle(faction, system, e, then),
    faction,
    label: `Attack ${e}`,
  }))
  return C.ask(faction, [...options, cancel(faction, then)], `Battle in ${system} — choose a target`)
}

/**
 * Railgun Arrays (lore12): "When defending in battle, before the attacker collects dice, they
 * must take 1 hit if any Loyal defending ships are fresh."
 *
 * **Before** matters and is the whole reason this is not folded into the roll: the hit can
 * destroy an attacking ship, and the dice pool is capped by the ships that are still there when
 * it is collected. Landing it afterwards would let the attacker roll dice for a ship the volley
 * had already killed.
 *
 * The attacker chooses which of their ships takes it, so it runs through the same assignment the
 * battle proper uses — HRF does the identical thing, an `AssignHitsAction` for one self-hit
 * spliced ahead of `BattleStartAction` (game-battle.scala:139). `railgun: true` on the context
 * is what tells `performFinish` this is the pre-battle volley and that it should open the dice
 * menu rather than close a battle that has not happened yet.
 */
/**
 * The fresh Loyal ships Predictive Sensors could pull into `system`, by the system they stand in.
 *
 * Empty unless the defender holds the card, so the caller can use it as the gate as well as the
 * list. "Loyal" is your own colour and "fresh" is undamaged, the same two words every other lore
 * card uses.
 */
function sensorSources(
  state: GameState,
  defender: FactionId,
  system: SystemId,
): { from: SystemId; ships: string[] }[] {
  if (!hasLore(state, defender, PREDICTIVE_SENSORS)) return []
  const out: { from: SystemId; ships: string[] }[] = []
  for (const from of connectedSystems(state.board, system)) {
    const ships = contentsOf(state.figures, Location.system(from)).filter((id) => {
      const f = parseFigureId(id)
      return f.color === defender && f.piece === 'Ship' && !state.damaged.includes(id)
    })
    if (ships.length > 0) out.push({ from, ships })
  }
  return out
}

/**
 * Ask the defender which neighbours send ships. A loop, because "any number ... from systems"
 * plural means several neighbours may each contribute, and each answer changes what is left.
 */
function offerSensors(
  state: GameState,
  defender: FactionId,
  system: SystemId,
  enemy: ColorId,
  attacker: FactionId,
  then: PipReturn,
): Continue {
  const sources = sensorSources(state, defender, system)
  // Done, by exhaustion or by choice: hand the battle back to where it would have started.
  const done: Action = {
    type: 'battle/sensors-done',
    faction: defender,
    system,
    enemy,
    attacker,
    then,
    label: 'Bring in no more ships',
  }
  if (sources.length === 0) return C.then(done)

  const options: Action[] = []
  for (const { from, ships } of sources) {
    for (let n = ships.length; n >= 1; n--) {
      options.push({
        type: 'battle/sensors-pull',
        faction: defender,
        system,
        enemy,
        attacker,
        from,
        count: n,
        then,
        label: `Bring ${n} fresh ship${n === 1 ? '' : 's'} from ${from}`,
      })
    }
  }
  return C.ask(
    defender,
    [...options, done],
    `${defender} — Predictive Sensors: reinforce ${system} before ${attacker} collects dice`,
  )
}

function performSensorsPull(
  state: GameState,
  defender: FactionId,
  system: SystemId,
  enemy: ColorId,
  attacker: FactionId,
  from: SystemId,
  count: number,
  then: PipReturn,
): RuleResult {
  const ships = (sensorSources(state, defender, system).find((s) => s.from === from)?.ships ??
    []).slice(0, count)
  if (ships.length === 0) {
    return { state, continue: offerSensors(state, defender, system, enemy, attacker, then) }
  }
  let figures = state.figures
  for (const id of ships) figures = move(figures, id, Location.system(system))
  const next: GameState = {
    ...state,
    figures,
    log: [
      ...state.log,
      `${defender} pulled ${ships.length} ship${ships.length === 1 ? '' : 's'} ${from} → ${system} (Predictive Sensors)`,
    ],
  }
  return { state: next, continue: offerSensors(next, defender, system, enemy, attacker, then) }
}

function openBattle(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  then: PipReturn,
): Continue {
  const defender = defendingFaction(state, enemy)

  /*
   * Predictive Sensors (lore15): "When defending in battle, before the attacker collects dice, you
   * may move any number of fresh Loyal ships from systems adjacent to the battle system into it."
   *
   * The defender's, and asked *before* Railgun Arrays as well as before the dice — "before the
   * attacker collects dice" is the whole window, and reinforcements that arrive should be standing
   * there for everything that follows. It matters: the dice pool is capped by the attacker's
   * ships, not the defender's, but the ships pulled in are what the attacker's hits land on.
   *
   * It is not a move. Nothing that triggers on moving runs — no catapult, no Sprinter Drives, no
   * Gate Ports toll — because the card grants a repositioning inside a battle, not a Move action.
   */
  if (defender !== undefined && sensorSources(state, defender, system).length > 0) {
    return C.then({
      type: 'battle/sensors',
      faction: defender,
      system,
      enemy,
      attacker: faction,
      then,
    })
  }
  return openBattleArmed(state, faction, system, enemy, then)
}

/**
 * The battle from Railgun Arrays onwards — everything after the Predictive Sensors window.
 *
 * Split out so the resume path cannot re-enter that window: `openBattle` offers the sensors while
 * ships remain to pull, and coming back through here instead is what ends it. Re-entering
 * `openBattle` would offer them again on every decline, forever.
 */
function openBattleArmed(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  then: PipReturn,
): Continue {
  const defender = defendingFaction(state, enemy)
  const armed =
    defender !== undefined &&
    hasLore(state, defender, RAILGUN_ARRAYS) &&
    piecesAt(state, system, enemy, isShip).some((id) => !state.damaged.includes(id))
  if (!armed) return offerGather(state, faction, system, enemy, then)

  // Nothing of the attacker's to hit: the volley simply has no target.
  if (standing(state, system, faction, isShip).length === 0) {
    return offerGather(state, faction, system, enemy, then)
  }

  const ctx: Resolve = {
    faction,
    system,
    enemy,
    self: 1,
    intercepted: 0,
    ships: 0,
    buildings: 0,
    keys: 0,
    razed: false,
    railgun: true,
    then,
  }
  return C.log(
    `${enemy} opens with Railgun Arrays — ${faction} takes a hit before collecting dice`,
    offerAssign(state, ctx),
  )
}

/**
 * Enumerate legal dice pools: total <= attacker ships in the system, at most six of each
 * die type, and raid dice only when the enemy has buildings (HRF's freeRaid). Matches the
 * combination enumeration in game-battle.scala:194.
 */
function offerGather(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  then: PipReturn,
): Continue {
  const ships = piecesAt(state, system, faction, isShip).length
  // Committed (Rebel) raises the *limit*, not the fleet: HRF adds it to the same total the
  // ships feed (game-battle.scala:148), so you may roll two dice more than you have ships.
  const committed = hasTrait(state, faction, 'Committed') ? 2 : 0
  /*
   * Gatekeepers (bc08): "When you battle in a gate, you may collect 2 more dice." The same
   * shape as Committed — a raise to the limit, not the fleet — gated on the battle system being
   * a gate. Found by the court audit (docs/20 A1): only the card's Prelude clause was
   * implemented, so a held Gatekeepers never changed a single battle.
   */
  const gatekept =
    systemInfo(system).isGate && hasGuild(state, faction, GATEKEEPERS) ? 2 : 0
  const maxDice = Math.min(ships + committed + gatekept, 18)
  const enemyBuildings = piecesAt(state, system, enemy, isBuilding).length > 0
  // Hidden Harbors (lore05) shuts the raid dice off entirely while the defender still has an
  // undamaged starport here (game-battle.scala:159). Buildings alone are no longer enough.
  const harbored = defenderHasFreshStarport(state, system, enemy)
  /*
   * Raider Exosuits (lore17): "When attacking in battle, if there are no defending buildings, you
   * may collect up to 1 raid die. (This is not an extra die. Follow the limit of 1 die per ship.)"
   *
   * It opens the *one* case the base rule closes — no buildings at all — and leaves the ordinary
   * "buildings present" case alone at six. The parenthetical needs no code: `total` already bounds
   * every pool by the fleet, so a raid die taken here displaces a skirmish or assault die rather
   * than adding to the count.
   *
   * `harbored` cannot collide with it. Hidden Harbors needs a fresh defending *starport*, which is
   * a building, so the two conditions are mutually exclusive by construction.
   */
  const exosuits = !enemyBuildings && hasLore(state, faction, RAIDER_EXOSUITS) ? 1 : 0
  /*
   * The raid limit's second opening — rulebook 7.6 step 3: "You can only collect raid dice if
   * there are defending buildings **or if the defender has no Loyal buildings in any systems on
   * the map**." A homeless defender is raidable everywhere (docs/21 A3) — the rule the
   * Anarchist's own card reminds players of, and an Anarchist *starts* with no buildings. HRF:
   * game-battle.scala:177. Hidden Harbors cannot collide: its shield needs a fresh defending
   * starport, which is a building.
   */
  const defenderFaction = defendingFaction(state, enemy)
  const homeless =
    defenderFaction !== undefined &&
    state.board.systems.every(
      (s) => piecesAt(state, s, defenderFaction, isBuilding).length === 0,
    )
  const maxRaid = (enemyBuildings && !harbored) || homeless ? 6 : exosuits
  const wary = hasTrait(state, faction, 'Wary')

  /*
   * **Enumerated largest-first, and that ordering is load-bearing.**
   *
   * Every tie-break downstream takes the earliest candidate — `heuristicBot` keeps the first of
   * equal scores, and the beam's prune keeps offer order on equal lines — so whichever pool this
   * loop emits first wins every tie. Ascending order therefore made "one skirmish die" the default
   * answer whenever scoring could not separate the options, and measurement found the bot leaving
   * dice unused in 20% of battles, 2.03 on average, with a third of those cases exact ties.
   *
   * Descending puts the full fleet first, and the inner loops start at 0 raid and 0 assault, so the
   * very first option is the whole fleet in skirmish dice: the maximum damage that carries no
   * self-hit and no intercept face. That is the right default for a human reading the menu as well.
   */
  const options: Action[] = []
  for (let total = maxDice; total >= 1; total--) {
    for (let raid = 0; raid <= Math.min(maxRaid, total, 6); raid++) {
      for (let assault = 0; assault <= Math.min(6, total - raid); assault++) {
        const skirmish = total - raid - assault
        if (skirmish < 0 || skirmish > 6) continue
        // Wary (Corsair, leader11): "When attacking in battle, you cannot collect more assault
        // dice than skirmish dice." A pool is simply never offered, rather than being offered and
        // refused — the same way every other restriction on this menu works.
        if (wary && assault > skirmish) continue
        options.push({
          ...RollBattle(faction, system, enemy, skirmish, assault, raid, then),
          faction,
          label: `Roll ${skirmish}S ${assault}A ${raid}R`,
        })
      }
    }
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, cancel(faction, then)], `Battle ${enemy} in ${system} — choose dice`)
}

// --- roll & assign ---------------------------------------------------------

/**
 * The state a battle carries through hit assignment, journal-safe (plain values only). Each
 * count is what still has to be *assigned*; the pieces are chosen one hit at a time.
 */
interface Resolve {
  faction: FactionId
  system: SystemId
  enemy: ColorId
  /** Hits the attacker must place on their **own** ships (self-damage + interception). */
  self: number
  /**
   * How much of the original `self` came from interception rather than self-damage faces. Kept
   * only so the UI can explain a Self count that is larger than the flames showing on the dice;
   * no rule reads it.
   */
  intercepted: number
  /** Hits on enemy ships; when the ships run out these overflow to buildings. */
  ships: number
  /** Hits on enemy buildings. */
  buildings: number
  keys: number
  /**
   * The faces this battle rolled. Kept only so the raid screen can show the player the very dice
   * that earned the keys they are spending, rather than a stand-in token; no rule reads it.
   * Absent on a context built by a test or by a volley that did not roll.
   */
  dice?: readonly DieRoll[]
  /** A City has been razed, so the attacker will be outraged when the battle finishes. */
  razed: boolean
  /** The attacker destroyed something of the enemy's, which is what Beloved keys off. */
  tookTrophies?: boolean
  /**
   * Set for a Galactic Rifles volley, which mimics a battle but is not one — no post-battle
   * effects run off it.
   */
  rifles?: boolean
  /**
   * Set only for the Railgun Arrays volley that precedes a battle. It carries no damage beyond
   * its single hit, and finishing it opens the dice menu rather than closing a battle that has
   * not been fought yet.
   */
  railgun?: boolean
  then: PipReturn
}

const Finish = (ctx: Resolve): Action => ({ type: 'battle/finish', ctx })
const Hit = (ctx: Resolve, phase: 'self' | 'ships' | 'buildings', target: string): Action => ({
  type: 'battle/hit',
  ctx,
  phase,
  target,
})

/** A defending faction, or undefined when the defender is not one (the Empire, or free pieces). */
function defendingFaction(state: GameState, enemy: ColorId): FactionId | undefined {
  return state.factions.find((f) => f === (enemy as FactionId))
}

/**
 * Hidden Harbors (lore05), defending half: an undamaged starport of the defender's here.
 *
 * The card's other half — "you always build ships fresh" — has nothing to attach to: this engine
 * builds every ship fresh already, so there is no damaged-on-build case for it to override.
 */
function defenderHasFreshStarport(state: GameState, system: SystemId, enemy: ColorId): boolean {
  const who = defendingFaction(state, enemy)
  if (who === undefined || !hasLore(state, who, HIDDEN_HARBORS)) return false
  return piecesAt(state, system, enemy, (p) => p === 'Starport').some(
    (id) => !state.damaged.includes(id),
  )
}

/**
 * Roll the pool, then hand off to interactive hit assignment.
 *
 * The roll is deterministic in the seeded RNG. `lastRoll` records every die's face purely so
 * the UI can show and animate them; nothing in the rules reads it. Hits are no longer applied
 * in a fixed order — the attacker assigns each one (docs/09 section 4), which is the tactical
 * decision the auto-resolver used to make for you.
 */
function performRoll(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  pool: { skirmish: number; assault: number; raid: number },
  then: PipReturn,
): RuleResult {
  const [{ rolls }, rng] = rollPoolDetailed(state.rng, pool)
  const rolled: GameState = {
    ...state,
    rng,
    lastRoll: { dice: rolls.map((r) => ({ die: r.die, face: r.face })) },
  }
  return offerReroll(rolled, faction, system, enemy, pool, rolls, then)
}

/**
 * Between rolling and assigning: anything that may change the dice before they are read.
 *
 * Seeker Torpedoes (lore14) is the only one in the base game — "when attacking in battle, after
 * rolling dice, you may reroll up to 1 assault die for each fresh Loyal attacking ship". The step
 * exists as its own hop because a reroll is a *decision*, so it has to be an action in the journal
 * rather than something folded into the roll.
 *
 * The choice is a **set**, taken all at once, which the official ruling requires: rerolls from a
 * single ability happen simultaneously, not one die at a time with a look in between. Options are
 * de-duplicated by the faces they discard, since two assault dice showing the same face are
 * interchangeable and offering both would be the same choice twice.
 */
function offerReroll(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  pool: { skirmish: number; assault: number; raid: number },
  rolls: readonly DieRoll[],
  then: PipReturn,
  used: readonly string[] = [],
): RuleResult {
  const source = rerollSources(state, faction, system, rolls).find((r) => !used.includes(r.id))
  if (source === undefined) return resolveRoll(state, faction, system, enemy, pool, rolls, then)

  // `die: undefined` means the source is not fussy — Empath's Vision rerolls any of them.
  const eligible = rolls.flatMap((r, i) =>
    source.die === undefined || r.die === source.die ? [i] : [],
  )
  /** How the source names what it rerolls — "skirmish", or just "dice" when it takes any. */
  const kind = source.die === undefined ? '' : `${source.die.toLowerCase()} `
  const spent = [...used, source.id]
  const seen = new Set<string>()
  const options: Action[] = []
  for (const pick of subsetsUpTo(eligible, source.limit)) {
    const faces = pick.map((i) => rolls[i]!.face).sort((a, b) => a - b)
    const key = faces.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      type: 'battle/reroll',
      faction,
      system,
      enemy,
      pool,
      rolls: [...rolls],
      indices: pick,
      then,
      used: spent,
      source: source.name,
      label: `Reroll ${pick.length} ${kind}${pick.length === 1 ? 'die' : 'dice'} (${faces.join(', ')})`,
    })
  }
  // Nothing this source could change: spend it and let whatever is left ask.
  if (options.length === 0) {
    return offerReroll(state, faction, system, enemy, pool, rolls, then, spent)
  }
  const keep: Action = {
    type: 'battle/reroll',
    faction,
    system,
    enemy,
    pool,
    rolls: [...rolls],
    indices: [],
    then,
    used: spent,
    source: source.name,
    label: `Keep the ${kind}dice`,
  }
  return {
    state,
    continue: C.ask(
      faction,
      [...options, keep],
      `${faction} — ${source.name}: reroll up to ${source.limit} ${kind}${source.limit === 1 ? 'die' : 'dice'}?`,
    ),
  }
}

/**
 * Everything that could change the dice, in a fixed order so a replay is stable.
 *
 * Each fires at most once per roll, which is what `used` tracks — HRF keeps the same per-battle
 * list. The base game has two, and they act on different dice, so holding both simply asks twice.
 *
 *   **Skirmishers** (bc13): "reroll a number of skirmish dice up to your total Weapon icons from
 *   resources and cards" — the same Weapon reach Court Enforcers counts.
 *
 *   **Seeker Torpedoes** (lore14): one assault die per fresh Loyal attacking ship.
 */
function rerollSources(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  rolls: readonly DieRoll[],
): { id: string; name: string; die: DieRoll['die'] | undefined; limit: number }[] {
  const out: { id: string; name: string; die: DieRoll['die'] | undefined; limit: number }[] = []

  /*
   * Empath's Vision (lore19): "While Empath is declared, if you roll **any** dice (even outside
   * battle), you may reroll any number of them once."
   *
   * The only source that is not tied to one die type, which is why `die` is optional — it takes
   * the whole roll, and its limit is however many dice were thrown. "Once" is the `used` list
   * every source already goes through.
   *
   * The parenthesis has nothing to model: every roll in the game goes through `performRoll`, so a
   * Galactic Rifles volley is already covered by the same hop.
   */
  if (rolls.length > 0 && loreActive(state, faction, EMPATHS_VISION)) {
    out.push({ id: EMPATHS_VISION, name: "Empath's Vision", die: undefined, limit: rolls.length })
  }

  const skirmish = rolls.filter((r) => r.die === 'Skirmish').length
  if (skirmish > 0 && hasGuild(state, faction, SKIRMISHERS)) {
    const limit = Math.min(skirmish, weaponReach(state, faction))
    if (limit > 0) out.push({ id: SKIRMISHERS, name: 'Skirmishers', die: 'Skirmish', limit })
  }

  /*
   * Tricky (Corsair, leader11): "When attacking in battle, you may reroll raid dice up to the
   * number of **different** resources you have." Different *types*, not tokens — two Fuel are
   * worth one reroll, and the trait rewards a broad board rather than a deep one.
   *
   * `rerollSources` is only ever consulted for the attacker, which is what the card requires.
   */
  const raid = rolls.filter((r) => r.die === 'Raid').length
  if (raid > 0 && hasTrait(state, faction, 'Tricky')) {
    const slots = slotsOf(state, faction)
    const kinds = RESOURCES.filter((r) => countResource(state.resources, slots, r) > 0).length
    const limit = Math.min(raid, kinds)
    if (limit > 0) out.push({ id: 'Tricky', name: 'Tricky', die: 'Raid', limit })
  }

  const assault = rolls.filter((r) => r.die === 'Assault').length
  if (assault > 0 && hasLore(state, faction, SEEKER_TORPEDOES)) {
    const fresh = piecesAt(state, system, faction, isShip).filter(
      (id) => !state.damaged.includes(id),
    ).length
    const limit = Math.min(assault, fresh)
    if (limit > 0) {
      out.push({ id: SEEKER_TORPEDOES, name: 'Seeker Torpedoes', die: 'Assault', limit })
    }
  }
  return out
}

/** Every subset of `items` of size 1..max, smallest first. */
function subsetsUpTo(items: readonly number[], max: number): number[][] {
  const out: number[][] = []
  const walk = (start: number, acc: number[]): void => {
    if (acc.length > 0) out.push([...acc])
    if (acc.length === max) return
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]!)
      walk(i + 1, acc)
      acc.pop()
    }
  }
  walk(0, [])
  return out
}

function performReroll(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  pool: { skirmish: number; assault: number; raid: number },
  rolls: readonly DieRoll[],
  indices: readonly number[],
  then: PipReturn,
  used: readonly string[] = [],
  source = 'reroll',
): RuleResult {
  if (indices.length === 0) {
    return offerReroll(state, faction, system, enemy, pool, rolls, then, used)
  }
  const [next, rng] = rerollAt(state.rng, rolls, indices)
  const rerolled: GameState = {
    ...state,
    rng,
    lastRoll: { dice: next.map((r) => ({ die: r.die, face: r.face })) },
    log: [...state.log, `${faction} rerolled ${indices.length} ${indices.length === 1 ? 'die' : 'dice'} (${source})`],
  }
  // That source is spent; anything else that could act asks next, on the new dice.
  return offerReroll(rerolled, faction, system, enemy, pool, next, then, used)
}

/**
 * Read the dice, apply the two Intercept-moving lore cards, and hand off to hit assignment.
 *
 * Split from the roll so that a reroll returns here rather than re-rolling: everything that reads
 * a face — including Mirror Plating, which cares that assault dice were *collected* rather than
 * what they show — happens once, on whatever the dice finally say.
 */
function resolveRoll(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  enemy: ColorId,
  pool: { skirmish: number; assault: number; raid: number },
  rolls: readonly DieRoll[],
  then: PipReturn,
): RuleResult {
  const tally = tallyOf(rolls)

  /*
   * Two lore cards move the Intercept count before it is read, one on each side, and HRF applies
   * them as a pair of adjustments to the same number (game-battle.scala:325-333).
   *
   *   Mirror Plating (lore04, defender) adds one, but only against a roll that included assault
   *   dice — it plates against the boarding weapon, not against skirmishers.
   *
   *   Signal Breaker (lore06, attacker) cancels one, but only from a fleet that was wholly
   *   undamaged when the battle began.
   *
   * Held together they simply cancel out, which is why both are applied to a single count rather
   * than short-circuiting on either.
   */
  const defender = defendingFaction(state, enemy)
  const mirrored =
    pool.assault > 0 && defender !== undefined && hasLore(state, defender, MIRROR_PLATING) ? 1 : 0
  const allFresh = piecesAt(state, system, faction, isShip).every(
    (id) => !state.damaged.includes(id),
  )
  const broken = allFresh && hasLore(state, faction, SIGNAL_BREAKER) ? 1 : 0
  const intercept = Math.max(0, tally.intercept + mirrored - broken)

  /*
   * Interception: any intercept face lets the defender strike the attacker's fresh ships.
   *
   * **Irregular** (Agitator, leader15) replaces what the defender strikes *with*: "they do not
   * take hits from fresh defending ships. Instead, they take 1 hit per Weapon icon you have from
   * cards and resources, then you discard 1 Weapon resource you have."
   *
   * So the count comes off the defender's Weapon reach rather than its fleet — an Agitator with
   * no ships left in the system still bites, which is the trait's whole point — and the discard
   * is the price, paid once per intercepted battle rather than once per hit.
   */
  const irregular = defender !== undefined && hasTrait(state, defender, 'Irregular')
  const defenderFresh = piecesAt(state, system, enemy, isShip).filter(
    (id) => !state.damaged.includes(id),
  ).length
  const strike = irregular && defender !== undefined ? weaponReach(state, defender) : defenderFresh
  const intercepted = intercept > 0 ? strike : 0
  const self = tally.self + intercepted

  const ctx: Resolve = {
    faction,
    system,
    enemy,
    self,
    intercepted,
    ships: tally.hits,
    buildings: tally.buildings,
    keys: tally.keys,
    dice: rolls,
    razed: false,
    then,
  }
  // The Weapon is discarded only when the interception actually fired.
  const paid =
    irregular && intercept > 0 && defender !== undefined
      ? discardOneWeapon(state, defender)
      : state

  const logged: GameState = {
    ...paid,
    log: [
      ...paid.log,
      `${faction} attacks ${enemy} in ${system}: rolled ${pool.skirmish}S/${pool.assault}A/${pool.raid}R → ` +
        `${tally.hits} hits, ${tally.buildings} bldg, ${self} self, ${intercept > 0 ? 'intercept' : 'no intercept'}, ${tally.keys} keys` +
        (mirrored > 0 ? ' (+1 intercept, Mirror Plating)' : '') +
        (broken > 0 ? ' (-1 intercept, Signal Breaker)' : '') +
        (irregular && intercept > 0 ? ` (${intercepted} from Weapon icons, Irregular)` : ''),
    ],
  }
  return { state: logged, continue: offerAssign(logged, ctx) }
}

/** Irregular's price: one Weapon token back to the supply, if the faction holds one at all. */
function discardOneWeapon(state: GameState, faction: FactionId): GameState {
  const token = slotsOf(state, faction)
    .flatMap((slot) => contentsOf(state.resources, slot))
    .find((id) => parseResourceToken(id).resource === 'Weapon')
  if (token === undefined) return state
  return {
    ...state,
    resources: spendToken(state.resources, token),
    log: [...state.log, `${faction} discarded a Weapon (Irregular)`],
  }
}

/** Pieces of a colour still standing in the system, damaged ones first (finishing is cheaper). */
function standing(state: GameState, system: SystemId, color: ColorId, kind: (p: string) => boolean) {
  const all = piecesAt(state, system, color, kind)
  return [
    ...all.filter((id) => state.damaged.includes(id)),
    ...all.filter((id) => !state.damaged.includes(id)),
  ]
}

/**
 * Ask which piece absorbs the next hit, phase by phase: the attacker's own ships (self-damage
 * and interception), then enemy ships, then enemy buildings. A phase with nothing to assign,
 * or no piece left to take a hit, is skipped; ship-hits with no enemy ship left **overflow**
 * into building hits, exactly as before.
 */
function offerAssign(state: GameState, ctx: Resolve): Continue {
  // Self-damage: the attacker sacrifices their own ships.
  if (ctx.self > 0) {
    const targets = standing(state, ctx.system, ctx.faction, isShip)
    if (targets.length === 0) return offerAssign(state, { ...ctx, self: 0 })
    return hitAsk(state, ctx, 'self', targets, `${ctx.faction} — assign ${ctx.self} self-hit(s)`)
  }

  // Enemy ships; overflow to buildings once none remain.
  if (ctx.ships > 0) {
    const targets = standing(state, ctx.system, ctx.enemy, isShip)
    if (targets.length === 0) {
      return offerAssign(state, { ...ctx, ships: 0, buildings: ctx.buildings + ctx.ships })
    }
    return hitAsk(state, ctx, 'ships', targets, `${ctx.faction} — assign ${ctx.ships} hit(s) to ${ctx.enemy}`)
  }

  // Enemy buildings.
  if (ctx.buildings > 0) {
    const targets = standing(state, ctx.system, ctx.enemy, isBuilding)
    if (targets.length > 0) {
      return hitAsk(state, ctx, 'buildings', targets, `${ctx.faction} — assign ${ctx.buildings} building hit(s)`)
    }
  }

  /*
   * Everything is placed — but the battle does not commit itself. Two reasons it ends on an ask
   * rather than `C.then(Finish(ctx))`:
   *
   *  - the player has to be able to review the damage and change their mind, and every hit is a
   *    journalled action, so "start over" is just replaying the journal minus the trailing hits
   *    (docs/10). Auto-committing the last hit would close that window;
   *  - `performFinish` clears `lastRoll`, and the whole chain runs inside one synchronous
   *    `advance`. A roll that leaves nothing to place — all dice blank, hits with no surviving
   *    target, or only raid keys — would otherwise resolve without any observer ever seeing a
   *    state holding the roll, so the dice never appeared at all.
   */
  return C.ask(
    ctx.faction,
    [{ ...Finish(ctx), faction: ctx.faction, label: 'Confirm' }],
    `${ctx.faction} — confirm the damage`,
  )
}

function hitAsk(
  state: GameState,
  ctx: Resolve,
  phase: 'self' | 'ships' | 'buildings',
  targets: readonly string[],
  prompt: string,
): Continue {
  const options: Action[] = targets.map((id) => {
    const dmg = state.damaged.includes(id)
    const p = parseFigureId(id)
    return {
      ...Hit(ctx, phase, id),
      faction: ctx.faction,
      label: `${dmg ? 'Destroy' : 'Damage'} ${p.color} ${p.piece}`,
    }
  })
  return C.ask(ctx.faction, options, prompt)
}

/** Apply one assigned hit: damage a fresh piece, or destroy a damaged one. */
function performHit(
  state: GameState,
  ctx: Resolve,
  phase: 'self' | 'ships' | 'buildings',
  target: string,
): RuleResult {
  const p = parseFigureId(target)
  const wasDamaged = state.damaged.includes(target)

  let figures = state.figures
  let damaged = state.damaged
  const log = [...state.log]
  let razed = ctx.razed

  if (wasDamaged) {
    /*
     * Destroyed pieces go to whoever's *opponent* owned them, both ways round. Rulebook p14:
     * "The attacker takes destroyed defending pieces as Trophies. The defender takes destroyed
     * attacking pieces as Trophies."
     *
     * The second sentence is the one this got wrong for a long time — attacker losses were sent
     * home to reserve, so a defender who wrecked a fleet by interception got nothing, and Warlord
     * only ever rewarded attacking. Both printings of the rulebook (April 2024 and August 2025)
     * carry the sentence verbatim.
     *
     * A defender that is not a seated player has no Trophies box, so those pieces do return to
     * reserve — the only case where the old routing was right.
     */
    damaged = damaged.filter((id) => id !== target)
    const taker = phase === 'self' ? defendingFaction(state, ctx.enemy) : ctx.faction
    const home = taker === undefined ? Location.reserve(ctx.faction) : Location.trophies(taker)
    figures = move(figures, target, home)
    log.push(
      phase === 'self'
        ? taker === undefined
          ? `${ctx.faction} lost a ${p.color} ${p.piece}`
          : `${ctx.faction} lost a ${p.color} ${p.piece} (${taker} trophy)`
        : `${ctx.faction} destroyed ${p.color} ${p.piece} (trophy)`,
    )
    if (p.piece === 'City') razed = true
  } else {
    damaged = [...damaged, target]
    log.push(`${ctx.faction} damaged ${p.color} ${p.piece}`)
  }

  /*
   * Still `phase !== 'self'`, and deliberately so even though both phases now yield trophies:
   * this flag is "the attacker destroyed something of the enemy's", which is what Beloved keys
   * off. Losing your own ships is not that.
   */
  const tookTrophies = ctx.tookTrophies === true || (wasDamaged && phase !== 'self')
  const next = { ...ctx, razed, tookTrophies, [phase]: ctx[phase] - 1 }
  // A destroyed piece leaves the board, so it must stop counting as a Cloud City — otherwise the
  // stale id would make the *next* city built from that same piece unslotted by accident.
  const state2: GameState = {
    ...state,
    figures,
    damaged,
    unslotted: state.unslotted.filter((id) => id !== target),
    log,
  }
  return { state: state2, continue: offerAssign(state2, next) }
}

/** After every hit is assigned: raid, then outrage, then hand back the turn. */
function performFinish(state: GameState, ctx: Resolve): RuleResult {
  // The pre-battle volley is not a battle: no raid, no outrage, no post-battle repair. It has
  // done its one hit, and what follows is the battle it preceded.
  if (ctx.railgun === true) {
    return {
      state: { ...state, lastRoll: undefined },
      continue: offerGather(state, ctx.faction, ctx.system, ctx.enemy, ctx.then),
    }
  }
  // Raiding is a spending decision, so it happens before anything is settled — and it is the
  // raider's decision, one purchase at a time.
  const cleared: GameState = { ...state, lastRoll: undefined }
  return { state: cleared, continue: offerRaid(cleared, ctx) }
}

/**
 * Spend the raid keys, one purchase at a time.
 *
 * Keys buy two things in the base game, and *which* is the whole decision — a guild card is
 * usually worth more than a resource, but costs more keys, and the keys do not carry over. So this
 * is a loop of asks rather than an automatic sweep: HRF's `BattleRaidAction` re-enters itself with
 * the remaining keys after every purchase (game-battle.scala:403).
 *
 *   **Resources** — each slot has its printed key cost (`slotKeys`), which is why the one on
 *   Ancient Holdings at four keys is the dearest thing on the table.
 *   **Guild cards** — the holder's secured guilds, at the key cost printed on each.
 *
 * Trophies and captives are *not* raidable in the base game; HRF only offers them under the
 * expansion's Vow of Fairness, which is why the earlier note lumping them in was wrong.
 *
 * **Sworn Guardians** stops all of it — nothing of that faction's is stealable.
 */
function offerRaid(state: GameState, ctx: Resolve): Continue {
  const settle = { type: 'battle/settle', ctx } as Action
  const victim = defendingFaction(state, ctx.enemy)
  if (ctx.keys <= 0 || victim === undefined) return C.then(settle)

  const options: Action[] = []

  /*
   * Sworn Guardians (bc22): "Rivals cannot steal your resources and **other** Guild cards. If this
   * card is stolen, bury it. (In battle, rivals can steal this card first before spending keys.)"
   *
   * The audit (docs/20 B2) found this over-blocking: the whole raid menu vanished, including the
   * one theft the card writes out longhand — Sworn Guardians itself. While the victim holds it,
   * it is the *only* raidable thing; taking it buries it (bottom of the court deck, the card's own
   * definition), and the remaining keys then shop normally, which `performRaidTake` re-entering
   * `offerRaid` provides for free once the card is gone.
   */
  if (hasGuild(state, victim, SWORN_GUARDIANS)) {
    const cost = courtCard(SWORN_GUARDIANS).keys ?? 1
    if (cost > ctx.keys) return C.then(settle)
    options.push({
      type: 'battle/raid-take',
      ctx,
      kind: 'guardians',
      target: SWORN_GUARDIANS,
      cost,
      label: `Take Sworn Guardians — buried (${cost} key${cost === 1 ? '' : 's'})`,
    })
    return C.ask(
      ctx.faction,
      [...options, { ...settle, faction: ctx.faction, label: `Stop raiding (${ctx.keys} key(s) left)` }],
      `${ctx.faction} raids ${ctx.enemy} — Sworn Guardians shields everything else`,
    )
  }

  /*
   * The Keeper's pair, both of which protect the victim rather than helping the raider:
   *
   *   **Keeper's Trust** (lore21) — "Rivals cannot steal resources from you that are the same as
   *   resources they have already." Read off the *raider's* holdings: a raider with a Fuel cannot
   *   take your Fuel, so hoarding one of each is what makes it bite.
   *
   *   **Keeper's Solidarity** (lore22) — "Rivals cannot steal Guild cards from you while you have
   *   any resources of the same type", where the type is the card's own suit. The card's own
   *   example — Relics plus Sworn Guardians and neither can be stolen — is the two working
   *   together.
   */
  const trust = loreActive(state, victim, KEEPERS_TRUST)
  const solidarity = loreActive(state, victim, KEEPERS_SOLIDARITY)
  const raiderHolds = (r: Resource): boolean =>
    countResource(state.resources, slotsOf(state, ctx.faction), r) > 0
  const victimHolds = (r: Resource): boolean =>
    countResource(state.resources, slotsOf(state, victim), r) > 0

  // Resources, one option per occupied slot the keys can afford.
  for (const slot of slotsOf(state, victim)) {
    const token = contentsOf(state.resources, slot)[0]
    if (token === undefined) continue
    if (trust && raiderHolds(parseResourceToken(token).resource)) continue
    const cost = slotKeys(slot)
    if (cost > ctx.keys) continue
    options.push({
      type: 'battle/raid-take',
      ctx,
      kind: 'resource',
      target: token,
      cost,
      label: `Take ${parseResourceToken(token).resource} (${cost} key${cost === 1 ? '' : 's'})`,
    })
  }

  // Guild cards, at the cost printed on each.
  for (const id of securedCards(state, victim)) {
    const card = courtCard(id)
    const cost = card.keys ?? 0
    if (cost === 0 || cost > ctx.keys) continue
    if (solidarity && card.suit !== undefined && victimHolds(card.suit)) continue
    options.push({
      type: 'battle/raid-take',
      ctx,
      kind: 'card',
      target: id,
      cost,
      label: `Take ${card.name} (${cost} key${cost === 1 ? '' : 's'})`,
    })
  }

  if (options.length === 0) return C.then(settle)
  return C.ask(
    ctx.faction,
    [...options, { ...settle, faction: ctx.faction, label: `Stop raiding (${ctx.keys} key(s) left)` }],
    `${ctx.faction} raids ${ctx.enemy} — ${ctx.keys} key(s) to spend`,
  )
}

function performRaidTake(
  state: GameState,
  ctx: Resolve,
  kind: string,
  target: string,
  cost: number,
): RuleResult {
  const victim = defendingFaction(state, ctx.enemy)
  if (victim === undefined) return { state, continue: C.then({ type: 'battle/settle', ctx } as Action) }

  let next = state
  if (kind === 'guardians') {
    /*
     * "If this card is stolen, bury it" — the thief pays the keys and gets nothing but the open
     * door: the card goes to the **bottom** of the court deck (tracker moves append, and draws
     * come off the front, so append is the bottom).
     */
    next = {
      ...next,
      courtCards: move(next.courtCards, target, CourtPile.deck()),
      log: [...next.log, `${ctx.faction} stole Sworn Guardians from ${victim} — buried`],
    }
  } else if (kind === 'card') {
    next = {
      ...next,
      courtCards: move(next.courtCards, target, CourtPile.secured(ctx.faction)),
      log: [...next.log, `${ctx.faction} raided ${courtCard(target).name} from ${victim}`],
    }
  } else {
    // Into an open slot of the raider's if there is one; otherwise it is simply taken off them.
    const open = openSlots(next.resources, slotsOf(next, ctx.faction))[0]
    const r = parseResourceToken(target).resource
    next = {
      ...next,
      resources:
        open === undefined
          ? spendToken(next.resources, target)
          : move(next.resources, target, open),
      log: [
        ...next.log,
        `${ctx.faction} raided ${r} from ${victim}${open === undefined ? ' (no room, lost)' : ''}`,
      ],
    }
  }
  const spent: Resolve = { ...ctx, keys: ctx.keys - cost }
  return { state: next, continue: offerRaid(next, spent) }
}

/**
 * Ransack the Court (base game): "When you destroy a city, you first Provoke Outrage" — then the
 * attacker secures a court card with at least one of the **defender's** agents on it, taking every
 * rival agent on that card as **Trophies, not Captives**.
 *
 * It hangs off razing a city, which is the same event as the outrage above and why it runs after
 * it. Exactly one card is taken, and only cards the defender has an agent on are eligible; a
 * defender with no agents anywhere in court simply gives nothing up.
 *
 * **Beloved (Elder) forbids it**: "Rivals cannot Ransack the Court when they battle you."
 */
function offerRansack(state: GameState, ctx: Resolve, then: Action): Continue {
  if (!ctx.razed) return C.then(then)
  const victim = defendingFaction(state, ctx.enemy)
  if (victim === undefined) return C.then(then)
  if (hasTrait(state, victim, 'Beloved')) {
    return C.log(`${victim} cannot be ransacked (their leader)`, C.then(then))
  }

  const options: Action[] = courtSlots(state.factions.length)
    .filter((n) => contentsOf(state.courtCards, CourtPile.slot(n))[0] !== undefined)
    .filter((n) =>
      contentsOf(state.figures, Location.court(n)).some(
        (id) => parseFigureId(id).color === victim,
      ),
    )
    .map((n) => ({
      type: 'action/ransack',
      faction: ctx.faction,
      slot: n,
      then,
      label: `Ransack ${courtCard(contentsOf(state.courtCards, CourtPile.slot(n))[0]!).name}`,
    }))
  if (options.length === 0) return C.then(then)
  return C.ask(
    ctx.faction,
    [...options, { ...then, faction: ctx.faction, label: 'Ransack nothing' }],
    `${ctx.faction} razed a city — ransack the court?`,
  )
}

/**
 * Beloved (Elder), first half: "After defending in battle, you may influence if the attacker took
 * any Trophies."
 *
 * Handed to the **defender**, which is why it is a separate step rather than part of the
 * attacker's resolution — the ask belongs to someone who is not taking the turn. It comes after
 * the ransack so the Elder acts on the board as the battle finally left it.
 */
function belovedThen(state: GameState, ctx: Resolve): Action {
  const defender = defendingFaction(state, ctx.enemy)
  if (defender === undefined || defender === ctx.faction) return ctx.then as Action
  if (ctx.tookTrophies !== true) return ctx.then as Action
  if (!hasTrait(state, defender, 'Beloved')) return ctx.then as Action
  return { type: 'leaders/beloved', faction: defender, then: ctx.then }
}

/** Everything a battle does once the raiding is over. */
function performSettle(state: GameState, ctx: Resolve): RuleResult {
  // Outrage: razing a City turns that world's guilds against the *attacker*. Run after the raid so
  // the discard takes what the attacker actually holds once the battle is over (docs/09 3a).
  let next = state
  if (ctx.razed) {
    const r = planetResource(next, ctx.system)
    if (r !== undefined) next = provokeOutrage(next, ctx.faction, r)
    // A razed *gate* city has no printed resource of its own. Under Gate Stations it counted as
    // every city type in its cluster, and the card says destroying it provokes outrage of all of
    // them — so razing one can turn several guilds against the attacker at once.
    for (const t of gateCityTypes(next, ctx.system)) {
      next = provokeOutrage(next, ctx.faction, t)
    }
  }

  // Galactic Rifles is not a battle, so nothing that triggers "after you battle" may run off it.
  let settled = next
  if (ctx.rifles !== true) {
    settled = repairDrones(settled, ctx)
    // "After **any** battle with you" — both sides, so it is offered to attacker and defender.
    settled = resilient(settled, ctx.faction, ctx.system)
    const defender = defendingFaction(settled, ctx.enemy)
    if (defender !== undefined) settled = resilient(settled, defender, ctx.system)
  }
  if (ctx.rifles === true) return { state: settled, continue: C.then(ctx.then as Action) }

  // The defender's own step comes last, so it sees the board as the battle left it.
  const after = belovedThen(settled, ctx)
  return { state: settled, continue: offerRansack(settled, ctx, after) }
}

/**
 * Resilient (Quartermaster, leader16): "After any **battle** with you, repair 1 Loyal ship in the
 * battle system per starport on the map you control. (Even Rival ones!)"
 *
 * Two things the parenthesis settles. The starports counted are the ones in systems this faction
 * **rules**, wherever they are on the map — not just the battle system, and not just its own: a
 * rival's starport standing in a system you rule counts for you, which is the whole point of the
 * aside. The ships repaired are Loyal — its own — and only those in the battle system.
 *
 * Not a choice, for the same reason Repair Drones is not: damaged ships in one system are
 * interchangeable, so which ones come back cannot change anything downstream.
 */
function resilient(state: GameState, faction: FactionId, system: SystemId): GameState {
  if (!hasTrait(state, faction, 'Resilient')) return state

  let ports = 0
  for (const s of state.board.systems) {
    if (!rules(state, faction, s)) continue
    ports += contentsOf(state.figures, Location.system(s)).filter(
      (id) => parseFigureId(id).piece === 'Starport',
    ).length
  }
  if (ports === 0) return state

  const hurt = piecesAt(state, system, faction, isShip)
    .filter((id) => state.damaged.includes(id))
    .slice(0, ports)
  if (hurt.length === 0) return state
  return {
    ...state,
    damaged: state.damaged.filter((id) => !hurt.includes(id)),
    log: [
      ...state.log,
      `${faction} repaired ${hurt.length} ship${hurt.length === 1 ? '' : 's'} (Resilient)`,
    ],
  }
}

/**
 * Repair Drones (lore07): "After you battle as the attacker, repair 1 Loyal attacking ship."
 *
 * Not a choice, and it does not need to be one: ships in a system are interchangeable, so which
 * damaged ship is repaired cannot change anything downstream. HRF prompts (game-battle.scala:686)
 * because its repair step is shared with cards where the target does matter.
 */
function repairDrones(state: GameState, ctx: Resolve): GameState {
  if (!hasLore(state, ctx.faction, REPAIR_DRONES)) return state
  const mine = piecesAt(state, ctx.system, ctx.faction, isShip)
  const hurt = mine.find((id) => state.damaged.includes(id))
  if (hurt === undefined) return state
  return {
    ...state,
    damaged: state.damaged.filter((id) => id !== hurt),
    log: [...state.log, `${ctx.faction} repaired a ship (Repair Drones)`],
  }
}


function parseResource(token: string): (typeof RESOURCES)[number] {
  const r = token.slice(0, token.indexOf('#')) as (typeof RESOURCES)[number]
  return r
}


// --- Galactic Rifles (lore02) ----------------------------------------------

/**
 * "Fire Rifles (Battle): Like in a battle, choose a system and collect skirmish dice for fresh
 * Loyal ships there, choose a defender in an adjacent system, roll the collected dice, and deal 1
 * hit to the defender per hit rolled. (Hit ships before buildings.)"
 *
 * **It is emphatically not a battle**, and the official ruling says so: it mimics one, so
 * defence-triggered abilities must not fire. That falls out of the shape here rather than needing
 * a guard — it never enters `openBattle`, `offerGather` or `performRoll`, so Mirror Plating,
 * Signal Breaker, Hidden Harbors, Railgun Arrays and Predictive Sensors are simply not on the
 * path. The one thing that *would* have
 * leaked is Repair Drones, which hangs off `performFinish`; the `rifles` flag on the context stops
 * it.
 *
 * What it borrows is the assignment: hits land ship-first and overflow to buildings exactly as a
 * battle's do, which is what "hit ships before buildings" asks for.
 *
 * The pool is one skirmish die per **fresh** ship in the firing system, capped at six — HRF's
 * `min(f.at(s).ships.fresh.num, 6)` (game-lore.scala:284), the same six-of-a-kind limit the
 * physical dice impose in battle. Skirmish dice carry no self, intercept or key faces, so the
 * firer risks nothing and steals nothing; only ships and buildings come off.
 */
export function riflesSources(state: GameState, faction: FactionId): SystemId[] {
  return state.board.systems.filter((s) => {
    const fresh = piecesAt(state, s, faction, isShip).filter((id) => !state.damaged.includes(id))
    if (fresh.length === 0) return false
    return connectedSystems(state.board, s).some((t) => enemiesAt(state, t, faction).length > 0)
  })
}

function offerRiflesFrom(state: GameState, faction: FactionId, then: PipReturn): Continue {
  const options: Action[] = riflesSources(state, faction).map((s) => ({
    type: 'rifles/target',
    faction,
    from: s,
    then,
    label: `Fire from ${s}`,
  }))
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, cancel(faction, then)], 'Fire Rifles — from where?')
}

function offerRiflesTarget(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  then: PipReturn,
): Continue {
  const options: Action[] = []
  for (const t of connectedSystems(state.board, from)) {
    for (const e of enemiesAt(state, t, faction)) {
      options.push({
        type: 'rifles/roll',
        faction,
        from,
        at: t,
        enemy: e,
        then,
        label: `Fire at ${e} in ${t}`,
      })
    }
  }
  if (options.length === 0) return C.then(then as Action)
  return C.ask(faction, [...options, cancel(faction, then)], `Fire Rifles from ${from} — at whom?`)
}

function performRiflesRoll(
  state: GameState,
  faction: FactionId,
  from: SystemId,
  at: SystemId,
  enemy: ColorId,
  then: PipReturn,
): RuleResult {
  const fresh = piecesAt(state, from, faction, isShip).filter((id) => !state.damaged.includes(id))
  const skirmish = Math.min(fresh.length, 6)
  if (skirmish === 0) return { state, continue: C.then(then as Action) }

  const [{ rolls, tally }, rng] = rollPoolDetailed(state.rng, { skirmish, assault: 0, raid: 0 })
  const ctx: Resolve = {
    faction,
    system: at,
    enemy,
    self: 0,
    intercepted: 0,
    ships: tally.hits,
    buildings: 0,
    keys: 0,
    razed: false,
    rifles: true,
    then,
  }
  const next: GameState = {
    ...state,
    rng,
    lastRoll: { dice: rolls.map((r) => ({ die: r.die, face: r.face })) },
    log: [
      ...state.log,
      `${faction} fired rifles from ${from} at ${enemy} in ${at}: ${skirmish} skirmish -> ${tally.hits} hit(s)`,
    ],
  }
  return { state: next, continue: offerAssign(next, ctx) }
}

// --- dispatch --------------------------------------------------------------

function cancel(faction: FactionId, then: PipReturn): Action {
  return { type: 'battle/cancel', faction, then, label: 'Cancel' }
}

export const BattleModule: RuleModule = {
  id: 'battle',
  perform(state: GameState, action: Action): RuleResult {
    switch (action.type) {
      case 'battle/declare':
        return { state, continue: offerDeclare(state, action['faction'] as FactionId, action['then'] as PipReturn) }
      case 'battle/system':
        return {
          state,
          continue: offerTarget(
            state,
            action['faction'] as FactionId,
            action['system'] as SystemId,
            action['then'] as PipReturn,
          ),
        }
      case 'rifles/from':
        return {
          state,
          continue: offerRiflesFrom(state, action['faction'] as FactionId, action['then'] as PipReturn),
        }
      case 'rifles/target':
        return {
          state,
          continue: offerRiflesTarget(
            state,
            action['faction'] as FactionId,
            action['from'] as SystemId,
            action['then'] as PipReturn,
          ),
        }
      case 'rifles/roll':
        return performRiflesRoll(
          state,
          action['faction'] as FactionId,
          action['from'] as SystemId,
          action['at'] as SystemId,
          action['enemy'] as ColorId,
          action['then'] as PipReturn,
        )
      case 'battle/target':
        // Every route into the dice menu goes through `openBattle`, so a chosen target is gated
        // by the railgun volley exactly as a sole target is.
        return {
          state,
          continue: openBattle(
            state,
            action['faction'] as FactionId,
            action['system'] as SystemId,
            action['enemy'] as ColorId,
            action['then'] as PipReturn,
          ),
        }
      case 'battle/sensors':
        return {
          state,
          continue: offerSensors(
            state,
            action['faction'] as FactionId,
            action['system'] as SystemId,
            action['enemy'] as ColorId,
            action['attacker'] as FactionId,
            action['then'] as PipReturn,
          ),
        }
      case 'battle/sensors-pull':
        return performSensorsPull(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['enemy'] as ColorId,
          action['attacker'] as FactionId,
          action['from'] as SystemId,
          action['count'] as number,
          action['then'] as PipReturn,
        )
      case 'battle/sensors-done':
        // Back into the battle past the sensors window, never into `openBattle` again.
        return {
          state,
          continue: openBattleArmed(
            state,
            action['attacker'] as FactionId,
            action['system'] as SystemId,
            action['enemy'] as ColorId,
            action['then'] as PipReturn,
          ),
        }
      case 'battle/reroll':
        return performReroll(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['enemy'] as ColorId,
          action['pool'] as { skirmish: number; assault: number; raid: number },
          action['rolls'] as readonly DieRoll[],
          action['indices'] as readonly number[],
          action['then'] as PipReturn,
          (action['used'] as readonly string[]) ?? [],
          (action['source'] as string | undefined) ?? 'reroll',
        )
      case 'battle/roll':
        return performRoll(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['enemy'] as ColorId,
          {
            skirmish: action['skirmish'] as number,
            assault: action['assault'] as number,
            raid: action['raid'] as number,
          },
          action['then'] as PipReturn,
        )
      case 'battle/hit':
        return performHit(
          state,
          action['ctx'] as Resolve,
          action['phase'] as 'self' | 'ships' | 'buildings',
          action['target'] as string,
        )
      case 'battle/raid-take':
        return performRaidTake(
          state,
          action['ctx'] as Resolve,
          action['kind'] as string,
          action['target'] as string,
          action['cost'] as number,
        )
      case 'battle/settle':
        return performSettle(state, action['ctx'] as Resolve)
      case 'battle/finish':
        return performFinish(state, action['ctx'] as Resolve)
      case 'battle/cancel':
        return { state, continue: C.then(action['then'] as Action) }
      default:
        return unhandled(state)
    }
  },
}
