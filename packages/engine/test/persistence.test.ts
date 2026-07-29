import { describe, expect, it } from 'vitest'

import {
  advance,
  applyExternal,
  defaultRegistry,
  digest,
  loadGame,
  replayGame,
  serializeGame,
  startGame,
  undo,
} from '../src/index.js'
import type { Action, GameState, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const OPTS = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'] as const, seed: 77 }

/** A deterministic policy so recorded games are reproducible. */
const policy = (actions: readonly Action[]): Action => {
  const by = (t: string) => actions.find((a) => a.type === t)
  return (
    by('ambition/declare') ??
    actions.find((a) => a['label'] === 'Tax') ??
    by('action/tax-city') ??
    by('turn/lead') ??
    by('turn/surpass') ??
    by('turn/end') ??
    by('turn/skip-seize') ??
    by('ambition/skip-declare') ??
    by('turn/pass') ??
    actions[0]!
  )
}

/** Play `steps` external actions with `applyExternal`, so the journal is recorded. */
function playRecorded(steps: number): RuleResult {
  let result = startGame(OPTS, registry)
  for (let i = 0; i < steps && result.continue.kind === 'ask'; i++) {
    result = applyExternal(result, policy(result.continue.actions), registry)
  }
  return result
}

describe('journal recording', () => {
  it('records one entry per external action', () => {
    const result = playRecorded(5)
    expect(result.state.journal.length).toBeGreaterThan(0)
    expect(result.state.journal.length).toBeLessThanOrEqual(5)
  })

  it('startGame leaves an empty journal (setup is internal)', () => {
    expect(startGame(OPTS, registry).state.journal).toEqual([])
  })
})

describe('replay reproduces state exactly (golden replay)', () => {
  it('replaying the journal gives an identical figure digest and power', () => {
    const played = playRecorded(40)
    const replayed = replayGame(OPTS, played.state.journal, registry)
    expect(digest(replayed.state.figures)).toBe(digest(played.state.figures))
    expect(replayed.state.power).toEqual(played.state.power)
    expect(replayed.state.log).toEqual(played.state.log)
  })
})

describe('undo', () => {
  it('steps back exactly one external action', () => {
    const played = playRecorded(12)
    const stepped = undo(OPTS, played, registry)
    expect(stepped.state.journal).toEqual(played.state.journal.slice(0, -1))
  })

  it('lands on the state that produced the previous decision', () => {
    // Play N, remember state at N-1, play one more, undo — should match N-1.
    const atN1 = playRecorded(9)
    const one = applyExternal(atN1, policy(atN1.continue.kind === 'ask' ? atN1.continue.actions : []), registry)
    const back = undo(OPTS, one, registry)
    expect(digest(back.state.figures)).toBe(digest(atN1.state.figures))
    expect(back.state.log).toEqual(atN1.state.log)
  })

  it('is a no-op at the start of the game', () => {
    const start = startGame(OPTS, registry)
    expect(undo(OPTS, start, registry).state.journal).toEqual([])
  })

  it('repeated undo walks all the way back to the start', () => {
    let result = playRecorded(15)
    while (result.state.journal.length > 0) {
      result = undo(OPTS, result, registry)
    }
    expect(digest(result.state.figures)).toBe(digest(startGame(OPTS, registry).state.figures))
  })
})

describe('save and load', () => {
  it('round-trips through JSON to an identical state', () => {
    const played = playRecorded(30)
    const json = serializeGame(OPTS, played)
    const { result } = loadGame(json, registry)
    expect(digest(result.state.figures)).toBe(digest(played.state.figures))
    expect(result.state.power).toEqual(played.state.power)
    expect(result.state.journal).toEqual(played.state.journal)
  })

  it('the save is small — the journal, not the whole state', () => {
    const played = playRecorded(30)
    const json = serializeGame(OPTS, played)
    // A full-state dump would be far larger; the journal keeps saves tiny.
    expect(json.length).toBeLessThan(8000)
  })

  it('rejects a wrong-version file with a clear error', () => {
    const bad = JSON.stringify({ version: 999, options: OPTS, journal: [] })
    expect(() => loadGame(bad, registry)).toThrow(/unsupported save version/)
  })

  it('rejects malformed JSON', () => {
    expect(() => loadGame('{not json', registry)).toThrow(/invalid JSON/)
  })

  it('a loaded game continues identically to one never saved', () => {
    const played = playRecorded(20)
    const { result: loaded } = loadGame(serializeGame(OPTS, played), registry)

    const next = (r: RuleResult) =>
      r.continue.kind === 'ask' ? applyExternal(r, policy(r.continue.actions), registry) : r

    const a = next(played)
    const b = next(loaded)
    expect(digest(a.state.figures)).toBe(digest(b.state.figures))
    expect(a.state.log).toEqual(b.state.log)
  })
})

// touch imports used only in types
export type _S = GameState
const _touch = advance
void _touch
