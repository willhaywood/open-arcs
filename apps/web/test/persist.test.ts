/**
 * The autosave: every local mutation writes the save string, reset discards it, and a boot-time
 * restore round-trips — including a corrupt blob costing one boot rather than every boot.
 *
 * localStorage does not exist in vitest's node environment, which is itself half the design: the
 * persist module's capability guard makes storage a silent no-op there, proven by the other
 * store tests never noticing. These tests stub a Map-backed localStorage (the `vi.stubGlobal`
 * pattern multiplayer.test.ts uses for fetch) to exercise the real path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { store } from '../src/store.js'

const KEY = 'arcs:autosave'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', fakeStorage())
})
afterEach(() => {
  store.reset()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function startBots(): void {
  store.start({
    board: 'Board2Frontiers',
    factions: ['red', 'yellow'],
    seed: 9,
    bots: ['red', 'yellow'],
    botLevel: 'easy',
  })
}

describe('the autosave', () => {
  it('tracks every local mutation, byte for byte with the Save button', () => {
    startBots()
    expect(localStorage.getItem(KEY)).toBe(store.toJSON())
    for (let i = 0; i < 5; i++) store.stepBotOnce()
    expect(localStorage.getItem(KEY)).toBe(store.toJSON())
    store.undo()
    expect(localStorage.getItem(KEY)).toBe(store.toJSON())
  })

  it('is discarded by New game', () => {
    startBots()
    expect(localStorage.getItem(KEY)).not.toBeNull()
    store.reset()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('restores the game a refresh would otherwise lose', () => {
    startBots()
    for (let i = 0; i < 8; i++) store.stepBotOnce()
    const blob = localStorage.getItem(KEY)!
    const journalLength = (JSON.parse(blob) as { journal: string[] }).journal.length
    expect(journalLength).toBeGreaterThan(0)

    // The "refresh": a fresh boot with only the storage surviving.
    store.reset()
    localStorage.setItem(KEY, blob)
    expect(store.restoreAutosave()).toBe(true)
    const restored = JSON.parse(store.toJSON()!) as { journal: string[] }
    expect(restored.journal.length).toBe(journalLength)
    // And the restored game still autosaves.
    store.stepBotOnce()
    expect(localStorage.getItem(KEY)).toBe(store.toJSON())
  })

  it('a corrupt blob costs one boot, not every boot', () => {
    localStorage.setItem(KEY, '{not json')
    expect(store.restoreAutosave()).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('restores nothing when nothing was saved', () => {
    expect(store.restoreAutosave()).toBe(false)
  })
})
