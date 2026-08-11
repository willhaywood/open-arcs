/**
 * The difficulty ladder: one mapping, one place.
 *
 * Levels name a *bot configuration*, and the mapping lives here rather than in the UI or the
 * store so "which bot is hard?" has exactly one answer — the same argument `surfaces.ts` makes
 * about Ask ownership, applied to opponents. The level is carried in `NewGameOptions.botLevel`
 * and persisted with the save, so a loaded game keeps the opponent it was started against;
 * replay is untouched either way, because the journal records actions, not who chose them.
 *
 * What each level is, and why (measurements in docs/19 sections 6-8):
 *
 *   - **easy** — normal's evaluator, fumbling close calls deterministically (`easy.ts`). Sound
 *     instincts, no polish. It ran the *frozen baseline's* evaluator until this was noticed, which
 *     made it blind to every goal-layer fix the other three levels have rather than merely worse at
 *     using them — see `easy.ts` for why that reads as broken instead of beatable.
 *   - **normal** — `standardBot`, what the game ships. The default, and what an absent `botLevel`
 *     means. It now also spends Weapons for their Prelude battle option, which measured as a null
 *     on strength and took Weapon spending from 1% to 26% (docs/19 section 9) — shipped for the
 *     same reason `leadZeroed` was, that hoarding them looks broken.
 *   - **hard** — the tier-1 beam search (`search-v3(3x14)`): the same judgement as normal with
 *     every card play searched to the end of the turn it buys. **Currently misnamed.** It measured
 *     ~+3 points over normal when it shipped (docs/19 section 7), but re-baselining after the tax
 *     filter, the follower-pass rule and the Weapon option put it 2-9 points *behind* normal against
 *     a 1-point twin floor — the sign has flipped, and this rung is now easier than the one below it
 *     (docs/19 section 11, which lists what to suspect). Do not describe it as stronger than normal
 *     until that is understood.
 *   - **brutal** — tier-2 (`search-v4`): hard, plus the strongest lines re-ranked by what the
 *     position looks like after the rivals reply from sampled hands. Measured past its gate by a
 *     distance nothing else in the register approaches: 67%-33% over normal at two players
 *     against a zero twin floor, +12 mean points at three (docs/19 section 8). Re-baselined at
 *     65%-35% on the same zero floor, so this one holds (docs/19 section 11).
 */

import { easyBot } from './easy.js'
import { standardBot } from './goal.js'
import { searchBot } from './search.js'
import type { Bot } from './bot.js'

export const BOT_LEVELS = ['easy', 'normal', 'hard', 'brutal'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

const HARD = searchBot({ width: 3, depth: 14 })
const BRUTAL = searchBot({ width: 3, depth: 14, replies: { roots: 3, deals: 2 } })

/** The bot a level names. `undefined` — no level chosen — is normal, which keeps old saves intact. */
export function botForLevel(level: BotLevel | undefined): Bot {
  switch (level) {
    case 'easy':
      return easyBot
    case 'hard':
      return HARD
    case 'brutal':
      return BRUTAL
    case 'normal':
    case undefined:
      return standardBot
  }
}
