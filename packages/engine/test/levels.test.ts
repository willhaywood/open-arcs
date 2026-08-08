/**
 * The difficulty ladder (`levels.ts`) and the easy bot (`easy.ts`).
 *
 * The ladder's contract is small and worth pinning exactly: every level resolves to a bot, absent
 * means normal (old saves must play as they always did), and the levels genuinely differ — a
 * selector whose options all resolve to the same opponent is decoration.
 */

import { describe, expect, it } from 'vitest'

import {
  BOT_LEVELS,
  loadGame,
  serializeGame,
  baselineBot,
  botForLevel,
  botToAct,
  defaultRegistry,
  easyBot,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

describe('the ladder', () => {
  it('resolves every level, and absent means normal', () => {
    for (const level of BOT_LEVELS) {
      expect(typeof botForLevel(level).decide, `${level} resolves`).toBe('function')
    }
    expect(botForLevel(undefined)).toBe(botForLevel('normal'))
    expect(botForLevel('normal')).toBe(standardBot)
  })

  it('adjacent levels are different opponents on a real position', () => {
    /*
     * Seed 3's opening card play is the established discriminator: standard leads Construction-2,
     * the search bot leads Mobilization-4 (`search.test.ts`), and easy shrugs among the close
     * calls. Asserting pairwise difference of the *chosen actions* here rather than bot identity,
     * because identity cannot catch a mapping that returns different objects wrapping the same
     * play.
     */
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 3 }, registry)
    const f = botToAct(cur, THREE)!
    const at = (level: Parameters<typeof botForLevel>[0]): string =>
      JSON.stringify(stepBot(cur, botForLevel(level), f, registry, NO_ASKS).decision.action)
    expect(at('normal')).not.toBe(at('hard'))
    expect(at('easy')).not.toBe(at('normal'))
  })
})

describe('the level in a save', () => {
  it('survives serialize and load, so a loaded game keeps its opponent', () => {
    const options = {
      board: 'Board3Frontiers',
      factions: [...THREE],
      seed: 5,
      bots: ['yellow', 'blue'] as FactionId[],
      botLevel: 'hard' as const,
    }
    const started = startGame(options, registry)
    const loaded = loadGame(serializeGame(options, started), registry)
    expect(loaded.options.botLevel).toBe('hard')
  })
})

describe('the easy bot', () => {
  it('is deterministic: the same position fumbles the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, easyBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, easyBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })

  it('departs from the baseline’s top choice somewhere in a real game', () => {
    /*
     * The whole point of the slack: if easy always agreed with the baseline it would BE the
     * baseline with a different name. Drive one game with easy deciding; count where the inner
     * bot's top pick and easy's pick differ. Zero departures fails — the hash never being
     * consulted is exactly the mutation this exists to catch.
     */
    let cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry)
    let asked: AskedThisTurn = NO_ASKS
    let departures = 0
    for (let i = 0; i < 200; i++) {
      const f = botToAct(cur, THREE)
      if (f === undefined) break
      const easy = stepBot(cur, easyBot, f, registry, asked)
      const base = stepBot(cur, baselineBot, f, registry, asked)
      if (JSON.stringify(easy.decision.action) !== JSON.stringify(base.decision.action)) {
        departures++
      }
      cur = easy.result
      asked = easy.asked
    }
    expect(departures).toBeGreaterThan(0)
  })
})
