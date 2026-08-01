/**
 * Bot versus bot, over seeded games, reported as numbers.
 *
 * docs/19 section 5 step 6, sequenced deliberately *before* V2 rollouts: without it there is no way
 * to tell whether rollouts helped. The immediate reason it exists is sharper than that — V1
 * currently passes on turn one, there are three plausible fixes, and no way to rank them by eye
 * (section 2f). "It feels better" is not evidence, and this is the thing that replaces it.
 *
 * ## What it measures, and what it refuses to
 *
 * Three numbers per bot, because in a four-player game a win rate alone is thin:
 *
 *   - **Wins** — the headline, and the least informative of the three at four seats.
 *   - **Mean rank** — 1..4. Moves on every game rather than one in four, so it separates bots that
 *     win rarely but place well from ones that are simply lucky.
 *   - **Mean power** — the only one with a floor that means something. A bot that scores nothing
 *     scores nothing whether it "wins" or not, and that is exactly the state V1 is in.
 *
 * Everything is reported per **bot id**, aggregated across the seats it played.
 *
 * ## Two ways this could lie, both handled here
 *
 * **Seat order matters in Arcs**, so a fixed assignment measures the seat as much as the bot. Games
 * rotate the assignment, and a run whose game count is not a multiple of the seat count is reported
 * as unbalanced rather than quietly averaged.
 *
 * **Ties are broken by faction order.** `performCheckWin` reduces over `state.factions` keeping the
 * first on equality, so when nobody scores — precisely today's case — the first seat "wins" every
 * game. That would read as a 25%-baseline bot at 100%. Outcomes therefore carry `tied`, and the
 * report separates outright wins from tie-break wins. A run whose wins are all tie-break wins is
 * telling you the bots did nothing, not who is better.
 */

import { defaultRegistry, startGame } from '../index.js'
import { botFor, runBots } from './play.js'
import type { BotSeats } from './play.js'
import type { Bot } from './bot.js'
import type { FactionId } from '../ids.js'
import type { NewGameOptions } from '../index.js'
import type { RuleRegistry } from '../dispatch.js'

/** How one game came out. */
export interface GameOutcome {
  readonly seed: number
  /** Bot id per seat, so a suspicious result can be reproduced exactly. */
  readonly seats: Readonly<Partial<Record<FactionId, string>>>
  /**
   * Did the game actually reach `gameOver`?
   *
   * A run stops early if the engine asks something no bot seat can answer. That is a bug to chase,
   * not a result to average, so unfinished games are excluded from the records and counted
   * separately.
   */
  readonly finished: boolean
  readonly reason: string
  readonly winner?: FactionId
  /** The winner's power was matched by someone — the win came from the faction-order tie-break. */
  readonly tied: boolean
  readonly power: Readonly<Partial<Record<FactionId, number>>>
  readonly chapters: number
  /** Decisions taken. Near-zero means the bots passed rather than played. */
  readonly actions: number
  readonly ms: number
}

export interface ArenaGame {
  readonly seats: BotSeats
  readonly seed: number
  readonly board?: string
  readonly factions?: readonly FactionId[]
  readonly leadersAndLore?: NewGameOptions['leadersAndLore']
  /** Decisions before the game is called stuck. See `STUCK_AFTER`. */
  readonly stuckAfter?: number
}

const DEFAULT_BOARD = 'Board4MixUp1'
const DEFAULT_FACTIONS: readonly FactionId[] = ['red', 'yellow', 'blue', 'white']

/**
 * When to give up on a game, well below `runBots`' own safety net of 100,000.
 *
 * A finished game takes 600–750 decisions, so this is roughly thirty times a real one — generous
 * enough that hitting it means a loop rather than a long game. The tighter bound is here because of
 * how a livelock actually presents: not as an error but as *slowness*. Removing the loop-breaking
 * and re-running the tests did not fail them, it hung for ten minutes, which is the least useful
 * signal a test can give. At this bound the same experiment reports a run of unfinished games in
 * seconds, and the report prints how many.
 */
