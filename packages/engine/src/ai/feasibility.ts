/**
 * Whether an ambition is *winnable from here*, rather than whether the faction looks generally big.
 *
 * docs/19 section 4, step 2. `structuralFitness` answers Tycoon with "how many cities and starports
 * do I have" — every city counts the same whether it sits on Material or on Psionic. So a faction
 * whose territory is entirely Relic planets rates its Tycoon prospects exactly as highly as one
 * sitting on the Material belt, and the worked example in section 2 is the consequence: the bot
 * declares on what it holds, never on what its position can produce.
 *
 * Feasibility answers the same question with the planets actually underneath: **cities on planets
 * that produce what this ambition scores**. Section 4 step 1 built the count; this is what it was
 * for — an input to "is this winnable", rather than another term competing with `cities` inside the
 * value function, where it was nearly a restatement and measured as one.
 *
 * ## The anti-flap rule, and exactly how far it reaches
 *
 * Intent is recomputed at every decision, so anything it reads that moves *within* a turn makes the
 * bot contradict itself between two of its own actions (section 2b). The rule is sharper than "do
 * not read resources": it must not move across **my own** actions. So this reads only structure —
 * cities and the planets they stand on — and never the resources those cities have already produced,
 * however tempting, because spending Material mid-turn would then lower the appetite for the Tycoon
 * it was spent on.
 *
 * Trophies and captives stay the one sanctioned exception, unchanged from `structuralFitness`: they
 * cannot be spent, so they do not move within a turn.
 */

import { metric } from '../rules/ambitions.js'
import { incomeFor } from './income.js'
import { Location, contentsOf, parseFigureId } from '../index.js'
import type { Fitness } from './intent.js'

export const feasibility: Fitness = (observed, self, ambition) => {
  const ships = (): number =>
    observed.board.systems.reduce(
      (n, s) =>
        n +
        contentsOf(observed.figures, Location.system(s)).filter((id) => {
          const f = parseFigureId(id)
          return f.color === self && f.piece === 'Ship'
        }).length,
      0,
    )

  switch (ambition) {
    case 'Tycoon':
    case 'Keeper':
    case 'Empath': {
      /*
       * Cities on planets that make the right thing. Weighted well above `structuralFitness`'s 0.8
       * per city precisely because it is a far narrower count — most cities produce nothing for any
       * given ambition, so the ones that do should say much more than "I have a city".
       */
      const earning = incomeFor(observed, self).get(ambition) ?? 0
      return 1 + earning * 1.6
    }
    case 'Warlord':
    case 'Tyrant':
      // Unchanged: trophies and captives cannot be spent, so reading my own metric is safe here.
      return 1 + metric(observed, self, ambition) * 1.2 + ships() * 0.2
  }
}
