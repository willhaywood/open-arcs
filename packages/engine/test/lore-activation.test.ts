/**
 * Ambition-paired lore: the evaluator can tell a card that is switched on from one that is not.
 *
 * The expansion's ten paired cards (lore19-28) do nothing until the ambition they name is declared,
 * by anyone (`loreActive`). Before this the evaluator could not see them at all — a faction holding
 * Tycoon's Ambition scored exactly as one holding nothing, whether Tycoon was declared or not.
 *
 * The counts are **scaled by how much the faction wants the paired ambition** (`bias`), because the
 * flat version measured ~2 points of win rate worse than not having the feature at all — see
 * docs/19 section 3k. So these tests assert the *relationships* rather than exact magnitudes: which
 * bucket a card falls in, and what that does to the appeal of declaring.
 *
 * The mechanism worth pinning is not the counts but the **consequence**: because the bot values a
 * declaration by valuing the position it produces, and declaring is what converts an armed card to a
 * live one, holding a dormant card must make declaring its ambition more attractive — with no rule
 * anywhere saying so. That is the last test here, and it is the reason the two states are separate
 * features rather than one scaled count.
 */

import { describe, expect, it } from 'vitest'

import {
  BASELINE_WEIGHTS,
  LORE_AMBITION,
  LORE_WEIGHTS,
  TYCOONS_AMBITION,
  defaultRegistry,
  featuresOf,
  intentFor,
  observe,
  startGame,
  valueOf,
} from '../src/index.js'
import type { Ambition, FactionId, GameState, Weights } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']
const SELF: FactionId = 'red'

const fresh = (): GameState =>
  startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 5 }, registry).state

const holding = (state: GameState, ...ids: readonly string[]): GameState => ({
  ...state,
  lores: { ...state.lores, [SELF]: ids },
})

/** Declared by *someone* — the cards do not say "you declared it". */
const declaring = (state: GameState, ambition: Ambition): GameState => ({
  ...state,
  declared: [...state.declared, { ambition, marker: { high: 4, low: 2 }, round: 0 }],
})

const featuresFor = (state: GameState) => {
  const observed = observe(state, SELF)
  return featuresOf(observed, SELF, intentFor(observed, SELF))
}

const valueFor = (state: GameState, weights: Weights): number => {
  const observed = observe(state, SELF)
  return valueOf(observed, SELF, intentFor(observed, SELF), weights)
}

