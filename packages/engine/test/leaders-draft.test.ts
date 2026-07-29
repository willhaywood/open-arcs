import { describe, expect, it } from 'vitest'

import {
  CITY_SLOT_COUNT,
  LEADERS,
  Location,
  ResourceSlot,
  advance,
  applyExternal,
  contentsOf,
  defaultRegistry,
  leaderCard,
  loreCard,
  parseFigureId,
  parseResourceToken,
  replayGame,
  serializeGame,
  startGame,
} from '../src/index.js'
import type { Action, Continue, FactionId, NewGameOptions, RuleResult } from '../src/index.js'

const FOUR = ['red', 'yellow', 'blue', 'white'] as const
const THREE = ['red', 'yellow', 'blue'] as const
const registry = defaultRegistry()

type Ask = Extract<Continue, { kind: 'ask' }>

function variant(over: Partial<NewGameOptions> = {}): NewGameOptions {
  return {
    board: 'Board4MixUp1',
    factions: [...FOUR],
    seed: 5,
    leadersAndLore: { lorePerPlayer: 1 },
    ...over,
  }
}

/** Play the draft out, choosing with `pick`, and stop at the first non-draft decision. */
function runDraft(
  options: NewGameOptions,
  pick: (c: Ask) => Action = (c) => c.actions[0]!,
): { result: RuleResult; order: FactionId[]; journal: Action[] } {
  let step = startGame(options, registry)
  const order: FactionId[] = []
  const journal: Action[] = []
  for (let i = 0; i < 200; i++) {
    const c = step.continue
    if (c.kind !== 'ask') break
    if (!c.actions.some((a) => a.type === 'leaders/take')) break
    const chosen = pick(c)
    order.push(c.faction)
    journal.push(chosen)
    step = advance(step.state, chosen, registry)
  }
  return { result: step, order, journal }
}

describe('the leaders and lore draft', () => {
  it('is skipped entirely for a base game', () => {
    const base = startGame({ board: 'Board4MixUp1', factions: [...FOUR], seed: 5 }, registry)
    expect(base.state.leaders).toEqual({})
    expect(base.state.draft).toBeUndefined()
    // Straight to the first real decision, with no draft in between.
    expect(base.continue.kind).toBe('ask')
    expect((base.continue as Ask).actions.some((a) => a.type === 'leaders/take')).toBe(false)
  })

  it('deals one more leader than there are players, so the last still chooses', () => {
    // Peek at the pools the moment the draft opens.
    let step = startGame(variant(), registry)
    for (let i = 0; i < 10 && step.state.draft === undefined; i++) {
      step = advance(step.state, { type: 'leaders/deal' }, registry)
    }
    expect(step.state.draft?.leaders).toHaveLength(5)
    expect(step.state.draft?.lores).toHaveLength(5)
  })

  /*
   * HRF drafts in a repeating *reverse* seating cycle, starting from the last seat
   * (`DraftNextAction`) — not a snake. With four players that is white, blue, yellow, red,
   * and then round again for the lore.
   */
  it('drafts in reverse seating order, cycling', () => {
    const { order } = runDraft(variant())
    expect(order).toEqual([
      'white', 'blue', 'yellow', 'red',
      'white', 'blue', 'yellow', 'red',
    ])
  })

  it('gives every faction exactly one leader and its lore quota', () => {
    for (const perPlayer of [1, 2, 3]) {
      const { result } = runDraft(variant({ leadersAndLore: { lorePerPlayer: perPlayer } }))
      for (const f of FOUR) {
        expect(result.state.leaders[f], `${f} leader at x${perPlayer}`).toBeDefined()
        expect(result.state.lores[f] ?? [], `${f} lore at x${perPlayer}`).toHaveLength(perPlayer)
      }
    }
  })

  it('never deals the same card to two factions', () => {
    const { result } = runDraft(variant({ leadersAndLore: { lorePerPlayer: 2 } }))
    const leaders = FOUR.map((f) => result.state.leaders[f])
    const lores = FOUR.flatMap((f) => result.state.lores[f] ?? [])
    expect(new Set(leaders).size).toBe(leaders.length)
    expect(new Set(lores).size).toBe(lores.length)
  })

  it('clears the draft pool when it ends — the leftovers go back in the box', () => {
    const { result } = runDraft(variant())
    expect(result.state.draft).toBeUndefined()
  })

  it('respects the expansion setting when choosing what to deal', () => {
    // Base-only can only ever deal leaders 01-08.
    const { result } = runDraft(variant({ leadersAndLore: { expansion: false, lorePerPlayer: 1 } }))
    for (const f of FOUR) {
      const id = result.state.leaders[f]!
      expect(leaderCard(id).expansion, `${f} drew ${leaderCard(id).name}`).toBe(false)
      for (const lore of result.state.lores[f] ?? []) {
        expect(loreCard(lore).set, `${f} drew ${loreCard(lore).name}`).toBe('base')
      }
    }
  })

  it('works at three players too', () => {
    const { result, order } = runDraft(
      variant({ factions: [...THREE], board: 'Board3MixUp' }),
    )
    expect(order).toEqual(['blue', 'yellow', 'red', 'blue', 'yellow', 'red'])
    for (const f of THREE) expect(result.state.leaders[f]).toBeDefined()
  })

  /*
   * The draft is a sequence of ordinary journalled actions, so the whole variant has to survive
   * replay like everything else — undo and load depend on it.
   */
  it('replays identically from the journal', () => {
    const options = variant({ leadersAndLore: { lorePerPlayer: 2 } })
    let live = startGame(options, registry)
    for (let i = 0; i < 200; i++) {
      const c = live.continue
      if (c.kind !== 'ask') break
      if (!c.actions.some((a) => a.type === 'leaders/take')) break
      live = applyExternal(live, c.actions[0]!, registry)
    }
    const replayed = replayGame(options, live.state.journal, registry)
    expect(replayed.state.leaders).toEqual(live.state.leaders)
    expect(replayed.state.lores).toEqual(live.state.lores)
    expect(replayed.state.log).toEqual(live.state.log)
  })

  it('survives a save/load round trip mid-variant', () => {
    const options = variant()
    const { result } = runDraftExternal(options)
    const loaded = replayGame(options, JSON.parse(serializeGame(options, result)).journal, registry)
    expect(loaded.state.leaders).toEqual(result.state.leaders)
  })

  function runDraftExternal(options: NewGameOptions): { result: RuleResult } {
    let step = startGame(options, registry)
    for (let i = 0; i < 200; i++) {
      const c = step.continue
      if (c.kind !== 'ask') break
      if (!c.actions.some((a) => a.type === 'leaders/take')) break
      step = applyExternal(step, c.actions[0]!, registry)
    }
    return { result: step }
  }
})

