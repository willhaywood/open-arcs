import { describe, expect, it } from 'vitest'

import {
  slotsOf,
  canBattle,
  SUIT_ACTIONS,
  advance,
  citiesInReserve,
  countResource,
  defaultRegistry,
  gain,
  preludeGrants,
  preludeOffers,
  provokeOutrage,
  slotCapacity,
  spendable,
  startGame,
} from '../src/index.js'
import type { Action, Continue, GameState, Resource, RuleResult } from '../src/index.js'

const FOUR = ['red', 'yellow', 'blue', 'white'] as const
const registry = defaultRegistry()

function fresh(seed = 1): GameState {
  return startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed }, registry).state
}

/** Empty red's slots, then put exactly the given resources in. */
function holding(state: GameState, ...want: Resource[]): GameState {
  let s = state
  // provokeOutrage sweeps a type back to supply; use it to clear, then drop the outrage.
  for (const r of ['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as const) {
    s = provokeOutrage(s, 'red', r)
  }
  s = { ...s, outraged: {}, log: state.log }
  const capacity = slotsOf(s, 'red')
  for (const r of want) {
    const got = gain(s.resources, capacity, r)
    if (!got.gained) throw new Error(`no room for ${r}`)
    s = { ...s, resources: got.tracker }
  }
  return s
}

describe('what a resource buys', () => {
  it('is not the suit map — Fuel buys Move but not Influence', () => {
    expect([...preludeGrants('Fuel', 'Aggression')]).toEqual(['Move'])
    // Mobilization buys both; the resource does not.
    expect([...SUIT_ACTIONS.Mobilization]).toEqual(['Move', 'Influence'])
  })

  it('Material buys Build and Repair, Relic buys Secure', () => {
    expect([...preludeGrants('Material', 'Aggression')]).toEqual(['Build', 'Repair'])
    expect([...preludeGrants('Relic', 'Aggression')]).toEqual(['Secure'])
  })

  it('Weapon buys no action — it buys the Battle option instead', () => {
    expect([...preludeGrants('Weapon', 'Aggression')]).toEqual([])
  })

  it('Psionic buys whatever the lead card buys', () => {
    for (const suit of ['Administration', 'Construction', 'Mobilization', 'Aggression'] as const) {
      expect([...preludeGrants('Psionic', suit)]).toEqual([...SUIT_ACTIONS[suit]])
    }
  })
})

describe('offers', () => {
  it('keys Psionic off the LEAD card, not the card you played', () => {
    const state = holding(fresh(), 'Psionic')
    // Pivoted into Construction, but the lead was Aggression.
    const offers = preludeOffers(state, 'red', 'Construction', 'Aggression')
    const actions = offers.filter((o) => o.kind === 'action').map((o) => o.action)
    expect(actions.sort()).toEqual([...SUIT_ACTIONS.Aggression].sort())
    expect(actions).not.toContain('Build')
  })

  it('offers nothing for an outraged resource, but still lets it be discarded', () => {
    const base = holding(fresh(), 'Material')
    expect(preludeOffers(base, 'red', 'Aggression', 'Aggression').some((o) => o.kind === 'action')).toBe(
      true,
    )

    const angry = provokeOutrage(base, 'red', 'Material')
    // provokeOutrage also discards the token, so put one back to isolate the offer rule.
    const capacity = slotsOf(angry, 'red')
    const withToken = { ...angry, resources: gain(angry.resources, capacity, 'Material').tracker }

    const offers = preludeOffers(withToken, 'red', 'Aggression', 'Aggression')
    expect(offers.some((o) => o.kind === 'action')).toBe(false)
    expect(offers.some((o) => o.kind === 'discard' && o.resource === 'Material')).toBe(true)
  })

  it('offers the Battle option only off-suit, and only once', () => {
    const state = holding(fresh(), 'Weapon')
    const has = (s: GameState, played: 'Aggression' | 'Construction') =>
      preludeOffers(s, 'red', played, 'Construction').some((o) => o.kind === 'battle-option')

    expect(has(state, 'Construction')).toBe(true)
    // Aggression can already battle.
    expect(has(state, 'Aggression')).toBe(false)
    // Already bought.
    expect(has({ ...state, anyBattle: true }, 'Construction')).toBe(false)
  })

  it('reports only what is actually held', () => {
    const state = holding(fresh(), 'Fuel', 'Relic')
    expect(spendable(state, 'red').sort()).toEqual(['Fuel', 'Relic'])
  })
})

describe('the phase, in a real game', () => {
  it('is reached by the lead player, not just followers', () => {
    // The lead player's route runs through the ambitions module, which used to hand
    // straight to the pip loop and skip this phase entirely.
    const seen = drive(20).leadPreludes
    expect(seen).toBeGreaterThan(0)
  })

  it('spends real tokens and never offers an outraged one', () => {
    const r = drive(20)
    expect(r.spends).toBeGreaterThan(0)
    expect(r.outragedOffers).toBe(0)
    expect(r.heldWentDown).toBe(true)
  })

  it('a Weapon adds Battle to a card whose suit cannot buy it', () => {
    const r = drive(20)
    expect(r.weaponsBought).toBeGreaterThan(0)
    expect(r.pipMenusWhileAnyBattle).toBeGreaterThan(0)
    // Every pip menu seen while anyBattle held *and* a battle was reachable offered Battle.
    expect(r.pipMenusWhileAnyBattleWithoutBattle).toBe(0)
  })

  it('does not consume a pip — the action total is untouched', () => {
    expect(drive(20).pipTotalChangedByPrelude).toBe(false)
  })

  it('clears the Battle option at end of turn', () => {
    expect(drive(20).anyBattleLeakedPastTurn).toBe(false)
  })
})

// --- driver ----------------------------------------------------------------

type Ask = Extract<Continue, { kind: 'ask' }>

/**
 * Greedy Prelude policy. Two traps, both of which produced a silent zero when first written:
 * the policy must actually **follow** rather than pass (passing skips the seize check and so
 * the Prelude), and the lead player reaches the Prelude through the ambitions module.
 */
function policy(c: Ask): Action {
  const spend = c.actions.find((a) => a.type === 'turn/prelude-spend')
  if (spend) return spend
  const weapon = c.actions.find((a) => a.type === 'turn/prelude-battle')
  if (weapon) return weapon
  const done = c.actions.find((a) => a.type === 'turn/prelude-done')
  if (done) return done
  const lead = c.actions.find((a) => a.type === 'turn/lead')
  if (lead) return lead
  const follow =
    c.actions.find((a) => a.type === 'turn/surpass') ??
    c.actions.find((a) => a.type === 'turn/pivot') ??
    c.actions.find((a) => a.type === 'turn/copy')
  if (follow) return follow
  return (
    c.actions.find((a) => a.type === 'turn/end') ??
    c.actions.find((a) => a.type === 'turn/skip-seize') ??
    c.actions.find((a) => a.type === 'ambition/skip-declare') ??
    c.actions.find((a) => a.type === 'turn/pass') ??
    c.actions[0]!
  )
}

function drive(seeds: number) {
  let leadPreludes = 0
  let spends = 0
  let weaponsBought = 0
  let outragedOffers = 0
  let heldWentDown = false
  let pipMenusWhileAnyBattle = 0
  let pipMenusWhileAnyBattleWithoutBattle = 0
  let pipTotalChangedByPrelude = false
  let anyBattleLeakedPastTurn = false

  for (let seed = 1; seed <= seeds; seed++) {
    let step: RuleResult = startGame(
      { board: 'Board4MixUp1', factions: [...FOUR], seed },
      registry,
    )
    for (let i = 0; i < 12000; i++) {
      const c = step.continue
      if (c.kind === 'gameOver') break
      if (c.kind !== 'ask') throw new Error(`unexpected ${c.kind}`)

      const inPrelude = c.actions.some((a) => a.type === 'turn/prelude-done')
      if (inPrelude) {
        if (step.state.lead?.faction === c.faction) leadPreludes++
        const out = step.state.outraged[c.faction] ?? []
        for (const a of c.actions) {
          if (a.type === 'turn/prelude-spend' && out.includes(a['resource'] as Resource)) {
            outragedOffers++
          }
        }
      }

      // A pip menu offered while the Battle option is held must include Battle — but only
      // when a battle is actually available. The pip menu now hides actions that could do
      // nothing (`canTake`), so an absent Battle with no enemy in reach is correct.
      const take = c.actions.find((a) => a.type === 'action/take')
      if (take && step.state.anyBattle && canBattle(step.state, c.faction)) {
        const suit = (take['then'] as { suit?: string }).suit
        if (suit && suit !== 'Aggression') {
          pipMenusWhileAnyBattle++
          if (!c.actions.some((a) => a['action'] === 'Battle')) {
            pipMenusWhileAnyBattleWithoutBattle++
          }
        }
      }
      // anyBattle must not survive into another faction's turn.
      if (step.state.anyBattle && step.state.current !== undefined && take) {
        const owner = take['faction']
        if (owner !== step.state.current) anyBattleLeakedPastTurn = true
      }

      const picked = policy(c)
      const before = step.state
      step = advance(before, picked, registry)

      if (picked.type === 'turn/prelude-spend' || picked.type === 'turn/prelude-battle') {
        if (picked.type === 'turn/prelude-battle') weaponsBought++
        else spends++
        const cap = slotsOf(before, c.faction)
        const r = (picked['resource'] as Resource) ?? 'Weapon'
        const was = countResource(before.resources, cap, r)
        const now = countResource(step.state.resources, cap, r)
        if (now < was) heldWentDown = true
      }
      if (picked.type === 'turn/prelude-done') {
        const next = step.continue
        if (next.kind === 'ask') {
          const take2 = next.actions.find((a) => a.type === 'action/take')
          const total = (take2?.['then'] as { total?: number } | undefined)?.total
          if (total !== undefined && total !== (picked['pips'] as number)) {
            pipTotalChangedByPrelude = true
          }
        }
      }
    }
  }

  return {
    leadPreludes,
    spends,
    weaponsBought,
    outragedOffers,
    heldWentDown,
    pipMenusWhileAnyBattle,
    pipMenusWhileAnyBattleWithoutBattle,
    pipTotalChangedByPrelude,
    anyBattleLeakedPastTurn,
  }
}
