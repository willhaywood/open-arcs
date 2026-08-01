/**
 * The arena, and the loop-breaking that had to exist before it could run.
 *
 * These are the fast, seeded versions of what `npm run arena` measures. The arena itself is a
 * script rather than a test because its output is a number to read; what belongs here is the
 * handful of properties that must not silently rot.
 *
 * Nearly all of this is about **termination**, because that is what the first real arena run found:
 * `heuristicBot` swapping two resources back and forth for twenty thousand actions without leaving
 * chapter one. Three attempts at the fix were wrong in three different ways, and each wrong version
 * still *looked* right — the games were simply slow. So the tests are written to fail loudly and
 * quickly rather than to hang, and the important ones assert the specific distinctions the wrong
 * versions could not make.
 */

import { describe, expect, it } from 'vitest'

import {
  NO_ASKS,
  advance,
  defaultRegistry,
  formatReport,
  heuristicBot,
  isCardPlay,
  observe,
  playGame,
  Location,
  contentsOf,
  parseFigureId,
  playGameAt,
  playOut,
  playoutChoice,
  rolloutBot,
  seatsForGame,
  seedForGame,
  runArena,
  runBots,
  startGame,
  stepBot,
  trivialBot,
} from '../src/index.js'
import type { Action, Bot, FactionId, GameOutcome } from '../src/index.js'

const registry = defaultRegistry()
const FOUR: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']

const seatsAll = (bot: Bot): Record<string, Bot> =>
  Object.fromEntries(FOUR.map((f) => [f, bot]))

