/**
 * The pending declaration (`undeclaredThreat`, switched on in `threat.ts`).
 *
 * The feature prices what an undeclared ambition is worth to the faction best placed to declare it,
 * from public information only — which is what lets it be computed for rivals, the whole point
 * (docs/19 section 18). **The experiment it was built for died at its gate**: the game-44 pin it
 * had to flip cannot be flipped by any end-of-turn static feature, because the winning move's value
 * lives in the *next round's* lead (docs/19 section 19). The feature stays at weight 0 with its
 * semantics pinned here, so a future arena run has something exact to switch on.
 */

import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  Location,
  THREAT_WEIGHTS,
  WEIGHTS,
  botToAct,
  contentsOf,
  defaultRegistry,
  featuresOf,
  intentFor,
  move,
  observe,
  startGame,
  threatBot,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import { valueOf } from '../src/ai/value.js'
import type { FactionId, GameState } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry).state

const features = (s: GameState, of: FactionId) => {
  const o = observe(s, 'red')
  return featuresOf(o, of, intentFor(o, 'red'))
}

describe('the undeclaredThreat feature', () => {
  it('is zero once no marker remains', () => {
    const base = fresh()
    // Consume every marker by declaring them all onto ambitions.
    const s: GameState = {
      ...base,
      declared: [
        ...base.declared,
        ...base.ambitionable.map((m, i) => ({
          ambition: (['Tycoon', 'Tyrant', 'Warlord', 'Keeper', 'Empath'] as const)[i]!,
          marker: m,
          round: 0,
        })),
      ],
      ambitionable: [],
    }
    expect(features(s, 'red').undeclaredThreat).toBe(0)
  })

  it('is zero for a faction with no cards — no lead, no declaration', () => {
    const base = fresh()
    let cards = base.cards
    for (const id of contentsOf(cards, CardLocation.hand('red'))) {
      cards = move(cards, id, CardLocation.discard())
    }
    expect(features({ ...base, cards }, 'red').undeclaredThreat).toBe(0)
  })

  it('prices the top remaining marker for a dominant undeclared standing', () => {
    /*
     * Setup deals starting resources, so shares are small but nonzero from the first turn — the
     * fresh-game threat sits below the marker's full value. Handing red a *dominant* standing
     * (share 1) must raise it to exactly the top marker's high.
     */
    const base = fresh()
    expect(features(base, 'red').undeclaredThreat).toBeLessThan(base.ambitionable[0]!.high)
    // Trophies are Warlord's public metric, so two trophies make red the dominant undeclared
    // Warlord standing without touching hands or resources.
    let figures = base.figures
    for (const id of contentsOf(base.figures, Location.reserve('blue')).slice(0, 2)) {
      figures = move(figures, id, Location.trophies('red'))
    }
    const s = { ...base, figures }
    expect(features(s, 'red').undeclaredThreat).toBe(s.ambitionable[0]!.high)
  })

  it('does not count an ambition that is already declared', () => {
    /*
     * A declared ambition's marker is spoken for — its value already flows through the standing
     * terms, and pricing it here too would double-count. Red dominates Warlord via trophies; the
     * moment Warlord is declared, the threat must fall back to red's next-best undeclared share.
     */
    const base = fresh()
    let figures = base.figures
    for (const id of contentsOf(base.figures, Location.reserve('blue')).slice(0, 2)) {
      figures = move(figures, id, Location.trophies('red'))
    }
    const armed = { ...base, figures }
    expect(features(armed, 'red').undeclaredThreat).toBe(armed.ambitionable[0]!.high)
    const declared: GameState = {
      ...armed,
      declared: [...armed.declared, { ambition: 'Warlord', marker: armed.ambitionable[0]!, round: 0 }],
      ambitionable: armed.ambitionable.slice(1),
    }
    expect(features(declared, 'red').undeclaredThreat).toBeLessThan(
      declared.ambitionable[0]!.high,
    )
  })

  it('is VISIBLE for rivals — the point of the feature', () => {
    /*
     * Unlike `declareReady` and the hand features, there is no self-guard: the threat is public
     * information, so red's observation must price yellow's pending declaration. Mutation: adding
     * an `observed.self === self` guard must fail this test.
     */
    const base = fresh()
    let figures = base.figures
    for (const id of contentsOf(base.figures, Location.reserve('blue')).slice(0, 2)) {
      figures = move(figures, id, Location.trophies('yellow'))
    }
    const s = { ...base, figures }
    expect(features(s, 'yellow').undeclaredThreat).toBe(s.ambitionable[0]!.high)
  })

  it('leaves the shipped weights unmoved, and genuinely moves under THREAT_WEIGHTS', () => {
    const base = fresh()
    let figures = base.figures
    for (const id of contentsOf(base.figures, Location.reserve('blue')).slice(0, 2)) {
      figures = move(figures, id, Location.trophies('red'))
    }
    const armed = { ...base, figures }
    const ob = observe(base, 'red')
    const oa = observe(armed, 'red')
    const intent = intentFor(ob, 'red')
    // Trophies move other features (trophies, Warlord standing is undeclared so not standing) —
    // so compare the FEATURE directly under WEIGHTS-zero, and the value under THREAT_WEIGHTS.
    expect(WEIGHTS.undeclaredThreat).toBe(0)
    expect(THREAT_WEIGHTS.undeclaredThreat).toBeGreaterThan(0)
    const liftUnderThreat =
      valueOf(oa, 'red', intent, THREAT_WEIGHTS) - valueOf(ob, 'red', intent, THREAT_WEIGHTS)
    const liftUnderShipped =
      valueOf(oa, 'red', intent, WEIGHTS) - valueOf(ob, 'red', intent, WEIGHTS)
    expect(liftUnderThreat).toBeGreaterThan(liftUnderShipped)
  })
})

describe('the decl-threat bot', () => {
  it('is deterministic: the same position decides the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, threatBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, threatBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })
})
