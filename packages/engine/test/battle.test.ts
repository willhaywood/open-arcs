import { describe, expect, it } from 'vitest'

import {
  DICE,
  Location,
  advance,
  contentsOf,
  slotKeys,
  slotsOf,
  gain,
  CourtPile,
  defaultRegistry,
  emptyTally,
  parseFigureId,
  rng,
  rollDie,
  rollPool,
  startGame,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, RuleResult, SystemId } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

describe('dice (faces confirmed identical in HRF and the TTS mod)', () => {
  it('has three die types', () => {
    expect([...DICE]).toEqual(['Skirmish', 'Assault', 'Raid'])
  })

  it('Skirmish is 3 blank / 3 single-hit faces', () => {
    const dist = faceDistribution('Skirmish')
    const hitFaces = dist.filter((f) => f.hits === 1 && f.self === 0 && f.buildings === 0).length
    const blankFaces = dist.filter((f) => total(f) === 0).length
    expect(hitFaces).toBe(3)
    expect(blankFaces).toBe(3)
  })

  it('Assault has one blank, one double-hit-self, one double-hit, and self/intercept faces', () => {
    const dist = faceDistribution('Assault')
    expect(dist.filter((f) => total(f) === 0)).toHaveLength(1)
    expect(dist.filter((f) => f.hits === 2 && f.self === 1)).toHaveLength(1)
    expect(dist.filter((f) => f.hits === 2 && f.self === 0)).toHaveLength(1)
    expect(dist.filter((f) => f.hits === 1 && f.self === 1)).toHaveLength(2)
    expect(dist.filter((f) => f.hits === 1 && f.intercept === 1)).toHaveLength(1)
  })

  it('Raid carries keys, building hits and intercepts', () => {
    const dist = faceDistribution('Raid')
    expect(dist.filter((f) => f.keys === 2 && f.intercept === 1)).toHaveLength(1)
    expect(dist.filter((f) => f.keys === 1 && f.buildings === 1)).toHaveLength(1)
    expect(dist.filter((f) => f.keys === 1 && f.self === 1)).toHaveLength(1)
    expect(dist.filter((f) => f.buildings === 1 && f.self === 1)).toHaveLength(2)
    expect(dist.filter((f) => f.intercept === 1 && total(f) === 1)).toHaveLength(1)
  })

  it('rolling is deterministic in the seed', () => {
    const a = rollPool(rng(42), { skirmish: 3, assault: 2, raid: 1 })[0]
    const b = rollPool(rng(42), { skirmish: 3, assault: 2, raid: 1 })[0]
    expect(a).toEqual(b)
  })

  it('over many rolls, a Skirmish die averages ~0.5 hits', () => {
    let current = rng(1)
    let hits = 0
    const N = 6000
    for (let i = 0; i < N; i++) {
      const [face, next] = rollDie(current, 'Skirmish')
      hits += face.hits
      current = next
    }
    expect(hits / N).toBeGreaterThan(0.42)
    expect(hits / N).toBeLessThan(0.58)
  })
})

