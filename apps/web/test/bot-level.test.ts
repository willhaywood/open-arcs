/**
 * The store honors `options.botLevel`.
 *
 * The engine-side ladder tests pin that `botForLevel` resolves different opponents; this pins the
 * one line that could quietly undo all of it — `store.stepBotOnce` hard-coding a bot again, which
 * is exactly what it did before levels existed. Headless on purpose: the store has no browser
 * dependencies, and driving it directly is the only way to test its wiring rather than a copy.
 */

import { describe, expect, it } from 'vitest'

import { store } from '../src/store.js'

/** One bot step under a level, read back through the journal in the save file. */
function firstBotAction(botLevel?: 'easy' | 'normal' | 'hard' | 'brutal'): string {
  store.setBotMode('step') // no timers: the test drives explicitly
  store.start({
    board: 'Board3Frontiers',
    factions: ['red', 'yellow', 'blue'],
    seed: 3,
    bots: ['red', 'yellow', 'blue'],
    ...(botLevel === undefined ? {} : { botLevel }),
  })
  store.stepBotOnce()
  const json = store.toJSON()
  expect(json).not.toBeNull()
  const journal = (JSON.parse(json!) as { journal: string[] }).journal
  expect(journal.length, 'the bot took exactly one action').toBe(1)
  return journal[0]!
}

describe('store.stepBotOnce', () => {
  it('plays the level the game was started with', () => {
    /*
     * Seed 3's opening card play is the established discriminator (levels.test.ts): normal and
     * hard choose different cards there. If the store ignored botLevel these would be equal —
     * the exact regression of hard-coding standardBot.
     */
    const normal = firstBotAction()
    const hard = firstBotAction('hard')
    expect(hard).not.toBe(normal)
    // And absent means normal, byte for byte — old saves play as they always did.
    expect(firstBotAction('normal')).toBe(normal)
  })
})
