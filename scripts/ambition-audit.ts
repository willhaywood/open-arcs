/**
 * Does the bot **win the ambitions it declares**, or merely happen to be standing there?
 *
 *   npm run audit                                   # the shipped bot, 40 games
 *   npm run audit -- --bot baseline --games 60
 *   npm run audit -- --bot standard --lore 3        # on expansion games
 *
 * ## Why this exists, when the arena already reports power
 *
 * **The arena cannot see this.** It reports who won and with how much power, and by that measure a
 * bot which declares at random looks fine — with three players *someone* takes every declared
 * ambition, so scoring accrues whether or not any of it was intended. That is precisely the failure
 * this script was written to catch, and it caught it: the frozen baseline declares 12.8 times a game
 * and wins those at **34%**, against a **33%** chance line. Its declarations were worth nothing, and
 * no power number could have said so.
 *
 * ## The funnel, and what each stage answers
 *
 *   - **Aim** — does it declare what it is actually pursuing? Compared against the top of
 *     `intent.pursuing`, which is the bot's *own* plan, recomputed every turn, not an outside guess.
 *   - **Declare** — is it ahead when it commits? Its `metric` against the best rival's, at the
 *     instant of declaring.
 *   - **Win** — does it convert? Read from the engine's own score log rather than recomputed, so
 *     leader traits and the Qualifying rule are already accounted for.
 *
 * ## Reading it
 *
 * **Declared → won against chance is the headline.** At `1/players` the declaration is doing no
 * work. Meaningfully above it is deliberate play.
 *
 * **Ahead-when-declaring separates two different virtues.** A bot that only ever declares what it
 * already leads is *converting*, not *striving* — banking a position rather than building one.
 * Winning from behind is the stronger evidence of intent, and the two move in opposite directions:
 * the shipped bot declares from ahead 87% of the time and wins from behind half as often as the
 * baseline does.
 *
 * **Nobody qualified is pure waste.** Declaring zeroes the played card, so an ambition no player can
 * score costs a card for nothing. That number is what motivated `leadZeroed` (docs/19 section 4).
 */

import { AMBITIONS, botToAct, defaultRegistry, metric, observe, startGame } from '@arcs/engine'
import { NO_ASKS, stepBot } from '@arcs/engine'
import { feasibility, intentFor } from '@arcs/engine'
import type { Ambition, FactionId, RuleResult } from '@arcs/engine'

import { buildBot, parseSpec } from './bot-spec.js'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const games = Number(flag('games') ?? 40)
const seed = Number(flag('seed') ?? 500)
const lorePerPlayer = Number(flag('lore') ?? 0)
const bot = buildBot(parseSpec(flag('bot') ?? 'standard'))

const factions: FactionId[] = ['red', 'yellow', 'blue']
const board = flag('board') ?? 'Board3Frontiers'
const registry = defaultRegistry()
const seats = Object.fromEntries(factions.map((f) => [f, bot])) as Record<FactionId, typeof bot>

/** One declaration, held until its ambition scores so the two can be matched up. */
interface Pending {
  faction: FactionId
  ambition: Ambition
  aheadAtDeclare: boolean
  wasAiming: boolean
}

let declares = 0
let declaredAndWon = 0
let aheadWhenDeclaring = 0
let aheadAndWon = 0
let wonFromBehind = 0
let onPlan = 0
let onPlanWon = 0
let offPlanWon = 0
let scored = 0
let wonByNonDeclarer = 0
let nobodyQualified = 0
let chapters = 0
let finished = 0