describe('battle resolution', () => {
  // Build a controlled position: red and yellow ships together in one system, then have
  // red attack. We reach it by driving a real game to a Battle menu.
  it('a resolved battle conserves pieces (moved to reserve/trophies, never vanished)', () => {
    const seed = seededBattle()
    if (seed === undefined) return // no battle reachable this seed within the budget
    const { before, after, attacker, enemy } = seed

    const totalPieces = (s: GameState, color: FactionId) =>
      s.board.systems.reduce((n, sys) => n + owned(s, Location.system(sys), color), 0) +
      owned(s, Location.reserve(color), color) +
      owned(s, Location.trophies(attacker), color) // enemy pieces may now be red's trophies

    // Enemy pieces are conserved across board + reserve + attacker's trophies.
    expect(totalPieces(after, enemy)).toBe(totalPieces(before, enemy))
    // Attacker pieces are conserved across board + reserve.
    const attackerPieces = (s: GameState) =>
      s.board.systems.reduce((n, sys) => n + owned(s, Location.system(sys), attacker), 0) +
      owned(s, Location.reserve(attacker), attacker)
    expect(attackerPieces(after)).toBe(attackerPieces(before))
  })

  it('logs the roll and its outcome', () => {
    const seed = seededBattle()
    if (seed === undefined) return
    expect(seed.after.log.some((l) => l.includes('attacks') && l.includes('rolled'))).toBe(true)
  })

  it('is deterministic: same seed reaches the same post-battle state', () => {
    const a = seededBattle(31)
    const b = seededBattle(31)
    if (a === undefined || b === undefined) {
      expect(a).toEqual(b)
      return
    }
    expect(a.after.damaged).toEqual(b.after.damaged)
    expect(a.after.log).toEqual(b.after.log)
  })
})

describe('player-directed hit assignment', () => {
  // These dispatch crafted `battle/hit` actions against a real battle position so we control
  // exactly which piece each hit lands on — the behaviour the old auto-resolver hid.

  it('a fresh enemy ship takes two hits: first damages, second destroys into the attacker trophies', () => {
    const pos = battlePosition((state, sys, atk, enemy) => enemyShips(state, sys, enemy, atk).length > 0)
    if (pos === undefined) return
    const { state, system, attacker, enemy, then } = pos
    const ship = enemyShips(state, system, enemy, attacker)[0]!
    const ctx = resolveCtx(attacker, system, enemy, { ships: 2 }, then)

    const damagedState = advance(state, hitAction(ctx, 'ships', ship), registry).state
    expect(damagedState.damaged).toContain(ship)
    expect(contentsOf(damagedState.figures, Location.system(system))).toContain(ship)

    const ctx2 = resolveCtx(attacker, system, enemy, { ships: 1 }, then)
    const destroyedState = advance(damagedState, hitAction(ctx2, 'ships', ship), registry).state
    expect(destroyedState.damaged).not.toContain(ship)
    expect(contentsOf(destroyedState.figures, Location.trophies(attacker))).toContain(ship)
    expect(contentsOf(destroyedState.figures, Location.system(system))).not.toContain(ship)
  })

  it("a self-hit destroys the attacker's own ship back to reserve, never to trophies", () => {
    const pos = battlePosition((state, sys, atk) => ownShips(state, sys, atk).length > 0)
    if (pos === undefined) return
    const { state, system, attacker, enemy, then } = pos
    const ship = ownShips(state, system, attacker)[0]!

    const dmg = advance(state, hitAction(resolveCtx(attacker, system, enemy, { self: 2 }, then), 'self', ship), registry).state
    const gone = advance(dmg, hitAction(resolveCtx(attacker, system, enemy, { self: 1 }, then), 'self', ship), registry).state
    expect(contentsOf(gone.figures, Location.reserve(attacker))).toContain(ship)
    expect(contentsOf(gone.figures, Location.trophies(attacker))).not.toContain(ship)
    expect(contentsOf(gone.figures, Location.trophies(enemy))).not.toContain(ship)
  })

  it('razing an enemy City destroys it to trophies and outrages the attacker', () => {
    const pos = battlePosition((state, sys, atk, enemy) => enemyCities(state, sys, enemy).length > 0)
    if (pos === undefined) return
    const { state, system, attacker, enemy, then } = pos
    const city = enemyCities(state, system, enemy)[0]!
    const outrageBefore = (state.outraged[attacker] ?? []).length

    // One building hit damages the fresh City; the second razes it. Assignment then comes to
    // rest on a confirm step rather than committing itself, so the player can still start over —
    // the raid and the outrage only run once that confirm is taken.
    const dmg = advance(state, hitAction(resolveCtx(attacker, system, enemy, { buildings: 2 }, then), 'buildings', city), registry).state
    const placed = advance(dmg, hitAction(resolveCtx(attacker, system, enemy, { buildings: 1 }, then), 'buildings', city), registry)

    expect(placed.continue.kind).toBe('ask')
    const confirm = (placed.continue as Extract<Continue, { kind: 'ask' }>).actions.find(
      (a) => a.type === 'battle/finish',
    )
    expect(confirm).toBeDefined()
    const r = advance(placed.state, confirm!, registry)

    expect(contentsOf(r.state.figures, Location.trophies(attacker))).toContain(city)
    // Cities never stand on gates, so the razed world always has a resource to be outraged at.
    expect((r.state.outraged[attacker] ?? []).length).toBeGreaterThan(outrageBefore)
  })
})

