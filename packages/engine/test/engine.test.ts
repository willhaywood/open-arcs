import { describe, expect, it } from 'vitest'

import {
  COLOR_IDS,
  Continue,
  FACTION_IDS,
  Location,
  RuleRegistry,
  advance,
  allSystems,
  areConnected,
  board,
  boardNames,
  boardsFor,
  connected,
  contentsOf,
  createGame,
  decodeAction,
  defaultRegistry,
  digest,
  encodeAction,
  figureId,
  isFaction,
  move,
  nextInt,
  observe,
  parseFigureId,
  prependRuleModule,
  rng,
  shuffle,
  startGame,
  unhandled,
} from '../src/index.js'
import type { Action, FactionId, GameState, RuleModule } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const FOUR = ['red', 'yellow', 'blue', 'white'] as const

describe('ids: Color and Faction are distinct', () => {
  it('factions are the four player colors', () => {
    expect([...FACTION_IDS]).toEqual(['red', 'yellow', 'blue', 'white'])
  })

  it('colors include rules-driven NPCs that are not factions', () => {
    expect(COLOR_IDS).toContain('blights')
    expect(isFaction('blights')).toBe(false)
    expect(isFaction('red')).toBe(true)
  })

  it('figure ids round-trip', () => {
    const id = figureId('red', 'Ship', 3)
    expect(id).toBe('red/Ship/3')
    expect(parseFigureId(id)).toEqual({ color: 'red', piece: 'Ship', index: 3 })
  })
})

describe('board topology', () => {
  it('exposes every board variant', () => {
    expect([...boardNames()].sort()).toEqual([
      'Board2Frontiers',
      'Board2Homelands',
      'Board2MixUp1',
      'Board2MixUp2',
      'Board3CoreConflict',
      'Board3Frontiers',
      'Board3Homelands',
      'Board3MixUp',
      'Board4Frontiers',
      'Board4MixUp1',
      'Board4MixUp2',
      'Board4MixUp3',
      'BoardFull',
    ])
  })

  it('offers all four printed setups at each of 2, 3 and 4 players', () => {
    expect(boardsFor(2)).toHaveLength(4)
    expect(boardsFor(3)).toHaveLength(4)
    expect(boardsFor(4)).toHaveLength(4)
  })

  it('2p and 3p boards use 4 clusters, 4p boards use 5, campaign uses 6', () => {
    // Setup J: two clusters go out of play at 2-3 players, one at 4.
    for (const b of boardsFor(2)) expect(b.clusters).toHaveLength(4)
    for (const b of boardsFor(3)) expect(b.clusters).toHaveLength(4)
    for (const b of boardsFor(4)) expect(b.clusters).toHaveLength(5)
    expect(board('BoardFull').clusters).toHaveLength(6)
  })

  /*
   * Starting positions had no coverage at all, which is how a bad port would have gone unnoticed:
   * a seat pointing at an out-of-play cluster, or two players sharing a home system, produces a
   * board that looks fine and deals an illegal setup.
   */
  it('every seat starts on real, in-play, distinct systems', () => {
    for (const name of boardNames()) {
      const b = board(name)
      if (b.starting.length === 0) continue // campaign board deals no seats

      expect(b.starting, `${name} seats`).toHaveLength(b.players)

      const claimed = new Set<string>()
      for (const [city, starport, fleets] of b.starting) {
        for (const home of [city, starport]) {
          expect(b.systems, `${name}: ${home} is on the board`).toContain(home)
          expect(home.endsWith('-Gate'), `${name}: ${home} is a planet, not a gate`).toBe(false)
          // Two seats sharing a home system would be an illegal deal.
          expect(claimed.has(home), `${name}: ${home} claimed twice`).toBe(false)
          claimed.add(home)
        }
        for (const fleet of fleets) {
          expect(b.systems, `${name}: ${fleet} is on the board`).toContain(fleet)
        }
        /*
         * Setup N: 2 ships go in *one* system at 3-4 players and *two* at 2 players — and the
         * second of the pair is a planet, not another gate. "Every fleet starts at a gate" held
         * for every 3-4 player seat and is exactly the wrong generalisation to carry into 2p, so
         * the shape is asserted per player count instead.
         */
        const gates = fleets.filter((f) => f.endsWith('-Gate'))
        if (b.players === 2) {
          expect(fleets, `${name}: 2p seats hold two fleet systems`).toHaveLength(2)
          expect(gates, `${name}: exactly one of the two is a gate`).toHaveLength(1)
        } else {
          expect(fleets, `${name}: 3-4p seats hold one fleet system`).toHaveLength(1)
          expect(gates, `${name}: which is a gate`).toHaveLength(1)
        }
      }
    }
  })

  it('every board deals a playable opening position', () => {
    for (const b of [...boardsFor(3), ...boardsFor(4)]) {
      const factions = ['red', 'yellow', 'blue', 'white'].slice(0, b.players) as FactionId[]
      const result = startGame({ board: b.name, factions, seed: 7 })
      expect(result.continue.kind, `${b.name} reaches a decision`).toBe('ask')

      // Setup put each seat's City and Starport on the systems the board names.
      b.starting.forEach(([city, starport], i) => {
        const faction = factions[i]!
        const at = (sys: string) => contentsOf(result.state.figures, Location.system(sys))
        expect(at(city).some((id) => id === `${faction}/City/1`), `${b.name} seat ${i + 1} city`).toBe(true)
        expect(
          at(starport).some((id) => id.startsWith(`${faction}/Starport/`)),
          `${b.name} seat ${i + 1} starport`,
        ).toBe(true)
      })
    }
  })

  it('excludes the campaign board from base-game options', () => {
    expect(boardsFor(3).map((b) => b.name)).not.toContain('BoardFull')
    expect(board('BoardFull').campaignOnly).toBe(true)
  })

  it('adjacency is symmetric on every board', () => {
    for (const name of boardNames()) {
      const b = board(name)
      for (const from of b.systems) {
        for (const to of connected(b, from)) {
          expect(areConnected(b, to, from), `${to} -> ${from} on ${name}`).toBe(true)
        }
      }
    }
  })

  it('Arrow and Hex are not directly connected within a cluster', () => {
    const b = board('BoardFull')
    expect(areConnected(b, '1-Arrow', '1-Hex')).toBe(false)
    expect(areConnected(b, '1-Arrow', '1-Crescent')).toBe(true)
  })

  it('carries the two special cross-cluster planet links', () => {
    const b = board('BoardFull')
    expect(areConnected(b, '6-Arrow', '5-Hex')).toBe(true)
    expect(areConnected(b, '3-Arrow', '2-Hex')).toBe(true)
  })

  it('closes the gate ring across out-of-play clusters', () => {
    // Board3MixUp uses 2,3,5,6 — so 3-Gate's next in the ring is 5-Gate.
    const b = board('Board3MixUp')
    expect(areConnected(b, '3-Gate', '5-Gate')).toBe(true)
  })

  it('rejects an unknown board rather than defaulting', () => {
    expect(() => board('Standard')).toThrow(/unknown board/)
  })

  it('flags the fate-only system and keeps it off every board', () => {
    const passage = allSystems().find((s) => s.id === '7-Gate')
    expect(passage?.fateOnly).toBe(true)
    for (const name of boardNames()) {
      expect(board(name).systems).not.toContain('7-Gate')
    }
  })
})