const STUCK_AFTER = 20_000

/**
 * Play one game to its end and report the outcome.
 *
 * Every seat is a bot, so `runBots` returns only at `gameOver` — or, if the engine ever asks in a
 * shape the loop does not drive, at that ask. Both are reported rather than thrown, because a run of
 * a thousand games should tell you a hundred stalled, not die on the first.
 */
export function playGame(game: ArenaGame, registry?: RuleRegistry): GameOutcome {
  const reg = registry ?? defaultRegistry()
  const factions = game.factions ?? DEFAULT_FACTIONS
  const started = Date.now()

  const options: NewGameOptions = {
    board: game.board ?? DEFAULT_BOARD,
    factions,
    seed: game.seed,
    bots: factions,
    ...(game.leadersAndLore === undefined ? {} : { leadersAndLore: game.leadersAndLore }),
  }

  const seats: Partial<Record<FactionId, string>> = {}
  for (const f of factions) seats[f] = botFor(game.seats, f).id

  let outcome: { finished: boolean; reason: string; winner?: FactionId; power: Readonly<Partial<Record<FactionId, number>>>; chapters: number; actions: number }
  try {
    const out = runBots(
      startGame(options, reg),
      factions,
      game.seats,
      reg,
      game.stuckAfter ?? STUCK_AFTER,
    )
    const cont = out.result.continue
    const winner = cont.kind === 'gameOver' ? cont.winners[0] : undefined
    outcome = {
      finished: cont.kind === 'gameOver',
      reason: cont.kind === 'gameOver' ? cont.reason : `stopped on ${cont.kind}`,
      ...(winner === undefined ? {} : { winner }),
      power: out.result.state.power,
      chapters: out.result.state.chapter,
      actions: out.decisions.length,
    }
  } catch (e) {
    /*
     * A thrown game is data too — the stuck-detector firing, or a rule the bots drove into a corner
     * the engine cannot answer. Recording it beside the others is what makes a long run worth
     * leaving alone.
     */
    outcome = {
      finished: false,
      reason: `threw: ${e instanceof Error ? e.message : String(e)}`,
      power: {},
      chapters: 0,
      actions: 0,
    }
  }

  const winnerPower = outcome.winner === undefined ? 0 : (outcome.power[outcome.winner] ?? 0)
  const tied =
    outcome.winner !== undefined &&
    factions.some((f) => f !== outcome.winner && (outcome.power[f] ?? 0) >= winnerPower)

  return {
    seed: game.seed,
    seats,
    ...outcome,
    tied,
    ms: Date.now() - started,
  }
}

export interface ArenaConfig {
  /**
   * One bot per seat, in seat order — and rotated between games so each plays each seat.
   *
   * Repeats are allowed and are how you run three of one against one of another; records aggregate
   * by bot id, so such a bot is simply credited with three times the games.
   */
  readonly bots: readonly Bot[]
  readonly games: number
  /** Game `i` uses `seed + i`, so a whole run is reproducible from one number. */
  readonly seed?: number
  readonly board?: string
  readonly factions?: readonly FactionId[]
  readonly leadersAndLore?: NewGameOptions['leadersAndLore']
  /** Decisions before a game is called stuck; lower it to make a loop fail fast. */
  readonly stuckAfter?: number
  /** Called after each game — the CLI prints progress rather than waiting in silence. */
  readonly onGame?: (outcome: GameOutcome, index: number) => void
}

export interface BotRecord {
  readonly id: string
  readonly games: number
  readonly wins: number
  /** Wins where the bot's power was strictly the highest — the ones that mean anything. */
  readonly outrightWins: number
  /** 1 is best. Ties share a rank, so four scoreless bots all rank 1. */
  readonly meanRank: number
  readonly meanPower: number
}

