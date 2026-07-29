import { describe, expect, it } from 'vitest'

import {
  AGENTS_PER_FACTION,
  CITIES_PER_FACTION,
  LEADERS,
  LORE,
  MAX_LORE_PER_PLAYER,
  SHIPS_PER_FACTION,
  STARPORTS_PER_FACTION,
  leaderCard,
  leaderPool,
  leadersNeeded,
  loreCard,
  lorePool,
  loreNeeded,
  maxLorePerPlayer,
} from '../src/index.js'

/*
 * These are transcription tests. The tables are copied from haunt-roll-fail and the card art, so
 * what can go wrong is a wrong number or a missing card — not logic. Each test below is aimed at
 * a specific way the transcription could be wrong and still typecheck.
 */

describe('leader cards', () => {
  it('has all 16, split 8 base and 8 expansion', () => {
    expect(LEADERS).toHaveLength(16)
    expect(LEADERS.filter((l) => !l.expansion)).toHaveLength(8)
    expect(LEADERS.filter((l) => l.expansion)).toHaveLength(8)
  })

  it('ids run leader01..leader16 in order, with no gaps or duplicates', () => {
    expect(LEADERS.map((l) => l.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `leader${String(i + 1).padStart(2, '0')}`),
    )
  })

  // The boundary docs/14 records: base is 01-08, the Leaders & Lore Pack is 09-16.
  it('marks exactly leader09..leader16 as expansion', () => {
    for (const l of LEADERS) {
      const n = Number(l.id.slice('leader'.length))
      expect(l.expansion, `${l.id} (${l.name})`).toBe(n >= 9)
    }
  })

  it('every leader has two or three traits and exactly two resources', () => {
    for (const l of LEADERS) {
      expect(l.traits.length, `${l.name} traits`).toBeGreaterThanOrEqual(2)
      expect(l.traits.length, `${l.name} traits`).toBeLessThanOrEqual(3)
      expect(l.resources, `${l.name} resources`).toHaveLength(2)
    }
  })

  it('no trait is shared between leaders — each names its own effect', () => {
    const seen = new Map<string, string>()
    for (const l of LEADERS) {
      for (const t of l.traits) {
        expect(seen.has(t), `${t} on both ${seen.get(t)} and ${l.name}`).toBe(false)
        seen.set(t, l.name)
      }
    }
    // 13 leaders with 2 traits + 3 leaders with 3 traits (Noble, Anarchist... and one more).
    expect(seen.size).toBe(LEADERS.reduce((n, l) => n + l.traits.length, 0))
  })

  /*
   * The setup lists replace the board's standard placement, so a leader that asked for more
   * pieces than a faction owns would throw during setup rather than deal a bad position. The
   * fleet list (C) is placed once *per fleet system*, and a board can name several.
   */
  it('no leader can outspend a faction supply, even with three fleet systems', () => {
    const MOST_FLEET_SYSTEMS = 3
    for (const l of LEADERS) {
      const all = [...l.setupA, ...l.setupB, ...Array(MOST_FLEET_SYSTEMS).fill(l.setupC).flat()]
      const used = (p: string) => all.filter((x) => x === p).length
      expect(used('Ship'), `${l.name} ships`).toBeLessThanOrEqual(SHIPS_PER_FACTION)
      expect(used('City'), `${l.name} cities`).toBeLessThanOrEqual(CITIES_PER_FACTION)
      expect(used('Starport'), `${l.name} starports`).toBeLessThanOrEqual(STARPORTS_PER_FACTION)
      expect(used('Agent'), `${l.name} agents`).toBeLessThanOrEqual(AGENTS_PER_FACTION)
    }
  })

  it('carries the asymmetric openings that make leaders worth having', () => {
    // Spot-checks against the printed cards: these are the ones that break the standard shape.
    const rebel = leaderCard('leader05')
    expect(rebel.setupA).toContain('Starport')
    expect(rebel.setupA).not.toContain('City')

    const anarchist = leaderCard('leader13')
    expect(anarchist.setupA.every((p) => p === 'Ship')).toBe(true)
    expect(anarchist.setupB.every((p) => p === 'Ship')).toBe(true)

    const feastbringer = leaderCard('leader07')
    expect(feastbringer.setupA.filter((p) => p === 'City')).toHaveLength(1)
    expect(feastbringer.setupB.filter((p) => p === 'City')).toHaveLength(1)
  })

  it('pools by expansion, and rejects an unknown id rather than defaulting', () => {
    expect(leaderPool(false)).toHaveLength(8)
    expect(leaderPool(true)).toHaveLength(16)
    expect(leaderPool(false).every((l) => !l.expansion)).toBe(true)
    expect(() => leaderCard('leader99')).toThrow(/unknown leader/)
  })
})

