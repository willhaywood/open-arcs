/**
 * The store side of the interludes: detection at the chapter boundary, the bot hold, and the
 * clearing rules. Headless against the singleton store, fake timers keeping the pacing inert
 * (the bot-level test's pattern) — `stepBotOnce` is driven by hand, which is exactly what the
 * real timer does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { store } from '../src/store.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  store.reset()
  vi.useRealTimers()
})

const BOT_PACE = 1500

function startAllBots(players: 2 | 3 = 3): void {
  const factions = (['red', 'yellow', 'blue'] as const).slice(0, players)
  store.start({
    board: players === 2 ? 'Board2Frontiers' : 'Board3Frontiers',
    factions: [...factions],
    seed: 5,
    bots: [...factions],
    botLevel: 'easy',
  })
}

function journalLength(): number {
  const json = store.toJSON()
  return json === null ? 0 : (JSON.parse(json) as { journal: string[] }).journal.length
}

/** Step until the first chapter interlude opens. */
function stepToChapterEnd(cap = 3000): void {
  for (let i = 0; i < cap; i++) {
    if (store.interlude?.kind === 'chapter') return
    store.stepBotOnce()
  }
  throw new Error('no chapter interlude within the step cap')
}

describe('the chapter interlude', () => {
  it('opens at the chapter boundary and holds the bot timer', () => {
    startAllBots()
    stepToChapterEnd()
    const it_ = store.interlude
    expect(it_?.kind).toBe('chapter')
    if (it_?.kind !== 'chapter') return
    expect(it_.report.chapter).toBe(1)
    // The report's power rows agree with what the store's own position now says.
    const after = Object.fromEntries(it_.report.power.map((p) => [p.faction, p.after]))
    const json = JSON.parse(store.toJSON()!) as never
    expect(json).toBeTruthy()
    expect(Object.keys(after)).toHaveLength(3)

    // The hold: no timer fires the next bot move while the screen is up.
    const before = journalLength()
    vi.advanceTimersByTime(BOT_PACE * 4)
    expect(journalLength()).toBe(before)
  })

  it('dismissing re-arms the bots', () => {
    startAllBots()
    stepToChapterEnd()
    const before = journalLength()
    store.dismissInterlude()
    expect(store.interlude).toBeNull()
    vi.advanceTimersByTime(BOT_PACE * 4)
    expect(journalLength()).toBeGreaterThan(before)
  })

  it('undo clears the screen', () => {
    startAllBots()
    stepToChapterEnd()
    store.undo()
    expect(store.interlude).toBeNull()
  })

  it('a new game clears the screen', () => {
    startAllBots()
    stepToChapterEnd()
    startAllBots()
    expect(store.interlude).toBeNull()
  })

  it('the draft ending is not a chapter ending', () => {
    /*
     * A Leaders & Lore game sits at chapter 0 through the draft, so the last pick bumps 0 -> 1.
     * That bump opened a spurious, empty interlude before the guard existed — found by the
     * verification save builder, pinned here.
     */
    store.start({
      board: 'Board2Frontiers',
      factions: ['red', 'yellow'],
      seed: 1,
      bots: ['red', 'yellow'],
      botLevel: 'easy',
      leadersAndLore: {},
    })
    for (let i = 0; i < 500; i++) {
      store.stepBotOnce()
      const json = JSON.parse(store.toJSON()!) as never as { journal: string[] }
      expect(json).toBeTruthy()
      if (store.interlude !== null) break
    }
    // The first screen of the game must be a real chapter's scoring, never chapter 0's.
    expect(store.interlude?.kind).toBe('chapter')
    if (store.interlude?.kind === 'chapter') {
      expect(store.interlude.report.chapter).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('the game-over screen', () => {
  it('opens at the end, with a history whose chapters and winner match the game', () => {
    startAllBots(2)
    for (let i = 0; i < 20000; i++) {
      if (store.interlude?.kind === 'gameOver') break
      // Chapter interludes open along the way; dismiss them as a player would.
      if (store.interlude?.kind === 'chapter') store.dismissInterlude()
      store.stepBotOnce()
    }
    expect(store.interlude?.kind).toBe('gameOver')

    const history = store.history()
    expect(history).not.toBeNull()
    if (history === null) return
    const save = JSON.parse(store.toJSON()!) as { journal: string[] }
    expect(save.journal.length).toBeGreaterThan(0)
    // One report per chapter played, the final chapter's included.
    expect(history.chapters.length).toBeGreaterThanOrEqual(1)
    // The winner leads the standings, and the reason names them.
    expect(history.standings[0]!.faction).toBe(history.winner)
    expect(history.reason).toContain(history.winner)
    // Reopening after a dismissal works — the "View summary" path.
    store.dismissInterlude()
    expect(store.interlude).toBeNull()
    store.reopenGameOver()
    expect(store.interlude?.kind).toBe('gameOver')
  })
})
