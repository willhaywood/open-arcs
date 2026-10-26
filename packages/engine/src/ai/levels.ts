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
 * Three rungs, because only three are measurably distinct (docs/19 section 14):
 *
 *   - **easy** — normal's evaluator, fumbling close calls deterministically (`easy.ts`). Sound
 *     instincts, no polish. It ran the *frozen baseline's* evaluator until this was noticed, which
 *     made it blind to every goal-layer fix the other levels have rather than merely worse at
 *     using them — see `easy.ts` for why that reads as broken instead of beatable. Measured 5% to
 *     standard's 48% (section 10) before #27-#51 and never re-measured against `mobileBot`.
 *   - **normal** — `mobileBot`: `standardBot` plus the move-reversal penalty. Before it, the
 *     evaluator could not separate Move destinations, ties fell to offer order, and the fleet
 *     walked the adjacency lists in circles — 14% of all moves were same-round A-to-B-to-A
 *     reversals, which looks broken the way Weapon-hoarding did. The penalty zeroed the
 *     reversals in probe games and came out 33/31/35 against `standardBot` over 240 three-player
 *     arena games (section 21) — parity, but only to about ±9 points at that size. Shipped on the
 *     same looks-broken argument as `leadZeroed` and the Prelude Weapon spend (section 9).
 *   - **hard** — the v3 beam (`search-v3`): every card play searched to the end of the turn it
 *     buys, under normal's weights. Every other ask — 86-88% of its decisions — is normal's
 *     one-ply choice.
 *
 * ## What hard is, measured
 *
 * **Hard shipped as the reply search, and the replies never decided anything.** With
 * `replies: { roots: 1 }` only the beam's own winner is reply-checked, and the final pick must come
 * from the checked set, so the winner is always the plain beam's argmax (`search.ts`). It was
 * decision-identical to the v3 beam and paid for the replies anyway — over 70 seconds on a single
 * three-player card play in one measured game. Dropping them changed no decision: 60 games, 20 at
 * each of two, three and four players across all twelve boards, one hard seat against normal,
 * produced byte-identical journals with and without them, and finished 1.3x, 1.4x and 1.7x faster.
 *
 * Which reopens section 14's verdict on the v3 beam. The 63%-37% that made `reply:1:1` the hard
 * rung was the v3 beam's number all along: measured against `standardBot` with a `STANDARD_WEIGHTS`
 * delegate, before #27-#51, at two players only. Section 13 had the same beam 1-3 points *behind*
 * normal at three players, and nothing has been measured at four, the web default. An
 * unregistered 160-game re-measure on current main put hard at 55.6% ± 3.9 against normal at two
 * players, on one board. The ladder is due a per-board, per-player-count re-baseline (section 22);
 * until then "hard" is a stronger two-player opponent and an unproven one at three and four.
 *
 * ## Why no rung above it
 *
 * The register's search-side nulls — wider beams (section 7), more determinized deals (section 14),
 * a longer reply horizon (section 20) — were all measured on bots whose one-ply harness cannot see
 * what a pip-funded action does or the ambition a card would declare (section 22). They say that
 * more search *on that base* buys nothing; they do not say the base cannot be improved.
 */

import { easyBot } from './easy.js'
import { MOBILE_WEIGHTS, mobileBot } from './mobile.js'
import { searchBot } from './search.js'
import type { Bot } from './bot.js'

export const BOT_LEVELS = ['easy', 'normal', 'hard'] as const
export type BotLevel = (typeof BOT_LEVELS)[number]

// Hard carries the same anti-circling weights: its beam only searches card plays, so every
// pip-level move is the delegate's one-ply choice — the circling lived there too.
const HARD = searchBot({ width: 3, depth: 14, weights: MOBILE_WEIGHTS, weightsLabel: 'mobile' })

/** The bot a level names. `undefined` — no level chosen — is normal, which keeps old saves intact. */
export function botForLevel(level: BotLevel | undefined): Bot {
  switch (level) {
    case 'easy':
      return easyBot
    case 'hard':
      return HARD
    case 'normal':
    case undefined:
      return mobileBot
  }
}
