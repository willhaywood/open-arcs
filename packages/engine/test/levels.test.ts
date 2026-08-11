/**
 * The difficulty ladder (`levels.ts`) and the easy bot (`easy.ts`).
 *
 * The ladder's contract is small and worth pinning exactly: every level resolves to a bot, absent
 * means normal (old saves must play as they always did), and the levels genuinely differ — a
 * selector whose options all resolve to the same opponent is decoration.
 */

import { describe, expect, it } from 'vitest'

import {
  BOT_LEVELS,
  loadGame,
  serializeGame,
  botForLevel,
  botToAct,
  defaultRegistry,
  easyBot,
  playGameAt,
  standardBot,
  startGame,
} from '../src/index.js'
import { NO_ASKS, stepBot } from '../src/ai/play.js'
import type { AskedThisTurn } from '../src/ai/play.js'
import type { FactionId, RuleResult } from '../src/index.js'

const registry = defaultRegistry()
const THREE: readonly FactionId[] = ['red', 'yellow', 'blue']

describe('the ladder', () => {
  it('resolves every level, and absent means normal', () => {
    for (const level of BOT_LEVELS) {
      expect(typeof botForLevel(level).decide, `${level} resolves`).toBe('function')
    }
    expect(botForLevel(undefined)).toBe(botForLevel('normal'))
    expect(botForLevel('normal')).toBe(standardBot)
  })

  it('adjacent levels are different opponents on a real position', () => {
    /*
     * Seed 3's opening card play is the established discriminator: standard leads Construction-2,
     * the search bot leads Mobilization-4 (`search.test.ts`), and easy shrugs among the close
     * calls. Asserting pairwise difference of the *chosen actions* here rather than bot identity,
     * because identity cannot catch a mapping that returns different objects wrapping the same
     * play.
     */
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 3 }, registry)
    const f = botToAct(cur, THREE)!
    const at = (level: Parameters<typeof botForLevel>[0]): string =>
      JSON.stringify(stepBot(cur, botForLevel(level), f, registry, NO_ASKS).decision.action)
    expect(at('normal')).not.toBe(at('hard'))
    expect(at('easy')).not.toBe(at('normal'))
  })
})

describe('the level in a save', () => {
  it('survives serialize and load, so a loaded game keeps its opponent', () => {
    const options = {
      board: 'Board3Frontiers',
      factions: [...THREE],
      seed: 5,
      bots: ['yellow', 'blue'] as FactionId[],
      botLevel: 'hard' as const,
    }
    const started = startGame(options, registry)
    const loaded = loadGame(serializeGame(options, started), registry)
    expect(loaded.options.botLevel).toBe('hard')
  })
})

