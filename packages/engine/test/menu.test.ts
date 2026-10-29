/**
 * `menuBot`: the probe plays a pip-funded action through to the next pip menu (`Bot.settleActions`).
 *
 * One test for the horizon itself and one for each fault the review found in its scratch build of
 * it, each at a real position. The positions come from games normal plays against itself, so they
 * stay put when this bot changes. The probes are read through a spy that records what the bot was
 * shown at the decision under test, not inside the sub-flows its probes resolve.
 */

import { describe, expect, it } from 'vitest'

import {
  boardsFor,
  botToAct,
  declarerBot,
  defaultRegistry,
  menuBot,
  menuDeclarerBot,
  mobileBot,
  playGameAt,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { Bot, FactionId, Probe, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

/** Drive a three-player game with normal deciding, for `steps` decisions. */
function drive(seed: number, steps: number): { cur: RuleResult; asked: AskedThisTurn } {
  let cur: RuleResult = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed }, registry)
  let asked: AskedThisTurn = NO_ASKS
  for (let i = 0; i < steps; i++) {
    const s = stepBot(cur, mobileBot, botToAct(cur, THREE)!, registry, asked)
    cur = s.result
    asked = s.asked
  }
  return { cur, asked }
}

interface Seen {
  readonly label: string
  readonly probe: Probe
  /** Decisions the probe's own settle made on the way — the sub-asks it resolved. */
  readonly resolved: number
  readonly score: number
  readonly eligible: boolean
}

/** What `bot` saw of each candidate at this position, and what it chose. */
function seenAt(at: { cur: RuleResult; asked: AskedThisTurn }, bot: Bot): { seen: Seen[]; chose: string } {
  const seen: Omit<Seen, 'score' | 'eligible'>[] = []
  let outer = true
  let resolved = 0
  let chose = ''
  const scored = new Map<string, { score: number; eligible: boolean }>()
  const spy: Bot = {
    ...bot,
    decide(observed, actions, lookahead, ...rest) {
      if (!outer) {
        resolved++
        return bot.decide(observed, actions, lookahead, ...rest)
      }
      outer = false
      for (const a of actions) {
        const before = resolved
        const probe = lookahead!(a)
        if (probe !== undefined) {
          seen.push({ label: String(a['label'] ?? a.type), probe, resolved: resolved - before })
        }
      }
      const d = bot.decide(observed, actions, lookahead, ...rest)
      for (const c of d.considered ?? []) {
        scored.set(String(c.action['label'] ?? c.action.type), {
          score: c.score,
          eligible: c.eligible !== false,
        })
      }
      chose = String(d.action['label'] ?? d.action.type)
      return d
    },
  }
  stepBot(at.cur, spy, botToAct(at.cur, THREE)!, registry, at.asked)
  return { seen: seen.map((s) => ({ ...s, ...scored.get(s.label)! })), chose }
}

const one = (s: { seen: Seen[] }, label: string): Seen => {
  const hit = s.seen.find((x) => x.label === label)
  expect(hit, `${label} was a candidate`).toBeDefined()
  return hit!
}

