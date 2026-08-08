/**
 * The rival-intent bot: the shipped weights, with rivals scored under their own goals.
 *
 * ## The blind spot this closes
 *
 * `valueOf` is relative — your score minus the best opponent's — and until this every opponent was
 * scored under *your* intent (`value.ts`, a documented simplification). That prices a rival's
 * position on your plan's terms: if you are not chasing Warlord, trophies are near-worthless to
 * you, so a move that hands a warlike rival two easy kills scores as harmless. The bot could not
 * deny, because it could not see what there was to deny.
 *
 * Each rival is scored under `intentFor(observed, rival, feasibility)` — the same judgement this
 * bot applies to itself, read off the same public state. Nothing hidden is touched: intent reads
 * declared markers, structure and the clock, all visible across the table. `declareReadiness`
 * already returns 0 for factions whose hands are hidden, so the one hand-reading feature stays
 * honest on its own.
 *
 * ## Measured, and the result is a null
 *
 * Two 999-game runs, three players, seats rotated (docs/19 section 6):
 *
 * | run | rival-intent | standard | twin floor |
 * | --- | --- | --- | --- |
 * | vs standard x2 | 35% wins, 18.8 power | 32%, 18.5 | — |
 * | vs standard, twinned | 34% wins, 18.8 power | 34%, 18.7 | 2 points, 0.4 power |
 *
 * Three points ahead in one run, dead level in the other, against a 2-point floor. **No strength
 * claim is made for this bot**: an effect that clears the floor once and vanishes on the rerun is
 * the floor talking. The plausible story — "seeing what a rival wants is how you deny it" — joins
 * section 0's list of ideas that sounded right and measured as nothing, and the shipped bot keeps
 * one intent for everyone.
 *
 * ## The flaw the first version had, which is the part worth remembering
 *
 * Rival intents were first recomputed on each **probed** state, on the argument that my action can
 * change a rival's position and their intent should follow it. Two things broke, one of them loudly:
 *
 *   - A rival's `contest()` reads *my* holdings, so my candidates could move their imputed intent —
 *     the bot found +0.018 in **discarding its own Material**, paying real resources to twitch the
 *     yardstick. The anti-flap rule (docs/19 section 2b), violated from the rival's side.
 *   - The strictly-improving-repeat gate terminates only while `valueOf` is one fixed function per
 *     decision. It was not, and arena seed 245 cycled Prelude → arrange → swap → Done for 20,000
 *     actions — 1 unfinished game in 999 that reproduced first try.
 *
 * Both fixed the same way: intents are computed once per decision from the pre-action state and
 * held fixed across candidates (`heuristic.ts`). The table above is the **fixed** version's — the
 * flawed one measured *below* the floor (32% against standard's 37% in its twin run) with one
 * livelocked game in 999, and its numbers died with it.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import type { Bot } from './bot.js'

export const rivalBot: Bot = heuristicBotWith(STANDARD_WEIGHTS, 'rival-intent', feasibility, {
  rivalIntent: true,
})
