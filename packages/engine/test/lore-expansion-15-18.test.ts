/**
 * Leaders and Lore, expansion lore 15-18.
 *
 * Not the single group the backlog assumed. Only **Raider Exosuits** touches the dice; the other
 * three are a defender's pre-battle interrupt and two Move alts, so they land in three different
 * places in the engine and are tested here as four separate cards that happen to share a range.
 *
 * Same discipline as the rest of the lore tests: every effect is checked against the identical
 * board *without* the card, because a card that silently did nothing looks exactly like a base
 * game. Cards are injected onto `state.lores` rather than drafted — the deal is seeded, so
 * drafting a chosen card to a chosen faction would be testing the shuffle.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  advance,
  connectedSystems,
  contentsOf,
  defaultRegistry,
  startGame,
  system as systemInfo,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, SystemId } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()
const STOP = { type: 'turn/lead-main', faction: 'red' } as const

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state

const withLore = (s: GameState, f: FactionId, ...ids: string[]): GameState => ({
  ...s,
  lores: { ...s.lores, [f]: [...(s.lores[f] ?? []), ...ids] },
})

const ask = (c: Continue): Extract<Continue, { kind: 'ask' }> => {
  if (c.kind !== 'ask') throw new Error(`expected an ask, got ${c.kind}`)
  return c
}
const labels = (c: Continue): string[] => ask(c).actions.map((a) => String(a['label'] ?? a.type))

/** Send everything standing in a system home, so a test owns what is there. */
function clear(s: GameState, system: SystemId): GameState {
  const contents = new Map(s.figures.contents)
  const at = new Map(s.figures.at)
  const dest = Location.system(system)
  for (const id of contents.get(dest) ?? []) {
    const color = id.slice(0, id.indexOf('/'))
    contents.set(`reserve:${color}`, [...(contents.get(`reserve:${color}`) ?? []), id])
    at.set(id, `reserve:${color}`)
  }
  contents.set(dest, [])
  return { ...s, figures: { ...s.figures, contents, at } }
}

/**
 * Sweep the entire board.
 *
 * Cards keyed on "a system with a fresh Loyal starport" or "a ship that is not Loyal" are
 * satisfied by the *starting* pieces scattered across the map, which quietly makes a negative
 * test pass for the wrong reason. Starting from an empty board and placing only what a test
 * names is the only way those assertions mean anything.
 */
function empty(s: GameState): GameState {
  let out = s
  for (const id of s.board.systems) out = clear(out, id)
  return out
}

function place(s: GameState, color: string, system: SystemId, piece: string, n: number): GameState {
  const contents = new Map(s.figures.contents)
  const at = new Map(s.figures.at)
  const reserve = `reserve:${color}`
  const dest = Location.system(system)
  const moved = (contents.get(reserve) ?? [])
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !moved.includes(id)))
  contents.set(dest, [...(contents.get(dest) ?? []), ...moved])
  for (const id of moved) at.set(id, dest)
  return { ...s, figures: { ...s.figures, contents, at } }
}

/** Mark `n` of a colour's pieces of a kind in a system as damaged. */
function damage(s: GameState, color: string, system: SystemId, piece: string, n: number): GameState {
  const here = contentsOf(s.figures, Location.system(system))
    .filter((id) => id.startsWith(`${color}/${piece}/`))
    .slice(0, n)
  return { ...s, damaged: [...s.damaged, ...here] }
}

const shipsOf = (s: GameState, system: SystemId, color: string): string[] =>
  contentsOf(s.figures, Location.system(system)).filter((id) => id.startsWith(`${color}/Ship/`))

/** Open a battle: red attacks yellow in `system`. */
const attack = (s: GameState, system: SystemId): Continue =>
  advance(s, { type: 'battle/target', faction: 'red', system, enemy: 'yellow', then: STOP }, registry)
    .continue

/** The Move menu red is offered. */
const moveMenu = (s: GameState): Continue =>
  advance(s, { type: 'action/take', faction: 'red', action: 'Move', then: STOP }, registry).continue

/** Take the one action of `type` on offer, or fail loudly. */
function pick(c: Continue, type: string): Action {
  const found = ask(c).actions.find((a) => a.type === type)
  if (found === undefined) throw new Error(`no ${type} on offer: ${labels(c).join(' | ')}`)
  return found
}

