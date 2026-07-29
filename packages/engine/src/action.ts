/**
 * Actions are the only way state changes, and the journal is a list of them.
 *
 * Deliberately an open union keyed on `type`: rule modules contribute their own action
 * types, and no code is required to match exhaustively — an unrecognised action falls
 * through the module chain to the next handler. That is what lets phase 2 add rules
 * without touching phase 1. See docs/04-scope-and-phasing.md section 2.3.
 */

import type { FactionId } from './ids.js'

export interface Action {
  readonly type: string
  readonly [field: string]: unknown
}

/**
 * An action a player chose, as opposed to an engine-internal step. Only these are
 * offered in an `Ask`, and only these plus recorded randomness enter the journal.
 */
export interface UserAction extends Action {
  readonly faction: FactionId
  /** Short human-readable label for the UI. */
  readonly label: string
}

export function isUserAction(action: Action): action is UserAction {
  return typeof action['faction'] === 'string' && typeof action['label'] === 'string'
}

/**
 * Canonical string form, used as the journal encoding and as a map key.
 * Field order is normalised so the same action always produces the same string.
 */
export function encodeAction(action: Action): string {
  const fields = Object.keys(action)
    // `label` is UI-only; drop undefined values so the encoding stays JSON-parseable.
    .filter((k) => k !== 'type' && k !== 'label' && action[k] !== undefined)
    .sort()
    .map((k) => `${k}=${JSON.stringify(action[k])}`)
  return fields.length > 0 ? `${action.type}(${fields.join(',')})` : action.type
}

export function decodeAction(encoded: string): Action {
  const open = encoded.indexOf('(')
  if (open === -1) return { type: encoded }

  const type = encoded.slice(0, open)
  const body = encoded.slice(open + 1, encoded.lastIndexOf(')'))
  const action: Record<string, unknown> = { type }

  if (body.length > 0) {
    for (const field of splitFields(body)) {
      const eq = field.indexOf('=')
      if (eq === -1) throw new Error(`malformed action field in ${encoded}: ${field}`)
      action[field.slice(0, eq)] = JSON.parse(field.slice(eq + 1))
    }
  }
  return action as Action
}

/** Split on commas that are not inside a JSON string or bracket. */
function splitFields(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = 0

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '[' || ch === '{') depth++
      else if (ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) {
        out.push(body.slice(start, i))
        start = i + 1
      }
    }
  }
  out.push(body.slice(start))
  return out
}