describe('leader setup', () => {
  /** What `faction` has standing on the board, by piece. */
  function onBoard(state: RuleResult['state'], faction: string): Record<string, number> {
    const by: Record<string, number> = {}
    for (const sys of state.board.systems) {
      for (const id of contentsOf(state.figures, Location.system(sys))) {
        const p = parseFigureId(id)
        if (p.color === faction) by[p.piece] = (by[p.piece] ?? 0) + 1
      }
    }
    return by
  }

  /**
   * Seat every leader and check the board against its printed card.
   *
   * This is the test that matters: a leader that quietly placed the *standard* opening would
   * pass every other test here, because the draft would still look correct. It sweeps seeds
   * until all 16 have actually been drafted, and asserts that coverage — an earlier version
   * skipped any leader the deal did not offer and silently checked only five of them.
   */
  it('places exactly what each of the 16 leaders prints', () => {
    const checked = new Set<string>()

    for (let seed = 1; seed <= 60 && checked.size < LEADERS.length; seed++) {
      const options = variant({ seed, leadersAndLore: { expansion: true, lorePerPlayer: 1 } })
      let step = startGame(options, registry)
      const first = step.continue
      if (first.kind !== 'ask') continue

      // Take whichever offered leader is still unchecked, so each seed makes progress.
      const want = (first as Ask).actions.find(
        (a) =>
          a.type === 'leaders/take' &&
          a['kind'] === 'leader' &&
          !checked.has(a['card'] as string),
      )
      if (want === undefined) continue

      const leader = leaderCard(want['card'] as string)
      const taker = (first as Ask).faction
      step = advance(step.state, want, registry)
      for (let i = 0; i < 200; i++) {
        const c = step.continue
        if (c.kind !== 'ask') break
        if (!c.actions.some((a) => a.type === 'leaders/take')) break
        step = advance(step.state, c.actions[0]!, registry)
      }

      const seat = step.state.factions.indexOf(taker)
      const [, , fleets] = step.state.board.starting[seat]!
      const expected: Record<string, number> = {}
      const add = (pieces: readonly string[], times = 1) => {
        for (let i = 0; i < times; i++) {
          for (const p of pieces) expected[p] = (expected[p] ?? 0) + 1
        }
      }
      add(leader.setupA)
      add(leader.setupB)
      add(leader.setupC, fleets.length)

      expect(onBoard(step.state, taker), `${leader.name} opening`).toEqual(expected)
      checked.add(leader.id)
    }

    // Without this the test could pass having checked almost nothing.
    expect([...checked].sort()).toEqual(LEADERS.map((l) => l.id).sort())
  })

  it('gives a leader its own two resources, not the systems it landed on', () => {
    const { result } = runDraft(variant())
    for (const f of FOUR) {
      const leader = leaderCard(result.state.leaders[f]!)
      const held = Array.from({ length: CITY_SLOT_COUNT }, (_, i) =>
        contentsOf(result.state.resources, ResourceSlot.citySlot(f, i)),
      )
        .flat()
        .map((t) => parseResourceToken(t).resource)
      expect(held.sort(), `${f} as ${leader.name}`).toEqual([...leader.resources].sort())
    }
  })

  it('reaches a normal first turn once seated', () => {
    const { result } = runDraft(variant())
    expect(result.continue.kind).toBe('ask')
    const ask = result.continue as Ask
    expect(ask.prompt).toMatch(/leads/)
    // And the game is playable from there.
    expect(ask.actions.length).toBeGreaterThan(0)
  })
})
