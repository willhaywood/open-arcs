/**
 * The arrange step terminates, as a property of the rules rather than of any bot.
 *
 * This menu is the only one in the game whose options form a *cycle*: with a free slot you may
 * shuffle a held token between slots forever, each move a legal position the engine re-offers.
 * Everywhere else a repeat spends something and stops on its own.
 *
 * Three bots have livelocked here — `trivialBot`, which takes the first option and so never reached
 * a `Done` pushed last; and any evaluator that scores two arrangements equal, which is common since
 * resources of a kind are interchangeable. Bounding the cycle in the rules fixes all of them at
 * once, and is the only version that does not depend on a bot noticing anything.
 *
 * **The dead end that was feared turns out to be structurally impossible**, which is worth recording
 * because it was the main argument for how the cap had to be shaped. `Done` is gated on the row
 * being legal, so the worry was that capping the moves which *settle* a row would leave a faction
 * with nothing playable. It cannot: `offerArrange` pushes an `arrange-discard` for every movable
 * token outside the slot loop, ungated, so there is always a way to make the row legal no matter
 * what the cap withholds. Mutating the cap to ration settling moves does not break the tests below,
 * and that is correct rather than a hole in them — the invariant survives it.
 *
 * The cap is still drawn around repositioning only, because rationing the settling moves would
 * restrict real choices (forcing a discard where landing was legal) for no benefit.
 */

import { describe, expect, it } from 'vitest'

import {
  ARRANGE_MOVE_CAP,
  Location,
  advance,
  contentsOf,
  defaultRegistry,
  gain,
  openSlots,
  slotsOf,
  startGame,
} from '../src/index.js'
import type { Action, Continue, FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']
const SELF: FactionId = 'red'

const ask = (r: RuleResult): Extract<Continue, { kind: 'ask' }> => {
  expect(r.continue.kind).toBe('ask')
  return r.continue as Extract<Continue, { kind: 'ask' }>
}

/** Open the arrange step from the Prelude, which is the door that costs nothing. */
function openArrange(): RuleResult {
  let r: RuleResult = startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 5 }, registry)
  for (let i = 0; i < 60; i++) {
    const c = r.continue
    if (c.kind !== 'ask') break
    const open = c.actions.find((a) => a.type === 'turn/prelude-arrange')
    if (open !== undefined) return advance(r.state, open, registry)
    const lead = c.actions.find((a) => a.type === 'turn/lead') ?? c.actions[0]!
    r = advance(r.state, lead, registry)
  }
  throw new Error('never reached the arrange door')
}

/** A repositioning move: shifting a token already held, which is the only kind that can cycle. */
const repositions = (c: Extract<Continue, { kind: 'ask' }>): Action[] =>
  c.actions.filter((a) => a.type === 'resources/arrange-move' && a['eject'] === undefined)

/**
 * A row that is **illegal**: every slot full and another token arriving with nowhere to go.
 *
 * This is the fixture the dead-end property needs, and the reason the first version of these tests
 * was worthless. Opened from the Prelude the row is already legal, so `Done` is always on offer and
 * blocking every settling move would still leave a way out — a cap that rationed settling passed
 * the test while being exactly the bug it was meant to catch.
 */
function stuckRow(): RuleResult {
  let s: GameState = startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, registry).state
  const contents = new Map(s.resources.contents)
  const at = new Map(s.resources.at)
  for (let i = 0; i < 6; i++) {
    const slot = `cityslot:${SELF}:${i}`
    for (const t of contents.get(slot) ?? []) {
      const sup = `supply:${t.slice(0, t.indexOf('#'))}`
      contents.set(sup, [...(contents.get(sup) ?? []), t])
      at.set(t, sup)
    }
    contents.set(slot, [])
  }
  s = { ...s, resources: { ...s.resources, contents, at } }
  for (const slot of slotsOf(s, SELF)) s = { ...s, resources: gain(s.resources, [slot], 'Relic').tracker }
  expect(openSlots(s.resources, slotsOf(s, SELF))).toHaveLength(0)

  const system = s.board.systems.find(
    (sys) => contentsOf(s.figures, Location.system(sys)).some((id) => id.startsWith(`${SELF}/City/`)),
  )
  expect(system).toBeDefined()
  const city = contentsOf(s.figures, Location.system(system!)).find((id) => id.startsWith(`${SELF}/City/`))!
  return advance(
    s,
    { type: 'action/tax-city', faction: SELF, system: system!, city, then: { type: 'turn/lead-main', faction: SELF } },
    registry,
  )
}