// ---------------------------------------------------------------------------

describe('Raider Exosuits (lore17) — a raid die where there are no buildings', () => {
  /*
   * "When attacking in battle, if there are no defending buildings, you may collect up to 1 raid
   * die. (This is not an extra die. Follow the limit of 1 die per ship.)"
   */
  const bare = (): { s: GameState; system: SystemId } => {
    const system = fresh().board.systems[0]!
    let s = clear(fresh(), system)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 2)
    return { s, system }
  }

  const maxRaid = (s: GameState, system: SystemId): number =>
    Math.max(
      ...ask(attack(s, system))
        .actions.filter((a) => a.type === 'battle/roll')
        .map((a) => a['raid'] as number),
    )

  it('the base game offers no raid dice at all with no defending buildings', () => {
    const { s, system } = bare()
    expect(maxRaid(s, system)).toBe(0)
  })

  it('the card offers exactly one, never more', () => {
    const { s, system } = bare()
    expect(maxRaid(withLore(s, 'red', 'lore17'), system)).toBe(1)
  })

  it('is the attacker’s card, not the defender’s', () => {
    const { s, system } = bare()
    expect(maxRaid(withLore(s, 'yellow', 'lore17'), system)).toBe(0)
  })

  it('does not change the ordinary six once a building is there', () => {
    const system = fresh().board.systems[0]!
    let s = clear(fresh(), system)
    s = place(s, 'red', system, 'Ship', 6)
    s = place(s, 'yellow', system, 'City', 1)
    // A city, not a starport — Hidden Harbors is a different card and must not be involved.
    expect(maxRaid(s, system)).toBe(6)
    expect(maxRaid(withLore(s, 'red', 'lore17'), system)).toBe(6)
  })

  it('the die still costs a ship — it is not an extra one', () => {
    const system = fresh().board.systems[0]!
    let s = clear(fresh(), system)
    s = place(s, 'red', system, 'Ship', 1)
    s = place(s, 'yellow', system, 'Ship', 1)
    const pools = ask(attack(withLore(s, 'red', 'lore17'), system))
      .actions.filter((a) => a.type === 'battle/roll')
      .map((a) => [a['skirmish'], a['assault'], a['raid']].join(''))
    // One ship, so one die: the raid die displaces the skirmish die rather than joining it.
    expect(pools).toContain('001')
    expect(pools).toContain('100')
    expect(pools).not.toContain('101')
  })
})