describe('ambition-paired lore, held versus switched on', () => {
  it('counts a held card as armed while its ambition is undeclared', () => {
    const f = featuresFor(holding(fresh(), TYCOONS_AMBITION))
    expect(f.loreArmed).toBeGreaterThan(0)
    expect(f.loreLive).toBe(0)
  })

  it('counts it as live once the ambition is declared — by anyone', () => {
    const f = featuresFor(declaring(holding(fresh(), TYCOONS_AMBITION), 'Tycoon'))
    expect(f.loreLive).toBeGreaterThan(0)
    expect(f.loreArmed).toBe(0)
  })

  it('is unmoved by declaring an ambition the card is not paired with', () => {
    const f = featuresFor(declaring(holding(fresh(), TYCOONS_AMBITION), 'Keeper'))
    expect(f.loreArmed).toBeGreaterThan(0)
    expect(f.loreLive).toBe(0)
  })

  it('sees nothing for a faction holding no paired lore', () => {
    const f = featuresFor(declaring(fresh(), 'Tycoon'))
    expect(f.loreArmed).toBe(0)
    expect(f.loreLive).toBe(0)
  })

  it('reads the pairing from the engine, so every paired card is covered', () => {
    // Stated over `LORE_AMBITION` rather than a list here, so a card added to the engine is covered
    // without touching this file — and a card the engine pairs but the evaluator misses fails.
    for (const [loreId, ambition] of Object.entries(LORE_AMBITION)) {
      const armed = featuresFor(holding(fresh(), loreId))
      const live = featuresFor(declaring(holding(fresh(), loreId), ambition as Ambition))
      expect(armed.loreArmed, `${loreId} armed`).toBeGreaterThan(0)
      expect(live.loreLive, `${loreId} live once ${ambition} is declared`).toBeGreaterThan(0)
    }
  })

  it('makes declaring the paired ambition more attractive — the whole mechanism', () => {
    /*
     * Not a claim about the counts but about what they cause. The bot picks a declaration by valuing
     * the position it leads to, so the gain from declaring Tycoon must be larger for a faction
     * holding Tycoon's Ambition than for one holding nothing. Nothing tells it to; it falls out of
     * armed becoming live.
     */
    const withCard = holding(fresh(), TYCOONS_AMBITION)
    const without = fresh()

    const gainWith = valueFor(declaring(withCard, 'Tycoon'), LORE_WEIGHTS) - valueFor(withCard, LORE_WEIGHTS)
    const gainWithout = valueFor(declaring(without, 'Tycoon'), LORE_WEIGHTS) - valueFor(without, LORE_WEIGHTS)

    expect(gainWith).toBeGreaterThan(gainWithout)
  })

  it('scales with how much the ambition is wanted, so a card amplifies rather than creates a plan', () => {
    /*
     * The correction the arena forced. A flat count pulled the bot toward whatever its lore named,
     * arguing with `feasibility` — the signal that judges whether an ambition is worth declaring —
     * and measured worse than not having the feature. Scaling by `bias` means a card tips a close
     * call rather than dragging the bot into an ambition the board does not support.
     *
     * Stated as a relationship over the whole paired set: whatever `bias` returns, no card may score
     * a flat 1 regardless of intent, and the two buckets must move together with it.
     */
    /*
     * Compared in **one fixed position**, which an earlier version of this test got wrong: it varied
     * the declaration per card, and since declaring changes `intent`, a feature scaled by entirely
     * the wrong ambition still produced varied numbers and passed.
     */
    const base = fresh()
    const observed = observe(base, SELF)
    const intent = intentFor(observed, SELF)

    // Two cards whose paired ambitions this position wants to different degrees.
    const pairs = Object.entries(LORE_AMBITION) as [string, Ambition][]
    const wanted = (a: Ambition): number => intent.pursuing.get(a) ?? 0
    const hi = pairs.reduce((best, p) => (wanted(p[1]) > wanted(best[1]) ? p : best), pairs[0]!)
    const lo = pairs.reduce((worst, p) => (wanted(p[1]) < wanted(worst[1]) ? p : worst), pairs[0]!)
    expect(wanted(hi[1])).toBeGreaterThan(wanted(lo[1]))

    // Same position, same armed state — only the card differs, so any gap is the scaling.
    const armedHi = featuresFor(holding(base, hi[0])).loreArmed
    const armedLo = featuresFor(holding(base, lo[0])).loreArmed
    expect(armedHi).toBeGreaterThan(armedLo)
  })

  it('leaves the frozen baseline blind to all of it', () => {
    // The reason both weights default to 0: the baseline must not move, or a bot switching them on
    // could not be attributed the difference.
    expect(BASELINE_WEIGHTS.loreLive).toBe(0)
    expect(BASELINE_WEIGHTS.loreArmed).toBe(0)

    const armed = holding(fresh(), TYCOONS_AMBITION)
    const live = declaring(armed, 'Tycoon')
    // Declaring changes other things too, so compare the *card's* contribution: same declaration,
    // with and without the card in hand.
    const bare = declaring(fresh(), 'Tycoon')
    expect(valueFor(live, BASELINE_WEIGHTS)).toBeCloseTo(valueFor(bare, BASELINE_WEIGHTS), 10)
    expect(valueFor(live, LORE_WEIGHTS)).toBeGreaterThan(valueFor(bare, LORE_WEIGHTS))
  })
})