describe('rng is seeded, immutable and deterministic', () => {
  it('same seed gives the same sequence', () => {
    const a = draw(rng(42))
    const b = draw(rng(42))
    expect(a).toEqual(b)
  })

  it('different seeds diverge', () => {
    expect(draw(rng(1))).not.toEqual(draw(rng(2)))
  })

  it('does not mutate the generator it was given', () => {
    const start = rng(7)
    nextInt(start, 100)
    nextInt(start, 100)
    const [first] = nextInt(start, 100)
    const [again] = nextInt(start, 100)
    expect(first).toBe(again)
  })

  it('shuffle is a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const [out] = shuffle(rng(9), input)
    expect(out.sort((x, y) => x - y)).toEqual(input)
  })

  function draw(seed: ReturnType<typeof rng>): number[] {
    const out: number[] = []
    let current = seed
    for (let i = 0; i < 12; i++) {
      const [n, next] = nextInt(current, 1000)
      out.push(n)
      current = next
    }
    return out
  }
})

describe('rule chain lives in state and is modifiable at runtime', () => {
  const Interceptor: RuleModule = {
    id: 'interceptor',
    perform(state, action) {
      if (action.type === 'chapter/start') {
        return { state: { ...state, chapter: 99 }, continue: Continue.gameOver([], 'intercepted') }
      }
      return unhandled(state)
    },
  }

  it('is a list of ids on the state, not a static list', () => {
    const state = createGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    expect(state.ruleChain).toEqual([
      'setup',
      'turn',
      'ambitions',
      'standard-actions',
      'battle',
      'vox',
    ])
  })

  it('a module prepended mid-game intercepts ahead of existing rules', () => {
    // This is what a fate does when it attaches during a campaign.
    const registry = defaultRegistry().register(Interceptor)
    const before = startGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    expect(before.state.chapter).toBe(1)

    const patched = prependRuleModule(before.state, 'interceptor')
    const after = advance(patched, { type: 'chapter/start' }, registry)
    expect(after.state.chapter).toBe(99)
    expect(after.continue.kind).toBe('gameOver')
  })

  it('throws a legible error when nothing handles an action', () => {
    const state = createGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    expect(() => advance(state, { type: 'nonsense/action' }, defaultRegistry())).toThrow(
      /no rule module handled action: nonsense\/action/,
    )
  })

  it('registry rejects duplicate module ids', () => {
    const registry = new RuleRegistry().register(Interceptor)
    expect(() => registry.register(Interceptor)).toThrow(/already registered/)
  })
})

