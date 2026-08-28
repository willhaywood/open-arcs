/**
 * The autosave: the local game, kept across browser refreshes.
 *
 * docs/11 left this as the deliberately-deferred few lines — the save string was always ready
 * (`serializeGame`, the same bytes the Save button downloads); this module is only the shelf it
 * sits on. **localStorage, deliberately**: it exists in every browser in use, the payload is a
 * full game's journal at well under 100KB against a ~5MB quota, and a synchronous ~1ms write per
 * action is nothing at human or bot pace. IndexedDB's async plumbing buys no protection against
 * the one real cross-browser hazard (Safari evicts all script-writable storage alike), and
 * sessionStorage dies with the tab, which is the very thing being fixed.
 *
 * Every call is capability-checked and try/caught, the `multiplayer/link.ts` house style: no
 * storage (old private-mode Safari throws; vitest's node environment has no localStorage at all)
 * means no autosave, never an error. Two tabs playing local games last-write-wins — acceptable
 * for a single-player convenience, and the Save button still exists for anything precious.
 */

const KEY = 'arcs:autosave'

export function saveAutosave(json: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, json)
  } catch {
    /* no storage, no autosave — the Save button still works */
  }
}

export function readAutosave(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function clearAutosave(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing stored, nothing to clear */
  }
}