describe('the easy bot', () => {
  /** Drive `steps` of seed 1 with normal deciding, and return the position it reaches. */
  const driveTo = (steps: number): { cur: RuleResult; asked: AskedThisTurn } => {
    let cur: RuleResult = startGame(
      { board: 'Board3Frontiers', factions: [...THREE], seed: 1 },
      registry,
    )
    let asked: AskedThisTurn = NO_ASKS
    for (let i = 0; i < steps; i++) {
      const f = botToAct(cur, THREE)
      expect(f, `the drive reached step ${i} with a bot to act`).toBeDefined()
      const step = stepBot(cur, standardBot, f!, registry, asked)
      cur = step.result
      asked = step.asked
    }
    return { cur, asked }
  }

  /** What easy ranked first — its judgement, before the fumble picks among the close calls. */
  const ranksTop = (at: { cur: RuleResult; asked: AskedThisTurn }): string => {
    const f = botToAct(at.cur, THREE)!
    const considered = stepBot(at.cur, easyBot, f, registry, at.asked).decision.considered
    expect(considered, 'easy reports what it weighed').toBeDefined()
    return String([...considered!].sort((a, b) => b.score - a.score)[0]!.action['label'])
  }

  it('finishes the game that livelocked before the fumble respected the gate', () => {
    /*
     * Arena game index 2 of `easy,standard,standard`: yellow (easy) cycled "Arrange your resource
     * slots" → "Done" for 20,000 actions at log 201, chapter 3, round 5.
     *
     * The cause was easy re-admitting what the evaluator's anti-livelock gate had ruled out.
     * `considered` reports every candidate, including ineligible ones, and easy re-ranked that
     * whole list — so the gate decided the inner bot's pick and easy then discarded it. Neither
     * action writes to the log, and `publicHash` reads only public state, so the hash never moved
     * and the same choice came up forever.
     *
     * Pinned as a whole game rather than a position, because that is how it presents: not an error
     * but 49 unfinished games in 240, against a `standard,standard,standard` control that lost
     * none. The bot this one replaced hung at the same rate, so this is not about the weights.
     */
    const o = playGameAt(
      [easyBot, standardBot, standardBot],
      2,
      { seed: 1, board: 'Board3Frontiers', factions: [...THREE] },
      registry,
    )
    expect(o.seed).toBe(1)
    expect(o.finished, o.reason).toBe(true)
  })

  it('is deterministic: the same position fumbles the same way twice', () => {
    const cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 2 }, registry)
    const f = botToAct(cur, THREE)!
    const a = stepBot(cur, easyBot, f, registry, NO_ASKS).decision
    const b = stepBot(cur, easyBot, f, registry, NO_ASKS).decision
    expect(JSON.stringify(a.action)).toBe(JSON.stringify(b.action))
  })

  it('ranks the Weapon’s battle option top — it sees what normal sees', () => {
    /*
     * The pin on the rebase itself. Easy used to run `BASELINE_WEIGHTS`, which is not "normal but
     * weaker" — it is the evaluator from before the whole goal layer, with income, declare-cost,
     * contest, `leadZeroed` and `battleUnlocked` all at 0. So easy was not playing worse, it was
     * blind to rules the other three levels can see, and it showed: it declared ambitions nobody
     * could score and never once spent a Weapon.
     *
     * Seed 1 step 164 is the position `weapon-option.test.ts` pins for the same reason. What is
     * asserted is easy's *ranking*, not its pick — the pick is the fumble's business, and here the
     * fumble does shrug to a peer within `SLACK`. Under the old weights the option scores 0 and
     * cannot rank top, so reverting the rebase fails here.
     */
    expect(ranksTop(driveTo(164))).toContain('add Battle option')
  })

  it('judges chapter goals by feasibility, the way normal does', () => {
    /*
     * The other half of the rebase, and it needs its own position: the weights came with
     * `feasibility` as the fitness, and leaving easy on `structuralFitness` would keep it blind to
     * what its position can actually *produce* — the same mistake as the weights, one layer down.
     *
     * Seed 1 step 122: easy pivots with **Administration-6**, where the same bot on structural
     * fitness pivots with Administration-3. Same move, different card — feasibility judging which
     * one the position can actually turn into a chapter goal. Ranking again, not the pick.
     *
     * **Finding this position honestly took three attempts, and the failures are the lesson.**
     * Comparing *scores* between the two fitnesses finds a divergence at nearly every step, because
     * feasibility moves almost every score while leaving the order alone. Comparing against a
     * locally rebuilt bot is no better — two attempts pinned steps that survived `feasibility`
     * being deleted, i.e. tests asserting nothing — because a rebuilt bot does not reproduce
     * `easyBot`'s call pattern.
     *
     * What works is to stop approximating: log `easyBot`'s own top-ranked action across a driven
     * game, once with `feasibility` and once with it deleted, and diff. Every step in that diff
     * diverges *because of the mutation this test defends against*, which is the only property that
     * makes the pin worth having.
     */
    expect(ranksTop(driveTo(122))).toContain('Pivot with Administration-6')
  })

  it('departs from its inner bot’s top choice somewhere in a real game', () => {
    /*
     * The whole point of the slack: if easy always took the top pick it would BE normal with a
     * different name. Drive one game with easy deciding; count where its pick differs from the
     * inner bot's. Zero departures fails — the hash never being consulted is exactly the mutation
     * this exists to catch.
     *
     * Compared against **`standardBot`**, which since easy was rebased onto `STANDARD_WEIGHTS` is
     * decision-identical to easy's inner bot. It used to compare against `baselineBot`, and that
     * comparison went vacuous the moment the weights diverged: two different evaluators disagree
     * all game long, so the count stayed positive with the fumble deleted and the test asserted
     * nothing. Same weights on both sides is what makes a departure attributable to the slack.
     */
    let cur = startGame({ board: 'Board3Frontiers', factions: [...THREE], seed: 1 }, registry)
    let asked: AskedThisTurn = NO_ASKS
    let departures = 0
    for (let i = 0; i < 200; i++) {
      const f = botToAct(cur, THREE)
      if (f === undefined) break
      const easy = stepBot(cur, easyBot, f, registry, asked)
      const top = stepBot(cur, standardBot, f, registry, asked)
      if (JSON.stringify(easy.decision.action) !== JSON.stringify(top.decision.action)) {
        departures++
      }
      cur = easy.result
      asked = easy.asked
    }
    expect(departures).toBeGreaterThan(0)
  })
})
