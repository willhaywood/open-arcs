import { describe, expect, it } from 'vitest'

import { applyHits } from '../src/index.js'

/**
 * Hit application. A fresh piece absorbs two hits (damage, then destroy); a damaged piece
 * absorbs one. Hits beyond the pool overflow — for ship hits that means bombardment.
 * HRF's model: `shipsN = sum(fresh ? 2 : 1)`, with `b += h - shipsN` when hits exceed it
 * (game-battle.scala:491-499).
 *
 * The bug this guards: resolution ran two sequential passes (finish damaged, then damage
 * fresh), so it could never damage *and then* destroy within one battle. Four hits against
 * two fresh ships damaged both and silently wasted two hits instead of destroying both.
 */
describe('applyHits', () => {
  const A = 'red/Ship/1'
  const B = 'red/Ship/2'

  it('damages a fresh piece with one hit', () => {
    const r = applyHits([], [A], 1)
    expect(r.destroyed).toEqual([])
    expect(r.damaged).toEqual([A])
    expect(r.remaining).toBe(0)
  })

  it('destroys a fresh piece with two hits', () => {
    const r = applyHits([], [A], 2)
    expect(r.destroyed).toEqual([A])
    expect(r.damaged).toEqual([])
    expect(r.remaining).toBe(0)
  })

  it('destroys an already-damaged piece with one hit', () => {
    const r = applyHits([A], [A], 1)
    expect(r.destroyed).toEqual([A])
    expect(r.damaged).toEqual([])
    expect(r.remaining).toBe(0)
  })

  it('destroys two fresh pieces with four hits (the regression)', () => {
    const r = applyHits([], [A, B], 4)
    expect(new Set(r.destroyed)).toEqual(new Set([A, B]))
    expect(r.damaged).toEqual([])
    expect(r.remaining).toBe(0)
  })

  it('consumes the whole health pool before overflowing', () => {
    // 2 fresh = 4 health; 6 hits destroys both and leaves 2 to overflow.
    const r = applyHits([], [A, B], 6)
    expect(new Set(r.destroyed)).toEqual(new Set([A, B]))
    expect(r.remaining).toBe(2)
  })

  it('counts a damaged piece as one health, not two', () => {
    // A damaged + B fresh = 1 + 2 = 3 health.
    const r = applyHits([A], [A, B], 3)
    expect(new Set(r.destroyed)).toEqual(new Set([A, B]))
    expect(r.remaining).toBe(0)
  })

  it('overflows every hit when there are no targets', () => {
    const r = applyHits([], [], 3)
    expect(r.destroyed).toEqual([])
    expect(r.remaining).toBe(3)
  })

  it('does nothing with zero hits', () => {
    const r = applyHits([A], [A, B], 0)
    expect(r.destroyed).toEqual([])
    expect(r.damaged).toEqual([A])
    expect(r.remaining).toBe(0)
  })

  it('is pure — the input damaged list is not mutated', () => {
    const damaged = [A]
    const frozen = [...damaged]
    applyHits(damaged, [A, B], 3)
    expect(damaged).toEqual(frozen)
  })

  it('never destroys the same piece twice', () => {
    const r = applyHits([], [A, B], 10)
    expect(new Set(r.destroyed).size).toBe(r.destroyed.length)
  })
})
