import { describe, expect, it } from 'vitest'

import {
  CardLocation,
  Continue,
  FULL_DECK,
  Location,
  SUIT_ACTIONS,
  advance,
  canTake,
  cardId,
  connected,
  contentsOf,
  system as systemInfo,
  deckFor,
  moveAll,
  defaultRegistry,
  isWaiting,
  parseCardId,
  startGame,
} from '../src/index.js'
import type { Action, GameState, RuleResult } from '../src/index.js'

const THREE = ['red', 'yellow', 'blue'] as const
const FOUR = ['red', 'yellow', 'blue', 'white'] as const

const registry = defaultRegistry()

describe('deck composition', () => {
  it('is 28 cards at four players', () => {
    expect(deckFor(4)).toHaveLength(28)
    expect(FULL_DECK).toHaveLength(28)
  })

  it('drops the 1s and 7s at three players, leaving 20', () => {
    const deck = deckFor(3)
    expect(deck).toHaveLength(20)
    expect(deck.every((c) => c.strength > 1 && c.strength < 7)).toBe(true)
  })

  it('has the pip counts from the physical cards', () => {
    const admin1 = FULL_DECK.find((c) => c.suit === 'Administration' && c.strength === 1)!
    const agg7 = FULL_DECK.find((c) => c.suit === 'Aggression' && c.strength === 7)!
    expect(admin1.pips).toBe(4)
    expect(agg7.pips).toBe(1)
  })

  it('round-trips a card id', () => {
    for (const card of FULL_DECK) {
      expect(parseCardId(cardId(card))).toEqual(card)
    }
  })

  // Surpass requires strictly greater strength (rules/turn.ts). That rule is only safe to
  // express as `>` because no two cards share a suit and strength — a same-suit card of
  // equal strength would *be* the lead card. `parseCardId` depends on the same uniqueness.
  // If the campaign ever introduces a duplicate, this fails before the follow logic does.
  it('has no two cards sharing a suit and strength', () => {
    for (const deck of [deckFor(3), deckFor(4)]) {
      const ids = deck.map((c) => `${c.suit}-${c.strength}`)
      expect(new Set(ids).size).toBe(deck.length)
    }
  })
})

describe('suit to action mapping matches HRF', () => {
  it('Construction buys Build and Repair', () => {
    expect(SUIT_ACTIONS.Construction).toEqual(['Build', 'Repair'])
  })
  it('Aggression buys Battle, Move, Secure', () => {
    expect(SUIT_ACTIONS.Aggression).toEqual(['Battle', 'Move', 'Secure'])
  })
  it('Mobilization buys Move and Influence', () => {
    expect(SUIT_ACTIONS.Mobilization).toEqual(['Move', 'Influence'])
  })
})

describe('dealing', () => {
  it('deals six cards to each faction and reaches a lead decision', () => {
    const { state, continue: c } = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 5 })
    expect(c.kind).toBe('ask')
    if (c.kind !== 'ask') throw new Error('expected ask')

    expect(c.faction).toBe('red')
    for (const f of FOUR) {
      expect(contentsOf(state.cards, CardLocation.hand(f))).toHaveLength(6)
    }
    // Options are the six hand cards plus Pass.
    expect(c.actions).toHaveLength(7)
    expect(c.actions.some((a) => a.type === 'turn/pass')).toBe(true)
  })

  it('leaves the rest of the deck undealt', () => {
    const { state } = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    // 20-card deck, 3 x 6 dealt = 18, so 2 remain.
    expect(contentsOf(state.cards, CardLocation.deck())).toHaveLength(20 - 18)
  })
})

