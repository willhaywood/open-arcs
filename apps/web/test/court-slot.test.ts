/**
 * The card shelf can draw every decision it claims.
 *
 * `surfaces.test.ts` proves each Ask has an *owner*. That is necessary and not sufficient: an owner
 * that renders nothing is the same unplayable game as no owner at all, and ownership alone cannot
 * tell the two apart. Influence, Secure and Ransack now have exactly one surface, so if a pick
 * resolved to an empty court slot the shelf would draw no card and no button for it — and if every
 * pick did, the player would face an empty modal with the decision unreachable.
 *
 * So the invariant is stated over real play, the same way `surfaces.test.ts` states its own:
 * **every pick the shelf claims resolves to a card it can draw.**
 */

import { applyExternal, defaultRegistry, startGame } from '@arcs/engine'
import type { Action, Continue, NewGameOptions, RuleResult } from '@arcs/engine'
import { describe, expect, it } from 'vitest'

import { shelfItems, shelfParts, shelfPickCount } from '../src/court-slot.js'
import { surfaceFor } from '../src/surfaces.js'

const registry = defaultRegistry()
type Ask = Extract<Continue, { kind: 'ask' }>

const ESCAPEY = /skip|cancel|pass|turn\/end/

interface Seen {
  asks: number
  undrawable: string[]
  /** Actions on a claimed Ask that the shelf renders nothing for. */
  undrawn: string[]
}

/** Play a game, checking every Ask the shelf owns. */
function sweep(options: NewGameOptions, steps: number, pick: (a: Ask, i: number) => Action): Seen {
  const out: Seen = { asks: 0, undrawable: [], undrawn: [] }
  let r: RuleResult = startGame(options, registry)
  for (let i = 0; i < steps; i++) {
    if (r.continue.kind !== 'ask') break
    const ask = r.continue
    if (surfaceFor(ask) === 'shelf') {
      out.asks++
      const offered = shelfPickCount(ask)
      const drawable = shelfItems(r.state, ask).length
      if (drawable !== offered || drawable === 0) {
        out.undrawable.push(
          `${ask.faction} "${ask.prompt ?? ''}" — offered ${offered}, drawable ${drawable}`,
        )
      }
      // The partition must account for every action on the Ask — see `shelfParts`.
      const { items, others, escape } = shelfParts(r.state, ask)
      const covered = items.length + others.length + (escape === undefined ? 0 : 1)
      if (covered !== ask.actions.length) {
        out.undrawn.push(`${ask.prompt ?? ''}: covered ${covered} of ${ask.actions.length}`)
      }
    }
    const chosen = pick(ask, i)
    try {
      r = applyExternal(r, chosen, registry)
    } catch {
      break
    }
  }
  return out
}

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

describe('the card shelf draws every pick it claims', () => {
  for (const { name, options } of configs) {
    it(`${name} — every shelf Ask is fully drawable`, () => {
      let asks = 0
      const undrawable: string[] = []
      const undrawn: string[] = []
      for (let seed = 1; seed <= 30; seed++) {
        const seen = sweep(options(seed), 900, (ask, i) => {
          const real = ask.actions.filter((a) => !ESCAPEY.test(a.type))
          const pool = real.length > 0 ? real : ask.actions
          return pool[(seed * 7 + i * 13) % pool.length]!
        })
        asks += seen.asks
        undrawable.push(...seen.undrawable)
        undrawn.push(...seen.undrawn)
      }

      expect([...new Set(undrawable)]).toEqual([])
      /*
       * Claiming an Ask means drawing all of it. Influence and Secure carry `action/guild-alt`
       * alternatives from `withAlts`, plus `turn/pips` and `leaders/after-declare`; an early cut of
       * the shelf drew only the card picks, so all of those were offered by the engine and rendered
       * by nobody. The partition is what makes that structurally impossible rather than remembered.
       */
      expect([...new Set(undrawn)]).toEqual([])
      // Guard against the assertion above passing vacuously: the sweep must actually reach the
      // court. Influence is the most-used decision in the game, so zero here means a broken sweep,
      // not a clean run.
      expect(asks).toBeGreaterThan(0)
    })
  }

  it('claims influence, secure and ransack — and leaves the differently-shaped ones alone', () => {
    /*
     * The three excluded decisions were grouped under S1 in docs/15 but do not share the
     * `{ faction, slot }` payload the shelf is built on. Pinning that here so a later reader adding
     * them to `SHELF` finds out immediately rather than at runtime, where the shelf would look up
     * `a['slot']` on an action that has none and draw nothing.
     */
    const shelfOwned = (type: string, extra: Record<string, unknown> = {}): Continue => ({
      kind: 'ask',
      faction: 'red',
      actions: [{ type, faction: 'red', ...extra } as Action],
    })

    expect(surfaceFor(shelfOwned('action/influence', { slot: 1 }))).toBe('shelf')
    expect(surfaceFor(shelfOwned('action/secure', { slot: 1 }))).toBe('shelf')
    expect(surfaceFor(shelfOwned('action/ransack', { slot: 1 }))).toBe('shelf')

    for (const type of ['leaders/beloved', 'turn/bards-declare', 'leaders/generous-give']) {
      expect(surfaceFor(shelfOwned(type))).not.toBe('shelf')
    }
  })
})
