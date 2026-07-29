/**
 * Battle dice. Faces cross-checked and confirmed IDENTICAL between both references:
 * haunt-roll-fail (arcs/game.scala BattleDie) and arcs_tts (src/DiceCounter.lua) — the
 * latter being the physical component data. See docs/09-battle.md.
 *
 * Each die has six faces; a face contributes some mix of five symbols:
 *   self       — a hit on the attacker's own ships (OwnDamage)
 *   intercept  — presence of any intercept lets the defender strike back
 *   hits       — hits on enemy ships (HitShip)
 *   buildings  — hits on enemy buildings (HitBuilding)
 *   keys       — raid keys, used to steal from the enemy
 */

import { roll } from './rng.js'
import type { Rng } from './rng.js'

export const DICE = ['Skirmish', 'Assault', 'Raid'] as const
export type DieType = (typeof DICE)[number]

export interface Tally {
  self: number
  intercept: number
  hits: number
  buildings: number
  keys: number
}

export function emptyTally(): Tally {
  return { self: 0, intercept: 0, hits: 0, buildings: 0, keys: 0 }
}

const B = emptyTally

/**
 * Six faces per die (index 0..5). Values from arcs_tts DiceCounter.lua, confirmed vs HRF.
 *
 * Exported because it is the authority on what a rolled face *means* — the web app maps these
 * to the component art, whose files are numbered by the physical die rather than by this
 * table's order. See `apps/web/src/dice-art.ts`.
 */
export const FACES: Readonly<Record<DieType, readonly Tally[]>> = {
  Skirmish: [
    { ...B(), hits: 1 },
    { ...B() },
    { ...B(), hits: 1 },
    { ...B() },
    { ...B() },
    { ...B(), hits: 1 },
  ],
  Assault: [
    { ...B(), hits: 2, self: 1 },
    { ...B() },
    { ...B(), hits: 2 },
    { ...B(), hits: 1, self: 1 },
    { ...B(), hits: 1, intercept: 1 },
    { ...B(), hits: 1, self: 1 },
  ],
  Raid: [
    { ...B(), buildings: 1, self: 1 },
    { ...B(), keys: 2, intercept: 1 },
    { ...B(), keys: 1, buildings: 1 },
    { ...B(), self: 1, keys: 1 },
    { ...B(), intercept: 1 },
    { ...B(), buildings: 1, self: 1 },
  ],
}

/** Roll one die, returning its face tally and the advanced generator. */
export function rollDie(rng: Rng, die: DieType): [Tally, Rng] {
  const [face, next] = roll(rng, 6) // 1..6
  return [FACES[die][face - 1]!, next]
}

/** One rolled die: its type and which of the six faces (1..6) came up — for the UI. */
export interface DieRoll {
  readonly die: DieType
  /** 1-based face number, matching the art file `icon/<type>-die-<face>.webp`. */
  readonly face: number
}

/**
 * Roll a pool and keep **every die's face**, so the UI can show the graphical dice and
 * animate the roll. The tally is summed from the same faces, so it can never disagree with
 * what is displayed. Deterministic in the seed, exactly like `rollPool`.
 */
export function rollPoolDetailed(
  rng: Rng,
  pool: { skirmish: number; assault: number; raid: number },
): [{ rolls: DieRoll[]; tally: Tally }, Rng] {
  const rolls: DieRoll[] = []
  let current = rng
  const add = (die: DieType, n: number): void => {
    for (let i = 0; i < n; i++) {
      const [face, next] = roll(current, 6)
      current = next
      rolls.push({ die, face })
    }
  }
  add('Skirmish', pool.skirmish)
  add('Assault', pool.assault)
  add('Raid', pool.raid)
  return [{ rolls, tally: tallyOf(rolls) }, current]
}