describe('leading and following', () => {
  it('records the lead with its declared suit and pip count', () => {
    let step = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const lead = firstOfType(step.continue, 'turn/lead')
    step = advance(step.state, lead, registry)

    expect(step.state.lead).toBeDefined()
    expect(step.state.lead!.faction).toBe('red')
    const card = parseCardId(step.state.lead!.cardId)
    expect(step.state.lead!.suit).toBe(card.suit)
    expect(step.state.lead!.pips).toBe(card.pips)
  })

  it('moves the led card from hand to the played pile', () => {
    let step = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const lead = firstOfType(step.continue, 'turn/lead')
    const cardIdStr = lead['card'] as string
    step = advance(step.state, lead, registry)

    expect(contentsOf(step.state.cards, CardLocation.hand('red'))).not.toContain(cardIdStr)
    expect(contentsOf(step.state.cards, CardLocation.played('red'))).toContain(cardIdStr)
  })

  it('offers the lead player a pip action from the card suit', () => {
    let step = startGame({ board: 'Board3MixUp', factions: THREE, seed: 5 })
    const lead = firstOfType(step.continue, 'turn/lead')
    const suit = lead['suit'] as keyof typeof SUIT_ACTIONS
    step = advance(step.state, lead, registry)

    // A declarable card offers an ambition step first; decline it.
    if (step.continue.kind === 'ask' && step.continue.actions.some((a) => a.type === 'ambition/skip-declare')) {
      const decline = firstOfType(step.continue, 'ambition/skip-declare')
      step = advance(step.state, decline, registry)
    }
    // Then the Prelude, which sits between the card and its pips; take none of it.
    if (step.continue.kind === 'ask' && step.continue.actions.some((a) => a.type === 'turn/prelude-done')) {
      step = advance(step.state, firstOfType(step.continue, 'turn/prelude-done'), registry)
    }

    expect(step.continue.kind).toBe('ask')
    if (step.continue.kind !== 'ask') throw new Error('expected ask')
    const labels = step.continue.actions.map((a) => a['label'])
    for (const action of SUIT_ACTIONS[suit] ?? []) {
      expect(labels).toContain(action)
    }
  })
})

describe('Move is implemented end to end', () => {
  it('relocates a ship to a connected system', () => {
    // Drive to a Move: lead, then take Move, then pick the first move option.
    let step = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 5 })
    step = playUntil(step, (c) =>
      c.kind === 'ask' && c.actions.some((a) => a['label'] === 'Move'),
      registry,
    )
    if (step.continue.kind !== 'ask') throw new Error('no Move on offer')

    const before = boardShipCount(step.state, 'red')
    const move = step.continue.actions.find((a) => a['label'] === 'Move')!
    step = advance(step.state, move, registry)

    // Move is two steps now: where to, then how many.
    expect(step.continue.kind).toBe('ask')
    if (step.continue.kind !== 'ask') throw new Error('expected move options')
    const pick = step.continue.actions.find((a) => a.type === 'action/move-pick')
    expect(pick).toBeDefined()
    step = advance(step.state, pick!, registry)

    if (step.continue.kind !== 'ask') throw new Error('expected a fleet size')
    const size = step.continue.actions.find((a) => a.type === 'action/move-ships')
    expect(size).toBeDefined()
    step = advance(step.state, size!, registry)

    // Same number of ships on the board, just relocated.
    expect(boardShipCount(step.state, 'red')).toBe(before)
    expect(step.state.log.some((l) => /moved \d+ ship/.test(l))).toBe(true)
  })
})

describe('a full game runs to completion', () => {
  it('terminates in game over when every faction always passes', () => {
    const result = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 7 }, alwaysPass)
    expect(result.continue.kind).toBe('gameOver')
    expect(result.state.isOver).toBe(true)
    // Five chapters were dealt.
    expect(result.state.chapter).toBe(5)
  })

  it('terminates when factions play cards then pass', () => {
    const result = playToEnd({ board: 'Board4MixUp2', factions: FOUR, seed: 13 }, preferFirst)
    expect(result.continue.kind).toBe('gameOver')
    expect(result.state.isOver).toBe(true)
  })

  it('is deterministic under a fixed seed and policy', () => {
    const a = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 99 }, preferFirst)
    const b = playToEnd({ board: 'Board3MixUp', factions: THREE, seed: 99 }, preferFirst)
    expect(a.state.log).toEqual(b.state.log)
  })
})

// --- helpers ---------------------------------------------------------------

