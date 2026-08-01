/**
 * Die face art, and the mapping from a rolled face to the file that depicts it.
 *
 * The art files (`icon/<type>-die-<n>.webp`) are numbered by the **physical die's** faces. The
 * engine's `FACES` table is ordered as arcs_tts `DiceCounter.lua` lists them. Those two orders
 * are not the same, so indexing the art by the engine's face number draws the wrong symbols —
 * a roll of Assault face 1 (2 hits + self damage) drew art file 1, which is blank.
 *
 * `ART_FACES` below records what each art file actually shows, read off the images themselves.
 * `FACE_ART` is the permutation taking an engine face to the file that matches it, and the test
 * in `test/dice-art.test.ts` proves the two tables agree symbol-for-symbol — so if either the
 * engine's faces or the art set ever changes, the mismatch fails a test instead of silently
 * showing players the wrong dice.
 */

import type { DieType, Tally } from '@arcs/engine'
import { asset } from './assets.js'

const B = (): Tally => ({ self: 0, intercept: 0, hits: 0, buildings: 0, keys: 0 })

/**
 * What each art file depicts, indexed 0..5 for files `-1`..`-6`. Symbols: a white burst is a
 * hit, a burst wrapping a triangle is a building hit, the curl of flame is self-damage, a ring
 * around the face is an intercept, and keys are keys.
 */
export const ART_FACES: Readonly<Record<DieType, readonly Tally[]>> = {
  Skirmish: [
    { ...B() }, // 1 — blank
    { ...B() }, // 2 — blank
    { ...B() }, // 3 — blank
    { ...B(), hits: 1 }, // 4
    { ...B(), hits: 1 }, // 5
    { ...B(), hits: 1 }, // 6
  ],
  Assault: [
    { ...B() }, // 1 — blank
    { ...B(), hits: 1, self: 1 }, // 2
    { ...B(), hits: 1, intercept: 1 }, // 3 — hit inside the intercept ring
    { ...B(), hits: 2, self: 1 }, // 4
    { ...B(), hits: 2 }, // 5
    { ...B(), hits: 1, self: 1 }, // 6
  ],
  Raid: [
    { ...B(), keys: 2, intercept: 1 }, // 1 — two keys inside the ring
    { ...B(), keys: 1, self: 1 }, // 2
    { ...B(), intercept: 1 }, // 3 — bare ring
    { ...B(), buildings: 1, self: 1 }, // 4
    { ...B(), buildings: 1, keys: 1 }, // 5
    { ...B(), buildings: 1, self: 1 }, // 6
  ],
}

/**
 * Engine face number (1..6) -> art file number. The same permutation happens to serve all three
 * dice, which is what you would expect if the art was exported in one consistent face order.
 */
export const FACE_ART: readonly number[] = [4, 1, 5, 2, 3, 6]

/**
 * Art path for a die face. Face 0 is the blank/idle art used by the gather wizard, where no
 * face has been rolled yet; 1..6 are rolled faces and go through `FACE_ART`.
 */
export function dieArt(die: DieType, face: number): string {
  const base = asset(`game-assets/icon/${die.toLowerCase()}-die`)
  if (face <= 0) return `${base}.webp`
  return `${base}-${FACE_ART[face - 1] ?? face}.webp`
}