describe('a roll is always shown to the player', () => {
  /*
   * A roll that leaves nothing to assign — all dice blank, or hits with no surviving target —
   * used to finish inside the same `advance` that rolled it. `battle/finish` clears `lastRoll`,
   * so the UI never observed a state holding the roll and the dice never appeared: the player
   * spent a pip and saw nothing. Every roll must now come to rest on an ask with `lastRoll` set.
   */
  it('every battle roll stops on an ask with the dice still in state, including whiffs', () => {
    let rolls = 0
    let whiffs = 0

    for (let seed = 1; seed <= 25; seed++) {
      let step = startGame({ board: 'Board3MixUp', factions: THREE, seed }, registry)
      for (let i = 0; i < 2500; i++) {
        const c = step.continue
        if (c.kind === 'gameOver' || c.kind !== 'ask') break

        const rollOpt = c.actions.find((a) => a.type === 'battle/roll')
        if (rollOpt) {
          const after = advance(step.state, rollOpt, registry)
          rolls++
          // The dice are still in state, and the engine is waiting on the player.
          expect(after.state.lastRoll).toBeDefined()
          expect(after.continue.kind).toBe('ask')

          const asked = after.continue as Extract<Continue, { kind: 'ask' }>
          const isWhiff = asked.actions.every((a) => a.type !== 'battle/hit')
          if (isWhiff) {
            whiffs++
            // Nothing to place, so the only thing on offer is to acknowledge and move on.
            expect(asked.actions.some((a) => a.type === 'battle/finish')).toBe(true)
          }
          step = after
          continue
        }
        step = advance(step.state, battlePolicy({ kind: 'ask', actions: c.actions }), registry)
      }
    }

    // Guard against the assertions above passing only because the case never arose.
    expect(rolls).toBeGreaterThan(0)
    expect(whiffs).toBeGreaterThan(0)
  })
})

describe('a full game with battles still terminates', () => {
  it('reaches game over under a battle-seeking policy', () => {
    const result = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 4 }, battlePolicy)
    expect(result.continue.kind).toBe('gameOver')
    expect(result.state.isOver).toBe(true)
  })
})

// --- helpers ---------------------------------------------------------------

function total(t: ReturnType<typeof emptyTally>): number {
  return t.self + t.intercept + t.hits + t.buildings + t.keys
}

/** Reconstruct the six-face multiset of a die by sampling and dividing by expected frequency. */
function faceDistribution(die: 'Skirmish' | 'Assault' | 'Raid') {
  const freq = new Map<string, { face: ReturnType<typeof emptyTally>; n: number }>()
  let current = rng(999)
  const N = 60000
  for (let i = 0; i < N; i++) {
    const [face, next] = rollDie(current, die)
    current = next
    const key = JSON.stringify(face)
    const e = freq.get(key) ?? { face, n: 0 }
    e.n++
    freq.set(key, e)
  }
  const out: ReturnType<typeof emptyTally>[] = []
  for (const { face, n } of freq.values()) {
    const copies = Math.round(n / (N / 6))
    for (let i = 0; i < copies; i++) out.push(face)
  }
  return out
}

function owned(state: GameState, location: string, color: string): number {
  return contentsOf(state.figures, location).filter((id) => id.startsWith(`${color}/`)).length
}