function firstOfType(c: Continue, type: string): Action {
  if (c.kind !== 'ask') throw new Error(`expected ask, got ${c.kind}`)
  const found = c.actions.find((a) => a.type === type)
  if (found === undefined) throw new Error(`no ${type} in ${c.actions.map((a) => a.type).join(', ')}`)
  return found
}

function playUntil(
  start: RuleResult,
  done: (c: Continue) => boolean,
  reg = registry,
  limit = 500,
): RuleResult {
  let step = start
  for (let i = 0; i < limit; i++) {
    if (done(step.continue)) return step
    if (step.continue.kind !== 'ask') throw new Error(`stuck at ${step.continue.kind}`)
    // Take the first non-pass, non-end option to make progress.
    const actions = step.continue.actions
    const pick =
      actions.find((a) => a.type !== 'turn/pass' && a.type !== 'turn/end') ?? actions[0]!
    step = advance(step.state, pick, reg)
  }
  throw new Error('playUntil did not reach the target')
}

type Policy = (c: { kind: 'ask'; actions: readonly Action[] }) => Action

const alwaysPass: Policy = (c) =>
  c.actions.find((a) => a.type === 'turn/pass') ??
  c.actions.find((a) => a.type === 'turn/skip-seize') ??
  c.actions.find((a) => a.type === 'turn/end') ??
  c.actions[0]!

const preferFirst: Policy = (c) => {
  // Lead/follow with a card if offered; otherwise skip/pass; never loop on actions.
  const play = c.actions.find(
    (a) => a.type === 'turn/lead' || a.type === 'turn/surpass' || a.type === 'turn/pivot',
  )
  const end = c.actions.find((a) => a.type === 'turn/end')
  const skip = c.actions.find((a) => a.type === 'turn/skip-seize')
  const pass = c.actions.find((a) => a.type === 'turn/pass')
  return play ?? end ?? skip ?? pass ?? c.actions[0]!
}

function playToEnd(options: Parameters<typeof startGame>[0], policy: Policy, limit = 5000): RuleResult {
  let step = startGame(options, registry)
  for (let i = 0; i < limit; i++) {
    const c = step.continue
    if (c.kind === 'gameOver') return step
    if (c.kind === 'multiAsk') throw new Error('multiAsk not expected in phase 1')
    if (!isWaiting(c)) throw new Error(`unexpected ${c.kind}`)
    if (c.kind !== 'ask') throw new Error('expected ask')
    step = advance(step.state, policy(c), registry)
  }
  throw new Error('game did not terminate')
}

function boardShipCount(state: GameState, faction: string): number {
  return state.board.systems.reduce(
    (n, s) =>
      n +
      contentsOf(state.figures, Location.system(s)).filter((id) =>
        id.startsWith(`${faction}/Ship/`),
      ).length,
    0,
  )
}

// --- initiative -------------------------------------------------------------

/**
 * Initiative goes to the highest-strength **face-up** card of the lead suit
 * (`game-common.scala:2162`) — not to the lead player by default, which is what it used to do.
 */