for (let g = 0; g < games; g++) {
  let cur: RuleResult = startGame(
    {
      seed: seed + g,
      board,
      factions,
      ...(lorePerPlayer > 0 ? { leadersAndLore: { expansion: true, lorePerPlayer } } : {}),
    },
    registry,
  )
  let asked = NO_ASKS
  let pending: Pending[] = []
  let read = 0

  for (let i = 0; i < 20_000; i++) {
    const f = botToAct(cur, factions)
    if (f === undefined) {
      finished++
      break
    }
    const before = cur.state
    const step = stepBot(cur, seats[f], f, registry, asked)
    const action = step.decision.action

    if (action.type === 'ambition/declare') {
      const ambition = action['ambition'] as Ambition
      const mine = metric(before, f, ambition)
      const best = Math.max(...factions.filter((x) => x !== f).map((x) => metric(before, x, ambition)))

      // The bot's own plan, read the way the bot reads it.
      const observed = observe(before, f)
      const intent = intentFor(observed, f, feasibility)
      const aiming = [...AMBITIONS].sort(
        (a, b) => (intent.pursuing.get(b) ?? 0) - (intent.pursuing.get(a) ?? 0),
      )[0]

      const entry: Pending = {
        faction: f,
        ambition,
        aheadAtDeclare: mine > best,
        wasAiming: aiming === ambition,
      }
      pending.push(entry)
      declares++
      if (entry.aheadAtDeclare) aheadWhenDeclaring++
      if (entry.wasAiming) onPlan++
    }

    cur = step.result
    asked = step.asked

    /*
     * Outcomes come from the engine's own log rather than being recomputed. `performScore` has
     * already applied the Qualifying rule and the leader traits that demote a placing, so re-deriving
     * a winner here would be a second implementation free to disagree with the real one.
     */
    for (const line of cur.state.log.slice(read)) {
      const won = /^(\w+) won (\w+) /.exec(line)
      const tied = /^(\w+) tied (\w+) /.exec(line)
      const none = /^No one scored (\w+)$/.exec(line)
      if (won !== null || tied !== null || none !== null) {
        scored++
        const ambition = (won?.[2] ?? tied?.[2] ?? none?.[1]) as Ambition
        const winner = (won?.[1] ?? tied?.[1]) as FactionId | undefined
        const entry = pending.find((p) => p.ambition === ambition)
        if (winner === undefined) nobodyQualified++
        else if (entry === undefined) wonByNonDeclarer++
        else if (entry.faction === winner) {
          declaredAndWon++
          if (entry.aheadAtDeclare) aheadAndWon++
          else wonFromBehind++
          if (entry.wasAiming) onPlanWon++
          else offPlanWon++
        }
        if (entry !== undefined) pending = pending.filter((p) => p !== entry)
      }
      if (/^Chapter \d+: dealt/.test(line)) {
        chapters++
        // Markers do not carry over, so an unresolved declaration cannot belong to the next chapter.
        pending = []
      }
    }
    read = cur.state.log.length
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '   —' : `${Math.round((n / d) * 100)}%`.padStart(4))
const chance = Math.round((1 / factions.length) * 100)

console.log(
  `\n=== ${bot.id} — ${games} games (${finished} finished), ${chapters} chapters` +
    `${lorePerPlayer > 0 ? `, leaders&lore x${lorePerPlayer}` : ''} ===\n`,
)
console.log(`  declarations                    ${declares}  (${(declares / games).toFixed(1)}/game)`)
console.log(`  ambitions scored                ${scored}`)
console.log()
console.log(`  DECLARED -> WON FIRST PLACE     ${pct(declaredAndWon, declares)}   (${declaredAndWon}/${declares})`)
console.log(`  chance if merely standing there ${String(chance).padStart(3)}%   (1 of ${factions.length})`)
console.log()
console.log(`  already ahead when declaring    ${pct(aheadWhenDeclaring, declares)}   <- banking, not building`)
console.log(`     ...of those, went on to win  ${pct(aheadAndWon, aheadWhenDeclaring)}`)
console.log(`     ...won from behind           ${wonFromBehind}   <- the striving ones`)
console.log()
console.log(`  declared what it was aiming at  ${pct(onPlan, declares)}   (${onPlan}/${declares})`)
console.log(`     ...and won it                ${pct(onPlanWon, onPlan)}`)
console.log(`     ...off plan, won it          ${pct(offPlanWon, declares - onPlan)}`)
console.log()
console.log(`  won by someone who declared it  ${pct(declaredAndWon, scored)}`)
console.log(`  won by a NON-declarer           ${pct(wonByNonDeclarer, scored)}   <- incidental`)
console.log(`  nobody qualified                ${pct(nobodyQualified, scored)}   <- wasted cards`)
console.log()