describe('the arrange step cannot cycle forever', () => {
  it('stops offering repositioning once the cap is reached, and still offers the way out', () => {
    let r = openArrange()
    expect(repositions(ask(r)).length).toBeGreaterThan(0)

    // Take repositioning moves until the budget is spent. Each one is legal; the point is that the
    // supply of them is finite.
    for (let i = 0; i < ARRANGE_MOVE_CAP; i++) {
      const move = repositions(ask(r))[0]
      if (move === undefined) break
      r = advance(r.state, move, registry)
    }

    const c = ask(r)
    expect(r.state.arrangeMoves).toBe(ARRANGE_MOVE_CAP)
    expect(repositions(c)).toHaveLength(0)
    // The exit is still there, which is what stops the cap being a dead end.
    expect(c.actions.some((a) => a.type === 'resources/arrange-done')).toBe(true)
  })

  it('never leaves a faction with no legal action — the cap is a bound, not a dead end', () => {
    /*
     * The property that matters most. Whatever the cap has consumed, an arrange ask must always
     * offer *something*: either a way to make the row legal, or `Done` because it already is.
     * Asserted over the budget exhausted and well beyond it, since `arrangeMoves` is only reset when
     * the step closes.
     */
    let r = openArrange()
    for (let i = 0; i < ARRANGE_MOVE_CAP * 3; i++) {
      const c = ask(r)
      expect(c.actions.length).toBeGreaterThan(0)
      const move = repositions(c)[0]
      if (move === undefined) break
      r = advance(r.state, move, registry)
    }
    expect(ask(r).actions.length).toBeGreaterThan(0)
  })

  it('always leaves something playable on an illegal row, cap or no cap', () => {
    /*
     * The safety property, on a row that genuinely has no way out but to settle: `Done` is withheld
     * until it is legal. This holds under every shape of cap tried, because the ungated discard is
     * always there — see the note at the top. Kept as a regression net for that guarantee, not as a
     * discriminator between cap designs.
     */
    let r = stuckRow()
    expect(ask(r).actions.some((a) => a.type === 'resources/arrange-done')).toBe(false)

    let sawIllegalPastCap = false
    for (let i = 0; i < ARRANGE_MOVE_CAP * 2; i++) {
      const c = ask(r)
      // Whatever the budget has consumed, there is always something legal to play.
      expect(c.actions.length).toBeGreaterThan(0)

      const canFinish = c.actions.some((a) => a.type === 'resources/arrange-done')
      const settle =
        c.actions.find((a) => a.type === 'resources/arrange-move' && a['eject'] !== undefined) ??
        c.actions.find((a) => a.type === 'resources/arrange-discard')
      if (!canFinish) {
        // The row is still illegal, so a way to settle it must exist however much budget is gone.
        expect(settle).toBeDefined()
        if ((r.state.arrangeMoves ?? 0) >= ARRANGE_MOVE_CAP) sawIllegalPastCap = true
      }

      // Burn budget on repositioning while any is left, so the loop actually reaches the cap with
      // the row still illegal — which is the only configuration that can strand anyone.
      const reposition = repositions(c)[0]
      const next = reposition ?? settle
      if (next === undefined) break
      r = advance(r.state, next, registry)
      if (r.continue.kind !== 'ask') break
    }
    // Guard against the assertions above passing vacuously by never reaching the dangerous state.
    expect(sawIllegalPastCap).toBe(true)
  })

  it('counts only repositioning, so settling a row is never rationed', () => {
    // Landing an arrival, ejecting and discarding each consume a token, so they terminate on their
    // own and must not draw on the budget — capping them is exactly how a dead end would arise.
    let r = openArrange()
    const before = r.state.arrangeMoves ?? 0
    const discard = ask(r).actions.find((a) => a.type === 'resources/arrange-discard')
    if (discard !== undefined) {
      r = advance(r.state, discard, registry)
      expect(r.state.arrangeMoves ?? 0).toBe(before)
    }
  })

  it('resets the budget when the step closes, so the next one starts fresh', () => {
    let r = openArrange()
    const move = repositions(ask(r))[0]
    if (move !== undefined) r = advance(r.state, move, registry)
    expect(r.state.arrangeMoves ?? 0).toBeGreaterThan(0)

    const done = ask(r).actions.find((a) => a.type === 'resources/arrange-done')
    expect(done).toBeDefined()
    const after: GameState = advance(r.state, done!, registry).state
    expect(after.arrangeMoves ?? 0).toBe(0)
  })

  it('leaves the row reachable — the cap is above what sorting a full board needs', () => {
    // Six city slots, so any arrangement is reachable well inside the cap. Stated against the board
    // rather than the constant, so a board with more slots fails here rather than silently
    // rationing a legitimate decision.
    const r = openArrange()
    expect(ARRANGE_MOVE_CAP).toBeGreaterThanOrEqual(slotsOf(r.state, SELF).length)
  })
})