describe('setup runs as actions', () => {
  it('reaches a decision point with pieces on the board', () => {
    const { state, continue: c } = startGame({
      board: 'Board4MixUp1',
      factions: FOUR,
      seed: 5,
    })

    expect(c.kind).toBe('ask')
    expect(state.chapter).toBe(1)
    expect(state.current).toBe('red')

    // 4 seats x (1 city + 3 ships + 1 starport + 3 ships + 2 ships) = 40 pieces placed.
    const onBoard = state.board.systems.flatMap((s) => [
      ...state.figures.contents.get(Location.system(s))!,
    ])
    expect(onBoard).toHaveLength(40)
  })

  it('places each faction per the board starting positions', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const [city] = board('Board3MixUp').starting[0]!
    const there = state.figures.contents.get(Location.system(city))!
    expect(there.filter((id) => id.startsWith('red/City/'))).toHaveLength(1)
    expect(there.filter((id) => id.startsWith('red/Ship/'))).toHaveLength(3)
  })

  it('leaves unplaced pieces in reserve', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const reserve = state.figures.contents.get(Location.reserve('red'))!
    expect(reserve.filter((id) => id.startsWith('red/City/'))).toHaveLength(4)
    expect(reserve.filter((id) => id.startsWith('red/Ship/'))).toHaveLength(15 - 8)
  })

  it('rejects a faction count the board cannot seat', () => {
    expect(() => createGame({ board: 'Board3MixUp', factions: FOUR, seed: 1 })).toThrow(
      /seats 3 factions, got 4/,
    )
  })

  it('is deterministic — same seed, same final state digest', () => {
    const a = startGame({ board: 'Board4MixUp2', factions: FOUR, seed: 11 })
    const b = startGame({ board: 'Board4MixUp2', factions: FOUR, seed: 11 })
    expect(digest(a.state.figures)).toBe(digest(b.state.figures))
  })
})

describe('tracker', () => {
  it('refuses to move a piece that is not registered', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    expect(() => moveVia(state, 'red/Ship/999', Location.scrap())).toThrow(/not registered/)
  })

  it('refuses to move to an unregistered location', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    expect(() => moveVia(state, 'red/Ship/1', Location.system('9-Gate'))).toThrow(
      /not registered/,
    )
  })

  it('does not mutate the tracker it was given', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 1 })
    const before = digest(state.figures)
    moveVia(state, 'red/Ship/1', Location.scrap())
    expect(digest(state.figures)).toBe(before)
  })

  function moveVia(state: GameState, id: string, to: string) {
    return move(state.figures, id, to)
  }
})

describe('action encoding round-trips', () => {
  const cases: Action[] = [
    { type: 'setup/start' },
    { type: 'setup/seat', seat: 2 },
    { type: 'move', from: '1-Hex', to: '1-Gate', figures: ['red/Ship/1', 'red/Ship/2'] },
    { type: 'declare', ambition: 'Tycoon', value: null },
    { type: 'note', text: 'has, a comma and "quotes"' },
  ]

  for (const action of cases) {
    it(`round-trips ${action.type}`, () => {
      expect(decodeAction(encodeAction(action))).toEqual(action)
    })
  }

  it('is stable regardless of field order', () => {
    expect(encodeAction({ type: 'x', b: 1, a: 2 })).toBe(encodeAction({ type: 'x', a: 2, b: 1 }))
  })
})

describe('observed state is the bot boundary', () => {
  it('redacts the rng so a bot cannot predict dice', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 3 })
    const view = observe(state, 'red')
    expect('rng' in view).toBe(false)
    expect('journal' in view).toBe(false)
  })

  it('carries whose view it is', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 3 })
    expect(observe(state, 'yellow').self).toBe('yellow')
  })
})
