/**
 * The Weapon's Prelude option, made visible to the evaluator (`weapon.ts`).
 *
 * Spending a Weapon grants no action — it adds Battle to the played card's pips for the turn
 * (rulebook p17, `state.anyBattle`). No feature read that flag, so the spend scored as a Weapon
 * leaving the board for nothing measurable: 3 taken out of 274 offered across eight games, while
 * Weapons piled up.
 *
 * Most of what is pinned here is the **gate**, not the feature. The option is worth nothing when
 * there is no battle to be had, and a term that paid out on an empty board would have the bot
 * buying it for its own sake — a new bad habit in place of the old one.
 */

import { describe, expect, it } from 'vitest'

import {
  Location,
  WEAPON_WEIGHTS,
  WEIGHTS,
  botToAct,
  canBattle,
  contentsOf,
  defaultRegistry,
  featuresOf,
  intentFor,
  move,
  observe,
  standardBot,
  startGame,
  valueOf,
  weaponBot,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

const fresh = (seed = 1): GameState =>
  startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry).state

/** Put a yellow ship where red already has one, so red has someone to fight. */
function contested(base: GameState): GameState {
  const s = base.board.systems.find(
    (sys) =>
      contentsOf(base.figures, Location.system(sys)).some((id) => id.startsWith('red/Ship')),
  )
  if (s === undefined) throw new Error('no red ship on the board')
  const enemy = contentsOf(base.figures, Location.reserve('yellow')).find((i) =>
    i.includes('Ship'),
  )
  if (enemy === undefined) throw new Error('no spare yellow ship')
  return { ...base, figures: move(base.figures, enemy, Location.system(s)) }
}

/** Strip every rival piece off the map, so red has nobody to fight anywhere. */
function unopposed(base: GameState): GameState {
  let s = base
  for (const sys of s.board.systems) {
    for (const id of contentsOf(s.figures, Location.system(sys))) {
      if (!id.startsWith('red/')) {
        s = { ...s, figures: move(s.figures, id, Location.reserve(id.split('/')[0] as FactionId)) }
      }
    }
  }
  return s
}

const unlocked = (s: GameState): number =>
  featuresOf(observe(s, 'red'), 'red', intentFor(observe(s, 'red'), 'red')).battleUnlocked

describe('the battleUnlocked feature', () => {
  it('is 0 while no Weapon has been spent', () => {
    const s = contested(fresh())
    expect(s.anyBattle).toBe(false)
    expect(unlocked(s)).toBe(0)
  })

  it('is 1 once a Weapon is spent and there is a battle to be had', () => {
    const s = { ...contested(fresh()), anyBattle: true }
    expect(canBattle(s, 'red')).toBe(true)
    expect(unlocked(s)).toBe(1)
  })

  it('is 0 with the option bought but nobody to fight — the gate', () => {
    /*
     * The case the gate exists for, and the one that keeps this from becoming a new bad habit:
     * unlocking Battle on a board with no reachable enemy is worth exactly nothing, so the bot must
     * not pay a Weapon for it. Without the gate the term pays out on an empty board.
     */
    const s = { ...unopposed(fresh()), anyBattle: true }
    expect(canBattle(s, 'red')).toBe(false)
    expect(unlocked(s)).toBe(0)
  })

  it('leaves the shipped weights unmoved — the feature is off by default', () => {
    // What keeps `standardBot` and the frozen baseline byte-identical: weight 0 in `WEIGHTS`.
    const off = contested(fresh())
    const on: GameState = { ...off, anyBattle: true }
    const intent = intentFor(observe(off, 'red'), 'red')
    expect(valueOf(observe(on, 'red'), 'red', intent, WEIGHTS)).toBe(
      valueOf(observe(off, 'red'), 'red', intent, WEIGHTS),
    )
    // ...and genuinely moves under the weights that turn it on, or the experiment measures nothing.
    expect(valueOf(observe(on, 'red'), 'red', intent, WEAPON_WEIGHTS)).toBeGreaterThan(
      valueOf(observe(off, 'red'), 'red', intent, WEAPON_WEIGHTS),
    )
  })
})

describe('the weapon-option bot', () => {
  it('buys the battle option where standard declines it', () => {
    /*
     * Seed 1, step 145, found by sweeping real games for the first divergent Prelude. Yellow is
     * offered "Fuel: add Battle option" — Loyal Marines lets any resource pay as a Weapon — and
     * `weaponBot` takes it where `standardBot` walks straight past into its actions. Pinning the
     * step (not just "they differ somewhere") is what makes a weight silently reverting to 0 fail
     * here rather than pass on some other disagreement.
     */
    let cur: RuleResult = startGame(
      { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
      registry,
    )
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < 145; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, standardBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    const f = botToAct(cur, THREE)
    expect(f).toBe('yellow')
    const weapon = stepBot(cur, weaponBot, f!, registry, asked).decision
    const standard = stepBot(cur, standardBot, f!, registry, asked).decision
    expect(String(weapon.action['label'])).toContain('add Battle option')
    expect(String(standard.action['label'])).toContain('Begin actions')
  })

  it('is deterministic: the same position decides the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, weaponBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, weaponBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })
})