describe('initiative passes to the strongest lead-suit card', () => {
  const base = () =>
    startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 3 }, registry).state

  /** End a round with a chosen set of plays, and report who ends up first in initiative. */
  function endRoundWith(
    lead: { faction: string; cardId: string; zeroed?: boolean },
    plays: { faction: string; cardId: string; kind: 'lead' | 'surpass' | 'copy' | 'pivot' }[],
    seized?: string,
  ) {
    const s = base()
    const suit = parseCardId(lead.cardId).suit
    const state: GameState = {
      ...s,
      lead: {
        faction: lead.faction as never,
        cardId: lead.cardId,
        suit,
        strength: parseCardId(lead.cardId).strength,
        pips: 1,
        zeroed: lead.zeroed ?? false,
      },
      roundPlays: plays as never,
      seized: seized as never,
      // Nobody holds cards, so the round ends into the chapter check.
      cards: FOUR.reduce((t, f) => moveAll(t, [...contentsOf(t, CardLocation.hand(f))], CardLocation.discard()), s.cards),
    }
    return advance(state, { type: 'round/end' }, registry).state.initiativeOrder[0]
  }

  it('the strongest surpass takes it from the leader', () => {
    expect(
      endRoundWith({ faction: 'red', cardId: 'Construction-1' }, [
        { faction: 'red', cardId: 'Construction-1', kind: 'lead' },
        { faction: 'yellow', cardId: 'Construction-4', kind: 'surpass' },
        { faction: 'white', cardId: 'Construction-2', kind: 'surpass' },
      ]),
    ).toBe('yellow')
  })

  it('the leader keeps it when nobody plays a stronger card of the suit', () => {
    expect(
      endRoundWith({ faction: 'red', cardId: 'Construction-6' }, [
        { faction: 'red', cardId: 'Construction-6', kind: 'lead' },
        { faction: 'yellow', cardId: 'Aggression-7', kind: 'pivot' },
      ]),
    ).toBe('red')
  })

  it('a copy never claims it — the card is face down', () => {
    // Construction-7 would win on strength, but a copy is played blind.
    expect(
      endRoundWith({ faction: 'red', cardId: 'Construction-2' }, [
        { faction: 'red', cardId: 'Construction-2', kind: 'lead' },
        { faction: 'blue', cardId: 'Construction-7', kind: 'copy' },
      ]),
    ).toBe('red')
  })

  it('a pivot never claims it — it is displayed as another suit', () => {
    expect(
      endRoundWith({ faction: 'red', cardId: 'Construction-2' }, [
        { faction: 'red', cardId: 'Construction-2', kind: 'lead' },
        { faction: 'blue', cardId: 'Aggression-7', kind: 'pivot' },
      ]),
    ).toBe('red')
  })

  it('declaring an ambition costs the leader the initiative', () => {
    const plays = [
      { faction: 'red' as const, cardId: 'Construction-6', kind: 'lead' as const },
      { faction: 'yellow' as const, cardId: 'Construction-3', kind: 'surpass' as const },
    ]
    // Undeclared, red's 6 beats yellow's 3.
    expect(endRoundWith({ faction: 'red', cardId: 'Construction-6' }, plays)).toBe('red')
    // Declaring zeroes red's card, so yellow takes it with a weaker card.
    expect(
      endRoundWith({ faction: 'red', cardId: 'Construction-6', zeroed: true }, plays),
    ).toBe('yellow')
  })

  it('a seize overrides all of it', () => {
    expect(
      endRoundWith(
        { faction: 'red', cardId: 'Construction-6' },
        [{ faction: 'red', cardId: 'Construction-6', kind: 'lead' }],
        'white',
      ),
    ).toBe('white')
  })
})

describe('initiative carries across chapters', () => {
  it('a new chapter does not reset the order to seating', () => {
    const s = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 3 }, registry).state
    const held: GameState = { ...s, initiativeOrder: ['blue', 'white', 'red', 'yellow'] }
    const next = advance(held, { type: 'chapter/start' }, registry).state
    expect(next.initiativeOrder[0]).toBe('blue')
    expect(next.current).toBe('blue')
  })
})

// --- fleets and the catapult ------------------------------------------------

/**
 * Move used to shift exactly one ship one hop. The real rule moves **any number together**
 * (`game-movement.scala:98`), and adds the **catapult** (`:84`): leaving a system where you
 * have a Starport, into an unruled gate, lets the same fleet keep going.
 */