interface BattleSeed {
  before: GameState
  after: GameState
  attacker: FactionId
  enemy: FactionId
}

/**
 * Drive a game until a Battle can be declared and resolved. Returns undefined if none is
 * reachable within the step budget (some seeds never co-locate opposing ships early).
 */
function seededBattle(seed = 4, limit = 4000): BattleSeed | undefined {
  let step = startGame({ board: 'Board3MixUp', factions: THREE, seed }, registry)
  let before: GameState | undefined
  let attacker: FactionId | undefined
  let enemy: FactionId | undefined

  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind === 'gameOver') return undefined
    if (c.kind !== 'ask') return undefined

    // The moment a concrete roll is on offer, capture state and fire it, then drive the
    // interactive hit assignment to completion (pick the first target for each hit).
    const rollOpt = c.actions.find((a) => a.type === 'battle/roll')
    if (rollOpt) {
      before = step.state
      attacker = rollOpt['faction'] as FactionId
      enemy = rollOpt['enemy'] as FactionId
      let r = advance(step.state, rollOpt, registry)
      for (let g = 0; g < 200; g++) {
        const cc = r.continue
        if (cc.kind !== 'ask') break
        const hit = cc.actions.find((a) => a.type === 'battle/hit')
        if (!hit) break
        r = advance(r.state, hit, registry)
      }
      return { before, after: r.state, attacker, enemy }
    }

    step = advance(step.state, battlePolicy({ kind: 'ask', actions: c.actions }), registry)
  }
  return undefined
}

type Policy = (c: { kind: 'ask'; actions: readonly Action[] }) => Action

/** Seeks battles: declare, target, and roll a small pool when offered; else progress. */
const battlePolicy: Policy = (c) => {
  const hit = c.actions.find((a) => a.type === 'battle/hit')
  if (hit) return hit
  const roll = c.actions.find((a) => a.type === 'battle/roll')
  if (roll) return roll
  const sys = c.actions.find((a) => a.type === 'battle/system')
  if (sys) return sys
  const target = c.actions.find((a) => a.type === 'battle/target')
  if (target) return target
  const battle = c.actions.find((a) => a['label'] === 'Battle')
  if (battle) return battle
  const move = c.actions.find((a) => a.type === 'action/move-ship')
  if (move) return move
  const moveMenu = c.actions.find((a) => a['label'] === 'Move')
  if (moveMenu) return moveMenu
  const lead = c.actions.find((a) => a.type === 'turn/lead')
  if (lead) return lead
  const declare = c.actions.find((a) => a.type === 'ambition/declare')
  if (declare) return declare
  return (
    c.actions.find((a) => a.type === 'turn/end') ??
    c.actions.find((a) => a.type === 'turn/skip-seize') ??
    c.actions.find((a) => a.type === 'ambition/skip-declare') ??
    c.actions.find((a) => a.type === 'turn/pass') ??
    c.actions[0]!
  )
}

// --- controlled hit-assignment helpers -------------------------------------

interface Position {
  state: GameState
  system: SystemId
  attacker: FactionId
  enemy: FactionId
  then: unknown
}

type PositionPredicate = (state: GameState, system: SystemId, attacker: FactionId, enemy: FactionId) => boolean

/**
 * Scan seeds for the first battle position (a `battle/roll` on offer) that satisfies the
 * predicate, returning the pre-roll state and the battle's coordinates. Returns undefined if
 * none is found within the budget, so tests skip rather than fail on an unlucky search.
 */
