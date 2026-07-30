/**
 * Every Ask the engine can produce is drawn by some surface.
 *
 * This is the check the three worst UI bugs so far could not have survived. All three had the same
 * shape — the engine produced a valid Ask and nothing on screen would draw it — and none of them
 * can fail an engine test, because the engine is correct in every case:
 *
 *   - Railgun Arrays assigned a hit before dice existed. The panel hid `battle/hit` believing the
 *     battle window owned it; the window required a roll it did not have. The game stopped dead.
 *   - The reroll was offered as text with the dice nowhere on screen.
 *   - Ancient Holdings' slot was returned by the engine and drawn by nobody.
 *
 * The invariant is stated over **real play** rather than a list of known action types, because a
 * list is exactly what failed: both components had one, they disagreed, and no list can contain a
 * type nobody thought of. Games are played to a depth that reaches battles, raids, preludes and the
 * expansion cards, and every Ask along the way must have an owner.
 *
 * When this fails, the fix is to claim the action type in `src/surfaces.ts` for whichever surface
 * should draw it — and then actually make that surface draw it.
 */

import { applyExternal, defaultRegistry, loadGame, startGame } from '@arcs/engine'
import type { Action, Continue, NewGameOptions, RuleResult } from '@arcs/engine'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { surfaceFor } from '../src/surfaces.js'

const registry = defaultRegistry()
type Ask = Extract<Continue, { kind: 'ask' }>

/** A description precise enough to act on when this fails. */
const describeAsk = (a: Ask): string =>
  `${a.faction} — "${a.prompt ?? ''}" [${[...new Set(a.actions.map((x) => x.type))].join(', ')}]`

/**
 * Play a game, claiming every Ask against the table.
 *
 * The picker prefers *substantive* actions over escapes, so games reach real decisions rather than
 * skipping to the end — a sweep that passes by cancelling everything would prove nothing. It varies
 * its choice by seed so different seeds explore different branches.
 */
function sweep(options: NewGameOptions, steps: number, pick: (a: Ask, i: number) => Action): string[] {
  const orphans: string[] = []
  let r: RuleResult = startGame(options, registry)
  for (let i = 0; i < steps; i++) {
    if (r.continue.kind !== 'ask') break
    const ask = r.continue
    if (surfaceFor(ask) === undefined) orphans.push(describeAsk(ask))
    const chosen = pick(ask, i)
    try {
      r = applyExternal(r, chosen, registry)
    } catch {
      break
    }
  }
  return orphans
}

const ESCAPEY = /skip|cancel|pass|turn\/end/

describe('every Ask has a surface that draws it', () => {
  /*
   * Base game and the full expansion, three and four players. The expansion matters most: the lore
   * and leader cards are where new Ask shapes come from, and two of the three bugs above were
   * expansion cards.
   */
  const configs: { name: string; options: (seed: number) => NewGameOptions }[] = [
    {
      name: 'base game, 4 players',
      options: (seed) => ({
        board: 'Board4MixUp1',
        factions: ['red', 'yellow', 'blue', 'white'],
        seed,
      }),
    },
    {
      name: 'leaders and lore, 3 players',
      options: (seed) => ({
        board: 'Board3MixUp',
        factions: ['red', 'yellow', 'blue'],
        seed,
        leadersAndLore: { expansion: true, lorePerPlayer: 3 },
      }),
    },
  ]

  for (const { name, options } of configs) {
    it(`${name} — 40 seeds played deep`, () => {
      const orphans: string[] = []
      for (let seed = 1; seed <= 40; seed++) {
        orphans.push(
          ...sweep(options(seed), 900, (ask, i) => {
            const real = ask.actions.filter((a) => !ESCAPEY.test(a.type))
            const pool = real.length > 0 ? real : ask.actions
            return pool[(seed * 7 + i * 13) % pool.length]!
          }),
        )
      }
      // Deduplicated: one unclaimed type shows up on hundreds of Asks and the list should name the
      // problem, not bury it.
      expect([...new Set(orphans)]).toEqual([])
    })
  }

  /*
   * The checked-in interaction saves are the sharper half of this. Each is parked on a card
   * interaction that a human found worth watching, including the exact Railgun position that
   * deadlocked — so they are the Asks most likely to be unusual, and the cheapest possible
   * regression net for the bug this module exists to prevent.
   */
  it('every checked-in lore save resumes on an Ask some surface draws', () => {
    const dir = join(import.meta.dirname, '..', '..', '..', 'saves', 'lore')
    const files = readdirSync(dir).filter((n) => n.endsWith('.json'))
    expect(files.length).toBeGreaterThan(20)

    const orphans: string[] = []
    for (const f of files) {
      const save = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
        options: NewGameOptions
        journal: string[]
      }
      let r: RuleResult = startGame(save.options, registry)
      // Replaying by hand rather than through `loadGame` so each intermediate Ask is checked too,
      // not only the position the save ends on.
      for (const entry of save.journal) {
        if (r.continue.kind === 'ask' && surfaceFor(r.continue) === undefined) {
          orphans.push(`${f}: ${describeAsk(r.continue)}`)
        }
        const ask = r.continue
        if (ask.kind !== 'ask') break
        const next = ask.actions.find((a) => entry.startsWith(`${a.type}(`))
        if (next === undefined) break
        r = applyExternal(r, next, registry)
      }
      const { result } = loadGame(readFileSync(join(dir, f), 'utf8'), registry)
      if (result.continue.kind === 'ask' && surfaceFor(result.continue) === undefined) {
        orphans.push(`${f} (resume): ${describeAsk(result.continue)}`)
      }
    }
    expect([...new Set(orphans)]).toEqual([])
  })

  it('the Railgun volley — the Ask that deadlocked — is owned by the battle window', () => {
    const dir = join(import.meta.dirname, '..', '..', '..', 'saves', 'lore')
    const { result } = loadGame(
      readFileSync(join(dir, 'lore12-railgun-arrays--volley.json'), 'utf8'),
      registry,
    )
    expect(result.continue.kind).toBe('ask')
    // Not merely "some surface": the battle window specifically, with no roll on the table. That
    // combination is the deadlock exactly — the panel steps aside, so the window must draw it.
    expect(surfaceFor(result.continue)).toBe('battle')
    expect(result.state.lastRoll).toBeUndefined()
  })
})