describe('Move: fleets and the catapult', () => {
  const NOWHERE = { type: 'test/stop' } as const
  const reg = defaultRegistry().register({
    id: 'test-terminal',
    perform: (state: GameState, action: { type: string }) =>
      action.type === 'test/stop'
        ? { state, continue: Continue.ask('red', [{ type: 'test/stop', faction: 'red' }], 'stop') }
        : { state, continue: Continue.unhandled() },
  })

  function board() {
    const s = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 5 }, reg).state
    return { ...s, ruleChain: [...s.ruleChain, 'test-terminal'] }
  }

  /** Put `n` red ships (and optionally a starport) in `system`, clearing everyone else out. */
  function garrison(state: GameState, system: string, ships: number, starport = false): GameState {
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const key = Location.system(system)
    for (const id of contents.get(key) ?? []) {
      const owner = id.slice(0, id.indexOf('/'))
      const reserve = Location.reserve(owner as never)
      contents.set(reserve, [...(contents.get(reserve) ?? []), id])
      at.set(id, reserve)
    }
    contents.set(key, [])
    const take = (piece: string, n: number) => {
      const reserve = Location.reserve('red')
      const picks = (contents.get(reserve) ?? []).filter((id) => id.startsWith(`red/${piece}/`)).slice(0, n)
      contents.set(reserve, (contents.get(reserve) ?? []).filter((id) => !picks.includes(id)))
      contents.set(key, [...(contents.get(key) ?? []), ...picks])
      for (const p of picks) at.set(p, key)
    }
    take('Ship', ships)
    if (starport) take('Starport', 1)
    return { ...state, figures: { ...state.figures, contents, at } }
  }

  const shipsIn = (s: GameState, sys: string) =>
    contentsOf(s.figures, Location.system(sys)).filter((id) => id.startsWith('red/Ship/')).length

  const ask = (c: Continue) => (c.kind === 'ask' ? c.actions : [])

  it('offers every fleet size, not just one ship', () => {
    const planet = '1-Hex'
    const state = garrison(board(), planet, 4)
    const dest = connected(state.board, planet)[0]!
    const c = advance(
      state,
      { type: 'action/move-pick', faction: 'red', from: planet, to: dest, then: NOWHERE },
      reg,
    ).continue
    const sizes = ask(c)
      .filter((a) => a.type === 'action/move-ships')
      .map((a) => a['count'])
    expect(sizes).toEqual([4, 3, 2, 1])
  })

  it('moves the whole fleet together', () => {
    const planet = '1-Hex'
    const state = garrison(board(), planet, 4)
    const dest = connected(state.board, planet)[0]!
    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: dest, count: 3, then: NOWHERE },
      reg,
    )
    expect(shipsIn(step.state, planet)).toBe(1)
    expect(shipsIn(step.state, dest)).toBe(3)
    expect(step.state.log.at(-1)).toMatch(/moved 3 ships/)
  })

  it('a starport launches a catapult into a gate, and offers to continue', () => {
    const planet = '1-Hex'
    const gate = connected(board().board, planet).find((s) => systemInfo(s).isGate)!
    const state = garrison(board(), planet, 3, true)

    // Setup may already have red ships on the gate, so compare deltas, not totals.
    const gateBefore = shipsIn(state, gate)
    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: gate, count: 3, then: NOWHERE },
      reg,
    )
    expect(shipsIn(step.state, gate)).toBe(gateBefore + 3)
    expect(ask(step.continue).some((a) => a.type === 'action/move-more')).toBe(true)
  })

  it('no starport means no catapult', () => {
    const planet = '1-Hex'
    const gate = connected(board().board, planet).find((s) => systemInfo(s).isGate)!
    const state = garrison(board(), planet, 3, false)
    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: gate, count: 3, then: NOWHERE },
      reg,
    )
    expect(ask(step.continue).some((a) => a.type === 'action/move-more')).toBe(false)
  })

  it('a non-gate destination ends the move even from a starport', () => {
    const planet = '1-Hex'
    const nonGate = connected(board().board, planet).find((s) => !systemInfo(s).isGate)
    if (nonGate === undefined) return
    const state = garrison(board(), planet, 3, true)
    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: nonGate, count: 3, then: NOWHERE },
      reg,
    )
    expect(ask(step.continue).some((a) => a.type === 'action/move-more')).toBe(false)
  })

  it('a rival ruling the gate blocks the catapult', () => {
    const planet = '1-Hex'
    const gate = connected(board().board, planet).find((s) => systemInfo(s).isGate)!
    let state = garrison(board(), planet, 3, true)
    // Give yellow a commanding fleet on the gate.
    const contents = new Map(state.figures.contents)
    const at = new Map(state.figures.at)
    const key = Location.system(gate)
    const picks = (contents.get(Location.reserve('yellow')) ?? [])
      .filter((id) => id.startsWith('yellow/Ship/'))
      .slice(0, 5)
    contents.set(
      Location.reserve('yellow'),
      (contents.get(Location.reserve('yellow')) ?? []).filter((id) => !picks.includes(id)),
    )
    contents.set(key, [...(contents.get(key) ?? []), ...picks])
    for (const p of picks) at.set(p, key)
    state = { ...state, figures: { ...state.figures, contents, at } }

    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: gate, count: 3, then: NOWHERE },
      reg,
    )
    expect(ask(step.continue).some((a) => a.type === 'action/move-more')).toBe(false)
  })

  /** Land a 3-ship fleet on a gate via the catapult, ready to continue. */
  function landed() {
    const planet = '1-Hex'
    const gate = connected(board().board, planet).find((s) => systemInfo(s).isGate)!
    const state = garrison(board(), planet, 3, true)
    const step = advance(
      state,
      { type: 'action/move-ships', faction: 'red', from: planet, to: gate, count: 3, then: NOWHERE },
      reg,
    )
    return { step, gate }
  }

  it('the continuation carries the fleet onward', () => {
    const { step, gate } = landed()
    const more = ask(step.continue).find((a) => a.type === 'action/move-more')!
    const onward = more['to'] as string

    // Choosing a destination now asks how many go.
    const sized = advance(step.state, more, reg)
    const all = ask(sized.continue).find(
      (a) => a.type === 'action/move-more-go' && a['count'] === 3,
    )!
    const gateBefore = shipsIn(sized.state, gate)
    const onwardBefore = shipsIn(sized.state, onward)
    const done = advance(sized.state, all, reg)

    // Only the fleet that arrived moves on; ships already at the gate stay put.
    expect(shipsIn(done.state, gate)).toBe(gateBefore - 3)
    expect(shipsIn(done.state, onward)).toBe(onwardBefore + 3)
    expect(done.state.log.at(-1)).toMatch(/continued 3 ships/)
  })

  it('ships can be dropped off along the catapult path', () => {
    const { step, gate } = landed()
    const more = ask(step.continue).find((a) => a.type === 'action/move-more')!
    const onward = more['to'] as string
    const sized = advance(step.state, more, reg)

    // Every split is offered, and each says what stays behind.
    const counts = ask(sized.continue)
      .filter((a) => a.type === 'action/move-more-go')
      .map((a) => a['count'])
    expect(counts).toEqual([3, 2, 1])
    expect(ask(sized.continue).some((a) => /leave 2 behind/.test(String(a['label'] ?? '')))).toBe(
      true,
    )

    const gateBefore = shipsIn(sized.state, gate)
    const onwardBefore = shipsIn(sized.state, onward)
    const one = ask(sized.continue).find(
      (a) => a.type === 'action/move-more-go' && a['count'] === 1,
    )!
    const done = advance(sized.state, one, reg)

    expect(shipsIn(done.state, onward)).toBe(onwardBefore + 1)
    // Two of the three stayed on the gate.
    expect(shipsIn(done.state, gate)).toBe(gateBefore - 1)
    expect(done.state.log.at(-1)).toMatch(/2 stayed behind/)
  })

  it('only the ships that carried on may continue again', () => {
    const { step } = landed()
    // Continue to another *gate*, so the chain is still live and the assertion really runs.
    // Guarding this on "if the chain happens to be live" made the test vacuous.
    const more = ask(step.continue)
      .filter((a) => a.type === 'action/move-more')
      .find((a) => systemInfo(a['to'] as string).isGate)
    expect(more, 'a gate-to-gate leg must exist for this test to mean anything').toBeDefined()

    const sized = advance(step.state, more!, reg)
    const one = ask(sized.continue).find(
      (a) => a.type === 'action/move-more-go' && a['count'] === 1,
    )!
    const done = advance(sized.state, one, reg)

    const next = ask(done.continue).find((a) => a.type === 'action/move-more')
    expect(next, 'the chain should still be live on a gate').toBeDefined()
    // The group is the single ship that moved on, not the original three.
    expect((next!['group'] as string[]).length).toBe(1)
  })
})

