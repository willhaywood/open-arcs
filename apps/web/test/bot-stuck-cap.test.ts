/**
 * The store's per-turn stuck cap (`BOT_TURN_CAP`).
 *
 * The easy mirror on three-player seed 126 livelocks: in chapter 5 red's bot bounces between the
 * Prelude's Arrange and the arrange board's Done, because both score the same and neither writes to
 * the log, so the same pick comes back forever. In the arena `runBots` gives up; in the browser,
 * before the cap, the game simply never ended. Driven through the real store and the real loop.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOT_TURN_CAP, store, stuckExit } from '../src/store.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the bot stuck cap', () => {
  it('drains a livelocked turn and lets the game finish', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.start({
      board: 'Board3Frontiers',
      factions: ['red', 'yellow', 'blue'],
      seed: 126,
      bots: ['red', 'yellow', 'blue'],
      botLevel: 'easy',
    })
    // A finished easy game here takes about 500 decisions; the loop adds the cap and its exit.
    for (let i = 0; i < 3_000 && store.getSnapshot()?.state.isOver !== true; i++) store.stepBotOnce()
    expect(store.getSnapshot()?.state.isOver).toBe(true)
    // It finished because the cap fired, not because the loop went away.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(`${BOT_TURN_CAP} decisions in one turn`)
    warn.mockRestore()
  })

  it('takes the Prelude exit over everything else on offer', () => {
    const ask = {
      state: {} as never,
      continue: {
        kind: 'ask',
        faction: 'red',
        prompt: 'red — Prelude',
        actions: [
          { type: 'turn/prelude-spend' },
          { type: 'turn/prelude-arrange' },
          { type: 'turn/prelude-done' },
        ],
      },
    } as never
    expect(stuckExit(ask)?.type).toBe('turn/prelude-done')
  })
})
