/**
 * Step: let the probe see the ambition a card would declare.
 *
 * `settle` declines the declare prompt for every bot (`DECLINE`), so a lead is scored with the
 * declaration skipped. `declareReadiness` charges for holding a card that could declare, and
 * nothing credits the marker the card would win — the probe sees the cost of a declaration and
 * never its payoff. docs/19 section 2h listed the decline as open, and section 2j kept it by
 * argument ("the bot will be asked for real and can evaluate it then") without measuring it. The
 * argument misses that by the time the bot is asked, the card it led was chosen blind.
 *
 * `declarerBot` is `mobileBot` with `settleDeclares` on: inside a probe the declare prompt is
 * resolved by the bot's own one-ply judgement, so each card is valued at the better of declining
 * and its best declaration. Farseers' look, which follows a declaration, stays declined — it lists
 * a rival's real hand.
 *
 * Only lead decisions change: a follower is never asked to declare, and hard's beam already
 * expands the declaration at the card plays it searches. Over eight three-player probe games, 14
 * of 77 leads changed and no other decision did.
 *
 * ## Measured
 *
 * One declarer seat against normal, seats rotated, over every board of the player count:
 *
 *   - **Two players**, 250 games a board: Frontiers 71.2% ± 5.4, Homelands 56.0% ± 5.7, MixUp1
 *     50.8% ± 4.2, MixUp2 49.6% ± 3.9 — 56.9% pooled, +4.2 power a game. The MixUp boards are a
 *     wash because the seat decides them: the first seat wins 83-89% whichever bot sits there.
 *   - **Three players**, 999 games: 45.8% ± 2.7 against a 33.3% chance line, ahead on all four
 *     boards (43.4-48.8%) and from every seat; power 22.3 to normal's 18.0.
 *   - **Four players**, 600 games: 40.5% ± 3.2 against a 25% chance line, ahead on all four boards
 *     (34.5-44.7%) and from every seat; power 18.0 to normal's 12.0.
 *
 * At three and four players that is one seat against copies of a single bot, the protocol docs/19
 * section 0 warns flatters the odd one out; runs with more than one declarer have not been played.
 * Against shipped hard at two players, 400 games over the four boards: 58.0% ± 4.3, ahead on every
 * board.
 *
 * It declares more without converting worse. In three-player self-play (40 games) it declares 8.6
 * times a game to normal's 5.9 and wins 64% of what it declares to normal's 62%. A lead decision
 * costs 2.5-2.9x normal's, a median 7-14 ms against 2-5 ms, beside a 1.5 s bot pace. No game
 * stalled.
 *
 * An opt-in bot, not a ladder rung: these numbers put it at or above hard at two players, and what
 * the ladder should become is docs/19 section 22's question, not this file's.
 */

import type { Bot } from './bot.js'
import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { MOBILE_WEIGHTS } from './mobile.js'

export const declarerBot: Bot = {
  ...heuristicBotWith(MOBILE_WEIGHTS, 'declarer', feasibility),
  settleDeclares: true,
}
