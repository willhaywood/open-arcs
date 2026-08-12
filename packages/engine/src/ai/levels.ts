/**
 * The difficulty ladder: one mapping, one place.
 *
 * Levels name a *bot configuration*, and the mapping lives here rather than in the UI or the
 * store so "which bot is hard?" has exactly one answer — the same argument `surfaces.ts` makes
 * about Ask ownership, applied to opponents. The level is carried in `NewGameOptions.botLevel`
 * and persisted with the save; replay is untouched either way, because the journal records
 * actions, not who chose them.
 *
 * **A level is not a promise about which bot a saved game keeps.** It used to be, and the
 * three-rung rework below deliberately broke it: a game saved against the old `hard` (the v3 beam)
 * loads against the current one, which is far stronger. Levels name the ladder as it stands, and
 * the ladder is allowed to be corrected when a rung turns out not to be a rung.
 *
 * Three rungs, because only three are measurably distinct (docs/19 section 14):
 *
 *   - **easy** — normal's evaluator, fumbling close calls deterministically (`easy.ts`). Sound
 *     instincts, no polish. It ran the *frozen baseline's* evaluator until this was noticed, which
 *     made it blind to every goal-layer fix the other levels have rather than merely worse at
 *     using them — see `easy.ts` for why that reads as broken instead of beatable. 5% wins against
 *     normal's 48%.
 *   - **normal** — `standardBot`, what the game ships. The default, and what an absent `botLevel`
 *     means. It now also spends Weapons for their Prelude battle option, which measured as a null
 *     on strength and took Weapon spending from 1% to 26% (docs/19 section 9) — shipped for the
 *     same reason `leadZeroed` was, that hoarding them looks broken.
 *   - **hard** — the reply search (`search-v4`): every card play searched to the end of the turn it
 *     buys, and the strongest lines re-ranked by what the position looks like after the rivals
 *     reply from sampled hands. 63%-37% over normal at two players against a zero twin floor, and
 *     the only idea in the register that ever cleared its floor by an order of magnitude.
 *
 * ## What was dropped, and why the gaps are where they are
 *
 * **The v3 beam is no longer a rung.** It was `hard` for as long as it measured ~+3 points over
 * normal (docs/19 section 7); re-measured after the trophy and dice fixes it sits 1-3 points
 * *behind* on win rate with power inside the floor (section 13). A rung that costs a beam search per
 * card play and does not beat the bot below it is not a difficulty setting. `searchBot` is untouched
 * — `hard` is the same function with replies switched on — so this removes a ladder entry, not code.
 *
 * **`replies` is one deal, not six.** `roots: 1, deals: 1` measured 63%-37%; the `3 x 2` this
 * shipped with measured 64%-36%, both on a zero floor, and 3 x 2 costs **twice the wall time**
 * (docs/19 section 14). The strength is in consulting the rivals at all, not in how thoroughly —
 * the same shape as section 7 finding that doubling the beam's width bought nothing. For an
 * opponent a human waits on, half the thinking time for the same play is the whole argument.
 *
 * **There is no rung above this one, and that is a measured position rather than a gap in the
 * work.** Every attempt to buy strength with more search effort has measured null — wider beams
 * (section 7), more determinized deals (section 14) — while everything that ever worked let the
 * evaluator see something it could not see before. A fourth rung needs either that kind of
 * discovery or a rule handicap, and neither is a afternoon's work.
 */

import { easyBot } from './easy.js'
import { standardBot } from './goal.js'
import { searchBot } from './search.js'
import type { Bot } from './bot.js'

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

const HARD = searchBot({ width: 3, depth: 14, replies: { roots: 1, deals: 1 } })

/** The bot a level names. `undefined` — no level chosen — is normal, which keeps old saves intact. */
export function botForLevel(level: BotLevel | undefined): Bot {
  switch (level) {
    case 'easy':
      return easyBot
    case 'hard':
      return HARD
    case 'normal':
    case undefined:
      return standardBot
  }
}