function battlePosition(predicate: PositionPredicate, seeds = 40, limit = 3000): Position | undefined {
  for (let seed = 1; seed <= seeds; seed++) {
    let step = startGame({ board: 'Board3MixUp', factions: THREE, seed }, registry)
    for (let i = 0; i < limit; i++) {
      const c = step.continue
      if (c.kind === 'gameOver') break
      if (c.kind !== 'ask') break
      const rollOpt = c.actions.find((a) => a.type === 'battle/roll')
      if (rollOpt) {
        const system = rollOpt['system'] as SystemId
        const attacker = rollOpt['faction'] as FactionId
        const enemy = rollOpt['enemy'] as FactionId
        if (predicate(step.state, system, attacker, enemy)) {
          return { state: step.state, system, attacker, enemy, then: rollOpt['then'] }
        }
        step = advance(step.state, rollOpt, registry) // resolve this battle, look for the next
        continue
      }
      step = advance(step.state, battlePolicy({ kind: 'ask', actions: c.actions }), registry)
    }
  }
  return undefined
}

function inSystem(state: GameState, system: SystemId, color: string, piece: string): string[] {
  return contentsOf(state.figures, Location.system(system)).filter((id) => {
    const f = parseFigureId(id)
    return f.color === color && f.piece === piece
  })
}

const ownShips = (s: GameState, sys: SystemId, atk: FactionId) => inSystem(s, sys, atk, 'Ship')
const enemyShips = (s: GameState, sys: SystemId, enemy: FactionId, _atk: FactionId) =>
  inSystem(s, sys, enemy, 'Ship')
const enemyCities = (s: GameState, sys: SystemId, enemy: FactionId) => inSystem(s, sys, enemy, 'City')

/** Build a journal-safe Resolve context; counts default to zero, overridden per test. */
function resolveCtx(
  attacker: FactionId,
  system: SystemId,
  enemy: FactionId,
  counts: { self?: number; ships?: number; buildings?: number; keys?: number; razed?: boolean },
  then: unknown,
): Record<string, unknown> {
  return {
    faction: attacker,
    system,
    enemy,
    self: counts.self ?? 0,
    ships: counts.ships ?? 0,
    buildings: counts.buildings ?? 0,
    keys: counts.keys ?? 0,
    razed: counts.razed ?? false,
    then,
  }
}

const hitAction = (ctx: Record<string, unknown>, phase: 'self' | 'ships' | 'buildings', target: string): Action =>
  ({ type: 'battle/hit', ctx, phase, target }) as unknown as Action

function playToEnd(options: Parameters<typeof startGame>[0], policy: Policy, limit = 12000): RuleResult {
  let step = startGame(options, registry)
  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind === 'gameOver') return step
    if (c.kind !== 'ask') throw new Error(`unexpected ${c.kind}`)
    step = advance(step.state, policy(c), registry)
  }
  throw new Error('game did not terminate')
}

export type _C = Continue

/**
 * Found by mutation testing while adding Galactic Rifles: setting the battle roll's `ships` count
 * to zero broke nothing in the whole suite. Everything above tests the dice, the hit *mechanics*
 * and the outcome of driven games, but nothing tied the number rolled to the number assignable.
 */