describe('a pass does not discard a seize', () => {
  /**
   * HRF's pass hands the initiative on and restarts the lead, but touches neither `seized`
   * nor the played cards (`game-common.scala:1338-1348`). Ours cleared the claim, so a rival
   * seizing and *anyone* passing afterwards lost the seize.
   */
  it('keeps a claim made earlier in the round', () => {
    const s = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 3 }, registry).state
    const held: GameState = { ...s, seized: 'white', current: 'red' }
    const after = advance(held, { type: 'turn/pass', faction: 'red' }, registry).state
    expect(after.seized).toBe('white')
  })

  it('and the claim still wins the initiative at end of round', () => {
    const s = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 3 }, registry).state
    // Yellow played the strongest lead-suit card, but white seized — the seize wins.
    const staged: GameState = {
      ...s,
      seized: 'white',
      lead: {
        faction: 'red',
        cardId: 'Construction-2',
        suit: 'Construction',
        strength: 2,
        pips: 1,
        zeroed: false,
      },
      roundPlays: [
        { faction: 'red', cardId: 'Construction-2', kind: 'lead' },
        { faction: 'yellow', cardId: 'Construction-7', kind: 'surpass' },
      ],
      cards: FOUR.reduce(
        (t, f) => moveAll(t, [...contentsOf(t, CardLocation.hand(f))], CardLocation.discard()),
        s.cards,
      ),
    }
    const after = advance(staged, { type: 'round/end' }, registry).state
    expect(after.initiativeOrder[0]).toBe('white')
  })
})

