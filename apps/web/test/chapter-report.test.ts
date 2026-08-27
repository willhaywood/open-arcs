/**
 * The chapter report's parsing: the engine's exact scoring prose in, structured results out.
 *
 * The parser is deliberately coupled to the log formats in `rules/ambitions.ts` — the engine
 * keeps no structured scoring record, so the prose is the record. These tests pin every line
 * shape the scorer can emit, and the noise case pins the property that makes the coupling safe:
 * a line that matches nothing is ignored, and the section ends at the next chapter's deal.
 */

import { startGame, defaultRegistry } from '@arcs/engine'
import type { FactionId, GameState } from '@arcs/engine'
import { describe, expect, it } from 'vitest'

import { buildChapterReport, chapterEnded, finalChapterReport } from '../src/chapter-report.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/** A real engine state to hang the crafted fields on — `metric` needs genuine internals. */
function base(): GameState {
  return startGame({ board: 'Board3MixUp', factions: [...THREE], seed: 1 }, registry).state
}

/** A prev/next pair around a crafted scoring delta. */
function boundary(
  scoringLines: string[],
  edit: {
    declared?: GameState['declared']
    powerBefore?: Record<string, number>
    powerAfter?: Record<string, number>
  } = {},
): { prev: GameState; next: GameState } {
  const s = base()
  const prev: GameState = {
    ...s,
    chapter: 2,
    declared: edit.declared ?? [
      { ambition: 'Tycoon', marker: { high: 5, low: 3 }, round: 2 },
    ],
    power: edit.powerBefore ?? { red: 3, yellow: 1, blue: 0 },
  }
  const next: GameState = {
    ...s,
    chapter: 3,
    declared: [],
    power: edit.powerAfter ?? { red: 8, yellow: 4, blue: 0 },
    log: [
      ...s.log,
      ...scoringLines,
      'Chapter 3: dealt 6 cards each',
      // Lines after the deal belong to the next chapter and must not parse into this report.
      'red won Empath for 99 power',
    ],
  }
  return { prev, next }
}

describe('chapter boundaries', () => {
  it('a chapter bump is a boundary; standing still is not', () => {
    const { prev, next } = boundary([])
    expect(chapterEnded(prev, next)).toBe(true)
    expect(chapterEnded(prev, prev)).toBe(false)
  })

  it('the final chapter never bumps — the isOver edge is its boundary', () => {
    const s = base()
    const prev = { ...s, chapter: 5 }
    const next = { ...s, chapter: 5, isOver: true }
    expect(finalChapterReport(prev, next)).not.toBeNull()
    expect(finalChapterReport(prev, prev)).toBeNull()
  })
})

describe('parsing the scoring prose', () => {
  it('a win and a second place, with their powers', () => {
    const { prev, next } = boundary([
      'red won Tycoon for 7 power',
      'yellow placed second in Tycoon for 3 power',
    ])
    const r = buildChapterReport(prev, next)
    expect(r.chapter).toBe(2)
    const tycoon = r.results.find((x) => x.ambition === 'Tycoon')!
    expect(tycoon.awards).toEqual([
      { faction: 'red', place: 'first', power: 7, demoted: false },
      { faction: 'yellow', place: 'second', power: 3, demoted: false },
    ])
    expect(tycoon.markers).toEqual([{ high: 5, low: 3 }])
    expect(tycoon.noOneScored).toBe(false)
  })

  it('demotions carry their flag: a leader-limited win and a zeroed second', () => {
    const { prev, next } = boundary([
      'red won Tycoon but takes only 3 power (their leader)',
      'yellow placed second in Tycoon but takes no power (their leader)',
    ])
    const tycoon = buildChapterReport(prev, next).results[0]!
    expect(tycoon.awards).toEqual([
      { faction: 'red', place: 'first', power: 3, demoted: true },
      { faction: 'yellow', place: 'second', power: 0, demoted: true },
    ])
  })

  it('ties, including the Proud zero', () => {
    const { prev, next } = boundary([
      'red tied Tycoon for 3 power',
      'blue tied Tycoon but takes no power (their leader)',
    ])
    const tycoon = buildChapterReport(prev, next).results[0]!
    expect(tycoon.awards).toEqual([
      { faction: 'red', place: 'tied', power: 3, demoted: false },
      { faction: 'blue', place: 'tied', power: 0, demoted: true },
    ])
  })

  it('the two-player phantom occupies places without earning awards', () => {
    const { prev, next } = boundary([
      'the out-of-play resources lead Tycoon; no one takes first',
      'red placed second in Tycoon for 3 power',
    ])
    const tycoon = buildChapterReport(prev, next).results[0]!
    expect(tycoon.phantom).toEqual(['first'])
    expect(tycoon.awards).toEqual([{ faction: 'red', place: 'second', power: 3, demoted: false }])
  })

  it('an ambition nobody qualified for', () => {
    const { prev, next } = boundary(['No one scored Tycoon'])
    const tycoon = buildChapterReport(prev, next).results[0]!
    expect(tycoon.noOneScored).toBe(true)
    expect(tycoon.awards).toEqual([])
  })

  it('cleanup kinds parse singly and together', () => {
    for (const [line, want] of [
      ['Chapter cleanup: all trophies returned', { trophies: true, captives: false }],
      ['Chapter cleanup: all captives returned', { trophies: false, captives: true }],
      ['Chapter cleanup: all trophies and captives returned', { trophies: true, captives: true }],
    ] as const) {
      const { prev, next } = boundary([line])
      expect(buildChapterReport(prev, next).cleanup).toEqual(want)
    }
  })

  it('ignores the noise sharing the delta, and stops at the deal', () => {
    const { prev, next } = boundary([
      'red discarded 2 Fuel (their leader)',
      'red won Tycoon for 7 power',
      'yellow drew Aggression-2 (held by a Union)',
      'round over — 4 played cards discarded',
    ])
    const r = buildChapterReport(prev, next)
    // Exactly one award — none of the noise lines matched, and the post-deal
    // "red won Empath for 99 power" line never entered this chapter's report.
    expect(r.results.flatMap((x) => x.awards)).toHaveLength(1)
    expect(r.results.some((x) => x.ambition === 'Empath')).toBe(false)
  })

  it('stacked declarations keep every marker, and power rows diff before/after', () => {
    const { prev, next } = boundary(['red won Tycoon for 12 power'], {
      declared: [
        { ambition: 'Tycoon', marker: { high: 5, low: 3 }, round: 1 },
        { ambition: 'Tycoon', marker: { high: 4, low: 2 }, round: 3 },
      ],
      powerBefore: { red: 0, yellow: 2, blue: 2 },
      powerAfter: { red: 12, yellow: 2, blue: 2 },
    })
    const r = buildChapterReport(prev, next)
    expect(r.results[0]!.markers).toEqual([
      { high: 5, low: 3 },
      { high: 4, low: 2 },
    ])
    expect(r.power).toEqual([
      { faction: 'red', before: 0, after: 12 },
      { faction: 'yellow', before: 2, after: 2 },
      { faction: 'blue', before: 2, after: 2 },
    ])
  })
})