describe('a battle roll offers as many hits as it rolled', () => {
  it('turns rolled hits into assignable hits on the enemy', () => {
    const registry2 = defaultRegistry()
    for (let seed = 1; seed < 80; seed++) {
      const s0 = startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry2).state
      const system = s0.board.systems[0]!

      // one contested system, nothing else in it
      const contents = new Map(s0.figures.contents)
      const at = new Map(s0.figures.at)
      const dest = Location.system(system)
      for (const id of contents.get(dest) ?? []) {
        const c = id.slice(0, id.indexOf('/'))
        contents.set(`reserve:${c}`, [...(contents.get(`reserve:${c}`) ?? []), id])
        at.set(id, `reserve:${c}`)
      }
      contents.set(dest, [])
      const put = (col: string, n: number): void => {
        const r = `reserve:${col}`
        const picked = (contents.get(r) ?? []).filter((i) => i.startsWith(`${col}/Ship/`)).slice(0, n)
        contents.set(r, (contents.get(r) ?? []).filter((i) => !picked.includes(i)))
        contents.set(dest, [...(contents.get(dest) ?? []), ...picked])
        picked.forEach((i) => at.set(i, dest))
      }
      put('red', 4)
      put('yellow', 4)
      const s = { ...s0, figures: { ...s0.figures, contents, at } }

      const out = advance(
        s,
        {
          type: 'battle/roll', faction: 'red', system, enemy: 'yellow',
          skirmish: 4, assault: 0, raid: 0, then: { type: 'turn/lead-main', faction: 'red' },
        },
        registry2,
      )
      const line = out.state.log.at(-1) ?? ''
      const rolled = Number(/([0-9]+) hits/.exec(line)?.[1] ?? '0')
      if (rolled === 0) continue

      const c = out.continue
      if (c.kind !== 'ask') throw new Error('expected an assignment ask')
      const targets = c.actions.filter((a) => a.type === 'battle/hit')
      expect(targets.length).toBeGreaterThan(0)
      expect(targets.every((a) => String(a['label']).includes('yellow'))).toBe(true)
      return
    }
    throw new Error('no seed under 80 rolled a hit from four skirmish dice')
  })
})

/**
 * Raiding: keys buy resources *or* guild cards, and which is the raider's decision.
 *
 * It used to sweep resources automatically, cheapest-first, and could not take a card at all.
 */