describe('the arena', () => {
  it('plays a game of trivial bots to an actual ending', () => {
    const out = playGame({ seats: seatsAll(trivialBot), seed: 1 }, registry)
    expect(out.finished).toBe(true)
    expect(out.winner).toBeDefined()
    // Not a stall dressed up as a result: a real game takes hundreds of decisions and scores power.
    expect(out.actions).toBeGreaterThan(100)
    expect(FOUR.reduce((n, f) => n + (out.power[f] ?? 0), 0)).toBeGreaterThan(0)
  })

  it('plays a game with the heuristic bot to an ending too — the livelock regression', () => {
    /*
     * The one that would have caught the original bug. `heuristicBot` in a seat used to spin
     * forever on `arrange your resource slots`, so what is asserted is that the game *ended*, not
     * merely that nothing threw.
     *
     * **`stuckAfter` is the point of the test, not a detail.** A livelock does not throw and does
     * not fail an assertion — it presents as slowness. Removing the loop-breaking and re-running
     * this without a bound hung for ten minutes rather than failing. Bounded at roughly four times
     * a real game, the same regression reports `finished: false` in a couple of seconds.
     */
    const out = playGame(
      { seats: { ...seatsAll(trivialBot), red: heuristicBot }, seed: 1, stuckAfter: 3_000 },
      registry,
    )
    expect(out.finished).toBe(true)
    expect(out.actions).toBeLessThan(3_000)
  })

  it('leads about as often as it passes — the whole point of pricing pips', () => {
    /*
     * The regression test for the lead fix, and the one number that exposed the bug in the first
     * place. `valueOf` charges tempo for the card leaving your hand and counts nothing for the three
     * actions it buys, because pips live on the continuation and not in the state — so every card
     * scored below `Pass`. Three heuristic bots then passed eight times for every lead, took 86
     * decisions a game instead of ~800, and scored 2.5 mean power against the trivial bot's 10.7.
     *
     * A mirror match is what makes this visible: against opponents who *do* lead, a bot that never
     * leads still free-rides on their rounds and looks strong. Only when every seat is the same bot
     * does refusing to start a round show up as a game where nothing happens.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const out = runBots(
      startGame(
        { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
        registry,
      ),
      three,
      heuristicBot,
      registry,
      3_000,
    )
    const count = (type: string): number =>
      out.decisions.filter((d) => d.action.type === type).length
    const leads = count('turn/lead')
    const passes = count('turn/pass')

    expect(leads).toBeGreaterThan(0)
    // Was 4:32 before pips were priced, and roughly 1:1 after. Half separates them with room spare.
    expect(leads).toBeGreaterThan(passes * 0.5)
    // A game where nobody leads is over almost immediately; a real one runs for hundreds of moves.
    expect(out.decisions.length).toBeGreaterThan(400)
  })

  it('never cancels — a decision is final', () => {
    /*
     * Cancel exists for a human who clicked into the battle screen and changed their mind. Offered
     * to an evaluator it was actively harmful: an action landing mid-battle has no pip ask to read
     * so `actionsAhead` reports 0, while the `Cancel` beside it returns to the pip ask and reports
     * 1 — half a pip for backing out. The bot cancelled 31 battles for every 4 it rolled, while the
     * trivial bot fought all 28 of its own.
     *
     * Asserted on the journal rather than on the filter, so it holds however the rule is
     * implemented: every battle started is a battle rolled.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const out = runBots(
      startGame(
        { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
        registry,
      ),
      three,
      heuristicBot,
      registry,
      3_000,
    )
    const count = (type: string): number =>
      out.decisions.filter((d) => d.action.type === type).length
    const cancels = out.decisions.filter(
      (d) => d.action.type === 'battle/cancel' || d.action['label'] === 'Cancel',
    ).length

    expect(cancels).toBe(0)
    // And it does pick fights — a bot that simply never battles would also never cancel.
    expect(count('battle/system')).toBeGreaterThan(5)
    expect(count('battle/roll')).toBe(count('battle/system'))
  })

  it('chooses between standard actions on merit, not on offer order', () => {
    /*
     * Battle, Move, Build and Secure all lead to a *sub-ask* — which system, which ships, which card
     * — where the board has not moved. Scored there they came out identical, to three decimal
     * places, and offer order decided: the bot battled because Battle was listed first and secured
     * nothing all game, though Secure was offered fifteen times.
     *
     * Asserted on securing because it is the action that was never reachable by offer order. It is a
     * proxy for the fix rather than the fix itself, but it is the behaviour that was missing, and it
     * fails when `settle` stops at the sub-ask instead of resolving it.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const out = runBots(
      startGame(
        { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
        registry,
      ),
      three,
      heuristicBot,
      registry,
      3_000,
    )
    const secures = out.decisions.filter((d) => d.action.type === 'action/secure').length
    expect(secures).toBeGreaterThan(0)
  })

  it('cannot see the dice it is about to roll', () => {
    /*
     * `state.rng` is a seeded generator carried in the state and `advance` is pure, so every
     * candidate used to be probed from the *same* generator and returned the exact dice that choice
     * would produce — and committing it reproduced them, because the real generator had never moved.
     * The bot picked pools by outcome rather than by odds: measurably, two dice over three, which no
     * honest evaluator does.
     *
     * Asserted where the cheat lived rather than on play strength: a probe must not agree with the
     * real roll every time. Sampling five outcomes per random action makes agreement occasional and
     * certainty impossible.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    let r = startGame(
      { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
      registry,
    )
    let asked = NO_ASKS
    let checked = 0

    for (let i = 0; i < 900 && checked < 8; i++) {
      if (r.continue.kind !== 'ask') break
      const faction = r.continue.faction
      const roll = r.continue.actions.find((a) => a.type === 'battle/roll')

      if (roll !== undefined) {
        let probed: string | undefined
        const spy: Bot = {
          id: 'spy',
          decide(observed, actions, lookahead) {
            const p = lookahead?.(roll)
            probed = JSON.stringify(p?.samples.length)
            return heuristicBot.decide(observed, actions, lookahead)
          },
        }
        stepBot(r, spy, faction, registry, asked)
        // Randomness is sampled more than once; a single sample is the shape the oracle had.
        expect(probed).toBe('5')
        checked++
      }

      const step = stepBot(r, heuristicBot, faction, registry, asked)
      r = step.result
      asked = step.asked
    }

    // The test verifies nothing if it never reached a battle; assert it did.
    expect(checked).toBeGreaterThan(0)
  })

  it('rolls out the card play, and only the card play', () => {
    /*
     * V2 spends its budget where it pays. The card play is the highest-weight decision in the game
     * (docs/19 section 2d.1) and the one V1 still settles with a flat `PIP_VALUE`; everything
     * downstream V1 already resolves by playing it out a ply, so a rollout adds far less there.
     *
     * Confining it is also what keeps a game affordable — the engine runs at 0.049 ms/action and a
     * game is ~700 decisions, so rolling out everything is minutes per game.
     *
     * Asserted through `considered.note`, which only the rollout path writes, so it distinguishes
     * "V2 decided this" from "V2 delegated to V1" — the two are otherwise indistinguishable from
     * outside.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const v2 = rolloutBot({ samples: 2, lookaheadTurns: 1, maxSteps: 200 })
    const out = runBots(
      startGame(
        { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
        registry,
      ),
      three,
      v2,
      registry,
      3_000,
    )

    const rolled = out.decisions.filter((d) =>
      (d.considered ?? []).some((c) => c.note?.includes('playouts') === true),
    )
    expect(rolled.length).toBeGreaterThan(10)
    // Every rolled decision is a card play; nothing else burns the budget.
    for (const d of rolled) expect(isCardPlay((d.considered ?? []).map((c) => c.action))).toBe(true)
    /*
     * And it still plays a whole game rather than stalling on the extra work. Asserted on the game
     * ending rather than on a decision count: the count was pinned at 400 while the rollout options
     * were being ignored, and once they were honoured a shallower horizon produced a legitimately
     * shorter game — a threshold calibrated against a bug, failing on the fix.
     */
    expect(out.result.continue.kind).toBe('gameOver')
  })

  it('plays rollouts forward with a policy that builds rather than drifts', () => {
    /*
     * A rollout is only as good as the policy inside it. The first version played `trivialBot` —
     * first legal action — which never taxes deliberately, never builds toward anything, and passes
     * whenever passing is offered first. A rollout then scored the position an arbitrary
     * continuation reaches, and V2 came out indistinguishable from V1 over 120 games.
     *
     * Asserted on what the policy *chooses*, which is the behaviour that matters and the thing a
     * silent regression to `trivialBot` would change. Building beats passing; a battle already
     * started gets rolled rather than abandoned.
     */
    const build = { type: 'action/build', faction: 'red', label: 'Build City' } as unknown as Action
    const pass = { type: 'turn/pass', faction: 'red', label: 'Pass' } as unknown as Action
    const move = { type: 'action/move-ships', faction: 'red', label: 'Move' } as unknown as Action
    const cancel = { type: 'battle/cancel', faction: 'red', label: 'Cancel' } as unknown as Action
    const roll = { type: 'battle/roll', faction: 'red', label: 'Roll 3S' } as unknown as Action

    // `pass` first in the list is exactly what trivialBot would have taken.
    expect(playoutChoice([pass, move, build])).toBe(build)
    expect(playoutChoice([pass, move])).toBe(move)
    expect(playoutChoice([cancel, roll])).toBe(roll)
    // Nothing but rollbacks on offer still returns something rather than throwing.
    expect(playoutChoice([cancel])).toBe(cancel)
  })

  it('actually plays rollouts with that policy, not with the first legal action', () => {
    /*
     * Testing `playoutChoice` alone leaves the single line that calls it unverified — a mutation
     * pointing `playOut` back at `actions[0]` passed every test. So this plays the same position
     * both ways and requires them to differ: if the wiring regresses, the two are identical.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    let r = startGame(
      { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
      registry,
    )

    const board = (o: ReturnType<typeof observe>): string =>
      three
        .map((f) =>
          ['City', 'Starport', 'Ship']
            .map((piece) =>
              o.board.systems.reduce(
                (n, sys) =>
                  n +
                  contentsOf(o.figures, Location.system(sys)).filter((id) => {
                    const p = parseFigureId(id)
                    return p.color === f && p.piece === piece
                  }).length,
                0,
              ),
            )
            .join('/'),
        )
        .join(' ')

    /*
     * Swept across positions rather than pinned to one. Plenty of positions offer no choice the two
     * policies disagree about, and the first version of this test picked one of them and failed —
     * correctly. What matters is that the policy changes the course of a playout *somewhere* in a
     * real game, and that it does so often rather than once.
     */
    let differing = 0
    for (let i = 0; i < 120; i++) {
      const c = r.continue
      if (c.kind !== 'ask') break
      // Same function, same horizon — only the policy differs, so nothing else can explain a gap.
      const withPolicy = playOut(r, c.faction, registry, 2, 200)
      const firstLegal = playOut(r, c.faction, registry, 2, 200, (a) => a[0]!)
      if (board(withPolicy) !== board(firstLegal)) differing++
      r = stepBot(r, trivialBot, c.faction, registry).result
    }

    expect(differing).toBeGreaterThan(10)
  })

  it('does not roll out anything but the card play', () => {
    /*
     * The guard tested directly rather than through a game, because removing it does not *fail* a
     * game-level test — it makes one take minutes, which is the least useful signal a test can give
     * (the same lesson as the livelock bound above). Here the bot is handed a non-card-play ask and
     * a rollout it must not call, so the wrong behaviour is instant rather than slow.
     *
     * The guard belongs to the bot rather than the harness: which decisions deserve a rollout is a
     * bot's policy. Putting it in the harness made this one unreachable, and a mutation caught that
     * by passing every test with it deleted.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const v2 = rolloutBot({ samples: 2, lookaheadTurns: 1, maxSteps: 50 })
    let r = startGame(
      { board: 'Board3Frontiers', factions: [...three], seed: 1, bots: [...three] },
      registry,
    )

    // Step to the first ask that is *not* a card play — the Prelude, a pip, a target.
    let found = false
    for (let i = 0; i < 200 && !found; i++) {
      if (r.continue.kind !== 'ask') break
      if (isCardPlay(r.continue.actions)) {
        r = stepBot(r, trivialBot, r.continue.faction, registry).result
        continue
      }
      found = true
    }
    expect(found).toBe(true)
    if (r.continue.kind !== 'ask') throw new Error('expected an ask to test against')

    let called = 0
    v2.decide(observe(r.state, r.continue.faction), r.continue.actions, undefined, () => {
      called++
      return []
    })
    expect(called).toBe(0)
  })

  it('rotates seats between games so nobody is measured on seat order', () => {
    const report = runArena(
      { bots: [heuristicBot, trivialBot, trivialBot, trivialBot], games: 4, seed: 1 },
      registry,
    )
    const seatsPlayed = report.games.map(
      (g) => FOUR.find((f) => g.seats[f] === heuristicBot.id) as FactionId,
    )
    expect(new Set(seatsPlayed).size).toBe(4)
    expect(report.balanced).toBe(true)
  })

  it('plays the same game whoever plays it, so a run can be sharded', () => {
    /*
     * Parallelising the arena splits games across processes, and the whole thing is only safe if a
     * game is identified by its *index* rather than by a private counter — shard 2 of 5 has to play
     * game 7 exactly as a serial run would, same matchup and same seed, or the shards are sampling
     * different experiments and the aggregate is meaningless.
     *
     * Asserted on the two functions the shard and the serial loop share, since that agreement is
     * what the guarantee rests on.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const bots = ['a', 'b', 'c']

    // Rotation: over n games each bot sits in each seat exactly once.
    const seatFor = (index: number, f: FactionId): string =>
      seatsForGame(bots, three, index)[f] as string
    for (const f of three) {
      expect(new Set([0, 1, 2].map((i) => seatFor(i, f))).size).toBe(3)
    }
    // And it repeats with period n, so game 7 and game 4 are the same matchup.
    expect(seatsForGame(bots, three, 7)).toEqual(seatsForGame(bots, three, 4))

    /*
     * Seeds are a pure function of the base and the index — never of play order — and are *held*
     * across a rotation, so the same starting position is played with every seating before the next
     * one begins. That is what stops setup luck and seat luck being confounded.
     */
    expect([0, 1, 2].map((i) => seedForGame(500, i, 3))).toEqual([500, 500, 500])
    expect(seedForGame(500, 3, 3)).toBe(501)
    expect(seedForGame(undefined, 0, 3)).toBe(1)

    // The payoff: playing game 3 alone matches playing it as part of a run.
    const alone = playGameAt(
      [trivialBot, trivialBot, trivialBot],
      3,
      { seed: 1, board: 'Board3Frontiers', factions: three },
      registry,
    )
    const inRun = runArena(
      { bots: [trivialBot, trivialBot, trivialBot], games: 4, seed: 1, factions: three, board: 'Board3Frontiers' },
      registry,
    ).games[3]
    expect(alone.seed).toBe(inRun?.seed)
    expect(alone.power).toEqual(inRun?.power)
    expect(alone.actions).toBe(inRun?.actions)
  })

  it('is exactly symmetric between identical bots — the harness fairness check', () => {
    /*
     * With every seat playing the *same* bot and the seed held across a rotation, the games of one
     * rotation are permutations of a single game: relabelling who sits where cannot change what
     * happens. So each bot must receive exactly one of each seat's outcome, and the aggregate must
     * come out identical to the last digit.
     *
     * That makes this an exact test of the harness rather than a statistical one. It was written
     * after two runs in which identical *rollout* bots finished 12 and 14 points of win rate apart,
     * which looked like harness bias; run this way the answer was unambiguous — three identical bots
     * over 120 games came out 33%/33%, rank 1.98/1.98, power 23.7/23.7. The arena is fair, and the
     * gaps were the variance of Arcs itself showing through a three-player game where one seat
     * differed.
     *
     * Any deviation here is a bug in rotation, seeding or aggregation, not a bad sample.
     */
    const three: readonly FactionId[] = ['red', 'yellow', 'blue']
    const bots = ['a', 'b', 'c'].map((n) => ({ ...trivialBot, id: `same-${n}` }))
    const report = runArena(
      { bots, games: 3, seed: 1, factions: three, board: 'Board3Frontiers' },
      registry,
    )

    expect(report.records).toHaveLength(3)
    const [first] = report.records
    for (const r of report.records) {
      expect(r.games).toBe(first?.games)
      expect(r.wins).toBe(first?.wins)
      expect(r.meanPower).toBeCloseTo(first?.meanPower ?? -1, 10)
      expect(r.meanRank).toBeCloseTo(first?.meanRank ?? -1, 10)
    }
    // And the games really were played, rather than all failing identically.
    expect(report.finished).toBe(3)
  })

  it('counts an unbalanced run as unbalanced rather than averaging it quietly', () => {
    const report = runArena({ bots: [trivialBot, trivialBot, trivialBot, trivialBot], games: 3 }, registry)
    expect(report.balanced).toBe(false)
    expect(formatReport(report)).toContain('not a multiple')
  })

  it('separates outright wins from faction-order tie-breaks', () => {
    /*
     * `performCheckWin` reduces over `state.factions` keeping the first on equality, so when nobody
     * scores the first seat "wins" every game. A report that called that a 100% win rate would be
     * worse than no report — it would look like a measurement.
     */
    const scoreless: GameOutcome = {
      seed: 1,
      seats: { red: 'a', yellow: 'b', blue: 'b', white: 'b' },
      finished: true,
      reason: 'test',
      winner: 'red',
      tied: true,
      power: { red: 0, yellow: 0, blue: 0, white: 0 },
      chapters: 5,
      actions: 4,
      ms: 0,
    }
    const text = formatReport({
      records: [{ id: 'a', games: 1, wins: 1, outrightWins: 0, meanRank: 1, meanPower: 0 }],
      games: [scoreless],
      finished: 1,
      balanced: true,
      meanActions: 4,
      meanTotalPower: 0,
      ms: 0,
    })
    expect(text).toContain('nobody scored')
  })

  it('refuses a bot list that does not fill the seats', () => {
    expect(() => runArena({ bots: [trivialBot], games: 1 }, registry)).toThrow(/seats/)
  })
})