/**
 * What a set of already-rolled dice adds up to.
 *
 * Split out from `rollPoolDetailed` because a reroll has to re-read a pool it did not roll: the
 * faces change under it, and the tally has to be derived again rather than adjusted. Anything that
 * modifies dice after the fact goes through here, so there is one definition of what a face means.
 */
export function tallyOf(rolls: readonly DieRoll[]): Tally {
  const tally = emptyTally()
  for (const { die, face } of rolls) {
    const f = FACES[die][face - 1]!
    tally.self += f.self
    tally.intercept += f.intercept
    tally.hits += f.hits
    tally.buildings += f.buildings
    tally.keys += f.keys
  }
  return tally
}

/**
 * Reroll the dice at `indices`, keeping every other die exactly as it fell.
 *
 * All of them are rerolled **together**, which the official ruling requires: rerolls from a single
 * ability happen at once, not one at a time with a look in between. Rerolling in index order keeps
 * the result a pure function of the seed and the chosen set, so a replay reproduces it.
 */
export function rerollAt(
  rng: Rng,
  rolls: readonly DieRoll[],
  indices: readonly number[],
): [DieRoll[], Rng] {
  const chosen = new Set(indices)
  const out: DieRoll[] = []
  let current = rng
  for (let i = 0; i < rolls.length; i++) {
    const die = rolls[i]!
    if (!chosen.has(i)) {
      out.push(die)
      continue
    }
    const [face, next] = roll(current, 6)
    current = next
    out.push({ die: die.die, face })
  }
  return [out, current]
}

/** Roll a whole pool and sum the faces. Deterministic in the seed. */
export function rollPool(
  rng: Rng,
  pool: { skirmish: number; assault: number; raid: number },
): [Tally, Rng] {
  const total = emptyTally()
  let current = rng
  const add = (die: DieType, n: number) => {
    for (let i = 0; i < n; i++) {
      const [face, next] = rollDie(current, die)
      current = next
      total.self += face.self
      total.intercept += face.intercept
      total.hits += face.hits
      total.buildings += face.buildings
      total.keys += face.keys
    }
  }
  add('Skirmish', pool.skirmish)
  add('Assault', pool.assault)
  add('Raid', pool.raid)
  return [total, current]
}

/** Physical limit: six of each die type exist. */
export const DICE_PER_TYPE = 6

// --- hit application -------------------------------------------------------

export interface HitOutcome {
  /** Pieces destroyed by these hits. */
  readonly destroyed: readonly string[]
  /** The new damaged set. */
  readonly damaged: readonly string[]
  /** Hits that found no target — they overflow (ship hits become building hits). */
  readonly remaining: number
}

/**
 * Apply `count` hits to `targets`, pure.
 *
 * A fresh piece absorbs two hits (one damages it, a second destroys it); a damaged piece
 * absorbs one. That is HRF's health model — `shipsN = sum(fresh ? 2 : 1)`, with hits beyond
 * the pool overflowing to bombardment (game-battle.scala:491-499).
 *
 * Assignment is auto-resolved (player-directed allocation is deferred, docs/09): each hit
 * finishes an already-damaged piece if there is one, otherwise damages a fresh piece. This
 * consumes the health pool fully, so hits are never silently wasted while targets remain.
 */
export function applyHits(
  damaged: readonly string[],
  targets: readonly string[],
  count: number,
): HitOutcome {
  const destroyed: string[] = []
  let hurt = [...damaged]
  let remaining = count

  while (remaining > 0) {
    const finish = targets.find((id) => hurt.includes(id) && !destroyed.includes(id))
    if (finish !== undefined) {
      destroyed.push(finish)
      hurt = hurt.filter((d) => d !== finish)
      remaining--
      continue
    }
    const fresh = targets.find((id) => !hurt.includes(id) && !destroyed.includes(id))
    if (fresh !== undefined) {
      hurt.push(fresh)
      remaining--
      continue
    }
    break // no targets left to absorb hits
  }

  return { destroyed, damaged: hurt, remaining }
}
