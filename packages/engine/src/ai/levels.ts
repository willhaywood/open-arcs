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
 * three-rung rework below deliberately broke it: a saved game loads against whatever its level
 * names today, not against the bot it started with. Levels name the ladder as it stands, and the
 * ladder is allowed to be corrected when a rung turns out not to be a rung.
 *
 * Three rungs, each measured above the one below it at two, three and four players (docs/19
 * section 23):
 *
 *   - **easy** — standard's evaluator (normal's, without the move-reversal penalty), fumbling
 *     close calls deterministically (`easy.ts`). Sound instincts, no polish. It ran the *frozen
 *     baseline's* evaluator until this was noticed, which made it blind to every goal-layer fix
 *     the other levels have rather than merely worse at using them — see `easy.ts` for why that
 *     reads as broken instead of beatable. Measured 5% to standard's 48% (section 10) before
 *     #27-#51, and 5.2% ± 1.8 to normal's 27.9% at a four-player table with normal, hard and the
 *     v3 beam (section 23); not re-measured at two or three players since.
 *   - **normal** — `mobileBot`: `standardBot` plus the move-reversal penalty. Before it, the
 *     evaluator could not separate Move destinations, ties fell to offer order, and the fleet
 *     walked the adjacency lists in circles — 14% of all moves were same-round A-to-B-to-A
 *     reversals, which looks broken the way Weapon-hoarding did. The penalty zeroed the
 *     reversals in probe games and came out 33/31/35 against `standardBot` over 240 three-player
 *     arena games (section 21) — parity, but only to about ±9 points at that size. Shipped on the
 *     same looks-broken argument as `leadZeroed` and the Prelude Weapon spend (section 9).
 *   - **hard** — `declarerBot`: normal whose lead probes resolve the declaration instead of
 *     declining it, so a lead is valued with the ambition it would win (`declarer.ts`). Every
 *     other decision is normal's. One seat against normal it won 56.9% of two-player games pooled
 *     over the four boards, 45.8% of three-player and 40.5% of four-player, against chance lines
 *     of 50%, 33.3% and 25%.
 *
 * ## Off the ladder: the v3 beam
 *
 * The v3 beam (`search-v3`: every card play searched to the end of the turn it buys, under
 * normal's weights) held hard from section 14 until the declarer replaced it. It was a step above
 * normal at two players and at four but not at three: 54.8% ± 4.3 against normal at two, then at
 * one table with normal and the declarer 26.9% to normal's 27.3% at three and 34.4% to 27.9% at
 * four. The declarer is above normal at all three, ahead of the beam at two (58.0% ± 4.3) and
 * three (45.7% to 26.9%) and level with it at four (32.6% to 34.4%), so it took hard rather than
 * a fourth rung. It also thinks for less: a median 7-14 ms a lead, where the beam took 0.11-0.26
 * seconds a card play.
 *
 * ## Why no rung above it
 *
 * The register's search-side nulls — wider beams (section 7), more determinized deals (section 14),
 * a longer reply horizon (section 20) — were all measured on bots whose one-ply harness cannot see
 * what a pip-funded action does or the ambition a card would declare (section 22). They say that
 * more search *on that base* buys nothing; they do not say the base cannot be improved. The
 * declarer is the first fix to the base; the pip menu is the other (section 22).
 */

import { declarerBot } from './declarer.js'
import { easyBot } from './easy.js'
import { mobileBot } from './mobile.js'
import type { Bot } from './bot.js'

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

/** The bot a level names. `undefined` — no level chosen — is normal, which keeps old saves intact. */
export function botForLevel(level: BotLevel | undefined): Bot {
  switch (level) {
    case 'easy':
      return easyBot
    case 'hard':
      return declarerBot
    case 'normal':
    case undefined:
      return mobileBot
  }
}
