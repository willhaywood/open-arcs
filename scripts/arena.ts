/**
 * Run the arena and print the table.
 *
 * A script rather than a test: it is slow, and its output is a number to read rather than an
 * assertion to satisfy. The fast seeded version that keeps this from rotting lives in
 * `test/arena.test.ts`.
 *
 *   npm run arena                            # 8 games, heuristic against three trivial
 *   npm run arena -- --games 40
 *   npm run arena -- --seats heuristic,heuristic,trivial,trivial
 *   npm run arena -- --seed 500 --verbose    # per-game lines as they finish
 *
 * `--seats` takes bot ids in seat order; the arena rotates them between games so every bot plays
 * every seat. Repeats are the point — three trivial against one heuristic is the baseline question
 * (docs/19 section 2f), and a bot that cannot beat "first legal action" is not working.
 */

import { formatReport, heuristicBot, runArena, trivialBot } from '@arcs/engine'
import type { Bot, GameOutcome } from '@arcs/engine'

const BOTS: Readonly<Record<string, Bot>> = {
  trivial: trivialBot,
  heuristic: heuristicBot,
}

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const games = Number(flag('games') ?? 8)
const seed = Number(flag('seed') ?? 1)
const verbose = argv.includes('--verbose')

const names = (flag('seats') ?? 'heuristic,trivial,trivial,trivial').split(',')
const bots = names.map((n) => {
  const bot = BOTS[n.trim()]
  if (bot === undefined) {
    throw new Error(`Unknown bot "${n.trim()}" — known: ${Object.keys(BOTS).join(', ')}`)
  }
  return bot
})

console.log(`Arena: ${names.join(' vs ')} — ${games} games from seed ${seed}\n`)

const onGame = (o: GameOutcome, i: number): void => {
  if (!verbose && o.finished) return
  // Unfinished games always print: they are the ones worth chasing, and silence would hide them.
  const who = o.winner === undefined ? '—' : `${o.winner} (${o.seats[o.winner] ?? '?'})`
  console.log(
    `  #${String(i + 1).padStart(3)} seed ${o.seed}  ${o.finished ? 'ok  ' : 'STOP'}  ` +
      `${o.actions} actions, ch${o.chapters}, winner ${who}${o.tied ? ' [tie-break]' : ''}  ` +
      `${o.reason}`,
  )
}

const report = runArena({ bots, games, seed, onGame })
console.log(`${verbose ? '\n' : ''}${formatReport(report)}`)