describe('the raid spends keys on a choice', () => {
  const reg3 = defaultRegistry()
  const STOP3 = { type: 'turn/lead-main', faction: 'red' } as const

  /** yellow holding one resource and one guild card, red attacking with `keys`. */
  function loot(keys: number, opts: { guardians?: boolean } = {}) {
    const base = startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, reg3).state
    const system = base.board.systems[0]!

    // empty yellow's slots, give it exactly one Fuel
    const rc = new Map(base.resources.contents)
    const ra = new Map(base.resources.at)
    for (let i = 0; i < 6; i++) {
      const slot = `cityslot:yellow:${i}`
      for (const t of rc.get(slot) ?? []) {
        const sup = `supply:${t.slice(0, t.indexOf('#'))}`
        rc.set(sup, [...(rc.get(sup) ?? []), t]); ra.set(t, sup)
      }
      rc.set(slot, [])
    }
    let s: GameState = { ...base, resources: { ...base.resources, contents: rc, at: ra } }
    // Slot key costs are [3,1,1,2,1,3]; slot 1 is a 1-key slot, so the cheap option is genuinely
    // cheap and the 2-key guild card sits between it and the dear slots.
    s = { ...s, resources: gain(s.resources, [slotsOf(s, 'yellow')[1]!], 'Fuel').tracker }

    // and a guild card — bc02 Mining Interest, 2 keys
    const cc = new Map(s.courtCards.contents)
    const ca = new Map(s.courtCards.at)
    for (const id of ['bc02', ...(opts.guardians === true ? ['bc22'] : [])]) {
      const from = ca.get(id)
      if (from !== undefined) cc.set(from, (cc.get(from) ?? []).filter((c) => c !== id))
      cc.set(CourtPile.secured('yellow'), [...(cc.get(CourtPile.secured('yellow')) ?? []), id])
      ca.set(id, CourtPile.secured('yellow'))
    }
    s = { ...s, courtCards: { ...s.courtCards, contents: cc, at: ca } }

    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 0, intercepted: 0, ships: 0, buildings: 0, keys, razed: false,
      then: STOP3,
    }
    return { state: s, ctx }
  }

  /** Only the raid's own options — a blocked raid falls straight through to the next ask. */
  function raidMenu(keys: number, opts: { guardians?: boolean } = {}): string[] {
    const { state, ctx } = loot(keys, opts)
    const c = advance(state, { type: 'battle/finish', ctx }, reg3).continue
    if (c.kind !== 'ask') return []
    return c.actions
      .filter((a) => a.type === 'battle/raid-take' || a.type === 'battle/settle')
      .map((a) => String(a['label']))
  }

  it('offers both the resource and the guild card when the keys reach', () => {
    const menu = raidMenu(3)
    expect(menu.some((l) => l.startsWith('Take Fuel'))).toBe(true)
    expect(menu.some((l) => l.includes('Mining Interest'))).toBe(true)
    expect(menu.some((l) => l.startsWith('Stop raiding'))).toBe(true)
  })

  it('withholds what the keys cannot afford', () => {
    const menu = raidMenu(1)
    expect(menu.some((l) => l.startsWith('Take Fuel'))).toBe(true)
    expect(menu.some((l) => l.includes('Mining Interest'))).toBe(false)
  })

  it('really takes the guild card, into the raider’s secured pile', () => {
    const { state, ctx } = loot(3)
    const first = advance(state, { type: 'battle/finish', ctx }, reg3)
    if (first.continue.kind !== 'ask') throw new Error('expected a raid ask')
    const takeCard = first.continue.actions.find((a) => String(a['label']).includes('Mining Interest'))!
    const after = advance(first.state, takeCard, reg3)

    expect(contentsOf(after.state.courtCards, CourtPile.secured('red'))).toContain('bc02')
    expect(contentsOf(after.state.courtCards, CourtPile.secured('yellow'))).not.toContain('bc02')
    expect(after.state.log.join('\n')).toContain('raided Mining Interest')
  })

  it('spends the keys, so a 2-key card leaves one for the 1-key slot', () => {
    const { state, ctx } = loot(3)
    const first = advance(state, { type: 'battle/finish', ctx }, reg3)
    if (first.continue.kind !== 'ask') throw new Error('expected a raid ask')
    const takeCard = first.continue.actions.find((a) => String(a['label']).includes('Mining Interest'))!
    const after = advance(first.state, takeCard, reg3)
    if (after.continue.kind !== 'ask') throw new Error('expected the raid to carry on')
    const labels = after.continue.actions.map((a) => String(a['label']))
    expect(labels).toContain('Stop raiding (1 key(s) left)')
    // one key still buys the 1-key slot, and nothing dearer is on offer
    expect(labels.some((l) => l.startsWith('Take Fuel'))).toBe(true)
    expect(labels.some((l) => l.includes('Mining Interest'))).toBe(false)
  })

  it('withholds a resource sitting in a slot the keys cannot afford', () => {
    // Slot 0 costs three keys; with one, the Fuel there is out of reach even though a 2-key card
    // would not be. This is the branch that a cost check on cards alone would miss.
    const base = startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, reg3).state
    const rc = new Map(base.resources.contents)
    const ra = new Map(base.resources.at)
    for (let i = 0; i < 6; i++) {
      const slot = `cityslot:yellow:${i}`
      for (const t of rc.get(slot) ?? []) {
        const sup = `supply:${t.slice(0, t.indexOf('#'))}`
        rc.set(sup, [...(rc.get(sup) ?? []), t]); ra.set(t, sup)
      }
      rc.set(slot, [])
    }
    let s: GameState = { ...base, resources: { ...base.resources, contents: rc, at: ra } }
    const dear = slotsOf(s, 'yellow').find((x) => slotKeys(x) === 3)!
    s = { ...s, resources: gain(s.resources, [dear], 'Fuel').tracker }

    const system = s.board.systems[0]!
    const ctx = {
      faction: 'red', system, enemy: 'yellow',
      self: 0, intercepted: 0, ships: 0, buildings: 0, keys: 1, razed: false,
      then: STOP3,
    }
    const c = advance(s, { type: 'battle/finish', ctx }, reg3).continue
    const takes = c.kind === 'ask' ? c.actions.filter((a) => a.type === 'battle/raid-take') : []
    expect(takes).toHaveLength(0)
  })

  it('Sworn Guardians stops the whole raid, cards included', () => {
    expect(raidMenu(6, { guardians: true })).toHaveLength(0)
  })
})
