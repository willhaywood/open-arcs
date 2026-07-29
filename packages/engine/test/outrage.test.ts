import { describe, expect, it } from 'vitest'

import {
  CourtPile,
  ResourceSlot,
  advance,
  applyExternal,
  canSpendForPrelude,
  citiesInReserve,
  clearOutrage,
  contentsOf,
  countResource,
  defaultRegistry,
  gain,
  isOutraged,
  slotsOf,
  loadGame,
  outragedResources,
  provokeOutrage,
  serializeGame,
  slotCapacity,
  startGame,
  supplyOf,
  system as systemInfo,
} from '../src/index.js'
import type { Action, Continue, GameState, RuleResult } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const FOUR = ['red', 'yellow', 'blue', 'white'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed }, registry).state
}

/**
 * Put up to `n` tokens of `r` into a faction's slots. Setup already leaves two resources in
 * hand and capacity starts at three, so a gain can be declined for want of an open slot —
 * the count actually placed is returned rather than assumed.
 */
function give(state: GameState, faction: 'red' | 'yellow' | 'blue', r: 'Fuel' | 'Relic', n: number) {
  const capacity = slotsOf(state, faction)
  let resources = state.resources
  let placed = 0
  for (let i = 0; i < n; i++) {
    const got = gain(resources, capacity, r)
    if (!got.gained) break
    resources = got.tracker
    placed++
  }
  return { state: { ...state, resources }, placed, capacity }
}

describe('outrage state', () => {
  it('starts empty for every faction', () => {
    const state = fresh()
    for (const f of THREE) expect(outragedResources(state, f)).toEqual([])
  })

  it('marks the type and blocks it for the Prelude', () => {
    const after = provokeOutrage(fresh(), 'red', 'Fuel')
    expect(isOutraged(after, 'red', 'Fuel')).toBe(true)
    expect(canSpendForPrelude(after, 'red', 'Fuel')).toBe(false)
    // Only that type, and only that faction.
    expect(canSpendForPrelude(after, 'red', 'Relic')).toBe(true)
    expect(isOutraged(after, 'yellow', 'Fuel')).toBe(false)
  })

  it('discards every token of that resource back to the supply', () => {
    const { state, placed, capacity } = give(fresh(), 'red', 'Fuel', 2)
    expect(placed).toBeGreaterThan(0)
    const held = countResource(state.resources, capacity, 'Fuel')
    expect(held).toBe(placed)
    const supplyBefore = supplyOf(state.resources, 'Fuel').length

    const after = provokeOutrage(state, 'red', 'Fuel')

    expect(countResource(after.resources, capacity, 'Fuel')).toBe(0)
    expect(supplyOf(after.resources, 'Fuel')).toHaveLength(supplyBefore + held)
  })

  it('leaves other resources in their slots', () => {
    const base = fresh()
    const capacity = slotsOf(base, 'red')
    const before = countResource(base.resources, capacity, 'Relic')
    const { state } = give(base, 'red', 'Fuel', 1)
    const after = provokeOutrage(state, 'red', 'Fuel')
    expect(countResource(after.resources, capacity, 'Relic')).toBe(before)
    expect(countResource(after.resources, capacity, 'Fuel')).toBe(0)
  })

  it('sweeps slots beyond current capacity, which losing a city can strand', () => {
    // Place a token directly into the last slot, which capacity never reaches at setup.
    let state = fresh()
    const token = supplyOf(state.resources, 'Fuel')[0]!
    const last = ResourceSlot.citySlot('red', 5)
    state = {
      ...state,
      resources: { ...state.resources, ...moveInto(state.resources, token, last) },
    }
    expect(contentsOf(state.resources, last)).toContain(token)

    const after = provokeOutrage(state, 'red', 'Fuel')
    expect(contentsOf(after.resources, last)).toHaveLength(0)
  })

  it('provoking again still discards, as HRF does', () => {
    const first = provokeOutrage(give(fresh(), 'red', 'Fuel', 1).state, 'red', 'Fuel')
    const regained = give(first, 'red', 'Fuel', 1)
    expect(regained.placed).toBe(1)
    const capacity = regained.capacity
    expect(countResource(regained.state.resources, capacity, 'Fuel')).toBe(1)

    const after = provokeOutrage(regained.state, 'red', 'Fuel')
    expect(countResource(after.resources, capacity, 'Fuel')).toBe(0)
    // Still one entry, not two.
    expect(outragedResources(after, 'red')).toEqual(['Fuel'])
    expect(after.log.at(-1)).toMatch(/again/)
  })

  it('clears only the named types', () => {
    let state = provokeOutrage(fresh(), 'red', 'Fuel')
    state = provokeOutrage(state, 'red', 'Relic')
    const after = clearOutrage(state, 'red', ['Fuel'])
    expect(outragedResources(after, 'red')).toEqual(['Relic'])
  })
})