export interface ArenaReport {
  readonly records: readonly BotRecord[]
  readonly games: readonly GameOutcome[]
  readonly finished: number
  /** True when every bot played every seat an equal number of times. */
  readonly balanced: boolean
  /** Decisions per game. Small numbers mean the bots are passing, not playing. */
  readonly meanActions: number
  /** Power scored by everyone, per game. Zero is the loudest number this report can print. */
  readonly meanTotalPower: number
  readonly ms: number
}

/** Rank within a game, 1 = best, ties sharing a rank. */
function rankOf(
  power: Readonly<Partial<Record<FactionId, number>>>,
  factions: readonly FactionId[],
  self: FactionId,
): number {
  const mine = power[self] ?? 0
  return 1 + factions.filter((f) => (power[f] ?? 0) > mine).length
}

/**
 * Which bot sits in which seat for game `i`.
 *
 * Rotates so that over `n` games each bot plays each seat once — seat order matters in Arcs, and a
 * fixed assignment measures the seat as much as the bot.
 *
 * **Exported because a parallel runner has to agree with this exactly.** Game `i` must produce the
 * same matchup and the same seed whichever process plays it, or the shards are not sampling one
 * experiment.
 */
export function seatsForGame<T>(
  bots: readonly T[],
  factions: readonly FactionId[],
  index: number,
): Partial<Record<FactionId, T>> {
  const seats: Partial<Record<FactionId, T>> = {}
  factions.forEach((f, j) => {
    // The caller checks the bounds; the index is always in range.
    seats[f] = bots[(j + index) % bots.length]!
  })
  return seats
}

/**
 * The seed for game `i` of a run, so every runner agrees on which game is which.
 *
 * **A seed is held while the seats rotate through it**, so `n` consecutive games are the same
 * starting position played with every seating. Without that, seed and seating advance together and
 * are confounded: each bot plays each seat an equal number of times, but always on a *different set
 * of boards*, so setup luck never cancels.
 *
 * It shows up as a noise floor that will not come down. Two identical bots, 120 games, still landed
 * 12 points of win rate apart — because they were never compared on the same game. Sharing the seed
 * across a full rotation removes that whole source of variance rather than averaging it away.
 */
export const seedForGame = (base: number | undefined, index: number, seats: number): number =>
  (base ?? 1) + Math.floor(index / Math.max(1, seats))

/** Play one game of a run by its index, without needing the whole run. */
export function playGameAt(
  bots: readonly Bot[],
  index: number,
  config: Omit<ArenaConfig, 'bots' | 'games' | 'onGame'>,
  registry?: RuleRegistry,
): GameOutcome {
  const factions = config.factions ?? DEFAULT_FACTIONS
  return playGame(
    {
      seats: seatsForGame(bots, factions, index),
      seed: seedForGame(config.seed, index, factions.length),
      ...(config.board === undefined ? {} : { board: config.board }),
      factions,
      ...(config.leadersAndLore === undefined ? {} : { leadersAndLore: config.leadersAndLore }),
      ...(config.stuckAfter === undefined ? {} : { stuckAfter: config.stuckAfter }),
    },
    registry,
  )
}

/**
 * Turn a set of played games into the report.
 *
 * **Separate from playing them, which is the whole point.** Games are independent, so they can be
 * played anywhere — in this process, or across a pool of worker processes — and the aggregation has
 * to be identical either way or a parallel run is measuring something a serial run is not. Keeping
 * one implementation is what guarantees that.
 */