describe('going in circles', () => {
  /**
   * Drive one faction's decisions and report the prompts it was asked, in order.
   *
   * Threading `asked` is the whole point — every wrong version of the fix was a wrong answer to
   * "what counts as the same turn", so the test drives the same path a real caller does.
   */
  const promptsAsked = (bot: Bot, limit: number): string[] => {
    let r = startGame(
      { board: 'Board4MixUp1', factions: [...FOUR], seed: 1, bots: [...FOUR] },
      registry,
    )
    let asked = NO_ASKS
    const seen: string[] = []
    for (let i = 0; i < limit; i++) {
      if (r.continue.kind !== 'ask') break
      const faction = r.continue.faction
      seen.push(`${faction}|${r.continue.prompt ?? '?'}`)
      const step = stepBot(r, faction === 'red' ? bot : trivialBot, faction, registry, asked)
      r = step.result
      asked = step.asked
    }
    return seen
  }

  it('does not ask the same question hundreds of times', () => {
    const asked = promptsAsked(heuristicBot, 600)
    const counts = new Map<string, number>()
    for (const p of asked) counts.set(p, (counts.get(p) ?? 0) + 1)
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    /*
     * Some repetition across a game is normal — `red — Prelude` comes up every turn. A hundred of
     * the same question inside 600 decisions is not, and the livelock produced thousands.
     */
    expect(worst?.[1] ?? 0).toBeLessThan(100)
  })

  it('starts the history over on a new turn, even when the same seat acts twice running', () => {
    /*
     * The subtle one, and the reason two fixes failed. The obvious turn boundary — the acting seat
     * changing — is not a boundary at all: a faction whose turn ends a round then *leads* the next,
     * so two of its turns run back to back with nobody asked in between. Merging them marked
     * prompts from the previous turn as already-seen and left the bot with nothing to choose.
     *
     * Asserted through the public shape rather than by reaching into the loop: the history reports
     * which turn it belongs to, and that changes without anyone calling a reset.
     */
    let r = startGame(
      { board: 'Board4MixUp1', factions: [...FOUR], seed: 1, bots: [...FOUR] },
      registry,
    )
    let asked = NO_ASKS
    const turns = new Set<string>()
    for (let i = 0; i < 200; i++) {
      if (r.continue.kind !== 'ask') break
      const step = stepBot(r, trivialBot, r.continue.faction, registry, asked)
      r = step.result
      asked = step.asked
      turns.add(asked.turn)
      // Whatever a turn is, it is never the entire game's worth of questions.
      expect(asked.prompts.size).toBeLessThan(60)
    }
    expect(turns.size).toBeGreaterThan(4)
  })

  it('does not flag an action that unwinds to an earlier question', () => {
    /*
     * The distinction the second wrong version could not make, asserted directly on the case that
     * broke it. `Done` returns to the Prelude, which *has* been asked — so a plain "have I seen this
     * before" flags it exactly as hard as the pointless swap, and gating the only way out left the
     * bot with nothing but swaps to choose between.
     *
     * The first version of this test asked only that some candidate somewhere was unflagged, which
     * a plain seen-before check satisfies easily; it passed under the mutation it was named for.
     * This one finds a candidate whose target was already asked *earlier than the current question*
     * and requires that specific candidate to be unflagged, so the two rules disagree on it.
     */
    /*
     * Swept across seeds rather than pinned to one. Fixing the lead decision changed which
     * sub-decisions the bot enters at all, and a single seed stopped producing the case — the
     * guard below caught that rather than the test quietly verifying nothing.
     */
    let checked = 0
    for (let seed = 1; seed <= 6 && checked === 0; seed++) {
    let r = startGame(
      { board: 'Board4MixUp1', factions: [...FOUR], seed, bots: [...FOUR] },
      registry,
    )
    let asked = NO_ASKS

    for (let i = 0; i < 1200; i++) {
      if (r.continue.kind !== 'ask') break
      const faction = r.continue.faction
      const prompt = r.continue.prompt
      const depth = prompt === undefined ? undefined : asked.prompts.get(prompt)

      if (depth !== undefined) {
        for (const a of r.continue.actions) {
          let next
          try {
            next = advance(r.state, a, registry)
          } catch {
            continue
          }
          const c = next.continue
          if (c.kind !== 'ask' || c.faction !== faction || c.prompt === undefined) continue
          const at = asked.prompts.get(c.prompt)
          // Seen before, but shallower — an unwind, and the only case the two rules disagree on.
          if (at === undefined || at >= depth) continue

          let flagged: boolean | undefined
          const spy: Bot = {
            id: 'spy',
            decide(observed, actions, lookahead) {
              flagged = lookahead?.(a)?.repeats
              return trivialBot.decide(observed, actions)
            },
          }
          stepBot(r, spy, faction, registry, asked)
          expect(flagged).toBe(false)
          checked++
        }
      }

      // Driven by the heuristic bot, because it is the one that enters optional sub-decisions
      // (the Prelude, arranging) and therefore the one that ever has an unwind to make.
      const step = stepBot(r, faction === 'red' ? heuristicBot : trivialBot, faction, registry, asked)
      r = step.result
      asked = step.asked
    }
    }

    // The test is worthless if it never found the case; assert it did.
    expect(checked).toBeGreaterThan(0)
  })
})