// --- no-effect guards -------------------------------------------------------

/**
 * A pip spent on an action that can do nothing used to vanish: the offer fell straight
 * through to the next pip. Actions that could not act are now kept off the menu entirely.
 */
describe('actions that could do nothing are not offered', () => {
  const THEN = { type: 'turn/pips', faction: 'red', suit: 'Construction', done: 1, total: 2 }

  function fresh(): GameState {
    return startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 5 }, registry).state
  }

  it('Repair is unavailable with nothing damaged, and available with something', () => {
    const state = fresh()
    expect(state.damaged).toEqual([])
    expect(canTake(state, 'red', 'Repair', THEN)).toBe(false)

    const ship = contentsOf(state.figures, Location.system(state.board.systems[0]!)).find((id) =>
      id.startsWith('red/Ship/'),
    )
    const hurt: GameState = { ...state, damaged: [ship ?? 'red/Ship/1'] }
    expect(canTake(hurt, 'red', 'Repair', THEN)).toBe(true)
  })

  it('Secure is unavailable with no agents on any court card', () => {
    expect(canTake(fresh(), 'red', 'Secure', THEN)).toBe(false)
  })

  it('Tax is unavailable once every city has been taxed this turn', () => {
    const state = fresh()
    expect(canTake(state, 'red', 'Tax', THEN)).toBe(true)
    const cities = state.board.systems.flatMap((s) =>
      contentsOf(state.figures, Location.system(s)).filter((id) => id.startsWith('red/City/')),
    )
    const spent: GameState = { ...state, taxedThisTurn: cities }
    expect(canTake(spent, 'red', 'Tax', THEN)).toBe(false)
  })

  it('Move stays available while ships are on the board', () => {
    expect(canTake(fresh(), 'red', 'Move', THEN)).toBe(true)
  })

  it('the pip menu omits them, so no pip can be burned on a dead end', () => {
    let step = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 5 }, registry)
    step = playUntil(
      step,
      (c) => c.kind === 'ask' && c.actions.some((a) => a.type === 'action/take'),
      registry,
    )
    if (step.continue.kind !== 'ask') throw new Error('no pip menu')
    const offered = step.continue.actions.filter((a) => a.type === 'action/take')
    expect(offered.length).toBeGreaterThan(0)
    for (const a of offered) {
      expect(
        canTake(step.state, a['faction'] as never, a['action'] as never, a['then'] as never),
        String(a['action']),
      ).toBe(true)
    }
  })

  it('ends the turn rather than stalling when the suit can buy nothing', () => {
    // Strip red down to nothing: no ships, no cities, no agents, nothing damaged.
    const base = fresh()
    const contents = new Map(base.figures.contents)
    const at = new Map(base.figures.at)
    for (const s of base.board.systems) {
      const key = Location.system(s)
      const mine = (contents.get(key) ?? []).filter((id) => id.startsWith('red/'))
      if (mine.length === 0) continue
      contents.set(key, (contents.get(key) ?? []).filter((id) => !id.startsWith('red/')))
      const reserve = Location.reserve('red')
      contents.set(reserve, [...(contents.get(reserve) ?? []), ...mine])
      for (const m of mine) at.set(m, reserve)
    }
    const stripped: GameState = { ...base, figures: { ...base.figures, contents, at } }

    // Aggression buys Battle, Move and Secure — none of which red can now do.
    const step = advance(
      stripped,
      { type: 'turn/pips', faction: 'red', suit: 'Aggression', done: 0, total: 3 },
      registry,
    )
    expect(step.state.log.at(-1)).toMatch(/no Aggression action available/)
  })
})

