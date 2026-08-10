/**
 * The weapon-option bot: the shipped weights, plus a price on what a Weapon actually buys.
 *
 * ## The blind spot this closes
 *
 * Spending a Weapon in the Prelude grants no action. It adds Battle to the played card's pips for
 * the turn (rulebook p17) — the flag `state.anyBattle` — and **no feature read that flag**. So the
 * evaluator saw the spend as a Weapon leaving the board (`weapons: 0.25`) in exchange for nothing
 * measurable, and declined it almost always.
 *
 * Measured across 8 three-player games before the feature existed: 274 Prelude menus offered a
 * Weapon option and **3 were taken** — 1%. Across all resources the bot spent at 23%, so this is
 * far below even its general reluctance. The Weapons pile up because the one thing they are for is
 * invisible.
 *
 * This is the shape docs/19 section 2g describes for leading a card, which scored as pure cost
 * before pips were priced and left the bot passing eight turns in nine. Section 0's summary of what
 * has ever moved strength is the same: fixing something the evaluator could not see, never
 * re-tuning what it already weighed.
 *
 * ## Why 0.6
 *
 * Chosen against the term it has to beat rather than guessed. The spend costs `weapons: 0.25`, so
 * any weight at or below that could never flip the decision and the experiment would measure
 * nothing at all. 0.6 puts a turn's worth of battle access above a spare Weapon without
 * approaching a city (2.0). A starting point for the arena, like every weight here.
 *
 * The feature itself is binary and gated on a battle being available — see `value.ts` for why it
 * cannot scale with pips, and why the gate is the engine's own `canBattle`.
 *
 * ## Why a new bot rather than a change to `standardBot`
 *
 * The same reason as every step in `goal.ts` and `rival.ts`: `battleUnlocked` is weight **0** in
 * `WEIGHTS`, so `standardBot` and the frozen baseline stay byte-identical and the arena can
 * attribute any difference to this idea alone. Four of the last five ideas measured as nothing or
 * worse (docs/19 sections 3j, 3k, 6), so no strength claim is made here until a run with its twin
 * says otherwise.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import type { Bot } from './bot.js'
import type { Weights } from './value.js'

export const WEAPON_WEIGHTS: Weights = { ...STANDARD_WEIGHTS, battleUnlocked: 0.6 }

export const weaponBot: Bot = heuristicBotWith(WEAPON_WEIGHTS, 'weapon-option', feasibility)
