/**
 * Seeded, immutable PRNG carried in game state.
 *
 * Two hard requirements drive this. The journal format records randomness as actions, so
 * a rule must never reach for a global random. And rollouts need to branch and replay
 * deterministically. Every draw returns the next generator rather than mutating.
 */

export interface Rng {
  readonly seed: number
}

export function rng(seed: number): Rng {
  // Avoid a zero state, which mulberry32 handles poorly.
  return { seed: (seed >>> 0) || 0x9e3779b9 }
}

/** mulberry32 — small, fast, adequate for game randomness. Not cryptographic. */
function step(state: Rng): { value: number; next: Rng } {
  let t = (state.seed + 0x6d2b79f5) >>> 0
  const nextSeed = t
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { value, next: { seed: nextSeed } }
}

/** Uniform float in [0, 1). */
export function nextFloat(state: Rng): [number, Rng] {
  const { value, next } = step(state)
  return [value, next]
}

/** Uniform integer in [0, bound). */
export function nextInt(state: Rng, bound: number): [number, Rng] {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(`bound must be a positive integer, got ${bound}`)
  }
  const [value, next] = nextFloat(state)
  return [Math.floor(value * bound), next]
}

/** A single die result in [1, sides]. */
export function roll(state: Rng, sides: number): [number, Rng] {
  const [n, next] = nextInt(state, sides)
  return [n + 1, next]
}

/** Fisher-Yates. Returns a new array; the input is untouched. */
export function shuffle<T>(state: Rng, items: readonly T[]): [T[], Rng] {
  const out = [...items]
  let current = state
  for (let i = out.length - 1; i > 0; i--) {
    const [j, next] = nextInt(current, i + 1)
    current = next
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return [out, current]
}

/** Pick one element. Throws on an empty list — callers should check first. */
export function pick<T>(state: Rng, items: readonly T[]): [T, Rng] {
  if (items.length === 0) throw new Error('pick from empty list')
  const [i, next] = nextInt(state, items.length)
  return [items[i]!, next]
}