describe('Predictive Sensors (lore15) — the defender reinforces before the dice', () => {
  /*
   * "When defending in battle, before the attacker collects dice, you may move any number of fresh
   * Loyal ships from systems adjacent to the battle system into it."
   */
  /** A battle system with yellow ships waiting one hop away. */
  const staged = (
    withCard = true,
    holder: FactionId = 'yellow',
  ): { s: GameState; system: SystemId; next: SystemId } => {
    const base = fresh()
    const system = base.board.systems[0]!
    const next = connectedSystems(base.board, system)[0]!
    let s = empty(base)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 1)
    s = place(s, 'yellow', next, 'Ship', 2)
    return { s: withCard ? withLore(s, holder, 'lore15') : s, system, next }
  }

  it('asks the defender, not the attacker', () => {
    const { s, system } = staged()
    const c = ask(attack(s, system))
    expect(c.faction).toBe('yellow')
    expect(c.actions.some((a) => a.type === 'battle/sensors-pull')).toBe(true)
  })

  it('goes straight to the dice without the card', () => {
    const { s, system } = staged(false)
    const c = ask(attack(s, system))
    expect(c.faction).toBe('red')
    expect(c.actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('pulls the ships in, and the dice menu follows', () => {
    const { s, system, next } = staged()
    const opened = attack(s, system)
    const pull = ask(opened).actions.find(
      (a) => a.type === 'battle/sensors-pull' && a['count'] === 2,
    )!
    const after = advance(s, pull, registry)
    expect(shipsOf(after.state, system, 'yellow').length).toBe(3)
    expect(shipsOf(after.state, next, 'yellow').length).toBe(0)
    // Nothing left to pull, so the loop ends by itself and hands the battle on.
    expect(ask(after.continue).faction).toBe('red')
    expect(ask(after.continue).actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('declining leaves the board alone and still reaches the dice', () => {
    const { s, system, next } = staged()
    const done = pick(attack(s, system), 'battle/sensors-done')
    const after = advance(s, done, registry)
    expect(shipsOf(after.state, system, 'yellow').length).toBe(1)
    expect(shipsOf(after.state, next, 'yellow').length).toBe(2)
    expect(ask(after.continue).actions.some((a) => a.type === 'battle/roll')).toBe(true)
  })

  it('takes fresh ships only', () => {
    const { s, system, next } = staged()
    const hurt = damage(s, 'yellow', next, 'Ship', 1)
    const counts = ask(attack(hurt, system))
      .actions.filter((a) => a.type === 'battle/sensors-pull')
      .map((a) => a['count'] as number)
    // One of the two next door is damaged, so only one may come.
    expect(Math.max(...counts)).toBe(1)
  })

  it('is not offered when every neighbouring ship is damaged', () => {
    const { s, system, next } = staged()
    const hurt = damage(s, 'yellow', next, 'Ship', 2)
    expect(ask(attack(hurt, system)).faction).toBe('red')
  })

  it('reaches only adjacent systems', () => {
    const base = fresh()
    const system = base.board.systems[0]!
    const near = [...connectedSystems(base.board, system)]
    const far = base.board.systems.find((id) => id !== system && !near.includes(id))!
    let s = empty(base)
    s = place(s, 'red', system, 'Ship', 3)
    s = place(s, 'yellow', system, 'Ship', 1)
    s = place(s, 'yellow', far, 'Ship', 2)
    // Ships exist, and are fresh and Loyal — but two hops away, so the card cannot reach them.
    expect(ask(attack(withLore(s, 'yellow', 'lore15'), system)).faction).toBe('red')
  })

  it('runs before Railgun Arrays, so reinforcements are there for the volley', () => {
    const { s, system } = staged()
    const both = withLore(s, 'yellow', 'lore12')
    const c = ask(attack(both, system))
    // The sensors ask comes first; the railgun volley has not fired yet.
    expect(c.faction).toBe('yellow')
    expect(c.actions.some((a) => a.type === 'battle/sensors-pull')).toBe(true)
    const done = pick(attack(both, system), 'battle/sensors-done')
    const after = advance(both, done, registry)
    expect(after.state.log.at(-1) ?? '').toContain('Railgun Arrays')
  })
})

describe('Force Beams (lore16) — Guide carries any ships along a starport lane', () => {
  /*
   * "Guide (Move): Move any number of any ships (even if not Loyal) from a system with a fresh
   * Loyal starport to an adjacent system, or vice versa, ignoring move modifiers in play areas."
   */
  /** A red starport system next to an empty neighbour, with a yellow fleet in the port system. */
  const laned = (withCard = true): { s: GameState; port: SystemId; next: SystemId } => {
    const base = fresh()
    const port = base.board.systems[0]!
    const next = connectedSystems(base.board, port)[0]!
    let s = empty(base)
    s = place(s, 'red', port, 'Starport', 1)
    s = place(s, 'yellow', port, 'Ship', 2)
    return { s: withCard ? withLore(s, 'red', 'lore16') : s, port, next }
  }

  it('appears on the Move menu, and only with the card', () => {
    const { s } = laned()
    expect(labels(moveMenu(s)).some((l) => l.startsWith('Guide'))).toBe(true)
    expect(labels(moveMenu(laned(false).s)).some((l) => l.startsWith('Guide'))).toBe(false)
  })

  it("moves a rival's ships — the ships need not be Loyal, only the starport", () => {
    const { s, port, next } = laned()
    const alt = pick(moveMenu(s), 'action/guild-alt')
    const lanes = advance(s, alt, registry)
    const lane = ask(lanes.continue).actions.find(
      (a) => a['from'] === port && a['to'] === next,
    )!
    const sized = advance(lanes.state, lane, registry)
    const go = ask(sized.continue).actions.find(
      (a) => a['color'] === 'yellow' && a['count'] === 2,
    )!
    const after = advance(sized.state, go, registry).state
    expect(shipsOf(after, next, 'yellow').length).toBe(2)
    expect(shipsOf(after, port, 'yellow').length).toBe(0)
  })

  it('runs the lane both ways — "or vice versa"', () => {
    const { s, port, next } = laned()
    const inbound = place(s, 'blue', next, 'Ship', 1)
    const alt = pick(moveMenu(inbound), 'action/guild-alt')
    const lanes = labels(advance(inbound, alt, registry).continue)
    expect(lanes.some((l) => l.startsWith(`Guide ${port} → ${next}`))).toBe(true)
    expect(lanes.some((l) => l.startsWith(`Guide ${next} → ${port}`))).toBe(true)
  })

  it('needs the starport to be fresh', () => {
    const { s, port } = laned()
    const hurt = damage(s, 'red', port, 'Starport', 1)
    expect(labels(moveMenu(hurt)).some((l) => l.startsWith('Guide'))).toBe(false)
  })

  it('is not offered from a starport that is not yours', () => {
    const base = fresh()
    const port = base.board.systems[0]!
    const next = connectedSystems(base.board, port)[0]!
    let s = empty(base)
    s = place(s, 'yellow', port, 'Starport', 1)
    s = place(s, 'yellow', port, 'Ship', 2)
    // Red needs to be somewhere to have a Move menu at all, but not in the lane.
    const far = base.board.systems.find((id) => id !== port && id !== next)!
    s = place(s, 'red', far, 'Ship', 1)
    expect(labels(moveMenu(withLore(s, 'red', 'lore16'))).some((l) => l.startsWith('Guide'))).toBe(
      false,
    )
  })

  /*
   * The three below are the publisher's own rulings and the community's headline uses, so they are
   * tested by name rather than left to fall out of the implementation.
   *
   * FAQ (cards.buriedgiant.com, ARCS-L16):
   *   Q: Does this trigger Gate Ports?  A: No, since this ignores move modifiers.
   *   Q: Can you use Force Beams to do a Catapult Move?  A: No, Force Beams is strictly to an
   *      adjacent system. It cannot start a Catapult move.
   */
  it('carries a mixed group in ONE action — yours and theirs together', () => {
    const { s, port, next } = laned()
    // Red's own ships alongside yellow's, all in the starport system.
    const mixed = place(s, 'red', port, 'Ship', 3)
    const alt = pick(moveMenu(mixed), 'action/guild-alt')
    const lanes = advance(mixed, alt, registry)
    const lane = ask(lanes.continue).actions.find((a) => a['from'] === port && a['to'] === next)!
    let cur = advance(lanes.state, lane, registry)

    // Two of red's...
    const red2 = ask(cur.continue).actions.find(
      (a) => a['color'] === 'red' && a['count'] === 2,
    )!
    cur = advance(cur.state, red2, registry)
    // ...and the lane is still open, which is the whole point.
    const yellow1 = ask(cur.continue).actions.find(
      (a) => a['color'] === 'yellow' && a['count'] === 1,
    )!
    cur = advance(cur.state, yellow1, registry)

    expect(shipsOf(cur.state, next, 'red').length).toBe(2)
    expect(shipsOf(cur.state, next, 'yellow').length).toBe(1)
    // What stayed behind stayed behind — a mixed group, not a whole-system sweep.
    expect(shipsOf(cur.state, port, 'red').length).toBe(1)
    expect(shipsOf(cur.state, port, 'yellow').length).toBe(1)

    // And it ends on the player's word, not by exhaustion.
    const stop = ask(cur.continue).actions.find((a) =>
      String(a['label']).startsWith('Send no more'),
    )!
    expect(stop).toBeDefined()
    const ended = advance(cur.state, stop, registry)
    expect(shipsOf(ended.state, port, 'red').length).toBe(1)
  })

  it('ignores Disorganized — the Rebel may guide more than two ships', () => {
    const { s, port, next } = laned()
    const rebel: GameState = {
      ...place(s, 'red', port, 'Ship', 4),
      leaders: { ...s.leaders, red: 'leader05' },
    }
    const alt = pick(moveMenu(rebel), 'action/guild-alt')
    const lanes = advance(rebel, alt, registry)
    const lane = ask(lanes.continue).actions.find((a) => a['from'] === port && a['to'] === next)!
    const sized = advance(lanes.state, lane, registry)
    const counts = ask(sized.continue)
      .actions.filter((a) => a['color'] === 'red')
      .map((a) => a['count'] as number)
    // Disorganized caps a plain Move at 2; Guide is a move modifier in a play area, so it is off.
    expect(Math.max(...counts)).toBe(4)

    // The same fleet on a plain Move is capped, which is what makes the assertion above mean
    // something rather than merely restating that four ships are present.
    const plain = advance(
      rebel,
      { type: 'action/move-pick', faction: 'red', from: port, to: next, then: STOP },
      registry,
    )
    expect(
      Math.max(...ask(plain.continue).actions.flatMap((a) =>
        a['count'] === undefined ? [] : [a['count'] as number],
      )),
    ).toBe(2)
  })

  it('does not trigger the Gate Ports toll', () => {
    const base = fresh()
    // A gate yellow rules with a fresh starport, next to a system red has a fresh starport in.
    const gate = base.board.systems.find((id) => systemInfo(id).isGate)!
    const port = connectedSystems(base.board, gate).find((id) => !systemInfo(id).isGate)!
    let s = empty(base)
    s = place(s, 'red', port, 'Starport', 1)
    s = place(s, 'red', port, 'Ship', 2)
    s = place(s, 'yellow', gate, 'Starport', 1)
    s = place(s, 'yellow', gate, 'Ship', 3)
    s = withLore(withLore(s, 'red', 'lore16'), 'yellow', 'lore08')

    const agents = (g: GameState): number =>
      contentsOf(g.figures, Location.captives('yellow')).filter((id) => id.startsWith('red/Agent/'))
        .length
    expect(agents(s)).toBe(0)

    // A plain move into that gate pays the toll — the control case for the assertion below.
    const plain = advance(
      s,
      { type: 'action/move-ships', faction: 'red', from: port, to: gate, count: 2, then: STOP },
      registry,
    )
    expect(agents(plain.state)).toBe(1)

    // Guiding the same ships along the same lane pays nothing.
    const alt = pick(moveMenu(s), 'action/guild-alt')
    const lanes = advance(s, alt, registry)
    const lane = ask(lanes.continue).actions.find((a) => a['from'] === port && a['to'] === gate)!
    const sized = advance(lanes.state, lane, registry)
    const go = ask(sized.continue).actions.find(
      (a) => a['color'] === 'red' && a['count'] === 2,
    )!
    const after = advance(sized.state, go, registry)
    expect(shipsOf(after.state, gate, 'red').length).toBe(2)
    expect(agents(after.state)).toBe(0)
  })

  it('cannot start a Catapult move — it is strictly to an adjacent system', () => {
    const base = fresh()
    // A gate reachable from a red starport system: a plain move here would offer to carry on.
    const gate = base.board.systems.find((id) => systemInfo(id).isGate)!
    const port = connectedSystems(base.board, gate).find((id) => !systemInfo(id).isGate)!
    let s = empty(base)
    s = place(s, 'red', port, 'Starport', 1)
    s = place(s, 'red', port, 'Ship', 2)
    s = withLore(s, 'red', 'lore16')

    // The plain Move does offer the catapult from that same lane...
    expect(labels(moveMenu(s))).toContain(`Move ${port} → ${gate} (2 ships) — and further`)

    // ...and Guide along it stops dead at the gate.
    const alt = pick(moveMenu(s), 'action/guild-alt')
    const lanes = advance(s, alt, registry)
    const lane = ask(lanes.continue).actions.find((a) => a['from'] === port && a['to'] === gate)!
    const sized = advance(lanes.state, lane, registry)
    const go = ask(sized.continue).actions.find(
      (a) => a['color'] === 'red' && a['count'] === 2,
    )!
    const after = advance(sized.state, go, registry)
    expect(shipsOf(after.state, gate, 'red').length).toBe(2)
    expect(JSON.stringify(after.continue)).not.toContain('move-more')
    expect(labels(after.continue).some((l) => l.includes('and further'))).toBe(false)
  })

  it('ignores move modifiers — no Sprinter Drives leg follows it', () => {
    const { s, port, next } = laned()
    const both = withLore(place(s, 'red', port, 'Ship', 2), 'red', 'lore03')
    const alt = pick(moveMenu(both), 'action/guild-alt')
    const lanes = advance(both, alt, registry)
    const lane = ask(lanes.continue).actions.find(
      (a) => a['from'] === port && a['to'] === next,
    )!
    const sized = advance(lanes.state, lane, registry)
    const go = ask(sized.continue).actions.find(
      (a) => a['color'] === 'red' && a['count'] === 2,
    )!
    const after = advance(sized.state, go, registry)
    expect(shipsOf(after.state, next, 'red').length).toBe(2)
    // A plain Move of the same ships *would* offer the sprint; Guide hands straight back.
    expect(JSON.stringify(after.continue)).not.toContain('sprint')

    const plain = advance(
      both,
      { type: 'action/move-ships', faction: 'red', from: port, to: next, count: 2, then: STOP },
      registry,
    )
    expect(JSON.stringify(plain.continue)).toContain('sprint')
  })
})

describe('Survival Overrides (lore18) — Martyr trades a ship for a trophy', () => {
  /*
   * "Martyr (Move): Destroy 1 fresh Loyal ship on the map to destroy 1 ship that is not Loyal in
   * its system, taking it as a Trophy. (Your Loyal ship does not become a Trophy.)"
   */
  const paired = (withCard = true): { s: GameState; system: SystemId } => {
    const base = fresh()
    const system = base.board.systems[0]!
    let s = empty(base)
    s = place(s, 'red', system, 'Ship', 2)
    s = place(s, 'yellow', system, 'Ship', 1)
    return { s: withCard ? withLore(s, 'red', 'lore18') : s, system }
  }

  const trophies = (s: GameState): readonly string[] =>
    contentsOf(s.figures, Location.trophies('red'))

  it('appears on the Move menu, and only with the card', () => {
    const { s } = paired()
    expect(labels(moveMenu(s)).some((l) => l.startsWith('Martyr'))).toBe(true)
    expect(labels(moveMenu(paired(false).s)).some((l) => l.startsWith('Martyr'))).toBe(false)
  })

  it('destroys both ships, and only the rival becomes a trophy', () => {
    const { s, system } = paired()
    const alt = pick(moveMenu(s), 'action/guild-alt')
    const offered = advance(s, alt, registry)
    const act = pick(offered.continue, 'action/martyr')
    const after = advance(offered.state, act, registry).state

    expect(shipsOf(after, system, 'yellow').length).toBe(0)
    expect(shipsOf(after, system, 'red').length).toBe(1)
    // The victim is a trophy; the martyr is not — it went home to red's reserve.
    const won = trophies(after).filter((id) => !trophies(s).includes(id))
    expect(won.length).toBe(1)
    expect(won[0]!.startsWith('yellow/Ship/')).toBe(true)
    expect(trophies(after).some((id) => id.startsWith('red/'))).toBe(false)
    expect(
      contentsOf(after.figures, 'reserve:red').filter((id) => id.startsWith('red/Ship/')).length,
    ).toBe(contentsOf(s.figures, 'reserve:red').filter((id) => id.startsWith('red/Ship/')).length + 1)
  })

  it('destroys a damaged victim outright rather than repairing it', () => {
    const { s, system } = paired()
    const hurt = damage(s, 'yellow', system, 'Ship', 1)
    const alt = pick(moveMenu(hurt), 'action/guild-alt')
    const offered = advance(hurt, alt, registry)
    const after = advance(offered.state, pick(offered.continue, 'action/martyr'), registry).state
    expect(shipsOf(after, system, 'yellow').length).toBe(0)
    // And the id stops being tracked as damaged now that it is off the board.
    expect(after.damaged.length).toBe(0)
  })

  it('the martyr must be fresh', () => {
    const { s, system } = paired()
    const hurt = damage(s, 'red', system, 'Ship', 2)
    expect(labels(moveMenu(hurt)).some((l) => l.startsWith('Martyr'))).toBe(false)
  })

  it('needs a rival ship in the same system, not merely somewhere', () => {
    const base = fresh()
    const system = base.board.systems[0]!
    const other = base.board.systems[1]!
    let s = empty(base)
    s = place(s, 'red', system, 'Ship', 2)
    s = place(s, 'yellow', other, 'Ship', 1)
    expect(labels(moveMenu(withLore(s, 'red', 'lore18'))).some((l) => l.startsWith('Martyr'))).toBe(
      false,
    )
  })
})