/**
 * The rule that is easy to get backwards: HRF applies `OutrageAction` to the *battling*
 * faction — the one taking trophies — not to the player whose city was razed. These games
 * are driven with a battle-seeking policy until some city falls, then the log is checked
 * line by line: the faction that provoked must be the attacker of the battle it came from,
 * and the resource must be the one that system produces.
 */
describe('outrage from battle', () => {
  const BATTLE_LINE = /^(\w+) attacks (\w+) in ([\w-]+):/
  const OUTRAGE_LINE = /^(\w+) provoked (\w+) outrage/

  function corpus(): { seed: number; outrages: number; state: GameState }[] {
    const out: { seed: number; outrages: number; state: GameState }[] = []
    for (let seed = 1; seed <= 40; seed++) {
      const result = playToEnd({ board: 'Board4MixUp1', factions: [...FOUR], seed })
      const n = result.state.log.filter((l) => OUTRAGE_LINE.test(l)).length
      out.push({ seed, outrages: n, state: result.state })
    }
    return out
  }

  const games = corpus()

  it('fires at all — a razed city outrages somebody', () => {
    const total = games.reduce((n, g) => n + g.outrages, 0)
    expect(total).toBeGreaterThan(0)
  })

  it('outrages the attacker, for the resource of the system attacked', () => {
    let checked = 0
    for (const { state } of games) {
      let lastBattle: RegExpExecArray | null = null
      for (const line of state.log) {
        const battle = BATTLE_LINE.exec(line)
        if (battle) {
          lastBattle = battle
          continue
        }
        const outrage = OUTRAGE_LINE.exec(line)
        if (!outrage) continue

        expect(lastBattle).not.toBeNull()
        const [, attacker, , where] = lastBattle!
        // The provoker is the attacker, never the defender.
        expect(outrage[1]).toBe(attacker)
        expect(outrage[2]).toBe(systemInfo(where!).resource)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('every logged outrage is present in final state', () => {
    for (const { state } of games) {
      for (const line of state.log) {
        const m = OUTRAGE_LINE.exec(line)
        if (!m) continue
        expect(outragedResources(state, m[1] as 'red')).toContain(m[2])
      }
    }
  })

  /**
   * Outrage is not in the save file — the journal is, and outrage has to fall back out of
   * replaying it. That only works if the game was driven through `applyExternal`, which is
   * what records the journal; `advance` alone leaves it empty and the reload starts fresh.
   */
  it('survives a save/load round trip', () => {
    const withOutrage = games.find((g) => g.outrages > 0)
    expect(withOutrage).toBeDefined()

    const options = { board: 'Board4MixUp1', factions: [...FOUR], seed: withOutrage!.seed }
    const played = playToEnd(options, seekBattle, 12000, true)
    expect(played.state.journal.length).toBeGreaterThan(0)
    expect(FOUR.some((f) => outragedResources(played.state, f).length > 0)).toBe(true)

    const reloaded = loadGame(serializeGame(options, played), registry)
    for (const f of FOUR) {
      expect(outragedResources(reloaded.result.state, f)).toEqual(outragedResources(played.state, f))
    }
  })
})

// --- helpers ---------------------------------------------------------------

/** Minimal direct placement, to reach a slot the normal `gain` path never fills. */
function moveInto(tracker: GameState['resources'], token: string, to: string) {
  const at = new Map(tracker.at)
  const contents = new Map(tracker.contents)
  const from = at.get(token)
  if (from !== undefined) {
    contents.set(from, (contents.get(from) ?? []).filter((t) => t !== token))
  }
  at.set(token, to)
  contents.set(to, [...(contents.get(to) ?? []), token])
  return { at, contents }
}

type Policy = (c: Extract<Continue, { kind: 'ask' }>) => Action

/**
 * Seeks battles that actually raze buildings. Two details matter, and both cost a debugging
 * round to find: the policy has to **move ships** or opposing fleets never co-locate and no
 * battle is ever offered at all; and the dice pool is chosen *among the `battle/roll`
 * options*, so taking the first one takes the smallest pool. Raid dice are what strike
 * buildings, so the biggest raid-heavy pool is the one that reaches a city.
 */
const seekBattle: Policy = (c) => {
  const rolls = c.actions.filter((a) => a.type === 'battle/roll')
  if (rolls.length > 0) {
    const score = (x: Action) =>
      Number(x['raid'] ?? 0) * 100 +
      Number(x['skirmish'] ?? 0) +
      Number(x['assault'] ?? 0) +
      Number(x['raid'] ?? 0)
    return rolls.reduce((best, a) => (score(a) > score(best) ? a : best))
  }
  for (const t of ['battle/system', 'battle/target', 'battle/declare']) {
    const a = c.actions.find((x) => x.type === t)
    if (a) return a
  }
  const menu = c.actions.find((a) => a['label'] === 'Battle')
  if (menu) return menu
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

function playToEnd(
  options: Parameters<typeof startGame>[0],
  policy: Policy = seekBattle,
  limit = 12000,
  journal = false,
): RuleResult {
  let step = startGame(options, registry)
  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind === 'gameOver') return step
    if (c.kind !== 'ask') throw new Error(`unexpected ${c.kind}`)
    const action = policy(c)
    step = journal ? applyExternal(step, action, registry) : advance(step.state, action, registry)
  }
  throw new Error('game did not terminate')
}

describe('outrage costs you the Guild cards of that suit', () => {
  const registry2 = defaultRegistry()
  const start = (): GameState =>
    startGame({ board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 1 }, registry2).state

  /** Put a court card straight into a faction's secured pile. */
  function secure(state: GameState, faction: 'red', cardId: string): GameState {
    const contents = new Map(state.courtCards.contents)
    const at = new Map(state.courtCards.at)
    const from = at.get(cardId)
    if (from !== undefined) {
      contents.set(from, (contents.get(from) ?? []).filter((c) => c !== cardId))
    }
    const pile = CourtPile.secured(faction)
    contents.set(pile, [...(contents.get(pile) ?? []), cardId])
    at.set(cardId, pile)
    return { ...state, courtCards: { ...state.courtCards, contents, at } }
  }

  const held = (s: GameState): readonly string[] => contentsOf(s.courtCards, CourtPile.secured('red'))

  it('discards a secured Guild card whose suit is outraged', () => {
    // bc02 Mining Interest is a Material guild, and not Loyal.
    const s = secure(start(), 'red', 'bc02')
    expect(held(s)).toContain('bc02')
    const after = provokeOutrage(s, 'red', 'Material')
    expect(held(after)).not.toContain('bc02')
    expect(contentsOf(after.courtCards, CourtPile.discard())).toContain('bc02')
    expect(after.log.join('\n')).toContain('lost')
  })

  it('leaves cards of other suits alone', () => {
    const s = secure(start(), 'red', 'bc02')
    expect(held(provokeOutrage(s, 'red', 'Fuel'))).toContain('bc02')
  })

  it('keeps a Loyal guild — that is the first line on all five of them', () => {
    // bc01 Loyal Engineers is a Material guild, and Loyal.
    const s = secure(start(), 'red', 'bc01')
    expect(held(provokeOutrage(s, 'red', 'Material'))).toContain('bc01')
  })

  it('keeps every guild while Guild Loyalty is held', () => {
    const s = { ...secure(start(), 'red', 'bc02'), lores: { red: ['lore29'] } }
    expect(held(provokeOutrage(s, 'red', 'Material'))).toContain('bc02')
  })

  it('takes several at once, and only the matching ones', () => {
    let s = secure(start(), 'red', 'bc02')   // Material guild
    s = secure(s, 'red', 'bc03')             // Material guild
    s = secure(s, 'red', 'bc01')             // Material, Loyal
    s = secure(s, 'red', 'bc09')             // Fuel guild
    const after = provokeOutrage(s, 'red', 'Material')
    expect(held(after)).toEqual(expect.arrayContaining(['bc01', 'bc09']))
    expect(held(after)).not.toContain('bc02')
    expect(held(after)).not.toContain('bc03')
  })
})