describe('menuBot', () => {
  // Seed 1 step 41: yellow's second of three Aggression pips, with Battle and Move on the menu.
  const pipMenu = drive(1, 41)

  it('scores each pip-funded action on the board it leaves', () => {
    /*
     * Normal stops each probe at the action's own first sub-ask, before the board moves, so Battle
     * and Move score the same and the first offer wins. Played through to the next pip menu, they
     * part — and each is left with the one pip that really remains, where normal counted two.
     */
    const normal = seenAt(pipMenu, mobileBot)
    expect(one(normal, 'Battle').score).toBe(one(normal, 'Move').score)
    expect(one(normal, 'Battle').probe.actionsAhead).toBe(2)

    const menu = seenAt(pipMenu, menuBot)
    expect(one(menu, 'Battle').score).not.toBe(one(menu, 'Move').score)
    expect(one(menu, 'Battle').probe.actionsAhead).toBe(1)
    expect(one(menu, 'Move').probe.actionsAhead).toBe(1)
  })

  it('judges a pip-menu Battle on several rolls, not one', () => {
    /*
     * The dice are rolled several asks into Battle's sub-flow, so the candidate action itself never
     * moves the generator and normal's sampling never fires. Reading the whole settled line, the
     * Battle is judged on every sample; the Move beside it rolls nothing and stays at one.
     */
    expect(one(seenAt(pipMenu, mobileBot), 'Battle').probe.samples).toHaveLength(1)
    const menu = seenAt(pipMenu, menuBot)
    expect(one(menu, 'Battle').probe.samples.length).toBeGreaterThan(1)
    expect(one(menu, 'Move').probe.samples).toHaveLength(1)
  })

  it('prices an Arrange in the Prelude with its pips, and rules it out when it changes nothing', () => {
    /*
     * Seed 1 step 2, red's first Prelude. Normal scores Arrange with no pips ahead — its probe stops
     * on the arrange board, short of the pips — so it sits exactly 4 x 0.5 below Begin. Counted
     * honestly the two tie, and a tie would hand the turn to Arrange on offer order. What keeps the
     * bot out of that detour is the repeat: the Arrange line comes back to this Prelude having
     * changed nothing, so the gate rules it out.
     */
    const prelude = drive(1, 2)
    const normal = seenAt(prelude, mobileBot)
    expect(one(normal, 'Arrange your resource slots').probe.actionsAhead).toBe(0)

    const menu = seenAt(prelude, menuBot)
    const arrange = one(menu, 'Arrange your resource slots')
    const begin = one(menu, 'Begin actions (4 pips)')
    expect(arrange.probe.actionsAhead).toBe(begin.probe.actionsAhead)
    expect(arrange.probe.repeats).toBe(true)
    expect(arrange.eligible).toBe(false)
    expect(menu.chose).not.toBe('Arrange your resource slots')
  })

  it('scores a swap on the arrange board without deciding the board again inside the probe', () => {
    /*
     * Seed 1 step 489, blue on the arrange board. Each swap's line comes straight back to the board
     * being decided and stops there, so its probe resolves nothing. Re-deciding the board inside
     * every candidate's probe is what made the review's build cost the square of the options — a
     * median 3.1 s per four-player arrange decision.
     */
    const menu = seenAt(drive(1, 489), menuBot)
    const swaps = menu.seen.filter((s) => s.label.startsWith('Swap'))
    expect(swaps.length).toBeGreaterThan(0)
    for (const s of swaps) {
      expect(s.resolved, s.label).toBe(0)
      expect(s.probe.repeats, s.label).toBe(true)
    }
  })

  it('pays no phantom pip to keep a catapult going, and rules out a leg back to the start', () => {
    /*
     * Seed 2 step 72, yellow's catapult at 1-Gate. Normal counts the pip being spent as still ahead
     * at every "Continue", which "Stop here" does not, so continuing always won by exactly 0.5 —
     * the pull that kept a four-player game's fleet bouncing between two gates (docs/19 section
     * 23). Here every option counts the same pips, and the continuation whose line comes back to
     * 1-Gate is a repeat that gained nothing.
     */
    const catapult = drive(2, 72)
    const normal = seenAt(catapult, mobileBot)
    expect(one(normal, 'Continue to 1-Arrow').score - one(normal, 'Stop here').score).toBeCloseTo(0.5)

    const menu = seenAt(catapult, menuBot)
    const ahead = new Set(menu.seen.map((s) => s.probe.actionsAhead))
    expect([...ahead]).toEqual([one(menu, 'Stop here').probe.actionsAhead])
    const back = one(menu, 'Continue to 4-Gate — and further')
    expect(back.probe.repeats).toBe(true)
    expect(back.eligible).toBe(false)
  })

  it('finishes the game where Begin ends it', () => {
    /*
     * Two-player Board2Frontiers seed 1, this bot as yellow. In chapter 4 yellow's Begin ends the
     * game on power. A build that played an Arrange's line on through `Done` and Begin saw it end
     * the game too, so Arrange tied Begin, won on offer order, and the bot arranged, pressed Done
     * and arranged again for as long as anyone let it: 4 games in 12 never finished.
     */
    const o = playGameAt(
      [mobileBot, menuBot],
      0,
      { seed: 1, board: 'Board2Frontiers', factions: ['red', 'yellow'] },
      registry,
    )
    expect(o.finished, o.reason).toBe(true)
  })

  it('stops a probe at the end of the turn when the same seat is asked next', () => {
    /*
     * Game 291 of the two-player gate (Board2Homelands seed 146), this bot as red. In round 5 red
     * follows with a Construction card it has no legal action for, so Begin ends the turn and red
     * leads the next round. A probe that played on reached red's next Prelude — the same prompt as
     * the one being decided — and read Begin as a line back to its own question, which ruled it
     * out with every other option; the fallback took Arrange, and Arrange then Done ran until the
     * stuck cap. Nine of 2,399 gate games ended that way.
     */
    const o = playGameAt(
      [menuDeclarerBot, declarerBot],
      290,
      {
        seed: 1,
        boards: boardsFor(2).map((b) => b.name),
        factions: ['red', 'yellow'],
        stuckAfter: 2_000,
      },
      registry,
    )
    expect(o.finished, o.reason).toBe(true)
  })

  it('combines with the declarer without either flag displacing the other', () => {
    // The declarer changes only leads and this only what follows them, so at a pip menu the two
    // see the same thing.
    const menu = seenAt(pipMenu, menuBot)
    const both = seenAt(pipMenu, menuDeclarerBot)
    expect(both.seen.map((s) => s.score)).toEqual(menu.seen.map((s) => s.score))
    expect(both.chose).toBe(menu.chose)
  })
})
