/**
 * The store honors `options.botLevel`.
 *
 * The engine-side ladder tests pin that `botForLevel` resolves different opponents; this pins the
 * one line that could quietly undo all of it — `store.stepBotOnce` hard-coding a bot again, which
 * is exactly what it did before levels existed. Headless on purpose: the store has no browser
 * dependencies, and driving it directly is the only way to test its wiring rather than a copy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { store } from '../src/store.js'

// Bots always run now (the step/run toggle went with the BotPanel), so the pacing timer is armed
// by `start` itself. Fake timers keep it inert: the test still drives exactly one step.
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** The opening bot actions under a level, read back through the journal in the save file. */
function openingUnder(botLevel?: 'easy' | 'normal' | 'hard' | 'brutal'): string[] {
  store.start({
    board: 'Board3Frontiers',
    factions: ['red', 'yellow', 'blue'],
    seed: 3,
    bots: ['red', 'yellow', 'blue'],
    ...(botLevel === undefined ? {} : { botLevel }),
  })
  for (let i = 0; i < 60; i++) store.stepBotOnce()
  const json = store.toJSON()
  expect(json).not.toBeNull()
  const journal = (JSON.parse(json!) as { journal: string[] }).journal
  expect(journal.length, 'the bots took exactly sixty actions').toBe(60)
  return journal
}

describe('store.stepBotOnce', () => {
  it('plays the level the game was started with', () => {
    /*
     * Seed 3 is the established discriminator (levels.test.ts): normal and hard first choose
     * differently at decision 51. If the store ignored botLevel these would be equal — the exact
     * regression of hard-coding standardBot.
     */
    const normal = openingUnder()
    const hard = openingUnder('hard')
    expect(hard).not.toEqual(normal)
    // And absent means normal, byte for byte — old saves play as they always did.
    expect(openingUnder('normal')).toEqual(normal)
  })
})