describe('lore cards', () => {
  it('has all 30, split 14 base / 14 expansion / 2 unofficial', () => {
    expect(LORE).toHaveLength(30)
    expect(LORE.filter((c) => c.set === 'base')).toHaveLength(14)
    expect(LORE.filter((c) => c.set === 'expansion')).toHaveLength(14)
    expect(LORE.filter((c) => c.set === 'unofficial')).toHaveLength(2)
  })

  it('ids run lore01..lore30 in order, with no gaps or duplicates', () => {
    expect(LORE.map((c) => c.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => `lore${String(i + 1).padStart(2, '0')}`),
    )
  })

  // docs/14: base 01-14, expansion 15-28, and HRF's two fan cards at 29-30.
  it('assigns each card to the set its number falls in', () => {
    for (const c of LORE) {
      const n = Number(c.id.slice('lore'.length))
      const expected = n <= 14 ? 'base' : n <= 28 ? 'expansion' : 'unofficial'
      expect(c.set, `${c.id} (${c.name})`).toBe(expected)
    }
  })

  it('keeps the ten ambition-paired cards together in the expansion', () => {
    for (const ambition of ['Empath', 'Keeper', 'Warlord', 'Tyrant', 'Tycoon']) {
      const pair = LORE.filter((c) => c.name.startsWith(`${ambition}'s`))
      expect(pair, `${ambition} pair`).toHaveLength(2)
      expect(pair.every((c) => c.set === 'expansion'), `${ambition} pair set`).toBe(true)
    }
  })

  it('pools by set, and rejects an unknown id rather than defaulting', () => {
    expect(lorePool(false)).toHaveLength(14)
    expect(lorePool(true)).toHaveLength(28)
    expect(lorePool(true, true)).toHaveLength(30)
    // Unofficial cards are their own opt-in: the expansion alone never deals them.
    expect(lorePool(true).some((c) => c.set === 'unofficial')).toBe(false)
    expect(lorePool(false, true).map((c) => c.set)).not.toContain('expansion')
    expect(() => loreCard('lore99')).toThrow(/unknown lore/)
  })
})

describe('draft sizing', () => {
  it('deals one more leader than there are players, so the last still chooses', () => {
    expect(leadersNeeded(3)).toBe(4)
    expect(leadersNeeded(4)).toBe(5)
  })

  it('deals players+1 lore, plus each extra beyond the first for every player', () => {
    // The table in docs/14 section 4.
    expect([1, 2, 3, 4, 5].map((n) => loreNeeded(3, n))).toEqual([4, 7, 10, 13, 16])
    expect([1, 2, 3, 4, 5].map((n) => loreNeeded(4, n))).toEqual([5, 9, 13, 17, 21])
  })

  /*
   * The constraint that matters for the UI: a base-only deck cannot cover every setting, so the
   * cap has to be derived rather than assumed. If this ever reads 5 across the board, the
   * setting is being offered for a deal that would run the deck dry.
   */
  it('caps the lore setting to what the chosen pool can actually deal', () => {
    const base = lorePool(false).length
    const withExpansion = lorePool(true).length

    expect(maxLorePerPlayer(3, base)).toBe(4)
    expect(maxLorePerPlayer(4, base)).toBe(3)
    expect(maxLorePerPlayer(3, withExpansion)).toBe(MAX_LORE_PER_PLAYER)
    expect(maxLorePerPlayer(4, withExpansion)).toBe(MAX_LORE_PER_PLAYER)
  })

  it('every allowed setting is actually dealable from its pool', () => {
    for (const players of [3, 4]) {
      for (const [expansion, unofficial] of [[false, false], [true, false], [true, true]] as const) {
        const pool = lorePool(expansion, unofficial).length
        const cap = maxLorePerPlayer(players, pool)
        expect(loreNeeded(players, cap), `${players}p pool ${pool}`).toBeLessThanOrEqual(pool)
        // And the leaders have to be there too.
        expect(leadersNeeded(players)).toBeLessThanOrEqual(leaderPool(expansion).length)
      }
    }
  })
})