// --- Copy works with any card ----------------------------------------------

/**
 * Copy is "play any card face down and take one action of the lead". Its own suit is
 * irrelevant (`game-common.scala:1474`), so *every* card in hand offers it. The engine used
 * to attach Copy only to same-suit cards, so a follower holding nothing of the lead suit saw
 * Pivot alone — the whole card-play option went missing.
 */
describe('following: Copy is offered on every card', () => {
  /** Drive to the first follow decision and read the plays offered per card. */
  function firstFollow() {
    let step = startGame({ board: 'Board4MixUp1', factions: FOUR, seed: 9 }, registry)
    // Red leads; decline the ambition and end the Prelude so it becomes yellow's follow.
    step = advance(step.state, firstOfType(step.continue, 'turn/lead'), registry)
    if (step.continue.kind === 'ask' && step.continue.actions.some((a) => a.type === 'ambition/skip-declare')) {
      step = advance(step.state, firstOfType(step.continue, 'ambition/skip-declare'), registry)
    }
    if (step.continue.kind === 'ask' && step.continue.actions.some((a) => a.type === 'turn/prelude-done')) {
      step = advance(step.state, firstOfType(step.continue, 'turn/prelude-done'), registry)
    }
    // Spend or forfeit the lead player's pips to reach the follow.
    step = playUntil(
      step,
      (c) => c.kind === 'ask' && c.actions.some((a) => a.type === 'turn/follow-main' || a.type === 'turn/copy'),
      registry,
    )
    if (step.continue.kind !== 'ask') throw new Error('never reached a follow')
    if (step.continue.actions.some((a) => a.type === 'turn/follow-main')) {
      step = advance(step.state, firstOfType(step.continue, 'turn/follow-main'), registry)
    }
    return step
  }

  it('offers a Copy for every card in hand, whatever its suit', () => {
    const step = firstFollow()
    if (step.continue.kind !== 'ask') throw new Error('expected a follow ask')
    const c = step.continue

    const lead = step.state.lead!
    const handSize = contentsOf(step.state.cards, CardLocation.hand(c.faction)).length
    const copies = c.actions.filter((a) => a.type === 'turn/copy')

    // One Copy per card, including off-suit cards that can only otherwise Pivot.
    expect(copies).toHaveLength(handSize)

    const offSuit = c.actions.filter(
      (a) => a.type === 'turn/copy' && parseCardId(a['card'] as string).suit !== lead.suit,
    )
    expect(offSuit.length).toBeGreaterThan(0)
  })

  it('a copy plays regardless of suit and grants one pip in the lead suit', () => {
    const step = firstFollow()
    if (step.continue.kind !== 'ask') throw new Error('expected a follow ask')
    const lead = step.state.lead!
    const copy = step.continue.actions.find(
      (a) => a.type === 'turn/copy' && parseCardId(a['card'] as string).suit !== lead.suit,
    )
    expect(copy).toBeDefined()

    const played = copy!['card'] as string
    const after = advance(step.state, copy!, registry)
    expect(contentsOf(after.state.cards, CardLocation.played(step.continue.faction))).toContain(played)
    expect(after.state.log.some((l) => l.includes(`copied with ${played}`))).toBe(true)
  })
})
