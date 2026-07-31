/**
 * Bot seats, proven end to end before any evaluation exists.
 *
 * The point of the trivial bot is that this test can be written now: it exercises `options.bots`,
 * the turn loop and the journal contract while the decision-making is still "take the first thing
 * offered". Anything that breaks here is plumbing, not play.
 *
 * The claim that matters most is the last one — **a bot's game is an ordinary save**. The journal
 * records actions, not who chose them (docs/03 section 9a), so if that ever stops being true then
 * loading, undo, the interaction saves and multiplayer all break at once.
 */

import { describe, expect, it } from 'vitest'

import {
  botToAct,
  defaultRegistry,
  isBotSeat,
  loadGame,
  runBots,
  serializeGame,
  startGame,
  stepBot,
  stepBots,
  trivialBot,
} from '../src/index.js'
import type { NewGameOptions, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const FOUR = ['red', 'yellow', 'blue', 'white'] as const

type Seat = (typeof FOUR)[number]

const opts = (bots: readonly Seat[], seed = 1): NewGameOptions =>
  bots.length === 0
    ? { board: 'Board4MixUp1', factions: [...FOUR], seed }
    : { board: 'Board4MixUp1', factions: [...FOUR], seed, bots }

describe('bot seats', () => {
  it('knows which seats are bots, and treats an absent list as all-human', () => {
    expect(isBotSeat(['yellow', 'blue'], 'yellow')).toBe(true)
    expect(isBotSeat(['yellow', 'blue'], 'red')).toBe(false)
    expect(isBotSeat(undefined, 'red')).toBe(false)
    expect(isBotSeat([], 'red')).toBe(false)
  })

  it('yields to a human seat rather than acting for it', () => {
    const r = startGame(opts(['yellow']), registry)
    // Setup asks red first, and red is human — so no bot should claim the turn.
    if (r.continue.kind === 'ask' && r.continue.faction === 'red') {
      expect(botToAct(r, ['yellow'])).toBeUndefined()
    }
    expect(botToAct(r, [...FOUR])).toBe(r.continue.kind === 'ask' ? r.continue.faction : undefined)
  })

  it('runs bots until a human is asked, and no further', () => {
    // Only red is human: the others should play on without it.
    const r = startGame(opts(['yellow', 'blue', 'white']), registry)
    const out = runBots(r, ['yellow', 'blue', 'white'], trivialBot, registry)
    expect(out.result.continue.kind === 'ask' ? out.result.continue.faction : 'red').toBe('red')
  })

  it('plays an all-bot game a long way without stalling', () => {
    const bots = [...FOUR]
    let r: RuleResult = startGame(opts(bots), registry)
    // Not to completion — a trivial bot passes at every chance and games can drag — but far enough
    // to cross chapters, battles and preludes.
    const out = runBots(r, bots, trivialBot, registry)
    r = out.result
    expect(out.decisions.length).toBeGreaterThan(200)
    // It stopped because the game ended, not because it ran out of bots to ask.
    expect(botToAct(r, bots)).toBeUndefined()
  })

  it('carries a reason on every decision', () => {
    const bots = [...FOUR]
    const out = stepBots(startGame(opts(bots), registry), bots, trivialBot, 300, registry)
    expect(out.decisions.length).toBeGreaterThan(0)
    for (const d of out.decisions) expect(d.because).toBe('first legal action')
  })

  it('is deterministic — the same position gives the same decision', () => {
    const bots = [...FOUR]
    const a = stepBots(startGame(opts(bots), registry), bots, trivialBot, 200, registry)
    const b = stepBots(startGame(opts(bots), registry), bots, trivialBot, 200, registry)
    expect(a.result.state.journal).toEqual(b.result.state.journal)
  })

  it("a bot's game is an ordinary save — it round-trips through load", () => {
    const bots = [...FOUR]
    const options = opts(bots)
    const played = stepBots(startGame(options, registry), bots, trivialBot, 300, registry).result
    expect(played.state.journal.length).toBeGreaterThan(50)

    const { result: reloaded } = loadGame(serializeGame(options, played), registry)
    expect(reloaded.state.journal).toEqual(played.state.journal)
    expect(reloaded.state.power).toEqual(played.state.power)
  })

  it('records the bot seats in the save, so a reload knows to keep playing them', () => {
    const options = opts(['yellow', 'blue'])
    const r = startGame(options, registry)
    const saved = JSON.parse(serializeGame(options, r)) as { options: NewGameOptions }
    expect(saved.options.bots).toEqual(['yellow', 'blue'])
  })

  it('stepBot advances exactly one action', () => {
    const bots = [...FOUR]
    const r = startGame(opts(bots), registry)
    const faction = botToAct(r, bots)
    expect(faction).toBeDefined()
    const step = stepBot(r, trivialBot, faction!, registry)
    expect(step.result.state.journal.length).toBe(r.state.journal.length + 1)
    expect(step.decision.action).toBeDefined()
  })
})
