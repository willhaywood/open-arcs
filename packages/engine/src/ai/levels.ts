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
 * Three rungs. Above easy, each is the rung below with one more fix to the one-ply harness (docs/19
 * section 22), and each is measured above the one below at two, three and four players (section
 * 25):
 *
 *   - **easy** — `mobileBot`: `standardBot` plus the move-reversal penalty. Before it, the
 *     evaluator could not separate Move destinations, ties fell to offer order, and the fleet
 *     walked the adjacency lists in circles — 14% of all moves were same-round A-to-B-to-A
 *     reversals, which looks broken the way Weapon-hoarding did. The penalty zeroed the
 *     reversals in probe games and came out 33/31/35 against `standardBot` over 240 three-player
 *     arena games (section 21) — parity, but only to about ±9 points at that size. Shipped on the
 *     same looks-broken argument as `leadZeroed` and the Prelude Weapon spend (section 9).
 *   - **normal** — `declarerBot`: easy whose lead probes resolve the declaration instead of
 *     declining it, so a lead is valued with the ambition it would win (`declarer.ts`). Every
 *     other decision is easy's.
 *   - **hard** — `menuDeclarerBot`: normal whose probes also play a pip-funded action through to
 *     the next pip menu, so Move, Build, Tax, Influence, Secure and Battle are each scored on the
 *     board they leave (`menu.ts`).
 *
 * Head to head at two players, normal beats easy 57.8% ± 2.8 and hard beats normal 75.9% ± 2.7.
 * At one three-player table: hard 68.6%, normal 19.8%, easy 11.6%. At one four-player table,
 * with `easyBot` in the fourth seat: hard 60.2%, normal 30.0%, easy 7.7%, `easyBot` 2.2%. The
 * steps are not even: easy to normal is the small one at two and three players — at parity on
 * Board2MixUp1 — and normal to hard the large one everywhere.
 *
 * ## Off the ladder: `easyBot` and the v3 beam
 *
 * `easyBot` — standard's evaluator fumbling close calls deterministically (`easy.ts`) — was easy
 * until section 25. Every rung moved up one bot rather than hard taking a fourth: `easyBot` won
 * 2.2% at that four-player table and 0.8% at a three-player table with normal and hard, a step
 * below easy far larger than any other on the ladder, and it can still loop between a Prelude's
 * Arrange and Done (section 22).
 *
 * The v3 beam (`search-v3`: every card play searched to the end of the turn it buys, under
 * `mobileBot`'s weights) held hard from section 14 until the declarer replaced it. It was a step
 * above `mobileBot` at two players and at four but not at three: 54.8% ± 4.3 against it at two,
 * then at one table with it and the declarer 26.9% to its 27.3% at three and 34.4% to 27.9% at
 * four. The declarer was ahead of the beam at two (58.0% ± 4.3) and three (45.7% to 26.9%) and
 * level with it at four (32.6% to 34.4%), and thinks for less: a median 7-14 ms a lead, where the
 * beam took 0.11-0.26 seconds a card play.
 *
 * ## Why no rung above it
 *
 * The register's search-side nulls — wider beams (section 7), more determinized deals (section 14),
 * a longer reply horizon (section 20) — were all measured on bots whose one-ply harness cannot see
 * what a pip-funded action does or the ambition a card would declare (section 22). They say that
 * more search *on that base* buys nothing; they do not say the base cannot be improved. Hard now
 * carries both fixes to the base that section 22 named, and none of those nulls has been re-run on
 * it.
 */

import { declarerBot } from './declarer.js'
import { menuDeclarerBot } from './menu.js'
import { mobileBot } from './mobile.js'
import type { Bot } from './bot.js'

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

/** The bot a level names. `undefined` — no level chosen, as in an older save — is normal. */
export function botForLevel(level: BotLevel | undefined): Bot {
  switch (level) {
    case 'easy':
      return mobileBot
    case 'hard':
      return menuDeclarerBot
    case 'normal':
    case undefined:
      return declarerBot
  }
}
