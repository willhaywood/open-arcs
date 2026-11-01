/**
 * Step: let the probe see what a pip-funded action does.
 *
 * `settle` stops at the first ask with pips still ahead. For a lead that is the pip menu, which is
 * the right horizon; for an action bought *at* the pip menu it is that action's own first sub-ask
 * — "Move — choose a fleet", "Battle — choose a system" — where the board has not moved. Move,
 * Build, Tax, Influence, Secure and Battle all score as the board already stands, they tie, and the
 * strictly-greater tie-break hands the pip to whichever the engine listed first: about 98% of pip
 * menus in the October 2026 review, and no Secure from the pip menu at all (docs/19 section 22).
 *
 * `menuBot` is `mobileBot` with `settleActions` on: a probe plays the action's sub-flow through to
 * the next pip menu, resolving each sub-ask by the bot's own one-ply judgement, so each action is
 * scored on the board it leaves. Three faults the review found in its scratch build of this are
 * fixed under the same flag (`play.ts`): the phantom half-pip a probe ending mid-flow was paid, an
 * Arrange scored without its card's pips, and a pip-menu Battle judged on one dice roll. A fourth,
 * arrange decisions whose cost grew with the square of the options, is bounded: a line that comes
 * back to the question being decided stops there, as a repeat. Lines also stop where the turn ends,
 * even when the same seat is asked next. Without both stops the bot can arrange and press Done
 * forever (docs/19 section 24).
 *
 * `menuDeclarerBot` adds the declarer's `settleDeclares` (`declarer.ts`). The two flags touch
 * different decisions — the declarer changes only leads, this only what follows them — and the
 * combination is `hard` (`levels.ts`).
 */

import type { Bot } from './bot.js'
import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { MOBILE_WEIGHTS } from './mobile.js'

export const menuBot: Bot = {
  ...heuristicBotWith(MOBILE_WEIGHTS, 'menu', feasibility),
  settleActions: true,
}

export const menuDeclarerBot: Bot = {
  ...heuristicBotWith(MOBILE_WEIGHTS, 'menu-declarer', feasibility),
  settleActions: true,
  settleDeclares: true,
}