export function reportFrom(
  outcomes: readonly GameOutcome[],
  botIds: readonly string[],
  factions: readonly FactionId[],
  ms: number,
): ArenaReport {
  // Only finished games are averaged; a stall says nothing about who plays better.
  const scored = outcomes.filter((o) => o.finished)
  const ids = [...new Set(botIds)]
  const records: BotRecord[] = ids.map((id) => {
    let games = 0
    let wins = 0
    let outrightWins = 0
    let rank = 0
    let power = 0
    for (const o of scored) {
      for (const f of factions) {
        if (o.seats[f] !== id) continue
        games++
        power += o.power[f] ?? 0
        rank += rankOf(o.power, factions, f)
        if (o.winner === f) {
          wins++
          if (!o.tied) outrightWins++
        }
      }
    }
    return {
      id,
      games,
      wins,
      outrightWins,
      meanRank: games === 0 ? 0 : rank / games,
      meanPower: games === 0 ? 0 : power / games,
    }
  })

  const totalPower = scored.reduce(
    (n, o) => n + factions.reduce((m, f) => m + (o.power[f] ?? 0), 0),
    0,
  )

  return {
    records: [...records].sort((a, b) => a.meanRank - b.meanRank || b.meanPower - a.meanPower),
    games: outcomes,
    finished: scored.length,
    balanced: outcomes.length % factions.length === 0,
    meanActions: scored.length === 0 ? 0 : scored.reduce((n, o) => n + o.actions, 0) / scored.length,
    meanTotalPower: scored.length === 0 ? 0 : totalPower / scored.length,
    ms,
  }
}

export function runArena(config: ArenaConfig, registry?: RuleRegistry): ArenaReport {
  const reg = registry ?? defaultRegistry()
  const factions = config.factions ?? DEFAULT_FACTIONS
  if (config.bots.length !== factions.length) {
    throw new Error(`runArena: ${config.bots.length} bots for ${factions.length} seats`)
  }

  const started = Date.now()
  const outcomes: GameOutcome[] = []
  for (let i = 0; i < config.games; i++) {
    const outcome = playGameAt(config.bots, i, config, reg)
    outcomes.push(outcome)
    config.onGame?.(outcome, i)
  }
  return reportFrom(
    outcomes,
    config.bots.map((b) => b.id),
    factions,
    Date.now() - started,
  )
}

/**
 * The report as text.
 *
 * Lives here rather than in the script so the caveats travel with the numbers. The warning lines are
 * the point of the function: a table of win rates with no note that every win came from a tie-break
 * is worse than no table, because it looks like a measurement.
 */
export function formatReport(report: ArenaReport): string {
  const lines: string[] = []
  const pct = (n: number, of: number): string => (of === 0 ? '  —' : `${Math.round((n / of) * 100)}%`)

  lines.push(
    `${report.games.length} games, ${report.finished} finished, ${(report.ms / 1000).toFixed(1)}s`,
  )
  lines.push('')
  lines.push('bot                  games   wins  outright   rank   power')
  for (const r of report.records) {
    lines.push(
      [
        r.id.padEnd(20),
        String(r.games).padStart(5),
        pct(r.wins, r.games).padStart(7),
        pct(r.outrightWins, r.games).padStart(10),
        r.meanRank.toFixed(2).padStart(7),
        r.meanPower.toFixed(1).padStart(8),
      ].join(''),
    )
  }
  lines.push('')
  lines.push(`mean decisions per game: ${report.meanActions.toFixed(0)}`)
  lines.push(`mean power scored by everyone: ${report.meanTotalPower.toFixed(1)}`)

  const warnings: string[] = []
  if (!report.balanced) {
    warnings.push('games is not a multiple of the seat count — seats were not played equally')
  }
  if (report.finished < report.games.length) {
    warnings.push(`${report.games.length - report.finished} games did not finish`)
  }
  if (report.meanTotalPower === 0 && report.finished > 0) {
    warnings.push('nobody scored in any game — the wins below are all faction-order tie-breaks')
  } else if (report.records.every((r) => r.outrightWins === 0) && report.finished > 0) {
    warnings.push('every win was a tie-break — this run ranks nothing')
  }
  if (warnings.length > 0) {
    lines.push('')
    for (const w of warnings) lines.push(`! ${w}`)
  }

  return lines.join('\n')
}
